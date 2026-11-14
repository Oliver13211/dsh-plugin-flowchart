/**
 * Write the review samples for M2 into `samples/`.
 *
 * These exist so the layout and rendering can be inspected in a browser before
 * the sidebar wiring (M3) exists. Run with: node test/samples.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildExportSvg } from '../client/ui.js'
import { layoutDoc } from '../lib/layout.js'
import { normalizeFlowChart } from '../lib/normalize.js'
import { renderSvg } from '../lib/svg.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'samples')
const LIMITS = { maxChars: 20000, maxNodes: 60, maxEdges: 120 }

const SHAPES = ['rect', 'rounded', 'stadium', 'ellipse', 'circle', 'diamond', 'hexagon', 'parallelogram', 'cylinder', 'document', 'cloud', 'triangle', 'star', 'note', 'subroutine']

/** A grey-paper rollback flow: the §19.2 acceptance scenario. */
const DEPLOY = `id: deploy
title: 灰度发布流程
direction: TB
canvas:
  rankSpacing: 56
  nodeSpacing: 36
defaults:
  fontSize: 13
nodes:
  - id: start
    label: 提交发布
    shape: stadium
    fill: "#4f7cff"
    color: "#ffffff"
  - id: build
    label: 构建镜像
  - id: gate
    label: 冒烟测试通过？
    shape: diamond
    fill: "#fff4e5"
    stroke: "#f59e0b"
    strokeWidth: 2
    color: "#7a4b00"
  - id: gray
    label: 5% 灰度
    shape: hexagon
  - id: watch
    label: 观察 30 分钟
  - id: full
    label: 全量发布
    shape: stadium
    fill: "#2fae5a"
    color: "#ffffff"
  - id: roll
    label: 回滚
    shape: note
    dashed: true
    stroke: "#ef4444"
    color: "#ef4444"
edges:
  - from: start
    to: build
  - from: build
    to: gate
  - from: gate
    to: gray
    label: 是
  - from: gate
    to: roll
    label: 否
    color: "#ef4444"
    style: dashed
  - from: gray
    to: watch
  - from: watch
    to: full
    label: 指标正常
  - from: watch
    to: roll
    label: 指标异常
    color: "#ef4444"
    style: dashed
  - from: roll
    to: build
    label: 修复后重试
    route: curve
    arrow: both
    arrowShape: vee
groups:
  - id: canary
    label: 灰度阶段
    members: [gray, watch]
    style: dashed
legend:
  - { shape: stadium, label: 起止 }
  - { shape: diamond, label: 判断 }
  - { shape: note, label: 回滚 }
`

const SHAPE_GALLERY = [
  'id: shapes',
  'title: 15 种形状',
  'direction: TB',
  'nodes:',
  ...SHAPES.map((shape, index) => `  - id: n${index}\n    shape: ${shape}\n    label: ${shape}\n`),
  'edges:',
  ...SHAPES.slice(1).map((_, index) => `  - from: n0\n    to: n${index + 1}\n`),
].join('\n')

const RICH = [
  'id: rich',
  'title: 全部特性',
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
  '  - id: note',
  '    label: "多行注释\\n第二行"',
  '    shape: note',
  '    dashed: true',
  '  - id: ext',
  '    label: 外部系统',
  '    shape: cloud',
  '  - id: doc',
  '    label: 报告',
  '    shape: document',
  '  - id: alert',
  '    label: 告警',
  '    shape: triangle',
  '    fill: "#ffe3e3"',
  '    stroke: "#ef4444"',
  '  - id: star',
  '    label: 关键',
  '    shape: star',
  'edges:',
  '  - from: start',
  '    to: gate',
  '    label: 触发',
  '  - from: gate',
  '    to: work',
  '    label: 是',
  '  - from: gate',
  '    to: note',
  '    label: 否',
  '    color: "#ef4444"',
  '    style: dashed',
  '  - from: work',
  '    to: store',
  '    route: straight',
  '    width: 2',
  '    arrowShape: diamond',
  '  - from: store',
  '    to: doc',
  '    route: curve',
  '    arrow: both',
  '    arrowShape: vee',
  '  - from: doc',
  '    to: ext',
  '    arrowShape: circle',
  '  - from: ext',
  '    to: alert',
  '    style: dotted',
  '    dashArray: [10, 3]',
  '    arrowShape: line',
  '  - from: alert',
  '    to: star',
  '    label: "多行\\n标签"',
  '  - from: star',
  '    to: start',
  '    label: 重来',
  '    route: curve',
  'groups:',
  '  - id: inner',
  '    label: 内部',
  '    members: [work, store]',
  '  - id: outer',
  '    label: 外部',
  '    members: [ext, alert]',
  '    style: dashed',
  'legend:',
  '  - { shape: diamond, label: 判断 }',
  '  - { shape: cylinder, label: 存储 }',
  '  - { shape: cloud, label: 外部 }',
].join('\n')

function big() {
  const nodes = Array.from({ length: 60 }, (_, index) => {
    const shape = ['rect', 'rounded', 'diamond', 'hexagon', 'cylinder'][index % 5]
    return `  - id: n${index}\n    shape: ${shape}\n    label: 步骤 ${index}\n`
  })
  const edges = Array.from({ length: 120 }, (_, index) => `  - from: n${index % 60}\n    to: n${(index * 7 + 1) % 60}\n`)
  return ['id: big', 'title: 60 节点 / 120 边', 'nodes:', ...nodes, 'edges:', ...edges].join('\n')
}

/** The review documents, exported so the audit tests run on real fixtures. */
export const SAMPLES = [
  ['deploy', DEPLOY, {}],
  ['shapes', SHAPE_GALLERY, {}],
  ['rich', RICH, {}],
  ['deploy-dark', DEPLOY.replace('direction: TB', 'direction: TB\ntheme: dark'), {}],
  ['big', big(), {}],
]

if (process.argv[1] !== fileURLToPath(import.meta.url)) {
  export_none: {
    // Imported for its documents only; nothing is written.
    break export_none
  }
} else {
  writeSamples()
}

function writeSamples() {
  mkdirSync(OUT, { recursive: true })
  for (const [name, yaml, options] of SAMPLES) {
    const result = normalizeFlowChart(yaml, LIMITS)
    if (!result.ok) {
      console.error(`rejected ${name}:`, JSON.stringify(result.errors, null, 1))
      process.exit(1)
    }
    const geometry = layoutDoc(result.doc)
    const svg = renderSvg(result.doc, geometry, options)
    writeFileSync(join(OUT, `${name}.svg`), svg)
    const kb = (Buffer.byteLength(svg) / 1024).toFixed(1)
    console.log(`${name.padEnd(12)} ${String(geometry.nodes.length).padStart(2)} nodes ${String(geometry.edges.length).padStart(3)} edges  ${kb} KB`)
  }

  // The export pair: concrete colors baked in, exactly what the panel's export
  // writes. This is the light/dark comparison the M4 acceptance asks for.
  for (const [name, yaml, theme] of [['export-light', DEPLOY, 'light'], ['export-dark', DEPLOY, 'dark']]) {
    const result = normalizeFlowChart(yaml, LIMITS)
    if (!result.ok) {
      console.error(`rejected ${name}:`, JSON.stringify(result.errors, null, 1))
      process.exit(1)
    }
    const svg = buildExportSvg(result.doc, { theme, title: result.doc.title })
    writeFileSync(join(OUT, `${name}.svg`), svg)
    console.log(`${name.padEnd(12)} export, ${theme} baked  ${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`)
  }
  console.log(`\nwritten to ${OUT}`)
}