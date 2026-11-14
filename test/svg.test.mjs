/**
 * M2 acceptance — SVG renderer.
 *
 * Run with: node test/svg.test.mjs
 *
 * The suite also writes fixture SVGs to a temp directory so an outside XML
 * parser can confirm they are well-formed; a string comparison inside Node
 * cannot prove that.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { layoutDoc } from '../lib/layout.js'
import { normalizeFlowChart } from '../lib/normalize.js'
import { FONT_SANS, arrowElement, renderSvg, resolveColor, roundedPolylinePath, shapeElement } from '../lib/svg.js'

const LIMITS = { maxChars: 20000, maxNodes: 60, maxEdges: 120 }
const FIXTURES = process.env.FC_FIXTURE_DIR ?? join(tmpdir(), 'flowchart-m2')

let passed = 0
const failures = []
const written = []

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

function doc(yaml) {
  const result = normalizeFlowChart(yaml, LIMITS)
  assert(result.ok, `document rejected: ${JSON.stringify(result.errors)}`)
  return result.doc
}

/** Lay out and render one document, recording it as an XML fixture. */
function render(yaml, name, options = {}) {
  const document_ = doc(yaml)
  const geometry = layoutDoc(document_)
  const svg = renderSvg(document_, geometry, options)
  if (name) {
    mkdirSync(FIXTURES, { recursive: true })
    const path = join(FIXTURES, `${name}.svg`)
    writeFileSync(path, svg)
    written.push(path)
  }
  return { document_, geometry, svg }
}

const SHAPES = ['rect', 'rounded', 'stadium', 'ellipse', 'circle', 'diamond', 'hexagon', 'parallelogram', 'cylinder', 'document', 'cloud', 'triangle', 'star', 'note', 'subroutine']

// --- structure ---------------------------------------------------------------

check('the root element carries a viewBox and an accessible label', () => {
  const { svg, geometry } = render('id: t\ntitle: 标题\nnodes:\n  - id: a\n', 'basic')
  assert(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), svg.slice(0, 60))
  assert(svg.includes(`viewBox="${geometry.viewBox.x} ${geometry.viewBox.y} ${geometry.viewBox.width} ${geometry.viewBox.height}"`), 'viewBox matches the geometry')
  assert(svg.includes('role="img"') && svg.includes('aria-label="标题"'), 'accessible label')
  assert(svg.trimEnd().endsWith('</svg>'), 'closed root')
})

check('every one of the 15 shapes renders an element', () => {
  const nodes = SHAPES.map((shape, index) => `  - id: n${index}\n    shape: ${shape}\n    label: 节点\n`).join('')
  const edges = SHAPES.slice(1).map((_, index) => `  - from: n0\n    to: n${index + 1}\n`).join('')
  const { svg } = render(`nodes:\n${nodes}edges:\n${edges}`, 'shapes')
  for (const shape of SHAPES) {
    assert(svg.includes(`data-shape="${shape}"`), `missing ${shape}`)
  }
  const groups = (svg.match(/<g class="fc-node"/g) ?? []).length
  assert(groups === 15, `node groups ${groups}`)
  return '15 shapes'
})

check('all four directions render', () => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const { svg } = render(`direction: ${direction}\nnodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n`, `direction-${direction}`)
    assert(svg.includes('<svg'), direction)
  }
})

check('groups and legend render around and above the graph', () => {
  const { svg } = render([
    'nodes:',
    '  - id: a',
    '  - id: b',
    'edges:',
    '  - from: a',
    '    to: b',
    'groups:',
    '  - id: ci',
    '    label: CI',
    '    members: [a, b]',
    'legend:',
    '  - { shape: diamond, label: 判断 }',
    '  - { shape: stadium, label: 起止 }',
  ].join('\n'), 'groups-legend')
  assert(svg.includes('class="fc-groups"') && svg.includes('>CI<'), 'group label')
  assert(svg.includes('class="fc-legend"') && svg.includes('>判断<'), 'legend rows')
  assert(svg.indexOf('fc-groups') < svg.indexOf('fc-edges'), 'groups render under the edges')
  assert(svg.indexOf('fc-nodes') < svg.indexOf('fc-legend'), 'legend renders above the nodes')
})

// --- shapes and geometry ------------------------------------------------------

check('a rounded rect uses rx, a stadium uses half the height', () => {
  const rounded = shapeElement('rounded', { x: 0, y: 0, w: 100, h: 40 }, () => 'fill="#fff"')
  const stadium = shapeElement('stadium', { x: 0, y: 0, w: 100, h: 40 }, () => 'fill="#fff"')
  assert(rounded.includes('rx="8"'), rounded)
  assert(stadium.includes('rx="20"'), stadium)
})

check('a diamond is a closed four-point path', () => {
  const element = shapeElement('diamond', { x: 0, y: 0, w: 100, h: 40 }, () => 'fill="#fff"')
  const commands = element.match(/[MLZ]/g)
  assert(element.startsWith('<path d="M 50 0'), element.slice(0, 30))
  assert(commands.filter((command) => command === 'L').length === 3 && element.includes('Z'), element)
})

check('the star has ten alternating vertices', () => {
  const element = shapeElement('star', { x: 0, y: 0, w: 60, h: 60 }, () => 'fill="#fff"')
  const points = (element.match(/L /g) ?? []).length + 1
  assert(points === 10, `vertices ${points}`)
})

check('a rounded polyline rounds real corners only', () => {
  const line = roundedPolylinePath([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 60, y: 40 }], 8)
  assert(line.includes('Q'), 'corner rounded')
  const straight = roundedPolylinePath([{ x: 0, y: 0 }, { x: 0, y: 40 }], 8)
  assert(!straight.includes('Q'), 'no corner on a straight run')
})

check('a very short segment does not over-round its corner', () => {
  const line = roundedPolylinePath([{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 40, y: 2 }], 8)
  assert(line.includes('Q 0 2'), 'radius clamped to half the short segment')
})

// --- colors and theme ---------------------------------------------------------

check('auto colors resolve to a host token with a fallback', () => {
  const value = resolveColor('auto', 'nodeStroke', 'auto')
  assert(value === 'var(--dsw-alias-border-l2, #c2cad8)', value)
})

check('an explicit theme emits concrete colors instead of tokens', () => {
  const light = resolveColor('auto', 'text', 'light')
  const dark = resolveColor('auto', 'text', 'dark')
  assert(!light.includes('var('), light)
  assert(light === '#1f2329' && dark === '#e7e9ee', `${light} / ${dark}`)
})

check('a user color passes through untouched in every theme', () => {
  assert(resolveColor('#ff0000', 'nodeFill', 'auto') === '#ff0000', 'auto')
  assert(resolveColor('#ff0000', 'nodeFill', 'dark') === '#ff0000', 'dark')
  assert(resolveColor('steelblue', 'nodeFill', 'light') === 'steelblue', 'keyword')
  assert(resolveColor('none', 'nodeFill', 'auto') === 'none', 'none')
})

check('an explicit theme renders without any token reference', () => {
  const { svg } = render('theme: dark\nnodes:\n  - id: a\n    label: 深色\n', 'theme-dark')
  assert(!svg.includes('var(--dsw-'), 'no tokens in an explicit theme')
})

check('theme auto keeps tokens so the panel follows the host', () => {
  const { svg } = render('nodes:\n  - id: a\n', 'theme-auto')
  assert(svg.includes('var(--dsw-alias-label-primary'), 'text token used')
  assert(svg.includes('var(--dsw-specific-sidebar-fill'), 'canvas token used')
})

check('strokeWidth 0 removes the outline', () => {
  const { svg } = render('nodes:\n  - id: a\n    strokeWidth: 0\n', 'no-stroke')
  assert(svg.includes('stroke="none"'), 'shape has no stroke')
})

check('a dashed node carries a dash pattern', () => {
  const { svg } = render('nodes:\n  - id: a\n    dashed: true\n', 'dashed-node')
  assert(svg.includes('stroke-dasharray="6 4"'), 'dashed')
})

check('line styles map to their dash patterns', () => {
  const dashed = render('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    style: dashed\n', 'edge-dashed').svg
  const dotted = render('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    style: dotted\n', 'edge-dotted').svg
  const custom = render('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    dashArray: [10, 2]\n', 'edge-dasharray').svg
  assert(dashed.includes('stroke-dasharray="6 4"'), 'dashed')
  assert(dotted.includes('stroke-dasharray="1.5 3"'), 'dotted')
  assert(custom.includes('stroke-dasharray="10 2"'), 'custom dash array')
})

check('strokes keep their width when the chart is scaled', () => {
  const { svg } = render('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n', 'non-scaling')
  const count = (svg.match(/vector-effect="non-scaling-stroke"/g) ?? []).length
  assert(count >= 3, `vector-effect on ${count} elements`)
})

// --- edges and arrowheads -----------------------------------------------------

check('each arrow shape draws its own geometry', () => {
  const triangle = arrowElement('triangle', 10, 20, 0, 9, '#333', 1.5)
  const vee = arrowElement('vee', 10, 20, 0, 9, '#333', 1.5)
  const line = arrowElement('line', 10, 20, 0, 9, '#333', 1.5)
  const circle = arrowElement('circle', 10, 20, 0, 9, '#333', 1.5)
  const diamond = arrowElement('diamond', 10, 20, 0, 9, '#333', 1.5)
  assert(triangle.startsWith('<path') && triangle.includes('fill="#333"'), 'triangle filled')
  assert(vee.includes('fill="none"') && vee.includes('M '), 'vee open')
  assert(line.includes('fill="none"'), 'line open')
  assert(circle.startsWith('<circle'), 'circle')
  assert(diamond.startsWith('<path') && diamond.includes('Z"'), 'diamond closed')
})

check('arrow direction follows the arrow field', () => {
  const base = 'nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n'
  const none = render(`${base}    arrow: none\n`, 'arrow-none').svg
  const start = render(`${base}    arrow: start\n`, 'arrow-start').svg
  const both = render(`${base}    arrow: both\n`, 'arrow-both').svg
  const heads = (svg) => (svg.match(/<path d="M [\d.]+ [\d.]+ L/g) ?? []).length + (svg.match(/<circle/g) ?? []).length
  assert(heads(none) === 0, `none draws ${heads(none)} heads`)
  assert(heads(start) === 1, `start draws ${heads(start)} heads`)
  assert(heads(both) === 2, `both draws ${heads(both)} heads`)
})

check('all five arrow shapes render through a full document', () => {
  for (const shape of ['triangle', 'vee', 'line', 'circle', 'diamond']) {
    const { svg } = render(`nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    arrowShape: ${shape}\n    arrow: both\n`, `arrowshape-${shape}`)
    assert(svg.includes('fc-edges'), shape)
  }
})

check('an edge label draws a background mask and the text', () => {
  const { svg } = render('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    label: 是\n', 'edge-label')
  assert(svg.includes('class="fc-edge-label"'), 'label group')
  assert(svg.includes('fill-opacity="0.9"'), 'mask behind the text')
  assert(svg.includes('>是<') || svg.includes('>是'), 'label text')
})

check('curve and straight and orthogonal routes all render a path', () => {
  const yaml = ['nodes:', '  - id: a', '  - id: b', '  - id: c', 'edges:', '  - from: a', '    to: b', '    route: curve', '  - from: b', '    to: c', '    route: straight', '  - from: a', '    to: c', '    route: orthogonal'].join('\n')
  const { svg } = render(yaml, 'routes')
  assert(svg.includes(' C '), 'cubic command for the curve')
  const paths = (svg.match(/<path class="fc-edge"/g) ?? []).length
  assert(paths === 3, `edge paths ${paths}`)
})

// --- text, safety, determinism ------------------------------------------------

check('label text is XML-escaped', () => {
  const { svg } = render('nodes:\n  - id: a\n    label: "a <b> & c \\"d\\""\n', 'escaping')
  assert(svg.includes('a &lt;b&gt; &amp; c &quot;d&quot;'), 'escaped text')
  assert(!svg.includes('<b>'), 'no raw markup')
})

check('the output carries no script, event handler or external reference', () => {
  const { svg } = render('nodes:\n  - id: a\n    label: 安全\nedges:\n  - from: a\n    to: a\n', 'safety')
  for (const forbidden of ['<script', 'foreignObject', 'javascript:', 'onload=', 'onclick=', '<image', 'xlink:href', '<use']) {
    assert(!svg.includes(forbidden), `emitted ${forbidden}`)
  }
})

check('multiline labels render one tspan per line', () => {
  const { svg } = render('nodes:\n  - id: a\n    label: "第一行\\n第二行"\n', 'multiline')
  const tree = svg.slice(svg.indexOf('fc-text'), svg.indexOf('</text>'))
  assert((tree.match(/<tspan/g) ?? []).length === 2, tree)
})

check('an empty label renders without a crash', () => {
  const { svg } = render('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n', 'empty-label')
  assert(svg.includes('fc-nodes'), 'rendered')
})

check('rendering is byte-for-byte deterministic', () => {
  const yaml = 'id: t\nnodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    route: curve\n'
  const first = render(yaml, 'determinism').svg
  const second = render(yaml, 'determinism-2').svg
  assert(first === second, 'two renders differ')
})

check('the background can be turned off for a transparent export', () => {
  const { svg } = render('nodes:\n  - id: a\n', 'no-background', { background: false })
  assert(!svg.includes('class="fc-canvas"'), 'no canvas rect')
})

check('a rich document renders every feature at once', () => {
  const yaml = [
    'id: rich',
    'title: 完整示例',
    'direction: LR',
    'canvas:',
    '  rankSpacing: 80',
    '  nodeSpacing: 32',
    'nodes:',
    '  - id: start',
    '    label: 开始',
    '    shape: stadium',
    '    fill: "#4f7cff"',
    '    color: "#ffffff"',
    '  - id: gate',
    '    label: 通过？',
    '    shape: diamond',
    '    stroke: "#f59e0b"',
    '    strokeWidth: 2',
    '  - id: work',
    '    label: "子流程\\n调用"',
    '    shape: subroutine',
    '  - id: store',
    '    label: 数据库',
    '    shape: cylinder',
    '  - id: fix',
    '    label: 回修',
    '    shape: note',
    '    dashed: true',
    'edges:',
    '  - from: start',
    '    to: gate',
    '    label: 触发',
    '  - from: gate',
    '    to: work',
    '    label: 是',
    '  - from: gate',
    '    to: fix',
    '    label: 否',
    '    style: dashed',
    '    color: "#ef4444"',
    '  - from: fix',
    '    to: start',
    '    route: curve',
    '    arrow: both',
    '    arrowShape: vee',
    '  - from: work',
    '    to: store',
    '    route: straight',
    '    width: 2',
    'groups:',
    '  - id: io',
    '    label: 输入',
    '    members: [start, gate]',
    'legend:',
    '  - { shape: diamond, label: 判断 }',
    '  - { shape: cylinder, label: 存储 }',
  ].join('\n')
  const { svg, geometry } = render(yaml, 'rich')
  assert(geometry.nodes.length === 5 && geometry.edges.length === 5, 'graph')
  assert(geometry.groups.length === 1 && geometry.legend, 'decorations')
  assert(svg.includes('vector-effect="non-scaling-stroke"'), 'strokes')
  assert(svg.length > 4000, `svg ${svg.length} bytes`)
  return `${svg.length} bytes`
})

// --- geometry audit -----------------------------------------------------------
// A string test can prove a shape rendered; these prove it rendered *sensibly*
// without anyone having to look at a picture.

function numbersIn(text) {
  return (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
}

check('no coordinate is NaN or infinite', () => {
  const yaml = 'id: t\nnodes:\n  - id: a\n  - id: b\n    pos: [300, 120]\nedges:\n  - from: a\n    to: b\n    route: curve\n    label: 一\ngroups:\n  - id: g\n    members: [a, b]\nlegend:\n  - { shape: star, label: 星 }\n'
  const { svg } = render(yaml, 'audit-nan')
  assert(!/NaN|Infinity|-Infinity/.test(svg), 'found a non-finite number')
})

check('every node shape stays inside its own box', () => {
  const { svg, geometry } = render(
    `nodes:\n${SHAPES.map((shape, index) => `  - id: n${index}\n    shape: ${shape}\n    label: 节点\n`).join('')}` +
    `edges:\n${SHAPES.slice(1).map((_, index) => `  - from: n0\n    to: n${index + 1}\n`).join('')}`,
    'audit-bounds',
  )
  for (const node of geometry.nodes) {
    const start = svg.indexOf(`data-node-id="${node.id}"`)
    const group = svg.slice(start, svg.indexOf('</g>', start))
    const shapePart = group.slice(0, group.indexOf('<text'))
    const xs = []
    const ys = []
    const tokens = shapePart.match(/([MLQC]|\bh\b|\bv\b|cx|cy|x|y)\s*("?)([\d.-]+)\2?/g) ?? []
    void tokens
    // Read every absolute coordinate pair the element emits and check the
    // extremes against the node box, allowing the stroke half-width.
    const pairs = [...shapePart.matchAll(/(?:M|L|Q)\s+(-?[\d.]+)\s+(-?[\d.]+)/g)]
    for (const pair of pairs) {
      xs.push(Number(pair[1]))
      ys.push(Number(pair[2]))
    }
    for (const attr of shapePart.matchAll(/\b(cx|x)="(-?[\d.]+)"/g)) xs.push(Number(attr[2]))
    for (const attr of shapePart.matchAll(/\b(cy|y)="(-?[\d.]+)"/g)) ys.push(Number(attr[2]))
    // A rect states its corner and size; a circle states centre and radius;
    // an ellipse separates rx (x extent) from ry (y extent).
    const rectMatch = shapePart.match(/<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="(-?[\d.]+)" height="(-?[\d.]+)"/)
    if (rectMatch) {
      xs.push(Number(rectMatch[1]), Number(rectMatch[1]) + Number(rectMatch[3]))
      ys.push(Number(rectMatch[2]), Number(rectMatch[2]) + Number(rectMatch[4]))
    }
    for (const attr of shapePart.matchAll(/\b(r|rx)="(-?[\d.]+)"/g)) {
      const kind = attr[1]
      const value = Number(attr[2])
      const cxMatch = shapePart.match(/\bcx="(-?[\d.]+)"/)
      const cyMatch = shapePart.match(/\bcy="(-?[\d.]+)"/)
      if (cxMatch) xs.push(Number(cxMatch[1]) - value, Number(cxMatch[1]) + value)
      if (kind === 'r' && cyMatch) ys.push(Number(cyMatch[1]) - value, Number(cyMatch[1]) + value)
    }
    for (const attr of shapePart.matchAll(/\bry="(-?[\d.]+)"/g)) {
      const value = Number(attr[1])
      const cyMatch = shapePart.match(/\bcy="(-?[\d.]+)"/)
      if (cyMatch) ys.push(Number(cyMatch[1]) - value, Number(cyMatch[1]) + value)
    }
    const margins = { cloud: 2, star: 0, diamond: 0 }
    const margin = margins[node.shape] ?? 1
    assert(xs.length > 0 && ys.length > 0, `${node.shape}: no coordinates found`)
    assert(Math.min(...xs) >= node.x - margin, `${node.shape}: x ${Math.min(...xs)} < ${node.x}`)
    assert(Math.max(...xs) <= node.x + node.w + margin, `${node.shape}: x ${Math.max(...xs)} > ${node.x + node.w}`)
    assert(Math.min(...ys) >= node.y - margin, `${node.shape}: y ${Math.min(...ys)} < ${node.y}`)
    assert(Math.max(...ys) <= node.y + node.h + margin, `${node.shape}: y ${Math.max(...ys)} > ${node.y + node.h}`)
  }
  return `${geometry.nodes.length} shapes in bounds`
})

check('node text sits inside the node box', () => {
  const yaml = 'nodes:\n  - id: a\n    label: "第一行\\n第二行"\n  - id: b\n    label: 单行\n    align: left\n  - id: c\n    label: 右对齐\n    align: right\n  - id: d\n    label: 弹\n    shape: diamond\nedges:\n  - from: a\n    to: b\n  - from: a\n    to: c\n  - from: a\n    to: d\n'
  const { svg, geometry } = render(yaml, 'audit-text')
  for (const node of geometry.nodes) {
    const start = svg.indexOf(`data-node-id="${node.id}"`)
    const group = svg.slice(start, svg.indexOf('</g>', start))
    const baselines = [...group.matchAll(/<tspan x="(-?[\d.]+)" y="(-?[\d.]+)"/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    assert(baselines.length >= 1, `${node.id}: no text`)
    for (const baseline of baselines) {
      assert(baseline.x >= node.x - 1 && baseline.x <= node.x + node.w + 1, `${node.id}: x ${baseline.x} outside ${node.x}..${node.x + node.w}`)
      assert(baseline.y >= node.y - 1 && baseline.y <= node.y + node.h + 1, `${node.id}: y ${baseline.y} outside ${node.y}..${node.y + node.h}`)
    }
  }
  return 'text inside boxes'
})

check('every arrowhead tip lands on its edge endpoint', () => {
  const { svg, geometry } = render('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n    arrow: both\n  - from: b\n    to: c\n    route: curve\n    arrow: end\n', 'audit-arrows')
  const region = svg.slice(svg.indexOf('fc-edges'), svg.indexOf('fc-edge-labels') === -1 ? svg.indexOf('fc-nodes') : svg.indexOf('fc-edge-labels'))
  const tips = [...region.matchAll(/(?:<path d="M\s*|<circle cx="\s*)(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
  // The first point of each arrow element is its tip; the edge path starts
  // with "M", so only elements after the first path per edge are arrowheads.
  const endpoints = geometry.edges.flatMap((edge) => [edge.points[0], edge.points.at(-1)])
  assert(tips.length >= 3, `found ${tips.length} arrow tips`)
  for (const tip of tips) {
    const near = endpoints.some((point) => Math.abs(point.x - tip.x) < 0.51 && Math.abs(point.y - tip.y) < 0.51)
    assert(near, `tip ${tip.x},${tip.y} is not on an edge endpoint`)
  }
  return `${tips.length} tips on endpoints`
})

check('edge labels render above the node shapes', () => {
  // A label under a node is invisible: the mask behind it only helps when the
  // label is painted last.
  const { svg } = render('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    label: 触发\n', 'label-order')
  const nodes = svg.indexOf('class="fc-nodes"')
  const labels = svg.indexOf('class="fc-edge-labels"')
  assert(nodes >= 0 && labels >= 0, 'both layers present')
  assert(labels > nodes, `labels at ${labels}, nodes at ${nodes}`)
  assert(svg.indexOf('class="fc-legend"') > labels || svg.indexOf('class="fc-legend"') === -1, 'legend still on top')
})

check('every edge draws exactly the arrows its arrow field asks for', () => {
  const yaml = [
    'nodes:',
    '  - id: a',
    '  - id: b',
    '  - id: c',
    '  - id: d',
    'edges:',
    '  - from: a',
    '    to: b',
    '    arrow: none',
    '  - from: b',
    '    to: c',
    '    arrow: end',
    '  - from: c',
    '    to: d',
    '    arrow: start',
    '  - from: d',
    '    to: a',
    '    arrow: both',
    '    route: curve',
  ].join('\n')
  const { svg, geometry } = render(yaml, 'audit-arrow-count')
  const items = [...svg.matchAll(/<g class="fc-edge-item" data-from="(\w+)" data-to="(\w+)">([\s\S]*?)<\/g>/g)]
  assert(items.length === geometry.edges.length, `edge groups ${items.length}`)
  const expected = { none: 0, end: 1, start: 1, both: 2 }
  items.forEach((item, index) => {
    const edge = geometry.edges[index]
    const heads = (item[3].match(/<path class="fc-edge"/g) ?? []).length
    assert(heads === 1, `edge ${index}: ${heads} line paths`)
    const parts = item[3].split(/<path class="fc-edge"/).slice(1)
    void parts
    // Count arrow elements: everything that is not the line itself.
    const arrows = (item[3].match(/<path d="M|<circle cx="/g) ?? []).length
    assert(arrows === expected[edge.arrow], `edge ${index} arrow=${edge.arrow} drew ${arrows} heads`)
    if (edge.arrow === 'end' || edge.arrow === 'both') {
      const tip = edge.points.at(-1)
      assert(item[3].includes(`M ${tip.x} ${tip.y}`) || item[3].includes(`cx="${tip.x}"`), `edge ${index}: no head at its end ${tip.x},${tip.y}`)
    }
    if (edge.arrow === 'start' || edge.arrow === 'both') {
      const tip = edge.points[0]
      assert(item[3].includes(`M ${tip.x} ${tip.y}`) || item[3].includes(`cx="${tip.x}"`), `edge ${index}: no head at its start ${tip.x},${tip.y}`)
    }
  })
  return `${items.length} edges, heads match`
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (written.length > 0) console.log(`fixtures in ${FIXTURES}`)
if (failures.length > 0) process.exit(1)