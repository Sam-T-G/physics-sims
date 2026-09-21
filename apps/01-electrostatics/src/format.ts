// Number formatting for everything a student reads. No dependencies, so it is unit-tested directly.

const SUPERSCRIPT: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }

/**
 * `sig` significant figures with trailing zeros kept, a real minus sign (U+2212), thousands separators,
 * and "× 10ⁿ" when the rounded value is below 0.001 or at least 100 000. Non-finite values show a dash.
 */
export function fmtNum(x: number, sig = 3): string {
  if (!Number.isFinite(x)) return '—'
  if (x === 0) return '0'
  const a = Math.abs(x)
  let s: string
  const [m0, e0] = a.toExponential(sig - 1).split('e')
  const exp = Number(e0)
  if (exp >= 5 || exp < -3) {
    // Non-breaking spaces keep a number in one piece when a readout wraps.
    s = `${m0}\u00a0×\u00a010${[...String(exp)].map(ch => SUPERSCRIPT[ch] ?? ch).join('')}`
  } else {
    s = a.toPrecision(sig)
    if (s.includes('e') || Number(s) >= 1000) s = Number(s).toLocaleString('en-US', { maximumFractionDigits: 20 })
  }
  return (x < 0 ? '−' : '') + s
}

/** Fixed decimals with a real minus sign (U+2212) and, if asked, an explicit plus: for slider values. */
export function fmtFixed(x: number, digits: number, plus = false): string {
  const t = Math.abs(x).toFixed(digits)
  if (Number(t) === 0) return t
  return (x < 0 ? '−' : plus ? '+' : '') + t
}
