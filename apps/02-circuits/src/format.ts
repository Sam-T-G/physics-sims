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

/**
 * Whether a value reads in milli-units (below 0.1). Pass what the same readout used last time (`was`) for a little
 * hysteresis: a live value hovering near 0.1 then keeps its unit (it switches at 0.095 going down, 0.105 going up).
 */
export function useMilli(x: number, was?: boolean): boolean {
  if (!Number.isFinite(x) || x === 0) return false
  const a = Math.abs(x)
  return was === undefined ? a < 0.1 : was ? a < 0.105 : a < 0.095
}

/** Amps, volts, watts and coulombs read in milli- or kilo-units; ohms, farads and seconds never scale. */
export const scalable = (unit: string) => unit === 'A' || unit === 'V' || unit === 'W' || unit === 'C'

/**
 * The unit prefix a reading takes: 'm' below 0.1 (with `useMilli`'s hysteresis), 'k' once the value would print
 * 1000 or more (11520 W reads 11.5 kW, so a big reading keeps 3 figures), '' otherwise. `scale` turns the SI value
 * into the printed one.
 */
export function unitPrefix(x: number, unit: string, was?: boolean): { prefix: '' | 'm' | 'k'; scale: number } {
  if (!scalable(unit) || !Number.isFinite(x)) return { prefix: '', scale: 1 }
  if (useMilli(x, was)) return { prefix: 'm', scale: 1000 }
  if (Math.abs(x) >= 999.5) return { prefix: 'k', scale: 1e-3 }
  return { prefix: '', scale: 1 }
}

/** A reading with a friendlier unit: 0.00372 A reads 3.72 mA, 11520 W reads 11.5 kW. Equations keep the book's SI units. */
export function reading(x: number, unit: string, was?: boolean): string {
  const { prefix, scale } = unitPrefix(x, unit, was)
  return `${sig3(x * scale)} ${prefix}${unit}`
}
