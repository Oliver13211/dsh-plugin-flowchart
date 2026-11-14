/**
 * A client context that enforces the `inject` contract, like Cordis does.
 *
 * This exists because a plain object fake let a real crash through: `apply()`
 * read `ctx.theme` without declaring it, and the live client context is a proxy
 * that THROWS on an undeclared service read ("cannot get property ... without
 * inject"). A thrown `apply` rolls back every registration the plugin made, so
 * the tab and the tool card simply disappear.
 *
 * Cordis's trap, reproduced:
 *   - an own property (or a core context member) resolves normally;
 *   - a declared service with no provider: "cannot get required service ... in
 *     inactive context";
 *   - anything else: "cannot get property ... without inject".
 *
 * Not shipped: this file only exists for the test suites.
 */

/** Members every client context carries regardless of `inject`. */
const CORE = new Set([
  'effect', 'on', 'once', 'emit', 'waterfall', 'bail', 'parallel', 'serial',
  'fiber', 'reflect', 'logger', 'scope', 'isolate', 'extend', 'plugin', 'inject',
  'setTimeout', 'setInterval', 'provide', 'get', 'set', 'start', 'stop',
])

/**
 * @param {{ inject: string[], services?: object, overrides?: object }} options
 *   `inject` is the plugin's declared list; `services` are the providers that
 *   actually exist.
 */
export function createClientContext(options) {
  const declared = new Set(options.inject ?? [])
  const services = options.services ?? {}
  const target = { ...(options.overrides ?? {}) }

  return new Proxy(target, {
    get(scope, property) {
      if (typeof property === 'symbol') return Reflect.get(scope, property)
      if (Reflect.has(scope, property)) return Reflect.get(scope, property)
      if (CORE.has(property)) return Reflect.get(scope, property)
      if (property in services) {
        if (!declared.has(property)) {
          throw new Error(`cannot get property "${property}" without inject`)
        }
        return services[property]
      }
      if (declared.has(property)) {
        throw new Error(`cannot get required service "${property}" in inactive context`)
      }
      throw new Error(`cannot get property "${property}" without inject`)
    },
    has(scope, property) {
      return Reflect.has(scope, property) || CORE.has(String(property)) || String(property) in services
    },
  })
}
