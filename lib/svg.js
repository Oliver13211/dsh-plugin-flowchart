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
export function resolveColor(color, token, theme) {
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
export function resolveTextColor(node, theme) {
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
export function shapeElement(shape, box, paint) {
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
export function roundedPolylinePath(points, radius) {
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
export function arrowElement(shape, x, y, angle, size, color, strokeWidth) {
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
export function renderSvg(doc, geometry, options = {}) {
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

export { SHAPE_NAMES, FONT_SANS, FONT_MONO }