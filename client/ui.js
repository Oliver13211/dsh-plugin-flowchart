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

import { layoutDoc } from '../lib/layout.js'
import { renderSvg } from '../lib/svg.js'

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
export function buildExportSvg(doc, options = {}) {
  const theme = options.theme === 'dark' ? 'dark' : 'light'
  const base = { ...doc, theme: doc.theme === 'auto' ? theme : doc.theme }
  const geometry = layoutDoc(base)
  return renderSvg(base, geometry, { title: options.title, background: options.background !== false })
}

export function createUi(React) {
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

export { NS, TAB_ID, KIND, PROJECTION_KEY, zh, en, css, DIRECTIONS }