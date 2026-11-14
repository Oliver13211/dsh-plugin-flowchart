/**
 * FlowChart — Host half.
 *
 * Registers the model-facing `FlowChart` tool. The Host reads the YAML the
 * agent authored (inline, or from a workspace file it never writes), runs the
 * first validation pass, and returns a compact summary. Rendering happens in
 * the Web Client; this half stays a reader and a validator.
 *
 * Scope: tool registration, source resolution, the four validation layers and
 * normalization in `lib/normalize.js`, the snapshot block a `file` chart
 * travels in, and the session projection that rebuilds the chart list from the
 * log. The Web Client half draws it (sidebar tab and conversation card).
 */

// No `@deepseek-ai/*` imports here on purpose. A locally linked bundle is
// resolved from its real path in the workspace, so Node's ESM resolver cannot
// reach the app tree, and `ctx.tools` is reached through `inject` anyway.
// `ctx.tools.register()` accepts a plain tool definition object.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizeFlowChart } from './lib/normalize.js'
import { createFlowChartProjectionDefinition, snapshotFence } from './lib/projection.js'

/** Cordis plugin name. */
export const name = 'flowchart'

/** Services used by this plugin. */
export const inject = ['tools', 'workingDirectory', 'sessionProjections']

const MAX_FILE_BYTES = 256 * 1024

// The model-visible result stays bounded (design §5.4): a document with forty
// problems must not spend forty lines of the reader's context.
const MAX_REPORTED_WARNINGS = 5
const MAX_REPORTED_ERRORS = 10

/** Keep the first `max` entries and say how many were withheld. */
function bounded(items, max, noun) {
  if (!Array.isArray(items) || items.length <= max) return items
  return [...items.slice(0, max), `…and ${items.length - max} more ${noun}.`]
}

const DEFAULTS = {
  autoOpen: true,
  defaultDirection: 'TB',
  maxNodes: 60,
  maxEdges: 120,
  maxYamlChars: 20000,
  showLegendByDefault: false,
  export: { svg: true, png: true },
}

/**
 * The plugin config schema.
 *
 * Cordis validates a plugin's exported `Config` through the Standard Schema
 * `~standard.validate` face, so this is a hand-written object rather than a
 * borrow of `@deepseek-ai/schemastery` — the same reason `lib/projection.js`
 * hand-writes its schema: a linked local bundle resolves from its real path
 * in the workspace and cannot reach the app tree's packages.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'flowchart',
    validate(value) {
      const issues = []
      const settings = { ...DEFAULTS, export: { ...DEFAULTS.export } }
      const raw = value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}

      const bool = (key, target) => {
        if (raw[key] === undefined) return
        if (typeof raw[key] !== 'boolean') {
          issues.push({ message: `${key} must be true or false`, path: [key] })
          return
        }
        target(key, raw[key])
      }
      const integer = (key, min, max) => {
        if (raw[key] === undefined) return
        if (typeof raw[key] !== 'number' || !Number.isInteger(raw[key] || 0) || raw[key] < min || raw[key] > max) {
          issues.push({ message: `${key} must be an integer between ${min} and ${max}`, path: [key] })
          return
        }
        settings[key] = raw[key]
      }

      bool('autoOpen', (key, v) => (settings[key] = v))
      bool('showLegendByDefault', (key, v) => (settings[key] = v))
      integer('maxNodes', 1, 500)
      integer('maxEdges', 1, 1000)
      integer('maxYamlChars', 1000, 200000)

      if (raw.defaultDirection !== undefined) {
        const direction = typeof raw.defaultDirection === 'string' ? raw.defaultDirection.toUpperCase() : ''
        if (!['TB', 'BT', 'LR', 'RL'].includes(direction)) {
          issues.push({ message: 'defaultDirection must be one of TB, BT, LR, RL', path: ['defaultDirection'] })
        } else {
          settings.defaultDirection = direction
        }
      }

      if (raw.export !== undefined) {
        if (raw.export === null || typeof raw.export !== 'object' || Array.isArray(raw.export)) {
          issues.push({ message: 'export must be a mapping with svg and png flags', path: ['export'] })
        } else {
          for (const format of ['svg', 'png']) {
            if (raw.export[format] === undefined) continue
            if (typeof raw.export[format] !== 'boolean') {
              issues.push({ message: `export.${format} must be true or false`, path: ['export', format] })
              continue
            }
            settings.export[format] = raw.export[format]
          }
        }
      }

      if (issues.length > 0) return { issues }
      return { value: settings }
    },
  },
}

const DESCRIPTION = [
  'Draw a flow chart in the right sidebar so the user can see a process, decision path, or system structure instead of reading it as prose.',
  'Use it when an explanation has steps, branches, loops, retries, or component relationships that are hard to follow in text — architecture walkthroughs, request flows, runbooks, state machines, "what happens next" questions.',
  'Author the chart as a small YAML document:',
  '',
  '  id: deploy                # optional, stable id; the same id replaces the chart in place',
  '  title: 部署流程            # optional short title',
  '  direction: TB             # optional: TB | BT | LR | RL',
  '  nodes:',
  '    - id: start             # required, unique, letters/digits/-/_',
  '      label: 开始            # optional text inside the shape',
  '      shape: stadium        # rect | rounded | stadium | ellipse | circle | diamond | hexagon | parallelogram | cylinder | document | cloud | triangle | star | note | subroutine',
  '      fill: "#4f7cff"       # #rgb | #rrggbb | CSS color name | auto | none',
  '      stroke: auto          # auto | none | a color',
  '      strokeWidth: 1.5      # 0 removes the outline',
  '  edges:',
  '    - from: start',
  '      to: build',
  '      label: 触发            # optional text on the line',
  '      arrow: end            # none | start | end | both',
  '      arrowShape: triangle  # triangle | vee | line | circle | diamond',
  '      style: solid          # solid | dashed | dotted',
  '      route: orthogonal     # orthogonal | straight | curve',
  '      color: auto',
  '',
  'Limits: 20000 YAML characters, 60 nodes, 120 edges. Pass `yaml` inline, or `file` to read a YAML file from the workspace (this tool never writes files).',
  'The result reports node and edge counts, warnings, and validation errors with line numbers — fix them and call again with the same `id`.',
].join('\n')

function describeErrors(errors) {
  return errors.map((error) => {
    const where = [error.line > 0 ? `line ${error.line}` : '', error.path].filter(Boolean).join(' · ')
    const hint = error.hint ? ` — ${error.hint}` : ''
    return `${where ? `${where}: ` : ''}${error.message}${hint}`
  })
}

function renderText(value) {
  if (!value.ok) {
    const lines = describeErrors(value.errors || [])
    return [`FlowChart rejected (${lines.length} problem${lines.length === 1 ? '' : 's'}):`, ...lines.map((line) => `- ${line}`)].join('\n')
  }
  const title = value.title ? ` "${value.title}"` : ''
  const head = `FlowChart${title} accepted · id ${value.id} · ${value.nodes} nodes, ${value.edges} edges · source ${value.source}`
  const notes = (value.warnings || []).map((warning) => `- ${warning}`)
  const footer = 'The chart is drawn in the Flow Chart tab of the right sidebar; the card for this call in the conversation links back to it.'
  const parts = [head, ...(notes.length ? ['', 'Warnings:', ...notes] : []), '', footer]
  if (value.ok && value.snapshot) parts.push('', value.snapshot)
  return parts.join('\n')
}

async function resolveCwd(ctx, exec) {
  if (exec.agent && ctx.workingDirectory) {
    try {
      return await ctx.workingDirectory.ensure(exec.agent, exec.signal)
    } catch {
      return process.cwd()
    }
  }
  return process.cwd()
}

/** Read the validated config, falling back to the shipped defaults. */
function normalizeSettings(config) {
  const value = config !== null && typeof config === 'object' ? config : {}
  const exportFlags = value.export !== null && typeof value.export === 'object' ? value.export : {}
  return {
    autoOpen: value.autoOpen === undefined ? DEFAULTS.autoOpen : value.autoOpen === true,
    defaultDirection: typeof value.defaultDirection === 'string' && ['TB', 'BT', 'LR', 'RL'].includes(value.defaultDirection.toUpperCase())
      ? value.defaultDirection.toUpperCase()
      : DEFAULTS.defaultDirection,
    maxNodes: Number.isInteger(value.maxNodes) ? value.maxNodes : DEFAULTS.maxNodes,
    maxEdges: Number.isInteger(value.maxEdges) ? value.maxEdges : DEFAULTS.maxEdges,
    maxYamlChars: Number.isInteger(value.maxYamlChars) ? value.maxYamlChars : DEFAULTS.maxYamlChars,
    showLegendByDefault: value.showLegendByDefault === undefined ? DEFAULTS.showLegendByDefault : value.showLegendByDefault === true,
    export: {
      svg: exportFlags.svg === undefined ? DEFAULTS.export.svg : exportFlags.svg === true,
      png: exportFlags.png === undefined ? DEFAULTS.export.png : exportFlags.png === true,
    },
  }
}

/** Register the FlowChart tool and its session projection for this composition. */
export function apply(ctx, config) {
  const settings = normalizeSettings(config)
  const limits = { maxChars: settings.maxYamlChars, maxNodes: settings.maxNodes, maxEdges: settings.maxEdges }
  const projectionDefinition = createFlowChartProjectionDefinition(settings)

  const unregisterProjection =
    ctx.sessionProjections && typeof ctx.sessionProjections.register === 'function'
      ? ctx.sessionProjections.register(projectionDefinition)
      : null

  ctx.tools.register({
    name: 'FlowChart',
    description: DESCRIPTION,
    // A real JSON Schema, not the friendly spec-map: `ctx.tools.register()`
    // passes `parameters` through verbatim, and a bare `{ yaml: {...} }` map
    // reaches the model as an input schema with NO properties — weaker models
    // then (correctly) call the tool with `{}`. Verified live via Tool.listTools.
    parameters: {
      type: 'object',
      properties: {
        yaml: {
          type: 'string',
          description: 'The chart as a YAML document, written inline. Mutually exclusive with `file`.',
        },
        file: {
          type: 'string',
          description: 'Path to a YAML file to read. Relative paths resolve against the Session working directory. Mutually exclusive with `yaml`. This tool never writes files.',
        },
        open: {
          type: 'boolean',
          description: 'Set false to keep the chart out of the foreground. Defaults to true.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: {
          ok: { type: 'boolean', description: 'True when the document parsed and passed structural checks.' },
          id: { type: 'string', description: 'Chart id. Calling again with the same id replaces the chart.' },
          title: { type: 'string', description: 'Chart title from the document.' },
          nodes: { type: 'integer', description: 'Number of nodes.' },
          edges: { type: 'integer', description: 'Number of edges.' },
          source: { type: 'string', description: 'Where the document came from: "inline" or the absolute file path.' },
          warnings: { type: 'array', description: 'Non-fatal notes the agent should fix on the next pass.', items: { type: 'string' } },
          snapshot: { type: 'string', description: 'Internal: the accepted snapshot block for a file-sourced chart.' },
          errors: {
            type: 'array',
            description: 'Fatal problems, each located in the document.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['message'],
              properties: {
                line: { type: 'integer', description: '1-based line number, 0 when the problem is not in the document.' },
                path: { type: 'string', description: 'Document path such as nodes[2].id.' },
                message: { type: 'string' },
                hint: { type: 'string' },
              },
            },
          },
        },
      },
      // A `file` chart's contents are not in the Session log, so the accepted
      // snapshot travels in the result text the log keeps. An inline chart
      // needs none: its YAML is already in the tool call the projection folds.
      render: (_args, value) => [{ type: 'text', text: renderText(value) }],
    },
    async execute(args, exec) {
      const inline = typeof args.yaml === 'string' && args.yaml.trim() !== ''
      const file = typeof args.file === 'string' && args.file.trim() !== ''

      if (!inline && !file) {
        return {
          ok: false,
          source: 'none',
          warnings: [],
          errors: [{
            line: 0,
            path: '',
            message: 'Provide the chart in yaml, or a YAML file path in file.',
            hint: 'Pass yaml: "nodes:\n  - id: start\n    label: 开始".',
          }],
        }
      }
      if (inline && file) {
        return {
          ok: false,
          source: 'none',
          warnings: [],
          errors: [{ line: 0, path: '', message: 'Provide yaml or file, not both.', hint: 'Pick one source.' }],
        }
      }

      let text
      let source = 'inline'
      if (file) {
        const resolved = path.isAbsolute(args.file) ? args.file : path.resolve(await resolveCwd(ctx, exec), args.file)
        source = resolved
        try {
          const buffer = await readFile(resolved, { signal: exec.signal })
          if (buffer.byteLength > MAX_FILE_BYTES) {
            return {
              ok: false,
              source,
              warnings: [],
              errors: [{
                line: 0,
                path: '',
                message: `${source} is ${buffer.byteLength} bytes, over the ${MAX_FILE_BYTES} byte file limit.`,
                hint: 'Point at the chart YAML, not a large source file.',
              }],
            }
          }
          text = buffer.toString('utf8')
        } catch (error) {
          const reason = error && error.code === 'ENOENT' ? 'no such file' : String((error && error.message) || error)
          return {
            ok: false,
            source,
            warnings: [],
            errors: [{ line: 0, path: '', message: `Cannot read ${source}: ${reason}.`, hint: 'Check the path, or pass the chart inline with yaml.' }],
          }
        }
      } else {
        text = args.yaml
      }

      const result = normalizeFlowChart(text, limits, { defaultDirection: settings.defaultDirection })
      if (!result.ok) {
        return { ok: false, source, warnings: [], errors: bounded(result.errors, MAX_REPORTED_ERRORS, 'problems') }
      }

      // The key is omitted, not set to undefined: a tool result must be
      // lossless JSON, and an explicit `undefined` is not.
      const value = {
        ok: true,
        id: result.doc.id,
        title: result.doc.title,
        nodes: result.doc.nodes.length,
        edges: result.doc.edges.length,
        source,
        warnings: bounded(result.warnings, MAX_REPORTED_WARNINGS, 'warnings'),
        errors: [],
      }
      if (file) value.snapshot = snapshotFence(text)
      return value
    },
  })

  return () => {
    if (typeof unregisterProjection === 'function') unregisterProjection()
  }
}
