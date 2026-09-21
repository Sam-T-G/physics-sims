import { describe, expect, it } from 'vitest'
import { fmtFixed, fmtNum } from '../../apps/01-electrostatics/src/format'

/** "× 10" with non-breaking spaces, so a wrapped readout never splits a number. */
const X = '\u00a0×\u00a010'

// What a student reads on screen: 3 significant figures, trailing zeros kept, a real minus sign,
// thousands separators, and "× 10ⁿ" instead of the programmer "e-7" for very small or very large values.
describe('fmtNum', () => {
  it('keeps 3 significant figures, trailing zeros included', () => {
    expect(fmtNum(112.94)).toBe('113')
    expect(fmtNum(0.03595)).toBe('0.0360')
    expect(fmtNum(25)).toBe('25.0')
    expect(fmtNum(2.97)).toBe('2.97')
    expect(fmtNum(8.98755)).toBe('8.99')
  })
  it('uses a real minus sign', () => {
    expect(fmtNum(-112.94)).toBe('−113')
    expect(fmtNum(-0.000222)).toBe(`−2.22${X}⁻⁴`)
  })
  it('writes small and large values as × 10ⁿ with superscript exponents', () => {
    expect(fmtNum(0.000222)).toBe(`2.22${X}⁻⁴`)
    expect(fmtNum(4.5e-7)).toBe(`4.50${X}⁻⁷`)
    expect(fmtNum(544000)).toBe(`5.44${X}⁵`)
    // The notation is chosen after rounding: 0.0009996 shows as 0.00100, so it stays in plain form.
    expect(fmtNum(9.996e-4)).toBe('0.00100')
    expect(fmtNum(9.4e-4)).toBe(`9.40${X}⁻⁴`)
  })
  it('groups thousands in the middle range', () => {
    expect(fmtNum(13000)).toBe('13,000')
    expect(fmtNum(1234.5)).toBe('1,230')
    expect(fmtNum(999.6)).toBe('1,000')
  })
  it('handles zero and non-finite values', () => {
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(-0)).toBe('0')
    expect(fmtNum(Number.NaN)).toBe('—')
  })
})

describe('fmtFixed', () => {
  it('uses a real minus sign, an optional plus, and never shows −0.00', () => {
    expect(fmtFixed(-0.3, 2)).toBe('−0.30')
    expect(fmtFixed(1, 1, true)).toBe('+1.0')
    expect(fmtFixed(-2.5, 1, true)).toBe('−2.5')
    expect(fmtFixed(-0.001, 2)).toBe('0.00')
    expect(fmtFixed(0, 1, true)).toBe('0.0')
  })
})
