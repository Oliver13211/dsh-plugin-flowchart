/**
 * FlowChart — session projection.
 *
 * The chart list is rebuilt from the Session log, never stored twice: an
 * inline chart folds out of the `FlowChart` tool call's own `yaml` argument
 * (zero extra context), and a `file` chart folds out of the snapshot block the
 * tool appends to its result, because a file's contents are not in the log.
 *
 * The shape follows the projection contract the Host registry expects:
 *
 *   { key, stateSchema, stateVersion, init, apply, wire: { viewSchema, view } }
 *
 * `apply` is synchronous and returns the **same state reference** for every
 * event it does not care about, which is what keeps a long session cheap.
 *
 * The schemas are duck-typed `{ parse(value) }` objects: the registry only
 * ever calls `stateSchema.parse` and `wire.viewSchema.parse`, so there is no
 * reason to ship a validation library in a plugin that has no dependencies.
 */

import { normalizeFlowChart } from './normalize.js'

export const PROJECTION_KEY = 'flowchart'
/**
 * Bumped whenever the folded state's shape changes.
 *
 * v1 charts carried no `callId`, so a v1 checkpoint row would seed a state in
 * which the conversation card can no longer find its own chart. The registry
 * discards a row whose version does not match and refolds the log from seq 0,
 * which is the intended recovery — so a shape change must bump this.
 *
 * v2 adds `callId`, `failures`, and `settings`.
 */
export const STATE_VERSION = 2
export const SNAPSHOT_LANGUAGE = 'flowchart-snapshot'

const MAX_CHARTS = 24
const MAX_PENDING = 32
const MAX_FAILURES = 12
const MAX_FAILURE_ERRORS = 6

export const DEFAULT_SETTINGS = {
  autoOpen: true,
  defaultDirection: 'TB',
  maxNodes: 60,
  maxEdges: 120,
  maxYamlChars: 20000,
  showLegendByDefault: false,
  export: { svg: true, png: true },
}

/**
 * Fold raw plugin config into the settings the projection needs. The Host's
 * Config schema has already validated it; this only fills the gaps so a
 * missing key can never change the fold.
 */
export function resolveSettings(config) {
  const raw = config !== null && typeof config === 'object' ? config : {}
  return {
    autoOpen: raw.autoOpen === undefined ? DEFAULT_SETTINGS.autoOpen : raw.autoOpen === true,
    defaultDirection:
      typeof raw.defaultDirection === 'string' && ['TB', 'BT', 'LR', 'RL'].includes(raw.defaultDirection.toUpperCase())
        ? raw.defaultDirection.toUpperCase()
        : DEFAULT_SETTINGS.defaultDirection,
    maxNodes: Number.isInteger(raw.maxNodes) ? raw.maxNodes : DEFAULT_SETTINGS.maxNodes,
    maxEdges: Number.isInteger(raw.maxEdges) ? raw.maxEdges : DEFAULT_SETTINGS.maxEdges,
    maxYamlChars: Number.isInteger(raw.maxYamlChars) ? raw.maxYamlChars : DEFAULT_SETTINGS.maxYamlChars,
    showLegendByDefault: raw.showLegendByDefault === undefined ? DEFAULT_SETTINGS.showLegendByDefault : raw.showLegendByDefault === true,
    export: {
      svg: raw.export?.svg === undefined ? DEFAULT_SETTINGS.export.svg : raw.export.svg === true,
      png: raw.export?.png === undefined ? DEFAULT_SETTINGS.export.png : raw.export.png === true,
    },
  }
}

/** The fenced block a `file` chart's snapshot travels in. */
export function snapshotFence(yaml) {
  return '```' + SNAPSHOT_LANGUAGE + '\n' + String(yaml).replace(/\s+$/, '') + '\n```'
}

const FENCE_PATTERN = /```flowchart-snapshot[ \t]*\r?\n([\s\S]*?)\r?\n?```/

function textOf(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .map((part) => (part && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
}

function callIdOf(message) {
  if (!message) return null
  if (typeof message.toolCallId === 'string') return message.toolCallId
  if (message.source && typeof message.source.callId === 'string') return message.source.callId
  return null
}

function parseArguments(raw) {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'object') return raw
  if (typeof raw !== 'string') return null
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function str(value, fallback) {
  return typeof value === 'string' ? value : fallback
}

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function arr(value) {
  return Array.isArray(value) ? value : []
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/**
 * A minimal `{ parse }` validator. It throws on anything the projection could
 * not have written, which is exactly what the registry needs to decide that a
 * checkpoint row is unusable.
 */
function makeStateSchema() {
  return {
    parse(value) {
      // The registry's `restore()` calls this WITHOUT a guard on the row it
      // just read from the cache. Throwing here ("checkpoint row is unusable")
      // surfaces as a session that cannot mount at all — reported by the owner
      // as 会话不可用 after using this tool. A row this plugin wrote must never
      // be rejected: drop entries that are not chart-shaped (they are refolded
      // from the log on the next full read) and accept the row.
      const safe = isPlainObject(value) ? value : {}
      const charts = Array.isArray(safe.charts) ? safe.charts.filter(isChartShape) : []
      return {
        charts: charts.map((chart) => ({
          id: chart.id,
          seq: chart.seq,
          version: chart.version,
          callId: typeof chart.callId === 'string' ? chart.callId : null,
          doc: chart.doc,
          source: isPlainObject(chart.source) ? { kind: str(chart.source.kind, 'inline'), path: str(chart.source.path, undefined) } : { kind: 'inline' },
          warnings: arr(chart.warnings).filter((warning) => typeof warning === 'string'),
        })),
        // A rejected call keeps its errors so the conversation card can explain
        // the retry without re-running the parser in the browser.
        failures: arr(safe.failures).filter(isPlainObject).map((failure) => ({
          callId: str(failure.callId, null),
          seq: num(failure.seq, 0),
          errors: arr(failure.errors).filter(isPlainObject).slice(0, MAX_FAILURE_ERRORS).map((error) => ({
            line: num(error.line, 0),
            path: str(error.path, ''),
            message: str(error.message, ''),
            hint: str(error.hint, ''),
          })),
        })),
        pending: arr(safe.pending).filter(isPlainObject).slice(0, MAX_PENDING),
        lastSeq: num(safe.lastSeq, 0),
        lastId: typeof safe.lastId === 'string' ? safe.lastId : null,
        openSeq: typeof safe.openSeq === 'number' && Number.isFinite(safe.openSeq) ? safe.openSeq : null,
        settings: resolveSettings(isPlainObject(safe.settings) ? safe.settings : {}),
      }
    },
  }
}

function makeViewSchema() {
  const state = makeStateSchema()
  let lastGood = null
  return {
    /**
     * Fail-soft on purpose. The registry calls `wire.view` from paths that do
     * not guard it (restore's write-back, the live drive's change push), and a
     * throw there aborts the session mount — the exact "session unavailable"
     * this plugin must never cause. A value this projection could not have
     * written is replaced by the last view it did write; first-call garbage
     * becomes an empty view, which the Client renders as its empty state.
     */
    parse(value) {
      try {
        const parsed = state.parse(value)
        delete parsed.pending
        lastGood = parsed
        return parsed
      } catch (error) {
        try {
          console.warn('[flowchart] wire view rejected; serving the last good view:', String(error && error.message))
        } catch {}
        if (lastGood !== null) return lastGood
        const empty = state.parse({ charts: [], failures: [], pending: [] })
        delete empty.pending
        return empty
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Projection definition
// ---------------------------------------------------------------------------

/**
 * Build the projection definition for a set of limits.
 * @param {{ maxChars: number, maxNodes: number, maxEdges: number }} limits
 */
export function createFlowChartProjectionDefinition(config = DEFAULT_SETTINGS) {
  const settings = resolveSettings(config)
  const limits = { maxChars: settings.maxYamlChars, maxNodes: settings.maxNodes, maxEdges: settings.maxEdges }
  const stateSchema = makeStateSchema()
  const viewSchema = makeViewSchema()

  return {
    key: PROJECTION_KEY,
    stateVersion: STATE_VERSION,
    stateSchema,
    wire: { viewSchema, view: (state) => viewSchema.parse(state) },

    init() {
      return {
        charts: [],
        failures: [],
        pending: [],
        lastSeq: 0,
        lastId: null,
        openSeq: null,
        settings,
      }
    },

    /**
     * Fold one Session event into the chart list.
     * @param {object} state current state
     * @param {{ seq: number, type: string, data?: object }} event
     * @returns {object} the same reference when the event is not a FlowChart call
     */
    apply(rawState, event) {
      // A fold can start from a state this definition did not build: the
      // registry seeds it from a checkpoint row (which travels through
      // `viewSchema.parse`, and that drops `pending`), from a row written under
      // an older stateVersion, or from a partially written one. Every branch
      // below reads `state.pending` / `state.failures` / `state.charts`, so a
      // missing list used to throw on the very first `tool/call` and take the
      // whole session mount down with it (the 11-01 outage). Fill the gaps
      // instead: an absent list means "nothing folded yet", which is what the
      // fold would do anyway.
      const state = sanitizeState(rawState)
      // The registry drives `apply` on the live session with no upstream guard
      // ("If a unit ... throws during the drive ... the error then propagates
      // to the Session's listener containment"). The fold must never be the
      // reason a session becomes unavailable, so an unexpected failure here
      // degrades to "this event changed nothing" and is logged instead.
      try {
        return foldEvent(state, event, limits, settings)
      } catch (error) {
        try {
          console.warn('[flowchart] fold degraded for', event && event.type, event && event.seq, String(error && error.message))
        } catch {}
        return state
      }
    },
  }
}

/**
 * Normalize any seeded state into the exact shape the fold reads.
 *
 * Lists are not enough: a chart entry from a foreign or damaged row can be
 * `null`, a number, or miss `doc` — letting it through produces a state whose
 * checkpoint row later fails `stateSchema.parse`, and `restore()` does not
 * guard that parse. So entries are filtered by the same shape the schema
 * demands, and a state that cannot be trusted at all is replaced by a fresh
 * one (identical semantics to "nothing folded yet").
 */
function sanitizeState(rawState) {
  const base = rawState !== null && typeof rawState === 'object' && !Array.isArray(rawState) ? rawState : {}
  const fresh = {
    charts: [],
    failures: [],
    pending: [],
    lastSeq: num(base.lastSeq, 0),
    lastId: typeof base.lastId === 'string' ? base.lastId : null,
    openSeq: typeof base.openSeq === 'number' && Number.isFinite(base.openSeq) ? base.openSeq : null,
    settings: resolveSettings(base.settings !== null && typeof base.settings === 'object' ? base.settings : {}),
  }
  // Both paths keep chart-shaped entries: the rebuild path exists exactly for
  // seeds missing a list (a wire view has no `pending`), and losing the charts
  // there would silently erase history on every checkpoint continuation.
  fresh.charts = Array.isArray(base.charts) ? base.charts.filter(isChartShape) : []
  if (!Array.isArray(base.failures) || !Array.isArray(base.pending)) return fresh
  fresh.failures = base.failures
  fresh.pending = base.pending
  return fresh
}

/** The minimal shape `stateSchema` requires of one chart entry. */
function isChartShape(chart) {
  if (!isPlainObject(chart)) return false
  if (typeof chart.id !== 'string' || chart.id === '') return false
  if (typeof chart.seq !== 'number' || !Number.isFinite(chart.seq)) return false
  if (typeof chart.version !== 'number' || !Number.isFinite(chart.version)) return false
  const doc = chart.doc
  if (!isPlainObject(doc)) return false
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return false
  for (const node of doc.nodes) {
    if (!isPlainObject(node) || typeof node.id !== 'string') return false
  }
  return true
}

/**
 * The fold itself, extracted from `apply` so the wrapper can guard it.
 * Reads only fields `sanitizeState` guarantees; returns the same reference
 * when the event is not a FlowChart event.
 */
function foldEvent(state, event, limits, settings) {
  if (!event || typeof event.type !== 'string') return state

  if (event.type === 'tool/call') {
    const data = event.data
    if (!data || data.name !== 'FlowChart') return state
    const args = parseArguments(data.arguments)
    if (args === null) return state
    const callId = typeof data.callId === 'string' ? data.callId : null
    if (callId === null) return state
    const pending = state.pending.length >= MAX_PENDING ? state.pending.slice(1) : state.pending.slice()
    pending.push({
      callId,
      seq: num(event.seq, 0),
      yaml: typeof args.yaml === 'string' ? args.yaml : null,
      file: typeof args.file === 'string' ? args.file : null,
      open: args.open === undefined ? settings.autoOpen : args.open === true,
    })
    return { ...state, pending }
  }

  if (event.type === 'tool/result') {
    const message = event.data && event.data.message
    const callId = callIdOf(message)
    if (callId === null) return state
    const index = state.pending.findIndex((entry) => entry.callId === callId)
    if (index === -1) return state

    const entry = state.pending[index]
    const pending = state.pending.slice()
    pending.splice(index, 1)

    const built = buildChart(entry, textOf(message), limits, settings)
    if (built === null) {
      const errors = rejectionErrors(entry, textOf(message), limits, settings)
      const failures = errors === null
        ? state.failures
        : [...state.failures, { callId, seq: entry.seq, errors }].slice(-MAX_FAILURES)
      return { ...state, pending, failures, lastSeq: num(event.seq, state.lastSeq) }
    }

    const charts = state.charts.slice()
    const existing = charts.findIndex((chart) => chart.id === built.id)
    if (existing === -1) {
      charts.push(built)
    } else {
      charts[existing] = { ...built, version: charts[existing].version + 1 }
    }
    while (charts.length > MAX_CHARTS) {
      let oldest = 0
      for (let i = 1; i < charts.length; i += 1) {
        if (charts[i].seq < charts[oldest].seq) oldest = i
      }
      charts.splice(oldest, 1)
    }
    charts.sort((a, b) => a.seq - b.seq)

    return {
      charts,
      failures: state.failures,
      pending,
      lastSeq: num(event.seq, state.lastSeq),
      lastId: built.id,
      openSeq: entry.open ? entry.seq : state.openSeq,
      settings: state.settings,
    }
  }

  return state
}

/**
 * Rebuild one chart from a folded tool call and its result text.
 * @returns {object | null} null when the call produced no chart
 */
function buildChart(entry, resultText, limits, settings) {
  const fenced = FENCE_PATTERN.exec(resultText)
  const yaml = entry.yaml !== null ? entry.yaml : (fenced ? fenced[1] : null)
  if (yaml === null || yaml === '') return null

  const result = normalizeFlowChart(yaml, limits, { defaultDirection: settings.defaultDirection })
  if (!result.ok) return null

  return {
    id: result.doc.id,
    seq: entry.seq,
    version: 1,
    callId: entry.callId,
    doc: result.doc,
    source: entry.file !== null ? { kind: 'file', path: entry.file } : { kind: 'inline' },
    warnings: result.warnings,
  }
}

/**
 * The validation errors behind a rejected call, or null when this call is not
 * the one the tool rejected (an unrelated result, or a call with no document).
 *
 * The fold already re-runs the validator to decide whether a chart exists, so
 * collecting the errors costs one more call in the failing case only — and it
 * keeps the browser free of the parser.
 */
function rejectionErrors(entry, resultText, limits, settings) {
  const fenced = FENCE_PATTERN.exec(resultText)
  const yaml = entry.yaml !== null ? entry.yaml : (fenced ? fenced[1] : null)
  if (yaml === null || yaml === '') return null
  const result = normalizeFlowChart(yaml, limits, { defaultDirection: settings.defaultDirection })
  if (result.ok) return null
  return result.errors.slice(0, MAX_FAILURE_ERRORS)
}

/** The default projection definition, with the shipped limits. */
export const flowChartProjectionDefinition = createFlowChartProjectionDefinition(DEFAULT_SETTINGS)

/**
 * Fold a list of Session events into a projection state. Used by the tests and
 * by the offline check that the persistence path rebuilds a real session.
 */
export function foldEvents(events, definition = flowChartProjectionDefinition) {
  let state = definition.init({}, 0)
  for (const event of events) state = definition.apply(state, event)
  return state
}
