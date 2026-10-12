import { describe, it, expect } from 'vitest'
import {
  solveCircuit,
  seriesResistance,
  parallelResistance,
  batteryCurrent,
  terminalVoltage,
  type CircuitElement,
} from '@lib/physics'
import { expectRel, expectAbs } from './helpers'

// Expected values are the book's printed answers, read from the rendered pages of OpenStax University
// Physics Vol 2 (local PDF, School/textbooks) on 2026-10-11: Example 10.1 (p. 411), 10.2 (p. 415),
// 10.3 (pp. 417–418), 10.4 (pp. 421–422). The book prints 3 or 4 significant figures, so printed values
// are held at relative 5e-3; closed forms computed here are held at 1e-9.
const SIG3 = 5e-3
const CLOSED = 1e-9

const R = (a: number, b: number, value: number): CircuitElement => ({ kind: 'resistor', a, b, R: value })
const E = (a: number, b: number, emf: number): CircuitElement => ({ kind: 'source', a, b, emf })

function solved(n: number, els: CircuitElement[]) {
  const s = solveCircuit(n, els)
  if (!s.ok) throw new Error('expected a solution')
  return s
}

describe('book formulas', () => {
  it('Eq 10.2 series sum, Example 10.2: four 20 Ω and one 10 Ω give 90 Ω', () => {
    expect(seriesResistance([20, 20, 20, 20, 10])).toBe(90)
  })
  it('Eq 10.3 parallel, Example 10.3: 1, 2, 2 Ω give 0.50 Ω, less than the smallest', () => {
    expectRel(parallelResistance([1, 2, 2]), 0.5, CLOSED)
    expect(parallelResistance([1, 2, 2])).toBeLessThan(1)
  })
  it('empty series path is open (Infinity); empty parallel set is open; a 0 Ω branch shorts the set', () => {
    expect(seriesResistance([])).toBe(Infinity)
    expect(parallelResistance([])).toBe(Infinity)
    expect(parallelResistance([0, 5])).toBe(0)
    expect(seriesResistance([3, Infinity])).toBe(Infinity)
  })
  it('Example 10.1(a): ε = 12.00 V, r = 0.100 Ω, R = 10.00 Ω → I = 1.188 A, V_terminal = 11.90 V', () => {
    const I = batteryCurrent(12, 10, 0.1)
    expectRel(I, 1.188, SIG3)
    expectRel(terminalVoltage(12, I, 0.1), 11.9, SIG3)
  })
  it('Example 10.1(b): R = 0.500 Ω → I = 20.00 A, V_terminal = 10.00 V', () => {
    const I = batteryCurrent(12, 0.5, 0.1)
    expectRel(I, 20, CLOSED)
    expectRel(terminalVoltage(12, I, 0.1), 10, CLOSED)
  })
  it('an open load gives zero current and V_terminal = ε; a dead short on an ideal battery is Infinity', () => {
    expect(batteryCurrent(12, Infinity, 0.1)).toBe(0)
    expect(terminalVoltage(12, 0, 0.1)).toBe(12)
    expect(batteryCurrent(12, 0, 0)).toBe(Infinity)
    expectRel(batteryCurrent(12, 0, 0.5), 24, CLOSED) // short with r > 0: I = ε/r
  })
})

describe('solveCircuit (nodal analysis)', () => {
  it('Example 10.2: 9 V across 20+20+20+20+10 Ω in series → I = 0.1 A, V = 2,2,2,2,1 V, P = 0.9 W', () => {
    // nodes 0 (−) → 1 (+) → 2 → 3 → 4 → 5 → back to 0
    const els = [E(0, 1, 9), R(1, 2, 20), R(2, 3, 20), R(3, 4, 20), R(4, 5, 20), R(5, 0, 10)]
    const s = solved(6, els)
    for (let k = 1; k <= 5; k++) expectRel(s.I[k]!, 0.1, SIG3, `I${k}`)
    expectRel(s.I[0]!, 0.1, SIG3, 'source')
    const drops = [s.V[1]! - s.V[2]!, s.V[2]! - s.V[3]!, s.V[3]! - s.V[4]!, s.V[4]! - s.V[5]!, s.V[5]! - s.V[0]!]
    ;[2, 2, 2, 2, 1].forEach((v, k) => expectRel(drops[k]!, v, SIG3, `V${k + 1}`))
    const pR = [20, 20, 20, 20, 10].reduce((sum, r, k) => sum + s.I[k + 1]! ** 2 * r, 0)
    expectRel(pR, 0.9, SIG3, 'P dissipated')
    expectRel(s.I[0]! * 9, 0.9, SIG3, 'P source')
  })

  it('Example 10.3: 3.00 V across 1, 2, 2 Ω in parallel → 6.00 A total; 3.00, 1.50, 1.50 A; 18.00 W', () => {
    const els = [E(0, 1, 3), R(1, 0, 1), R(1, 0, 2), R(1, 0, 2)]
    const s = solved(2, els)
    expectRel(s.I[0]!, 6, SIG3, 'I source')
    expectRel(s.I[1]!, 3, SIG3, 'I1')
    expectRel(s.I[2]!, 1.5, SIG3, 'I2')
    expectRel(s.I[3]!, 1.5, SIG3, 'I3')
    expectRel(s.I[1]! + s.I[2]! + s.I[3]!, s.I[0]!, CLOSED, 'junction')
    expectRel(s.I[0]! * 3, 18, SIG3, 'P')
  })

  it('Example 10.4: 12.0 V, R1 = 1.00 Ω in series with 6.00 ∥ 13.00 Ω → I = 2.35 A, V1 = 2.35 V, V2 = 9.65 V, I2 = 1.61 A, P2 = 15.5 W', () => {
    // 0 (−) → 1 (+) → R1 → 2 → (R2 ∥ R3) → 0
    const els = [E(0, 1, 12), R(1, 2, 1), R(2, 0, 6), R(2, 0, 13)]
    const s = solved(3, els)
    expectRel(s.I[0]!, 2.35, SIG3, 'I')
    expectRel(s.V[1]! - s.V[2]!, 2.35, SIG3, 'V1')
    expectRel(s.V[2]! - s.V[0]!, 9.65, SIG3, 'V2')
    expectRel(s.I[2]!, 1.61, SIG3, 'I2')
    expectRel(s.I[2]! ** 2 * 6, 15.5, SIG3, 'P2')
    // the same numbers as the book's closed form
    const Req = 1 + parallelResistance([6, 13])
    expectRel(Req, 5.1, SIG3, 'Req printed')
    expectRel(s.I[0]!, 12 / Req, CLOSED, 'I closed form')
  })

  it('Example 10.1 as a circuit: emf in series with r, then the load', () => {
    // 0 (−) → emf → 1 → r → 2 (+ terminal) → load → 0
    const s = solved(3, [E(0, 1, 12), R(1, 2, 0.1), R(2, 0, 10)])
    expectRel(s.I[0]!, 1.188, SIG3)
    expectRel(s.V[2]! - s.V[0]!, 11.9, SIG3, 'V_terminal')
  })

  it('junction rule holds at every node and battery power equals ΣI²R (energy check)', () => {
    // a bridge (needs Kirchhoff; not series/parallel reducible), with internal resistance
    const els = [E(0, 1, 10), R(1, 2, 0.5), R(2, 3, 2), R(2, 4, 4), R(3, 4, 3), R(3, 0, 5), R(4, 0, 1)]
    const s = solved(5, els)
    const net = new Float64Array(5)
    els.forEach((el, k) => { net[el.a]! -= s.I[k]!; net[el.b]! += s.I[k]! })
    // current leaving a through the element counts as out; sign convention: I positive from a to b
    for (let n = 0; n < 5; n++) expectAbs(net[n]!, 0, 1e-9, `node ${n}`)
    let heat = 0
    els.forEach((el, k) => { if (el.kind === 'resistor') heat += s.I[k]! ** 2 * el.R })
    expectRel(s.I[0]! * 10, heat, 1e-9, 'energy')
  })

  it('loop rule: the potential changes around a closed loop sum to zero', () => {
    const els = [E(0, 1, 12), R(1, 2, 1), R(2, 0, 6), R(2, 0, 13)]
    const s = solved(3, els)
    const loop = 12 - s.I[1]! * 1 - s.I[2]! * 6
    expectAbs(loop, 0, 1e-9)
  })

  it('an open circuit (a gap in the only path) carries no current and prints no NaN', () => {
    // node 3 is a dangling end: the path 1 → 2, then nothing from 3 back
    const s = solved(4, [E(0, 1, 12), R(1, 2, 4), R(3, 0, 6)])
    for (const i of s.I) { expect(Number.isFinite(i)).toBe(true); expectAbs(i, 0, 1e-9) }
    for (const v of s.V) expect(Number.isFinite(v)).toBe(true)
  })

  it('a node with nothing attached still gets a finite potential', () => {
    const s = solved(4, [E(0, 1, 5), R(1, 0, 5)])
    expect(s.V.every(Number.isFinite)).toBe(true)
    expectRel(s.I[0]!, 1, CLOSED)
  })

  it('an island of 1 µΩ wires cut off on both sides solves to zero current, not "singular"', () => {
    const w = 1e-6
    // battery 0 → 1, a gap, then an island 2–3–4 of wires and a resistor, a gap, back to 0
    const s = solved(5, [E(0, 1, 12), R(1, 0, 6), R(2, 3, w), R(3, 4, 4), R(4, 2, w)])
    expectRel(s.I[0]!, 2, CLOSED)
    for (let k = 2; k < 5; k++) expectAbs(s.I[k]!, 0, 1e-9, `island ${k}`)
    expect(s.V.every(Number.isFinite)).toBe(true)
  })

  it('two ideal emfs fighting directly across each other is singular, and says so', () => {
    const s = solveCircuit(2, [E(0, 1, 12), E(0, 1, 9)])
    expect(s.ok).toBe(false)
  })

  it('a tiny resistance stands in for a wire without changing printed digits', () => {
    const wire = 1e-6
    const s = solved(4, [E(0, 1, 12), R(1, 2, wire), R(2, 3, 1), R(3, 0, 6), R(3, 0, 13)])
    expectRel(s.I[0]!, 12 / 5.1053, 1e-4)
    // two wires side by side split the current evenly
    const t = solved(3, [E(0, 1, 6), R(1, 2, wire), R(1, 2, wire), R(2, 0, 3)])
    expectRel(t.I[1]!, 1, 1e-6)
    expectRel(t.I[2]!, 1, 1e-6)
  })
})
