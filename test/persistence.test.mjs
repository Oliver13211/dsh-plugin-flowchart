/**
 * §9.1 persistence acceptance — the read side.
 *
 * The live Host wrote the flowchart projection row into the session projection
 * cache. This replays what a cold reader does with it:
 *
 *   1. `stateSchema.parse(row.val)` seeds the state from the checkpoint row;
 *   2. every event after the row's watermark folds forward on top of it;
 *   3. the result must equal a full fold from `init` over the whole log.
 *
 * Run with: node tmp/test-persistence.mjs [sessionId]
 * Without a session id it picks the newest cache file that has a flowchart row.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { flowChartProjectionDefinition } from '../lib/projection.js'

const CACHE_DIR = join(process.env.HOME, '.dsh/storages/session_projcache/sessions')
const SESSION_DIR = join(process.env.HOME, '.dsh/sessions/--Users-wzw-Documents-deepseek-harness-default-workspace--')
const ZSTD = '/opt/homebrew/bin/zstd'

/** Every session with a flowchart row, newest first. */
function sessionsWithFlowChart() {
  const files = readdirSync(CACHE_DIR).filter((name) => name.endsWith('.json'))
  const withRow = []
  for (const name of files) {
    const path = join(CACHE_DIR, name)
    try {
      const cache = JSON.parse(readFileSync(path, 'utf8'))
      const row = cache?.record?.rows?.flowchart
      if (row) withRow.push({ path, session: name.replace(/\.json$/, ''), mtime: statSync(path).mtimeMs })
    } catch {
      // A cache file mid-write is not evidence of anything; skip it.
    }
  }
  withRow.sort((a, b) => b.mtime - a.mtime)
  return withRow
}

function readSessionEvents(sessionId) {
  const source = join(SESSION_DIR, sessionId, 'session.v4.jsonl.zstd')
  // A session whose log is missing, empty, or mid-write is not evidence; the
  // caller walks on to the next candidate.
  if (!existsSync(source) || statSync(source).size === 0) return null
  let plain
  try {
    plain = execFileSync(ZSTD, ['-dc', source], { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')
  } catch {
    return null
  }
  const events = []
  for (const line of plain.split('\n')) {
    if (!line) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // Ignore a torn final line.
    }
  }
  return events
}

const target = process.argv[2] ?? null
const candidates = target
  ? [{ path: join(CACHE_DIR, `${target}.json`), session: target }]
  : sessionsWithFlowChart()

if (candidates.length === 0) {
  console.log('skip: no projection cache file carries a flowchart row yet')
  process.exit(0)
}

// Walk the candidates newest-first for one that can actually be tested: a
// readable log AND a row at the live stateVersion. Anything else is reported
// rather than silently skipped, so a genuine absence stays visible.
const notes = []
let chosen = null
for (const candidate of candidates) {
  const cache = JSON.parse(readFileSync(candidate.path, 'utf8'))
  const candidateRow = cache.record.rows.flowchart
  const events = readSessionEvents(candidate.session)
  if (events === null || events.length === 0) {
    notes.push(`${candidate.session}: log not readable`)
    continue
  }
  if (candidateRow.ver !== flowChartProjectionDefinition.stateVersion) {
    notes.push(`${candidate.session}: row is version ${candidateRow.ver}, live unit is ${flowChartProjectionDefinition.stateVersion}`)
    continue
  }
  chosen = { ...candidate, row: candidateRow, events }
  break
}
if (chosen === null) {
  console.log('skip: no session has both a readable log and a current-version row yet')
  for (const note of notes) console.log(`  - ${note}`)
  console.log('  (the registry discards a stale row and refolds from seq 0; a fresh row appears after the next checkpoint)')
  process.exit(0)
}
if (notes.length > 0) for (const note of notes) console.log(`  note: ${note}`)
const row = chosen.row
const events = chosen.events

let failures = 0
function check(name, fn) {
  try {
    const detail = fn()
    console.log(`  ok  ${name}${detail ? `  (${detail})` : ''}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${name}: ${error && error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed')
}

console.log(`session ${chosen.session}`)
console.log(`row ver=${row.ver} watermark seq=${row.seq}; log has ${events.length} events`)

assert(row.ver === flowChartProjectionDefinition.stateVersion, 'chosen row version drifted')

check('the persisted row parses through stateSchema', () => {
  const state = flowChartProjectionDefinition.stateSchema.parse(row.val)
  assert(Array.isArray(state.charts), 'charts is a list')
  return `${state.charts.length} charts`
})

check('the row version matches the live stateVersion', () => {
  assert(row.ver === flowChartProjectionDefinition.stateVersion, `row ver ${row.ver} vs live ${flowChartProjectionDefinition.stateVersion}`)
})

check('seeding from the row and folding the tail equals a full fold', () => {
  const seeded = flowChartProjectionDefinition.stateSchema.parse(row.val)
  const tail = events.filter((event) => event.seq > row.seq)
  let state = seeded
  for (const event of tail) state = flowChartProjectionDefinition.apply(state, event)

  let full = flowChartProjectionDefinition.init({}, 0)
  for (const event of events) full = flowChartProjectionDefinition.apply(full, event)

  assert(
    JSON.stringify(state) === JSON.stringify(full),
    `seeded+tail ${state.charts.length} charts vs full ${full.charts.length} charts`,
  )
  return `${tail.length} tail events, ${full.charts.length} charts`
})

check('the restored state passes the client view schema', () => {
  const view = flowChartProjectionDefinition.wire.viewSchema.parse(
    flowChartProjectionDefinition.wire.view(flowChartProjectionDefinition.stateSchema.parse(row.val)),
  )
  assert(Array.isArray(view.charts), 'view charts')
  const deploy = view.charts.find((chart) => chart.id === 'deploy')
  assert(deploy === undefined || deploy.doc.nodes.length > 0, 'deploy doc has nodes')
})

check('the restored state is JSON-clean for the next checkpoint', () => {
  const state = flowChartProjectionDefinition.stateSchema.parse(row.val)
  const roundTrip = JSON.parse(JSON.stringify(state))
  const again = flowChartProjectionDefinition.stateSchema.parse(roundTrip)
  assert(JSON.stringify(again) === JSON.stringify(roundTrip), 'round-trip changed the restored state')
})

console.log(`\n${failures === 0 ? 'persistence path verified' : `${failures} failed`}`)
if (failures > 0) process.exit(1)