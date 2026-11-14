/**
 * FlowChart — text metrics (design §8 step 2).
 *
 * Layout runs in the browser, where `CanvasRenderingContext2D.measureText`
 * gives exact advances. But layout must also be reproducible in a test
 * process with no DOM, and the same document must yield the same topology on
 * every device. So the estimator below is the *definition* of width, and a
 * caller may inject a real measurer to refine the pixels without changing the
 * topology.
 *
 * Widths follow the design doc: CJK 1.0em per character, Latin 0.55em.
 */

/** A code point that occupies a full em: CJK, Hangul, kana, fullwidth forms, emoji. */
function isWide(codePoint) {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

/**
 * Advance width of one character at one font size.
 * @param {string} char a single code point
 * @param {{ fontSize: number, mono?: boolean }} style
 */
export function charWidth(char, style) {
  const size = style.fontSize
  const codePoint = char.codePointAt(0)
  if (style.mono) return size * 0.6
  if (isWide(codePoint)) return size
  if (char === ' ') return size * 0.28
  if (char === '\t') return size * 1.1
  if (/[iljt.,:;'!|]/.test(char)) return size * 0.3
  if (/[mwMW@]/.test(char)) return size * 0.9
  if (/[A-Z0-9]/.test(char)) return size * 0.62
  return size * 0.55
}

/**
 * Width of one already-broken line.
 * @param {string} line
 * @param {{ fontSize: number, mono?: boolean }} style
 * @param {(text: string, style: object) => number} [measurer] optional exact measurer
 */
export function measureLine(line, style, measurer) {
  if (measurer) {
    const exact = measurer(line, style)
    if (typeof exact === 'number' && Number.isFinite(exact) && exact >= 0) return exact
  }
  let width = 0
  for (const char of line) width += charWidth(char, style)
  return width
}

/** Candidate break points: after a wide character, or after a space. */
function breakAfter(char) {
  if (char === ' ' || char === '\t' || char === '-') return true
  const codePoint = char.codePointAt(0)
  return isWide(codePoint)
}

/**
 * Break `text` into lines that fit `maxWidth`, honouring explicit newlines.
 *
 * Latin words stay whole (a word longer than the line is broken by character
 * as a last resort); CJK breaks between characters. When `maxLines` is given,
 * overflow is dropped and the last kept line is marked with an ellipsis, which
 * is how the design's "auto-wrap with overflow ellipsis" is implemented
 * without a layout engine.
 *
 * @param {string} text
 * @param {{ fontSize: number, mono?: boolean }} style
 * @param {{ maxWidth: number, maxLines?: number, measurer?: Function }} options
 * @returns {{ lines: string[], truncated: boolean, width: number }}
 */
export function wrapText(text, style, options) {
  const maxWidth = Math.max(1, options.maxWidth)
  const measurer = options.measurer
  const maxLines = options.maxLines ?? Infinity
  const lines = []

  for (const paragraph of String(text).split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let current = ''
    let width = 0
    let pendingWord = ''

    const flushWord = () => {
      if (pendingWord === '') return
      const wordWidth = measureLine(pendingWord, style, measurer)
      if (width > 0 && width + wordWidth > maxWidth) {
        lines.push(current)
        current = pendingWord
        width = wordWidth
      } else {
        current += pendingWord
        width += wordWidth
      }
      pendingWord = ''
    }

    for (const char of paragraph) {
      if (breakAfter(char)) {
        flushWord()
        const advance = measureLine(char, style, measurer)
        if (width > 0 && width + advance > maxWidth) {
          lines.push(current)
          current = char === ' ' ? '' : char
          width = char === ' ' ? 0 : advance
        } else {
          current += char
          width += advance
        }
        continue
      }
      pendingWord += char
    }
    flushWord()
    if (current !== '' || paragraph === '') lines.push(current)
  }

  let truncated = false
  let kept = lines
  if (lines.length > maxLines) {
    kept = lines.slice(0, maxLines)
    truncated = true
    const last = kept[kept.length - 1] ?? ''
    kept = [...kept.slice(0, -1), `${last}…`]
  }

  let width = 0
  for (const line of kept) width = Math.max(width, measureLine(line, style, measurer))
  return { lines: kept, truncated, width }
}