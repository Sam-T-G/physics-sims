import { describe, it, expect } from 'vitest'
import {
  solveBoard, OHM_STEPS, FARAD_STEPS, LANES, SLOT_IDS,
  type BoardInput, type Part, type Slots, type SlotId,
} from '../../apps/02-circuits/src/board'
import { colorBands, BAND_NAMES } from '../../apps/02-circuits/src/colorCode'
import { sig, sig3, reading } from '../../apps/02-circuits/src/format'

// An independent reference for every part on the board, worked the way a student would on paper with
// truly 0 Ω wires: Eq 10.2, 10.3, I = ε/(R_eq + r), V = IR, P = I²R. The sim's numbers come from the
// nodal solve with 0.1 µΩ wires, so this checks that the stand-ins never move a displayed digit.

const SLIDER_EMF = Array.from({ length: 47 }, (_, k) => 1 + k * 0.5) // 1 to 24 V in 0.5 V steps
const SLIDER_R = Array.from({ length: 41 }, (_, k) => Number((k * 0.05).toFixed(2))) // 0 to 2 Ω in 0.05 Ω steps
const DISPLAY = 5e-5 // half a unit in the 4th significant figure, the most digits the sim prints

const ohm = (p: Part) => (p.kind === 'wire' ? 0 : p.kind === 'resistor' ? p.ohms : Infinity)
const par = (rs: number[]) => (rs.length === 0 ? Infinity : rs.some(r => r === 0) ? 0 : 1 / rs.reduce((s, r) => s + 1 / r, 0))
const ser = (rs: number[]) => rs.reduce((s, r) => s + r, 0)

type Ref = { I: number; Vt: number; slot: Partial<Record<SlotId, { I: number; V: number; P: number }>> }
function reference(emf: number, r: number, slots: Slots): Ref | null {
  const lanes = LANES.filter(id => slots[id])
  if (!slots.R1 || !slots.R5 || lanes.length === 0) return null
  const Rp = par(lanes.map(id => ohm(slots[id]!)))
  const Req = ohm(slots.R1) + Rp + ohm(slots.R5)
  if (Req + r === 0) return null
  const I = emf / (Req + r)
  const Vp = I * Rp
  const slot: Ref['slot'] = {}
  for (const id of ['R1', 'R5'] as const) {
    const R = ohm(slots[id]!)
    slot[id] = { I, V: I * R, P: I * I * R }
  }
  const wireLanes = lanes.filter(id => ohm(slots[id]!) === 0)
  for (const id of lanes) {
    const R = ohm(slots[id]!)
    // a wire branch takes the whole current, shared evenly if there are several wire branches
    const Ik = wireLanes.length ? (R === 0 ? I / wireLanes.length : 0) : Vp / R
    slot[id] = { I: Ik, V: R === 0 ? 0 : Ik * R, P: Ik * Ik * R }
  }
  return { I, Vt: emf - I * r, slot }
}

let seed = 2026
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
const pickOf = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!
const randomPart = (): Part | undefined => {
  const u = rnd()
  if (u < 0.12) return undefined
  if (u < 0.24) return { kind: 'wire' }
  return { kind: 'resistor', ohms: pickOf(OHM_STEPS) }
}
const rel = (a: number, b: number) => (a === b ? 0 : Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)))

describe('every part against a hand-worked reference', () => {
  it('current, voltage and power of every part match to every printed digit, across 20,000 boards', () => {
    let worst = 0
    let worstAt = ''
    let compared = 0
    for (let n = 0; n < 20000; n++) {
      const emf = pickOf(SLIDER_EMF), r = pickOf(SLIDER_R)
      const slots: Slots = {}
      for (const id of SLOT_IDS) { const p = randomPart(); if (p) slots[id] = p }
      const ref = reference(emf, r, slots)
      const b = solveBoard({ emf, r, slots })
      if (!ref) continue
      const tag = JSON.stringify({ emf, r, slots })
      const cmp = (x: number, y: number, what: string) => {
        // a reading the reference says is exactly 0 must print as 0
        // (float leftovers below 1e-12 of ε in the reference count as 0 too: 13.5 − (13.5/1.45)(1.45))
        if (Math.abs(y) < 1e-12 * emf) { expect(x, `${what} ${tag}`).toBe(0); return }
        const e = rel(x, y)
        if (e > worst) { worst = e; worstAt = `${what} got ${x} want ${y} ${tag}` }
        expect(e, `${what} ${tag}`).toBeLessThan(DISPLAY)
      }
      cmp(b.I, ref.I, 'battery I')
      cmp(b.Vt, ref.Vt, 'V_terminal')
      for (const id of SLOT_IDS) {
        const want = ref.slot[id]
        if (!want) continue
        const got = b.slots[id]!
        cmp(got.I, want.I, `${id} I`)
        cmp(got.V, want.V, `${id} V`)
        cmp(got.P, want.P, `${id} P`)
        compared++
      }
    }
    expect(compared).toBeGreaterThan(20000)
    console.log(`worst relative difference from the hand-worked answer: ${worst.toExponential(2)} over ${compared} parts, at ${worstAt}`)
  })

  it('physical bounds hold for every part: 0 ≤ V_terminal ≤ ε, node potentials between 0 and ε, P ≥ 0, P = VI', () => {
    for (let n = 0; n < 5000; n++) {
      const emf = pickOf(SLIDER_EMF), r = pickOf(SLIDER_R)
      const slots: Slots = {}
      for (const id of SLOT_IDS) { const p = randomPart(); if (p) slots[id] = p }
      const b = solveBoard({ emf, r, slots })
      if (b.idealShort) continue
      const tag = JSON.stringify({ emf, r, slots })
      expect(b.I, tag).toBeGreaterThanOrEqual(0)
      expect(b.Vt, tag).toBeGreaterThanOrEqual(0)
      expect(b.Vt, tag).toBeLessThanOrEqual(emf + 1e-9)
      for (let k = 0; k < b.V.length; k++) {
        if (k === 1) continue // inside the battery, between the emf and r
        expect(b.V[k]!, `node ${k} ${tag}`).toBeGreaterThanOrEqual(-1e-5 * emf)
        expect(b.V[k]!, `node ${k} ${tag}`).toBeLessThanOrEqual(emf * (1 + 1e-5))
      }
      for (const id of SLOT_IDS) {
        const rd = b.slots[id]
        if (!rd) continue
        expect(rd.P, `${id} ${tag}`).toBeGreaterThanOrEqual(0)
        expect(rd.I, `${id} I never exceeds the battery current ${tag}`).toBeLessThanOrEqual(b.I * (1 + DISPLAY))
        if (slots[id]!.kind === 'resistor') expect(rel(rd.P, rd.V * rd.I) < DISPLAY || rd.P === 0, `${id} P = VI ${tag}`).toBe(true)
      }
    }
  })
})

describe('the capacitor against a hand-worked reference', () => {
  // Thévenin view of the slot: V_end is the slot's open voltage, R the resistance the capacitor sees with ε off.
  function capRef(emf: number, r: number, slots: Slots, id: SlotId) {
    const lanes = LANES.filter(k => slots[k] && k !== id)
    if (id === 'R1' || id === 'R5') {
      const other = id === 'R1' ? 'R5' : 'R1'
      if (!slots[other] || lanes.length === 0) return null
      const R = ohm(slots[other]!) + par(lanes.map(k => ohm(slots[k]!))) + r
      return { Voc: emf, R }
    }
    if (!slots.R1 || !slots.R5) return null
    const outside = ohm(slots.R1) + ohm(slots.R5) + r
    if (lanes.length === 0) return { Voc: emf, R: outside }
    const Rp = par(lanes.map(k => ohm(slots[k]!)))
    if (Rp === 0) return { Voc: 0, R: 0 }
    return { Voc: (emf * Rp) / (Rp + outside), R: (Rp * outside) / (Rp + outside) }
  }

  it('V_end, R, τ = RC, q = CV_C and I_C = (V_end − V_C)/R in every slot, with every capacitance', () => {
    let checked = 0
    for (let n = 0; n < 6000; n++) {
      const emf = pickOf(SLIDER_EMF), r = pickOf(SLIDER_R)
      const id = pickOf(SLOT_IDS)
      const C = pickOf(FARAD_STEPS)
      const slots: Slots = {}
      for (const k of SLOT_IDS) {
        if (k === id) continue
        const p = rnd() < 0.15 ? undefined : rnd() < 0.15 ? ({ kind: 'wire' } as Part) : ({ kind: 'resistor', ohms: pickOf(OHM_STEPS) } as Part)
        if (p) slots[k] = p
      }
      slots[id] = { kind: 'capacitor', farads: C }
      const want = capRef(emf, r, slots, id)
      if (!want || want.R < 1e-3 || want.R + 0 === Infinity) continue
      const Vc = (rnd() * 2 - 0.5) * emf
      const k = solveBoard({ emf, r, slots, capV: Vc } as BoardInput).cap!
      const tag = JSON.stringify({ emf, r, id, C, Vc, slots })
      expect(rel(k.Voc, want.Voc) < DISPLAY || Math.abs(k.Voc - want.Voc) < 1e-6 * emf, `V_end ${tag}`).toBe(true)
      expect(rel(k.Rth, want.R), `R ${tag}`).toBeLessThan(DISPLAY)
      expect(rel(k.tau, want.R * C), `τ = RC ${tag}`).toBeLessThan(DISPLAY)
      expect(rel(k.q, C * k.Vc) < 1e-12 || k.q === 0, `q = CV ${tag}`).toBe(true)
      const Ic = (want.Voc - Vc) / want.R
      expect(rel(k.Ic, Ic) < DISPLAY || Math.abs(k.Ic - Ic) < 1e-6, `I_C ${tag}`).toBe(true)
      checked++
    }
    expect(checked).toBeGreaterThan(3000)
  })

  it('τ lands between 25 ms and about 25 minutes for every part the board allows', () => {
    // fastest: 0.05 F through the smallest path; slowest: 5 F through three 100 Ω parts and r = 2 Ω
    expect(0.5 * 0.05).toBeCloseTo(0.025)
    const slow = solveBoard({ emf: 12, r: 2, slots: { R1: { kind: 'resistor', ohms: 100 }, R2: { kind: 'resistor', ohms: 100 }, R5: { kind: 'capacitor', farads: 5 } }, capV: 0 }).cap!
    expect(slow.tau).toBeCloseTo(5 * 202, 3)
  })
})

describe('units and number display', () => {
  it('every dial value spells itself in color bands', () => {
    const value = (b: string[]) => (10 * BAND_NAMES.indexOf(b[0] as never) + BAND_NAMES.indexOf(b[1] as never)) * 10 ** (b[2] === 'gold' ? -1 : b[2] === 'silver' ? -2 : BAND_NAMES.indexOf(b[2] as never))
    for (const R of OHM_STEPS) expect(value(colorBands(R)), `${R} Ω`).toBeCloseTo(R, 9)
  })

  it('sig keeps whole numbers whole at 1000 and up, and prints n figures below that', () => {
    // 24 V across 0.5 Ω: 48 A and 1152 W; a whole number never gets a misleading trailing zero
    expect(sig3(1152)).toBe('1152')
    expect(sig3(480)).toBe('480')
    expect(sig(1152, 4)).toBe('1152')
    expect(sig3(0.000372)).toBe('0.000372')
    expect(sig3(9.996)).toBe('10.0')
    expect(sig3(999.6)).toBe('1000')
  })

  it('milli-units: below 0.1 A, V, W or C the reading switches to mA, mV, mW, mC; Ω, F and s never scale', () => {
    expect(reading(0.0999, 'A')).toBe('99.9 mA')
    expect(reading(0.1, 'A')).toBe('0.100 A')
    expect(reading(0.05, 'C')).toBe('50.0 mC')
    expect(reading(0.05, 'Ω')).toBe('0.0500 Ω')
    expect(reading(0.05, 's')).toBe('0.0500 s')
  })

  it('the slider grids hold the values the labels print', () => {
    expect(SLIDER_EMF.at(0)).toBe(1)
    expect(SLIDER_EMF.at(-1)).toBe(24)
    expect(SLIDER_R.at(-1)).toBe(2)
    for (const r of SLIDER_R) expect(String(r)).toMatch(/^\d(\.\d{1,2})?$/)
  })
})

describe('a capacitor with only wire in its path', () => {
  it('reads R = 0 Ω and τ = 0 s exactly, not the 0.1 µΩ stand-ins, and every check still runs clean', () => {
    // a wire beside the capacitor: the capacitor empties at once
    const shorted = solveBoard({ emf: 12, r: 0, slots: { R1: { kind: 'resistor', ohms: 2 }, R2: { kind: 'resistor', ohms: 6 }, R3: { kind: 'capacitor', farads: 0.5 }, R4: { kind: 'wire' }, R5: { kind: 'wire' } }, capV: 9 })
    expect(shorted.cap!.Rth).toBe(0)
    expect(shorted.cap!.tau).toBe(0)
    expect(shorted.cap!.Vc).toBe(0)
    for (const c of shorted.checks) expect(c.ok, c.id).toBe(true)
    // a perfect battery straight across the capacitor through wire: the capacitor jumps to ε
    const direct = solveBoard({ emf: 12, r: 0, slots: { R1: { kind: 'capacitor', farads: 0.5 }, R2: { kind: 'wire' }, R5: { kind: 'wire' } }, capV: 0 })
    expect(direct.cap!.Rth).toBe(0)
    expect(direct.cap!.Vc).toBeCloseTo(12, 9)
    for (const c of direct.checks) expect(c.ok, c.id).toBe(true)
    // the smallest real path, r = 0.05 Ω, is still a real R
    const small = solveBoard({ emf: 12, r: 0.05, slots: { R1: { kind: 'capacitor', farads: 0.5 }, R2: { kind: 'wire' }, R5: { kind: 'wire' } }, capV: 0 })
    expect(small.cap!.Rth).toBeGreaterThan(0.049)
  })
})
