import { describe, it, expect } from 'vitest'
import { timeConstant, relaxVoltage, chargingCharge, chargingCurrent, dischargingCharge, dischargingCurrent } from '@lib/physics'
import { expectRel, expectAbs } from './helpers'

// Statements read from OpenStax University Physics Vol 2, Section 10.5, pp. 441–443 (rendered 2026-10-11):
// at t = τ the charge is 1 − e⁻¹ = 0.632 of Q = Cε; the current at t = 0 is I₀ = ε/R and at t = τ is
// 0.368 I₀; discharging, q falls to 0.368 Q₀ at t = τ and the current is negative.
const CLOSED = 1e-12

describe('RC (Section 10.5)', () => {
  const R = 4, C = 0.5, emf = 12
  const tau = timeConstant(R, C)
  it('Eq 10.9: τ = RC', () => expect(tau).toBe(2))
  it('Eq 10.8: q(τ) = 0.632 Cε, and q → Cε', () => {
    expectRel(chargingCharge(C, emf, R, tau), 0.632 * C * emf, 1e-3)
    expectRel(chargingCharge(C, emf, R, 50 * tau), C * emf, 1e-12)
    expect(chargingCharge(C, emf, R, 0)).toBe(0)
  })
  it('Eq 10.10: I(0) = ε/R, I(τ) = 0.368 I₀', () => {
    expectRel(chargingCurrent(emf, R, C, 0), emf / R, CLOSED)
    expectRel(chargingCurrent(emf, R, C, tau), 0.368 * emf / R, 1e-3)
  })
  it('Eq 10.10 is the time derivative of Eq 10.8', () => {
    const t = 1.3, h = 1e-6
    const dq = (chargingCharge(C, emf, R, t + h) - chargingCharge(C, emf, R, t - h)) / (2 * h)
    expectRel(dq, chargingCurrent(emf, R, C, t), 1e-7)
  })
  it('Eq 10.11 and 10.12: discharge falls to 0.368 Q₀ at τ, current negative and equal to dq/dt', () => {
    const Q = C * emf
    expectRel(dischargingCharge(Q, R, C, tau), 0.368 * Q, 1e-3)
    expect(dischargingCurrent(Q, R, C, 0)).toBeLessThan(0)
    const t = 0.7, h = 1e-6
    const dq = (dischargingCharge(Q, R, C, t + h) - dischargingCharge(Q, R, C, t - h)) / (2 * h)
    expectRel(dq, dischargingCurrent(Q, R, C, t), 1e-7)
  })
  it('relaxVoltage covers both book cases and starting part-way', () => {
    for (const t of [0, 0.5, 2, 7]) {
      expectRel(relaxVoltage(0, emf, tau, t) * C || 1e-300, chargingCharge(C, emf, R, t) || 1e-300, 1e-12)
      expectRel(relaxVoltage(emf, 0, tau, t) * C, dischargingCharge(C * emf, R, C, t), 1e-12)
    }
    expectAbs(relaxVoltage(3, 9, tau, tau), 9 - 6 * Math.exp(-1), 1e-12)
    expect(relaxVoltage(3, 9, Infinity, 100)).toBe(3)
    expect(relaxVoltage(3, 9, 0, 0.001)).toBe(9)
  })
})
