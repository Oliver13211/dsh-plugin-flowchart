/**
 * FlowChart — layout engine (design §8).
 *
 * A pure function: normalized document in, absolute geometry out. No DOM, no
 * clock, no randomness. The same document therefore yields the same geometry
 * in the browser, in a test process, and after a reload — which is what lets
 * the Client own layout while the Host owns validation.
 *
 * The nine steps are the design doc's own:
 *
 *   1 normalize      every field already carries its default (M1 did this)
 *   2 measure text   wrap labels, derive natural node sizes
 *   3 rank           longest-path layering, cycles marked as feedback edges
 *   4 order          barycenter sweeps to reduce crossings
 *   5 position       axis mapping per direction, explicit `pos` wins
 *   6 anchors        `fromSide`/`toSide: auto` from relative position
 *   7 route          orthogonal (rounded) / straight / cubic, parallel offset
 *   8 groups         member bounding box plus padding
 *   9 view box       bounding box plus canvas padding
 *
 * Coordinate convention: every node carries a top-left `(x, y)` plus `(w, h)`;
 * `cx`/`cy` are derived for convenience. Distances are layout pixels; `size`
 * and `pos` from the DSL are also pixels, snapped to `canvas.grid`.
 */

import { measureLine, wrapText } from './metrics.js'

const PAD_X = 14
const PAD_Y = 10
const LINE_HEIGHT = 1.32
const MAX_LABEL_WIDTH = 176
const MIN_W = 76
const MIN_H = 38
const STUB = 16
const CORNER = 8
const PARALLEL_OFFSET = 8
const GROUP_PAD = 16
/** Room for a group's own caption, above its members. */
const GROUP_LABEL_BAND = 18
const GROUP_LABEL_SIZE = 12
const LEGEND_PAD = 8
const LEGEND_GAP = 6
/** A legend caption wider than this is ellipsized rather than allowed to stretch the corner. */
const LEGEND_LABEL_MAX = 150

/** Shapes whose usable text area is smaller than their bounding box. */
const TEXT_SCALE = {
  diamond: { x: 1.95, y: 2.1 },
  triangle: { x: 1.9, y: 2.3 },
  ellipse: { x: 1.5, y: 1.8 },
  circle: { x: 1.6, y: 1.6 },
  star: { x: 1.85, y: 1.85 },
  cloud: { x: 1.3, y: 1.35 },
}

/** Extra room a shape needs beyond its text box, in pixels. */
const SHAPE_PADDING = {
  stadium: { x: 18, y: 0 },
  subroutine: { x: 12, y: 0 },
  parallelogram: { x: 12, y: 0 },
  hexagon: { x: 12, y: 0 },
  note: { x: 8, y: 4 },
  cylinder: { x: 0, y: 12 },
  document: { x: 0, y: 10 },
}

/**
 * Lay out a normalized FlowChart document.
 * @param {object} doc the document `lib/normalize.js` produced
 * @param {{ measurer?: Function, maxLabelWidth?: number, grid?: number }} [options]
 * @returns {{ viewBox: object, nodes: object[], edges: object[], groups: object[], legend: object|null, warnings: string[] }}
 */
export function layoutDoc(doc, options = {}) {
  const warnings = []
  const grid = doc.canvas.grid > 0 ? doc.canvas.grid : 8
  const measurer = options.measurer
  const maxLabelWidth = options.maxLabelWidth ?? MAX_LABEL_WIDTH

  const snap = (value) => Math.round(value / grid) * grid
  const round = (value) => Math.round(value * 100) / 100

  // --- step 2: measure text and size the nodes -----------------------------
  const order = new Map(doc.nodes.map((node, index) => [node.id, index]))
  const nodes = doc.nodes.map((node) => {
    const style = { fontSize: node.fontSize, mono: node.mono }
    const explicit = node.size !== null && node.size !== undefined
    const contentMax = explicit
      ? Math.max(24, node.size[0] - 2 * PAD_X)
      : maxLabelWidth
    // An auto-sized node grows to fit, so it never truncates. An explicit size
    // is a promise about the box, so the text is clipped to the lines that fit.
    const lineHeight = node.fontSize * LINE_HEIGHT
    const maxLines = explicit
      ? Math.max(1, Math.floor((Math.max(MIN_H, node.size[1]) - 2 * PAD_Y) / lineHeight))
      : Infinity
    const wrapped = wrapText(node.label ?? '', style, { maxWidth: contentMax, maxLines, measurer })
    const textWidth = wrapped.width
    const textHeight = Math.max(1, wrapped.lines.length) * node.fontSize * LINE_HEIGHT
    const scale = TEXT_SCALE[node.shape] ?? { x: 1, y: 1 }
    const extra = SHAPE_PADDING[node.shape] ?? { x: 0, y: 0 }

    let w
    let h
    if (explicit) {
      w = Math.max(MIN_W, node.size[0])
      h = Math.max(MIN_H, node.size[1])
    } else {
      w = Math.max(MIN_W, snap(textWidth * scale.x + 2 * PAD_X + extra.x))
      h = Math.max(MIN_H, snap(textHeight * scale.y + 2 * PAD_Y + extra.y))
      if (node.shape === 'circle') {
        const diameter = Math.max(w, h)
        w = diameter
        h = diameter
      }
    }

    return {
      id: node.id,
      shape: node.shape,
      lines: wrapped.lines,
      truncated: wrapped.truncated,
      fontSize: node.fontSize,
      mono: node.mono,
      bold: node.bold,
      align: node.align,
      fill: node.fill,
      stroke: node.stroke,
      strokeWidth: node.strokeWidth,
      dashed: node.dashed,
      color: node.color,
      w,
      h,
      pinned: node.pos !== null && node.pos !== undefined,
      pos: node.pos,
      x: 0,
      y: 0,
      cx: 0,
      cy: 0,
      layer: 0,
      index: order.get(node.id) ?? 0,
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))

  // --- step 3: rank by longest path, marking feedback edges ----------------
  // The full edge list is walked depth-first so the edge that closes a cycle
  // can be marked; the acyclic remainder then ranks by longest path. Dropping
  // exactly the DFS back edges leaves a DAG, so every node gets a rank.
  const outgoing = new Map(nodes.map((node) => [node.id, []]))
  const incoming = new Map(nodes.map((node) => [node.id, []]))
  const feedback = new Set()

  doc.edges.forEach((edge, index) => {
    if (!byId.has(edge.from) || !byId.has(edge.to)) return
    if (edge.from === edge.to) {
      feedback.add(index)
      return
    }
    outgoing.get(edge.from).push({ index, to: edge.to })
  })

  const UNSEEN = 0
  const ON_PATH = 1
  const DONE = 2
  const state = new Map(nodes.map((node) => [node.id, UNSEEN]))

  for (const root of nodes) {
    if (state.get(root.id) !== UNSEEN) continue
    state.set(root.id, ON_PATH)
    const stack = [{ id: root.id, cursor: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const list = outgoing.get(frame.id)
      if (frame.cursor >= list.length) {
        state.set(frame.id, DONE)
        stack.pop()
        continue
      }
      const step = list[frame.cursor]
      frame.cursor += 1
      const target = state.get(step.to)
      if (target === ON_PATH) {
        feedback.add(step.index)
        continue
      }
      if (target === DONE) continue
      state.set(step.to, ON_PATH)
      stack.push({ id: step.to, cursor: 0 })
    }
  }

  const dagOut = new Map(nodes.map((node) => [node.id, []]))
  const dagIn = new Map(nodes.map((node) => [node.id, []]))
  doc.edges.forEach((edge, index) => {
    if (feedback.has(index)) return
    if (!byId.has(edge.from) || !byId.has(edge.to)) return
    dagOut.get(edge.from).push(edge.to)
    dagIn.get(edge.to).push(edge.from)
  })

  const indegree = new Map(nodes.map((node) => [node.id, dagIn.get(node.id).length]))
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  const topo = []
  while (queue.length > 0) {
    const id = queue.shift()
    topo.push(id)
    for (const next of dagOut.get(id)) {
      indegree.set(next, indegree.get(next) - 1)
      if (indegree.get(next) === 0) queue.push(next)
    }
  }
  for (const node of nodes) node.layer = 0
  for (const id of topo) {
    const source = byId.get(id)
    for (const next of dagOut.get(id)) {
      const target = byId.get(next)
      if (target.layer < source.layer + 1) target.layer = source.layer + 1
    }
  }

  const layerCount = nodes.reduce((max, node) => Math.max(max, node.layer), 0) + 1
  const layers = Array.from({ length: layerCount }, () => [])
  for (const node of nodes) layers[node.layer].push(node)

  // --- step 4: barycenter sweeps ------------------------------------------
  const neighbours = (node, direction) =>
    (direction === 'up' ? incoming.get(node.id) ?? [] : outgoing.get(node.id) ?? [])
      .map((id) => byId.get(id))
      .filter((other) => other && other.layer !== node.layer)

  const positionIn = (layer) => {
    const map = new Map()
    layer.forEach((node, index) => map.set(node.id, index))
    return map
  }

  for (let sweep = 0; sweep < 4; sweep += 1) {
    const forward = sweep % 2 === 0
    const order2 = forward ? [...layers.keys()].slice(1) : [...layers.keys()].reverse().slice(0, -1)
    for (const layerIndex of order2) {
      const referenceLayer = layers[forward ? layerIndex - 1 : layerIndex + 1]
      if (!referenceLayer) continue
      const reference = positionIn(referenceLayer)
      const layer = layers[layerIndex]
      const scored = layer.map((node, index) => {
        const others = neighbours(node, forward ? 'up' : 'down')
        const positions = others.map((other) => reference.get(other.id)).filter((value) => value !== undefined)
        const barycenter = positions.length > 0 ? positions.reduce((sum, value) => sum + value, 0) / positions.length : index
        return { node, barycenter, tie: index }
      })
      scored.sort((a, b) => (a.barycenter - b.barycenter) || (a.tie - b.tie))
      layers[layerIndex] = scored.map((entry) => entry.node)
    }
  }

  // --- step 5: coordinates -------------------------------------------------
  const vertical = doc.direction === 'TB' || doc.direction === 'BT'
  const reversed = doc.direction === 'BT' || doc.direction === 'RL'

  // Band sizes along the rank axis and across it.
  const rankExtent = layers.map((layer) =>
    layer.reduce((max, node) => Math.max(max, vertical ? node.h : node.w), MIN_H),
  )
  const crossExtent = layers.map((layer) =>
    layer.reduce((total, node, index) => total + (vertical ? node.w : node.h) + (index > 0 ? doc.canvas.nodeSpacing : 0), 0),
  )
  const rankOffsets = []
  let cursor = 0
  for (let index = 0; index < layers.length; index += 1) {
    rankOffsets.push(cursor)
    cursor += rankExtent[index] + (index < layers.length - 1 ? doc.canvas.rankSpacing : 0)
  }
  const crossMax = crossExtent.reduce((max, value) => Math.max(max, value), 0)

  const orderedLayerIndex = reversed ? [...layers.keys()].reverse() : [...layers.keys()]
  orderedLayerIndex.forEach((layerIndex, rankPosition) => {
    const layer = layers[layerIndex]
    let cross = (crossMax - crossExtent[layerIndex]) / 2
    for (const node of layer) {
      const alongRank = rankOffsets[rankPosition]
      const rankSize = vertical ? node.h : node.w
      const crossSize = vertical ? node.w : node.h
      // Centre each node in its band so mixed sizes line up on the axis.
      const along = alongRank + (rankExtent[layerIndex] - rankSize) / 2
      if (vertical) {
        node.x = cross
        node.y = along
      } else {
        node.x = along
        node.y = cross
      }
      cross += crossSize + doc.canvas.nodeSpacing
    }
  })

  // Explicit positions win, snapped to the grid.
  for (const node of nodes) {
    if (!node.pinned) continue
    node.x = snap(node.pos[0])
    node.y = snap(node.pos[1])
  }
  for (const node of nodes) {
    node.cx = node.x + node.w / 2
    node.cy = node.y + node.h / 2
  }

  // Overlap detection, reported as a warning rather than an error: a pinned
  // node that collides is a readability problem, not a broken document.
  const overlapped = []
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i]
      const b = nodes[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        overlapped.push(`${a.id}/${b.id}`)
      }
    }
  }
  if (overlapped.length > 0) {
    warnings.push(`${overlapped.length} node pair${overlapped.length > 1 ? 's overlap' : ' overlaps'}: ${overlapped.join(', ')}. Check the explicit pos values.`)
  }
  for (const node of nodes) {
    if (node.truncated) warnings.push(`The label of "${node.id}" was truncated to fit its width.`)
  }

  // --- steps 6 and 7: anchors and routing ----------------------------------
  const pairCounts = new Map()
  for (const edge of doc.edges) {
    const key = `${edge.from}>${edge.to}`
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1)
  }
  const pairSeen = new Map()

  const edges = doc.edges.map((edge, index) => {
    const from = byId.get(edge.from)
    const to = byId.get(edge.to)
    if (!from || !to) return null

    const dx = to.cx - from.cx
    const dy = to.cy - from.cy
    const horizontal = Math.abs(dx) > Math.abs(dy)
    const fromSide = edge.fromSide !== 'auto' ? edge.fromSide : horizontal ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top')
    const toSide = edge.toSide !== 'auto' ? edge.toSide : horizontal ? (dx > 0 ? 'left' : 'right') : (dy > 0 ? 'top' : 'bottom')

    let start = anchorOf(from, fromSide)
    let end = anchorOf(to, toSide)

    const key = `${edge.from}>${edge.to}`
    const total = pairCounts.get(key) ?? 1
    const seenIndex = pairSeen.get(key) ?? 0
    pairSeen.set(key, seenIndex + 1)
    const offset = total > 1 ? (seenIndex - (total - 1) / 2) * PARALLEL_OFFSET : 0

    // Parallel edges separate by sliding their anchors along the side, not by
    // bending the run: a bend would collapse back into the same line whenever
    // the two nodes line up, leaving the edges on top of each other.
    if (offset !== 0) {
      const lateral = isVerticalSide(fromSide) ? { x: 1, y: 0 } : { x: 0, y: 1 }
      const fromLimit = (isVerticalSide(fromSide) ? from.w : from.h) / 2 - 6
      const toLimit = (isVerticalSide(toSide) ? to.w : to.h) / 2 - 6
      const fromShift = Math.max(-fromLimit, Math.min(fromLimit, offset))
      const toShift = Math.max(-toLimit, Math.min(toLimit, offset))
      start = { point: { x: start.point.x + lateral.x * fromShift, y: start.point.y + lateral.y * fromShift }, normal: start.normal }
      end = { point: { x: end.point.x + lateral.x * toShift, y: end.point.y + lateral.y * toShift }, normal: end.normal }
    }

    let kind = 'polyline'
    let points
    if (edge.route === 'straight') {
      points = [start.point, end.point]
    } else if (edge.route === 'curve') {
      kind = 'cubic'
      const distance = Math.max(48, Math.hypot(dx, dy) * 0.4)
      const c1 = shift(start.point, start.normal, distance)
      const c2 = shift(end.point, end.normal, distance)
      points = [start.point, c1, c2, end.point]
    } else {
      points = orthogonal(start, end, fromSide, toSide)
    }

    const label = edge.label
      ? edgeLabel(edge.label, points, kind, from.fontSize, nodes)
      : null

    return {
      from: edge.from,
      to: edge.to,
      index,
      feedback: feedback.has(index),
      route: edge.route,
      kind,
      points,
      label,
      arrow: edge.arrow,
      arrowShape: edge.arrowShape,
      style: edge.style,
      color: edge.color,
      width: edge.width,
      dashArray: edge.dashArray,
      startAngle: angleAt(points, 'start', kind),
      endAngle: angleAt(points, 'end', kind),
    }
  }).filter(Boolean)

  // --- step 8: groups ------------------------------------------------------
  const groups = doc.groups.map((group) => {
    const members = group.members.map((id) => byId.get(id)).filter(Boolean)
    if (members.length === 0) return null
    const hasLabel = typeof group.label === 'string' && group.label !== ''
    const x = Math.min(...members.map((node) => node.x)) - GROUP_PAD
    // A captioned group reserves its own band above the members; sharing the
    // plain padding band put the caption straight onto the topmost node.
    const y = Math.min(...members.map((node) => node.y)) - (hasLabel ? GROUP_PAD + GROUP_LABEL_BAND : GROUP_PAD)
    const right = Math.max(...members.map((node) => node.x + node.w)) + GROUP_PAD
    const bottom = Math.max(...members.map((node) => node.y + node.h)) + GROUP_PAD
    const w = right - x
    const caption = hasLabel ? truncateToWidth(group.label, w - 20, GROUP_LABEL_SIZE) : null
    return {
      id: group.id,
      label: caption === null ? '' : caption.text,
      labelWidth: caption === null ? 0 : caption.width,
      labelSize: GROUP_LABEL_SIZE,
      fill: group.fill,
      stroke: group.stroke,
      style: group.style,
      x,
      y,
      w,
      h: bottom - y,
    }
  }).filter(Boolean)

  // --- step 9: view box, then the legend in whatever room is left ----------
  // Edge-label boxes count as content too, otherwise a label below the last
  // node would fall outside the view box.
  const boxes = [
    ...nodes.map((node) => ({ x: node.x, y: node.y, right: node.x + node.w, bottom: node.y + node.h })),
    ...edges.flatMap((edge) => edge.points.map((point) => ({ x: point.x, y: point.y, right: point.x, bottom: point.y }))),
    ...groups.map((group) => ({ x: group.x, y: group.y, right: group.x + group.w, bottom: group.y + group.h })),
    ...edges.filter((edge) => edge.label).map((edge) => ({
      x: edge.label.x,
      y: edge.label.y,
      right: edge.label.x + edge.label.w,
      bottom: edge.label.y + edge.label.h,
    })),
  ]
  const pad = doc.canvas.padding
  const minX = Math.min(0, ...boxes.map((box) => box.x))
  const minY = Math.min(0, ...boxes.map((box) => box.y))
  const maxX = Math.max(0, ...boxes.map((box) => box.right))
  const maxY = Math.max(0, ...boxes.map((box) => box.bottom))
  let viewBox = {
    x: round(minX - pad),
    y: round(minY - pad),
    width: round(maxX - minX + 2 * pad),
    height: round(maxY - minY + 2 * pad),
  }

  // The legend lives in the bottom-right corner (design §6.5). If the corner
  // is already occupied, the canvas grows by a band below the content instead
  // of letting the legend sit on top of the graph.
  let legend = null
  if (doc.legend.length > 0) {
    const fontSize = defaultFontSize(doc)
    const size = legendSize(doc.legend, fontSize)
    // A legend can be wider than a narrow chart; grow the canvas rather than
    // let the caption run off the edge.
    const minimumWidth = size.w + 2 * LEGEND_PAD
    if (viewBox.width < minimumWidth) {
      viewBox = { ...viewBox, width: round(minimumWidth) }
    }

    const corner = {
      x: round(viewBox.x + viewBox.width - size.w - LEGEND_PAD),
      y: round(viewBox.y + viewBox.height - size.h - LEGEND_PAD),
      w: size.w,
      h: size.h,
    }
    if (legendCornerIsFree(corner, nodes, groups, edges)) {
      legend = legendGeometry(doc.legend, corner, fontSize)
    } else {
      const gap = 12
      viewBox = { ...viewBox, height: round(viewBox.height + size.h + gap) }
      legend = legendGeometry(doc.legend, {
        x: round(viewBox.x + viewBox.width - size.w - LEGEND_PAD),
        y: round(viewBox.y + viewBox.height - size.h - LEGEND_PAD),
        w: size.w,
        h: size.h,
      }, fontSize)
    }
  }

  return { viewBox, nodes: nodes.map(roundNode), edges: edges.map(roundEdge), groups: groups.map(roundRect), legend, warnings }
}

/** True when nothing the reader needs to see already occupies `box`. */
function legendCornerIsFree(box, nodes, groups, edges) {
  const margin = 4
  const overlaps = (other) =>
    box.x - margin < other.right && other.x < box.x + box.w + margin &&
    box.y - margin < other.bottom && other.y < box.y + box.h + margin

  for (const node of nodes) {
    if (overlaps({ x: node.x, y: node.y, right: node.x + node.w, bottom: node.y + node.h })) return false
  }
  for (const group of groups) {
    if (overlaps({ x: group.x, y: group.y, right: group.x + group.w, bottom: group.y + group.h })) return false
  }
  for (const edge of edges) {
    if (edge.label && overlaps({ x: edge.label.x, y: edge.label.y, right: edge.label.x + edge.label.w, bottom: edge.label.y + edge.label.h })) return false
    for (const point of edge.points) {
      if (point.x >= box.x - margin && point.x <= box.x + box.w + margin && point.y >= box.y - margin && point.y <= box.y + box.h + margin) return false
    }
  }
  return true
}

function defaultFontSize(doc) {
  return doc.nodes[0]?.fontSize ?? 13
}

// ---------------------------------------------------------------------------
// Anchors and routing
// ---------------------------------------------------------------------------

const NORMALS = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** The point on a node's outline a side refers to, plus that side's normal. */
function anchorOf(node, side) {
  const normal = NORMALS[side] ?? NORMALS.bottom
  const point = {
    x: node.x + node.w / 2 + normal.x * (node.w / 2),
    y: node.y + node.h / 2 + normal.y * (node.h / 2),
  }
  return { point, normal }
}

function shift(point, normal, distance) {
  return { x: point.x + normal.x * distance, y: point.y + normal.y * distance }
}

const isVerticalSide = (side) => side === 'top' || side === 'bottom'

/**
 * An orthogonal run from one anchor to another: out along each side's normal,
 * a connecting segment, then in to the target. Points are deduplicated so the
 * renderer can round every interior corner without special cases.
 */
function orthogonal(start, end, fromSide, toSide) {
  const out0 = shift(start.point, start.normal, STUB)
  const out1 = shift(end.point, end.normal, STUB)
  const points = [start.point, out0]

  if (isVerticalSide(fromSide) && isVerticalSide(toSide)) {
    const mid = (out0.y + out1.y) / 2
    points.push({ x: out0.x, y: mid }, { x: out1.x, y: mid })
  } else if (!isVerticalSide(fromSide) && !isVerticalSide(toSide)) {
    const mid = (out0.x + out1.x) / 2
    points.push({ x: mid, y: out0.y }, { x: mid, y: out1.y })
  } else if (isVerticalSide(fromSide)) {
    points.push({ x: out0.x, y: out1.y })
  } else {
    points.push({ x: out1.x, y: out0.y })
  }

  points.push(out1, end.point)
  return simplify(dedupe(points))
}

/**
 * Drop points that sit in the middle of a straight run. Without this a
 * straight drop between two stacked nodes would keep four collinear points and
 * the renderer would round three corners that are not corners.
 */
export function simplify(points) {
  if (points.length < 3) return points
  const out = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = out[out.length - 1]
    const current = points[index]
    const next = points[index + 1]
    const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x)
    if (Math.abs(cross) < 0.01) continue
    out.push(current)
  }
  out.push(points[points.length - 1])
  return out
}

function dedupe(points) {
  const out = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - point.x) < 0.01 && Math.abs(last.y - point.y) < 0.01) continue
    out.push(point)
  }
  return out
}

/** Direction of travel leaving (`start`) or arriving at (`end`) the path. */
function angleAt(points, which, kind) {
  if (points.length < 2) return 0
  if (kind === 'cubic') {
    const p0 = points[0]
    const c1 = points[1]
    const c2 = points[2]
    const p3 = points[3]
    const from = which === 'start' ? p0 : c2
    const to = which === 'start' ? c1 : p3
    return Math.atan2(to.y - from.y, to.x - from.x)
  }
  if (which === 'start') {
    const [a, b] = points
    return Math.atan2(b.y - a.y, b.x - a.x)
  }
  const a = points[points.length - 2]
  const b = points[points.length - 1]
  return Math.atan2(b.y - a.y, b.x - a.x)
}

/** Where an edge label sits: the middle of the run, with its own box. */
function edgeLabel(text, points, kind, fontSize, nodes = []) {
  const style = { fontSize, mono: false }
  const wrapped = wrapText(text, style, { maxWidth: 160, maxLines: 2 })
  const width = wrapped.width + 8
  const height = wrapped.lines.length * fontSize * 1.25 + 4
  const anchor = labelAnchor(points, kind, nodes)
  return {
    lines: wrapped.lines,
    x: round2(anchor.x - width / 2),
    y: round2(anchor.y - height / 2),
    w: round2(width),
    h: round2(height),
    fontSize,
  }
}

/**
 * Where an edge label sits: the middle of the run, preferring a segment whose
 * midpoint is clear of every node. A label parked on top of a node is the one
 * placement a background mask cannot rescue, so it is worth a detour even
 * though the label itself renders above the shapes.
 */
function labelAnchor(points, kind, nodes) {
  const candidates = []

  if (kind === 'cubic') {
    // Sample the curve itself, not the chord: a feedback edge bows out around
    // the graph, so its halfway point is usually clear while the straight line
    // between its ends would cut through whatever sits in the middle.
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75, 0.15, 0.85]) candidates.push(cubicAt(points, t))
  } else if (points.length === 2) {
    for (const t of [0.5, 0.35, 0.65, 0.25, 0.75]) {
      candidates.push({
        x: points[0].x + (points[1].x - points[0].x) * t,
        y: points[0].y + (points[1].y - points[0].y) * t,
      })
    }
  } else {
    const segments = []
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = points[index]
      const b = points[index + 1]
      segments.push({ length: Math.hypot(b.x - a.x, b.y - a.y), middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } })
    }
    segments.sort((left, right) => right.length - left.length)
    candidates.push(...segments.map((segment) => segment.middle))
  }

  const clear = candidates.find((candidate) => !insideAnyNode(candidate, nodes))
  return clear ?? candidates[0]
}

/** A point on a cubic bezier, evaluated deterministically. */
function cubicAt(points, t) {
  const [p0, c1, c2, p3] = points
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return {
    x: a * p0.x + b * c1.x + c * c2.x + d * p3.x,
    y: a * p0.y + b * c1.y + c * c2.y + d * p3.y,
  }
}

/** Shorten text to `maxWidth`, ending with an ellipsis when it had to cut. */
function truncateToWidth(text, maxWidth, fontSize) {
  const style = { fontSize, mono: false }
  const full = measureLine(text, style)
  if (full <= maxWidth || maxWidth <= 0) return { text, width: Math.min(full, Math.max(0, maxWidth)) }
  const chars = [...text]
  const ellipsis = '…'
  const ellipsisWidth = measureLine(ellipsis, style)
  let kept = ''
  let width = 0
  for (const char of chars) {
    const next = measureLine(char, style)
    if (width + next + ellipsisWidth > maxWidth) break
    kept += char
    width += next
  }
  return { text: kept === '' ? ellipsis : `${kept}${ellipsis}`, width: width + ellipsisWidth }
}

/** True when the point falls inside a node box, allowing for a small margin. */
function insideAnyNode(point, nodes, margin = 2) {
  for (const node of nodes) {
    if (
      point.x >= node.x - margin &&
      point.x <= node.x + node.w + margin &&
      point.y >= node.y - margin &&
      point.y <= node.y + node.h + margin
    ) {
      return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Legend and rounding
// ---------------------------------------------------------------------------

/** The legend sits at the bottom right of the view box (design §6.5). */
/** The legend's own size, before a corner is chosen for it. */
function legendSize(items, fontSize) {
  const rows = items.map((item) => {
    const caption = truncateToWidth(item.label ?? '', LEGEND_LABEL_MAX, fontSize)
    return { shape: item.shape, label: caption.text, labelWidth: caption.width }
  })
  const icon = 22
  return {
    icon,
    rows,
    w: round2(Math.max(...rows.map((row) => icon + LEGEND_GAP + row.labelWidth), icon) + 2 * LEGEND_PAD),
    h: round2(rows.length * (fontSize * 1.6 + LEGEND_GAP) - LEGEND_GAP + 2 * LEGEND_PAD),
  }
}

/** Place the legend inside an already-chosen box. */
function legendGeometry(items, box, fontSize) {
  const size = legendSize(items, fontSize)
  return {
    x: round2(box.x),
    y: round2(box.y),
    w: size.w,
    h: size.h,
    icon: size.icon,
    rows: size.rows.map((row, index) => ({
      shape: row.shape,
      label: row.label,
      labelWidth: row.labelWidth,
      y: round2(index * (fontSize * 1.6 + LEGEND_GAP)),
    })),
    fontSize,
  }
}

const round2 = (value) => Math.round(value * 100) / 100

function roundNode(node) {
  return {
    ...node,
    x: round2(node.x),
    y: round2(node.y),
    w: round2(node.w),
    h: round2(node.h),
    cx: round2(node.cx),
    cy: round2(node.cy),
  }
}

function roundEdge(edge) {
  return {
    ...edge,
    points: edge.points.map((point) => ({ x: round2(point.x), y: round2(point.y) })),
    startAngle: round2(edge.startAngle),
    endAngle: round2(edge.endAngle),
  }
}

function roundRect(rect) {
  return { ...rect, x: round2(rect.x), y: round2(rect.y), w: round2(rect.w), h: round2(rect.h) }
}

export { STUB, CORNER, PARALLEL_OFFSET }