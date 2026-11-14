/**
 * GENERATED FILE — do not edit by hand.
 *
 * Built by scripts/build-client.mjs from lib/metrics.js, lib/layout.js,
 * lib/svg.js and client/ui.js. The browser module system resolves modules by
 * package id, so this half must be one self-contained bundle; the shared
 * layout and renderer sources are inlined here rather than duplicated.
 *
 * `node scripts/build-client.mjs --check` fails when this file is stale.
 */

window.__ModuleLoader__.load({
  id: '@local/dsh-plugin-flowchart',
  factory(require) {
    const React = require('react')
    const __modules = {}

    // ---- lib/metrics.js ----
    __modules['metrics'] = (function () {
      /**
       * FlowChart — text metrics (design §8 step 2).
       *
       * Layout runs in the browser, where `CanvasRenderingContext2D.measureText`
       * gives exact advances. But layout must also be reproducible in a test
       * process with no DOM, and the same document must yield the same topology on
       * every device. So the estimator below is the *definition* of width, and a
       * caller may inject a real measurer to refine the pixels without changing the
       * topology.
       *
       * Widths follow the design doc: CJK 1.0em per character, Latin 0.55em.
       */

      /** A code point that occupies a full em: CJK, Hangul, kana, fullwidth forms, emoji. */
      function isWide(codePoint) {
        return (
          (codePoint >= 0x1100 && codePoint <= 0x115f) ||
          (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
          (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
          (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
          (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
          (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
          (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
          (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
          (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
          (codePoint >= 0xff00 && codePoint <= 0xff60) ||
          (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
          (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
          (codePoint >= 0x20000 && codePoint <= 0x3fffd)
        )
      }

      /**
       * Advance width of one character at one font size.
       * @param {string} char a single code point
       * @param {{ fontSize: number, mono?: boolean }} style
       */
      function charWidth(char, style) {
        const size = style.fontSize
        const codePoint = char.codePointAt(0)
        if (style.mono) return size * 0.6
        if (isWide(codePoint)) return size
        if (char === ' ') return size * 0.28
        if (char === '\t') return size * 1.1
        if (/[iljt.,:;'!|]/.test(char)) return size * 0.3
        if (/[mwMW@]/.test(char)) return size * 0.9
        if (/[A-Z0-9]/.test(char)) return size * 0.62
        return size * 0.55
      }

      /**
       * Width of one already-broken line.
       * @param {string} line
       * @param {{ fontSize: number, mono?: boolean }} style
       * @param {(text: string, style: object) => number} [measurer] optional exact measurer
       */
      function measureLine(line, style, measurer) {
        if (measurer) {
          const exact = measurer(line, style)
          if (typeof exact === 'number' && Number.isFinite(exact) && exact >= 0) return exact
        }
        let width = 0
        for (const char of line) width += charWidth(char, style)
        return width
      }

      /** Candidate break points: after a wide character, or after a space. */
      function breakAfter(char) {
        if (char === ' ' || char === '\t' || char === '-') return true
        const codePoint = char.codePointAt(0)
        return isWide(codePoint)
      }

      /**
       * Break `text` into lines that fit `maxWidth`, honouring explicit newlines.
       *
       * Latin words stay whole (a word longer than the line is broken by character
       * as a last resort); CJK breaks between characters. When `maxLines` is given,
       * overflow is dropped and the last kept line is marked with an ellipsis, which
       * is how the design's "auto-wrap with overflow ellipsis" is implemented
       * without a layout engine.
       *
       * @param {string} text
       * @param {{ fontSize: number, mono?: boolean }} style
       * @param {{ maxWidth: number, maxLines?: number, measurer?: Function }} options
       * @returns {{ lines: string[], truncated: boolean, width: number }}
       */
      function wrapText(text, style, options) {
        const maxWidth = Math.max(1, options.maxWidth)
        const measurer = options.measurer
        const maxLines = options.maxLines ?? Infinity
        const lines = []

        for (const paragraph of String(text).split('\n')) {
          if (paragraph === '') {
            lines.push('')
            continue
          }
          let current = ''
          let width = 0
          let pendingWord = ''

          const flushWord = () => {
            if (pendingWord === '') return
            const wordWidth = measureLine(pendingWord, style, measurer)
            if (width > 0 && width + wordWidth > maxWidth) {
              lines.push(current)
              current = pendingWord
              width = wordWidth
            } else {
              current += pendingWord
              width += wordWidth
            }
            pendingWord = ''
          }

          for (const char of paragraph) {
            if (breakAfter(char)) {
              flushWord()
              const advance = measureLine(char, style, measurer)
              if (width > 0 && width + advance > maxWidth) {
                lines.push(current)
                current = char === ' ' ? '' : char
                width = char === ' ' ? 0 : advance
              } else {
                current += char
                width += advance
              }
              continue
            }
            pendingWord += char
          }
          flushWord()
          if (current !== '' || paragraph === '') lines.push(current)
        }

        let truncated = false
        let kept = lines
        if (lines.length > maxLines) {
          kept = lines.slice(0, maxLines)
          truncated = true
          const last = kept[kept.length - 1] ?? ''
          kept = [...kept.slice(0, -1), `${last}…`]
        }

        let width = 0
        for (const line of kept) width = Math.max(width, measureLine(line, style, measurer))
        return { lines: kept, truncated, width }
      }

      return { charWidth, measureLine, wrapText }
    })()

    // ---- lib/layout.js ----
    __modules['layout'] = (function () {
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

          const { measureLine, wrapText } = __modules['metrics']

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
      function layoutDoc(doc, options = {}) {
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
      function simplify(points) {
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



      return { layoutDoc, simplify, STUB, CORNER, PARALLEL_OFFSET }
    })()

    // ---- lib/svg.js ----
    __modules['svg'] = (function () {
      /**
       * FlowChart — SVG renderer.
       *
       * Turns the geometry from `lib/layout.js` into one self-contained SVG string.
       * No DOM is touched, which is what lets the same code serve the sidebar, the
       * export buttons, and the tests.
       *
       * Theming: `auto` colors resolve to a host CSS token with a concrete fallback,
       * `var(--dsw-alias-x, #fallback)`. Inside the app the token wins, so light and
       * dark both work; opened as a standalone file the fallback wins, so an export
       * never renders as invisible black-on-black. An explicit `theme: light|dark`
       * (design §6.1) bypasses the tokens and emits concrete colors.
       *
       * Safety (design §15): text is XML-escaped, and no script, `foreignObject`,
       * external reference, or event attribute is ever emitted.
       */

      // Single-quoted family names on purpose: these strings also land inside
      // double-quoted XML attributes, where a double quote would end the attribute.
      const FONT_SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif"
      const FONT_MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

      /** Concrete colors used when a token is absent, per theme. */
      const FALLBACK = {
        canvas: { light: '#ffffff', dark: '#17181c' },
        nodeFill: { light: '#ffffff', dark: '#20232a' },
        nodeStroke: { light: '#c2cad8', dark: '#3c424c' },
        text: { light: '#1f2329', dark: '#e7e9ee' },
        textMuted: { light: '#5f6772', dark: '#a2aab6' },
        edge: { light: '#7b8698', dark: '#8b94a3' },
        groupFill: { light: '#f4f6fa', dark: '#23262c' },
        groupStroke: { light: '#cfd6e2', dark: '#3c424c' },
      }

      /** The host tokens these fallbacks pair with (`ui-primitives` theme tokens). */
      const TOKEN = {
        canvas: '--dsw-specific-sidebar-fill',
        nodeFill: '--dsw-alias-bg-layer-1',
        nodeStroke: '--dsw-alias-border-l2',
        text: '--dsw-alias-label-primary',
        textMuted: '--dsw-alias-label-secondary',
        edge: '--dsw-alias-label-secondary',
        groupFill: '--dsw-alias-bg-layer-2',
        groupStroke: '--dsw-alias-border-l1',
      }

      const SHAPE_NAMES = [
        'rect', 'rounded', 'stadium', 'ellipse', 'circle', 'diamond', 'hexagon',
        'parallelogram', 'cylinder', 'document', 'cloud', 'triangle', 'star', 'note', 'subroutine',
      ]

      /** Arrowhead length at stroke width 1.5; scales with the line's width. */
      const ARROW_LENGTH = 9

      function escapeXml(value) {
        return String(value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
      }

      /** Trim float noise: 12 -> "12", 12.5 -> "12.5", 12.345 -> "12.35". */
      function n(value) {
        if (!Number.isFinite(value)) return '0'
        const rounded = Math.round(value * 100) / 100
        return String(rounded)
      }

      /**
       * Resolve a DSL color to an SVG paint value.
       * @param {string} color `auto`, `none`, or a concrete color
       * @param {keyof typeof TOKEN} token which theme role `auto` maps to
       * @param {'auto'|'light'|'dark'} theme the document's theme setting
       */
      function resolveColor(color, token, theme) {
        if (color === 'none') return 'none'
        const role = token in TOKEN ? token : 'text'
        if (color !== 'auto') return color
        const fallback = FALLBACK[role].light
        if (theme === 'light') return FALLBACK[role].light
        if (theme === 'dark') return FALLBACK[role].dark
        return `var(${TOKEN[role]}, ${fallback})`
      }

      /**
       * A few CSS color names resolved to hex, only for the text-contrast decision
       * below. Anything not listed falls back to the theme's text token, so an
       * unknown name never changes behavior.
       */
      const KEYWORD_HEX = {
        black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
        yellow: '#ffff00', orange: '#ffa500', purple: '#800080', pink: '#ffc0cb', brown: '#a52a2a',
        gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', navy: '#000080',
        olive: '#808000', lime: '#00ff00', aqua: '#00ffff', cyan: '#00ffff', teal: '#008080',
        fuchsia: '#ff00ff', magenta: '#ff00ff', gold: '#ffd700', coral: '#ff7f50', salmon: '#fa8072',
        tomato: '#ff6347', crimson: '#dc143c', indigo: '#4b0082', violet: '#ee82ee', khaki: '#f0e68c',
        steelblue: '#4682b4', royalblue: '#4169e1', dodgerblue: '#1e90ff', seagreen: '#2e8b57',
        forestgreen: '#228b22', darkred: '#8b0000', darkgreen: '#006400', darkblue: '#00008b',
        slategray: '#708090', lightgray: '#d3d3d3', lightgrey: '#d3d3d3',
      }

      /** Hex form of a color the renderer can reason about, or null. */
      function toHex(value) {
        if (typeof value !== 'string') return null
        const lower = value.trim().toLowerCase()
        if (/^#[0-9a-f]{6}$/.test(lower)) return lower
        if (/^#[0-9a-f]{3}$/.test(lower)) return `#${lower[1]}${lower[1]}${lower[2]}${lower[2]}${lower[3]}${lower[3]}`
        return KEYWORD_HEX[lower] ?? null
      }

      /** WCAG relative luminance. */
      function luminance(hex) {
        const channels = [1, 3, 5].map((offset) => {
          const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
          return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
      }

      const DARK_INK = '#1f2329'
      const LIGHT_INK = '#ffffff'

      /**
       * Text color for a node.
       *
       * An explicit `color` always wins, and `color: auto` means the theme's text
       * token — except on an explicitly filled shape, where the theme's ink can be
       * invisible (dark ink on a dark fill). There the choice follows the fill's
       * luminance, picking whichever of the two inks contrasts more. This is a
       * deliberate refinement of §6.2 ("auto = 主题前景"): without it every colored
       * node needs the author to restate a readable `color` by hand.
       */
      function resolveTextColor(node, theme) {
        if (node.color !== 'auto') return resolveColor(node.color, 'text', theme)
        const fill = node.fill
        if (fill === 'auto' || fill === 'none' || fill === 'transparent') return resolveColor('auto', 'text', theme)
        const hex = toHex(fill)
        if (hex === null) return resolveColor('auto', 'text', theme)
        const background = luminance(hex)
        const onLight = 1.05 / (background + 0.05)
        const onDark = (background + 0.05) / (luminance(DARK_INK) + 0.05)
        return onLight >= onDark ? LIGHT_INK : DARK_INK
      }

      /** A stroked, filled shape element for one node or legend swatch. */
      function shapeElement(shape, box, paint) {
        const { x, y, w, h } = box
        const cx = x + w / 2
        const cy = y + h / 2
        // Every shape keeps its stroke width when the chart is zoomed (design §12),
        // rect-like shapes included.
        const attrs = paint({ fill: true, stroke: true, extra: 'vector-effect="non-scaling-stroke"' })

        switch (shape) {
          case 'rect':
            return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${attrs}/>`
          case 'rounded':
            return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8" ${attrs}/>`
          case 'stadium':
            return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" ${attrs}/>`
          case 'ellipse':
            return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${attrs}/>`
          case 'circle':
            return `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(Math.min(w, h) / 2)}" ${attrs}/>`
          case 'diamond':
            return `<path d="M ${n(cx)} ${n(y)} L ${n(x + w)} ${n(cy)} L ${n(cx)} ${n(y + h)} L ${n(x)} ${n(cy)} Z" ${attrs}/>`
          case 'hexagon': {
            const inset = Math.min(w * 0.18, h * 0.5)
            return `<path d="M ${n(x + inset)} ${n(y)} H ${n(x + w - inset)} L ${n(x + w)} ${n(cy)} L ${n(x + w - inset)} ${n(y + h)} H ${n(x + inset)} L ${n(x)} ${n(cy)} Z" ${attrs}/>`
          }
          case 'parallelogram': {
            const skew = Math.min(w * 0.2, 26)
            return `<path d="M ${n(x + skew)} ${n(y)} H ${n(x + w)} L ${n(x + w - skew)} ${n(y + h)} H ${n(x)} Z" ${attrs}/>`
          }
          case 'cylinder': {
            const ry = Math.min(h * 0.18, 14)
            const rx = w / 2
            return `<path d="M ${n(x)} ${n(y + ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(x + w)} ${n(y + ry)} V ${n(y + h - ry)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(x)} ${n(y + h - ry)} Z" ${attrs}/><path d="M ${n(x)} ${n(y + ry)} A ${n(rx)} ${n(ry)} 0 0 0 ${n(x + w)} ${n(y + ry)}" ${paint({ fill: false, stroke: true, extra: 'vector-effect="non-scaling-stroke"' })}/>`
          }
          case 'document': {
            const wave = Math.min(h * 0.18, 14)
            return `<path d="M ${n(x)} ${n(y)} H ${n(x + w)} V ${n(y + h - wave)} C ${n(x + w * 0.75)} ${n(y + h - wave * 2)} ${n(x + w * 0.25)} ${n(y + h + wave * 0.4)} ${n(x)} ${n(y + h - wave)} Z" ${attrs}/>`
          }
          case 'cloud': {
            const rx = w * 0.26
            const ry = h * 0.3
            return `<path d="M ${n(x + rx)} ${n(y + h - ry * 0.4)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(x + rx * 1.5)} ${n(y + ry * 0.5)} A ${n(rx * 0.95)} ${n(ry)} 0 0 1 ${n(x + w - rx)} ${n(y + ry * 0.75)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(x + w - rx * 0.5)} ${n(y + h - ry * 0.4)} Z" ${attrs}/>`
          }
          case 'triangle':
            return `<path d="M ${n(cx)} ${n(y)} L ${n(x + w)} ${n(y + h)} L ${n(x)} ${n(y + h)} Z" ${attrs}/>`
          case 'star': {
            const outer = Math.min(w, h) / 2
            const inner = outer * 0.42
            const points = []
            for (let index = 0; index < 10; index += 1) {
              const radius = index % 2 === 0 ? outer : inner
              const angle = -Math.PI / 2 + (index * Math.PI) / 5
              points.push(`${n(cx + Math.cos(angle) * radius)} ${n(cy + Math.sin(angle) * radius)}`)
            }
            return `<path d="M ${points.join(' L ')} Z" ${attrs}/>`
          }
          case 'note': {
            const fold = Math.min(w * 0.18, 18)
            return `<path d="M ${n(x)} ${n(y)} H ${n(x + w - fold)} L ${n(x + w)} ${n(y + fold)} V ${n(y + h)} H ${n(x)} Z" ${attrs}/><path d="M ${n(x + w - fold)} ${n(y)} V ${n(y + fold)} H ${n(x + w)}" ${paint({ fill: false, stroke: true, extra: 'vector-effect="non-scaling-stroke"' })}/>`
          }
          case 'subroutine': {
            const inset = Math.min(w * 0.12, 14)
            return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${attrs}/><path d="M ${n(x + inset)} ${n(y)} V ${n(y + h)} M ${n(x + w - inset)} ${n(y)} V ${n(y + h)}" ${paint({ fill: false, stroke: true, extra: 'vector-effect="non-scaling-stroke"' })}/>`
          }
          default:
            return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="8" ${attrs}/>`
        }
      }

      /** Rounded polyline: straight runs plus quadratic corners at real turns. */
      function roundedPolylinePath(points, radius) {
        if (points.length === 0) return ''
        if (points.length === 1) return `M ${n(points[0].x)} ${n(points[0].y)}`
        if (points.length === 2) return `M ${n(points[0].x)} ${n(points[0].y)} L ${n(points[1].x)} ${n(points[1].y)}`

        let d = `M ${n(points[0].x)} ${n(points[0].y)}`
        for (let index = 1; index < points.length - 1; index += 1) {
          const previous = points[index - 1]
          const corner = points[index]
          const next = points[index + 1]
          const inLength = Math.hypot(corner.x - previous.x, corner.y - previous.y)
          const outLength = Math.hypot(next.x - corner.x, next.y - corner.y)
          const r = Math.min(radius, inLength / 2, outLength / 2)
          if (r < 0.5) {
            d += ` L ${n(corner.x)} ${n(corner.y)}`
            continue
          }
          const entry = {
            x: corner.x - ((corner.x - previous.x) / inLength) * r,
            y: corner.y - ((corner.y - previous.y) / inLength) * r,
          }
          const exit = {
            x: corner.x + ((next.x - corner.x) / outLength) * r,
            y: corner.y + ((next.y - corner.y) / outLength) * r,
          }
          d += ` L ${n(entry.x)} ${n(entry.y)} Q ${n(corner.x)} ${n(corner.y)} ${n(exit.x)} ${n(exit.y)}`
        }
        const last = points[points.length - 1]
        d += ` L ${n(last.x)} ${n(last.y)}`
        return d
      }

      function dashPattern(edge) {
        if (edge.dashArray) return `${n(edge.dashArray[0])} ${n(edge.dashArray[1])}`
        if (edge.style === 'dashed') return '6 4'
        if (edge.style === 'dotted') return '1.5 3'
        return null
      }

      /**
       * An arrowhead at `(x, y)` pointing along `angle`.
       * Drawn as a real shape rather than an SVG marker so it takes the edge's own
       * color, needs no `defs` id, and survives being pasted into another document.
       */
      function arrowElement(shape, x, y, angle, size, color, strokeWidth) {
        const length = Math.max(size, strokeWidth * 3)
        const half = length * 0.5
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)
        const forward = (distance) => ({ x: x - cos * distance, y: y - sin * distance })
        const side = (distance, lateral) => ({
          x: x - cos * distance - sin * lateral,
          y: y - sin * distance + cos * lateral,
        })

        switch (shape) {
          case 'vee': {
            const a = forward(length)
            const b = side(length, half)
            const c = side(length, -half)
            return `<path d="M ${n(b.x)} ${n(b.y)} L ${n(x)} ${n(y)} L ${n(c.x)} ${n(c.y)}" fill="none" stroke="${color}" stroke-width="${n(strokeWidth)}" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`
          }
          case 'line': {
            const b = side(0, half)
            const c = side(0, -half)
            return `<path d="M ${n(b.x)} ${n(b.y)} L ${n(c.x)} ${n(c.y)}" fill="none" stroke="${color}" stroke-width="${n(strokeWidth)}" vector-effect="non-scaling-stroke"/>`
          }
          case 'circle': {
            const center = forward(half * 0.6)
            return `<circle cx="${n(center.x)}" cy="${n(center.y)}" r="${n(half * 0.6)}" fill="${color}" stroke="none"/>`
          }
          case 'diamond': {
            const a = forward(length)
            const b = side(length * 0.5, half * 0.7)
            const c = side(length * 0.5, -half * 0.7)
            return `<path d="M ${n(x)} ${n(y)} L ${n(b.x)} ${n(b.y)} L ${n(a.x)} ${n(a.y)} L ${n(c.x)} ${n(c.y)} Z" fill="${color}" stroke="none"/>`
          }
          default: {
            const b = side(length, half)
            const c = side(length, -half)
            return `<path d="M ${n(x)} ${n(y)} L ${n(b.x)} ${n(b.y)} L ${n(c.x)} ${n(c.y)} Z" fill="${color}" stroke="none"/>`
          }
        }
      }

      function nodeTextElement(node, theme) {
        const color = resolveTextColor(node, theme)
        const anchor = node.align === 'left' ? 'start' : node.align === 'right' ? 'end' : 'middle'
        const x = node.align === 'left' ? node.x + 8 : node.align === 'right' ? node.x + node.w - 8 : node.cx
        const lineHeight = node.fontSize * 1.32
        const first = node.cy - ((node.lines.length - 1) * lineHeight) / 2 + node.fontSize * 0.34
        const family = node.mono ? FONT_MONO : FONT_SANS
        const weight = node.bold ? ' font-weight="600"' : ''
        const tspans = node.lines
          .map((line, index) => `<tspan x="${n(x)}" y="${n(first + index * lineHeight)}">${escapeXml(line)}</tspan>`)
          .join('')
        return `<text class="fc-text" x="${n(x)}" y="${n(first)}" text-anchor="${anchor}" font-size="${n(node.fontSize)}" font-family="${family}"${weight} fill="${color}">${tspans}</text>`
      }

      function edgeLabelElement(label, theme) {
        const background = resolveColor('auto', 'canvas', theme)
        const color = resolveColor('auto', 'textMuted', theme)
        const lineHeight = label.fontSize * 1.25
        const first = label.y + label.h / 2 - ((label.lines.length - 1) * lineHeight) / 2 + label.fontSize * 0.34
        const tspans = label.lines
          .map((line, index) => `<tspan x="${n(label.x + label.w / 2)}" y="${n(first + index * lineHeight)}">${escapeXml(line)}</tspan>`)
          .join('')
        return `<g class="fc-edge-label"><rect x="${n(label.x)}" y="${n(label.y)}" width="${n(label.w)}" height="${n(label.h)}" rx="3" fill="${background}" fill-opacity="0.9" stroke="none"/><text x="${n(label.x + label.w / 2)}" y="${n(first)}" text-anchor="middle" font-size="${n(label.fontSize)}" font-family="${FONT_SANS}" fill="${color}">${tspans}</text></g>`
      }

      function legendElement(legend, theme) {
        if (!legend) return ''
        const background = resolveColor('auto', 'canvas', theme)
        const border = resolveColor('auto', 'groupStroke', theme)
        const text = resolveColor('auto', 'textMuted', theme)
        const parts = [
          `<rect x="${n(legend.x)}" y="${n(legend.y)}" width="${n(legend.w)}" height="${n(legend.h)}" rx="6" fill="${background}" fill-opacity="0.92" stroke="${border}" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
        ]
        const iconW = legend.icon
        ;(legend.rows ?? []).forEach((row) => {
          const box = {
            x: legend.x + 8,
            y: legend.y + 8 + row.y + (legend.fontSize * 1.6 - legend.fontSize * 1.1) / 2,
            w: iconW,
            h: Math.max(10, legend.fontSize * 1.1),
          }
          const paint = ({ fill, stroke }) =>
            [
              fill ? `fill="${resolveColor('auto', 'nodeFill', theme)}"` : 'fill="none"',
              stroke ? `stroke="${resolveColor('auto', 'nodeStroke', theme)}" stroke-width="1.2"` : 'stroke="none"',
            ].join(' ')
          parts.push(shapeElement(row.shape, box, (options) => `${paint(options)} ${options.extra ?? ''}`.trim()))
          parts.push(`<text x="${n(box.x + iconW + 6)}" y="${n(box.y + box.h / 2 + legend.fontSize * 0.34)}" font-size="${n(legend.fontSize)}" font-family="${FONT_SANS}" fill="${text}">${escapeXml(row.label)}</text>`)
        })
        return `<g class="fc-legend">${parts.join('')}</g>`
      }

      /**
       * Render a document and its geometry to one SVG string.
       * @param {object} doc normalized document
       * @param {object} geometry the result of `layoutDoc`
       * @param {{ title?: string, background?: boolean }} [options]
       */
      function renderSvg(doc, geometry, options = {}) {
        const theme = doc.theme === 'light' || doc.theme === 'dark' ? doc.theme : 'auto'
        const { viewBox } = geometry
        const background = options.background !== false
        const parts = []

        parts.push(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(viewBox.x)} ${n(viewBox.y)} ${n(viewBox.width)} ${n(viewBox.height)}" width="${n(viewBox.width)}" height="${n(viewBox.height)}" role="img" aria-label="${escapeXml(options.title ?? doc.title ?? doc.id)}" style="font-family:${FONT_SANS};shape-rendering:geometricPrecision">`,
        )

        if (background) {
          parts.push(`<rect class="fc-canvas" x="${n(viewBox.x)}" y="${n(viewBox.y)}" width="${n(viewBox.width)}" height="${n(viewBox.height)}" fill="${resolveColor('auto', 'canvas', theme)}"/>`)
        }

        // Groups sit under everything (design §6.5).
        if (geometry.groups.length > 0) {
          const boxes = geometry.groups.map((group) => {
            const fill = group.fill === 'none' ? 'none' : resolveColor(group.fill, 'groupFill', theme)
            const stroke = resolveColor(group.stroke, 'groupStroke', theme)
            const dash = group.style === 'dashed' ? ' stroke-dasharray="6 4"' : group.style === 'dotted' ? ' stroke-dasharray="1.5 3"' : ''
            const label = group.label
              ? `<text x="${n(group.x + 10)}" y="${n(group.y + 21)}" font-size="${n(group.labelSize ?? 12)}" font-family="${FONT_SANS}" fill="${resolveColor('auto', 'textMuted', theme)}">${escapeXml(group.label)}</text>`
              : ''
            return `<g class="fc-group"><rect x="${n(group.x)}" y="${n(group.y)}" width="${n(group.w)}" height="${n(group.h)}" rx="10" fill="${fill}" fill-opacity="${group.fill === 'auto' ? '0.55' : '1'}" stroke="${stroke}" stroke-width="1"${dash} vector-effect="non-scaling-stroke"/>${label}</g>`
          })
          parts.push(`<g class="fc-groups">${boxes.join('')}</g>`)
        }

        // Edges, then their labels, then nodes: a label never hides under a line.
        const edgePaths = []
        const edgeLabels = []
        for (const edge of geometry.edges) {
          const color = resolveColor(edge.color, 'edge', theme)
          const dash = dashPattern(edge)
          const d = edge.kind === 'cubic'
            ? `M ${n(edge.points[0].x)} ${n(edge.points[0].y)} C ${n(edge.points[1].x)} ${n(edge.points[1].y)} ${n(edge.points[2].x)} ${n(edge.points[2].y)} ${n(edge.points[3].x)} ${n(edge.points[3].y)}`
            : roundedPolylinePath(edge.points, 8)
          // One group per edge: the line and its heads stay together, which keeps
          // an edge addressable for hit-testing later and makes each edge's parts
          // checkable in the tests.
          const group = [
            `<path class="fc-edge" d="${d}" fill="none" stroke="${color}" stroke-width="${n(edge.width)}"${dash ? ` stroke-dasharray="${dash}"` : ''} stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`,
          ]
          const size = ARROW_LENGTH + (edge.width - 1.5) * 2
          if (edge.arrow === 'end' || edge.arrow === 'both') {
            group.push(arrowElement(edge.arrowShape, edge.points.at(-1).x, edge.points.at(-1).y, edge.endAngle, size, color, edge.width))
          }
          if (edge.arrow === 'start' || edge.arrow === 'both') {
            const head = edge.points[0]
            group.push(arrowElement(edge.arrowShape, head.x, head.y, edge.startAngle + Math.PI, size, color, edge.width))
          }
          edgePaths.push(`<g class="fc-edge-item" data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}">${group.join('')}</g>`)
          if (edge.label) edgeLabels.push(edgeLabelElement(edge.label, theme))
        }
        parts.push(`<g class="fc-edges">${edgePaths.join('')}</g>`)

        const nodeParts = geometry.nodes.map((node) => {
          const paint = ({ fill, stroke, extra }) =>
            [
              fill ? `fill="${resolveColor(node.fill, 'nodeFill', theme)}"` : 'fill="none"',
              stroke && node.strokeWidth > 0 ? `stroke="${resolveColor(node.stroke, 'nodeStroke', theme)}" stroke-width="${n(node.strokeWidth)}"` : 'stroke="none"',
              node.dashed ? 'stroke-dasharray="6 4"' : '',
              extra,
            ]
              .filter(Boolean)
              .join(' ')
          const shape = `<g class="fc-node" data-node-id="${escapeXml(node.id)}" data-shape="${escapeXml(node.shape)}">${shapeElement(node.shape, node, paint)}${nodeTextElement(node, theme)}</g>`
          return shape
        })
        parts.push(`<g class="fc-nodes">${nodeParts.join('')}</g>`)

        // Labels go above the shapes: each carries a background mask precisely so
        // that it stays readable wherever it lands (design §6.4).
        if (edgeLabels.length > 0) parts.push(`<g class="fc-edge-labels">${edgeLabels.join('')}</g>`)

        const legend = legendElement(geometry.legend, theme)
        if (legend) parts.push(legend)

        parts.push('</svg>')
        return parts.join('')
      }



      return { resolveColor, resolveTextColor, shapeElement, roundedPolylinePath, arrowElement, renderSvg, SHAPE_NAMES, FONT_SANS, FONT_MONO }
    })()

    // ---- client/ui.js ----
    __modules['ui'] = (function () {
      /**
       * FlowChart — Web Client UI.
       *
       * An ordinary ESM module so the Node test suites can import it and drive the
       * components with a fake React. `scripts/build-client.mjs` inlines it (and the
       * shared layout/renderer sources) into the single-file bundle the browser
       * module system requires.
       *
       * Two surfaces, per design §10 and §11:
       *   - the sidebar tab body: toolbar, canvas with zoom/pan, export menu;
       *   - the conversation tool card: title, stats, thumbnail, open button, and the
       *     first validation errors when the call was rejected.
       *
       * Nothing here validates a document: the Host already did, and the projection
       * carries the normalized result. The Client only lays out and draws.
       */

          const { layoutDoc } = __modules['layout']
          const { renderSvg } = __modules['svg']

      /** Locale namespace, tab type id and slot key. */
      const NS = '@local/dsh-plugin-flowchart'
      const TAB_ID = NS
      const KIND = 'flowchart'
      const PROJECTION_KEY = 'flowchart'

      const zh = {
        'tab.title': '流程图',
        'guide.title': '流程图',
        'guide.description': '在边栏里看懂步骤、分支与结构',
        'empty.title': '还没有流程图',
        'empty.hint': '当解释涉及步骤、分支、循环或组件关系时，助手会在这里画出流程图。',
        'card.drawing': '正在绘制流程图…',
        'card.preparing': '准备绘制流程图',
        'card.rejected': '图未通过校验',
        'card.rejectedHint': '助手会按下面的提示修正后重试。',
        'card.nodes': '{count} 节点',
        'card.edges': '{count} 连线',
        'card.open': '在右侧边栏打开',
        'error.title': '这张图无法绘制',
        'error.hint': '图的文档与当前版本不兼容，让助手重新调用一次 FlowChart 即可。',
        'error.short': '缩略图无法绘制',
        'card.sourceFile': '来自文件',
        'card.sourceInline': '内联 YAML',
        'toolbar.direction': '方向',
        'toolbar.zoomIn': '放大',
        'toolbar.zoomOut': '缩小',
        'toolbar.fit': '适应',
        'toolbar.actual': '100%',
        'toolbar.export': '导出',
        'toolbar.chart': '图',
        'export.copySvg': '复制 SVG',
        'export.downloadSvg': '下载 SVG',
        'export.downloadPng': '下载 PNG',
        'export.copied': '已复制 SVG',
        'export.failed': '导出失败',
        'canvas.label': '流程图：{title}',
        'source.path': '来源文件：{path}',
        'source.inline': '内容为调用时的快照，之后改动源文件不会自动更新。',
        'direction.value.tb': '自上而下',
        'direction.value.bt': '自下而上',
        'direction.value.lr': '从左到右',
        'direction.value.rl': '从右到左',
        'shape.rect': '步骤',
        'shape.rounded': '步骤',
        'shape.stadium': '起止',
        'shape.ellipse': '状态',
        'shape.circle': '事件',
        'shape.diamond': '判断',
        'shape.hexagon': '准备',
        'shape.parallelogram': '输入/输出',
        'shape.cylinder': '存储',
        'shape.document': '文档',
        'shape.cloud': '外部',
        'shape.triangle': '触发',
        'shape.star': '强调',
        'shape.note': '注释',
        'shape.subroutine': '子流程',
      }

      const en = {
        'tab.title': 'Flow Chart',
        'guide.title': 'Flow Chart',
        'guide.description': 'See steps, branches and structure in the sidebar',
        'empty.title': 'No flow chart yet',
        'empty.hint': 'When an explanation involves steps, branches, loops, or component relationships, the assistant draws it here.',
        'card.drawing': 'Drawing the flow chart…',
        'card.preparing': 'Preparing a flow chart',
        'card.rejected': 'The chart did not pass validation',
        'card.rejectedHint': 'The assistant will fix it and try again.',
        'card.nodes': '{count} nodes',
        'card.edges': '{count} edges',
        'card.open': 'Open in the sidebar',
        'error.title': 'This chart could not be drawn',
        'error.hint': 'Its document does not match the current version. Ask the assistant to call FlowChart again.',
        'error.short': 'The preview could not be drawn',
        'card.sourceFile': 'From file',
        'card.sourceInline': 'Inline YAML',
        'toolbar.direction': 'Direction',
        'toolbar.zoomIn': 'Zoom in',
        'toolbar.zoomOut': 'Zoom out',
        'toolbar.fit': 'Fit',
        'toolbar.actual': '100%',
        'toolbar.export': 'Export',
        'toolbar.chart': 'Chart',
        'export.copySvg': 'Copy SVG',
        'export.downloadSvg': 'Download SVG',
        'export.downloadPng': 'Download PNG',
        'export.copied': 'SVG copied',
        'export.failed': 'Export failed',
        'canvas.label': 'Flow chart: {title}',
        'source.path': 'From file: {path}',
        'source.inline': 'A snapshot taken at call time; later edits to the file do not update it.',
        'direction.value.tb': 'Top to bottom',
        'direction.value.bt': 'Bottom to top',
        'direction.value.lr': 'Left to right',
        'direction.value.rl': 'Right to left',
        'shape.rect': 'Step',
        'shape.rounded': 'Step',
        'shape.stadium': 'Start / end',
        'shape.ellipse': 'State',
        'shape.circle': 'Event',
        'shape.diamond': 'Decision',
        'shape.hexagon': 'Preparation',
        'shape.parallelogram': 'Input / output',
        'shape.cylinder': 'Storage',
        'shape.document': 'Document',
        'shape.cloud': 'External',
        'shape.triangle': 'Trigger',
        'shape.star': 'Emphasis',
        'shape.note': 'Note',
        'shape.subroutine': 'Subroutine',
      }

      const DIRECTIONS = ['TB', 'BT', 'LR', 'RL']
      const SHAPE_ORDER = ['stadium', 'rounded', 'rect', 'diamond', 'hexagon', 'ellipse', 'circle', 'cylinder', 'document', 'parallelogram', 'cloud', 'note', 'subroutine', 'triangle', 'star']
      const MAX_LEGEND_ITEMS = 8
      const MIN_SCALE = 0.25
      const MAX_SCALE = 4

      const css = [
        '.dsh-fc{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;color:var(--dsw-alias-label-primary,#1c1c1c);font-size:13px;}',
        '.dsh-fc *{box-sizing:border-box;}',
        '.dsh-fc-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
        '.dsh-fc-spacer{flex:1;}',
        '.dsh-fc-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:26px;height:26px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;cursor:pointer;}',
        '.dsh-fc-btn:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04));}',
        '.dsh-fc-btn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary,#4f7cff);color:var(--dsw-alias-brand-primary,#4f7cff);}',
        '.dsh-fc-btn:disabled{opacity:.45;cursor:default;}',
        '.dsh-fc-select{height:26px;max-width:160px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit;padding:0 4px;}',
        '.dsh-fc-zoom{font-variant-numeric:tabular-nums;min-width:44px;text-align:center;color:var(--dsw-alias-label-secondary,#7a7a7a);}',
        '.dsh-fc-src{display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary,#7a7a7a);border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));}',
        '.dsh-fc-src code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.dsh-fc-stage{position:relative;flex:1;min-height:0;overflow:hidden;cursor:grab;background:var(--dsw-specific-sidebar-fill,transparent);}',
        '.dsh-fc-stage[data-dragging="true"]{cursor:grabbing;}',
        '.dsh-fc-layer{position:absolute;top:0;left:0;transform-origin:0 0;will-change:transform;}',
        '.dsh-fc-layer svg{display:block;max-width:none;height:auto;}',
        '.dsh-fc-empty{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:32px 24px;text-align:center;}',
        '.dsh-fc-empty-art{display:flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:16px;color:var(--dsw-alias-brand-primary,#4f7cff);background:var(--dsw-alias-bg-layer-2,#f2f2f4);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));}',
        '.dsh-fc-empty-title{margin:0;font-size:14px;font-weight:600;line-height:20px;}',
        '.dsh-fc-empty-hint{margin:0;max-width:280px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#7a7a7a);}',
        '.dsh-fc-toast{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;font-size:12px;background:var(--dsw-alias-bg-overlay,rgba(20,20,20,.9));color:var(--dsw-alias-label-primary,#fff);}',
        '.dsh-fc-card{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,transparent);}',
        '.dsh-fc-card-head{display:flex;align-items:center;gap:8px;font-size:13px;}',
        '.dsh-fc-card-title{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
        '.dsh-fc-card-meta{color:var(--dsw-alias-label-secondary,#7a7a7a);font-size:12px;white-space:nowrap;}',
        '.dsh-fc-card-thumb{display:block;width:100%;max-height:160px;overflow:hidden;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08));background:var(--dsw-specific-sidebar-fill,transparent);cursor:zoom-in;padding:0;}',
        '.dsh-fc-card-thumb svg{display:block;width:100%;height:auto;}',
        '.dsh-fc-card-actions{display:flex;align-items:center;gap:8px;}',
        '.dsh-fc-errors{margin:0;padding-left:18px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#d93f3f);}',
        '.dsh-fc-errors code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}',
        '.dsh-fc-muted{color:var(--dsw-alias-label-secondary,#7a7a7a);}',
        '@media (prefers-reduced-motion: reduce){.dsh-fc *{transition:none !important;animation:none !important;}}',
      ].join('')

      /**
       * The standalone SVG for an export: concrete colors only.
       *
       * Kept module-level and pure (the theme is passed in) so the test suites can
       * assert what an export actually contains without a browser or a download.
       *
       * @param {object} doc normalized document
       * @param {{ title?: string, theme?: 'light'|'dark', background?: boolean }} options
       */
      function buildExportSvg(doc, options = {}) {
        const theme = options.theme === 'dark' ? 'dark' : 'light'
        const base = { ...doc, theme: doc.theme === 'auto' ? theme : doc.theme }
        const geometry = layoutDoc(base)
        return renderSvg(base, geometry, { title: options.title, background: options.background !== false })
      }

      function createUi(React) {
        const h = React.createElement

        /** Set by `apply`: opens (or focuses) the chart tab. */
        let openChart = null
        /** Docs already auto-opened this browser session, so a manual close sticks. */
        const autoOpened = new Set()
        /** Current host theme id, for exports that must stand alone. */
        let hostTheme = () => 'light'

        /** The concrete theme an export should bake in. */
        function resolvedTheme(docTheme) {
          if (docTheme === 'light' || docTheme === 'dark') return docTheme
          return hostTheme() === 'dark' ? 'dark' : 'light'
        }
        /** Whether a session is the one on screen (design §10). */
        let sessionOnScreen = () => false
        /** Subscribe to the on-screen session changing. */
        let onScreenChanged = () => () => {}

        /** Package-owned artwork: three nodes, one branching arrow. */
        function Glyph(props) {
          const size = props && props.size ? props.size : 16
          return h('svg', {
            width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
            children: [
              h('rect', { key: 'a', x: 2.5, y: 2.5, width: 7, height: 5, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.5 }),
              h('rect', { key: 'b', x: 14.5, y: 2.5, width: 7, height: 5, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.5 }),
              h('path', { key: 'c', d: 'M12 11.5L16.5 16.5L7.5 21.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              h('path', { key: 'd', d: 'M6 8.5v3h6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
              h('circle', { key: 'e', cx: 6, cy: 17.5, r: 4, stroke: 'currentColor', strokeWidth: 1.5 }),
            ],
          })
        }

        const t = (translate, key, params) => (typeof translate === 'function' ? translate(key, params) : key)

        /** The projection value, or an empty shell while the key is absent. */
        function useChartProjection(useProjection) {
          const value = typeof useProjection === 'function' ? useProjection(PROJECTION_KEY) : undefined
          return {
            charts: value && Array.isArray(value.charts) ? value.charts : [],
            failures: value && Array.isArray(value.failures) ? value.failures : [],
            openSeq: value ? value.openSeq : null,
            lastId: value && typeof value.lastId === 'string' ? value.lastId : null,
            settings: (value && value.settings) || { autoOpen: true, defaultDirection: 'TB', showLegendByDefault: false, export: { svg: true, png: true } },
          }
        }

        /** A legend synthesised from the shapes in use, when the config asks for one. */
        function withLegend(doc, translate, force) {
          if (!force || doc.legend.length > 0) return doc
          const used = []
          for (const shape of SHAPE_ORDER) {
            if (doc.nodes.some((node) => node.shape === shape)) used.push(shape)
          }
          if (used.length === 0) return doc
          return {
            ...doc,
            legend: used.slice(0, MAX_LEGEND_ITEMS).map((shape) => ({
              shape,
              label: t(translate, `shape.${shape}`),
            })),
          }
        }

        /** The document as the current view shows it: direction override, maybe a legend. */
        function viewDocument(chart, options, translate) {
          const doc = chart.doc
          const next = { ...doc }
          if (options.direction && options.direction !== doc.direction) next.direction = options.direction
          return withLegend(next, translate, options.showLegendByDefault)
        }

        /**
         * Geometry plus SVG for a document.
         *
         * Never throws: a document this Client cannot draw (an unexpected shape in a
         * projection row, say) must degrade to a notice inside the panel, not take
         * the whole page down with it.
         */
        function render(doc, options) {
          try {
            const geometry = layoutDoc(doc)
            const svg = renderSvg(doc, geometry, { title: options && options.title })
            return { geometry, svg, error: null }
          } catch (error) {
            console.warn('[flowchart] could not draw the chart:', error)
            return { geometry: null, svg: '', error }
          }
        }

        /** A standalone copy: concrete colors, so the file looks right outside the app. */
        function forExport(doc) {
          return { ...doc, theme: resolvedTheme(doc.theme) }
        }

        function download(blob, name) {
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = name
          document.body.appendChild(anchor)
          anchor.click()
          anchor.remove()
          setTimeout(() => URL.revokeObjectURL(url), 0)
        }

        /**
         * What to call a chart in the UI. The projection keeps the normalized
         * document, so the display title comes from `doc.title`; the chart entry's
         * own `id` is the fallback identity, not a label.
         */
        function chartTitle(chart) {
          if (!chart) return ''
          return chart.title || (chart.doc && chart.doc.title) || chart.id || ''
        }

        function safeName(chart) {
          const base = chartTitle(chart).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60)
          return base || 'flowchart'
        }

        // -------------------------------------------------------------------------
        // Sidebar panel
        // -------------------------------------------------------------------------

        function FlowChartPanel(props) {
          const translate = props.t
          const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null
          const projection = useChartProjection(props.useProjection)
          const charts = projection.charts

          const requested = info && info.tab && info.tab.navigation && info.tab.navigation.params
            ? info.tab.navigation.params.docId
            : null
          const [selected, setSelected] = React.useState(null)
          const [direction, setDirection] = React.useState(null)
          const [view, setView] = React.useState({ scale: 1, x: 0, y: 0 })
          const [toast, setToast] = React.useState(null)
          const [menuOpen, setMenuOpen] = React.useState(false)
          const stageRef = React.useRef(null)
          const dragRef = React.useRef(null)

          const fallbackId = charts.length > 0 ? charts[charts.length - 1].id : null
          const activeId = (typeof requested === 'string' && requested) || selected || projection.lastId || fallbackId
          const chart = charts.find((candidate) => candidate.id === activeId) || (charts.length > 0 ? charts[charts.length - 1] : null)

          const doc = React.useMemo(
            () => (chart ? viewDocument(chart, { direction, showLegendByDefault: projection.settings.showLegendByDefault }, translate) : null),
            [chart, direction, projection.settings.showLegendByDefault, translate],
          )
          const rendered = React.useMemo(
            () => (doc ? render(doc, { title: t(translate, 'canvas.label', { title: chartTitle(chart) }) }) : null),
            [doc, chart, translate],
          )

          // Reset the viewport when the shown document changes, so a chart never
          // appears scrolled off-screen.
          React.useEffect(() => {
            setView({ scale: 1, x: 0, y: 0 })
          }, [chart && chart.id, chart && chart.version])

          // A non-passive wheel listener: the page must not scroll while zooming.
          React.useEffect(() => {
            const stage = stageRef.current
            if (!stage) return undefined
            const onWheel = (event) => {
              event.preventDefault()
              const rect = stage.getBoundingClientRect()
              const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12
              setView((current) => {
                const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor))
                const ratio = scale / current.scale
                const px = event.clientX - rect.left
                const py = event.clientY - rect.top
                return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }
              })
            }
            stage.addEventListener('wheel', onWheel, { passive: false })
            return () => stage.removeEventListener('wheel', onWheel)
          }, [])

          const fit = () => {
            const stage = stageRef.current
            if (!stage || !rendered) return
            const rect = stage.getBoundingClientRect()
            const box = rendered.geometry.viewBox
            if (box.width <= 0 || box.height <= 0) return
            const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(rect.width / box.width, rect.height / box.height) * 0.96))
            setView({ scale, x: (rect.width - box.width * scale) / 2 - box.x * scale, y: (rect.height - box.height * scale) / 2 - box.y * scale })
          }

          const zoomBy = (factor) => {
            const stage = stageRef.current
            const rect = stage ? stage.getBoundingClientRect() : { width: 0, height: 0 }
            setView((current) => {
              const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor))
              const ratio = scale / current.scale
              const px = rect.width / 2
              const py = rect.height / 2
              return { scale, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio }
            })
          }

          const onPointerDown = (event) => {
            if (event.button !== 0) return
            dragRef.current = { x: event.clientX, y: event.clientY, originX: view.x, originY: view.y }
            event.currentTarget.setPointerCapture?.(event.pointerId)
          }
          const onPointerMove = (event) => {
            const drag = dragRef.current
            if (!drag) return
            setView((current) => ({ ...current, x: drag.originX + (event.clientX - drag.x), y: drag.originY + (event.clientY - drag.y) }))
          }
          const endDrag = (event) => {
            if (!dragRef.current) return
            dragRef.current = null
            event.currentTarget.releasePointerCapture?.(event.pointerId)
          }

          const exportDoc = () => buildExportSvg(doc, { title: chartTitle(chart), theme: resolvedTheme(doc.theme) })

          const notify = (message) => {
            setToast(message)
            setTimeout(() => setToast(null), 1800)
          }

          const onCopySvg = async () => {
            try {
              await navigator.clipboard.writeText(exportDoc())
              notify(t(translate, 'export.copied'))
            } catch {
              notify(t(translate, 'export.failed'))
            }
          }

          const onDownloadSvg = () => {
            try {
              download(new Blob([exportDoc()], { type: 'image/svg+xml' }), `${safeName(chart)}.svg`)
            } catch {
              notify(t(translate, 'export.failed'))
            }
          }

          const onDownloadPng = () => {
            try {
              const svg = exportDoc()
              const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
              const image = new Image()
              image.onload = () => {
                const scale = 2
                const canvas = document.createElement('canvas')
                canvas.width = Math.max(1, Math.round(image.width * scale))
                canvas.height = Math.max(1, Math.round(image.height * scale))
                const context = canvas.getContext('2d')
                context.scale(scale, scale)
                context.drawImage(image, 0, 0)
                canvas.toBlob((blob) => {
                  if (blob) download(blob, `${safeName(chart)}.png`)
                  else notify(t(translate, 'export.failed'))
                }, 'image/png')
              }
              image.onerror = () => notify(t(translate, 'export.failed'))
              image.src = url
            } catch {
              notify(t(translate, 'export.failed'))
            }
          }

          if (chart && rendered && rendered.error) {
            return h('div', { className: 'dsh-fc' }, [
              h('style', { key: 'css', 'data-plugin': NS, 'data-plugin-css': `${NS}/panel.css` }, css),
              h('div', { key: 'broken', className: 'dsh-fc-empty' }, [
                h('p', { key: 'title', className: 'dsh-fc-empty-title' }, t(translate, 'error.title')),
                h('p', { key: 'hint', className: 'dsh-fc-empty-hint' }, t(translate, 'error.hint')),
              ]),
            ])
          }

          if (charts.length === 0 || !chart || !rendered) {
            return h('div', { className: 'dsh-fc' }, [
              h('style', { key: 'css', 'data-plugin': NS, 'data-plugin-css': `${NS}/panel.css` }, css),
              h('div', { key: 'empty', className: 'dsh-fc-empty' }, [
                h('div', { key: 'art', className: 'dsh-fc-empty-art' }, h(Glyph, { size: 28 })),
                h('p', { key: 'title', className: 'dsh-fc-empty-title' }, t(translate, 'empty.title')),
                h('p', { key: 'hint', className: 'dsh-fc-empty-hint' }, t(translate, 'empty.hint')),
              ]),
            ])
          }

          const exportFlags = projection.settings.export || { svg: true, png: true }
          const toolbar = h('div', { className: 'dsh-fc-bar', key: 'bar' }, [
            charts.length > 1
              ? h('select', {
                  key: 'charts',
                  className: 'dsh-fc-select',
                  value: chart.id,
                  'aria-label': t(translate, 'toolbar.chart'),
                  onChange: (event) => {
                    setSelected(event.target.value)
                    if (openChart) openChart(event.target.value)
                  },
                }, charts.map((candidate) => h('option', { key: candidate.id, value: candidate.id }, chartTitle(candidate))))
              : null,
            h('select', {
              key: 'direction',
              className: 'dsh-fc-select',
              value: direction || doc.direction,
              'aria-label': t(translate, 'toolbar.direction'),
              onChange: (event) => setDirection(event.target.value),
            }, DIRECTIONS.map((value) => h('option', { key: value, value }, t(translate, `direction.value.${value.toLowerCase()}`)))),
            h('span', { key: 'gap', className: 'dsh-fc-spacer' }),
            h('button', { key: 'out', className: 'dsh-fc-btn', type: 'button', title: t(translate, 'toolbar.zoomOut'), onClick: () => zoomBy(1 / 1.2) }, '−'),
            h('span', { key: 'percent', className: 'dsh-fc-zoom' }, `${Math.round(view.scale * 100)}%`),
            h('button', { key: 'in', className: 'dsh-fc-btn', type: 'button', title: t(translate, 'toolbar.zoomIn'), onClick: () => zoomBy(1.2) }, '+'),
            h('button', { key: 'fit', className: 'dsh-fc-btn', type: 'button', title: t(translate, 'toolbar.fit'), onClick: fit }, t(translate, 'toolbar.fit')),
            h('button', {
              key: 'actual',
              className: 'dsh-fc-btn',
              type: 'button',
              title: t(translate, 'toolbar.actual'),
              onClick: () => setView({ scale: 1, x: 0, y: 0 }),
            }, '100%'),
            exportFlags.svg || exportFlags.png
              ? h('button', {
                  key: 'export',
                  className: 'dsh-fc-btn',
                  type: 'button',
                  'aria-pressed': menuOpen ? 'true' : 'false',
                  onClick: () => setMenuOpen((open) => !open),
                }, t(translate, 'toolbar.export'))
              : null,
          ])

          const exportMenu = menuOpen
            ? h('div', { className: 'dsh-fc-bar', key: 'exportmenu', role: 'menu' }, [
                exportFlags.svg ? h('button', { key: 'copy', className: 'dsh-fc-btn', type: 'button', onClick: () => { setMenuOpen(false); onCopySvg() } }, t(translate, 'export.copySvg')) : null,
                exportFlags.svg ? h('button', { key: 'svg', className: 'dsh-fc-btn', type: 'button', onClick: () => { setMenuOpen(false); onDownloadSvg() } }, t(translate, 'export.downloadSvg')) : null,
                exportFlags.png ? h('button', { key: 'png', className: 'dsh-fc-btn', type: 'button', onClick: () => { setMenuOpen(false); onDownloadPng() } }, t(translate, 'export.downloadPng')) : null,
              ])
            : null

          const sourceLine = h('div', { className: 'dsh-fc-src', key: 'src' }, chart.source && chart.source.kind === 'file'
            ? [h('code', { key: 'path', title: t(translate, 'source.path', { path: chart.source.path }) }, chart.source.path)]
            : [h('span', { key: 'label' }, t(translate, 'card.sourceInline')), h('span', { key: 'hint', className: 'dsh-fc-muted' }, t(translate, 'source.inline'))])

          const stage = h('div', {
            key: 'stage',
            ref: stageRef,
            className: 'dsh-fc-stage',
            'data-dragging': dragRef.current ? 'true' : undefined,
            onPointerDown,
            onPointerMove,
            onPointerUp: endDrag,
            onPointerCancel: endDrag,
            onDoubleClick: fit,
          }, [
            h('div', {
              key: 'layer',
              className: 'dsh-fc-layer',
              style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` },
              dangerouslySetInnerHTML: { __html: rendered.svg },
            }),
            toast ? h('div', { key: 'toast', className: 'dsh-fc-toast', role: 'status' }, toast) : null,
          ])

          return h('div', { className: 'dsh-fc' }, [
            h('style', { key: 'css', 'data-plugin': NS, 'data-plugin-css': `${NS}/panel.css` }, css),
            toolbar,
            exportMenu,
            sourceLine,
            stage,
          ])
        }

        // -------------------------------------------------------------------------
        // Conversation tool card
        // -------------------------------------------------------------------------

        function FlowChartCard(props) {
          const translate = props.t
          const projection = useChartProjection(props.useProjection)
          const phase = props.phase
          const callId = props.callId
          const chart = callId ? projection.charts.find((candidate) => candidate.callId === callId) : null
          const failure = callId ? projection.failures.find((candidate) => candidate.callId === callId) : null

          // Auto-open lives here rather than in a global subscription (design §10):
          // the card is mounted exactly where the call happened, which is also where
          // "the current session is on screen" is true by construction. One auto-open
          // per document id, so a chart the user closed is never reopened by an
          // update to the same chart.
          React.useEffect(() => {
            if (!chart || !openChart) return undefined
            if (projection.openSeq !== chart.seq) return undefined
            if (autoOpened.has(chart.id)) return undefined

            // Design §10: only the session on screen expands the sidebar, and a
            // background session never does. The check is deferred to the moment the
            // controller reports the session, because the conversation can render
            // before the sidebar has adopted a surface.
            const attempt = () => {
              if (!sessionOnScreen(props.sessionId)) return
              if (autoOpened.has(chart.id)) return
              autoOpened.add(chart.id)
              openChart(chart.id)
            }
            attempt()
            if (autoOpened.has(chart.id)) return undefined
            return onScreenChanged(attempt)
          }, [chart && chart.id, chart && chart.seq, projection.openSeq, props.sessionId])

          // Phases before the result: no chart exists yet, so neither branch may
          // claim a rejection — the call is simply still running.
          if (phase === 'preparing' || phase === 'start') {
            const preparing = phase === 'preparing'
            return h('div', { className: 'dsh-fc-card', 'data-tool': 'FlowChart', 'data-state': preparing ? 'preparing' : 'drawing' }, [
              h('div', { key: 'head', className: 'dsh-fc-card-head' }, [
                h('span', { key: 'icon', className: 'dsh-fc-card-meta' }, h(Glyph, { size: 14 })),
                h('span', { key: 'label', className: 'dsh-fc-card-meta' }, preparing ? t(translate, 'card.preparing') : t(translate, 'card.drawing')),
              ]),
            ])
          }

          if (!chart) {
            const errors = failure ? failure.errors.slice(0, 3) : []
            return h('div', { className: 'dsh-fc-card', 'data-tool': 'FlowChart', 'data-state': 'rejected' }, [
              h('style', { key: 'css', 'data-plugin': NS, 'data-plugin-css': `${NS}/panel.css` }, css),
              h('div', { key: 'head', className: 'dsh-fc-card-head' }, [
                h('span', { key: 'icon', className: 'dsh-fc-card-meta' }, h(Glyph, { size: 14 })),
                h('span', { key: 'title', className: 'dsh-fc-card-title' }, t(translate, 'card.rejected')),
                h('span', { key: 'hint', className: 'dsh-fc-card-meta' }, t(translate, 'card.rejectedHint')),
              ]),
              errors.length > 0
                ? h('ul', { key: 'errors', className: 'dsh-fc-errors' }, errors.map((error, index) => h('li', { key: index }, [
                    h('code', { key: 'where' }, `${error.line > 0 ? `line ${error.line}` : ''}${error.line > 0 && error.path ? ' · ' : ''}${error.path || ''}`),
                    h('span', { key: 'msg' }, ` ${error.message}${error.hint ? ` — ${error.hint}` : ''}`),
                  ])))
                : null,
            ])
          }

          const doc = viewDocument(chart, { direction: chart.doc.direction, showLegendByDefault: projection.settings.showLegendByDefault }, translate)
          const rendered = render(doc, { title: t(translate, 'canvas.label', { title: chartTitle(chart) }) })
          const title = chartTitle(chart)

          return h('div', { className: 'dsh-fc-card', 'data-tool': 'FlowChart', 'data-state': 'ok' }, [
            h('style', { key: 'css', 'data-plugin': NS, 'data-plugin-css': `${NS}/panel.css` }, css),
            h('div', { key: 'head', className: 'dsh-fc-card-head' }, [
              h('span', { key: 'icon', className: 'dsh-fc-card-meta' }, h(Glyph, { size: 14 })),
              h('span', { key: 'title', className: 'dsh-fc-card-title', title }, title),
              h('span', { key: 'meta', className: 'dsh-fc-card-meta' }, `${t(translate, 'card.nodes', { count: doc.nodes.length })} · ${t(translate, 'card.edges', { count: doc.edges.length })}`),
            ]),
            rendered.error === null
              ? h('button', {
                  key: 'thumb',
                  type: 'button',
                  className: 'dsh-fc-card-thumb',
                  'aria-label': t(translate, 'card.open'),
                  onClick: () => openChart && openChart(chart.id),
                  dangerouslySetInnerHTML: { __html: rendered.svg },
                })
              : h('p', { key: 'broken', className: 'dsh-fc-card-meta' }, t(translate, 'error.short')),
            h('div', { key: 'actions', className: 'dsh-fc-card-actions' }, [
              h('button', {
                key: 'open',
                type: 'button',
                className: 'dsh-fc-btn',
                onClick: () => openChart && openChart(chart.id),
              }, t(translate, 'card.open')),
              chart.source && chart.source.kind === 'file'
                ? h('span', { key: 'src', className: 'dsh-fc-card-meta', title: chart.source.path }, `${t(translate, 'card.sourceFile')}: ${chart.source.path}`)
                : null,
            ]),
          ])
        }

        return {
          // Every service read must appear here: the client context is a proxy that
          // THROWS on an undeclared property ("cannot get property ... without
          // inject"), and a throw inside apply() rolls back every registration this
          // plugin made — which takes the tab and the card away with it.
          inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'theme'],

          apply(ctx) {
            const translate = ctx.locale.bind(NS)

            // A UI nicety must never take the host page down: the tab open is the
            // only imperative host call the panel makes.
            openChart = (docId) => {
              try {
                ctx.sidebarRight.openTab(KIND, { params: { docId } })
              } catch (error) {
                console.warn('[flowchart] could not open the chart tab:', error)
              }
            }

            /** The observable naming the session currently on screen. */
            const onScreen = (() => {
              try {
                const face = ctx.sidebarRight.mounted
                return face && typeof face.getSnapshot === 'function' ? face : null
              } catch {
                return null
              }
            })()

            /** Design §10: a background session never auto-expands the sidebar. */
            sessionOnScreen = (sessionId) => {
              if (onScreen === null) return false
              try {
                return onScreen.getSnapshot() === sessionId
              } catch {
                return false
              }
            }
            onScreenChanged = (listener) => (onScreen && typeof onScreen.subscribe === 'function' ? onScreen.subscribe(listener) : () => {})

            hostTheme = () => {
              try {
                const snapshot = ctx.theme.getTheme()
                const id = snapshot && (snapshot.id || snapshot.theme)
                return id === 'dark' ? 'dark' : 'light'
              } catch {
                return 'light'
              }
            }

            ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'flowchart:copy')

            // One tab for the kind: a chart update redraws the open tab in place, and
            // a second call for a different chart switches the same tab's document
            // (design §19.3 — never a pile of tabs for one graph).
            ctx.effect(() => ctx.sidebarRightTabs.register({
              id: TAB_ID,
              kind: KIND,
              multiple: false,
              priority: 'extension',
              keepMounted: true,
              title: () => t(translate, 'tab.title'),
              guide: [{
                id: 'flowchart',
                order: 40,
                title: () => t(translate, 'guide.title'),
                description: () => t(translate, 'guide.description'),
                icon: Glyph,
              }],
            }), 'flowchart:tab-type')

            // The component is the SECOND argument of register, inside the inject
            // callback — passing it as a third argument of inject leaves the slot
            // with no component at all, and the seat renders nothing.
            ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              locale: NS,
              inject: () => ({ t: translate }),
            }, FlowChartPanel)), 'flowchart:tab-body')

            ctx.effect(() => ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
              name: 'tool.call.toolview',
              key: 'FlowChart',
              locale: NS,
              inject: () => ({ t: translate }),
            }, FlowChartCard)), 'flowchart:tool-card')
          },
        }
      }



      return { buildExportSvg, createUi, NS, TAB_ID, KIND, PROJECTION_KEY, zh, en, css, DIRECTIONS }
    })()

    return __modules['ui'].createUi(React)
  },
})
