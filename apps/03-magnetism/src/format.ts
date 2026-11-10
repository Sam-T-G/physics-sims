// Number formatting for every value on screen. Pure. Builds on sim 2's significant-figure rules.
import { sig } from '../../02-circuits/src/format'

const PREFIXES: [number, string][] = [[1, ''], [1e-3, 'm'], [1e-6, 'μ'], [1e-9, 'n'], [1e-12, 'p']]

/** A reading with an SI prefix so it prints 1 to 999: 8.49e-5 T reads 84.9 μT, 1e-10 N/m reads 100 pN/m. */
export function si(x: number, unit: string, n = 3): string {
  if (!Number.isFinite(x)) return sig(x, n)
  if (Math.abs(x) < 1e-15) return `0 ${unit}`
  const a = Math.abs(x)
  // 999.6 μT rounds to "1000" at 3 figures, so pick the prefix from the rounded value
  for (const [p, name] of PREFIXES) {
    if (Number(sig(a / p, n).replace('−', '-')) >= 1) return `${sig(x / p, n)} ${name}${unit}`
  }
  return `${sig(x / 1e-12, n)} p${unit}`
}

/** A dialed current, printed exactly: 10 A, 0.5 A, 5 mA. */
export function amps(I: number): string {
  const a = Math.abs(I)
  if (a === 0) return '0 A'
  return a >= 0.1 ? `${Math.round(a * 1000) / 1000} A` : `${Math.round(a * 1e6) / 1000} mA`
}

/** A scale-bar length, trimmed: 5 cm, 1 cm, 2.5 mm. */
export function scaleLabel(d: number): string {
  const [v, u] = d < 0.01 - 1e-12 ? [d * 1000, 'mm'] : [d * 100, 'cm']
  return `${Number(v.toPrecision(3))} ${u}`
}

/** A distance in centimeters, 3 figures: 1.41 cm. */
export const cm = (d: number) => `${sig(d * 100, 3)} cm`

/** A number for KaTeX: 3 figures, scientific notation outside 0.01 to 1000, a plain minus sign. */
export function texSci(x: number, n = 3): string {
  if (!Number.isFinite(x)) return '\\text{—}'
  if (Math.abs(x) < 1e-15) return '0'
  const e = Math.floor(Math.log10(Math.abs(x)))
  if (e >= -2 && e < 3) return sig(x, n).replace('−', '-')
  let mant = x / 10 ** e
  // 9.996 × 10⁻⁵ rounds to 10.0: carry into the exponent
  let ms = sig(mant, n).replace('−', '-')
  if (Math.abs(Number(ms)) >= 10) { mant /= 10; ms = sig(mant, n).replace('−', '-'); return `${ms} \\times 10^{${e + 1}}` }
  return `${ms} \\times 10^{${e}}`
}

/** A unit direction as the book writes it: −0.8 î + 0.6 ĵ (2 figures). */
export function direction(ux: number, uy: number): string {
  const part = (v: number) => sig(v, 2).replace('−', '')
  const sx = ux < 0 ? '−' : ''
  const sy = uy < 0 ? '−' : '+'
  return `${sx}${part(ux)} î ${sy} ${part(uy)} ĵ`
}
