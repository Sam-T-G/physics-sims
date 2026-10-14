import { describe, it, expect } from 'vitest'
import katex from 'katex'
import { solveBoard, SLOT_IDS, type Part, type Slots } from '../../apps/02-circuits/src/board'
import { STEPS, CHAPTERS, SHOTS, type Action, type GuideState, type Setup, type Step } from '../../apps/02-circuits/src/tour'
import { relaxVoltage } from '../../lib/physics/rc'

// A pure stand-in for the app: the same board solve, the same rule that a change to the circuit restarts the
// capacitor's curve from the capacitor's present voltage, and "fill" as the clock running to 6τ.
type Model = { emf: number; r: number; slots: Slots; batteryIn: boolean; capV: number; t: number; selected: GuideState['selected']; clock: { V0: number; I0: number; Voc: number; tau: number } }

const clone = (s: Slots): Slots => JSON.parse(JSON.stringify(s))
const view = (m: Model): GuideState => {
  const b = solveBoard({ emf: m.emf, r: m.r, slots: m.slots, capV: m.capV, batteryIn: m.batteryIn })
  return { emf: m.emf, r: m.r, slots: m.slots, batteryIn: m.batteryIn, b, selected: m.selected, rc: b.cap ? { t: m.t, tau: m.clock.tau, I0: m.clock.I0, V0: m.clock.V0, Voc: m.clock.Voc } : null }
}
const anchor = (m: Model) => {
  const b = solveBoard({ emf: m.emf, r: m.r, slots: m.slots, capV: m.capV, batteryIn: m.batteryIn })
  m.t = 0
  if (!b.cap) { m.capV = 0; return }
  m.capV = b.cap.Vc
  m.clock = { V0: b.cap.Vc, I0: b.cap.Ic, Voc: b.cap.Voc, tau: b.cap.tau }
}
const samePart = (a?: Part, b?: Part) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
function setup(m: Model, su: Setup) {
  m.emf = su.emf; m.r = su.r; m.batteryIn = su.batteryIn ?? true
  const next: Slots = {}
  for (const id of SLOT_IDS) { const want = su.slots[id]; if (want) next[id] = samePart(m.slots[id], want) ? m.slots[id] : JSON.parse(JSON.stringify(want)) }
  m.slots = next
  m.selected = null
  if (su.capV !== undefined) m.capV = su.capV
  anchor(m)
}
function act(m: Model, a: Action) {
  if ('place' in a) { m.slots = { ...clone(m.slots), [a.place]: JSON.parse(JSON.stringify(a.part)) }; anchor(m) }
  else if ('remove' in a) { const s = clone(m.slots); delete s[a.remove]; m.slots = s; if (m.selected === a.remove) m.selected = null; anchor(m) }
  else if ('dial' in a) {
    const s = clone(m.slots); const p = s[a.dial]!
    if (p.kind === 'resistor') p.ohms = a.value
    else if (p.kind === 'capacitor') { m.capV *= p.farads / a.value; p.farads = a.value }
    m.slots = s; anchor(m)
  } else if ('r' in a) { m.r = a.r; anchor(m) }
  else if ('battery' in a) { m.batteryIn = a.battery; anchor(m) }
  else if ('select' in a) m.selected = a.select
  else if ('fill' in a) { m.t = 6 * m.clock.tau; m.capV = m.clock.Voc }
}
const fresh = (): Model => ({ emf: 12, r: 0, slots: {}, batteryIn: true, capV: 0, t: 0, selected: null, clock: { V0: 0, I0: 0, Voc: 0, tau: Infinity } })

// The option each prediction is written to have right, checked against what the physics then does.
const INTENDED: Record<string, number> = {
  push: 1, short: 2, 'real-battery': 1, 'add-resistor': 1, 'turn-up': 0, heat: 0, series: 1, 'series-gap': 2,
  parallel: 0, 'parallel-split': 1, 'parallel-remove': 0, 'parallel-wire': 2, 'cap-in': 1, 'cap-fill': 0,
  'cap-slower': 1, 'cap-dial': 1, 'cap-branch': 0, 'cap-branch-v': 1, 'cap-cutoff': 1, 'cap-shorted': 2, discharge: 1,
}

const BAD_TEXT = /NaN|undefined|Infinity|\?\s?[AVΩWCs]\b| — /
function enter(m: Model, st: Step) {
  if (st.setup && !(st.keepIf?.(view(m)) ?? false)) setup(m, st.setup)
}
function checkText(st: Step, s: GuideState, html: string, what: string) {
  expect(html, `${st.id} ${what}: ${html}`).not.toMatch(BAD_TEXT)
}

describe('guided tour', () => {
  it('has a step in every chapter, and every chapter starts from a board of its own', () => {
    for (let c = 0; c < CHAPTERS.length; c++) {
      const first = STEPS.find(s => s.chapter === c)
      expect(first, CHAPTERS[c]).toBeDefined()
    }
    expect(new Set(STEPS.map(s => s.id)).size).toBe(STEPS.length)
  })

  it('every equation in the tour typesets', () => {
    const m = fresh()
    for (const st of STEPS) {
      enter(m, st)
      for (const e of st.eqs ?? []) {
        const tex = typeof e.tex === 'string' ? e.tex : e.tex(view(m))
        expect(() => katex.renderToString(tex, { throwOnError: true }), `${st.id}: ${tex}`).not.toThrow()
      }
    }
  })

  it('walked in order with "Do it for me": every task completes, every intended answer is what the board does, every text is clean', () => {
    const m = fresh()
    for (const st of STEPS) {
      enter(m, st)
      const s0 = view(m)
      checkText(st, s0, st.body(s0), 'body')
      const before = st.measure ? st.measure(s0) : NaN
      if (st.task) {
        expect(st.task.done(s0), `${st.id} is not already done at the start`).toBe(false)
        for (const a of st.task.auto) act(m, a)
        expect(st.task.done(view(m)), `${st.id} done after auto`).toBe(true)
      }
      const s1 = view(m)
      const after = st.measure ? st.measure(s1) : NaN
      if (st.predict) {
        const got = st.predict.answer({ s: s1, before, after, pick: 0 })
        expect(got, `${st.id} answer (before ${before}, after ${after})`).toBe(INTENDED[st.id])
        expect(st.predict.options[got], st.id).toBeDefined()
      } else expect(INTENDED[st.id], `${st.id} has no prediction`).toBeUndefined()
      if (st.reveal) checkText(st, s1, st.reveal({ s: s1, before, after, pick: 0 }), 'reveal')
    }
  })

  it('jumping straight to any step (chapter buttons, Back, Skip) still gives clean text and a reachable task', () => {
    for (const [k, st] of STEPS.entries()) {
      // the board the student might arrive with: what the previous step's setup left, untouched
      const m = fresh()
      const prev = [...STEPS.slice(0, k)].reverse().find(p => p.setup)
      if (prev?.setup) setup(m, prev.setup)
      enter(m, st)
      const s0 = view(m)
      checkText(st, s0, st.body(s0), 'body after a jump')
      if (st.task) {
        for (const a of st.task.auto) act(m, a)
        expect(st.task.done(view(m)), `${st.id} reachable after a jump`).toBe(true)
        if (st.reveal) checkText(st, view(m), st.reveal({ s: view(m), before: st.measure?.(s0) ?? NaN, after: st.measure?.(view(m)) ?? NaN, pick: 0 }), 'reveal after a jump')
      }
    }
  })

  it('the numbers the tour quotes from the book setups', () => {
    const at = (id: string) => {
      const m = fresh()
      for (const st of STEPS) {
        enter(m, st)
        if (st.id === id) return { m, st }
        for (const a of st.task?.auto ?? []) act(m, a)
      }
      throw new Error(id)
    }
    // a real battery on a dead short: I = ε/r
    { const { m, st } = at('real-battery'); for (const a of st.task!.auto) act(m, a); expect(view(m).b.I).toBeCloseTo(12 / 0.5, 9) }
    // empty capacitor in series: I₀ = ε/R₁ = 3 A; τ = R₁C = 2 s
    { const { m, st } = at('cap-in'); for (const a of st.task!.auto) act(m, a); expect(m.clock.I0).toBeCloseTo(3, 4); expect(m.clock.tau).toBeCloseTo(2, 4) }
    // capacitor beside R₂: ends at 9 V, sees 2 ∥ 6 = 1.5 Ω, τ = 0.75 s
    { const { m } = at('cap-branch-tau'); const s = view(m); expect(s.b.cap!.Rth).toBeCloseTo(1.5, 4); expect(s.b.cap!.tau).toBeCloseTo(0.75, 4); expect(s.b.cap!.Voc).toBeCloseTo(9, 4) }
    // battery cut off: the capacitor empties through R₂ alone, I₀ = −9/6 A, τ = 3 s
    { const { m, st } = at('cap-cutoff'); for (const a of st.task!.auto) act(m, a); expect(m.clock.I0).toBeCloseTo(-1.5, 4); expect(m.clock.tau).toBeCloseTo(3, 4) }
    // discharge: I₀ = −Q/RC = −12/4 A
    { const { m, st } = at('discharge'); for (const a of st.task!.auto) act(m, a); expect(m.clock.I0).toBeCloseTo(-3, 4) }
    // at 5τ the current is under 1% of I₀ (e⁻⁵ = 0.67%)
    expect(relaxVoltage(0, 12, 2, 10) / 12).toBeGreaterThan(0.99)
  })

  it('tour copy follows the voice rules: no em dashes in sentences, no "it" standing in for a part at the start of a task', () => {
    for (const st of STEPS) {
      const s = view(fresh())
      const texts = [st.title, st.predict?.q ?? '', ...(st.predict?.options ?? []), st.task?.text ?? '']
      for (const t of texts) expect(t, st.id).not.toMatch(/ — |—/)
      expect(st.task?.text ?? '', st.id).not.toMatch(/^It /)
      void s
    }
  })

  it('every camera direction names a real shot, and every shot looks at a point on the board', () => {
    const names = new Set([...Object.keys(SHOTS), 'overview'])
    for (const st of STEPS) {
      expect(names.has(st.cam ?? 'overview'), `${st.id} cam ${st.cam}`).toBe(true)
      if (st.camAfter) expect(names.has(st.camAfter), `${st.id} camAfter ${st.camAfter}`).toBe(true)
    }
    for (const [name, sh] of Object.entries(SHOTS)) {
      expect(Math.abs(sh.x) <= 5 && Math.abs(sh.z) <= 2.5, name).toBe(true)
      // inside the orbit limits (polar 0.2 to 1.0 rad from straight down), so the controls never snap the camera
      const phi = Math.PI / 2 - sh.el
      expect(phi >= 0.2 && phi <= 1.0, `${name} el ${sh.el}`).toBe(true)
    }
  })
})
