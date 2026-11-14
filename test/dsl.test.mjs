import { parseFlowChart, parseDsl } from '../lib/dsl.js'

const limits = { maxChars: 20000, maxNodes: 60, maxEdges: 120 }
let pass = 0
let fail = 0

function check(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`ok   ${name}`)
  } catch (error) {
    fail += 1
    console.log(`FAIL ${name}: ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const good = [
  'id: deploy',
  'title: 部署流程',
  'direction: TB',
  'nodes:',
  '  - id: start',
  '    label: 开始',
  '    shape: stadium',
  '    fill: "#4f7cff"',
  '    strokeWidth: 0',
  '  - id: build',
  '    label: "构建: npm run build"',
  '    shape: rounded',
  '  - id: ship',
  '    label: 发布',
  '    shape: hexagon',
  'edges:',
  '  - from: start',
  '    to: build',
  '    label: 触发',
  '    arrow: end',
  '    route: orthogonal',
  '  - from: build',
  '    to: ship',
  '    arrow: end',
  '    style: dashed',
  '    color: auto',
].join('\n')

check('parses a valid chart', () => {
  const result = parseFlowChart(good, limits)
  assert(result.ok === true, JSON.stringify(result))
  assert(result.id === 'deploy', 'id')
  assert(result.title === '部署流程', 'title')
  assert(result.nodes === 3, 'nodes')
  assert(result.edges === 2, 'edges')
  assert(result.warnings.length === 0, `warnings ${JSON.stringify(result.warnings)}`)
})

check('keeps nested node fields', () => {
  const doc = parseDsl(good)
  assert(doc.nodes[0].label === '开始', 'label')
  assert(doc.nodes[1].label === '构建: npm run build', `quoted colon label: ${doc.nodes[1].label}`)
  assert(doc.nodes[0].fill === '#4f7cff', 'fill quotes')
  assert(doc.nodes[0].strokeWidth === 0, 'strokeWidth number')
  assert(doc.edges[1].style === 'dashed', 'edge style')
})

check('accepts a list aligned with its key', () => {
  const doc = parseDsl(['nodes:', '- id: a', '- id: b'].join('\n'))
  assert(doc.nodes.length === 2, JSON.stringify(doc))
  assert(doc.nodes[1].id === 'b', 'second id')
})

check('accepts flow lists and comments', () => {
  const doc = parseDsl(['nodes:', '  - id: a', '    tags: [x, y, 3]  # inline comment'].join('\n'))
  assert(doc.nodes[0].tags.length === 3, JSON.stringify(doc.nodes[0]))
  assert(doc.nodes[0].tags[2] === 3, 'number in flow list')
})

check('reports unknown edge endpoints', () => {
  const result = parseFlowChart(['nodes:', '  - id: a', 'edges:', '  - from: a', '    to: missing'].join('\n'), limits)
  assert(result.ok === false, 'should fail')
  assert(result.errors.length === 1, JSON.stringify(result.errors))
  assert(/missing/.test(result.errors[0].message), result.errors[0].message)
})

check('reports duplicate ids', () => {
  const result = parseFlowChart(['nodes:', '  - id: a', '  - id: a'].join('\n'), limits)
  assert(result.ok === false, 'should fail')
  assert(/more than once/.test(result.errors[0].message), result.errors[0].message)
})

check('reports misaligned indentation with its line', () => {
  const result = parseFlowChart(['nodes:', '  - id: a', '   label: off'].join('\n'), limits)
  assert(result.ok === false, 'should fail')
  assert(result.errors[0].line === 3, `line ${result.errors[0].line}`)
})

check('reports tabs', () => {
  const result = parseFlowChart(['nodes:', '\t- id: a'].join('\n'), limits)
  assert(result.ok === false, 'should fail')
  assert(/tabs/.test(result.errors[0].message), result.errors[0].message)
})

check('reports unsupported block scalar', () => {
  const result = parseFlowChart(['nodes:', '  - id: a', '    label: |'].join('\n'), limits)
  assert(result.ok === false, 'should fail')
  assert(/Block scalars/.test(result.errors[0].message), result.errors[0].message)
})

check('reports empty document', () => {
  const result = parseFlowChart('# only a comment\n', limits)
  assert(result.ok === false, 'should fail')
  assert(result.errors[0].line === 1, 'line 1')
})

check('warns on unknown shape and direction', () => {
  const result = parseFlowChart(['direction: sideways', 'nodes:', '  - id: a', '    shape: blob'].join('\n'), limits)
  assert(result.ok === true, JSON.stringify(result))
  assert(result.warnings.length === 2, JSON.stringify(result.warnings))
})

check('enforces node and edge caps', () => {
  const many = ['nodes:']
  for (let i = 0; i < 61; i += 1) many.push(`  - id: n${i}`)
  assert(parseFlowChart(many.join('\n'), limits).ok === false, 'node cap')
  const edges = ['nodes:', '  - id: a', '  - id: b', 'edges:']
  for (let i = 0; i < 121; i += 1) edges.push('  - from: a', '    to: b')
  assert(parseFlowChart(edges.join('\n'), limits).ok === false, 'edge cap')
})

check('enforces the character cap', () => {
  const big = `nodes:\n  - id: a\n    label: ${'x'.repeat(20001)}`
  const result = parseFlowChart(big, limits)
  assert(result.ok === false, 'char cap')
  assert(/characters/.test(result.errors[0].message), result.errors[0].message)
})

check('handles a chart with no edges', () => {
  const result = parseFlowChart(['nodes:', '  - id: a', '  - id: b'].join('\n'), limits)
  assert(result.ok === true && result.edges === 0, JSON.stringify(result))
})

check('handles top-level indentation and CRLF', () => {
  const result = parseFlowChart('  nodes:\r\n    - id: a\r\n      label: ok\r\n', limits)
  assert(result.ok === true, JSON.stringify(result))
})

check('points structural errors at the document line', () => {
  const doc = [
    'id: broken',          // 1
    'title: 故意写错',      // 2
    'nodes:',              // 3
    '  - id: a',           // 4
    '    label: 甲',        // 5
    '  - id: a',           // 6
    '    label: 重复的甲',   // 7
    'edges:',              // 8
    '  - from: a',         // 9
    '    to: ghost',       // 10
  ].join('\n')
  const result = parseFlowChart(doc, limits)
  assert(result.ok === false, 'structural errors')
  const dup = result.errors.find((e) => e.path === 'nodes[1].id')
  const ghost = result.errors.find((e) => e.path === 'edges[0].to')
  assert(dup && dup.line === 6, `duplicate id line: ${dup && dup.line}`)
  assert(ghost && ghost.line === 10, `unknown to line: ${ghost && ghost.line}`)
})

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
