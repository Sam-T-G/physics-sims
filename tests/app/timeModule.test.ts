import { describe, it, expect } from 'vitest'
import { solveBoard, type Slots } from '../../apps/02-circuits/src/board'
import { curveKind, isFlat, plotWindow, playWord, batteryCutOff, axisScale, labelSide, noteFor, type NoteState } from '../../apps/02-circuits/src/timeModule'

const R = (ohms: number) => ({ kind: 'resistor' as const, ohms })
const W = { kind: 'wire' as const }
const CAP = (farads = 0.5) => ({ kind: 'capacitor' as const, farads })
/** The clock fields the module reads, as the app sets them when a curve starts (anchor). */
const clockOf = (slots: Slots, capV: number, batteryIn = true) => {
  const k = solveBoard({ emf: 12, r: 0, slots, capV, batteryIn }).cap!
  return { tau: k.tau, V0: k.Vc, Voc: k.Voc, I0: k.Ic, batteryIn }
}
const note = (s: Partial<NoteState>) => noteFor({ kind: 'live', locked: false, loop: true, hold: 0, settled: false, cutOff: false, ...s })

describe('time module: kinds of curve', () => {
  it('a charging capacitor is a live curve', () => {
    expect(curveKind(clockOf({ R1: R(2), R3: CAP(), R5: W }, 0))).toBe('live')
  })
  it('a full capacitor, a hair from its end voltage, is flat (the old 1e-9 test drew a 63% line here)', () => {
    expect(isFlat(12, 11.99999999)).toBe(true)
    expect(isFlat(0, 0)).toBe(true)
    expect(isFlat(7.08, 9.6)).toBe(false)
    expect(curveKind({ tau: 2, V0: 12, Voc: 11.99999999 })).toBe('flat')
  })
  it('a plain wire across the capacitor is instant; no path at all is none', () => {
    expect(curveKind(clockOf({ R1: R(2), R2: R(6), R3: CAP(), R4: W, R5: W }, 9))).toBe('instant')
    expect(curveKind({ tau: 0, V0: 0, Voc: 12 })).toBe('instant')
    expect(curveKind({ tau: Infinity, V0: 3, Voc: 3 })).toBe('none')
  })
})

describe('time module: the plot window matches the clock', () => {
  it('5τ with Loop on (the loop starts over there), 6τ with Loop off', () => {
    expect(plotWindow(2, true, 'live')).toBe(10)
    expect(plotWindow(2, false, 'live')).toBe(12)
    // a flat curve does not loop, so its clock runs to 6τ
    expect(plotWindow(2, true, 'flat')).toBe(12)
  })
})

describe('time module: battery switch state', () => {
  it('battery in, but a gap cuts it off: the capacitor drains, so the switch shows neither side', () => {
    // capacitor in R₃ charged to 7.29 V, R₁ taken away: it empties through R₂
    const c = clockOf({ R2: R(6), R3: CAP(), R5: W }, 7.29)
    expect(curveKind(c)).toBe('live')
    expect(c.Voc).toBeCloseTo(0, 9)
    expect(batteryCutOff(c)).toBe(true)
  })
  it('a normal charge, a battery-out discharge and an already empty cut-off capacitor are not "cut off"', () => {
    expect(batteryCutOff(clockOf({ R1: R(2), R3: CAP(), R5: W }, 0))).toBe(false)
    expect(batteryCutOff(clockOf({ R1: R(4), R2: W, R5: CAP() }, 12, false))).toBe(false)
    expect(batteryCutOff(clockOf({ R2: R(6), R3: CAP(), R5: W }, 0))).toBe(false)
  })
})

describe('time module: axis units follow the readout', () => {
  it('a 10 mA peak reads in mA, a 1.5 A peak in A, a flat 0 in the base unit', () => {
    expect(axisScale([0.01, 0], 'A')).toEqual({ k: 1000, unit: 'mA' })
    expect(axisScale([1.5, 0], 'A')).toEqual({ k: 1, unit: 'A' })
    expect(axisScale([-0.05, 0], 'A')).toEqual({ k: 1000, unit: 'mA' })
    expect(axisScale([], 'V')).toEqual({ k: 1, unit: 'V' })
  })
})

describe('time module: guide line label', () => {
  it('stays above its line unless the curve ends just above it', () => {
    expect(labelSide(50, [90, 95, 100])).toBe('above')
    expect(labelSide(50, [42, 41, 40])).toBe('below')
    expect(labelSide(50, [20, 18])).toBe('above')
  })
})

describe('time module: the note under the time', () => {
  it('says what the curve is doing, with no stray em dashes', () => {
    expect(note({ settled: true })).toBe('After 5τ, more than 99% of the change is complete.')
    expect(note({ settled: true, hold: 0.2 })).toMatch(/Replaying from <i>t<\/i> = 0\.$/)
    expect(note({ kind: 'flat' })).toBe('The capacitor is already at the final voltage, so nothing changes.')
    expect(note({ kind: 'instant' })).toBe('Only wire is in the capacitor\'s path, so the capacitor charges or discharges instantly.')
    expect(note({ cutOff: true })).toBe('The battery is cut off, so the capacitor is discharging through the resistors.')
    expect(note({ locked: true })).toBe('Paused at <i>t</i> = 0 until you predict.')
    expect(note({})).toBe('')
    for (const kind of ['live', 'flat', 'instant', 'none'] as const) expect(note({ kind, settled: true })).not.toMatch(/—/)
  })
})

describe('time module: the Play button on a curve with nothing to play', () => {
  it('a flat curve whose clock still runs shows Play (disabled), never Pause', () => {
    expect(playWord(true, 'live')).toBe('Pause')
    expect(playWord(false, 'live')).toBe('Play')
    for (const kind of ['flat', 'instant', 'none'] as const) expect(playWord(true, kind)).toBe('Play')
  })
  it('a 5e-5 V gap at 12 V is flat for the module, so it neither loops nor plays (the app uses the same isFlat)', () => {
    const c = { tau: 2, V0: 12 - 5e-5, Voc: 12 }
    expect(curveKind(c)).toBe('flat')
    expect(plotWindow(c.tau, true, curveKind(c))).toBe(12)
  })
})

describe('the new-curve note (audit #116)', () => {
  const base = { kind: 'live' as const, locked: false, loop: true, hold: 0, settled: false, cutOff: false }
  it('says why t went back to 0 after a mid-curve change, and gives the starting V_C', () => {
    expect(noteFor({ ...base, restart: 7.0812 })).toBe('The circuit changed, so the clock restarts from <i>V</i><sub>C</sub> = 7.08 V.')
  })
  it('stays quiet without a restart, and a prediction lock wins', () => {
    expect(noteFor({ ...base, restart: null })).toBe('')
    expect(noteFor({ ...base, locked: true, restart: 3 })).toBe('Paused at <i>t</i> = 0 until you predict.')
  })
})
