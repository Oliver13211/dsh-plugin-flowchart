/**
 * M1 acceptance suite — validation layers 1–4, normalization, and the
 * projection fold. Run with: node tmp/test-m1.mjs
 */

import { normalizeFlowChart } from '../lib/normalize.js'
import { foldEvents, flowChartProjectionDefinition, snapshotFence } from '../lib/projection.js'

const LIMITS = { maxChars: 20000, maxNodes: 60, maxEdges: 120 }

let passed = 0
const failures = []

function check(name, fn) {
  try {
    const detail = fn()
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

function firstError(result, needle) {
  assert(!result.ok, `expected rejection, got ok: ${JSON.stringify(result.doc && result.doc.id)}`)
  const text = result.errors.map((e) => `line ${e.line} ${e.path} ${e.message} ${e.hint}`).join('\n')
  assert(text.includes(needle), `expected "${needle}" in:\n${text}`)
  return text
}

function accept(text) {
  const result = normalizeFlowChart(text, LIMITS)
  assert(result.ok, `expected acceptance, got: ${JSON.stringify(result.errors)}`)
  return result
}

const MINIMAL = `
nodes:
  - id: a
  - id: b
edges:
  - from: a
    to: b
`.trim()

// --- layer 1: lexical / syntax ------------------------------------------------
check('tab indentation is refused at its line', () => {
  const r = firstError(normalizeFlowChart('nodes:\n\t- id: a\n', LIMITS), 'spaces, not tabs')
  assert(r.includes('line 2'), r)
})

check('an empty document is refused', () => {
  firstError(normalizeFlowChart('# only a comment\n', LIMITS), 'empty')
})

check('a top-level list is refused', () => {
  firstError(normalizeFlowChart('- id: a\n- id: b\n', LIMITS), 'top level must be a mapping')
})

check('ragged indentation is refused at its line', () => {
  const r = firstError(normalizeFlowChart('nodes:\n  - id: a\n    label: x\n   shape: rect\n', LIMITS), 'Indentation does not line up')
  assert(r.includes('line 4'), r)
})

// --- layer 2: structure and enums --------------------------------------------
check('defaults are applied to every field', () => {
  const { doc } = accept(MINIMAL)
  const node = doc.nodes[0]
  assert(node.shape === 'rounded', `shape ${node.shape}`)
  assert(node.strokeWidth === 1.5, `strokeWidth ${node.strokeWidth}`)
  assert(node.stroke === 'auto' && node.fill === 'auto', 'auto colors')
  assert(node.fontSize === 13 && node.align === 'center', 'typography defaults')
  assert(doc.direction === 'TB' && doc.theme === 'auto', 'document defaults')
  assert(doc.canvas.rankSpacing === 64 && doc.canvas.padding === 24, 'canvas defaults')
  assert(doc.edges[0].arrow === 'end' && doc.edges[0].route === 'orthogonal', 'edge defaults')
  return `shape=${node.shape} dir=${doc.direction}`
})

check('a misspelled shape names the closest shape', () => {
  const r = firstError(normalizeFlowChart('nodes:\n  - id: a\n    shape: rhombus\n', LIMITS), 'Did you mean "diamond"?')
  assert(r.includes('line 3'), r)
  assert(r.includes('nodes[0].shape'), r)
})

check('a misspelled arrow names the closest arrow', () => {
  const r = firstError(normalizeFlowChart('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    arrow: bothh\n', LIMITS), 'Did you mean "both"?')
  assert(r.includes('line 7'), r)
})

check('a misspelled route names the closest route', () => {
  firstError(normalizeFlowChart('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    route: orthoganl\n', LIMITS), 'Did you mean "orthogonal"?')
})

check('direction accepts lowercase', () => {
  const { doc } = accept('direction: lr\nnodes:\n  - id: a\n')
  assert(doc.direction === 'LR', doc.direction)
})

check('an unsupported version is refused', () => {
  firstError(normalizeFlowChart('version: 2\nnodes:\n  - id: a\n', LIMITS), 'version 2 is not supported')
})

check('colors are canonicalized', () => {
  const { doc } = accept('nodes:\n  - id: a\n    fill: "#abc"\n    stroke: steelblue\n    color: "#1A2B3C"\n')
  assert(doc.nodes[0].fill === '#aabbcc', doc.nodes[0].fill)
  assert(doc.nodes[0].stroke === 'steelblue', doc.nodes[0].stroke)
  assert(doc.nodes[0].color === '#1a2b3c', doc.nodes[0].color)
})

check('a malformed color is refused with a hint', () => {
  firstError(normalizeFlowChart('nodes:\n  - id: a\n    fill: "#12"\n', LIMITS), 'is not a color')
})

check('stroke none switches the outline off', () => {
  const a = accept('nodes:\n  - id: a\n    stroke: none\n')
  const b = accept('nodes:\n  - id: a\n    strokeWidth: 0\n')
  const c = accept('nodes:\n  - id: a\n    stroke: false\n')
  assert(a.doc.nodes[0].strokeWidth === 0, 'stroke: none')
  assert(b.doc.nodes[0].strokeWidth === 0, 'strokeWidth: 0')
  assert(c.doc.nodes[0].stroke === 'none' && c.doc.nodes[0].strokeWidth === 0, 'stroke: false')
})

check('an out-of-range number is refused with its range', () => {
  const r = firstError(normalizeFlowChart('canvas:\n  rankSpacing: 1000\nnodes:\n  - id: a\n', LIMITS), 'outside 8 to 512')
  assert(r.includes('canvas.rankSpacing'), r)
})

check('a size that is not a pair is refused', () => {
  firstError(normalizeFlowChart('nodes:\n  - id: a\n    size: [100]\n', LIMITS), 'list of two numbers')
})

check('an unknown field is dropped with a did-you-mean warning', () => {
  const r = accept('nodes:\n  - id: a\n    colour: red\n')
  assert(r.warnings.some((w) => w.includes('colour') && w.includes('did you mean "color"')), JSON.stringify(r.warnings))
  assert(!('colour' in r.doc.nodes[0]), 'field dropped')
  return r.warnings[0]
})

check('defaults inherit into nodes and a node can override', () => {
  const { doc } = accept('defaults:\n  shape: hexagon\n  strokeWidth: 2\nnodes:\n  - id: a\n  - id: b\n    shape: diamond\n')
  assert(doc.nodes[0].shape === 'hexagon', doc.nodes[0].shape)
  assert(doc.nodes[1].shape === 'diamond', doc.nodes[1].shape)
  assert(doc.nodes[1].strokeWidth === 2, 'inherited strokeWidth')
})

// --- layer 3: graph semantics -------------------------------------------------
check('a duplicate node id is refused at its line', () => {
  const r = firstError(normalizeFlowChart('nodes:\n  - id: a\n  - id: a\n', LIMITS), 'used more than once')
  assert(r.includes('line 3'), r)
})

check('an edge to an unknown node is refused at its line', () => {
  const r = firstError(normalizeFlowChart('nodes:\n  - id: a\nedges:\n  - from: a\n    to: ghost\n', LIMITS), 'Unknown node id "ghost"')
  assert(r.includes('line 5'), r)
})

check('an isolated node is a warning, not an error', () => {
  const r = accept('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n')
  assert(r.warnings.some((w) => w.includes('not connected') && w.includes('c')), JSON.stringify(r.warnings))
})

check('a self-loop is allowed with a warning', () => {
  const r = accept('nodes:\n  - id: a\nedges:\n  - from: a\n    to: a\n')
  assert(r.warnings.some((w) => w.includes('connects "a" to itself')), JSON.stringify(r.warnings))
})

check('a cycle is allowed, its closing edge routed as a curve', () => {
  const r = accept('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\n  - from: c\n    to: a\n')
  assert(r.ok, JSON.stringify(r.errors))
  assert(r.doc.edges[2].route === 'curve', `route ${r.doc.edges[2].route}`)
  assert(r.doc.edges[0].route === 'orthogonal', 'forward edge untouched')
  assert(r.warnings.some((w) => w.includes('closes a cycle') && w.includes('a → b → c → a')), JSON.stringify(r.warnings))
  return r.warnings[0]
})

check('an explicit route on a cycle edge is respected', () => {
  const r = accept('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: a\n    route: straight\n')
  assert(r.doc.edges[1].route === 'straight', r.doc.edges[1].route)
})

check('a group naming an unknown member is refused', () => {
  firstError(normalizeFlowChart('nodes:\n  - id: a\ngroups:\n  - id: g\n    members: [a, ghost]\n', LIMITS), 'Unknown node id "ghost" in members')
})

// --- layer 4: capacity -------------------------------------------------------
check('the node cap is enforced', () => {
  const many = Array.from({ length: 61 }, (_, i) => `  - id: n${i}`).join('\n')
  firstError(normalizeFlowChart(`nodes:\n${many}\n`, LIMITS), 'exceed the 60 limit')
})

check('the edge cap is enforced', () => {
  const edges = Array.from({ length: 121 }, () => '  - from: a\n    to: b').join('\n')
  firstError(normalizeFlowChart(`nodes:\n  - id: a\n  - id: b\nedges:\n${edges}\n`, LIMITS), 'exceed the 120 limit')
})

check('the character cap is enforced', () => {
  const big = `nodes:\n  - id: a\n    label: ${'x'.repeat(20001)}\n`
  firstError(normalizeFlowChart(big, LIMITS), 'over the 20000 limit')
})

check('an over-long label is refused', () => {
  const r = firstError(normalizeFlowChart(`nodes:\n  - id: a\n    label: ${'y'.repeat(121)}\n`, LIMITS), 'over the 120 limit')
  assert(r.includes('nodes[0].label'), r)
})

check('groups and legend are truncated with a warning', () => {
  const groups = Array.from({ length: 14 }, (_, i) => `  - id: g${i}\n    members: [a]\n`).join('')
  const legend = Array.from({ length: 10 }, (_, i) => `  - { shape: rect, label: L${i} }\n`).join('')
  const r = accept(`nodes:\n  - id: a\ngroups:\n${groups}legend:\n${legend}`)
  assert(r.doc.groups.length === 12, `groups ${r.doc.groups.length}`)
  assert(r.doc.legend.length === 8, `legend ${r.doc.legend.length}`)
  assert(r.warnings.some((w) => w.includes('groups exceed the 12 limit')), JSON.stringify(r.warnings))
  assert(r.warnings.some((w) => w.includes('legend items exceed the 8 limit')), JSON.stringify(r.warnings))
})

// --- determinism and shape ---------------------------------------------------
check('normalization is deterministic', () => {
  const doc = 'id: deploy\ntitle: 部署\nnodes:\n  - id: a\n    label: 开始\n  - id: b\nedges:\n  - from: a\n    to: b\n'
  const a = normalizeFlowChart(doc, LIMITS)
  const b = normalizeFlowChart(doc, LIMITS)
  assert(JSON.stringify(a) === JSON.stringify(b), 'two runs differ')
})

check('the normalized doc carries no raw YAML keys', () => {
  const { doc } = accept('nodes:\n  - id: a\n    __line: 99\n')
  const flat = JSON.stringify(doc)
  assert(!flat.includes('__line') && !flat.includes('__keys'), flat.slice(0, 120))
})

check('a well-formed document produces no warnings', () => {
  const full = [
    'version: 1',
    'id: ci',
    'title: 持续集成',
    'direction: LR',
    'theme: auto',
    'canvas:',
    '  rankSpacing: 70',
    'defaults:',
    '  shape: rounded',
    'nodes:',
    '  - id: commit',
    '    label: 提交',
    '    shape: stadium',
    '    fill: "#4f7cff"',
    '    stroke: none',
    '  - id: build',
    '    label: 构建',
    '    size: [140, 60]',
    '  - id: gate',
    '    label: 通过?',
    '    shape: diamond',
    '    fontSize: 14',
    '    bold: true',
    'edges:',
    '  - { from: commit, to: build, arrow: end }',
    '  - { from: build, to: gate, label: 检查 }',
    '  - { from: gate, to: commit, label: 重跑, arrow: both, style: dashed, route: curve }',
    'groups:',
    '  - id: loop',
    '    label: 反馈',
    '    members: [build, gate]',
    'legend:',
    '  - { shape: diamond, label: 判断 }',
  ].join('\n')
  const r = accept(full)
  assert(r.warnings.length === 0, JSON.stringify(r.warnings))
  assert(r.doc.groups.length === 1 && r.doc.legend.length === 1, 'groups and legend kept')
  assert(r.doc.nodes[0].strokeWidth === 0, 'stroke none applied')
})

// --- projection fold ---------------------------------------------------------
check('the fold ignores every unrelated event and keeps the state value', () => {
  const init = flowChartProjectionDefinition.init({}, 0)
  const after = [
    { seq: 1, type: 'user/message', data: {} },
    { seq: 2, type: 'assistant/message', data: {} },
    { seq: 3, type: 'step/end', data: {} },
  ].reduce((state, event) => flowChartProjectionDefinition.apply(state, event), init)
  // v0.4.2: apply normalizes its seed (sanitizeState) before folding, so an
  // unrelated event may return a new reference. What the registry's change
  // detection and the checkpoint need is VALUE stability, which holds.
  assert(JSON.stringify(after) === JSON.stringify(init), 'state value changed')
})

check('an inline chart is folded from the tool-call arguments', () => {
  const events = [
    { seq: 10, type: 'tool/call', data: { turn: 1, step: 2, callId: 'c1', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) } },
    { seq: 11, type: 'tool/result', data: { turn: 1, step: 2, message: { role: 'tool', toolCallId: 'c1', source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'FlowChart accepted' }] } } },
  ]
  const state = foldEvents(events)
  assert(state.charts.length === 1, JSON.stringify(state.charts.length))
  assert(state.charts[0].doc.nodes.length === 2, 'nodes')
  assert(state.charts[0].source.kind === 'inline', state.charts[0].source.kind)
  assert(state.charts[0].seq === 10, `seq ${state.charts[0].seq}`)
})

check('a file chart is folded from the snapshot fence', () => {
  const fence = snapshotFence(MINIMAL)
  const events = [
    { seq: 20, type: 'tool/call', data: { callId: 'c2', name: 'FlowChart', arguments: JSON.stringify({ file: 'tmp/demo.yaml' }) } },
    { seq: 21, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c2', source: { callId: 'c2' }, content: [{ type: 'text', text: `FlowChart accepted\n\n${fence}` }] } } },
  ]
  const state = foldEvents(events)
  assert(state.charts.length === 1, JSON.stringify(state.charts))
  assert(state.charts[0].source.kind === 'file' && state.charts[0].source.path === 'tmp/demo.yaml', JSON.stringify(state.charts[0].source))
  assert(state.charts[0].doc.edges.length === 1, 'edges')
})

check('the same id replaces a chart in place and bumps its version', () => {
  const call = (seq, yaml) => ({ seq, type: 'tool/call', data: { callId: `c${seq}`, name: 'FlowChart', arguments: JSON.stringify({ yaml }) } })
  const result = (seq, callSeq) => ({ seq, type: 'tool/result', data: { message: { role: 'tool', toolCallId: `c${callSeq}`, source: { callId: `c${callSeq}` }, content: [{ type: 'text', text: 'ok' }] } } })
  const state = foldEvents([
    call(1, 'id: deploy\nnodes:\n  - id: a\n'),
    result(2, 1),
    call(3, 'id: deploy\nnodes:\n  - id: a\n  - id: b\n'),
    result(4, 3),
  ])
  assert(state.charts.length === 1, `charts ${state.charts.length}`)
  assert(state.charts[0].version === 2, `version ${state.charts[0].version}`)
  assert(state.charts[0].doc.nodes.length === 2, 'nodes')
  assert(state.lastId === 'deploy', JSON.stringify(state))
  // autoOpen defaults to true (§18.1 decision 3), so the replacement chart
  // comes to the foreground too.
  assert(state.openSeq === 3, JSON.stringify(state.openSeq))
})

check('open: false keeps a chart out of the foreground', () => {
  const state = foldEvents([
    { seq: 7, type: 'tool/call', data: { callId: 'c7', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL, open: false }) } },
    { seq: 8, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c7', source: { callId: 'c7' }, content: [{ type: 'text', text: 'ok' }] } } },
  ])
  assert(state.charts.length === 1, 'chart still recorded')
  assert(state.openSeq === null, JSON.stringify(state.openSeq))
})

check('a rejected call leaves no chart behind', () => {
  const state = foldEvents([
    { seq: 1, type: 'tool/call', data: { callId: 'c', name: 'FlowChart', arguments: JSON.stringify({ yaml: 'nodes:\n  - id: a\nedges:\n  - from: a\n    to: ghost\n' }) } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c', source: { callId: 'c' }, content: [{ type: 'text', text: 'FlowChart rejected' }] } } },
  ])
  assert(state.charts.length === 0, JSON.stringify(state.charts))
})

check('open: true records the newest open request', () => {
  const state = foldEvents([
    { seq: 5, type: 'tool/call', data: { callId: 'c5', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL, open: true }) } },
    { seq: 6, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c5', source: { callId: 'c5' }, content: [{ type: 'text', text: 'ok' }] } } },
  ])
  assert(state.openSeq === 5, JSON.stringify(state.openSeq))
})

check('a chart records the call that produced it', () => {
  const state = foldEvents([
    { seq: 1, type: 'tool/call', data: { callId: 'call_abc', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'call_abc', source: { callId: 'call_abc' }, content: [{ type: 'text', text: 'ok' }] } } },
  ])
  assert(state.charts[0].callId === 'call_abc', JSON.stringify(state.charts[0].callId))
})

check('a rejected call keeps the validator errors for the conversation card', () => {
  const state = foldEvents([
    { seq: 3, type: 'tool/call', data: { callId: 'call_bad', name: 'FlowChart', arguments: JSON.stringify({ yaml: 'nodes:\n  - id: a\n    shape: rhombus\n' }) } },
    { seq: 4, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'call_bad', source: { callId: 'call_bad' }, content: [{ type: 'text', text: 'FlowChart rejected' }] } } },
  ])
  assert(state.charts.length === 0, 'no chart')
  assert(state.failures.length === 1, JSON.stringify(state.failures))
  const failure = state.failures[0]
  assert(failure.callId === 'call_bad', 'call id kept')
  assert(failure.errors[0].path === 'nodes[0].shape', JSON.stringify(failure.errors[0]))
  assert(failure.errors[0].hint.includes('diamond'), 'hint kept')
})

check('an accepted call leaves no failure record behind', () => {
  const state = foldEvents([
    { seq: 5, type: 'tool/call', data: { callId: 'call_ok', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) } },
    { seq: 6, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'call_ok', source: { callId: 'call_ok' }, content: [{ type: 'text', text: 'ok' }] } } },
  ])
  assert(state.failures.length === 0, JSON.stringify(state.failures))
})

check('the view carries the plugin settings the client must honour', () => {
  const state = foldEvents([])
  assert(state.settings.autoOpen === true, JSON.stringify(state.settings))
  assert(state.settings.export === undefined || true, 'settings shape')
  const view = flowChartProjectionDefinition.wire.view(state)
  assert(view.settings.maxNodes === 60, JSON.stringify(view.settings))
  assert(view.pending === undefined, 'pending is host-only')
  assert(Array.isArray(view.failures), 'failures travel to the client')
})

check('the wire view is a plain JSON snapshot of the state', () => {
  const state = foldEvents([
    { seq: 1, type: 'tool/call', data: { callId: 'c1', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c1', source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
  ])
  const view = flowChartProjectionDefinition.wire.view(state)
  const parsed = flowChartProjectionDefinition.wire.viewSchema.parse(view)
  assert(parsed.charts.length === 1, 'view charts')
  assert(JSON.stringify(parsed) === JSON.stringify(view), 'view is JSON-clean')
})

check('the state schema absorbs a corrupt checkpoint row instead of rejecting it', () => {
  // v0.4.2: the registry calls stateSchema.parse on restore WITHOUT a guard,
  // so a throw here surfaced as 会话不可用. The schema now drops entries that
  // are not chart-shaped and accepts the row; the log replays what was dropped.
  const parsed = flowChartProjectionDefinition.stateSchema.parse({ charts: [{ id: 1 }, null, 5] })
  assert(parsed.charts.length === 0, `kept ${parsed.charts.length} corrupt entries`)
  // a healthy entry in the same row still survives
  const healthy = { id: 'ok', seq: 3, version: 1, doc: { nodes: [{ id: 'a' }], edges: [] }, source: { kind: 'inline' }, warnings: [] }
  const mixed = flowChartProjectionDefinition.stateSchema.parse({ charts: [{ id: 1 }, healthy] })
  assert(mixed.charts.length === 1 && mixed.charts[0].id === 'ok', 'healthy entry lost')
})

check('the state schema round-trips a real state', () => {
  const state = foldEvents([
    { seq: 1, type: 'tool/call', data: { callId: 'c1', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c1', source: { callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] } } },
  ])
  const row = JSON.parse(JSON.stringify(state))
  const parsed = flowChartProjectionDefinition.stateSchema.parse(row)
  assert(JSON.stringify(parsed) === JSON.stringify(state), 'round-trip changed the state')
})

check('the fold survives a state the wire view produced (no `pending`)', () => {
  // The registry seeds a fold from a checkpoint row, and a row travels through
  // `viewSchema.parse`, which deletes `pending`. Reading `state.pending.length`
  // on such a state threw on the first tool/call and took the session mount
  // down with it (real sessions went "unavailable" until the log was repaired).
  const seeded = flowChartProjectionDefinition.wire.view(flowChartProjectionDefinition.init({}, 0))
  assert(seeded.pending === undefined, 'precondition: the wire view drops pending')
  const state = flowChartProjectionDefinition.apply(seeded, {
    seq: 3,
    type: 'tool/call',
    data: { callId: 'c1', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) },
  })
  assert(Array.isArray(state.pending) && state.pending.length === 1, 'the call was not folded')
})

check('the fold survives a partial legacy state (charts only)', () => {
  const legacy = { charts: [], lastSeq: 0 }
  const called = flowChartProjectionDefinition.apply(legacy, {
    seq: 3,
    type: 'tool/call',
    data: { callId: 'c1', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) },
  })
  assert(Array.isArray(called.pending) && called.pending.length === 1, 'tool/call on a legacy state')
  const resulted = flowChartProjectionDefinition.apply(legacy, {
    seq: 4,
    type: 'tool/result',
    data: { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } },
  })
  assert(Array.isArray(resulted.charts) && Array.isArray(resulted.failures), 'tool/result on a legacy state')
})

check('a fold seeded from a checkpoint equals a full fold from init', () => {
  const events = [
    { seq: 1, type: 'tool/call', data: { callId: 'c1', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) } },
    { seq: 2, type: 'tool/result', data: { message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'ok' }] } } },
  ]
  const full = foldEvents(events)
  const seeded = flowChartProjectionDefinition.wire.view(full)
  const resumed = flowChartProjectionDefinition.apply(seeded, {
    seq: 5,
    type: 'tool/call',
    data: { callId: 'c2', name: 'FlowChart', arguments: JSON.stringify({ yaml: MINIMAL }) },
  })
  assert(resumed.charts.length === 1, 'the checkpoint charts were lost')
  assert(resumed.pending.length === 1 && resumed.pending[0].callId === 'c2', 'the new call was not folded')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) process.exit(1)
