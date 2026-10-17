import { describe, it, expect } from 'vitest'
import { solveBoard } from '../../apps/02-circuits/src/board'
import { STEPS, type GuideState } from '../../apps/02-circuits/src/tour'
import { resolveFreeze, maskFor, viewsOf, covers, lookTargets, gateFor, clockRuns, liftLine, type Resolved } from '../../apps/02-circuits/src/freeze'
import { resolveTargets } from '../../apps/02-circuits/src/cues'
import { reading } from '../../apps/02-circuits/src/format'

const res = (id: string): Resolved => {
  const st = STEPS.find(s => s.id === id)!
  const r = resolveFreeze(st)
  if (!r) throw new Error(`${id} does not freeze`)
  return r
}
const state = (slots: GuideState['slots'], capV = 0): GuideState => {
  const b = solveBoard({ emf: 12, r: 0, slots, capV })
  return { emf: 12, r: 0, slots, batteryIn: true, b, selected: null, rc: null }
}

describe('prediction freeze', () => {
  it('every step with a prediction freezes (D1), and no other step does', () => {
    const predicting = STEPS.filter(s => s.predict)
    expect(predicting.length).toBe(21)
    for (const st of STEPS) {
      const r = resolveFreeze(st)
      if (!st.predict) { expect(r, st.id).toBeNull(); continue }
      expect(r, st.id).not.toBeNull()
      // a frozen step takes no input and holds the clock while predicting
      const m = maskFor(r, 'predict')
      expect(m.locked, st.id).toBe(true)
      expect(m.chip, st.id).toBe('paused for your prediction')
      expect(m.status, st.id).toBe(true)
      expect(gateFor(r, 'predict', 'free'), st.id).toEqual({ gate: 'held', beat: false, play: false })
      expect(clockRuns('held', true), st.id).toBe(false)
      // after the pick the board takes input again
      expect(maskFor(r, 'act').locked, st.id).toBe(false)
      expect(maskFor(r, 'done').locked, st.id).toBe(false)
    }
  })

  it('a readout with no ask is tagged "before" (D2), and the asks name the quantity the step is about', () => {
    expect(res('add-resistor').ask).toEqual([{ q: 'I', show: 'before' }])
    expect(res('cap-slower').ask).toEqual([{ q: 'tau', show: 'before' }])
    expect(res('turn-up').ask).toEqual([{ q: 'V', at: 'R1', show: 'before' }])
    expect(res('turn-up').focus).toBe('R1')
    // declared empty: nothing is tagged (the t = 0 values are fair, or the body already says them)
    expect(res('cap-branch').ask).toEqual([])
    expect(res('cap-shorted').ask).toEqual([])
    // the tag lands on the HUD tile while predicting, and on nothing once the answer is out
    expect(maskFor(res('add-resistor'), 'predict').get(['I'], 'hud')).toBe('before')
    expect(maskFor(res('add-resistor'), 'done').get(['I'], 'hud')).toBeNull()
    expect(maskFor(res('parallel-split'), 'predict').get(['I@R3'], 'hud')).toBe('before')
  })

  it('only the two fill steps (19, 22) cover the curve ahead of the playhead (D3)', () => {
    const fill = STEPS.filter(s => resolveFreeze(s)?.fill).map(s => s.id)
    expect(fill).toEqual(['cap-fill', 'cap-branch'])
    expect(STEPS.indexOf(STEPS.find(s => s.id === 'cap-fill')!)).toBe(19)
    expect(STEPS.indexOf(STEPS.find(s => s.id === 'cap-branch')!)).toBe(22)
    for (const id of fill) {
      expect(maskFor(res(id), 'predict').fog).toBe('predict')
      expect(maskFor(res(id), 'act').fog).toBe('act')
      expect(maskFor(res(id), 'done').fog).toBeNull()
    }
    expect(maskFor(res('cap-slower'), 'predict').fog).toBeNull()
  })

  it('a fill step starts its clock only after the pick, a beat later; "right then" steps wait at t = 0 for Play', () => {
    for (const id of ['cap-fill', 'cap-branch']) {
      const g = gateFor(res(id), 'act', 'held')
      expect(g.gate, id).toBe('held')
      expect(g.beat, id).toBe(true)
      expect(clockRuns(g.gate, true), id).toBe(false)
    }
    for (const id of ['cap-in', 'cap-dial']) {
      const r = res(id)
      expect(r.after, id).toBe(true)
      const act = gateFor(r, 'act', 'held')
      expect(act.gate, id).toBe('after')
      const done = gateFor(r, 'done', act.gate)
      expect(done.gate, id).toBe('after')
      expect(clockRuns(done.gate, true), id).toBe(false)
      expect(maskFor(r, 'done', true).chip, id).toBe('paused right after the change')
      expect(maskFor(r, 'done', false).chip, id).toBeNull()
    }
    // a change step: the change itself starts the new curve; a step with no task runs again once the answer is out
    expect(gateFor(res('cap-slower'), 'act', 'held')).toEqual({ gate: 'free', beat: false, play: null })
    expect(gateFor(res('cap-branch-v'), 'done', 'held')).toEqual({ gate: 'free', beat: false, play: true })
    // leaving the tour lifts the hold and plays
    expect(gateFor(null, null, 'held')).toEqual({ gate: 'free', beat: false, play: true })
  })

  it('cues stay off the task\'s chips, r, 5× and Discharge while the student reads and predicts (D4)', () => {
    let seen = 0
    for (const st of STEPS) {
      if (!st.task) continue
      const s = state(st.setup?.slots ?? {}, st.setup?.capV ?? 0)
      const t = lookTargets(resolveTargets(st.spot ?? null, st.task.auto, { ...s, speed: 1 }))
      expect(t.doChips, st.id).toEqual([])
      expect(t.control, st.id).toBeNull()
      expect(t.dial, st.id).toBeNull()
      seen++
    }
    expect(seen).toBeGreaterThan(15)
    // the controls the rule is about are all there before the rule strips them
    const ctl = new Set(STEPS.filter(s => s.task).map(st => resolveTargets(st.spot ?? null, st.task!.auto, { ...state(st.setup?.slots ?? {}), speed: 1 }).control))
    for (const c of ['r', 'speed-5', 'bat-out']) expect(ctl.has(c as never), c).toBe(true)
  })

  it('viewsOf reaches every place a quantity shows: HUD, labels, the plot\'s live value and its curve', () => {
    expect(viewsOf({ q: 'Vc' })).toEqual(expect.arrayContaining(['hud', 'label', 'plot-V', 'curve-V', 'eq']))
    expect(viewsOf({ q: 'V', at: 'all' })).toEqual(expect.arrayContaining(['hud', 'label', 'plot-V', 'curve-V', 'eq']))
    expect(viewsOf({ q: 'Ic' })).toEqual(expect.arrayContaining(['hud', 'label', 'plot-I', 'curve-I']))
    expect(viewsOf({ q: 'I', at: 'R5' })).toEqual(expect.arrayContaining(['hud', 'label', 'eq']))
    expect(viewsOf({ q: 'I', at: 'R5' })).not.toContain('plot-I')
    expect(viewsOf({ q: 'P' })).toEqual(['hud', 'eq'])
    // matching keys: a slot, every value of a kind, or the whole circuit
    expect(covers({ q: 'V', at: 'all' }, 'V@R2')).toBe(true)
    expect(covers({ q: 'V', at: 'all' }, 'Vc')).toBe(true)
    expect(covers({ q: 'V', at: 'all' }, 'I@R2')).toBe(false)
    expect(covers({ q: 'V', at: 'all' }, 'set@R2')).toBe(false)
    expect(covers({ q: 'I', at: 'R5' }, 'I@R5')).toBe(true)
    expect(covers({ q: 'I', at: 'R5' }, 'I')).toBe(false)
    expect(covers({ q: 'I' }, 'I')).toBe(true)
    expect(covers({ q: 'I' }, 'Ic')).toBe(false)
  })

  it('22 carries every voltage (and the charge) from the pick to the next step; 23 opens with them covered', () => {
    const r22 = res('cap-branch')
    expect(r22.carry).toEqual([{ q: 'V', at: 'all' }, { q: 'q' }])
    // while predicting, the t = 0 voltages are fair
    expect(maskFor(r22, 'predict').get(['Vc'], 'hud')).toBeNull()
    // after the pick the covers are carried, so their words name the next step's pick, not this one
    expect(maskFor(r22, 'predict').next).toBe(false)
    expect(maskFor(r22, 'act').next).toBe(true)
    expect(maskFor(r22, 'done').next).toBe(true)
    expect(maskFor(res('cap-branch-v'), 'predict').next).toBe(false)
    for (const phase of ['act', 'done'] as const) {
      const m = maskFor(r22, phase)
      expect(m.get(['Vc'], 'hud'), phase).toBe('hide')
      expect(m.get(['V@R2'], 'label'), phase).toBe('hide')
      expect(m.get(['Vc'], 'plot-V'), phase).toBe('hide')
      expect(m.get(['q'], 'hud'), phase).toBe('hide')
      expect(m.get(['Ic'], 'plot-I'), phase).toBeNull()
      expect(m.say('rc-charge'), phase).toBe(true) // its sentence prints V_C
    }
    const r23 = res('cap-branch-v')
    const m = maskFor(r23, 'predict')
    for (const k of ['Vc', 'V@R1', 'V@R2', 'V', 'V@P', 'q']) expect(m.get([k], k === 'q' ? 'hud' : 'label') ?? m.get([k], 'hud'), k).toBe('hide')
    expect(m.get(['Vc'], 'plot-V')).toBe('hide')
    expect(m.covering).toBe(true)
    expect(m.announce).toMatch(/hidden until you pick/)
    // everything comes back at the reveal, and screen readers hear what came back
    expect(maskFor(r23, 'done').get(['Vc'], 'hud')).toBeNull()
    const full = state({ R1: { kind: 'resistor', ohms: 2 }, R2: { kind: 'resistor', ohms: 6 }, R3: { kind: 'capacitor', farads: 0.5 }, R5: { kind: 'wire' } }, 9)
    expect(liftLine(r23, full, reading)).toBe('Capacitor voltage: 9.00 V. Charge on the capacitor: 4.50 C.')
  })

  it('held lines: step 1 holds the status and the face until the answer; 15 holds the parallel rule line', () => {
    const r1 = res('push')
    expect(maskFor(r1, 'predict').face).toBe(true)
    expect(maskFor(r1, 'done').face).toBe(false)
    expect(maskFor(r1, 'predict').get(['I'], 'hud')).toBe('hide')
    expect(maskFor(r1, 'predict').get(['R'], 'hud')).toBe('hide')
    expect(maskFor(r1, 'predict').get(['P'], 'hud')).toBe('hide')
    expect(maskFor(r1, 'predict').get(['V'], 'hud')).toBeNull()
    expect(liftLine(r1, state({}), reading)).toBe('Battery current: 0 A. Power made by the battery, Iε: 0 W. Total resistance of the parts, not counting r: ∞ Ω.')
    const r15 = res('parallel-remove')
    expect(maskFor(r15, 'predict').say('parallel')).toBe(true)
    expect(maskFor(r15, 'act').say('parallel')).toBe(true)
    expect(maskFor(r15, 'done').say('parallel')).toBe(false)
    // a held status stays quiet through the task (4), any other status comes back with the pick
    expect(maskFor(res('real-battery'), 'act').status).toBe(true)
    expect(maskFor(res('add-resistor'), 'act').status).toBe(false)
  })
})
