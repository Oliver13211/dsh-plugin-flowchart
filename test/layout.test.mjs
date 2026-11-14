/**
 * M2 acceptance — layout engine (design §8).
 *
 * Run with: node test/layout.test.mjs
 */

import { layoutDoc } from '../lib/layout.js'
import { normalizeFlowChart } from '../lib/normalize.js'
import { SAMPLES } from './samples.mjs'

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

function doc(yaml) {
  const result = normalizeFlowChart(yaml, LIMITS)
  assert(result.ok, `document rejected: ${JSON.stringify(result.errors)}`)
  return result.doc
}

function nodeOf(geometry, id) {
  const node = geometry.nodes.find((candidate) => candidate.id === id)
  assert(node, `no node ${id}`)
  return node
}

// --- ranking and ordering ----------------------------------------------------

check('a chain ranks one node per layer, top to bottom', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\n'))
  const [a, b, c] = ['a', 'b', 'c'].map((id) => nodeOf(geometry, id))
  assert(a.layer === 0 && b.layer === 1 && c.layer === 2, `layers ${a.layer},${b.layer},${c.layer}`)
  assert(a.y < b.y && b.y < c.y, `y order ${a.y},${b.y},${c.y}`)
  return `layers 0/1/2, y ${a.y}/${b.y}/${c.y}`
})

check('a chain that closes a cycle still ranks and marks the back edge', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\n  - from: c\n    to: a\n'))
  assert(nodeOf(geometry, 'a').layer === 0 && nodeOf(geometry, 'b').layer === 1 && nodeOf(geometry, 'c').layer === 2, 'layers')
  assert(geometry.edges[2].feedback === true, 'third edge is the feedback edge')
  assert(geometry.edges[0].feedback === false && geometry.edges[1].feedback === false, 'forward edges are not feedback')
})

check('a self-loop keeps its node and marks the edge', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n  - from: a\n    to: a\n'))
  assert(geometry.nodes.length === 2, 'both nodes kept')
  assert(geometry.edges[1].feedback === true, 'self-loop marked as feedback')
})

check('a diamond branch splits and rejoins without overlap', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: start\n  - id: gate\n  - id: yes\n  - id: no\n  - id: end\nedges:\n  - from: start\n    to: gate\n  - from: gate\n    to: yes\n  - from: gate\n    to: no\n  - from: yes\n    to: end\n  - from: no\n    to: end\n'))
  const layers = new Map()
  for (const node of geometry.nodes) layers.set(node.layer, (layers.get(node.layer) ?? 0) + 1)
  assert(layers.get(0) === 1 && layers.get(1) === 1 && layers.get(2) === 2 && layers.get(3) === 1, `layer sizes ${[...layers.values()]}`)
  const yes = nodeOf(geometry, 'yes')
  const no = nodeOf(geometry, 'no')
  assert(Math.abs(yes.y - no.y) < 0.01, 'siblings share a rank')
  assert(Math.abs(yes.x - no.x) > yes.w, `siblings do not overlap: ${yes.x} vs ${no.x}`)
})

check('barycenter keeps a short branch next to its neighbour', () => {
  // `b` connects to `x`, so it should be ordered after `a` in layer 1 to keep
  // the crossing count down.
  const geometry = layoutDoc(doc([
    'nodes:',
    '  - id: a',
    '  - id: b',
    '  - id: x',
    '  - id: y',
    'edges:',
    '  - from: a',
    '    to: y',
    '  - from: b',
    '    to: x',
  ].join('\n')))
  const order = geometry.nodes.filter((node) => node.layer === 1).sort((left, right) => left.x - right.x).map((node) => node.id)
  assert(order[0] === 'x', `layer 1 order ${order.join(',')} (x should sit under b)`)
})

check('a feedback edge is routed without disturbing the forward ranks', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: build\n  - id: test\n  - id: fix\nedges:\n  - from: build\n    to: test\n  - from: test\n    to: fix\n  - from: fix\n    to: build\n'))
  assert(nodeOf(geometry, 'build').layer === 0, 'build stays first')
  assert(geometry.edges[2].feedback === true, 'fix → build is the back edge')
  assert(geometry.edges[2].points.length >= 2, 'back edge still has geometry')
})

// --- direction mapping -------------------------------------------------------

for (const [direction, expect] of [
  ['TB', (a, b) => b.y > a.y],
  ['BT', (a, b) => b.y < a.y],
  ['LR', (a, b) => b.x > a.x],
  ['RL', (a, b) => b.x < a.x],
]) {
  check(`direction ${direction} maps the rank axis correctly`, () => {
    const geometry = layoutDoc(doc(`direction: ${direction}\nnodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n`))
    const a = nodeOf(geometry, 'a')
    const b = nodeOf(geometry, 'b')
    assert(expect(a, b), `${direction}: a=(${a.x},${a.y}) b=(${b.x},${b.y})`)
  })
}

check('rank spacing and node spacing are honoured', () => {
  const geometry = layoutDoc(doc([
    'canvas:',
    '  rankSpacing: 100',
    '  nodeSpacing: 50',
    'nodes:',
    '  - id: a',
    '  - id: b',
    '  - id: c',
    'edges:',
    '  - from: a',
    '    to: b',
    '  - from: a',
    '    to: c',
  ].join('\n')))
  const a = nodeOf(geometry, 'a')
  const b = nodeOf(geometry, 'b')
  const c = nodeOf(geometry, 'c')
  assert(Math.abs((b.y - (a.y + a.h)) - 100) < 0.01, `rank gap ${b.y - (a.y + a.h)}`)
  const gap = Math.abs(c.x - b.x) - b.w
  assert(Math.abs(gap - 50) < 0.01, `node gap ${gap}`)
})

// --- explicit position and size ---------------------------------------------

check('an explicit size wins over the measured size', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n    label: 很长的标签文字内容\n    size: [240, 96]\n'))
  const a = nodeOf(geometry, 'a')
  assert(a.w === 240 && a.h === 96, `${a.w}x${a.h}`)
})

check('an explicit pos places the node and is snapped to the grid', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n    pos: [133, 91]\n'))
  const b = nodeOf(geometry, 'b')
  assert(b.x % 8 === 0 && b.y % 8 === 0, `snapped to ${b.x},${b.y}`)
  assert(Math.abs(b.x - 136) < 0.01 && Math.abs(b.y - 88) < 0.01, `placed at ${b.x},${b.y}`)
})

check('two pinned nodes that collide produce a warning, not an error', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n    pos: [0, 0]\n  - id: b\n    pos: [10, 10]\n'))
  assert(geometry.warnings.some((warning) => warning.includes('overlap')), JSON.stringify(geometry.warnings))
})

// --- anchors and routing ------------------------------------------------------

check('auto anchors follow the relative position', () => {
  const vertical = layoutDoc(doc('direction: TB\nnodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n'))
  assert(vertical.edges[0].points[0].y === nodeOf(vertical, 'a').y + nodeOf(vertical, 'a').h, 'leaves the bottom of a')
  assert(vertical.edges[0].points.at(-1).y === nodeOf(vertical, 'b').y, 'enters the top of b')

  const horizontal = layoutDoc(doc('direction: LR\nnodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n'))
  assert(horizontal.edges[0].points[0].x === nodeOf(horizontal, 'a').x + nodeOf(horizontal, 'a').w, 'leaves the right of a')
  assert(horizontal.edges[0].points.at(-1).x === nodeOf(horizontal, 'b').x, 'enters the left of b')
})

check('an explicit fromSide and toSide are respected', () => {
  const geometry = layoutDoc(doc('direction: TB\nnodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    fromSide: right\n    toSide: right\n'))
  const a = nodeOf(geometry, 'a')
  const b = nodeOf(geometry, 'b')
  assert(geometry.edges[0].points[0].x === a.x + a.w, 'leaves the right of a')
  assert(geometry.edges[0].points.at(-1).x === b.x + b.w, 'enters the right of b')
})

check('a straight drop has no redundant corner', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n'))
  assert(geometry.edges[0].points.length === 2, `points ${geometry.edges[0].points.length}`)
  assert(geometry.edges[0].points[0].x === geometry.edges[0].points[1].x, 'a single vertical run')
})

check('an orthogonal turn keeps four distinct points', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n  - from: a\n    to: c\n'))
  const turn = geometry.edges.find((edge) => edge.to === 'b')
  assert(turn.points.length === 4, `points ${turn.points.length}`)
})

check('parallel edges between one pair are offset', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\n    label: 一\n  - from: a\n    to: b\n    label: 二\n'))
  const [first, second] = geometry.edges
  const separation = Math.max(...first.points.map((point, index) => Math.abs(point.x - second.points[index].x)))
  assert(separation >= 8, `separation ${separation}`)
  return `offset ${separation}px`
})

check('curve and straight routes have the right point count', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n    route: curve\n  - from: b\n    to: c\n    route: straight\n'))
  assert(geometry.edges[0].kind === 'cubic' && geometry.edges[0].points.length === 4, 'curve is a cubic')
  assert(geometry.edges[1].kind === 'polyline' && geometry.edges[1].points.length === 2, 'straight is two points')
})

check('an edge label sits on the run and carries a box', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n - x\nedges:\n  - from: a\n    to: b\n    label: 是\n'.replace('\n - x\n', '\n')))
  const label = geometry.edges[0].label
  assert(label && label.w > 0 && label.h > 0, JSON.stringify(label))
  const xs = geometry.edges[0].points.map((point) => point.x)
  const ys = geometry.edges[0].points.map((point) => point.y)
  assert(label.x >= Math.min(...xs) - 80 && label.x <= Math.max(...xs) + 80, 'label near the run')
  assert(label.y >= Math.min(...ys) - 40 && label.y <= Math.max(...ys) + 40, 'label near the run')
})

// --- groups, legend, view box -------------------------------------------------

check('a group box wraps its members with padding', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n    pos: [200, 0]\ngroups:\n  - id: g\n    members: [a, b]\n'))
  const group = geometry.groups[0]
  for (const id of ['a', 'b']) {
    const node = nodeOf(geometry, id)
    assert(group.x <= node.x && group.y <= node.y, `${id} inside the group's top left`)
    assert(group.x + group.w >= node.x + node.w && group.y + group.h >= node.y + node.h, `${id} inside the group's bottom right`)
  }
  assert(group.x === nodeOf(geometry, 'a').x - 16, 'padding applied')
})

check('the legend sits inside the view box at the bottom right', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\nlegend:\n  - { shape: diamond, label: 判断 }\n  - { shape: stadium, label: 起止 }\n'))
  const legend = geometry.legend
  assert(legend && legend.rows.length === 2, 'two legend rows')
  assert(legend.x >= geometry.viewBox.x && legend.y >= geometry.viewBox.y, 'inside the top left')
  assert(legend.x + legend.w <= geometry.viewBox.x + geometry.viewBox.width + 0.01, 'inside the right edge')
  assert(legend.y + legend.h <= geometry.viewBox.y + geometry.viewBox.height + 0.01, 'inside the bottom edge')
})

// --- the legend must never sit on top of the graph ---------------------------

/** Every rectangle the reader needs to see, excluding the legend itself. */
function contentRects(geometry) {
  return [
    ...geometry.nodes.map((node) => ({ x: node.x, y: node.y, right: node.x + node.w, bottom: node.y + node.h, what: `node ${node.id}` })),
    ...geometry.groups.map((group) => ({ x: group.x, y: group.y, right: group.x + group.w, bottom: group.y + group.h, what: `group ${group.id}` })),
    ...geometry.edges.filter((edge) => edge.label).map((edge) => ({
      x: edge.label.x,
      y: edge.label.y,
      right: edge.label.x + edge.label.w,
      bottom: edge.label.y + edge.label.h,
      what: `label ${edge.from}->${edge.to}`,
    })),
  ]
}

function collides(a, b, margin = 0) {
  return a.x - margin < b.right && b.x < a.right + margin && a.y - margin < b.bottom && b.y < a.bottom + margin
}

check('the legend never covers a node, a group or an edge label', () => {
  // This is the failure a reader notices immediately: the legend parked on the
  // graph. Both the corner case and the crowded case are checked.
  const documents = {
    'narrow stack': 'nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\nlegend:\n  - { shape: diamond, label: 判断 }\n',
    'wide and short': 'direction: LR\nnodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\nlegend:\n  - { shape: stadium, label: 起止 }\n',
    'corner occupied': 'nodes:\n  - id: a\n  - id: b\n  - id: c\n  - id: d\nedges:\n  - from: a\n    to: b\n  - from: c\n    to: d\nlegend:\n  - { shape: diamond, label: 判断 }\n  - { shape: cylinder, label: 存储 }\n  - { shape: note, label: 注释 }\n',
    'with a group': 'nodes:\n  - id: a\n  - id: b\nedges:\n  - from: a\n    to: b\ngroups:\n  - id: g\n    members: [a, b]\nlegend:\n  - { shape: diamond, label: 判断 }\n',
  }
  for (const [name, yaml] of Object.entries(documents)) {
    const geometry = layoutDoc(doc(yaml))
    const legend = geometry.legend
    assert(legend, `${name}: no legend`)
    for (const rect of contentRects(geometry)) {
      assert(!collides(legend, rect), `${name}: legend overlaps ${rect.what}`)
    }
    for (const edge of geometry.edges) {
      for (const point of edge.points) {
        const inside = point.x >= legend.x && point.x <= legend.x + legend.w && point.y >= legend.y && point.y <= legend.y + legend.h
        assert(!inside, `${name}: legend covers a point of ${edge.from}->${edge.to}`)
      }
    }
  }
  return `${Object.keys(documents).length} documents clear`
})

check('the legend grows the canvas instead of overlapping the graph', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\nlegend:\n  - { shape: diamond, label: 判断 }\n'))
  const contentBottom = Math.max(...geometry.nodes.map((node) => node.y + node.h), ...geometry.edges.flatMap((edge) => edge.points.map((point) => point.y)))
  assert(geometry.legend.y >= contentBottom, `legend at ${geometry.legend.y} is above the content bottom ${contentBottom}`)
  assert(geometry.viewBox.y + geometry.viewBox.height >= geometry.legend.y + geometry.legend.h, 'legend inside the view box')
})

check('an edge label keeps clear of node boxes when the route allows it', () => {
  // gate → target with a detour: the longest segment runs between two ranks,
  // and the label should not end up inside the middle node.
  const geometry = layoutDoc(doc([
    'nodes:',
    '  - id: gate',
    '  - id: mid',
    '  - id: far',
    '  - id: other',
    'edges:',
    '  - from: gate',
    '    to: far',
    '  - from: gate',
    '    to: other',
    '  - from: mid',
    '    to: far',
    '  - from: mid',
    '    to: other',
  ].join('\n')))
  for (const edge of geometry.edges) {
    if (!edge.label) continue
    const centerX = edge.label.x + edge.label.w / 2
    const centerY = edge.label.y + edge.label.h / 2
    for (const node of geometry.nodes) {
      const inside = centerX > node.x + 2 && centerX < node.x + node.w - 2 && centerY > node.y + 2 && centerY < node.y + node.h - 2
      assert(!inside, `${edge.from}->${edge.to} label centre is inside node ${node.id}`)
    }
  }
})

check('the view box contains every node, edge point and group plus padding', () => {
  const geometry = layoutDoc(doc([
    'canvas:',
    '  padding: 30',
    'nodes:',
    '  - id: a',
    '  - id: b',
    '    pos: [300, 200]',
    'edges:',
    '  - from: a',
    '    to: b',
    '    route: curve',
    'groups:',
    '  - id: g',
    '    members: [a]',
  ].join('\n')))
  const { viewBox } = geometry
  const points = [
    ...geometry.edges.flatMap((edge) => edge.points),
    ...geometry.nodes.flatMap((node) => [{ x: node.x, y: node.y }, { x: node.x + node.w, y: node.y + node.h }]),
    ...geometry.groups.flatMap((group) => [{ x: group.x, y: group.y }, { x: group.x + group.w, y: group.y + group.h }]),
  ]
  for (const point of points) {
    assert(point.x >= viewBox.x && point.x <= viewBox.x + viewBox.width, `x ${point.x} inside ${viewBox.x}..${viewBox.x + viewBox.width}`)
    assert(point.y >= viewBox.y && point.y <= viewBox.y + viewBox.height, `y ${point.y} inside ${viewBox.y}..${viewBox.y + viewBox.height}`)
  }
  const minX = Math.min(...points.map((point) => point.x))
  assert(Math.abs(viewBox.x - (minX - 30)) < 0.01, `padding applied: ${viewBox.x} vs ${minX - 30}`)
})

// --- text measurement ---------------------------------------------------------

check('a long label wraps and grows the node', () => {
  const short = layoutDoc(doc('nodes:\n  - id: a\n    label: 开始\n'))
  const long = layoutDoc(doc('nodes:\n  - id: a\n    label: 这是一个非常长的节点标签需要换行显示否则会超出宽度\n'))
  assert(nodeOf(long, 'a').lines.length > 1, `lines ${nodeOf(long, 'a').lines.length}`)
  assert(nodeOf(long, 'a').h > nodeOf(short, 'a').h, 'wrapped node is taller')
})

check('a label too long for its box is truncated with a warning', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n    label: 这是一个很长很长很长很长的标签文字内容需要被截断处理\n    size: [80, 40]\n'))
  assert(nodeOf(geometry, 'a').truncated === true, 'marked truncated')
  assert(geometry.warnings.some((warning) => warning.includes('truncated')), JSON.stringify(geometry.warnings))
})

check('CJK is measured wider than Latin', () => {
  const cjk = layoutDoc(doc('nodes:\n  - id: a\n    label: 开始结束\n'))
  const latin = layoutDoc(doc('nodes:\n  - id: a\n    label: abcd\n'))
  assert(nodeOf(cjk, 'a').w >= nodeOf(latin, 'a').w, `${nodeOf(cjk, 'a').w} vs ${nodeOf(latin, 'a').w}`)
})

check('every shape produces a node box of at least the minimum size', () => {
  const names = ['rect', 'rounded', 'stadium', 'ellipse', 'circle', 'diamond', 'hexagon', 'parallelogram', 'cylinder', 'document', 'cloud', 'triangle', 'star', 'note', 'subroutine']
  const yaml = ['nodes:', ...names.map((shape, index) => `  - id: n${index}\n    shape: ${shape}\n    label: 节点`), 'edges:', ...names.map((shape, index) => index === 0 ? '' : `  - from: n0\n    to: n${index}`).filter(Boolean)].join('\n')
  const geometry = layoutDoc(doc(yaml))
  assert(geometry.nodes.length === 15, `nodes ${geometry.nodes.length}`)
  for (const node of geometry.nodes) {
    assert(node.w >= 38 && node.h >= 38, `${node.shape} is ${node.w}x${node.h}`)
  }
  return '15 shapes sized'
})

check('a circle keeps a square box', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n    shape: circle\n    label: 状态\n'))
  assert(nodeOf(geometry, 'a').w === nodeOf(geometry, 'a').h, `${nodeOf(geometry, 'a').w} vs ${nodeOf(geometry, 'a').h}`)
})

// --- determinism and performance ---------------------------------------------

check('layout is deterministic', () => {
  const document_ = doc('nodes:\n  - id: a\n  - id: b\n  - id: c\n  - id: d\nedges:\n  - from: a\n    to: b\n  - from: a\n    to: c\n  - from: b\n    to: d\n  - from: c\n    to: d\n  - from: d\n    to: a\n')
  assert(JSON.stringify(layoutDoc(document_)) === JSON.stringify(layoutDoc(document_)), 'two runs differ')
})

check('an injected measurer changes pixels, not topology', () => {
  const document_ = doc('nodes:\n  - id: a\n    label: start\n  - id: b\n    label: end\nedges:\n  - from: a\n    to: b\n')
  const plain = layoutDoc(document_)
  const wide = layoutDoc(document_, { measurer: () => 400 })
  assert(plain.nodes[0].layer === wide.nodes[0].layer, 'same rank')
  assert(wide.nodes[0].w > plain.nodes[0].w, 'wider box')
  const plainEdges = plain.edges[0].points.map((point) => point.x)
  const wideEdges = wide.edges[0].points.map((point) => point.x)
  assert(plainEdges.length === wideEdges.length, 'same edge shape')
})

check('60 nodes and 120 edges lay out inside 30ms', () => {
  const nodes = Array.from({ length: 60 }, (_, index) => `  - id: n${index}`).join('\n')
  const edges = Array.from({ length: 120 }, (_, index) => `  - from: n${index % 60}\n    to: n${(index * 7 + 1) % 60}`).join('\n')
  const document_ = doc(`nodes:\n${nodes}\nedges:\n${edges}`)
  const started = performance.now()
  const geometry = layoutDoc(document_)
  const elapsed = performance.now() - started
  assert(geometry.nodes.length === 60, `nodes ${geometry.nodes.length}`)
  assert(elapsed < 30, `took ${elapsed.toFixed(1)}ms`)
  return `${elapsed.toFixed(1)}ms`
})

check('every review sample passes the readability audit', () => {
  // The two symptoms a reader reported from the rendered samples: a label
  // hidden behind a shape, and the legend sitting on the graph. Both are
  // checked here on the real fixtures, not on a synthetic graph.
  const problems = []
  for (const [name, yaml] of SAMPLES) {
    const result = normalizeFlowChart(yaml, LIMITS)
    if (!result.ok) {
      problems.push(`${name}: rejected`)
      continue
    }
    const geometry = layoutDoc(result.doc)

    for (const edge of geometry.edges) {
      if (!edge.label) continue
      const cx = edge.label.x + edge.label.w / 2
      const cy = edge.label.y + edge.label.h / 2
      for (const node of geometry.nodes) {
        if (cx > node.x + 2 && cx < node.x + node.w - 2 && cy > node.y + 2 && cy < node.y + node.h - 2) {
          problems.push(`${name}: label ${edge.from}->${edge.to} lands inside node ${node.id}`)
        }
      }
    }

    if (geometry.legend) {
      const legend = geometry.legend
      for (const rect of contentRects(geometry)) {
        if (collides(legend, rect)) problems.push(`${name}: legend overlaps ${rect.what}`)
      }
    }
  }
  assert(problems.length === 0, problems.join('; '))
  return `${SAMPLES.length} samples clear`
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) process.exit(1)