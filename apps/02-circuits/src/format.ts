// Number formatting for every value on screen. Pure.

const MINUS = '−'

/** n significant figures, keeping trailing zeros the way the book prints them (1.50, 12.0, 0.500). */
export function sig(x: number, n = 3): string {
  if (Number.isNaN(x)) return '?'
  if (!Number.isFinite(x)) return x > 0 ? '∞' : `${MINUS}∞`
  // nothing on this board is real below a picounit; it is float residue (and toFixed throws past 100 digits)
  if (Math.abs(x) < 1e-12) return '0'
  const digits = n - 1 - Math.floor(Math.log10(Math.abs(x)))
  const s = digits > 0 ? x.toFixed(digits) : Math.round(x).toString()
  // rounding can carry into a new digit (9.996 → "10.00"); redo at the new magnitude
  const back = Number(s)
  if (back !== 0 && Math.floor(Math.log10(Math.abs(back))) !== Math.floor(Math.log10(Math.abs(x)))) return sig(back, n)
  return s.replace('-', MINUS)
}
export const sig3 = (x: number) => sig(x, 3)

/** A dialed value is exact, so print it as dialed: 13, 0.5, 100. */
export function exact(x: number): string {
  return String(x).replace('-', MINUS)
}

export const SUB: Record<string, string> = { R1: 'R₁', R2: 'R₂', R3: 'R₃', R4: 'R₄', R5: 'R₅' }
export const SUB_DIGIT: Record<string, string> = { R1: '₁', R2: '₂', R3: '₃', R4: '₄', R5: '₅' }

/** A reading with a friendlier unit for small values: 0.00372 A reads 3.72 mA. Equations keep the book's SI units. */
export function reading(x: number, unit: string): string {
  const scalable = unit === 'A' || unit === 'V' || unit === 'W' || unit === 'C'
  if (scalable && Number.isFinite(x) && x !== 0 && Math.abs(x) < 0.1) return `${sig3(x * 1000)} m${unit}`
  return `${sig3(x)} ${unit}`
}
