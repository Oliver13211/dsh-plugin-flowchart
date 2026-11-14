/**
 * A very small React stand-in for the Client tests.
 *
 * The point is to exercise the real component functions — their hooks, their
 * element trees, and their event handlers — without a DOM, a browser, or a
 * testing-library dependency. It implements exactly the hook surface
 * `client/ui.js` uses: createElement, useState, useMemo, useEffect, useRef.
 *
 * Not shipped: this file only exists for the test suites.
 */

const MAX_RENDERS = 100

function sameDeps(previous, next) {
  if (previous === undefined || next === undefined) return false
  if (previous.length !== next.length) return false
  for (let index = 0; index < previous.length; index += 1) {
    if (!Object.is(previous[index], next[index])) return false
  }
  return true
}

export function createTestReact() {
  let hooks = []
  let cursor = 0
  let element = null
  let tree = null
  let rendering = false
  let dirty = false
  let renders = 0
  let pendingEffects = []

  function createElement(type, props, ...children) {
    const given = children.length > 0
      ? children
      : props && props.children !== undefined
        ? [props.children]
        : []
    const flat = given.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true)
    return { type, props: props ?? {}, children: flat }
  }

  function schedule() {
    dirty = true
    if (rendering) return
    drain()
  }

  /** Render until nothing is left to do, with a guard against a real loop. */
  function drain() {
    let guard = 0
    while (dirty || renders === 0) {
      dirty = false
      guard += 1
      if (guard > MAX_RENDERS) throw new Error(`render loop: ${guard} renders without settling`)
      renderOnce()
    }
  }

  function renderOnce() {
    renders += 1
    rendering = true
    cursor = 0
    const nextHooks = []
    try {
      const output = element.type(element.props)
      tree = normalize(output)
      for (let index = 0; index < hooks.length; index += 1) nextHooks[index] = hooks[index]
      hooks = nextHooks
    } finally {
      rendering = false
    }
    // Effects run after the render settles, and each effect is drained once.
    const toRun = pendingEffects
    pendingEffects = []
    for (const effect of toRun) effect()
  }

  function normalize(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (Array.isArray(node)) return node.map(normalize).filter(Boolean)
    if (typeof node === 'string' || typeof node === 'number') return { type: 'text', props: {}, children: [String(node)] }
    if (typeof node.type === 'function') {
      return normalize(node.type({ ...node.props, children: node.children }))
    }
    const children = node.children.map(normalize).filter(Boolean)
    const props = { ...node.props, children }
    // Attach refs to a fake DOM node so measuring paths (fit, pan) run for real
    // instead of silently returning early.
    if (props.ref && typeof props.ref === 'object') {
      props.ref.current = {
        getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600 }),
        addEventListener() {},
        removeEventListener() {},
        setPointerCapture() {},
        releasePointerCapture() {},
      }
    }
    return { type: node.type, props, children }
  }

  const React = {
    createElement,
    Fragment: Symbol('Fragment'),
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = hooks[index]
      return [slot.value, (next) => {
        slot.value = typeof next === 'function' ? next(slot.value) : next
        schedule()
      }]
    },
    useMemo(factory, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (!previous || !sameDeps(previous.deps, deps)) hooks[index] = { value: factory(), deps }
      return hooks[index].value
    },
    useEffect(fn, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (!previous || !sameDeps(previous.deps, deps)) {
        hooks[index] = { deps }
        pendingEffects.push(fn)
      }
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
  }

  function api() {
    return {
      get tree() {
        return tree
      },
      rerender(next) {
        if (next) element = next
        dirty = true
        drain()
      },
      all() {
        const out = []
        const visit = (node) => {
          if (!node || typeof node !== 'object') return
          out.push(node)
          for (const child of node.children || []) visit(child)
        }
        visit(tree)
        return out
      },
      find(predicate) {
        return this.all().find((node) => predicate(node))
      },
      findAll(predicate) {
        return this.all().filter((node) => predicate(node))
      },
      click(node) {
        if (node && node.props && typeof node.props.onClick === 'function') node.props.onClick({ preventDefault() {}, stopPropagation() {} })
        return this
      },
      change(node, value) {
        if (node && node.props && typeof node.props.onChange === 'function') node.props.onChange({ target: { value }, preventDefault() {} })
        return this
      },
    }
  }

  return {
    React,
    mount(next) {
      element = next
      hooks = []
      pendingEffects = []
      renders = 0
      dirty = false
      rendering = false
      drain()
      return api()
    },
  }
}
