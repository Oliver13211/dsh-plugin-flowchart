/**
 * FlowChart DSL — YAML-subset reader and first-pass checks.
 *
 * Scope of this module (M0): read the block-YAML subset the FlowChart DSL uses
 * (nested mappings, sequences, scalars, inline flow lists), report the exact line
 * of a syntax problem, and run the structural checks that decide whether a
 * document can become a chart at all. Styling normalization and the remaining
 * validation layers arrive with M1.
 *
 * No dependencies: the Host half runs on Node built-ins only.
 */

export const SHAPES = [
  'rect', 'rounded', 'stadium', 'ellipse', 'circle', 'diamond', 'hexagon',
  'parallelogram', 'cylinder', 'document', 'cloud', 'triangle', 'star', 'note', 'subroutine',
]

export const DIRECTIONS = ['TB', 'BT', 'LR', 'RL']

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/

/** A syntax or structure problem located in the source document. */
export class DslError extends Error {
  constructor(message, line = 1, path = '', hint = '') {
    super(message)
    this.name = 'DslError'
    this.line = line
    this.path = path
    this.hint = hint
  }
}

/** Drop a trailing `# comment` that sits outside quotes. */
function stripComment(line) {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"') {
      if (!inSingle) inDouble = !inDouble
    } else if (ch === '#' && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return line.slice(0, i)
    }
  }
  return line
}

/** Turn the document into `{ no, indent, dash, text }` lines, skipping blanks. */
function tokenize(text) {
  const out = []
  const raw = String(text).split(/\r?\n/)
  for (let i = 0; i < raw.length; i += 1) {
    const no = i + 1
    const stripped = stripComment(raw[i])
    if (!stripped.trim()) continue
    const first = stripped.search(/\S/)
    const lead = stripped.slice(0, first)
    if (lead.includes('\t')) {
      throw new DslError('Indentation must use spaces, not tabs', no, '', 'Replace each tab with two spaces.')
    }
    const body = stripped.trim()
    if (body === '---' || body === '...') {
      throw new DslError('Multiple documents are not supported', no, '', 'Keep one flow chart per document.')
    }
    if (body === '-') out.push({ no, indent: lead.length, dash: true, text: '' })
    else if (body.startsWith('- ')) out.push({ no, indent: lead.length, dash: true, text: body.slice(2).trim() })
    else out.push({ no, indent: lead.length, dash: false, text: body })
  }
  return out
}

/** Index of the `key:` separator on a block line, ignoring quoted and flow parts. */
function findKey(text) {
  let inSingle = false
  let inDouble = false
  let depth = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth += 1
      else if (ch === ']' || ch === '}') depth -= 1
      else if (ch === ':' && depth === 0 && (i === text.length - 1 || text[i + 1] === ' ')) return i
    }
  }
  return -1
}

/** Split a flow collection body on top-level commas. */
function splitFlow(body) {
  const parts = []
  let inSingle = false
  let inDouble = false
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i]
    if (ch === "'" && !inDouble) inSingle = !inSingle
    else if (ch === '"' && !inSingle) inDouble = !inDouble
    else if (!inSingle && !inDouble) {
      if (ch === '[' || ch === '{') depth += 1
      else if (ch === ']' || ch === '}') depth -= 1
      else if (ch === ',' && depth === 0) {
        parts.push(body.slice(start, i))
        start = i + 1
      }
    }
  }
  parts.push(body.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

function unquote(text, line) {
  const t = text.trim()
  if (t.startsWith('"') && t.endsWith('"') && t.length > 1) {
    return t.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length > 1) return t.slice(1, -1).replace(/''/g, "'")
  if (t.startsWith('"') || t.startsWith("'")) {
    throw new DslError('A quoted value is not closed', line, '', 'Close the quote, or write the value without quotes.')
  }
  return t
}

function parseScalar(text, line) {
  const t = text.trim()
  if (t === '') return null
  if (t.startsWith('|') || t.startsWith('>')) {
    throw new DslError('Block scalars (| and >) are not supported', line, '', 'Write the text as one quoted string.')
  }
  if (/^[&*!@?`]/.test(t)) {
    throw new DslError('This YAML feature is not supported', line, '', 'Use plain keys, scalars, lists, and nested maps.')
  }
  if (t.startsWith('[') && t.endsWith(']')) return splitFlow(t.slice(1, -1)).map((part) => parseScalar(part, line))
  if (t.startsWith('{') && t.endsWith('}')) {
    const obj = {}
    for (const part of splitFlow(t.slice(1, -1))) {
      const idx = findKey(part)
      if (idx < 0) throw new DslError('Expected "key: value" inside { }', line, '', 'Write { key: value, key: value }.')
      obj[unquote(part.slice(0, idx), line)] = parseScalar(part.slice(idx + 1), line)
    }
    return obj
  }
  if (t.startsWith('"') || t.startsWith("'")) return unquote(t, line)
  if (t === 'true') return true
  if (t === 'false') return false
  if (t === 'null' || t === '~') return null
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  return t
}

function parseNode(lines, i, indent) {
  if (i >= lines.length) return [null, i]
  const line = lines[i]
  if (line.indent < indent) return [null, i]
  if (line.dash) return parseSequence(lines, i, line.indent)
  return parseMapping(lines, i, line.indent)
}

/**
 * Attach the source line of one parsed value without polluting it: `__line`
 * and `__keys` are non-enumerable, so JSON serialization and structural
 * comparisons never see them.
 */
function markLine(value, no) {
  if (value && typeof value === 'object') {
    Object.defineProperty(value, '__line', { value: no, enumerable: false, configurable: true })
  }
  return value
}

function parseMapping(lines, i, indent) {
  const obj = {}
  const keys = {}
  while (i < lines.length) {
    const line = lines[i]
    if (line.indent !== indent || line.dash) break
    const idx = findKey(line.text)
    if (idx < 0) {
      throw new DslError(`Expected "key: value", got "${line.text}"`, line.no, '', 'Every line in a block is "key: value" or a "- item" list.')
    }
    const key = unquote(line.text.slice(0, idx), line.no)
    keys[key] = line.no
    const rest = line.text.slice(idx + 1).trim()
    if (rest === '') {
      const next = lines[i + 1]
      if (next && next.indent > indent) {
        const [value, after] = parseNode(lines, i + 1, next.indent)
        obj[key] = value
        i = after
        continue
      }
      if (next && next.indent === indent && next.dash) {
        const [value, after] = parseSequence(lines, i + 1, indent)
        obj[key] = value
        i = after
        continue
      }
      obj[key] = null
      i += 1
      continue
    }
    obj[key] = parseScalar(rest, line.no)
    i += 1
  }
  Object.defineProperty(obj, '__keys', { value: keys, enumerable: false, configurable: true })
  return [obj, i]
}

function parseSequence(lines, i, indent) {
  const out = []
  while (i < lines.length && lines[i].indent === indent && lines[i].dash) {
    const line = lines[i]
    const content = line.text
    if (content === '') {
      const next = lines[i + 1]
      if (next && next.indent > indent) {
        const [value, after] = parseNode(lines, i + 1, next.indent)
        out.push(markLine(value, line.no))
        i = after
        continue
      }
      out.push(null)
      i += 1
      continue
    }
    const column = indent + 2
    if (content === '-' || content.startsWith('- ')) {
      lines[i] = { no: line.no, indent: column, dash: true, text: content === '-' ? '' : content.slice(2).trim() }
      const [value, after] = parseSequence(lines, i, column)
      out.push(markLine(value, line.no))
      i = after
      continue
    }
    if (findKey(content) < 0) {
      out.push(parseScalar(content, line.no))
      i += 1
      continue
    }
    lines[i] = { no: line.no, indent: column, dash: false, text: content }
    const [value, after] = parseMapping(lines, i, column)
    out.push(markLine(value, line.no))
    i = after
  }
  return [out, i]
}

/** Parse the document into plain JavaScript values. */
export function parseDsl(text) {
  const lines = tokenize(text)
  if (lines.length === 0) {
    throw new DslError('The document is empty', 1, '', 'Write "nodes:" with at least one "- id: ..." item.')
  }
  const [value, after] = parseNode(lines, 0, lines[0].indent)
  if (after < lines.length) {
    throw new DslError(
      'Indentation does not line up',
      lines[after].no,
      '',
      'Use two spaces per nesting level and align every "- id:" item in a list.',
    )
  }
  return value
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function asText(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/**
 * The document line a problem should point at: the line of `key` when the
 * parser recorded it, otherwise the line the item started on.
 */
export function lineOf(item, key) {
  if (!item || typeof item !== 'object') return 1
  if (key !== undefined) {
    const keys = item.__keys
    if (keys && keys[key] !== undefined) return keys[key]
  }
  return item.__line !== undefined ? item.__line : 1
}

/**
 * Layer 1 (lexical/syntax) plus the identity checks layer 3 depends on.
 *
 * Returns the parsed document with its line map intact so the normalization
 * pass can report every later problem at the line the author wrote.
 * @param {string} text
 * @param {{ maxChars: number, maxNodes: number, maxEdges: number }} limits
 * @returns {{ ok: boolean, doc?: object, ids?: string[], errors: Array<{ line: number, path: string, message: string, hint: string }>, warnings: string[] }}
 */
export function parseStructure(text, limits) {
  const errors = []
  const warnings = []

  if (text.length > limits.maxChars) {
    return {
      ok: false,
      errors: [{
        line: 1,
        path: '',
        message: `The YAML is ${text.length} characters, over the ${limits.maxChars} limit.`,
        hint: 'Split the explanation into two smaller charts.',
      }],
      warnings,
    }
  }

  let doc
  try {
    doc = parseDsl(text)
  } catch (error) {
    if (error instanceof DslError) {
      return { ok: false, errors: [{ line: error.line, path: error.path, message: error.message, hint: error.hint }], warnings }
    }
    return { ok: false, errors: [{ line: 1, path: '', message: String((error && error.message) || error), hint: 'Check the YAML syntax.' }], warnings }
  }

  if (!isPlainObject(doc)) {
    return {
      ok: false,
      errors: [{
        line: 1,
        path: '',
        message: 'The top level must be a mapping with nodes and edges.',
        hint: 'Start the document with "nodes:" and a list of "- id: ..." items.',
      }],
      warnings,
    }
  }

  if (!Array.isArray(doc.nodes) || doc.nodes.length === 0) {
    return {
      ok: false,
      errors: [{
        line: lineOf(doc, 'nodes'),
        path: 'nodes',
        message: 'nodes must be a non-empty list of node objects.',
        hint: 'nodes:\n  - id: start\n    label: 开始',
      }],
      warnings,
    }
  }

  if (doc.nodes.length > limits.maxNodes) {
    return {
      ok: false,
      errors: [{
        line: lineOf(doc, 'nodes'),
        path: 'nodes',
        message: `${doc.nodes.length} nodes exceed the ${limits.maxNodes} limit.`,
        hint: 'Group steps into a sub-chart, or draw the part the reader struggles with.',
      }],
      warnings,
    }
  }

  const ids = []
  const seen = new Set()
  doc.nodes.forEach((node, index) => {
    const at = `nodes[${index}]`
    if (!isPlainObject(node)) {
      errors.push({ line: lineOf(node), path: at, message: 'Each node must be an object with an id.', hint: '- id: step1\n    label: 步骤一' })
      return
    }
    const id = asText(node.id)
    if (id === null || id === '') {
      errors.push({ line: lineOf(node), path: `${at}.id`, message: 'A node needs an id.', hint: 'Give every node a short unique id.' })
      return
    }
    if (!ID_PATTERN.test(id)) {
      errors.push({
        line: lineOf(node, 'id'),
        path: `${at}.id`,
        message: `Node id "${id}" is not a letter followed by letters, digits, "-" or "_".`,
        hint: 'Use ids like start, check_cache, step-2.',
      })
      return
    }
    if (seen.has(id)) {
      errors.push({ line: lineOf(node, 'id'), path: `${at}.id`, message: `Node id "${id}" is used more than once.`, hint: 'Node ids must be unique.' })
      return
    }
    seen.add(id)
    ids.push(id)
  })

  const rawEdges = doc.edges === undefined ? [] : doc.edges
  if (!Array.isArray(rawEdges)) {
    errors.push({ line: lineOf(doc, 'edges'), path: 'edges', message: 'edges must be a list of edge objects.', hint: 'edges:\n  - from: start\n    to: end' })
  } else if (rawEdges.length > limits.maxEdges) {
    errors.push({
      line: lineOf(doc, 'edges'),
      path: 'edges',
      message: `${rawEdges.length} edges exceed the ${limits.maxEdges} limit.`,
      hint: 'Draw fewer connections, or split the chart.',
    })
  } else {
    rawEdges.forEach((edge, index) => {
      const at = `edges[${index}]`
      if (!isPlainObject(edge)) {
        errors.push({ line: lineOf(edge), path: at, message: 'Each edge must be an object with from and to.', hint: '- from: start\n    to: end' })
        return
      }
      const from = asText(edge.from)
      const to = asText(edge.to)
      if (from === null || from === '' || to === null || to === '') {
        errors.push({ line: lineOf(edge), path: at, message: 'An edge needs both from and to node ids.', hint: '- from: start\n    to: end' })
        return
      }
      if (!seen.has(from)) errors.push({ line: lineOf(edge, 'from'), path: `${at}.from`, message: `Unknown node id "${from}".`, hint: 'from must match a node id.' })
      if (!seen.has(to)) errors.push({ line: lineOf(edge, 'to'), path: `${at}.to`, message: `Unknown node id "${to}".`, hint: 'to must match a node id.' })
    })
  }

  return { ok: errors.length === 0, doc, ids, errors, warnings }
}

/**
 * Read a FlowChart document and run the checks that decide whether it can
 * become a chart: shape of the document, node identities, and edge endpoints.
 * @returns {{ ok: boolean, id?: string, title?: string, nodes?: number, edges?: number, warnings?: string[], errors?: Array<{ line: number, path: string, message: string, hint: string }> }}
 */
export function parseFlowChart(text, limits) {
  const structure = parseStructure(text, limits)
  if (!structure.ok) return { ok: false, errors: structure.errors }
  const { doc } = structure
  const warnings = structure.warnings.slice()

  doc.nodes.forEach((node, index) => {
    if (!isPlainObject(node)) return
    if (node.shape !== undefined) {
      const shape = asText(node.shape)
      if (shape === null || !SHAPES.includes(shape)) {
        warnings.push(`nodes[${index}].shape "${String(node.shape)}" is not a known shape; using rect. Known shapes: ${SHAPES.join(', ')}.`)
      }
    }
    if (node.label !== undefined && asText(node.label) === null) {
      warnings.push(`nodes[${index}].label must be text; it was ignored.`)
    }
  })

  const rawEdges = Array.isArray(doc.edges) ? doc.edges : []
  rawEdges.forEach((edge, index) => {
    if (!isPlainObject(edge)) return
    const from = asText(edge.from)
    const to = asText(edge.to)
    if (from !== null && from === to) warnings.push(`edges[${index}] connects "${from}" to itself.`)
  })

  const direction = doc.direction === undefined ? undefined : asText(doc.direction)
  if (direction !== undefined && !DIRECTIONS.includes(direction)) {
    warnings.push(`direction "${String(doc.direction)}" is not one of ${DIRECTIONS.join(', ')}; using TB.`)
  }

  const title = asText(doc.title)
  const id = asText(doc.id)
  return {
    ok: true,
    id: id !== null && id !== '' ? id : (title !== null && title !== '' ? title : 'flowchart'),
    title: title !== null && title !== '' ? title : undefined,
    nodes: doc.nodes.length,
    edges: rawEdges.length,
    warnings,
  }
}
