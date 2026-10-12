// Resistor color code: two digit bands and a multiplier band (value = (10·d₁ + d₂) × 10^m).
// Pure; the scene paints these colors on each resistor so the bands really spell its value.

export const BAND_NAMES = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'gray', 'white'] as const
export type BandName = (typeof BAND_NAMES)[number] | 'gold' | 'silver'

/** Soft versions of the standard band colors, so they sit in the cozy palette and stay readable. */
export const BAND_HEX: Record<BandName, string> = {
  black: '#3b3440', brown: '#8a5a44', red: '#e5574f', orange: '#f28c3a', yellow: '#f3c94b',
  green: '#5cae6e', blue: '#4f86d9', violet: '#9168d1', gray: '#9a9aa6', white: '#fbf8f2',
  gold: '#d8a93c', silver: '#c3c7cf',
}

export function colorBands(ohms: number): [BandName, BandName, BandName] {
  if (!(ohms > 0) || !Number.isFinite(ohms)) throw new Error(`no color code for ${ohms} Ω`)
  // Find m so that ohms / 10^m is a two-digit whole number 10..99.
  let m = Math.floor(Math.log10(ohms)) - 1
  let digits = Math.round(ohms / 10 ** m)
  if (digits >= 100) { m += 1; digits = Math.round(ohms / 10 ** m) }
  if (m < -2 || m > 9) throw new Error(`no color code for ${ohms} Ω`)
  const d1 = Math.floor(digits / 10)
  const d2 = digits % 10
  const mult: BandName = m === -1 ? 'gold' : m === -2 ? 'silver' : BAND_NAMES[m]!
  return [BAND_NAMES[d1]!, BAND_NAMES[d2]!, mult]
}
