/**
 * FlowChart DSL — validation layers 2 to 4, and normalization.
 *
 * Layer 1 (lexical/syntax) and the identity checks sit in `lib/dsl.js`. This
 * module takes the parsed document and runs the rest of the pipeline the
 * design doc orders:
 *
 *   2. structure — field types, enums, required fields. Every misspelled
 *      enum value names the closest candidate ("did you mean …?").
 *   3. graph semantics — dangling edges, isolated nodes (warning), self-loops
 *      (warning), cycles (allowed; the edge that closes one is routed as a
 *      curve so the orthogonal layout can carry it back).
 *   4. capacity — the ceilings, so an oversized chart is refused before it can
 *      stall a layout.
 *
 * On success it returns a **normalized document**: every field present with
 * its default applied, colors canonicalized, unknown fields dropped. The
 * Client renders this shape and never sees raw YAML.
 *
 * Deterministic: no random numbers, no clock, no locale-sensitive ordering.
 */

import { DIRECTIONS, SHAPES, asText, isPlainObject, lineOf, parseStructure } from './dsl.js'

export const ARROWS = ['none', 'start', 'end', 'both']
export const ARROW_SHAPES = ['triangle', 'vee', 'line', 'circle', 'diamond']
export const STYLES = ['solid', 'dashed', 'dotted']
export const ROUTES = ['orthogonal', 'straight', 'curve']
export const SIDES = ['auto', 'top', 'right', 'bottom', 'left']
export const ALIGNS = ['left', 'center', 'right']
export const THEMES = ['auto', 'light', 'dark']

/**
 * Spellings models reach for that name a shape without naming it. They only
 * power the "did you mean" hint — a misspelling is still an error, so the
 * agent fixes it instead of silently drawing something it did not ask for.
 */
const SHAPE_ALIASES = {
  rhombus: 'diamond', rhomb: 'diamond', rectangle: 'rect', box: 'rect', square: 'rect', block: 'rect',
  oval: 'ellipse', sphere: 'circle', round: 'rounded', roundrect: 'rounded', 'round_rect': 'rounded',
  capsule: 'stadium', pill: 'stadium', hex: 'hexagon', parallelogram: 'parallelogram', trapezoid: 'parallelogram',
  doc: 'document', page: 'document', db: 'cylinder', database: 'cylinder', bubble: 'cloud',
  diamond: 'diamond', triangle: 'triangle', star: 'star', note: 'note', sub: 'subroutine', subroutine: 'subroutine',
}

const ARROW_ALIASES = { head: 'end', arrow: 'end', forwards: 'end', bothways: 'both',双向: 'both', none: 'none' }
const STYLE_ALIASES = { dash: 'dashed', dots: 'dotted', dot: 'dotted', line: 'solid' }
const ROUTE_ALIASES = { curved: 'curve', curvedline: 'curve', direct: 'straight', line: 'straight', boxy: 'orthogonal' }

export const MAX_LABEL_CHARS = 120
export const MAX_TITLE_CHARS = 80
export const MAX_GROUPS = 12
export const MAX_LEGEND = 8

/** CSS keywords accepted in place of a hex color. */
const CSS_COLORS = new Set([
  'transparent', 'black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'pink',
  'gray', 'grey', 'silver', 'maroon', 'navy', 'olive', 'lime', 'aqua', 'fuchsia', 'teal',
  'indigo', 'violet', 'cyan', 'magenta', 'brown', 'gold', 'coral', 'salmon', 'khaki', 'plum',
  'orchid', 'tan', 'beige', 'ivory', 'snow', 'linen', 'crimson', 'sienna', 'chocolate', 'peru',
  'burlywood', 'darkred', 'darkgreen', 'darkblue', 'darkorange', 'darkslategray', 'slategray',
  'steelblue', 'royalblue', 'dodgerblue', 'skyblue', 'lightblue', 'lightgreen', 'lightyellow',
  'lightgray', 'lightgrey', 'darkgray', 'darkgrey', 'seagreen', 'forestgreen', 'limegreen',
  'goldenrod', 'tomato', 'hotpink', 'deeppink', 'mediumseagreen', 'slateblue', 'mediumpurple',
])

const NODE_DEFAULTS = {
  shape: 'rounded',
  fill: 'auto',
  stroke: 'auto',
  strokeWidth: 1.5,
  color: 'auto',
  fontSize: 13,
  align: 'center',
  dashed: false,
  bold: false,
  mono: false,
}

const CANVAS_DEFAULTS = { grid: 8, rankSpacing: 64, nodeSpacing: 40, padding: 24 }

const EDGE_DEFAULTS = {
  arrow: 'end',
  arrowShape: 'triangle',
  style: 'solid',
  color: 'auto',
  width: 1.5,
  route: 'orthogonal',
  fromSide: 'auto',
  toSide: 'auto',
}

const TOP_FIELDS = ['version', 'id', 'title', 'direction', 'theme', 'canvas', 'defaults', 'nodes', 'edges', 'groups', 'legend']
const CANVAS_FIELDS = ['grid', 'rankSpacing', 'nodeSpacing', 'padding']
const DEFAULTS_FIELDS = ['shape', 'fill', 'stroke', 'strokeWidth', 'color', 'fontSize', 'align', 'dashed', 'bold', 'mono']
const NODE_FIELDS = ['id', 'label', ...DEFAULTS_FIELDS, 'size', 'pos']
const EDGE_FIELDS = ['from', 'to', 'label', 'arrow', 'arrowShape', 'style', 'color', 'width', 'route', 'fromSide', 'toSide', 'dashArray']
const GROUP_FIELDS = ['id', 'label', 'members', 'fill', 'stroke', 'style']

/**
 * @typedef {object} FlowChartDoc
 * @property {number} version
 * @property {string} id
 * @property {string=} title
 * @property {'TB'|'BT'|'LR'|'RL'} direction
 * @property {string} theme
 * @property {{ grid: number, rankSpacing: number, nodeSpacing: number, padding: number }} canvas
 * @property {Array<object>} nodes
 * @property {Array<object>} edges
 * @property {Array<object>} groups
 * @property {Array<object>} legend
 */

/**
 * Validate a FlowChart document and normalize it.
 * @param {string} text the YAML the agent authored
 * @param {{ maxChars: number, maxNodes: number, maxEdges: number }} limits
 * @param {{ defaultDirection?: string }} [options] defaults the plugin config can override
 * @returns {{ ok: true, doc: FlowChartDoc, warnings: string[] } | { ok: false, errors: Array<{ line: number, path: string, message: string, hint: string }> }}
 */
export function normalizeFlowChart(text, limits, options = {}) {
  const structure = parseStructure(text, limits)
  if (!structure.ok) return { ok: false, errors: structure.errors }

  const source = structure.doc
  const errors = []
  const warnings = []
  const at = (key) => lineOf(source, key)

  noteUnknownFields(source, TOP_FIELDS, '', warnings)

  // --- version -------------------------------------------------------------
  let version = 1
  if (source.version !== undefined) {
    if (source.version !== 1) {
      push(errors, at('version'), 'version', `version ${JSON.stringify(source.version)} is not supported.`, 'Drop the version field, or write version: 1.')
    }
  }

  // --- title, direction, theme --------------------------------------------
  const title = readLabel(source.title, 'title', at('title'), MAX_TITLE_CHARS, errors)
  const fallbackDirection = typeof options.defaultDirection === 'string' ? options.defaultDirection.toUpperCase() : 'TB'
  const direction = readEnum(source.direction, DIRECTIONS, 'direction', at('direction'), errors, fallbackDirection, { caseInsensitive: true }).toUpperCase()
  const theme = readEnum(source.theme, THEMES, 'theme', at('theme'), errors, 'auto')

  // --- canvas --------------------------------------------------------------
  const canvas = { ...CANVAS_DEFAULTS }
  if (source.canvas !== undefined) {
    if (!isPlainObject(source.canvas)) {
      push(errors, at('canvas'), 'canvas', 'canvas must be a mapping of layout spacing values.', 'canvas:\n  rankSpacing: 64\n  nodeSpacing: 40')
    } else {
      noteUnknownFields(source.canvas, CANVAS_FIELDS, 'canvas', warnings)
      canvas.grid = readNumber(source.canvas.grid, 'canvas.grid', lineOf(source.canvas, 'grid'), errors, { min: 1, max: 64, def: 8 })
      canvas.rankSpacing = readNumber(source.canvas.rankSpacing, 'canvas.rankSpacing', lineOf(source.canvas, 'rankSpacing'), errors, { min: 8, max: 512, def: 64 })
      canvas.nodeSpacing = readNumber(source.canvas.nodeSpacing, 'canvas.nodeSpacing', lineOf(source.canvas, 'nodeSpacing'), errors, { min: 8, max: 512, def: 40 })
      canvas.padding = readNumber(source.canvas.padding, 'canvas.padding', lineOf(source.canvas, 'padding'), errors, { min: 0, max: 256, def: 24 })
    }
  }

  // --- defaults ------------------------------------------------------------
  const defaults = { ...NODE_DEFAULTS }
  if (source.defaults !== undefined) {
    if (!isPlainObject(source.defaults)) {
      push(errors, at('defaults'), 'defaults', 'defaults must be a mapping of node style fields.', 'defaults:\n  shape: rounded')
    } else {
      noteUnknownFields(source.defaults, DEFAULTS_FIELDS, 'defaults', warnings)
      defaults.shape = readEnum(source.defaults.shape, SHAPES, 'defaults.shape', lineOf(source.defaults, 'shape'), errors, NODE_DEFAULTS.shape, { aliases: SHAPE_ALIASES })
      defaults.fill = readColor(source.defaults.fill, 'defaults.fill', lineOf(source.defaults, 'fill'), errors)
      defaults.stroke = readColor(source.defaults.stroke, 'defaults.stroke', lineOf(source.defaults, 'stroke'), errors)
      defaults.strokeWidth = readNumber(source.defaults.strokeWidth, 'defaults.strokeWidth', lineOf(source.defaults, 'strokeWidth'), errors, { min: 0, max: 12, def: 1.5 })
      defaults.color = readColor(source.defaults.color, 'defaults.color', lineOf(source.defaults, 'color'), errors)
      defaults.fontSize = readNumber(source.defaults.fontSize, 'defaults.fontSize', lineOf(source.defaults, 'fontSize'), errors, { min: 8, max: 48, def: 13 })
      defaults.align = readEnum(source.defaults.align, ALIGNS, 'defaults.align', lineOf(source.defaults, 'align'), errors, NODE_DEFAULTS.align)
      defaults.dashed = readBoolean(source.defaults.dashed, 'defaults.dashed', lineOf(source.defaults, 'dashed'), errors, false)
      defaults.bold = readBoolean(source.defaults.bold, 'defaults.bold', lineOf(source.defaults, 'bold'), errors, false)
      defaults.mono = readBoolean(source.defaults.mono, 'defaults.mono', lineOf(source.defaults, 'mono'), errors, false)
    }
  }

  // --- nodes ---------------------------------------------------------------
  const nodes = []
  source.nodes.forEach((node, index) => {
    if (!isPlainObject(node)) return
    const path = `nodes[${index}]`
    const nodeLine = lineOf(node)
    const key = (field) => lineOf(node, field)
    noteUnknownFields(node, NODE_FIELDS, path, warnings)
    const id = asText(node.id)
    if (id === null) return
    const stroke = readColor(node.stroke, `${path}.stroke`, key('stroke'), errors)
    let strokeWidth = readNumber(node.strokeWidth, `${path}.strokeWidth`, key('strokeWidth'), errors, { min: 0, max: 12, def: defaults.strokeWidth })
    if (stroke === 'none') strokeWidth = 0
    nodes.push({
      id,
      label: readLabel(node.label, `${path}.label`, key('label'), MAX_LABEL_CHARS, errors),
      shape: readEnum(node.shape, SHAPES, `${path}.shape`, key('shape'), errors, defaults.shape, { aliases: SHAPE_ALIASES }),
      fill: readColor(node.fill, `${path}.fill`, key('fill'), errors),
      stroke,
      strokeWidth,
      dashed: readBoolean(node.dashed, `${path}.dashed`, key('dashed'), errors, defaults.dashed),
      color: readColor(node.color, `${path}.color`, key('color'), errors),
      align: readEnum(node.align, ALIGNS, `${path}.align`, key('align'), errors, defaults.align),
      fontSize: readNumber(node.fontSize, `${path}.fontSize`, key('fontSize'), errors, { min: 8, max: 48, def: defaults.fontSize }),
      bold: readBoolean(node.bold, `${path}.bold`, key('bold'), errors, defaults.bold),
      mono: readBoolean(node.mono, `${path}.mono`, key('mono'), errors, defaults.mono),
      size: readPair(node.size, `${path}.size`, key('size'), errors, { min: 1, max: 4000 }),
      pos: readPair(node.pos, `${path}.pos`, key('pos'), errors, { min: -10000, max: 10000 }),
    })
  })

  // --- edges ---------------------------------------------------------------
  const rawEdges = Array.isArray(source.edges) ? source.edges : []
  const edges = []
  rawEdges.forEach((edge, index) => {
    if (!isPlainObject(edge)) return
    const path = `edges[${index}]`
    const key = (field) => lineOf(edge, field)
    noteUnknownFields(edge, EDGE_FIELDS, path, warnings)
    const from = asText(edge.from)
    const to = asText(edge.to)
    if (from === null || to === null) return
    edges.push({
      from,
      to,
      label: readLabel(edge.label, `${path}.label`, key('label'), MAX_LABEL_CHARS, errors),
      arrow: readEnum(edge.arrow, ARROWS, `${path}.arrow`, key('arrow'), errors, EDGE_DEFAULTS.arrow, { aliases: ARROW_ALIASES }),
      arrowShape: readEnum(edge.arrowShape, ARROW_SHAPES, `${path}.arrowShape`, key('arrowShape'), errors, EDGE_DEFAULTS.arrowShape),
      style: readEnum(edge.style, STYLES, `${path}.style`, key('style'), errors, EDGE_DEFAULTS.style, { aliases: STYLE_ALIASES }),
      color: readColor(edge.color, `${path}.color`, key('color'), errors),
      width: readNumber(edge.width, `${path}.width`, key('width'), errors, { min: 0, max: 12, def: EDGE_DEFAULTS.width }),
      route: readEnum(edge.route, ROUTES, `${path}.route`, key('route'), errors, EDGE_DEFAULTS.route, { aliases: ROUTE_ALIASES }),
      routeExplicit: edge.route !== undefined,
      fromSide: readEnum(edge.fromSide, SIDES, `${path}.fromSide`, key('fromSide'), errors, EDGE_DEFAULTS.fromSide),
      toSide: readEnum(edge.toSide, SIDES, `${path}.toSide`, key('toSide'), errors, EDGE_DEFAULTS.toSide),
      dashArray: readPair(edge.dashArray, `${path}.dashArray`, key('dashArray'), errors, { min: 0, max: 64 }),
    })
  })

  // --- layer 3: graph semantics -------------------------------------------
  const known = new Set(nodes.map((node) => node.id))
  edges.forEach((edge, index) => {
    const missing = [edge.from, edge.to].filter((id) => !known.has(id))
    if (missing.length > 0) {
      push(
        errors,
        lineOf(rawEdges[index]),
        `edges[${index}]`,
        `Edge refers to ${missing.map((id) => `"${id}"`).join(' and ')}, which no node defines.`,
        'Every from and to must match a node id.',
      )
    }
  })
  if (errors.length > 0) return { ok: false, errors }

  if (edges.length > 0) {
    const touched = new Set()
    for (const edge of edges) {
      touched.add(edge.from)
      touched.add(edge.to)
    }
    const isolated = nodes.filter((node) => !touched.has(node.id)).map((node) => node.id)
    if (isolated.length > 0) {
      warnings.push(`${isolated.length} node${isolated.length > 1 ? 's are' : ' is'} not connected to any edge: ${isolated.join(', ')}.`)
    }
  }
  edges.forEach((edge, index) => {
    if (edge.from === edge.to) warnings.push(`edges[${index}] connects "${edge.from}" to itself.`)
  })

  const cycles = findCycles(nodes, edges)
  for (const cycle of cycles) {
    for (const index of cycle.edges) {
      const edge = edges[index]
      if (edge.routeExplicit) continue
      edge.route = 'curve'
      warnings.push(`edges[${index}] (${edge.from} → ${edge.to}) closes a cycle (${cycle.path}); its route was set to curve.`)
    }
  }

  // --- groups --------------------------------------------------------------
  const groups = []
  if (source.groups !== undefined) {
    if (!Array.isArray(source.groups)) {
      push(errors, at('groups'), 'groups', 'groups must be a list of group objects.', 'groups:\n  - id: ci\n    members: [build, gate]')
    } else {
      if (source.groups.length > MAX_GROUPS) {
        warnings.push(`${source.groups.length} groups exceed the ${MAX_GROUPS} limit; the last ${source.groups.length - MAX_GROUPS} were dropped.`)
      }
      const seen = new Set()
      source.groups.slice(0, MAX_GROUPS).forEach((group, index) => {
        const path = `groups[${index}]`
        if (!isPlainObject(group)) {
          push(errors, lineOf(group), path, 'Each group needs an id and a members list.', '- id: ci\n    members: [build, gate]')
          return
        }
        const key = (field) => lineOf(group, field)
        noteUnknownFields(group, GROUP_FIELDS, path, warnings)
        const id = asText(group.id)
        if (id === null || id === '') {
          push(errors, key('id'), `${path}.id`, 'A group needs an id.', 'Give every group a short unique id.')
          return
        }
        if (seen.has(id)) {
          push(errors, key('id'), `${path}.id`, `Group id "${id}" is used more than once.`, 'Group ids must be unique.')
          return
        }
        seen.add(id)
        if (!Array.isArray(group.members) || group.members.length === 0) {
          push(errors, key('members'), `${path}.members`, 'A group needs at least one member node id.', 'members: [build, gate]')
          return
        }
        const members = group.members.map(asText)
        const missing = members.filter((member) => member === null || !known.has(member))
        if (missing.length > 0) {
          push(
            errors,
            key('members'),
            `${path}.members`,
            `Unknown node id${missing.length > 1 ? 's' : ''} ${missing.map((m) => `"${String(m)}"`).join(', ')} in members.`,
            'Every member must match a node id.',
          )
          return
        }
        groups.push({
          id,
          label: readLabel(group.label, `${path}.label`, key('label'), MAX_LABEL_CHARS, errors),
          members,
          fill: readColor(group.fill, `${path}.fill`, key('fill'), errors),
          stroke: readColor(group.stroke, `${path}.stroke`, key('stroke'), errors),
          style: readEnum(group.style, STYLES, `${path}.style`, key('style'), errors, 'solid', { aliases: STYLE_ALIASES }),
        })
      })
    }
  }

  // --- legend --------------------------------------------------------------
  const legend = []
  if (source.legend !== undefined) {
    if (!Array.isArray(source.legend)) {
      push(errors, at('legend'), 'legend', 'legend must be a list of { shape, label } items.', 'legend:\n  - { shape: diamond, label: 判断 }')
    } else {
      if (source.legend.length > MAX_LEGEND) {
        warnings.push(`${source.legend.length} legend items exceed the ${MAX_LEGEND} limit; the last ${source.legend.length - MAX_LEGEND} were dropped.`)
      }
      source.legend.slice(0, MAX_LEGEND).forEach((item, index) => {
        const path = `legend[${index}]`
        if (!isPlainObject(item)) {
          push(errors, lineOf(item), path, 'Each legend item needs a shape and a label.', '- { shape: diamond, label: 判断 }')
          return
        }
        legend.push({
          shape: readEnum(item.shape, SHAPES, `${path}.shape`, lineOf(item, 'shape'), errors, 'rounded', { aliases: SHAPE_ALIASES }),
          label: readLabel(item.label, `${path}.label`, lineOf(item, 'label'), MAX_LABEL_CHARS, errors),
        })
      })
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  const idRaw = asText(source.id)
  const id = idRaw !== null && idRaw !== '' ? idRaw : (title !== '' ? title : 'flowchart')

  return {
    ok: true,
    doc: {
      version,
      id,
      title: title === '' ? undefined : title,
      direction,
      theme,
      canvas,
      nodes,
      edges: edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        label: edge.label,
        arrow: edge.arrow,
        arrowShape: edge.arrowShape,
        style: edge.style,
        color: edge.color,
        width: edge.width,
        route: edge.route,
        fromSide: edge.fromSide,
        toSide: edge.toSide,
        dashArray: edge.dashArray,
      })),
      groups,
      legend,
    },
    warnings,
  }
}

// ---------------------------------------------------------------------------
// Field readers
// ---------------------------------------------------------------------------

function push(errors, line, path, message, hint) {
  errors.push({ line: Number.isFinite(line) && line > 0 ? Math.trunc(line) : 1, path, message, hint })
}

/** Nearest candidate by edit distance, for the "did you mean" hint. */
function nearest(value, candidates, aliases) {
  const target = String(value).toLowerCase().trim()
  if (aliases && aliases[target] && candidates.includes(aliases[target])) return aliases[target]
  let best = null
  let bestCost = Infinity
  for (const candidate of candidates) {
    const cost = editDistance(target, candidate.toLowerCase())
    if (cost < bestCost) {
      bestCost = cost
      best = candidate
    }
  }
  return bestCost <= 2 ? best : null
}

function editDistance(a, b) {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

/** Report fields nobody defined, naming the closest real one when it is close. */
function noteUnknownFields(item, allowed, path, warnings) {
  if (!isPlainObject(item)) return
  for (const key of Object.keys(item)) {
    if (key.startsWith('__') || allowed.includes(key)) continue
    const guess = nearest(key, allowed)
    warnings.push(`${path ? `${path}.` : ''}${key}: unknown field${guess ? ` — did you mean "${guess}"?` : ''}. It was ignored.`)
  }
}

function readColor(value, path, line, errors) {
  if (value === undefined) return 'auto'
  if (value === null) return 'auto'
  if (typeof value === 'boolean') return value ? 'auto' : 'none'
  const raw = asText(value)
  if (raw === null) {
    push(errors, line, path, `${path.split('.').pop()} must be a color.`, 'Use auto, none, "#4f7cff", or a CSS color name.')
    return 'auto'
  }
  const lower = raw.trim().toLowerCase()
  if (lower === 'auto' || lower === 'none') return lower
  if (/^#[0-9a-f]{3}$/.test(lower)) return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
  if (/^#[0-9a-f]{6}$/.test(lower) || /^#[0-9a-f]{8}$/.test(lower)) return lower
  if (/^[a-z]+$/.test(lower) && CSS_COLORS.has(lower)) return lower
  const guess = lower.length <= 12 ? nearest(lower.replace(/[^a-z]/g, ''), [...CSS_COLORS]) : null
  push(
    errors,
    line,
    path,
    `${path.split('.').pop()} "${raw}" is not a color.`,
    guess ? `Did you mean "${guess}"?` : 'Use auto, none, "#rgb", "#rrggbb", or a CSS color name like steelblue.',
  )
  return 'auto'
}

function readNumber(value, path, line, errors, { min, max, def }) {
  const name = path.split('.').pop()
  if (value === undefined) return def
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    push(errors, line, path, `${name} must be a number between ${min} and ${max}.`, `Use a plain number, for example ${def}.`)
    return def
  }
  if (value < min || value > max) {
    push(errors, line, path, `${name} is ${value}, outside ${min} to ${max}.`, `Clamp it to ${min} to ${max}.`)
    return Math.min(max, Math.max(min, value))
  }
  return value
}

function readEnum(value, candidates, path, line, errors, def, { caseInsensitive = false, aliases = null } = {}) {
  const name = path.split('.').pop()
  if (value === undefined) return def
  const raw = asText(value)
  if (raw === null) {
    push(errors, line, path, `${name} must be one of ${candidates.join(', ')}.`, `Use ${def}.`)
    return def
  }
  const lower = raw.trim().toLowerCase()
  const exact = candidates.find((candidate) => (caseInsensitive ? candidate.toLowerCase() === lower : candidate === lower))
  if (exact) return exact
  const guess = nearest(lower, candidates, aliases)
  push(
    errors,
    line,
    path,
    `${name} "${raw}" is not one of ${candidates.join(', ')}.`,
    guess ? `Did you mean "${guess}"?` : `Use ${def}.`,
  )
  return def
}

function readBoolean(value, path, line, errors, def) {
  const name = path.split('.').pop()
  if (value === undefined) return def
  if (typeof value === 'boolean') return value
  push(errors, line, path, `${name} must be true or false.`, `Use ${def}.`)
  return def
}

function readPair(value, path, line, errors, { min, max }) {
  const name = path.split('.').pop()
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length !== 2) {
    push(errors, line, path, `${name} must be a list of two numbers.`, 'Write it as [160, 80].')
    return null
  }
  let ok = true
  const out = value.map((item) => {
    if (typeof item !== 'number' || !Number.isFinite(item)) {
      push(errors, line, path, `${name} must be two plain numbers.`, 'Write it as [160, 80].')
      ok = false
      return 0
    }
    if (item < min || item > max) {
      push(errors, line, path, `${name} is ${item}, outside ${min} to ${max}.`, `Clamp it to ${min} to ${max}.`)
      return Math.min(max, Math.max(min, item))
    }
    return item
  })
  return ok ? out : null
}

function readLabel(value, path, line, maxChars, errors) {
  const name = path.split('.').pop()
  if (value === undefined) return ''
  const raw = asText(value)
  if (raw === null) {
    push(errors, line, path, `${name} must be text.`, 'Write the label as a plain string.')
    return ''
  }
  const label = raw.replace(/\r\n?/g, '\n')
  if (label.length > maxChars) {
    push(
      errors,
      line,
      path,
      `${name} is ${label.length} characters, over the ${maxChars} limit.`,
      'Shorten the label; put the long explanation in the reply text.',
    )
    return label.slice(0, maxChars)
  }
  return label
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/**
 * Every cycle the document contains, found by a deterministic DFS in document
 * order. The edge that closes a cycle is the one whose target is still on the
 * current path.
 * @returns {Array<{ edges: number[], path: string }>}
 */
function findCycles(nodes, edges) {
  const outgoing = new Map()
  for (const node of nodes) outgoing.set(node.id, [])
  edges.forEach((edge, index) => {
    const list = outgoing.get(edge.from)
    if (list) list.push(index)
  })

  const cycles = []
  const seenCycleKeys = new Set()
  const done = new Set()

  for (const root of nodes) {
    if (done.has(root.id)) continue
    const onPath = new Set([root.id])
    const path = [root.id]
    const edgePath = []
    const stack = [{ id: root.id, cursor: 0 }]
    done.add(root.id)

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const list = outgoing.get(frame.id) || []
      if (frame.cursor >= list.length) {
        stack.pop()
        onPath.delete(frame.id)
        path.pop()
        edgePath.pop()
        continue
      }
      const index = list[frame.cursor]
      frame.cursor += 1
      const target = edges[index].to
      if (onPath.has(target)) {
        const start = path.indexOf(target)
        const key = path.slice(start).join('>')
        if (!seenCycleKeys.has(key)) {
          seenCycleKeys.add(key)
          cycles.push({
            edges: [index],
            path: `${path.slice(start).join(' → ')} → ${target}`,
          })
        }
        continue
      }
      if (done.has(target)) continue
      done.add(target)
      onPath.add(target)
      path.push(target)
      edgePath.push(index)
      stack.push({ id: target, cursor: 0 })
    }
  }
  return cycles
}
