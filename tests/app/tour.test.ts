import { describe, it, expect } from 'vitest'
import katex from 'katex'
import { solveBoard, SLOT_IDS, type Part, type Slots } from '../../apps/02-circuits/src/board'
import { STEPS, CHAPTERS, SHOTS, type Action, type GuideState, type Setup, type Step } from '../../apps/02-circuits/src/tour'
import { relaxVoltage } from '../../lib/physics/rc'
import { resolveTargets, linkRefs } from '../../apps/02-circuits/src/cues'

// A pure stand-in for the app: the same board solve, the same rule that a change to the circuit restarts the
// capacitor's curve from the capacitor's present voltage, and "fill" the way the app does it: the clock runs to the
// first frame at or past 5τ (the task is done there), then the answer lands on 6τ (V_C = V_oc).
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
  else if ('fill' in a) fillLikeTheApp(m)
}
/** The clock stopped at the first t ≥ 5τ, where the fill task counts as done (before the app's 6τ snap). */
function fillTo5tau(m: Model) {
  m.t = 5 * m.clock.tau
  m.capV = relaxVoltage(m.clock.V0, m.clock.Voc, m.clock.tau, m.t)
}
function fillLikeTheApp(m: Model) {
  fillTo5tau(m)
  m.t = 6 * m.clock.tau
  m.capV = m.clock.Voc
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

  it('every task has a do target and a show-me gesture, and finishing the task clears its place and remove targets', () => {
    const CHIPS = new Set(['2', '4', '6', '12', 'wire', 'cap'])
    const m = fresh()
    for (const st of STEPS) {
      enter(m, st)
      if (st.task) {
        const t = resolveTargets(st.spot ?? null, st.task.auto, view(m))
        expect(t.doSlots.length + (t.control ? 1 : 0) + (t.dial ? 1 : 0), `${st.id} has nothing to act on`).toBeGreaterThan(0)
        expect(t.gesture, `${st.id} gesture`).not.toBeNull()
        for (const c of t.doChips) expect(CHIPS.has(c), `${st.id} chip ${c}`).toBe(true)
        // a watch target is never also a do target
        for (const id of t.watchSlots) expect(t.doSlots, st.id).not.toContain(id)
        for (const a of st.task.auto) act(m, a)
        const after = resolveTargets(st.spot ?? null, st.task.auto, view(m))
        for (const a of st.task.auto) {
          if ('place' in a) expect(after.doSlots, `${st.id} place ${a.place} still marked`).not.toContain(a.place)
          if ('remove' in a) expect(after.doSlots, `${st.id} remove ${a.remove} still marked`).not.toContain(a.remove)
        }
      }
    }
  })

  it('a dial task points at the slot, then at the dial button once that dial is open, in the right direction', () => {
    const m = fresh()
    let downs = 0
    for (const st of STEPS) {
      enter(m, st)
      const dial = st.task?.auto.find((a): a is Extract<Action, { dial: string }> => 'dial' in a)
      if (!st.task || !dial) continue
      const closed = resolveTargets(st.spot ?? null, st.task.auto, view(m))
      expect(closed.doSlots, st.id).toContain(dial.dial)
      expect(closed.gesture?.kind, st.id).toBe('tap-slot')
      const open = resolveTargets(st.spot ?? null, st.task.auto, { ...view(m), selected: dial.dial })
      const p = m.slots[dial.dial]!
      const now = p.kind === 'resistor' ? p.ohms : p.kind === 'capacitor' ? p.farads : NaN
      expect(open.dial, st.id).toEqual({ slot: dial.dial, dir: dial.value >= now ? 1 : -1 })
      expect(open.doSlots, st.id).not.toContain(dial.dial)
      expect(open.gesture?.kind, st.id).toBe('dial')
      if (open.dial!.dir === -1) downs++
      for (const a of st.task.auto) act(m, a)
    }
    // the tour turns a dial down at least once (heat brings R1 to 2 ohms), so the minus direction is covered
    expect(downs).toBeGreaterThan(0)
  })

  it('a remove task points at the slot, then at the dial\'s Remove button once that part\'s dial is open (audit #117)', () => {
    const m = fresh()
    let seen = 0
    for (const st of STEPS) {
      enter(m, st)
      const rm = st.task?.auto.find((a): a is Extract<Action, { remove: unknown }> => 'remove' in a)
      if (!st.task || !rm) continue
      seen++
      const closed = resolveTargets(st.spot ?? null, st.task.auto, view(m))
      expect(closed.doSlots, st.id).toContain(rm.remove)
      expect(closed.remove, st.id).toBeNull()
      expect(closed.gesture?.kind, st.id).toBe('drag-off')
      const open = resolveTargets(st.spot ?? null, st.task.auto, { ...view(m), selected: rm.remove })
      expect(open.remove, st.id).toBe(rm.remove)
      expect(open.doSlots, st.id).not.toContain(rm.remove)
      expect(open.gesture?.kind, st.id).toBe('remove')
      expect(linkRefs(st.task.text, st.spot ?? null, st.task.auto), st.id).toContain('data-ref="remove"')
      for (const a of st.task.auto) act(m, a)
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('R₃ moved onto R₄ on "Take a branch away": the task words name R₄, the slot still to clear', () => {
    const st = STEPS.find(x => x.id === 'parallel-remove')!
    const m = fresh()
    enter(m, st)
    expect(st.task!.now?.(view(m)) ?? null).toBeNull()
    m.slots.R4 = m.slots.R3
    delete m.slots.R3
    const words = st.task!.now!(view(m))!
    expect(words).toContain('Remove R₄')
    expect(words).not.toContain('R₃')
    const html = linkRefs(words, st.spot ?? null, st.task!.auto)
    expect(html).toContain('data-ref="remove"')
    expect(html).toContain('data-ref="slot:R4"')
    expect(html.replace(/<[^>]+>/g, '')).toBe(words)
    expect(resolveTargets(st.spot ?? null, st.task!.auto, view(m)).doSlots).toContain('R4')
  })

  it('a wait for the capacitor points at 5x until the clock is sped up', () => {
    const m = fresh()
    for (const st of STEPS) {
      enter(m, st)
      if (!st.task?.auto.every(a => 'fill' in a)) continue
      expect(resolveTargets(st.spot ?? null, st.task.auto, { ...view(m), speed: 1 }).control, st.id).toBe('speed-5')
      expect(resolveTargets(st.spot ?? null, st.task.auto, { ...view(m), speed: 25 }).control, st.id).toBeNull()
    }
  })

  it('names in the task text link to the things they name, and the words read the same', () => {
    const SLOTS = new Set(['R1', 'R2', 'R3', 'R4', 'R5'])
    for (const st of STEPS) {
      if (!st.task) continue
      const html = linkRefs(st.task.text, st.spot ?? null, st.task.auto)
      expect(html.replace(/<[^>]+>/g, ''), st.id).toBe(st.task.text)
      const refs = [...html.matchAll(/data-ref="([^"]+)"/g)].map(x => x[1]!)
      // a wait ("let the capacitor fill") names nothing to act on; every other task names its part
      const waitOnly = st.task.auto.every(a => 'fill' in a)
      if (!waitOnly) expect(refs.length, `${st.id}: no linked names in "${st.task.text}"`).toBeGreaterThan(0)
      for (const r of refs) {
        const [kind, id] = r.split(':')
        if (kind === 'slot') expect(SLOTS.has(id!), `${st.id} ${r}`).toBe(true)
        else expect(['chip', 'ctl', 'dial', 'remove'], `${st.id} ${r}`).toContain(kind)
      }
    }
  })
})

// The prediction freeze, in the same model: entering a step with a prediction puts the capacitor at t = 0 of its
// curve and holds it there, so "before" is the t = 0 board; a fill only runs after the pick and lands on 6τ.
describe('guided tour: the before state', () => {
  const holdAtStart = (m: Model) => { if (Number.isFinite(m.clock.tau) && m.clock.tau > 0 && view(m).b.cap) { m.t = 0; m.capV = m.clock.V0 } }
  const walk = (stop: (st: Step, m: Model, before: number) => void) => {
    const m = fresh()
    for (const st of STEPS) {
      // the freeze goes up before the step's setup; a step that keeps the board starts it at t = 0
      holdAtStart(m)
      enter(m, st)
      const before = st.measure ? st.measure(view(m)) : NaN
      stop(st, m, before)
      for (const a of st.task?.auto ?? []) { if ('fill' in a) fillLikeTheApp(m); else act(m, a) }
    }
  }

  it('at every prediction the clock is at t = 0 and "before" is the t = 0 board', () => {
    walk((st, m, before) => {
      if (!st.predict) return
      const s = view(m)
      if (s.rc) {
        expect(s.rc.t, st.id).toBe(0)
        expect(m.capV, st.id).toBeCloseTo(m.clock.V0, 12)
      }
      if (st.measure) expect(before, st.id).toBe(st.measure(s))
    })
  })

  it('the "right then" steps (18, 21) measure t = 0 of the new curve, which is what the held board shows', () => {
    const seen: Record<string, number> = {}
    const m = fresh()
    for (const st of STEPS) {
      holdAtStart(m)
      enter(m, st)
      if (st.id === 'cap-in' || st.id === 'cap-dial') {
        for (const a of st.task!.auto) act(m, a)
        const s = view(m)
        const after = st.measure!(s)
        expect(s.rc!.t, st.id).toBe(0)
        // the HUD tile the board holds on: the capacitor current (18), the capacitor voltage (21)
        expect(st.id === 'cap-in' ? s.b.cap!.Ic : s.b.cap!.Vc, st.id).toBeCloseTo(after, 9)
        seen[st.id] = after
        continue
      }
      for (const a of st.task?.auto ?? []) { if ('fill' in a) fillLikeTheApp(m); else act(m, a) }
    }
    expect(seen['cap-in']).toBeCloseTo(3, 4)
    expect(seen['cap-dial']).toBeCloseTo(6, 4)
  })

  it('22 grades at 6τ: the battery current and the reveal say 1.50 A', () => {
    walk((st, m, before) => {
      if (st.id !== 'cap-branch') return
      expect(before).toBeCloseTo(6, 4) // t = 0: the empty capacitor shorts R₂
      fillLikeTheApp(m)
      const s = view(m)
      const after = st.measure!(s)
      expect(after).toBeCloseTo(1.5, 6)
      expect(st.predict!.answer({ s, before, after, pick: 0 })).toBe(0)
      expect(st.readout?.unit).toBe('A')
      const html = st.reveal!({ s, before, after, pick: 0 })
      expect(html).toContain('1.50 A')
      expect(html).not.toContain('1.51 A')
    })
  })

  it('22 at 5τ (where the app lands while looping): the After tile and the reveal both say 1.50 A', () => {
    walk((st, m, before) => {
      if (st.id !== 'cap-branch') return
      fillTo5tau(m)
      const s = view(m)
      expect(s.b.I).toBeGreaterThan(1.52) // the board still reads 1.53 A at 5τ; the tile and the text give the full-capacitor value
      const after = st.measure!(s)
      expect(after).toBeCloseTo(1.5, 9)
      const html = st.reveal!({ s, before, after, pick: 0 })
      expect(html).toContain('1.50 A')
      expect(html).toContain('40.4 mA')
      expect(html).not.toMatch(/1\.5[1-9] A/)
    })
  })

  it('copy: no giveaways in 8, 19 and 20, and 23 asks with bare voltages', () => {
    const byId = (id: string) => STEPS.find(s => s.id === id)!
    const s0 = view(fresh())
    expect(byId('turn-up').body(s0)).not.toMatch(/trickier/i)
    expect(byId('cap-slower').title).not.toMatch(/slower/i)
    const m = fresh()
    setup(m, byId('cap-fill').setup!)
    expect(byId('cap-fill').body(view(m))).not.toMatch(/fade/i)
    const v = byId('cap-branch-v')
    expect(v.predict!.options.map(o => Number.parseFloat(o))).toEqual([12, 9, 3, 0])
    for (const o of v.predict!.options) expect(o, 'a bare voltage').toMatch(/^\d+ V$/)
    // the answer goes to the option nearest the capacitor's voltage
    const at = (capV: number) => { const mm = fresh(); setup(mm, { ...v.setup!, capV }); const s = view(mm); return v.predict!.answer({ s, before: NaN, after: NaN, pick: 0 }) }
    expect([12, 9, 3, 0].map(at)).toEqual([0, 1, 2, 3])
  })
})

// ---------- printed arithmetic: every "a ÷ b = c", "(a)(b) = c" and parallel sum on screen checks out ----------
const NUM = '−?\\d+(?:\\.\\d+)?'
const num = (x: string) => Number(x.replace('−', '-'))
/** A printed reading in SI: "3.72 mA" → 0.00372. */
const si = (x: string, milli?: string) => num(x) * (milli ? 1e-3 : 1)
/** A printed sum of resistances or readings: "(4 Ω + 0.5 Ω)" or "8 Ω". */
const sumOf = (x: string) => x.replace(/[()]/g, '').split('+').reduce((t, term) => {
  const m = term.trim().match(new RegExp(`^(${NUM})\\s*(m?)`))
  return t + (m ? si(m[1]!, m[2]) : NaN)
}, 0)
/** Half a unit in the last printed place of a reading in SI: "1.53" → 0.005, "3.72 m" → 0.000005, "240" → 0.5. */
const halfUlp = (x: string, milli?: string) => 0.5 * 10 ** -(x.split('.')[1]?.length ?? 0) * (milli ? 1e-3 : 1)
/** The printed answer is the true value rounded to the digits shown (3 significant figures): |c − a/b| ≤ half a last place. */
const close3 = (printed: number, val: number, half: number) => Math.abs(printed - val) <= half * (1 + 1e-9) + 1e-12
type Line = { text: string; printed: number; val: number; half: number }
function arithmetic(html: string): Line[] {
  const t = html.replace(/<sup>−1<\/sup>/g, '⁻¹').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
  const out: Line[] = []
  // a ÷ b = c, with b a single value or a parenthesized sum
  for (const m of t.matchAll(new RegExp(`(${NUM}) ?(m?)[AVWΩCs]? ÷ (\\([^()]*\\)|${NUM} ?m?[AVWΩCs]?) = (${NUM}) ?(m?)[AVWΩCs]?`, 'g')))
    out.push({ text: m[0], printed: si(m[4]!, m[5]), val: si(m[1]!, m[2]) / sumOf(m[3]!), half: halfUlp(m[4]!, m[5]) })
  // (a)(b) = c
  for (const m of t.matchAll(new RegExp(`\\((${NUM}) ?(m?)[AVWΩCsF]\\)\\((${NUM}) ?(m?)[AVWΩCsF]\\) = (${NUM}) ?(m?)[AVWΩCs]`, 'g')))
    out.push({ text: m[0], printed: si(m[5]!, m[6]), val: si(m[1]!, m[2]) * si(m[3]!, m[4]), half: halfUlp(m[5]!, m[6]) })
  // (1/a + 1/b)⁻¹ = c, where a may be a sum like (2 Ω + 0.5 Ω)
  for (const m of t.matchAll(new RegExp(`\\(1/(\\([^()]*\\)|${NUM} ?Ω) \\+ 1/(${NUM}) ?Ω\\)⁻¹ = (${NUM}) ?Ω`, 'g')))
    out.push({ text: m[0], printed: num(m[3]!), val: 1 / (1 / sumOf(m[1]!) + 1 / num(m[2]!)), half: halfUlp(m[3]!) })
  // 1/R_P = 1/a Ω + 1/b Ω … so R_P = c Ω
  for (const m of t.matchAll(new RegExp(`1/RP = ((?:1/${NUM} Ω(?: \\+ )?)+).*?so RP = (${NUM}) Ω`, 'g')))
    out.push({ text: m[0], printed: num(m[2]!), val: 1 / [...m[1]!.matchAll(new RegExp(`1/(${NUM})`, 'g'))].reduce((a, x) => a + 1 / num(x[1]!), 0), half: halfUlp(m[2]!) })
  return out
}

describe('guided tour: printed arithmetic', () => {
  /** Walks the tour with "Do it for me"; `nudge` may move the sliders after a step's task, as a student might. */
  const walk = (nudge: (m: Model) => void, look: (st: Step, html: string) => void, fill: (m: Model) => void = fillLikeTheApp) => {
    const m = fresh()
    for (const st of STEPS) {
      enter(m, st)
      const s0 = view(m)
      look(st, st.body(s0))
      const before = st.measure ? st.measure(s0) : NaN
      for (const a of st.task?.auto ?? []) { if ('fill' in a) fill(m); else act(m, a) }
      nudge(m)
      const s1 = view(m)
      if (st.reveal) look(st, st.reveal({ s: s1, before, after: st.measure ? st.measure(s1) : NaN, pick: 0 }))
    }
  }
  const check = (st: Step, html: string) => {
    for (const x of arithmetic(html)) expect(close3(x.printed, x.val, x.half), `${st.id}: "${x.text}" (should be ${x.val})`).toBe(true)
  }

  it('the parser finds the worked lines it is meant to check', () => {
    const ok = (line: string) => arithmetic(line).map(x => close3(x.printed, x.val, x.half))
    expect(ok('12.0 V ÷ 8 Ω = 1.53 A')).toEqual([false])
    // a last-digit slip is caught whatever the leading digit
    expect(ok('12.0 V ÷ 5 Ω = 2.41 A')).toEqual([false])
    expect(ok('12.0 V ÷ 5 Ω = 2.40 A')).toEqual([true])
    expect(ok('(2.67 A)(4 Ω) = 10.6 V')).toEqual([false])
    expect(ok('12.0 V ÷ 1.5 kΩ = 8.00 mA')).toEqual([])
    expect(ok('3.00 V ÷ 1.5 Ω = 2.00 A')).toEqual([true])
    expect(arithmetic('12.0 V ÷ (4 Ω + 0.5 Ω) = 2.67 A')[0]!.val).toBeCloseTo(12 / 4.5, 9)
    expect(arithmetic('(2.67 A)(4 Ω) = 10.7 V')).toHaveLength(1)
    expect(arithmetic('(1/2 Ω + 1/6 Ω)<sup>−1</sup> = 1.50 Ω')[0]!.val).toBeCloseTo(1.5, 9)
    expect(arithmetic('1/<i>R</i><sub>P</sub> = 1/6 Ω + 1/6 Ω (Eq 10.3, p. 417), so <i>R</i><sub>P</sub> = 3.00 Ω')[0]!.val).toBeCloseTo(3, 9)
  })

  it('every worked line in every body and reveal is right, walked in order', () => {
    let n = 0
    walk(() => {}, (st, html) => { n += arithmetic(html).length; check(st, html) })
    expect(n).toBeGreaterThan(10)
  })

  it('still right when a student moves the sliders mid-step (r = 0.5 Ω, ε = 9 V)', () => {
    walk(m => { m.r = 0.5; m.emf = 9; anchor(m); if (Number.isFinite(m.clock.tau) && m.clock.tau > 0) { m.t = 6 * m.clock.tau; m.capV = m.clock.Voc } }, check)
  })

  it('the fill stopped at 5τ (no snap): 22 still says 1.50 A, from the circuit, and 19 says none, or very close', () => {
    let fillSeen = false
    walk(() => {}, (st, html) => {
      check(st, html)
      if (st.id === 'cap-branch' && /Yes/.test(html)) { expect(html).toContain('1.50 A'); expect(html).not.toMatch(/1\.5[1-9] A/) }
      if (st.id === 'cap-fill' && html.includes('None, or very close')) fillSeen = true
    }, fillTo5tau)
    expect(fillSeen, 'the cap-fill reveal says none, or very close').toBe(true)
    // and that is true: at 5τ the capacitor is within 1% of ε
    { const m = fresh(); setup(m, STEPS.find(x => x.id === 'cap-fill')!.setup!); fillTo5tau(m); const v = view(m); expect(v.b.cap!.Vc / v.emf, 'cap-fill V_C at 5τ').toBeGreaterThan(0.99) }
  })

  it('taking R₃ away: R₂\'s current went up (0.857 A to 1.50 A), and the reveal says why from the measured values', () => {
    let seen = ''
    walk(() => {}, (st, html) => { if (st.id === 'parallel-remove' && html.includes('only branch')) seen = html })
    expect(seen).toContain('from 0.857 A to 1.50 A')
    expect(seen).toContain('With one branch fewer, the branches resist more, so the branches get a bigger share of the battery\'s 12.0 V.')
    expect(seen).toContain('The voltage across R₂ rose from 5.14 V to 9.00 V, so R₂\'s current rose too.')
  })

  it('taking R₃ away only counts when R₃ leaves the board, not when R₃ moves into R₄', () => {
    const st = STEPS.find(s => s.id === 'parallel-remove')!
    const m = fresh()
    setup(m, st.setup!)
    const s0 = view(m)
    const before = st.measure!(s0)
    // the move a student can make by hand: R₃ dropped on R₄ is still a branch beside R₂
    const moved = clone(m.slots); moved.R4 = moved.R3; delete moved.R3; m.slots = moved; anchor(m)
    expect(st.task!.done(view(m))).toBe(false)
    // the hand and the do cue move to R₄, where the part now sits
    expect(resolveTargets(st.spot ?? null, st.task!.auto, view(m)).gesture).toEqual({ kind: 'drag-off', slot: 'R4' })
    // and if the reveal ever reads a board where nothing changed, it says so instead of claiming a rise
    const flat = st.reveal!({ s: view(m), before, after: st.measure!(view(m)), pick: 0 })
    expect(flat).not.toMatch(/rose|resists more/)
    expect(flat).toContain('stayed')
    act(m, { remove: 'R4' })
    expect(st.task!.done(view(m))).toBe(true)
  })
})
