import { describe, it, expect } from 'vitest'
import { solveBoard, PRESETS, OHM_STEPS, type BoardInput } from '../../apps/02-circuits/src/board'
import { colorBands } from '../../apps/02-circuits/src/colorCode'
import { expectRel, expectAbs } from '../physics/helpers'

// Printed answers from OpenStax University Physics Vol 2, read off the rendered pages 2026-10-11.
const SIG3 = 5e-3
const preset = (id: string): BoardInput => {
  const p = PRESETS.find(q => q.id === id)
  if (!p) throw new Error(id)
  return p.input
}

describe('board vs the book', () => {
  it('Example 10.1 preset: I = 1.188 A, V_terminal = 11.90 V', () => {
    const b = solveBoard(preset('ex10-1'))
    expect(b.status).toBe('ok')
    expectRel(b.I, 1.188, SIG3)
    expectRel(b.Vt, 11.9, SIG3)
    expectRel(b.slots.R1!.I, 1.188, SIG3, 'full solve current')
  })

  it('Example 10.3 preset: R_P = 0.50 Ω, I = 6.00 A, 3.00/1.50/1.50 A, 18.00 W', () => {
    const b = solveBoard(preset('ex10-3'))
    expectRel(b.Rp, 0.5, SIG3)
    expectRel(b.I, 6, SIG3)
    expectRel(b.slots.R2!.I, 3, SIG3)
    expectRel(b.slots.R3!.I, 1.5, SIG3)
    expectRel(b.slots.R4!.I, 1.5, SIG3)
    expectRel(b.Pemf, 18, SIG3)
  })

  it('Example 10.4 preset: R_eq = 5.10 Ω, I = 2.35 A, V₁ = 2.35 V, V₂ = 9.65 V, I₂ = 1.61 A, P₂ = 15.5 W', () => {
    const b = solveBoard(preset('ex10-4'))
    expectRel(b.Req, 5.1, SIG3)
    expectRel(b.I, 2.35, SIG3)
    expectRel(b.slots.R1!.V, 2.35, SIG3)
    expectRel(b.slots.R2!.V, 9.65, SIG3)
    expectRel(b.slots.R2!.I, 1.61, SIG3)
    expectRel(b.slots.R2!.P, 15.5, SIG3)
  })

  it('every book check passes on every preset', () => {
    for (const p of PRESETS) {
      const b = solveBoard(p.input)
      expect(b.checks.length, p.id).toBeGreaterThan(5)
      for (const c of b.checks) expect(c.ok, `${p.id} ${c.id}`).toBe(true)
    }
  })
})

describe('board behavior', () => {
  const base: BoardInput = {
    emf: 12, r: 0.5,
    slots: { R1: { kind: 'resistor', ohms: 2 }, R2: { kind: 'resistor', ohms: 6 }, R5: { kind: 'resistor', ohms: 4 } },
  }

  it('adding a parallel branch lowers R_eq and raises the battery current (the big misconception)', () => {
    const before = solveBoard(base)
    const after = solveBoard({ ...base, slots: { ...base.slots, R3: { kind: 'resistor', ohms: 6 } } })
    expect(after.Req).toBeLessThan(before.Req)
    expect(after.Rp).toBeLessThan(6)
    expect(after.I).toBeGreaterThan(before.I)
    expectRel(after.Rp, 3, 1e-9)
  })

  it('an empty series slot opens the circuit: zero current everywhere, no NaN, the gap named', () => {
    const b = solveBoard({ ...base, slots: { ...base.slots, R1: undefined } })
    expect(b.status).toBe('open')
    expect(b.gaps).toEqual(['R1'])
    expect(b.I).toBe(0)
    expect(b.Vt).toBe(12)
    for (const x of b.wireI) expect(x).toBe(0)
    for (const v of b.V) expect(Number.isFinite(v)).toBe(true)
    expect(b.checks).toEqual([])
  })

  it('both series slots empty (a cut-off island) still solves cleanly', () => {
    const b = solveBoard({ ...base, slots: { R2: { kind: 'resistor', ohms: 6 } } })
    expect(b.status).toBe('open')
    expect(b.gaps).toEqual(['R1', 'R5'])
    for (const x of b.wireI) expect(x).toBe(0)
  })

  it('no branch filled is open too', () => {
    const b = solveBoard({ ...base, slots: { R1: base.slots.R1, R5: base.slots.R5 } })
    expect(b.status).toBe('open')
    expect(b.gaps).toEqual(['lanes'])
  })

  it('a wire branch bypasses the resistor branches: they read 0 A', () => {
    const b = solveBoard({ ...base, slots: { ...base.slots, R3: { kind: 'wire' } } })
    expect(b.bypassed).toEqual(['R2'])
    expect(b.slots.R2!.I).toBe(0)
    expectRel(b.slots.R3!.I, b.I, 1e-4)
    expectRel(b.Req, 6, 1e-9)
  })

  it('a dead short with r > 0 gives I = ε/r (the book’s short-circuit limit)', () => {
    const b = solveBoard({ emf: 12, r: 0.5, slots: { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R5: { kind: 'wire' } } })
    expect(b.status).toBe('short')
    expect(b.idealShort).toBe(false)
    expectRel(b.I, 24, 1e-4)
    expectAbs(b.Vt, 0, 1e-4)
  })

  it('a dead short on an ideal battery reports no finite answer instead of a million amps', () => {
    const b = solveBoard({ emf: 12, r: 0, slots: { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R5: { kind: 'wire' } } })
    expect(b.idealShort).toBe(true)
    expect(b.I).toBe(Infinity)
    for (const x of b.wireI) expect(x).toBe(0)
  })

  it('energy and every book check hold across many random boards', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 300; n++) {
      const pick = () => {
        const u = rnd()
        if (u < 0.2) return undefined
        if (u < 0.3) return { kind: 'wire' as const }
        return { kind: 'resistor' as const, ohms: OHM_STEPS[Math.floor(rnd() * OHM_STEPS.length)]! }
      }
      const input: BoardInput = {
        emf: 1 + Math.round(rnd() * 46) / 2,
        r: Math.round(rnd() * 40) / 20,
        slots: { R1: pick(), R2: pick(), R3: pick(), R4: pick(), R5: pick() },
      }
      const b = solveBoard(input)
      if (b.idealShort || b.status === 'open') continue
      for (const c of b.checks) expect(c.ok, `${JSON.stringify(input)} ${c.id}`).toBe(true)
      expect(Number.isFinite(b.I)).toBe(true)
    }
  })
})

describe('color code', () => {
  it('spells the dialed values', () => {
    expect(colorBands(13)).toEqual(['brown', 'orange', 'black'])
    expect(colorBands(1)).toEqual(['brown', 'black', 'gold'])
    expect(colorBands(0.5)).toEqual(['green', 'black', 'silver'])
    expect(colorBands(100)).toEqual(['brown', 'black', 'brown'])
    expect(colorBands(6)).toEqual(['blue', 'black', 'gold'])
    expect(colorBands(50)).toEqual(['green', 'black', 'black'])
  })
  it('has a code for every value on the dial', () => {
    for (const v of OHM_STEPS) expect(() => colorBands(v)).not.toThrow()
  })
})

import { sig3 } from '../../apps/02-circuits/src/format'
describe('sig3', () => {
  it('prints three significant figures the way the book does', () => {
    expect(sig3(1.5)).toBe('1.50')
    expect(sig3(12)).toBe('12.0')
    expect(sig3(2.3505)).toBe('2.35')
    expect(sig3(0.5)).toBe('0.500')
    expect(sig3(9.996)).toBe('10.0')
    expect(sig3(150)).toBe('150')
    expect(sig3(1188.1)).toBe('1188')
    expect(sig3(-0.25)).toBe('−0.250')
    expect(sig3(0)).toBe('0')
    expect(sig3(Infinity)).toBe('∞')
  })
})

describe('preset book values', () => {
  it('the sim value behind every printed book value matches it to the printed digits', () => {
    for (const p of PRESETS) {
      const b = solveBoard(p.input)
      for (const v of p.book) {
        const printed = parseFloat(v.value)
        expectRel(v.of(b), printed, SIG3, `${p.id} ${v.label}`)
      }
    }
  })
})

describe('review regressions (2026-10-11)', () => {
  it('a resistor beside a wire branch reads exactly 0 A and 0 V even at 48 A', () => {
    const b = solveBoard({ emf: 24, r: 0, slots: { R1: { kind: 'resistor', ohms: 0.5 }, R2: { kind: 'wire' }, R3: { kind: 'resistor', ohms: 0.5 }, R5: { kind: 'wire' } } })
    expectRel(b.I, 48, 1e-9)
    expect(b.slots.R3).toEqual({ I: 0, V: 0, P: 0 })
    expect(b.wireI[5]).toBe(0)
    expect(b.wireI[9]).toBe(0)
  })
  it('a short with small r: a bypassed 12 Ω reads 0, not 1e-5 A', () => {
    const b = solveBoard({ emf: 24, r: 0.05, slots: { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R3: { kind: 'resistor', ohms: 12 }, R5: { kind: 'wire' } } })
    expect(b.status).toBe('short')
    expect(b.slots.R3!.I).toBe(0)
  })
  it('V_P is exactly 0 across a wire branch (Example 10.1 preset)', () => {
    const b = solveBoard(PRESETS.find(p => p.id === 'ex10-1')!.input)
    expect(b.Vp).toBe(0)
  })
  it('V_P matches I·R_P when the branches are resistors', () => {
    const b = solveBoard(PRESETS.find(p => p.id === 'ex10-4')!.input)
    expectRel(b.Vp, b.I * b.Rp, 1e-6)
    expectRel(b.Vp, 9.65, SIG3)
  })
  it('on an ideal short, bypassed and empty branches are dead and read 0', () => {
    const b = solveBoard({ emf: 12, r: 0, slots: { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R3: { kind: 'resistor', ohms: 6 }, R5: { kind: 'wire' } } })
    expect(b.idealShort).toBe(true)
    expect(b.slots.R3!.I).toBe(0)
    expect(b.slots.R1!.I).toBe(Infinity)
    expect(b.deadWire[5]).toBe(1) // R3 stub
    expect(b.deadWire[7]).toBe(1) // empty R4 stub
    expect(b.deadWire[3]).toBe(0) // the wire branch carries it all
  })
  it('V_terminal on a short with r > 0 prints a clean 0 for every dial pair', () => {
    for (let e = 1; e <= 24; e += 0.5) for (let r = 0.05; r <= 2.0001; r += 0.05) {
      const b = solveBoard({ emf: e, r: Math.round(r * 100) / 100, slots: { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R5: { kind: 'wire' } } })
      expect(sig3(b.Vt)).toBe('0')
    }
  })
  it('sig3 never throws on tiny residue', () => {
    expect(sig3(2.2e-16)).toBe('0')
    expect(sig3(1e-120)).toBe('0')
  })
})

import { relaxVoltage } from '@lib/physics'
describe('RC on the board (Section 10.5)', () => {
  const cap = (farads: number) => ({ kind: 'capacitor' as const, farads })
  const res = (ohms: number) => ({ kind: 'resistor' as const, ohms })
  const series = { emf: 12, r: 0, slots: { R1: res(4), R2: res(2), R5: cap(0.5) } }

  it('series RC from empty: τ = RC with R = R₁ + R_P, I₀ = ε/R (Eq 10.9, 10.10)', () => {
    const b = solveBoard({ ...series, capV: 0 })
    expectRel(b.cap!.Rth, 6, 1e-6) // 0.1 µΩ stand-ins add about 1 µΩ
    expectRel(b.cap!.tau, 3, 1e-6)
    expectRel(b.cap!.Voc, 12, 1e-6)
    expectRel(b.cap!.Ic, 2, 1e-6)
    expectRel(b.I, 2, 1e-6)
    for (const c of b.checks) expect(c.ok, c.id).toBe(true)
  })
  it('at t = τ the current is 0.368 I₀ and the charge 0.632 Cε', () => {
    const Vc = relaxVoltage(0, 12, 3, 3)
    const b = solveBoard({ ...series, capV: Vc })
    expectRel(b.cap!.Ic, 0.368 * 2, 1e-3)
    expectRel(b.cap!.q, 0.632 * 0.5 * 12, 1e-3)
  })
  it('full: no current, and the capacitor holds the whole ε', () => {
    const b = solveBoard({ ...series, capV: 12 })
    expect(b.cap!.Ic).toBe(0)
    expect(b.I).toBe(0)
  })
  it('discharge with the battery switched out: I = −Q/RC (Eq 10.12)', () => {
    const b = solveBoard({ ...series, capV: 12, batteryIn: false })
    expect(b.batteryOut).toBe(true)
    expect(b.cap!.Voc).toBe(0)
    expectRel(b.cap!.Ic, -(0.5 * 12) / (6 * 0.5), 1e-6)
    for (const c of b.checks) expect(c.ok, c.id).toBe(true)
  })
  it('a capacitor in a branch: heads for the branch voltage, sees R₂ ∥ R₁', () => {
    const b = solveBoard({ emf: 12, r: 0, capV: 0, slots: { R1: res(2), R2: res(6), R3: cap(1), R5: { kind: 'wire' } } })
    expectRel(b.cap!.Voc, 9, 1e-6)
    expectRel(b.cap!.Rth, 1.5, 1e-6)
    expectRel(b.cap!.Ic, 6, 1e-6)
    expect(b.slots.R2!.I).toBe(0) // an empty capacitor holds 0 V, so R₂ next to it gets nothing at first
  })
  it('stepping dV/dt = I/C in tiny steps lands on the exact exponential, in any slot', () => {
    for (const slots of [series.slots, { R1: res(2), R2: res(6), R3: cap(1), R5: { kind: 'wire' as const } }, { R1: res(3), R2: cap(0.2), R3: res(12), R4: res(4), R5: res(1) }]) {
      const input = { emf: 9, r: 0.5, slots }
      const b0 = solveBoard({ ...input, capV: 0 })
      const { tau, Voc, C } = b0.cap!
      let Vc = 0
      const dt = tau / 4000
      for (let k = 0; k < 4000; k++) {
        const mid = solveBoard({ ...input, capV: Vc + 0.5 * dt * solveBoard({ ...input, capV: Vc }).cap!.Ic / C })
        Vc += dt * mid.cap!.Ic / C
      }
      expectRel(Vc, relaxVoltage(0, Voc, tau, tau), 1e-5)
    }
  })
  it('every check holds on random RC boards at random moments', () => {
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 200; n++) {
      const pick = () => (rnd() < 0.15 ? undefined : rnd() < 0.25 ? { kind: 'wire' as const } : res(OHM_STEPS[Math.floor(rnd() * OHM_STEPS.length)]!))
      const slots: Record<string, unknown> = { R1: pick(), R2: pick(), R3: pick(), R4: pick(), R5: pick() }
      slots[['R1', 'R2', 'R3', 'R4', 'R5'][Math.floor(rnd() * 5)]!] = cap(0.5)
      const b = solveBoard({ emf: 1 + Math.round(rnd() * 23), r: Math.round(rnd() * 40) / 20, slots: slots as never, capV: rnd() * 20 - 5, batteryIn: rnd() > 0.3 })
      for (const c of b.checks) expect(c.ok, `${JSON.stringify(slots)} ${c.id}`).toBe(true)
      expect(Number.isNaN(b.cap!.Ic)).toBe(false)
      expect(Math.abs(b.cap!.Ic)).toBeLessThan(1e4) // a capacitor shorted by a wire jumps, never shows 10⁷ A
    }
  })
})

import { reading } from '../../apps/02-circuits/src/format'
describe('reading', () => {
  it('switches small values to milli-units and keeps the rest', () => {
    expect(reading(0.00372, 'A')).toBe('3.72 mA')
    expect(reading(-0.00371, 'A')).toBe('−3.71 mA')
    expect(reading(0.5, 'A')).toBe('0.500 A')
    expect(reading(0, 'V')).toBe('0 V')
    expect(reading(12, 'V')).toBe('12.0 V')
  })
})

describe('RC review regressions (2026-10-11)', () => {
  const cap = (farads: number) => ({ kind: 'capacitor' as const, farads })
  const res = (ohms: number) => ({ kind: 'resistor' as const, ohms })
  const wire = { kind: 'wire' as const }
  it('battery out with only wires around: no ideal short, and a capacitor beside a wire branch empties at once', () => {
    const b = solveBoard({ emf: 12, r: 0, capV: 6, batteryIn: false, slots: { R1: wire, R2: cap(0.5), R3: wire, R5: wire } })
    expect(b.idealShort).toBe(false)
    expect(Number.isFinite(b.I)).toBe(true)
    expect(b.cap!.Vc).toBe(0)
    expect(b.cap!.snapped).toBe(true)
  })
  it('an ideal short with the capacitor beside the wire branch empties the capacitor', () => {
    const b = solveBoard({ emf: 12, r: 0, capV: 6, slots: { R1: wire, R2: cap(0.5), R3: wire, R5: wire } })
    expect(b.idealShort).toBe(true)
    expect(b.cap!.Vc).toBe(0)
    expect(b.cap!.q).toBe(0)
  })
  it('battery cut off by an empty slot: the capacitor still discharges through the branches, and the checks run', () => {
    const b = solveBoard({ emf: 12, r: 0, capV: 6, slots: { R2: cap(0.5), R3: res(3), R5: wire } })
    expect(b.status).toBe('open')
    expectRel(b.cap!.Ic, -2, 1e-6) // 6 V across R₃ = 3 Ω, flowing out of the capacitor
    expectRel(b.cap!.tau, 1.5, 1e-6)
    expect(b.checks.map(c => c.id).sort()).toEqual(['energy', 'junction', 'rc'])
    for (const c of b.checks) expect(c.ok, c.id).toBe(true)
  })
})

import { statusFor } from '../../apps/02-circuits/src/boardbar'
describe('capacitor with no loop, or shorted (audit #5)', () => {
  const cap = (farads: number) => ({ kind: 'capacitor' as const, farads })
  const res = (ohms: number) => ({ kind: 'resistor' as const, ohms })
  const wire = { kind: 'wire' as const }
  it('nothing joins the plates: the capacitor keeps its charge, R = τ = ∞', () => {
    for (const slots of [{ R1: cap(0.5), R2: res(6) }, { R5: cap(0.5), R2: res(6), R3: wire }, { R5: cap(0.5), R2: res(6) }]) {
      const b = solveBoard({ emf: 12, r: 0, capV: 4, slots })
      expect(b.cap!.Rth, JSON.stringify(slots)).toBe(Infinity)
      expect(b.cap!.tau, JSON.stringify(slots)).toBe(Infinity)
      expect(b.cap!.Vc).toBe(4)
      expect(b.cap!.Voc).toBe(4)
      expect(b.cap!.Ic).toBe(0)
      expect(statusFor(b, slots, 0, false).html).toContain('no loop to charge or discharge through')
    }
  })
  it('an ideal short through a wire branch shorts the capacitor beside it: R = 0, τ = 0', () => {
    const b = solveBoard({ emf: 12, r: 0, capV: 0, slots: { R1: wire, R2: cap(0.5), R3: wire, R5: wire } })
    expect(b.cap!.Rth).toBe(0)
    expect(b.cap!.tau).toBe(0)
  })
})

describe('status line words (audit #79, #89, #90, #138)', () => {
  const res = (ohms: number) => ({ kind: 'resistor' as const, ohms })
  const wire = { kind: 'wire' as const }
  it('an open circuit is calm; a short stays red', () => {
    const open = { R2: res(6), R5: wire }
    expect(statusFor(solveBoard({ emf: 12, r: 0, slots: open }), open, 0, false).warn).toBe(false)
    const short = { R1: wire, R2: wire, R5: wire }
    expect(statusFor(solveBoard({ emf: 12, r: 0.5, slots: short }), short, 0.5, false).warn).toBe(true)
  })
  it('names the wire that steals the current', () => {
    const s = { R1: res(2), R2: res(6), R3: wire, R5: wire }
    expect(statusFor(solveBoard({ emf: 12, r: 0, slots: s }), s, 0, false).html).toBe('The wire in R₃ carries all the current, so R₂ gets 0 A.')
    const s2 = { R1: res(2), R2: res(6), R3: wire, R4: wire, R5: wire }
    expect(statusFor(solveBoard({ emf: 12, r: 0, slots: s2 }), s2, 0, false).html).toBe('The wires in R₃ and R₄ carry all the current, so R₂ gets 0 A.')
  })
  it('a discharge with the battery out names the resistors in the loop', () => {
    const s = { R1: res(4), R2: res(2), R5: { kind: 'capacitor' as const, farads: 0.5 } }
    const b = solveBoard({ emf: 12, r: 0, capV: 12, batteryIn: false, slots: s })
    expect(statusFor(b, s, 0, false)).toEqual({ html: 'Battery out: the capacitor discharges through R₁ and R₂.', warn: false })
  })
})

describe('book example notes (audit #20)', () => {
  it('Example 10.1 explains the printed 11.90 V next to the 11.88 V its own numbers give', () => {
    const ex = PRESETS.find(p => p.id === 'ex10-1')!
    const vt = ex.book.find(v => v.label === 'V_terminal')!
    expect(vt.value).toBe('11.90 V')
    expect(vt.note).toContain('11.88 V')
    const b = solveBoard(ex.input)
    expect(b.Vt.toFixed(2)).toBe('11.88')
    expect(12 - 1.188 * 0.1).toBeCloseTo(11.8812, 4)
  })
})

describe('check marks compare a book formula with the full solve (audit #42)', () => {
  it('Example 10.4: the series and parallel checks carry the solve\'s own R_eq and R_P', () => {
    const b = solveBoard(preset('ex10-4'))
    const byId = new Map(b.checks.map(c => [c.id, c]))
    expectRel(byId.get('series')!.solved!.v, b.Req, 1e-4)
    expectRel(byId.get('parallel')!.solved!.v, b.Rp, 1e-4)
    expectRel(byId.get('junction')!.solved!.v, b.I, 1e-4)
    expectRel(byId.get('current')!.solved!.v, b.I, 1e-4)
    expect(byId.get('series')!.solved!.unit).toBe('Ω')
  })
  it('a capacitor board shows the Eq 10.10 check with the solved capacitor current', () => {
    const b = solveBoard({ emf: 12, r: 0, capV: 3, slots: { R1: { kind: 'resistor', ohms: 4 }, R2: { kind: 'wire' }, R5: { kind: 'capacitor', farads: 0.5 } } })
    const rc = b.checks.find(c => c.id === 'rc')!
    expect(rc.ok).toBe(true)
    expectRel(rc.solved!.v, (12 - 3) / 4, 1e-6)
  })
})
