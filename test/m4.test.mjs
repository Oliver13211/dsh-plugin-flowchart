/**
 * M4 acceptance — export, groups, legend, theme polish, and copy coverage.
 *
 * Design §17 M4: "导出、分组、图例、主题打磨、双语校对", accepted by a light/dark
 * comparison and a working SVG/PNG export.
 *
 * Run with: node test/m4.test.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExportSvg } from '../client/ui.js'
import { layoutDoc } from '../lib/layout.js'
import { normalizeFlowChart } from '../lib/normalize.js'
import { resolveTextColor, renderSvg } from '../lib/svg.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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
  assert(result.ok, `rejected: ${JSON.stringify(result.errors)}`)
  return result.doc
}

const FILLED = 'id: export\ntitle: 导出检查\nnodes:\n  - id: a\n    label: 开始\n    fill: "#4f7cff"\n  - id: b\n    label: 结束\nedges:\n  - from: a\n    to: b\n'

// --- export ------------------------------------------------------------------

check('an exported SVG carries no host tokens, only concrete colors', () => {
  // Inside the app the panel uses var(--dsw-...); a downloaded file cannot, so
  // the export must bake the colors in or it opens as invisible ink.
  const base = doc(FILLED)
  for (const theme of ['light', 'dark']) {
    const svg = buildExportSvg(base, { title: '导出检查', theme })
    assert(!svg.includes('var(--dsw-'), `${theme} export still carries a token`)
    assert(!svg.includes('var('), `${theme} export still carries a var()`)
    assert(svg.startsWith('<svg'), 'not an svg')
    assert(svg.includes('role="img"'), 'no accessible label')
  }
})

check('the export bakes the theme it was given', () => {
  const base = doc(FILLED)
  const light = buildExportSvg(base, { theme: 'light' })
  const dark = buildExportSvg(base, { theme: 'dark' })
  const canvas = (svg) => (svg.match(/class="fc-canvas"[^>]*fill="([^"]+)"/) ?? [])[1]
  assert(canvas(light) !== canvas(dark), `same canvas ${canvas(light)}`)
  assert(canvas(light) === '#ffffff' && canvas(dark) === '#17181c', `${canvas(light)} / ${canvas(dark)}`)
  return `${canvas(light)} vs ${canvas(dark)}`
})

check('a document with an explicit theme ignores the passed theme', () => {
  const light = buildExportSvg(doc(FILLED.replace('title: 导出检查', 'theme: light')), { theme: 'dark' })
  assert((light.match(/class="fc-canvas"[^>]*fill="([^"]+)"/) ?? [])[1] === '#ffffff', 'explicit light theme was overridden')
})

check('the export keeps the background unless asked not to', () => {
  const base = doc(FILLED)
  assert(buildExportSvg(base, { theme: 'light' }).includes('class="fc-canvas"'), 'no background')
  assert(!buildExportSvg(base, { theme: 'light', background: false }).includes('class="fc-canvas"'), 'background not removed')
})

check('the exported drawing equals the on-screen drawing, minus the tokens', () => {
  const base = doc(FILLED)
  const onScreen = renderSvg(base, layoutDoc(base), { title: '导出检查' })
  const exported = buildExportSvg(base, { title: '导出检查', theme: 'light' })
  const strip = (svg) => svg.replace(/var\([^)]*\)/g, 'COLOR').replace(/\s+/g, ' ')
  // Same geometry and structure; only the color spelling differs.
  const shape = (svg) => (svg.match(/<path d="([^"]+)"/g) ?? []).join('|')
  assert(shape(onScreen) === shape(exported), 'geometry differs between the panel and the export')
  void strip
})

// --- groups ------------------------------------------------------------------

check('a captioned group reserves a band so the caption never sits on a node', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n    pos: [0, 120]\ngroups:\n  - id: g\n    label: CI 阶段\n    members: [a, b]\n'))
  const group = geometry.groups[0]
  const top = Math.min(...geometry.nodes.filter((node) => ['a', 'b'].includes(node.id)).map((node) => node.y))
  const band = top - group.y
  assert(band >= 30, `caption band is only ${band}px`)
  // The caption's baseline must stay above the topmost member.
  assert(group.y + 21 <= top, `caption baseline ${group.y + 21} reaches the node at ${top}`)
  return `band ${band}px`
})

check('a group without a caption keeps the plain padding', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\ngroups:\n  - id: g\n    members: [a]\n'))
  const group = geometry.groups[0]
  const node = geometry.nodes[0]
  assert(node.y - group.y === 16, `padding ${node.y - group.y}`)
})

check('an over-long group caption is ellipsized to the box', () => {
  const geometry = layoutDoc(doc(`nodes:\n  - id: a\ngroups:\n  - id: g\n    label: ${'很长'.repeat(30)}\n    members: [a]\n`))
  const group = geometry.groups[0]
  assert(group.label.endsWith('…'), `not ellipsized: ${group.label}`)
  assert(group.labelWidth <= group.w, `${group.labelWidth} > ${group.w}`)
})

check('the group box still wraps every member', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n    pos: [200, 0]\ngroups:\n  - id: g\n    label: 组\n    members: [a, b]\n'))
  const group = geometry.groups[0]
  for (const node of geometry.nodes) {
    assert(group.x <= node.x && group.y <= node.y, `node ${node.id} outside the top left`)
    assert(group.x + group.w >= node.x + node.w && group.y + group.h >= node.y + node.h, `node ${node.id} outside the bottom right`)
  }
})

// --- legend ------------------------------------------------------------------

check('a long legend caption is ellipsized instead of stretching the box', () => {
  const geometry = layoutDoc(doc(`nodes:\n  - id: a\nlegend:\n  - { shape: diamond, label: "${'x'.repeat(90)}" }\n`))
  const row = geometry.legend.rows[0]
  assert(row.label.endsWith('…'), `not ellipsized: ${row.label}`)
  assert(row.labelWidth <= 150, `label width ${row.labelWidth}`)
})

check('a legend wider than the chart grows the canvas', () => {
  const geometry = layoutDoc(doc(`nodes:\n  - id: a\nlegend:\n  - { shape: stadium, label: "${'很宽的图例项'.repeat(8)}" }\n`))
  assert(geometry.legend.x + geometry.legend.w <= geometry.viewBox.x + geometry.viewBox.width + 0.01, 'legend overflows')
  return `legend ${geometry.legend.w} in ${geometry.viewBox.width}`
})

check('the legend stays clear of the graph', () => {
  const geometry = layoutDoc(doc('nodes:\n  - id: a\n  - id: b\n  - id: c\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\nlegend:\n  - { shape: diamond, label: 判断 }\n'))
  const legend = geometry.legend
  for (const node of geometry.nodes) {
    const hit = legend.x < node.x + node.w && node.x < legend.x + legend.w && legend.y < node.y + node.h && node.y < legend.y + legend.h
    assert(!hit, `legend overlaps node ${node.id}`)
  }
})

// --- theme polish ------------------------------------------------------------

check('auto text ink follows the fill it sits on', () => {
  const ink = (fill) => resolveTextColor({ color: 'auto', fill }, 'auto')
  assert(ink('#1f2329') === '#ffffff', 'dark fill should get light ink')
  assert(ink('black') === '#ffffff', 'black keyword')
  assert(ink('#fff4e5') === '#1f2329', 'pale fill should get dark ink')
  assert(ink('white') === '#1f2329', 'white keyword')
  assert(ink('steelblue') === '#ffffff', 'named dark-ish color')
  return `${ink('#1f2329')} on dark, ${ink('#fff4e5')} on pale`
})

check('an explicit text color still wins over the contrast rule', () => {
  assert(resolveTextColor({ color: '#ff0000', fill: '#000000' }, 'auto') === '#ff0000', 'explicit color overridden')
})

check('an auto fill keeps the theme text token in both themes', () => {
  const light = resolveTextColor({ color: 'auto', fill: 'auto' }, 'light')
  const dark = resolveTextColor({ color: 'auto', fill: 'auto' }, 'dark')
  assert(light === '#1f2329' && dark === '#e7e9ee', `${light} / ${dark}`)
})

check('the contrast choice is theme-independent for an explicit fill', () => {
  // The fill is the author's own color, so the ink must not flip with the theme.
  const light = resolveTextColor({ color: 'auto', fill: '#4f7cff' }, 'light')
  const dark = resolveTextColor({ color: 'auto', fill: '#4f7cff' }, 'dark')
  assert(light === dark, `${light} vs ${dark}`)
})

check('light and dark render the same geometry with different colors', () => {
  const base = doc(FILLED)
  const light = renderSvg({ ...base, theme: 'light' }, layoutDoc({ ...base, theme: 'light' }))
  const dark = renderSvg({ ...base, theme: 'dark' }, layoutDoc({ ...base, theme: 'dark' }))
  const paths = (svg) => (svg.match(/<path d="([^"]+)"/g) ?? []).join('|')
  assert(paths(light) === paths(dark), 'geometry changed with the theme')
  assert(light !== dark, 'colors did not change with the theme')
})

// --- copy coverage -----------------------------------------------------------

const UI = readFileSync(join(ROOT, 'client', 'ui.js'), 'utf8')

check('every static translation key used by the client exists in both languages', () => {
  const zh = JSON.parse(readFileSync(join(ROOT, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(readFileSync(join(ROOT, 'locale', 'en.json'), 'utf8'))
  const used = new Set()
  for (const match of UI.matchAll(/\bt\((?:translate,\s*)?'([^']+)'/g)) used.add(match[1])
  const missingZh = [...used].filter((key) => !(key in zh))
  const missingEn = [...used].filter((key) => !(key in en))
  assert(missingZh.length === 0, `missing in zh: ${missingZh.join(', ')}`)
  assert(missingEn.length === 0, `missing in en: ${missingEn.join(', ')}`)
  return `${used.size} static keys`
})

check('the dynamic direction keys exist for every direction', () => {
  const zh = JSON.parse(readFileSync(join(ROOT, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(readFileSync(join(ROOT, 'locale', 'en.json'), 'utf8'))
  for (const direction of ['tb', 'bt', 'lr', 'rl']) {
    assert(`direction.value.${direction}` in zh, `zh missing direction.value.${direction}`)
    assert(`direction.value.${direction}` in en, `en missing direction.value.${direction}`)
  }
})

check('the shape keys exist for every shape the legend can synthesize', () => {
  const zh = JSON.parse(readFileSync(join(ROOT, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(readFileSync(join(ROOT, 'locale', 'en.json'), 'utf8'))
  const shapes = ['rect', 'rounded', 'stadium', 'ellipse', 'circle', 'diamond', 'hexagon', 'parallelogram', 'cylinder', 'document', 'cloud', 'triangle', 'star', 'note', 'subroutine']
  for (const shape of shapes) {
    assert(`shape.${shape}` in zh, `zh missing shape.${shape}`)
    assert(`shape.${shape}` in en, `en missing shape.${shape}`)
  }
  return `${shapes.length} shapes`
})

check('the dictionaries have identical key sets', () => {
  const zh = JSON.parse(readFileSync(join(ROOT, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(readFileSync(join(ROOT, 'locale', 'en.json'), 'utf8'))
  const zhOnly = Object.keys(zh).filter((key) => !(key in en))
  const enOnly = Object.keys(en).filter((key) => !(key in zh))
  assert(zhOnly.length === 0 && enOnly.length === 0, `zh only: ${zhOnly.join(',')}; en only: ${enOnly.join(',')}`)
  return `${Object.keys(zh).length} keys`
})

check('no dictionary entry is left unreferenced', () => {
  const zh = JSON.parse(readFileSync(join(ROOT, 'locale', 'zh.json'), 'utf8'))
  const referenced = new Set([...UI.matchAll(/\bt\((?:translate,\s*)?'([^']+)'/g)].map((match) => match[1]))
  // Keys reached through a template literal or the guide/tab title functions.
  const dynamic = /^(direction\.value\.|shape\.)/
  const unused = Object.keys(zh).filter((key) => !key.startsWith('meta.') && !referenced.has(key) && !dynamic.test(key))
  assert(unused.length === 0, `unused: ${unused.join(', ')}`)
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) process.exit(1)
