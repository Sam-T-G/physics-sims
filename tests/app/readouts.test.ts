import { describe, it, expect } from 'vitest'
import { solveBoard, type BoardInput, type Part, type Slots } from '../../apps/02-circuits/src/board'
import { STEPS, type Action } from '../../apps/02-circuits/src/tour'
import { capResistance, rcCase, sharedDecimals, fixed, loopDecimals } from '../../apps/02-circuits/src/panel'
import { specsFor, capStatus } from '../../apps/02-circuits/src/hud'
import { reading, sig3 } from '../../apps/02-circuits/src/format'

const R = (ohms: number): Part => ({ kind: 'resistor', ohms })
const W: Part = { kind: 'wire' }
const CAP = (farads = 0.5): Part => ({ kind: 'capacitor', farads })

/** A step's board after its task's auto actions (the same moves "Do it for me" makes). */
function boardsOf(): { name: string; input: BoardInput }[] {
  const out: { name: string; input: BoardInput }[] = []
  for (const s of STEPS) {
    if (!s.setup) continue
    const input: BoardInput = { emf: s.setup.emf, r: s.setup.r, slots: { ...s.setup.slots }, batteryIn: s.setup.batteryIn ?? true, capV: s.setup.capV ?? 0 }
    out.push({ name: `${s.id} (setup)`, input: { ...input, slots: { ...input.slots } } })
    const acts: readonly Action[] = s.task?.auto ?? []
    for (const a of acts) {
      if ('place' in a) input.slots[a.place] = { ...a.part }
      else if ('remove' in a) delete input.slots[a.remove]
      else if ('dial' in a) { const p = input.slots[a.dial]; if (p?.kind === 'resistor') p.ohms = a.value; else if (p?.kind === 'capacitor') p.farads = a.value }
      else if ('r' in a) input.r = a.r
      else if ('battery' in a) input.batteryIn = a.battery
    }
    if (acts.length) out.push({ name: `${s.id} (after the task)`, input })
  }
  return out.filter(b => Object.values(b.input.slots).some(p => p?.kind === 'capacitor'))
}

const extra: { name: string; input: BoardInput }[] = [
  { name: 'series, r > 0', input: { emf: 12, r: 0.5, slots: { R1: R(4), R2: R(6), R3: R(3), R5: CAP() } } },
  { name: 'series, battery out with r set', input: { emf: 12, r: 0.5, batteryIn: false, capV: 12, slots: { R1: R(4), R2: R(6), R5: CAP() } } },
  { name: 'branch, r > 0', input: { emf: 12, r: 0.5, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W } } },
  { name: 'branch, two other branches', input: { emf: 12, r: 0.2, slots: { R1: R(2), R2: R(6), R3: CAP(), R4: R(3), R5: R(1) } } },
  { name: 'branch, battery out', input: { emf: 12, r: 0.5, batteryIn: false, capV: 9, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: R(1) } } },
  { name: 'cut off, two branches left', input: { emf: 12, r: 0, capV: 9, slots: { R2: R(6), R3: CAP(), R4: R(3), R5: W } } },
  { name: 'no loop', input: { emf: 12, r: 0, capV: 3, slots: { R1: R(2), R5: CAP() } } },
]

describe('the R in τ = RC, built from the slots', () => {
  const boards = [...boardsOf(), ...extra]
  it('covers the tour capacitor boards', () => {
    expect(boards.length).toBeGreaterThan(extra.length + 8)
  })
  for (const { name, input } of boards) {
    it(`equals the solver's R on ${name}`, () => {
      const b = solveBoard(input)
      const k = b.cap!
      const got = capResistance(input.slots, k.id, b.r, b.batteryOut)
      if (!Number.isFinite(k.Rth)) expect(got.value).toBe(Infinity)
      else expect(Math.abs(got.value - k.Rth)).toBeLessThan(1e-5 * Math.max(1, k.Rth))
    })
  }
  it('names only the parts in the path, and r only when the battery is in it', () => {
    expect(capResistance({ R1: R(4), R2: R(6), R5: CAP() }, 'R5', 0.5, false)).toMatchObject({ kind: 'series', tex: 'R_{1} + R_{\\text{P}} + r' })
    expect(capResistance({ R1: R(4), R2: R(6), R5: CAP() }, 'R5', 0, true)).toMatchObject({ kind: 'out', tex: 'R_{1} + R_{\\text{P}}' })
    expect(capResistance({ R1: R(2), R2: R(6), R3: CAP(), R5: W }, 'R3', 0, false)).toMatchObject({ kind: 'branch', tex: '\\left(\\frac{1}{R_{2}} + \\frac{1}{R_{1}}\\right)^{-1}', value: 1.5 })
    expect(capResistance({ R2: R(6), R3: CAP(), R5: W }, 'R3', 0.5, false)).toMatchObject({ kind: 'cutoff', tex: 'R_{2}', value: 6 })
  })
})

describe('sums that add up as printed', () => {
  const loop = (n: number[]) => n[0]! - n[1]! - n[2]!
  const power = (n: number[]) => n[0]! - n[1]! - n[2]!
  it('Example 10.1: 12.00 − 0.12 − 11.88 = 0 and 14.26 = 0.14 + 14.12', () => {
    const b = solveBoard({ emf: 12, r: 0.1, slots: { R1: R(10), R2: W, R5: W } })
    const d = sharedDecimals([b.emf, b.I * b.r, b.slots.R1!.V], loop)
    expect([b.emf, b.I * b.r, b.slots.R1!.V].map(v => fixed(v, d))).toEqual(['12.00', '0.12', '11.88'])
    const e = sharedDecimals([b.Pemf, b.Pr, b.slots.R1!.P], power)
    expect([b.Pemf, b.Pr, b.slots.R1!.P].map(v => fixed(v, e))).toEqual(['14.26', '0.14', '14.12'])
  })
  it('Example 10.1: the terminal row prints V_terminal with the loop row\'s decimals (11.88 in both)', () => {
    const b = solveBoard({ emf: 12, r: 0.1, slots: { R1: R(10), R2: W, R5: W } })
    const d = loopDecimals(b)
    expect([b.emf, b.Vt].map(v => fixed(v, d))).toEqual(['12.00', '11.88'])
  })
  it('keeps 3 figures when they already add up', () => {
    expect(sharedDecimals([12, 6, 6], loop)).toBe(1)
  })
  it('prints a real minus, never −0.00, and an exact 0 as 0', () => {
    expect(fixed(-0.25, 2)).toBe('−0.25')
    expect(fixed(-0.001, 2)).toBe('0.00')
    expect(fixed(0, 2)).toBe('0')
  })
})

describe('which capacitor curve', () => {
  const b = solveBoard({ emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W } })
  it('splits an empty start that fills to less than ε from a part-charged start', () => {
    expect(rcCase({ b, rc: { V0: 0, Voc: 12 } })).toBe('charge')
    expect(rcCase({ b, rc: { V0: 0, Voc: 9 } })).toBe('fill')
    expect(rcCase({ b, rc: { V0: 1.87, Voc: 9 } })).toBe('between')
    expect(rcCase({ b, rc: { V0: 9, Voc: 0 } })).toBe('discharge')
    expect(rcCase({ b, rc: { V0: 9, Voc: 9 } })).toBe('settled')
  })
})

describe('HUD with a capacitor on the board', () => {
  const slots: Slots = { R1: R(2), R2: R(6), R3: CAP(), R5: W }
  it('is titled for the capacitor and names its current', () => {
    const b = solveBoard({ emf: 12, r: 0, slots, capV: 0 })
    const s = specsFor(b, slots, null)
    expect(s.title).toBe('Capacitor circuit')
    expect(s.status).toBe('charging')
    expect(s.tiles[0]).toMatchObject({ name: 'Current', sym: 'I_C', note: 'into the capacitor', label: 'Capacitor current' })
  })
  it('says what the capacitor is doing', () => {
    expect(capStatus(solveBoard({ emf: 12, r: 0, slots, capV: 9 }))).toBe('full')
    expect(capStatus(solveBoard({ emf: 12, r: 0, slots, capV: 11 }))).toBe('emptying')
    expect(capStatus(solveBoard({ emf: 12, r: 0, slots, capV: 9, batteryIn: false }))).toBe('battery out')
    expect(capStatus(solveBoard({ emf: 12, r: 0, slots: { R2: R(6), R3: CAP(), R5: W }, capV: 9 }))).toBe('battery cut off')
    expect(capStatus(solveBoard({ emf: 12, r: 0, slots: { R2: R(6), R3: CAP(), R5: W }, capV: 0 }))).toBe('empty')
  })
  it('keeps the whole-circuit tiles honest about r and Iε', () => {
    const plain: Slots = { R1: R(10), R2: W, R5: W }
    const s = specsFor(solveBoard({ emf: 12, r: 0.1, slots: plain }), plain, null)
    expect(s.title).toBe('Whole circuit')
    expect(s.tiles[2]!.note).toBe('not counting r')
    expect(s.tiles[3]!.note).toBe('made by the battery')
    expect(s.tiles[3]!.label).toContain('Iε')
    // the voltage tile is the terminal voltage, not ε (audit #44)
    expect(s.tiles[1]).toMatchObject({ name: 'Voltage', sym: 'V_terminal', label: "Terminal voltage, across the battery's ends" })
  })
  it('an ideal short shows no value for the current, voltage and power (audit #114)', () => {
    const wires: Slots = { R1: W, R2: W, R5: W }
    const s = specsFor(solveBoard({ emf: 12, r: 0, slots: wires }), wires, null)
    for (const k of [0, 1, 3]) expect(Number.isNaN(s.tiles[k]!.value), s.tiles[k]!.name).toBe(true)
  })
})

describe('big readings', () => {
  it('switch to kilo-units so they keep 3 figures', () => {
    expect(reading(11520, 'W')).toBe('11.5 kW')
    expect(reading(1152, 'W')).toBe('1.15 kW')
    expect(reading(999.6, 'W')).toBe('1.00 kW')
    expect(reading(999.4, 'W')).toBe('999 W')
    expect(reading(1500, 'Ω')).toBe(`${sig3(1500)} Ω`)
    expect(reading(0.00372, 'A')).toBe('3.72 mA')
  })
})
