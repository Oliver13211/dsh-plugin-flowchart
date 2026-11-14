/**
 * M3 acceptance — the Client surfaces.
 *
 * Drives the real component functions from `client/ui.js` through a minimal
 * React stand-in: element trees, hook state, and event handlers all run for
 * real, so a broken panel or card fails here rather than in the browser.
 *
 * Run with: node test/client-view.test.mjs
 */

import { createTestReact } from './fake-react.mjs'
import { createClientContext } from './fake-client.mjs'
import { createUi, zh } from '../client/ui.js'
import { normalizeFlowChart } from '../lib/normalize.js'

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

const translate = (key, params) => {
  const template = zh[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
}

const t = translate

function docOf(yaml) {
  const result = normalizeFlowChart(yaml, LIMITS)
  assert(result.ok, `document rejected: ${JSON.stringify(result.errors)}`)
  return result.doc
}

/** A chart entry shaped exactly like the projection's. */
function chart(id, yaml, extra = {}) {
  return {
    id,
    seq: extra.seq ?? 1,
    version: extra.version ?? 1,
    callId: extra.callId ?? `call_${id}`,
    doc: docOf(yaml),
    source: extra.source ?? { kind: 'inline' },
    warnings: [],
  }
}

const CHAIN = 'id: deploy\ntitle: 部署\ndirection: TB\nnodes:\n  - id: a\n    label: 开始\n  - id: b\n    label: 构建\n  - id: c\n    label: 上线\nedges:\n  - from: a\n    to: b\n  - from: b\n    to: c\n'

function projectionOf(charts, overrides = {}) {
  return {
    charts,
    failures: overrides.failures ?? [],
    openSeq: overrides.openSeq ?? null,
    lastId: overrides.lastId ?? (charts.length > 0 ? charts[charts.length - 1].id : null),
    settings: overrides.settings ?? {
      autoOpen: true,
      defaultDirection: 'TB',
      showLegendByDefault: false,
      export: { svg: true, png: true },
    },
  }
}

/** Mount the panel with a captured ctx, exactly as the plugin registers it. */
function mountPlugin(projection, options = {}) {
  const { React, mount } = createTestReact()
  const ui = options.ui ?? createUi(React)
  const registered = { tabType: null, slots: [], opens: [] }
  // The context enforces `inject`, so an undeclared service read fails here the
  // same way it fails (and rolls back the plugin) in the browser.
  const ctx = createClientContext({
    inject: ui.inject,
    services: {
      locale: { bind: () => translate, register: () => () => {} },
      slots: {
        inject: (slot, callback) => {
          const dispose = callback()
          void dispose
          return () => {}
        },
        register: (definition, component) => {
          registered.slots.push({ definition, component })
          return () => {}
        },
      },
      sidebarRightTabs: {
        register: (definition) => {
          registered.tabType = definition
          return () => {}
        },
      },
      sidebarRight: {
        openTab: (kind, opts) => registered.opens.push({ kind, ...opts }),
        mounted: {
          getSnapshot: () => options.onScreen ?? 'session-under-test',
          subscribe: () => () => {},
        },
      },
      theme: { getTheme: () => ({ id: options.theme ?? 'light' }) },
    },
    overrides: {
      effect: (fn) => {
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
    },
  })
  ui.apply(ctx)
  const panel = registered.slots.find((entry) => entry.definition.name === 'sidebar.right.pane.tab')
  const card = registered.slots.find((entry) => entry.definition.name === 'tool.call.toolview')
  return { React, mount, ui, ctx, registered, panel: panel && panel.component, card: card && card.component }
}

function panelProps(projection, extra = {}) {
  return {
    t: translate,
    useProjection: (key) => (key === 'flowchart' ? projection : undefined),
    useTabInfo: () => ({ tab: { navigation: { params: extra.params ?? { docId: extra.docId } } } }),
  }
}

/** The concatenated text of a node and its descendants. */
function nodeText(node) {
  if (!node) return ''
  if (node.type === 'text') return node.children[0]
  return (node.children || []).map(nodeText).join('')
}

/** Find the first button whose visible text matches. */
function button(view, label) {
  return view.find((node) => node.type === 'button' && nodeText(node) === label)
}

function cardProps(projection, extra = {}) {
  return {
    t: translate,
    sessionId: extra.sessionId ?? 'session-under-test',
    phase: extra.phase ?? 'result',
    callId: extra.callId ?? 'call_deploy',
    block: extra.block ?? {},
    useProjection: (key) => (key === 'flowchart' ? projection : undefined),
  }
}

// --- registration ------------------------------------------------------------

check('the plugin registers a tab type, a panel and a tool card', () => {
  const { registered } = mountPlugin(projectionOf([]))
  assert(registered.tabType, 'no tab type registered')
  assert(registered.tabType.id === '@local/dsh-plugin-flowchart', registered.tabType.id)
  assert(registered.tabType.kind === 'flowchart', registered.tabType.kind)
  assert(registered.tabType.guide[0].id === 'flowchart', 'guide entry')
  const seats = registered.slots.map((entry) => `${entry.definition.name}:${entry.definition.key}`)
  assert(seats.includes('sidebar.right.pane.tab:@local/dsh-plugin-flowchart'), seats.join(','))
  assert(seats.includes('tool.call.toolview:FlowChart'), seats.join(','))
})

check('one tab per kind, kept mounted, so an update redraws in place', () => {
  const { registered } = mountPlugin(projectionOf([]))
  assert(registered.tabType.multiple === false, 'multiple must be false: a new address per open would pile up tabs')
  assert(registered.tabType.keepMounted === true, 'keepMounted preserves zoom and pan')
})

// --- panel: empty state ------------------------------------------------------

check('the panel shows the shared empty state with no charts', () => {
  const { mount, panel } = mountPlugin(projectionOf([]))
  const view = mount({ type: panel, props: panelProps(projectionOf([])) })
  const empty = view.find((node) => node.props.className === 'dsh-fc-empty')
  assert(empty, 'no empty state')
  const text = view.all().filter((node) => node.type === 'text').map((node) => node.children[0]).join(' ')
  assert(text.includes('还没有流程图'), text.slice(0, 80))
  assert(!view.find((node) => node.props.className === 'dsh-fc-stage'), 'no stage when empty')
})

// --- panel: chart ------------------------------------------------------------

check('the panel draws the chart with a toolbar, source line and SVG', () => {
  const projection = projectionOf([chart('deploy', CHAIN)])
  const { mount, panel } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection) })
  assert(view.find((node) => node.props.className === 'dsh-fc-bar'), 'no toolbar')
  const layer = view.find((node) => node.props.className === 'dsh-fc-layer')
  assert(layer, 'no canvas layer')
  const html = layer.props.dangerouslySetInnerHTML.__html
  assert(html.startsWith('<svg'), html.slice(0, 40))
  assert(html.includes('fc-node'), 'nodes drawn')
  assert(html.includes('fc-edge'), 'edges drawn')
  const source = view.find((node) => node.props.className === 'dsh-fc-src')
  assert(source, 'no source line')
  return `${html.length} bytes of SVG`
})

check('a file-sourced chart shows the path it was read from', () => {
  const projection = projectionOf([chart('deploy', CHAIN, { source: { kind: 'file', path: 'flow/deploy.yaml' } })])
  const { mount, panel } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection) })
  const code = view.find((node) => node.type === 'code')
  assert(code && nodeText(code) === 'flow/deploy.yaml', JSON.stringify(code && nodeText(code)))
  // The tooltip is the translated caption; the visible text stays the raw path.
  assert(String(code.props.title).includes('flow/deploy.yaml'), `tooltip: ${code.props.title}`)
})

check('the direction control re-lays out the chart without touching the document', () => {
  const projection = projectionOf([chart('deploy', CHAIN)])
  const { mount, panel } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection) })
  const before = view.find((node) => node.props.className === 'dsh-fc-layer').props.dangerouslySetInnerHTML.__html
  const select = view.find((node) => node.type === 'select' && node.props['aria-label'] === '方向')
  assert(select, 'no direction control')
  view.change(select, 'LR').rerender()
  const after = view.find((node) => node.props.className === 'dsh-fc-layer').props.dangerouslySetInnerHTML.__html
  assert(before !== after, 'layout did not change')
  const width = Number(after.match(/width="(\d+)"/)[1])
  const height = Number(after.match(/height="(\d+)"/)[1])
  assert(width > height, `LR should be wide: ${width}x${height}`)
  return `${width}x${height}`
})

check('the zoom controls scale the canvas and fit computes a real scale', () => {
  const projection = projectionOf([chart('deploy', CHAIN)])
  const { mount, panel } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection) })
  const layer = () => view.find((node) => node.props.className === 'dsh-fc-layer')
  view.click(view.find((node) => node.props.title === '放大')).rerender()
  const zoomed = layer().props.style.transform
  assert(/scale\((1\.[0-9]+)\)/.test(zoomed), zoomed)
  view.click(view.find((node) => node.props.title === '适应')).rerender()
  const fitted = layer().props.style.transform
  // Fit fills an 800x600 stage with a small chart, so the scale is above 1.
  assert(/scale\([0-9.]+\)/.test(fitted) && !/scale\(1\)$/.test(fitted), `fit produced ${fitted}`)
  view.click(view.find((node) => node.props.title === '100%')).rerender()
  assert(layer().props.style.transform === 'translate(0px, 0px) scale(1)', layer().props.style.transform)
  return fitted
})

check('the export menu offers exactly the enabled formats', () => {
  const projection = projectionOf([chart('deploy', CHAIN)])
  const { mount, panel } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection) })
  const menuButton = button(view, '导出')
  assert(menuButton, 'no export button')
  view.click(menuButton).rerender()
  const labels = view.findAll((node) => node.type === 'button' && ['复制 SVG', '下载 SVG', '下载 PNG'].includes(nodeText(node))).map(nodeText)
  assert(labels.length === 3, labels.join(','))

  const pngOff = projectionOf([chart('deploy', CHAIN)], { settings: { autoOpen: true, defaultDirection: 'TB', showLegendByDefault: false, export: { svg: true, png: false } } })
  const second = mountPlugin(pngOff)
  const view2 = second.mount({ type: second.panel, props: panelProps(pngOff) })
  second.view = view2
  view2.click(button(view2, '导出')).rerender()
  const labels2 = view2.findAll((node) => node.type === 'button' && ['复制 SVG', '下载 SVG', '下载 PNG'].includes(nodeText(node))).map(nodeText)
  assert(labels2.length === 2 && !labels2.includes('下载 PNG'), labels2.join(','))
  return labels.join(' / ')
})

check('multiple charts get a switcher that keeps one tab', () => {
  const projection = projectionOf([chart('one', CHAIN, { seq: 1 }), chart('two', 'id: two\ntitle: 第二张\nnodes:\n  - id: x\n', { seq: 2 })])
  const { mount, panel, registered } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection) })
  const select = view.find((node) => node.type === 'select' && node.props['aria-label'] === '图')
  assert(select, 'no chart switcher')
  assert(select.children.length === 2, `options ${select.children.length}`)
  view.change(select, 'one').rerender()
  assert(registered.opens.length === 1, `openTab calls ${registered.opens.length}`)
  assert(registered.opens[0].params.docId === 'one', JSON.stringify(registered.opens[0]))
})

check('the called-out document wins over the panel default', () => {
  const projection = projectionOf([chart('one', CHAIN, { seq: 1 }), chart('two', 'id: two\ntitle: 第二张\nnodes:\n  - id: x\n', { seq: 2 })])
  const { mount, panel } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection, { params: { docId: 'one' } }) })
  const switcher = view.find((node) => node.type === 'select' && node.props['aria-label'] === '图')
  assert(switcher.props.value === 'one', switcher.props.value)
})

check('the canvas carries an accessible summary', () => {
  const projection = projectionOf([chart('deploy', CHAIN)])
  const { mount, panel } = mountPlugin(projection)
  const view = mount({ type: panel, props: panelProps(projection) })
  const html = view.find((node) => node.props.className === 'dsh-fc-layer').props.dangerouslySetInnerHTML.__html
  assert(html.includes('role="img"'), 'role')
  // The label is the translated caption template, not the bare title.
  const label = (html.match(/aria-label="([^"]+)"/) ?? [])[1] ?? ''
  assert(label.includes('部署'), `label: ${label}`)
  assert(label.includes('流程图'), `label is not the translated caption: ${label}`)
})

// --- tool card ---------------------------------------------------------------

check('the card shows the title, the counts and a thumbnail', () => {
  const projection = projectionOf([chart('deploy', CHAIN, { callId: 'call_x', seq: 7 })])
  const { mount, card } = mountPlugin(projection)
  const view = mount({ type: card, props: cardProps(projection, { callId: 'call_x' }) })
  const text = view.all().filter((node) => node.type === 'text').map((node) => node.children[0]).join(' ')
  assert(view.find((node) => node.props['data-state'] === 'ok'), 'the card rendered its rejected branch')
  assert(text.includes('部署'), text.slice(0, 100))
  assert(text.includes('3 节点') && text.includes('2 连线'), text.slice(0, 120))
  const thumb = view.find((node) => node.props.className === 'dsh-fc-card-thumb')
  assert(thumb && thumb.props.dangerouslySetInnerHTML.__html.includes('<svg'), 'no thumbnail')
  return text.slice(0, 60)
})

check('the open button asks the sidebar for this chart', () => {
  const projection = projectionOf([chart('deploy', CHAIN, { callId: 'call_x' })])
  const { mount, card, registered } = mountPlugin(projection)
  const view = mount({ type: card, props: cardProps(projection, { callId: 'call_x' }) })
  const open = button(view, '在右侧边栏打开')
  assert(open, 'no open button')
  view.click(open).rerender()
  assert(registered.opens.length === 1, `opens ${registered.opens.length}`)
  assert(registered.opens[0].kind === 'flowchart' && registered.opens[0].params.docId === 'deploy', JSON.stringify(registered.opens[0]))
})

check('a new chart auto-opens once, and not again on re-render', () => {
  const projection = projectionOf([chart('deploy', CHAIN, { callId: 'call_x', seq: 42 })], { openSeq: 42 })
  const { mount, card, registered } = mountPlugin(projection)
  const view = mount({ type: card, props: cardProps(projection, { callId: 'call_x' }) })
  assert(registered.opens.length === 1, `opens after mount ${registered.opens.length}`)
  view.rerender()
  view.rerender()
  assert(registered.opens.length === 1, `opens after re-render ${registered.opens.length}`)
})

check('a background session never auto-expands the sidebar', () => {
  // Design §10: the sidebar only expands for the session on screen. Here the
  // chart asked to open, but the on-screen session is a different one.
  const projection = projectionOf([chart('deploy', CHAIN, { callId: 'call_x', seq: 42 })], { openSeq: 42 })
  const { mount, card, registered } = mountPlugin(projection, { onScreen: 'some-other-session' })
  mount({ type: card, props: cardProps(projection, { callId: 'call_x' }) })
  assert(registered.opens.length === 0, `opens ${registered.opens.length}`)
})

check('a chart that did not ask to open stays closed', () => {
  const projection = projectionOf([chart('deploy', CHAIN, { callId: 'call_x', seq: 42 })], { openSeq: 41 })
  const { mount, card, registered } = mountPlugin(projection)
  mount({ type: card, props: cardProps(projection, { callId: 'call_x' }) })
  assert(registered.opens.length === 0, `opens ${registered.opens.length}`)
})

check('an existing documented chart is never auto-reopened twice', () => {
  // Two cards for the same chart id (a re-render of the same call, or a second
  // card after a scroll) must not fight the user's manual close.
  const projection = projectionOf([chart('deploy', CHAIN, { callId: 'call_a', seq: 9 })], { openSeq: 9 })
  const first = mountPlugin(projection)
  const second = mountPlugin(projection, { ui: first.ui })
  first.mount({ type: first.card, props: cardProps(projection, { callId: 'call_a' }) })
  second.mount({ type: second.card, props: cardProps(projection, { callId: 'call_a' }) })
  assert(first.registered.opens.length + second.registered.opens.length === 1, `${first.registered.opens.length + second.registered.opens.length} opens`)
})

check('the rejected card explains the failure with the first three errors', () => {
  const projection = projectionOf([], {
    failures: [{
      callId: 'call_bad',
      seq: 3,
      errors: [
        { line: 3, path: 'nodes[0].shape', message: 'unknown shape', hint: 'did you mean diamond?' },
        { line: 5, path: 'edges[0].to', message: 'unknown node', hint: 'check the id' },
        { line: 7, path: 'nodes[1].id', message: 'duplicate id', hint: 'ids must be unique' },
        { line: 9, path: 'nodes[2].id', message: 'fourth error', hint: 'hidden' },
      ],
    }],
  })
  const { mount, card } = mountPlugin(projection)
  const view = mount({ type: card, props: cardProps(projection, { callId: 'call_bad' }) })
  const items = view.findAll((node) => node.type === 'li')
  assert(items.length === 3, `rendered ${items.length} errors`)
  const text = items.map(nodeText).join(' ')
  assert(text.includes('did you mean diamond?'), text.slice(0, 160))
  assert(!text.includes('hidden'), 'the fourth error must not render')
  assert(view.find((node) => node.props['data-state'] === 'rejected'), 'rejected state')
})

check('the preparing card renders a placeholder row', () => {
  const { mount, card } = mountPlugin(projectionOf([]))
  const view = mount({ type: card, props: cardProps(projectionOf([]), { phase: 'preparing' }) })
  assert(view.find((node) => node.props['data-state'] === 'preparing'), 'preparing state')
  const text = view.all().filter((node) => node.type === 'text').map((node) => node.children[0]).join(' ')
  assert(text.includes('准备绘制流程图'), text)
})

check('the settings turn a synthesized legend on and off', () => {
  const on = projectionOf([chart('deploy', CHAIN)], { settings: { autoOpen: true, defaultDirection: 'TB', showLegendByDefault: true, export: { svg: true, png: true } } })
  const { mount, panel } = mountPlugin(on)
  const view = mount({ type: panel, props: panelProps(on) })
  const withLegend = view.find((node) => node.props.className === 'dsh-fc-layer').props.dangerouslySetInnerHTML.__html
  assert(withLegend.includes('fc-legend'), 'legend synthesised when the config asks')

  const off = projectionOf([chart('deploy', CHAIN)])
  const second = mountPlugin(off)
  const view2 = second.mount({ type: second.panel, props: panelProps(off) })
  const without = view2.find((node) => node.props.className === 'dsh-fc-layer').props.dangerouslySetInnerHTML.__html
  assert(!without.includes('fc-legend'), 'no legend by default')
})

check('the panel survives a projection that is still absent', () => {
  const { mount, panel } = mountPlugin({})
  const props = {
    t: translate,
    useProjection: () => undefined,
    useTabInfo: () => ({ tab: { navigation: {} } }),
  }
  const view = mount({ type: panel, props })
  assert(view.find((node) => node.props.className === 'dsh-fc-empty'), 'empty state')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) process.exit(1)