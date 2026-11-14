/**
 * M3 acceptance — the generated client bundle.
 *
 * The Client half must be one self-contained file, because the browser module
 * system resolves modules by package id rather than by path. These checks load
 * `client.js` through the same `window.__ModuleLoader__` contract the browser
 * uses, then apply it against a fake client context and assert it wires the
 * same things the source does.
 *
 * Also fails when the committed bundle is stale relative to `lib/*.js` or
 * `client/ui.js`, so the inlined copy can never drift silently.
 *
 * Run with: node test/client-bundle.test.mjs
 */

import { execFileSync } from 'node:child_process'
import { createClientContext } from './fake-client.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

let passed = 0
const failures = []

async function check(name, fn) {
  try {
    const detail = await fn()
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

/** Load the bundle exactly the way the browser loader does. */
async function loadBundle() {
  const registered = new Map()
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        registered.set(id, factory)
      },
    },
  }
  await import(pathToFileURL(join(ROOT, 'client.js')).href)
  return registered
}

// --- freshness ---------------------------------------------------------------

await check('the committed bundle matches its sources', () => {
  const output = execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-client.mjs'), '--check'], { encoding: 'utf8' })
  assert(output.includes('up to date'), output.trim())
  return output.trim()
})

// --- loader contract ---------------------------------------------------------

const bundle = await loadBundle()

await check('the bundle registers exactly one module id', () => {
  assert(bundle.size === 1, `registered ${[...bundle.keys()].join(', ')}`)
  assert(bundle.has('@local/dsh-plugin-flowchart'), [...bundle.keys()].join(','))
})

await check('the bundle is a single self-contained file', () => {
  const text = readFileSync(join(ROOT, 'client.js'), 'utf8')
  // No module syntax survives: the loader hands the factory a `require`, so a
  // stray import/export statement would fail at load time in the browser.
  assert(!/^\s*import\s/m.test(text), 'bundle still contains an import statement')
  assert(!/^\s*export\s/m.test(text), 'bundle still contains an export statement')
  assert(!text.includes("import('./"), 'bundle contains a dynamic import')
  assert(text.includes('window.__ModuleLoader__.load'), 'bundle does not register itself')
  assert(text.includes('require(\'react\')') || text.includes("require('react')"), 'bundle does not require react')
  return `${text.length} bytes`
})

await check('materializing the factory yields the plugin face', () => {
  const factory = bundle.get('@local/dsh-plugin-flowchart')
  const requested = []
  const ui = factory((specifier) => {
    requested.push(specifier)
    if (specifier === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: (value) => [value, () => {}],
        useMemo: (factory_) => factory_(),
        useEffect: () => {},
        useRef: (value) => ({ current: value }),
      }
    }
    throw new Error(`unexpected require(${specifier})`)
  })
  assert(requested.includes('react'), `requested ${requested.join(',')}`)
  assert(typeof ui.apply === 'function', 'no apply')
  assert(Array.isArray(ui.inject), 'no inject array')
  for (const service of ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']) {
    assert(ui.inject.includes(service), `missing inject: ${service}`)
  }
  return ui.inject.join(',')
})

await check('applying the bundle wires the tab type, the panel and the tool card', () => {
  const factory = bundle.get('@local/dsh-plugin-flowchart')
  const ui = factory(() => ({
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (value) => [value, () => {}],
    useMemo: (fn) => fn(),
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  }))
  const registered = { tabType: null, slots: [], effects: 0 }
  // An inject-enforcing context: a service read the plugin failed to declare
  // throws here exactly as it does in the browser (where it rolls the plugin
  // back and makes the tab and card vanish).
  const ctx = createClientContext({
    inject: ui.inject,
    services: {
      locale: { bind: () => (key) => key, register: () => () => {} },
      slots: {
        inject: (slot, callback) => {
          callback()
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
        openTab: () => {},
        mounted: { getSnapshot: () => 'session-under-test', subscribe: () => () => {} },
      },
      theme: { getTheme: () => ({ id: 'light' }) },
    },
    overrides: {
      effect: (fn) => {
        registered.effects += 1
        const dispose = fn()
        return typeof dispose === 'function' ? dispose : () => {}
      },
    },
  })
  ui.apply(ctx)
  assert(registered.tabType && registered.tabType.kind === 'flowchart', 'tab type not registered')
  assert(registered.tabType.multiple === false, 'must be one tab per kind')
  const names = registered.slots.map((entry) => `${entry.definition.name}:${entry.definition.key}`)
  assert(names.includes('sidebar.right.pane.tab:@local/dsh-plugin-flowchart'), names.join(','))
  assert(names.includes('tool.call.toolview:FlowChart'), names.join(','))
  for (const entry of registered.slots) {
    assert(typeof entry.component === 'function', `${entry.definition.name} got no component`)
  }
  assert(registered.effects >= 4, `effects ${registered.effects}`)
  return names.join(' + ')
})

await check('the bundle renders a panel without touching real browser APIs', () => {
  const factory = bundle.get('@local/dsh-plugin-flowchart')
  const element = (type, props, ...children) => ({ type, props: props ?? {}, children })
  const React = {
    createElement: element,
    useState: (value) => [value, () => {}],
    useMemo: (fn) => fn(),
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  }
  const ui = factory(() => React)
  const captured = []
  const ctx = createClientContext({
    inject: ui.inject,
    services: {
      locale: { bind: () => (key) => key, register: () => () => {} },
      slots: { inject: (slot, callback) => { callback(); return () => {} }, register: (definition, component) => { captured.push(component); return () => {} } },
      sidebarRightTabs: { register: () => () => {} },
      sidebarRight: { openTab: () => {}, mounted: { getSnapshot: () => 'session-under-test', subscribe: () => () => {} } },
      theme: { getTheme: () => ({ id: 'dark' }) },
    },
    overrides: { effect: (fn) => { fn(); return () => {} } },
  })
  ui.apply(ctx)
  const panel = captured[0]
  const output = panel({
    t: (key) => key,
    useProjection: () => undefined,
    useTabInfo: () => ({ tab: { navigation: {} } }),
    children: [],
  })
  assert(output, 'panel returned nothing')
  assert(output.props.className === 'dsh-fc', output.props.className)
})

await check('the context proxy refuses an undeclared service, and the plugin declares all it reads', () => {
  // The regression behind the live crash: `ctx.theme` was read without being
  // declared, the client context threw, and every registration rolled back.
  const services = { locale: { bind: () => (key) => key, register: () => () => {} }, theme: { getTheme: () => ({ id: 'light' }) } }
  const strict = createClientContext({ inject: ['locale'], services })
  let threw = false
  try {
    void strict.theme
  } catch (error) {
    threw = String(error.message).includes('without inject')
  }
  assert(threw, 'the enforcing context did not refuse an undeclared service read')

  const declared = createClientContext({ inject: ['locale', 'theme'], services })
  assert(declared.theme.getTheme().id === 'light', 'a declared service must resolve')
})

await check('the plugin declares every service it reads', () => {
  const factory = bundle.get('@local/dsh-plugin-flowchart')
  const ui = factory(() => ({ createElement: () => ({}), useState: (v) => [v, () => {}], useMemo: (fn) => fn(), useEffect: () => {}, useRef: (v) => ({ current: v }) }))
  for (const service of ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', 'theme']) {
    assert(ui.inject.includes(service), `inject is missing "${service}"`)
  }
  return ui.inject.join(',')
})

await check('the locale files carry every UI string the client uses', async () => {
  // Design §14: the JSON catalog and the bundled dictionaries must agree, so
  // copy cannot drift between what ships and what translators see.
  const { zh, en } = await import(pathToFileURL(join(ROOT, 'client', 'ui.js')).href)
  for (const [file, dict] of [['zh.json', zh], ['en.json', en]]) {
    const catalog = JSON.parse(readFileSync(join(ROOT, 'locale', file), 'utf8'))
    const missing = Object.keys(dict).filter((key) => !(key in catalog))
    assert(missing.length === 0, `${file} missing: ${missing.slice(0, 5).join(', ')}`)
    const drifted = Object.keys(dict).filter((key) => catalog[key] !== dict[key])
    assert(drifted.length === 0, `${file} differs on: ${drifted.slice(0, 5).join(', ')}`)
      const extra = Object.keys(catalog).filter((key) => !key.startsWith('meta.') && !(key in dict))
    assert(extra.length === 0, `${file} has unused keys: ${extra.slice(0, 5).join(', ')}`)
  }
  return `${Object.keys(zh).length} keys per language`
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) process.exit(1)