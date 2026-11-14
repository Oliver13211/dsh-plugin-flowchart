/**
 * M3 acceptance — the Host tool contract.
 *
 * The tool result crosses a JSON boundary the unit tests cannot see: the Host
 * rejects a value that is not lossless JSON (an explicit `undefined` anywhere
 * fails it, which is exactly how `snapshot: undefined` broke inline charts
 * live). These checks call the registered `execute` for every input path and
 * validate the result against the tool's own declared output schema.
 *
 * Run with: node test/tool-contract.test.mjs
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply as applyPlugin } from '../index.js'

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    const detail = await fn()
    passed += 1
    console.log(`  ok  ${name}${detail ? `  (${detail})` : ''}`)
  } catch (error) {
    failures.push(`${name}: ${error && error.message}`)
    console.log(`  FAIL ${name}: ${error && error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed')
}

/** Register the plugin against a fake host and hand back the tool definition. */
function registerTool() {
  let tool = null
  const projections = []
  const ctx = {
    tools: { register: (definition) => { tool = definition; return () => {} } },
    sessionProjections: { register: (definition) => { projections.push(definition); return () => {} } },
    workingDirectory: { ensure: async () => process.cwd() },
    effect: (fn) => { fn(); return () => {} },
  }
  const dispose = applyPlugin(ctx, {})
  assert(tool, 'the plugin registered no tool')
  return { tool, projections, dispose }
}

const exec = { agent: null, signal: undefined }

/** A minimal check of the declared output schema: types, required, enums. */
function validate(schema, value, path = '') {
  const problems = []
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      problems.push(`${path || 'value'} is not an object`)
      return problems
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${path}${key} is required`)
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in (schema.properties ?? {}))) problems.push(`${path}${key} is not declared`)
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in value) problems.push(...validate(sub, value[key], `${path}${key}.`))
    }
    return problems
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      problems.push(`${path} is not an array`)
      return problems
    }
    if (schema.items) value.forEach((item, index) => problems.push(...validate(schema.items, item, `${path}[${index}].`)))
    return problems
  }
  if (schema.type === 'string' && typeof value !== 'string') problems.push(`${path} is not a string`)
  if (schema.type === 'integer' && !Number.isInteger(value)) problems.push(`${path} is not an integer`)
  if (schema.type === 'boolean' && typeof value !== 'boolean') problems.push(`${path} is not a boolean`)
  return problems
}

const { tool, projections, dispose } = registerTool()
void dispose

const INLINE = 'id: inline\ntitle: 内联\nnodes:\n  - id: a\n    label: 开始\n  - id: b\n    label: 结束\nedges:\n  - from: a\n    to: b\n'

await check('the plugin registers the tool and the projection', () => {
  assert(tool.name === 'FlowChart', tool.name)
  assert(projections.length === 1, `projections ${projections.length}`)
  assert(projections[0].key === 'flowchart', projections[0].key)
  assert(projections[0].stateVersion === 2, `stateVersion ${projections[0].stateVersion}`)
  return `tool + projection v${projections[0].stateVersion}`
})

await check('an inline chart returns lossless JSON that satisfies the output schema', () => {
  return Promise.resolve(tool.execute({ yaml: INLINE }, exec)).then((value) => {
    // Lossless JSON: a JSON round-trip must be identical, which is what the
    // Host checks before it hands the result to the model.
    assert(JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value), 'not lossless JSON')
    const problems = validate(tool.output.schema, value)
    assert(problems.length === 0, problems.join('; '))
    assert(value.ok === true, 'not ok')
    assert(!('snapshot' in value), 'an inline chart must not carry a snapshot block')
    assert(value.source === 'inline', value.source)
    return `ok, ${value.nodes} nodes`
  })
})

await check('a file chart returns the snapshot block and stays lossless', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fc-tool-'))
  const file = join(directory, 'chart.yaml')
  writeFileSync(file, INLINE)
  const value = await tool.execute({ file }, exec)
  const problems = validate(tool.output.schema, value)
  assert(problems.length === 0, problems.join('; '))
  assert(typeof value.snapshot === 'string' && value.snapshot.includes('flowchart-snapshot'), 'no snapshot block')
  assert(JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value), 'not lossless JSON')
  assert(value.source === file, value.source)
  return 'snapshot present'
})

await check('a rejected document returns lossless JSON with located errors', async () => {
  const value = await tool.execute({ yaml: 'nodes:\n  - id: a\n    shape: rhombus\n' }, exec)
  const problems = validate(tool.output.schema, value)
  assert(problems.length === 0, problems.join('; '))
  assert(value.ok === false, 'should be rejected')
  assert(value.errors.length === 1, `errors ${value.errors.length}`)
  assert(value.errors[0].line === 3, `line ${value.errors[0].line}`)
  assert(value.errors[0].hint.includes('diamond'), value.errors[0].hint)
  assert(JSON.stringify(JSON.parse(JSON.stringify(value))) === JSON.stringify(value), 'not lossless JSON')
})

await check('a missing file returns the resolved absolute path', async () => {
  const value = await tool.execute({ file: 'does-not-exist.yaml' }, exec)
  const problems = validate(tool.output.schema, value)
  assert(problems.length === 0, problems.join('; '))
  assert(value.ok === false, 'should be rejected')
  assert(value.source.endsWith('does-not-exist.yaml'), value.source)
  assert(value.errors[0].message.includes('/'), `not an absolute path: ${value.errors[0].message}`)
  return value.errors[0].message.slice(0, 60)
})

await check('neither source given returns lossless JSON', async () => {
  const value = await tool.execute({}, exec)
  const problems = validate(tool.output.schema, value)
  assert(problems.length === 0, problems.join('; '))
  assert(value.ok === false && value.errors.length === 1, JSON.stringify(value))
})

await check('both sources given is refused', async () => {
  const value = await tool.execute({ yaml: INLINE, file: 'x.yaml' }, exec)
  assert(value.ok === false, JSON.stringify(value))
  assert(value.errors[0].message.includes('not both'), value.errors[0].message)
})

await check('a document with many problems still returns a bounded result', async () => {
  // Twelve dangling edges: the model gets the first ten plus a count, not a
  // wall of text that pushes its own reasoning out of the window.
  const edges = Array.from({ length: 12 }, (_, index) => `  - from: a\n    to: ghost${index}`).join('\n')
  const value = await tool.execute({ yaml: `nodes:\n  - id: a\nedges:\n${edges}\n` }, exec)
  assert(value.ok === false, 'should be rejected')
  assert(value.errors.length === 11, `errors ${value.errors.length}`)
  assert(value.errors[10].includes('2 more problems'), value.errors[10])
})

await check('many warnings are capped with a count', async () => {
  // Eight self-loops are eight separate warnings (isolated nodes, by contrast,
  // are reported as one aggregated line).
  const nodes = Array.from({ length: 8 }, (_, index) => `  - id: n${index}`).join('\n')
  const loops = Array.from({ length: 8 }, (_, index) => `  - from: n${index}\n    to: n${index}`).join('\n')
  const value = await tool.execute({ yaml: `nodes:\n${nodes}\nedges:\n${loops}\n` }, exec)
  assert(value.ok === true, 'should be accepted')
  // Five real lines plus one summary line, whatever the total happens to be
  // (a self-loop raises both a loop warning and a cycle warning).
  assert(value.warnings.length === 6, `warnings ${value.warnings.length}`)
  assert(/…and \d+ more warnings\./.test(value.warnings[5]), value.warnings[5])
})

await check('the rendered text carries the snapshot only for a file chart', async () => {
  const inline = await tool.execute({ yaml: INLINE }, exec)
  const rendered = tool.output.render({ yaml: INLINE }, inline).map((part) => part.text).join('\n')
  assert(!rendered.includes('flowchart-snapshot'), 'inline text leaked a snapshot')

  const directory = mkdtempSync(join(tmpdir(), 'fc-tool-'))
  const file = join(directory, 'chart.yaml')
  writeFileSync(file, INLINE)
  const fromFile = await tool.execute({ file }, exec)
  const renderedFile = tool.output.render({ file }, fromFile).map((part) => part.text).join('\n')
  assert(renderedFile.includes('flowchart-snapshot'), 'file text has no snapshot')
  assert(renderedFile.includes('```'), 'snapshot is not fenced')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) process.exit(1)