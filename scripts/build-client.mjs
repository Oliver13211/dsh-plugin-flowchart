/**
 * Build the Web Client half into one self-contained bundle.
 *
 * Why this exists: the browser module system keys modules by package id, not by
 * path (`window.__ModuleLoader__.load({ id, factory })`, and `require` walks a
 * table of registered ids). A relative `require('./lib/svg.js')` therefore has
 * nowhere to resolve, and one package ships exactly one client bundle
 * (`exports["./client"]`). So the Client half cannot import the shared
 * `lib/*.js` sources directly — this script inlines them instead.
 *
 * The point is to keep ONE source of truth. `lib/metrics.js`, `lib/layout.js`
 * and `lib/svg.js` stay ordinary ESM modules that the Host, the test suites and
 * Node diagnostics all import normally; `client/ui.js` stays an ordinary ESM
 * module too. This script rewrites their imports and exports into factory-local
 * IIFEs and writes the wrapper the loader expects.
 *
 * It is deliberately strict: any import or export form it does not understand
 * is a hard error rather than a silent miscompile. `test/client-bundle.test.mjs`
 * fails when the committed bundle is stale.
 *
 * Run with: node scripts/build-client.mjs [--check]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/** Modules inlined into the bundle, in dependency order. */
const MODULES = [
  { id: 'metrics', path: 'lib/metrics.js' },
  { id: 'layout', path: 'lib/layout.js' },
  { id: 'svg', path: 'lib/svg.js' },
  { id: 'ui', path: 'client/ui.js' },
]

const PLUGIN_ID = '@local/dsh-plugin-flowchart'
const OUTPUT = 'client.js'

/** Map a relative import specifier to the id of the module that provides it. */
function moduleIdForSpecifier(fromFile, specifier) {
  const target = relative(ROOT, join(ROOT, dirname(fromFile), specifier)).replace(/\\/g, '/')
  const match = MODULES.find((module) => module.path === target)
  if (!match) throw new Error(`${fromFile}: cannot inline import "${specifier}" (resolved to ${target}); add it to MODULES`)
  return match.id
}

/**
 * Rewrite one ESM source into a factory-local IIFE body plus its export names.
 * @param {{ id: string, path: string }} module
 * @returns {{ id: string, body: string, exports: string[], dependencies: string[] }}
 */
function inlineModule(module) {
  const source = readFileSync(join(ROOT, module.path), 'utf8')
  const exports = []
  const dependencies = []
  const lines = source.split('\n')

  const rewritten = lines.map((line, index) => {
    const where = `${module.path}:${index + 1}`

    let match = line.match(/^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;?\s*$/)
    if (match) {
      const names = match[1].split(',').map((name) => name.trim()).filter(Boolean)
      const id = moduleIdForSpecifier(module.path, match[2])
      if (!dependencies.includes(id)) dependencies.push(id)
      return `    const { ${names.join(', ')} } = __modules['${id}']`
    }

    match = line.match(/^import\s+(\w+)\s+from\s*'([^']+)'\s*;?\s*$/)
    if (match) throw new Error(`${where}: default imports are not supported (${line.trim()})`)

    match = line.match(/^export\s+function\s+(\w+)/)
    if (match) {
      exports.push(match[1])
      return line.replace(/^export\s+/, '')
    }

    match = line.match(/^export\s+(const|let|var|class)\s+(\w+)/)
    if (match) {
      exports.push(match[2])
      return line.replace(/^export\s+/, '')
    }

    match = line.match(/^export\s*\{([^}]*)\}\s*;?\s*$/)
    if (match) {
      for (const name of match[1].split(',').map((entry) => entry.trim()).filter(Boolean)) {
        exports.push(name)
      }
      return ''
    }

    if (/^export\s/.test(line)) throw new Error(`${where}: unsupported export form (${line.trim()})`)
    if (/^import\s/.test(line)) throw new Error(`${where}: unsupported import form (${line.trim()})`)
    return line
  })

  return { id: module.id, body: rewritten.join('\n'), exports, dependencies }
}

/** Emit the bundle text. */
function build() {
  const inlined = MODULES.map(inlineModule)
  const sections = inlined.map((module) => {
    const indented = module.body
      .split('\n')
      .map((line) => (line.length > 0 ? `      ${line}` : ''))
      .join('\n')
    return [
      `    // ---- ${MODULES.find((entry) => entry.id === module.id).path} ----`,
      `    __modules['${module.id}'] = (function () {`,
      indented,
      '',
      `      return { ${module.exports.join(', ')} }`,
      '    })()',
    ].join('\n')
  })

  const banner = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Built by scripts/build-client.mjs from lib/metrics.js, lib/layout.js,
 * lib/svg.js and client/ui.js. The browser module system resolves modules by
 * package id, so this half must be one self-contained bundle; the shared
 * layout and renderer sources are inlined here rather than duplicated.
 *
 * \`node scripts/build-client.mjs --check\` fails when this file is stale.
 */`

  const wrapper = `${banner}

window.__ModuleLoader__.load({
  id: '${PLUGIN_ID}',
  factory(require) {
    const React = require('react')
    const __modules = {}

${sections.join('\n\n')}

    return __modules['ui'].createUi(React)
  },
})
`

  // Trailing newline hygiene keeps the freshness check byte-stable.
  return wrapper.replace(/\n+$/, '\n')
}

const check = process.argv.includes('--check')
const text = build()
const target = join(ROOT, OUTPUT)

if (check) {
  let current = ''
  try {
    current = readFileSync(target, 'utf8')
  } catch {
    current = ''
  }
  if (current !== text) {
    console.error(`${OUTPUT} is stale: run "node scripts/build-client.mjs" and commit the result`)
    process.exit(1)
  }
  console.log(`${OUTPUT} is up to date (${text.length} bytes)`)
} else {
  writeFileSync(target, text)
  console.log(`wrote ${OUTPUT} (${text.length} bytes) from ${MODULES.map((module) => module.path).join(', ')}`)
}