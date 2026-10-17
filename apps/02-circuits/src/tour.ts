// The guided tour: what each step says, what it sets up, what it asks, and how it knows the student did it.
// Pure data plus small functions of the board state; guide.ts runs it and sim.ts carries out the actions.
// Every fact was checked against OpenStax University Physics Vol 2 (Ch 8 to 10). The card shows no page or equation
// numbers (Sam, 2026-10-17: keep it short and casual); tests/app/tour.test.ts checks the physics and the arithmetic.

import type { BoardResult, Part, Slots, SlotId } from './board'
import type { CameraShot } from './scene'
import { reading, sig, sig3, exact, unitPrefix } from './format'

export type Setup = { emf: number; r: number; slots: Slots; batteryIn?: boolean; capV?: number }
export type Action =
  | { place: SlotId; part: Part }
  | { remove: SlotId }
  | { dial: SlotId; value: number }
  | { r: number }
  | { battery: boolean }
  | { select: SlotId }
  | { fill: true }
/** The capacitor's clock, as the guide needs it. */
export type RcView = { t: number; tau: number; I0: number; V0: number; Voc: number }
export type GuideState = {
  emf: number; r: number; slots: Slots; batteryIn: boolean; b: BoardResult; rc: RcView | null; selected: SlotId | null
  /** The capacitor clock's speed: 1, 5 or 25. */ speed?: number
  /** The clock is held at the instant right after a change, until Play (a "right then" step). */ waiting?: boolean
}
/**
 * What a step shows and points at. `done` adds targets once the answer is out: slots to watch, and Play as the thing
 * to press while the clock waits right after the change. (A row or box the prediction covers is not pointed at
 * until the cover lifts.)
 */
export type Spot = {
  slots?: SlotId[]; chips?: string[]; hud?: boolean; battery?: boolean; time?: boolean; rows?: string[]
  done?: { slots?: SlotId[]; play?: boolean }
}
export type Ctx = { s: GuideState; before: number; after: number; pick: number }
/**
 * Camera shots, in board-local units (board.ts: battery at x = −4.6, R₁ at (−2.65, −2.1), the branches between
 * B (x = −0.55) and C (x = 2.75), R₅ at x = 4.6). az swings the camera around the board, + toward R₅;
 * el is the height above the board. 'overview' is the whole board from the front.
 */
export const SHOTS = {
  battery: { x: -3.9, z: 0, span: 3.8, az: -0.55, el: 0.78 },
  loop: { x: 0, z: 0, span: 10.5, az: 0.18, el: 1.2 },
  'loop-left': { x: -3.1, z: -0.9, span: 5.6, az: -0.35, el: 0.9 },
  // wide enough to keep the battery's top in the frame beside R₁
  R1: { x: -2.9, z: -1.6, span: 5.5, az: -0.25, el: 0.85 },
  series: { x: 0, z: 0, span: 11, az: 0.3, el: 1.12 },
  R5: { x: 4.3, z: 0, span: 4.0, az: 0.55, el: 0.8 },
  // the capacitor steps talk about the whole loop (the battery, R₁, B, C and every voltage), so these frame all of it
  'cap-R5': { x: 0, z: -0.6, span: 6.6, az: 0.25, el: 0.85 },
  parallel: { x: 1.1, z: -0.55, span: 5.0, az: 0.12, el: 1.05 },
  'parallel-wide': { x: 0.1, z: -0.8, span: 7.2, az: -0.1, el: 1.0 },
  branches: { x: 1.1, z: 0.25, span: 4.2, az: 0.2, el: 0.9 },
  'cap-R3': { x: -0.4, z: -0.6, span: 6.0, az: -0.15, el: 0.9 },
} satisfies Record<string, CameraShot>
export type ShotName = keyof typeof SHOTS | 'overview'

/** The number a step measures, shown before → after in the reveal, styled like the HUD tile of that quantity. */
export type Readout = { label: string; unit: 'A' | 'V' | 'W' | 's' | 'C'; kind: 'I' | 'V' | 'P' | 'T' | 'Q' }

export type Eq = { tex: string | ((s: GuideState) => string) }

// ---------- the prediction freeze (freeze.ts applies the rules) ----------
/** A quantity on screen: I battery current, Ic capacitor current, V terminal voltage, Vc capacitor voltage, P battery
 *  power, R total resistance, tau, q the capacitor's charge. */
export type Qty = 'I' | 'Ic' | 'V' | 'Vc' | 'P' | 'R' | 'tau' | 'q'
/** No `at`: the whole circuit (the battery). A slot: that part's own value. 'all': every value of that kind. */
export type QRef = { q: Qty; at?: SlotId | 'all' }
/** The equation rows (panel.ts ids) whose sentence can be held back. */
export type RowId = 'parallel' | 'series' | 'current' | 'terminal' | 'rc-tau' | 'rc-current' | 'rc-charge' | 'junction' | 'loop' | 'part' | 'energy'
export type Freeze = {
  /** 'before' tags the asked value with its frozen number; 'hide' covers every view of it. Empty: nothing tagged. */
  ask?: Array<QRef & { show: 'before' | 'hide' }>
  /** The HUD opens on this part while the student predicts (no dial). */
  focus?: SlotId
  /** Held back until the reveal: the status line, the battery's face, a row's sentence. */
  hold?: Array<'status' | 'face' | `say:${RowId}`>
  /** Covered from the pick until the next step (the next step asks for it). */
  carry?: QRef[]
  /** "Right then": after the change the clock stays at t = 0 of the new curve until Play or Next. */
  after?: 'hold'
}

export type Step = {
  id: string
  chapter: number
  title: string
  body: (s: GuideState) => string
  eqs?: Eq[]
  /** The board this step starts from. Only the parts that differ are changed. */
  setup?: Setup
  /** Keep the board as the student left it when this holds, instead of applying setup. */
  keepIf?: (s: GuideState) => boolean
  spot?: Spot
  /** Where the camera flies when the step opens, and (optional) when the answer appears. */
  cam?: ShotName
  camAfter?: ShotName
  /** Where the camera flies when the Try it card opens. */
  camAct?: ShotName
  readout?: Readout
  predict?: { q: string; options: string[]; answer: (c: Ctx) => number }
  /** What the board holds back while the student predicts (every step with a prediction freezes, see freeze.ts). */
  freeze?: Freeze
  /** Equations that would give the answer away: shown with the reveal instead of the body. */
  eqsAfter?: Eq[]
  /** `now` rewrites the text for the board as it is (a part moved to another slot the task must clear); null keeps `text`. */
  task?: { text: string; now?: (s: GuideState) => string | null; done: (s: GuideState) => boolean; auto: Action[]; progress?: (s: GuideState) => number }
  /** The number this step is about, read once when the step starts and again when the task is done. */
  measure?: (s: GuideState) => number
  reveal?: (c: Ctx) => string
  /** A slider step: the answer keeps following the board while the student keeps sliding (no new stamp, no count-up). */
  liveReveal?: boolean
}

export const CHAPTERS = ['Charge', 'Current', 'Resistors', 'Series', 'Parallel', 'Capacitors', 'A second path', 'Emptying a capacitor'] as const

// ---------- small helpers ----------
const R = (ohms: number): Part => ({ kind: 'resistor', ohms })
const W: Part = { kind: 'wire' }
const CAP = (farads = 0.5): Part => ({ kind: 'capacitor', farads })
const A = (x: number) => reading(x, 'A')
const V = (x: number) => reading(x, 'V')
const P = (x: number) => reading(x, 'W')
const ohm = (x: number) => `${Number.isFinite(x) ? sig3(x) : '∞'} Ω`
const sec = (x: number) => `${sig3(x)} s`
/** Index of the option that matches the measured change: 0 went up, 1 went down, 2 stayed the same. */
const trend = (before: number, after: number) => {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return after === before ? 2 : after > before ? 0 : 1
  const tol = 1e-6 * Math.max(Math.abs(before), Math.abs(after), 1e-9)
  return after > before + tol ? 0 : after < before - tol ? 1 : 2
}
/** The three trend options, each naming what moves: "The battery current goes up", …, in `trend` order. */
const upDownSame = (what: string) => [`${what} goes up`, `${what} goes down`, `${what} stays the same`]
const wentWord = (c: Ctx) => (c.after > c.before ? 'went up' : c.after < c.before ? 'went down' : 'stayed the same')
const ohmsOf = (s: GuideState, id: SlotId) => { const p = s.slots[id]; return p?.kind === 'resistor' ? p.ohms : p?.kind === 'wire' ? 0 : NaN }
const isWire = (s: GuideState, id: SlotId) => s.slots[id]?.kind === 'wire'
const isRes = (s: GuideState, id: SlotId) => s.slots[id]?.kind === 'resistor'
const isCap = (s: GuideState, id: SlotId) => s.slots[id]?.kind === 'capacitor'
const slotI = (s: GuideState, id: SlotId) => s.b.slots[id]?.I ?? 0
const slotV = (s: GuideState, id: SlotId) => s.b.slots[id]?.V ?? 0
const full = (s: GuideState) => !!s.rc && Number.isFinite(s.rc.tau) && s.rc.t >= 5 * s.rc.tau
const fillProgress = (s: GuideState) => (s.rc && Number.isFinite(s.rc.tau) && s.rc.tau > 0 ? Math.min(1, s.rc.t / (5 * s.rc.tau)) : 0)
const p = (...xs: string[]) => xs.map(x => `<p>${x}</p>`).join('')
/**
 * The first factor of a worked product "(x)(by) = ans", printed so the line checks out by hand: 3 figures, or 4 when
 * the 3-figure factor times `by` would land a different last digit than the printed answer. With ε = 9 V and r = 0.5 Ω,
 * R₂'s line reads (1.059 A)(6 Ω) = 6.35 V, where (1.06 A)(6 Ω) would give 6.36 V by hand.
 */
const factor = (x: number, unit: string, by: number, ans: number, ansUnit: string) => {
  const { prefix, scale } = unitPrefix(x, unit)
  for (const n of [3, 4, 5]) {
    const shown = sig(x * scale, n)
    if (reading((Number(shown.replace('−', '-')) / scale) * by, ansUnit) === reading(ans, ansUnit)) return `${shown} ${prefix}${unit}`
  }
  return reading(x, unit)
}
/** The battery's r as a term in a sum, only when the battery has one: " + 0.5 Ω", or "". */
const plusR = (s: GuideState) => (s.r > 0 ? ` + ${exact(s.r)} Ω` : '')
const plusRSym = (s: GuideState) => (s.r > 0 ? ' + <i>r</i>' : '')
/** The resistors filled in the parallel lanes (R₂ to R₄), when no lane holds a wire or a capacitor. */
const laneResistors = (s: GuideState): SlotId[] | null => {
  const filled = (['R2', 'R3', 'R4'] as SlotId[]).filter(id => s.slots[id])
  return filled.length > 0 && filled.every(id => isRes(s, id)) ? filled : null
}
/** The parallel rule worked with the branches on the board: "1/R_P = 1/6 Ω + 1/6 Ω, so R_P = 3.00 Ω". */
const parallelLine = (s: GuideState) => {
  const lanes = laneResistors(s)
  const what = 'Together the branches act like one resistor, <i>R</i><sub>P</sub>'
  if (!lanes) return `${what} = ${ohm(s.b.Rp)}.`
  const rs = lanes.map(id => ohmsOf(s, id))
  return `${what}: 1/<i>R</i><sub>P</sub> = ${rs.map(x => `1/${exact(x)} Ω`).join(' + ')}, so <i>R</i><sub>P</sub> = ${ohm(s.b.Rp)}${lanes.length > 1 ? ', smaller than the smallest branch' : ''}.`
}

/** A resistance sum as printed: a dialed value as dialed, anything else to 3 significant figures. */
const ohmsText = (x: number) => (Number.isInteger(x * 100) ? exact(Math.round(x * 100) / 100) : sig3(x))

// cap-in: the current a plain wire in R₅ would carry, ε/(R₁ + R_P + r), is what "as much as a wire" means
const wireCurrent = (s: GuideState) => s.emf / ((ohmsOf(s, 'R1') || 0) + s.b.Rp + s.r)
const capInAnswer = (c: Ctx) => (c.after === 0 ? 0 : Math.abs(c.after - wireCurrent(c.s)) < 1e-3 * Math.abs(c.after) ? 1 : 2)
// parallel-remove: the board while R₃ is still on it. Ctx carries one number per side (R₂'s current), so the
// step's measure keeps the battery current, R_P and R₂'s voltage from "before" here; "before" is always read with
// R₃ in place.
let batteryBeforeRemove = NaN
let rpBeforeRemove = NaN
let v2BeforeRemove = NaN
/** parallel-remove's second reveal sentence, from the measured R_P and V₂ on each side (never a change that didn't happen). */
const removeWhy = (c: Ctx) => {
  const s = c.s, rp = s.b.Rp, v2 = slotV(s, 'R2')
  const same = (x: number, y: number) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(y))
  if (same(rp, rpBeforeRemove)) return `The branches still resist the same, so the voltage across R₂ stayed at ${V(v2)}.`
  const more = rp > rpBeforeRemove
  const share = isRes(s, 'R1') ? `, so the branches get a ${more ? 'bigger' : 'smaller'} share of the battery's ${V(s.emf)}` : ''
  const lead = `With one branch fewer, the branches resist ${more ? 'more' : 'less'}${share}.`
  if (same(v2, v2BeforeRemove)) return `${lead} The voltage across R₂ stayed at ${V(v2)}.`
  const up = v2 > v2BeforeRemove
  const follows = up === (c.after > c.before) && !same(c.after, c.before)
  return `${lead} The voltage across R₂ ${up ? 'rose' : 'fell'} from ${V(v2BeforeRemove)} to ${V(v2)}${follows ? `, so R₂'s current ${up ? 'rose' : 'fell'} too` : ''}.`
}
const capInLead = (c: Ctx) => {
  const s = c.s
  if (capInAnswer(c) === 0) return `None: ${A(c.after)} flows, because the loop has a gap besides the capacitor.`
  if (capInAnswer(c) === 2) return `Some, but less than with a wire: ${A(c.after)}, where a wire in R₅ would carry ${A(wireCurrent(s))}.`
  const terms = [`${exact(ohmsOf(s, 'R1'))} Ω`, ...(s.b.Rp > 0 ? [ohm(s.b.Rp)] : []), ...(s.r > 0 ? [`${exact(s.r)} Ω`] : [])]
  const sym = `<i>R</i>₁${s.b.Rp > 0 ? ' + <i>R</i><sub>P</sub>' : ''}${plusRSym(s)}`
  const f = terms.length > 1 ? `ε/(${sym}) = ${V(s.emf)} ÷ (${terms.join(' + ')})` : `ε/${sym} = ${V(s.emf)} ÷ ${terms[0]}`
  return `As much as a wire: <i>I</i> = ${f} = ${A(c.after)} at first. An empty capacitor has no voltage pushing back yet, so at first the current flows as if the capacitor were a wire.`
}

// cap-dial: the reveal leads with the option's own words
const CAP_DIAL = ['The capacitor\'s voltage doubles', 'The capacitor\'s voltage halves', 'The capacitor\'s voltage stays at 12 V']
const capDialAnswer = (c: Ctx) => (c.after > c.before * 1.5 ? 0 : c.after < c.before * 0.75 ? 1 : 2)

// cap-branch: the end current comes from the circuit, not from the clock (a fill can stop a hair short of 6τ)
// The step's own board (R₁, R₂, the capacitor in R₃, a wire in R₅): the battery current once the capacitor is full,
// ε/(R₁ + R₂ + r). At 5τ the capacitor still takes its last few percent of current, so the board reads a little more.
const capBranchPlain = (s: GuideState) => isRes(s, 'R1') && isRes(s, 'R2') && isCap(s, 'R3') && !s.slots.R4 && isWire(s, 'R5') && s.batteryIn
const capBranchEnd = (s: GuideState) => s.emf / (ohmsOf(s, 'R1') + ohmsOf(s, 'R2') + s.r)
// the After tile and the reveal's sentences give the same full-capacitor current; "before" (t = 0) stays the board's
const capBranchMeasure = (s: GuideState) => (full(s) && capBranchPlain(s) && s.b.I > 0 ? capBranchEnd(s) : s.b.I)
const capBranchReveal = (c: Ctx): string[] => {
  const s = c.s
  if (!(s.b.I > 0)) return [`No: the battery current is ${A(s.b.I)}. With the capacitor full, nothing else closes the loop.`]
  if (!capBranchPlain(s)) return [`Yes: ${A(s.b.I)} keeps flowing. A full capacitor acts like a gap, but the resistors beside the capacitor give the charge another way around.`]
  const sum = ohmsOf(s, 'R1') + ohmsOf(s, 'R2') + s.r
  const end = capBranchEnd(s)
  const ic = s.b.cap?.Ic ?? 0
  return [
    `Yes: ${A(end)} keeps flowing through R₁ and R₂. A full capacitor acts like a gap, but R₂ gives the charge a way around the gap.`,
    `With the capacitor full, the circuit is just R₁ and R₂ in series${s.r > 0 ? ' plus <i>r</i>' : ''}: <i>I</i> = ε/(<i>R</i>₁ + <i>R</i>₂${plusRSym(s)}) = ${V(s.emf)} ÷ ${ohmsText(sum)} Ω = ${A(end)}.`,
    ...(A(ic) !== A(0) ? [`At 5τ the capacitor still takes ${A(ic)}, so the battery current is still a little over ${A(end)}.`] : []),
  ]
}

// cap-cutoff: τ = R₂C only while R₂ is the capacitor's one path
const cutoffReveal = (c: Ctx): string[] => {
  const s = c.s
  if (c.after === 0) return [`No: the capacitor current is ${A(0)}. With R₁ gone, nothing closes a loop through the capacitor.`]
  const onlyR2 = isRes(s, 'R2') && !s.slots.R4 && !s.slots.R1
  const tau = sec(s.b.cap?.tau ?? 0)
  return [
    `Yes, for a while. The capacitor empties through ${onlyR2 ? 'R₂' : 'the branches beside the capacitor'} in a small loop. The current starts at ${A(c.after)} and fades with ${onlyR2 ? `<i>τ</i> = <i>R</i>₂<i>C</i> = ${tau}` : `<i>τ</i> = ${tau}`}.`,
    'The minus sign means the current runs backward: charge is flowing off the plates. With the battery cut off, the capacitor acts like a small battery until the capacitor is empty.',
  ]
}

// discharge: the options compare with the charging current, so the answer keys off the sign of I₀
const DISCHARGE = ['The same way the charging current flowed', 'The opposite way', 'No current flows']
const dischargeAnswer = (c: Ctx) => (c.after < 0 ? 1 : c.after > 0 ? 0 : 2)
const dischargeReveal = (c: Ctx): string[] => {
  const s = c.s
  const k = dischargeAnswer(c)
  const lead = k === 1
    ? `The opposite way: the current starts at ${A(c.after)}. The full capacitor is now the only thing pushing, so charge flows back off the plates and around through R₁ the other way.`
    : `${DISCHARGE[k]}: the current starts at ${A(c.after)}.`
  const r1Only = isRes(s, 'R1') && isWire(s, 'R2') && !s.slots.R3 && !s.slots.R4 && isCap(s, 'R5')
  const tau = `${r1Only ? '<i>R</i>₁<i>C</i>' : '<i>RC</i>'} = ${sec(s.b.cap?.tau ?? 0)}`
  return [lead, `The charge drains fast at first, then slower, with <i>τ</i> = ${tau}. After 5<i>τ</i>, less than 1% of the charge is left.`]
}

export const STEPS: Step[] = [
  // ---------------- 1. Charge ----------------
  {
    id: 'charge', chapter: 0, title: 'Everything starts with charge',
    cam: 'overview',
    setup: { emf: 12, r: 0, slots: {} },
    body: () => p(
      'Charge comes in two kinds, positive and negative. Same kinds push each other apart, and opposite kinds pull together. Charge is measured in coulombs (C).',
    ),
    reveal: () => p('The total charge never changes. Charge only moves from place to place, and that idea comes back later as the junction rule.'),
  },
  {
    id: 'push', chapter: 0, title: 'The battery gives charge energy',
    cam: 'overview',
    camAfter: 'battery',
    setup: { emf: 12, r: 0, slots: {} },
    spot: { battery: true, slots: ['R1', 'R2', 'R3', 'R4', 'R5'] },
    body: () => p(
      'The battery has a + end and a − end. The battery\'s emf (<i>ε</i>) is the energy the battery gives each coulomb of charge: 12 V means 12 joules per coulomb.',
      'When current flows, yellow dots move along the wires.',
    ),
    predict: { q: 'All five slots on the board are empty. Will charge flow around the board?', options: ['Yes, the battery pushes the charge around', 'No'], answer: c => (c.s.b.I > 0 ? 0 : 1) },
    freeze: {
      ask: [{ q: 'I', show: 'hide' }, { q: 'P', show: 'hide' }, { q: 'R', show: 'hide' }],
      hold: ['status', 'face', 'say:current', 'say:series', 'say:loop'],
    },
    reveal: c => p(
      `No. The battery current is ${A(c.s.b.I)}. Charge only flows around a complete loop, from the battery's + end back to the − end, and every empty slot is a gap.`,
      'Next, let\'s close the loop.',
    ),
  },

  // ---------------- 2. Current ----------------
  {
    id: 'current', chapter: 1, title: 'Current is charge per second',
    cam: 'loop',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: W } },
    body: s => p(
      'Current is how much charge passes a point each second. One amp (A) is one coulomb per second.',
      `With a 4 Ω resistor in R₁ and plain wire in R₂ and R₅, the loop is closed, so ${A(s.b.I)} flows.`,
    ),
    eqs: [{ tex: 'I = \\frac{\\Delta Q}{\\Delta t}' }],
    reveal: () => p(
      'Current goes out of the battery\'s + end and back into the − end.',
      'In a metal wire, the charges that really move are electrons, and they go the other way. The math comes out the same either way.',
    ),
  },
  {
    id: 'short', chapter: 1, title: 'A loop of plain wire',
    cam: 'loop',
    camAfter: 'battery',
    setup: { emf: 12, r: 0, slots: {} },
    spot: { slots: ['R1', 'R2', 'R5'], chips: ['wire'], hud: true, rows: ['current'] },
    body: () => p('Wire has 0 Ω on this board, so wire doesn\'t slow the charge down. The battery is perfect for now too: no resistance inside (<i>r</i> = 0).'),
    predict: { q: 'Fill R₁, R₂ and R₅ with plain wire. How big will the current be?', options: ['Small', 'Big, but limited', 'The math can\'t give a number'], answer: c => (c.s.b.idealShort ? 2 : 1) },
    freeze: { ask: [{ q: 'I', show: 'before' }] },
    task: {
      text: 'Put a wire in R₁, in R₂ and in R₅.',
      done: s => isWire(s, 'R1') && isWire(s, 'R5') && (['R2', 'R3', 'R4'] as SlotId[]).some(id => isWire(s, id)),
      auto: [{ place: 'R1', part: W }, { place: 'R2', part: W }, { place: 'R5', part: W }],
    },
    reveal: c => p(
      c.s.b.idealShort
        ? `The math can't give a number. With 0 Ω all the way around, <i>I</i> = ${V(c.s.emf)} ÷ 0 Ω, and you can't divide by 0.`
        : `Big, but limited: with only wire on the board, <i>r</i> = ${exact(c.s.r)} Ω inside the battery is the only thing holding the current back, so <i>I</i> = ε/<i>r</i> = ${V(c.s.emf)} ÷ ${exact(c.s.r)} Ω = ${A(c.s.b.I)}.`,
      'Real batteries always have a little resistance inside. That\'s next.',
    ),
  },
  {
    id: 'real-battery', chapter: 1, title: 'A real battery',
    cam: 'battery',
    setup: { emf: 12, r: 0, slots: { R1: W, R2: W, R5: W } },
    spot: { battery: true, hud: true, rows: ['current', 'terminal'] },
    body: () => p('Every real battery has a little resistance inside, called <i>r</i>. The current has to get through <i>r</i> too, on every trip around the loop.'),
    predict: { q: 'Raise r above 0 Ω. What will the battery current be?', options: ['Still no number', 'ε divided by r', '0 A'], answer: c => (c.s.b.idealShort ? 0 : c.s.b.I === 0 ? 2 : 1) },
    freeze: { ask: [{ q: 'I', show: 'before' }], hold: ['status', 'say:current'] },
    task: { text: 'Drag the r slider up from 0 Ω.', done: s => s.r > 0, auto: [{ r: 0.5 }] },
    liveReveal: true,
    reveal: c => p(
      `The current is ε/r = ${V(c.s.emf)} ÷ ${exact(c.s.r)} Ω = ${A(c.s.b.I)}. With only wire on the board, <i>r</i> is the only thing slowing the charge down. That's a <b>short circuit</b>, and a real battery gets hot fast this way.`,
      `The voltage the board gets (the terminal voltage) drops to ${V(c.s.b.Vt)}, because the whole ${V(c.s.emf)} drops across <i>r</i> inside the battery.`,
    ),
  },

  // ---------------- 3. Resistors ----------------
  {
    id: 'resistor', chapter: 2, title: 'What a resistor is',
    cam: 'R1',
    // a 4 Ω resistor in R₁, so the camera frames the bands the reveal reads (add-resistor sets its own board)
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    spot: { chips: ['2', '4', '6', '12'] },
    body: () => p(
      'A resistor holds the current back. Resistance <i>R</i>, measured in ohms (Ω), is how many volts it takes to push one amp through the resistor.',
    ),
    eqs: [{ tex: 'R = \\frac{V}{I}' }],
    reveal: () => p('The colored bands give a resistor\'s value. On the 4 Ω resistor in R₁: yellow (4), black (0), then gold, which means divide by 10. So 40 ÷ 10 = 4 Ω. The last gold band means the real value is within 5% of 4 Ω.'),
  },
  {
    id: 'add-resistor', chapter: 2, title: 'Add a resistor',
    cam: 'R1',
    camAfter: 'loop-left',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0.5, slots: { R1: W, R2: W, R5: W } },
    spot: { slots: ['R1'], chips: ['4'], hud: true, rows: ['current'] },
    body: s => p(`Back to a short circuit: plain wire in R₁, R₂ and R₅, with <i>r</i> = ${exact(s.r)} Ω inside the battery. The battery current is ${A(s.b.I)}.`),
    predict: { q: 'Swap the wire in R₁ for the 4 Ω resistor. What happens to the battery current?', options: upDownSame('The battery current'), answer: c => trend(c.before, c.after) },
    task: { text: 'Drag the 4 Ω resistor onto R₁. The wire in R₁ pops off.', done: s => isRes(s, 'R1'), auto: [{ place: 'R1', part: R(4) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. Now the charge has to get through R₁ as well as <i>r</i>: <i>I</i> = ε/(<i>R</i>₁ + <i>r</i>) = ${V(c.s.emf)} ÷ (${exact(ohmsOf(c.s, 'R1'))} Ω + ${exact(c.s.r)} Ω) = ${A(c.s.b.I)}.`,
    ),
  },
  {
    id: 'ohm', chapter: 2, title: 'Ohm\'s law on one resistor',
    cam: 'R1',
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    keepIf: s => isRes(s, 'R1') && s.b.status === 'ok',
    spot: { slots: ['R1'], hud: true, rows: ['part'] },
    body: () => p('So far every number has been for the whole circuit. Now let\'s look at R₁ by itself.'),
    task: { text: 'Tap R₁ on the board.', done: s => s.selected === 'R1', auto: [{ select: 'R1' }] },
    reveal: c => p(
      `R₁ carries ${A(slotI(c.s, 'R1'))} and has ${V(slotV(c.s, 'R1'))} across R₁. Ohm's law ties the two together: <i>V</i> = <i>IR</i> = (${factor(slotI(c.s, 'R1'), 'A', ohmsOf(c.s, 'R1'), slotV(c.s, 'R1'), 'V')})(${exact(ohmsOf(c.s, 'R1'))} Ω) = ${V(slotV(c.s, 'R1'))}.`,
    ),
  },
  {
    id: 'turn-up', chapter: 2, title: 'Turn R₁ up',
    cam: 'R1',
    camAfter: 'loop-left',
    readout: { label: 'Voltage across R₁', unit: 'V', kind: 'V' },
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    spot: { slots: ['R1'], hud: true, rows: ['part', 'terminal'] },
    body: () => p('A bigger R₁ means less current. That part makes sense.'),
    predict: { q: 'Turn R₁\'s dial up to 20 Ω. What happens to the voltage across R₁?', options: upDownSame('The voltage across R₁'), answer: c => trend(c.before, c.after) },
    freeze: { ask: [{ q: 'V', at: 'R1', show: 'before' }], focus: 'R1', hold: ['say:terminal'] },
    task: { text: 'Tap R₁, then press + on R₁\'s dial until R₁ reads 20 Ω or more.', done: s => ohmsOf(s, 'R1') >= 20, auto: [{ dial: 'R1', value: 20 }] },
    measure: s => slotV(s, 'R1'),
    reveal: c => p(
      `The voltage across R₁ ${wentWord(c)}, from ${V(c.before)} to ${V(c.after)}, even though the current dropped to ${A(c.s.b.I)}.`,
      `The battery's ${V(c.s.emf)} is shared between R₁ and <i>r</i>. With less current, less voltage drops across <i>r</i> inside the battery, so R₁ gets a bigger share.`,
    ),
  },
  {
    id: 'heat', chapter: 2, title: 'Resistors make heat',
    cam: 'R1',
    readout: { label: 'Power in R₁', unit: 'W', kind: 'P' },
    setup: { emf: 12, r: 0.5, slots: { R1: R(20), R2: W, R5: W } },
    keepIf: s => isRes(s, 'R1') && ohmsOf(s, 'R1') > 2 && s.r > 0 && s.r <= 0.5 && s.b.status === 'ok',
    spot: { slots: ['R1'], rows: ['part', 'energy'] },
    body: () => p('Every resistor turns electrical energy into heat. Power <i>P</i> is how much heat R₁ makes each second.'),
    eqs: [{ tex: 'P = I^2 R' }],
    predict: { q: 'Turn R₁ back down to 2 Ω. Does R₁ make heat faster or slower?', options: ['Faster', 'Slower', 'At the same rate'], answer: c => trend(c.before, c.after) },
    freeze: { ask: [{ q: 'P', at: 'R1', show: 'before' }], focus: 'R1' },
    task: { text: 'Use R₁\'s dial to bring R₁ down to 2 Ω or less.', done: s => isRes(s, 'R1') && ohmsOf(s, 'R1') <= 2, auto: [{ dial: 'R1', value: 2 }] },
    measure: s => s.b.slots.R1?.P ?? 0,
    reveal: c => p(
      `${['Faster', 'Slower', 'At the same rate'][trend(c.before, c.after)]}: R₁'s power ${wentWord(c)} from ${P(c.before)} to ${P(c.after)}. A smaller R lets a lot more current through, and the heat grows with the current squared.`,
    ),
  },

  // ---------------- 4. Series ----------------
  {
    id: 'series', chapter: 3, title: 'Two resistors in a row',
    cam: 'series',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: W } },
    spot: { slots: ['R5'], chips: ['4'], hud: true, rows: ['series', 'current'] },
    body: s => p(`R₁ (4 Ω) is the only resistor, and the battery is perfect again (<i>r</i> = 0). The battery current is ${A(s.b.I)}. Parts in a row like this, with one path through all of them, are <b>in series</b>.`),
    predict: { q: 'Put the 4 Ω resistor in R₅ too. What happens to the battery current?', options: upDownSame('The battery current'), answer: c => trend(c.before, c.after) },
    freeze: { hold: ['say:series', 'say:current'] },
    task: { text: 'Drag a resistor onto R₅.', done: s => isRes(s, 'R5'), auto: [{ place: 'R5', part: R(4) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. Resistances in series just add up: <i>R</i><sub>eq</sub> = ${exact(ohmsOf(c.s, 'R1'))} Ω${c.s.b.Rp > 0 ? ` + ${ohm(c.s.b.Rp)}` : ''} + ${exact(ohmsOf(c.s, 'R5'))} Ω = ${ohm(c.s.b.Req)}.`,
      c.s.r === 0 && c.s.b.Rp === 0 && ohmsOf(c.s, 'R1') === ohmsOf(c.s, 'R5') ? 'Twice the resistance, half the current.' : 'More total resistance, less current.',
    ),
  },
  {
    id: 'series-share', chapter: 3, title: 'Same current, shared voltage',
    cam: 'series',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: R(4) } },
    keepIf: s => isRes(s, 'R1') && isRes(s, 'R5') && s.b.status === 'ok' && s.r === 0 && s.b.Rp === 0,
    spot: { slots: ['R1', 'R5'], hud: true, rows: ['loop'] },
    body: () => p('In series there\'s only one path, so the same current has to go through R₁ and through R₅.'),
    task: { text: 'Tap R₅ to see R₅\'s numbers.', done: s => s.selected === 'R5', auto: [{ select: 'R5' }] },
    reveal: c => p(
      `R₅ carries ${A(slotI(c.s, 'R5'))}, the same as R₁. The battery's ${V(c.s.emf)} gets split between them: ${V(slotV(c.s, 'R1'))} across R₁${c.s.b.Rp > 0 ? ` plus ${V(c.s.b.I * c.s.b.Rp)} from B to C` : ''} plus ${V(slotV(c.s, 'R5'))} across R₅${c.s.r > 0 ? ` plus ${V(c.s.b.I * c.s.r)} across <i>r</i>` : ''} = ${V(c.s.emf)}.`,
      `Going around the loop, the battery adds ${V(c.s.emf)} and the parts drop the same total. That's the <b>loop rule</b>. A bigger resistor takes a bigger share.`,
    ),
  },
  {
    id: 'series-gap', chapter: 3, title: 'Take one out',
    cam: 'series',
    camAct: 'R1',
    camAfter: 'series',
    readout: { label: 'Current through R₅', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: R(4) } },
    spot: { slots: ['R1', 'R5'], hud: true, rows: ['loop'] },
    body: s => p(`R₁ and R₅ are in series again, 4 Ω each. R₅ carries ${A(slotI(s, 'R5'))}.`),
    predict: { q: 'Take R₁ off the board. Will current still flow through R₅?', options: ['Yes, the same current', 'Yes, more current', 'No'], answer: c => (slotI(c.s, 'R5') === 0 ? 2 : slotI(c.s, 'R5') > c.before ? 1 : 0) },
    freeze: { ask: [{ q: 'I', at: 'R5', show: 'before' }] },
    task: { text: 'Drag R₁ off the board, or tap R₁ and press Remove R₁.', done: s => !s.slots.R1, auto: [{ remove: 'R1' }] },
    measure: s => slotI(s, 'R5'),
    reveal: c => p(
      `No. R₅ now carries ${A(slotI(c.s, 'R5'))}. One gap anywhere in a series loop stops the current everywhere.`,
      `With no current, R₅ drops 0 V, so the battery's full ${V(c.s.emf)} shows up across the empty R₁ slot.`,
    ),
  },

  // ---------------- 5. Parallel ----------------
  {
    id: 'parallel', chapter: 4, title: 'Two paths side by side',
    cam: 'parallel',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R5: W } },
    spot: { slots: ['R3'], chips: ['6'], hud: true, rows: ['parallel'] },
    body: s => p(`R₂, R₃ and R₄ sit side by side between B and C, the junctions where the paths split and join back up. Branches like these are <b>in parallel</b>. Right now only R₂ (6 Ω) is filled, and the battery current is ${A(s.b.I)}.`),
    predict: { q: 'Add the 6 Ω resistor in R₃, next to R₂. What happens to the battery current?', options: upDownSame('The battery current'), answer: c => trend(c.before, c.after) },
    task: { text: 'Drag the 6 Ω resistor onto R₃.', done: s => isRes(s, 'R3'), auto: [{ place: 'R3', part: R(6) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. Lots of people guess down, since you added a resistor. But a second branch gives the charge one more way through, so the branches resist less together than either one alone.`,
      parallelLine(c.s),
    ),
  },
  {
    id: 'parallel-split', chapter: 4, title: 'Same voltage, split current',
    cam: 'parallel',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: R(6), R5: W } },
    keepIf: s => isRes(s, 'R2') && isRes(s, 'R3') && !s.slots.R4 && ohmsOf(s, 'R2') === 6 && ohmsOf(s, 'R3') === 6 && s.r === 0 && s.b.status === 'ok' && s.b.bypassed.length === 0,
    spot: { slots: ['R2', 'R3'], rows: ['parallel', 'junction'] },
    body: s => p(
      'Every branch connects B to C, so every branch gets the same voltage. The current splits between the branches.',
      `Right now R₂ and R₃ are both ${exact(ohmsOf(s, 'R2'))} Ω, so each carries ${A(slotI(s, 'R2'))}.`,
    ),
    freeze: { ask: [{ q: 'I', at: 'R2', show: 'before' }, { q: 'I', at: 'R3', show: 'before' }] },
    predict: { q: 'Change R₃ to 2 Ω. Which branch will get more current?', options: ['R₂ (6 Ω)', 'R₃ (2 Ω)', 'They get the same'], answer: c => { const a = slotI(c.s, 'R2'), b = slotI(c.s, 'R3'); return Math.abs(a - b) < 1e-9 ? 2 : a > b ? 0 : 1 } },
    task: { text: 'Tap R₃, then use R₃\'s dial to set 2 Ω.', done: s => isRes(s, 'R3') && ohmsOf(s, 'R3') <= 2, auto: [{ dial: 'R3', value: 2 }] },
    reveal: c => p(
      `R₂ has ${V(slotV(c.s, 'R2'))} and ${A(slotI(c.s, 'R2'))}. R₃ has ${V(slotV(c.s, 'R3'))} and ${A(slotI(c.s, 'R3'))}. Same voltage, and the smaller resistor gets more current.`,
      `At B the current splits, and at C the current joins back up: ${(['R2', 'R3', 'R4'] as SlotId[]).filter(id => c.s.slots[id]).map(id => A(slotI(c.s, id))).join(' + ')} = ${A(c.s.b.I)}. No charge gets lost along the way. That's the <b>junction rule</b>, the same charge idea from the very first step.`,
    ),
  },
  {
    id: 'parallel-remove', chapter: 4, title: 'Take a branch away',
    cam: 'parallel',
    camAfter: 'parallel-wide',
    readout: { label: 'Current through R₂', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: R(2), R5: W } },
    spot: { slots: ['R2', 'R3'], hud: true, rows: ['parallel'] },
    body: s => p(`R₁ = 2 Ω in series, then R₂ = 6 Ω and R₃ = 2 Ω in parallel. R₂ carries ${A(slotI(s, 'R2'))}.`),
    predict: { q: 'Take R₃ off the board. What happens to the current through R₂?', options: upDownSame('The current through R₂'), answer: c => trend(c.before, c.after) },
    freeze: { ask: [{ q: 'I', at: 'R2', show: 'before' }], hold: ['say:parallel'] },
    // R₃ has to leave the board: dropped on R₄ it is still a branch beside R₂ (R₄ starts empty), so the cues and
    // "Do it for me" then take it off R₄
    task: {
      text: 'Remove R₃: drag R₃ off the board, or tap R₃ and press Remove R₃.',
      now: s => (!s.slots.R3 && s.slots.R4 ? 'Remove R₄ too: R₄ is another branch beside R₂. Drag R₄ off the board, or tap R₄ and press Remove R₄.' : null),
      done: s => !s.slots.R3 && !s.slots.R4, auto: [{ remove: 'R3' }, { remove: 'R4' }],
    },
    measure: s => { if (s.slots.R3) { batteryBeforeRemove = s.b.I; rpBeforeRemove = s.b.Rp; v2BeforeRemove = slotV(s, 'R2') } return slotI(s, 'R2') },
    reveal: c => p(
      laneResistors(c.s)?.join() === 'R2'
        ? `R₂'s current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. R₂ is now the only branch, so R₂ carries the whole battery current.`
        : `R₂'s current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. The battery current ${c.s.b.I === batteryBeforeRemove ? `stayed at ${A(c.s.b.I)}` : `went from ${A(batteryBeforeRemove)} to ${A(c.s.b.I)}`}.`,
      removeWhy(c),
    ),
  },
  {
    id: 'parallel-wire', chapter: 4, title: 'A wire in a branch',
    cam: 'branches',
    camAfter: 'parallel',
    readout: { label: 'Current through R₂', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: R(6), R5: W } },
    spot: { slots: ['R4'], chips: ['wire'], hud: true, rows: ['parallel'] },
    body: s => p(`R₂ and R₃ (6 Ω each) are in parallel. Each carries ${A(slotI(s, 'R2'))}.`),
    freeze: { ask: [{ q: 'I', at: 'R2', show: 'before' }, { q: 'I', at: 'R3', show: 'before' }] },
    predict: { q: 'Put a plain wire in R₄, beside R₂ and R₃. What happens to the current through R₂ and R₃?', options: ['Nothing changes', 'Their current goes down a bit', 'Their current drops to zero'], answer: c => (slotI(c.s, 'R2') === 0 ? 2 : slotI(c.s, 'R2') < c.before ? 1 : 0) },
    task: { text: 'Drag a wire onto R₄.', done: s => isWire(s, 'R4'), auto: [{ place: 'R4', part: W }] },
    measure: s => slotI(s, 'R2'),
    reveal: c => p(
      'Zero. The wire has 0 Ω, so all the current takes the wire and none goes through R₂ or R₃.',
      c.s.r > 0
        ? `Now only R₁ and <i>r</i> limit the battery current: <i>I</i> = ε/(<i>R</i>₁ + <i>r</i>) = ${V(c.s.emf)} ÷ (${exact(ohmsOf(c.s, 'R1'))} Ω + ${exact(c.s.r)} Ω) = ${A(c.s.b.I)}.`
        : `Now only R₁ limits the battery current: <i>I</i> = ε/<i>R</i>₁ = ${V(c.s.emf)} ÷ ${exact(ohmsOf(c.s, 'R1'))} Ω = ${A(c.s.b.I)}.`,
    ),
  },

  // ---------------- 6. Capacitors ----------------
  {
    id: 'capacitor', chapter: 5, title: 'What a capacitor is',
    cam: 'R5',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W }, batteryIn: true, capV: 0 },
    spot: { chips: ['cap'] },
    body: () => p(
      'A capacitor is two metal plates with a gap between them. Charge can\'t cross the gap, so charge piles up instead: +<i>Q</i> on one plate and −<i>Q</i> on the other.',
      'Capacitance <i>C</i> is how much charge the capacitor holds for each volt. One farad (F) is one coulomb per volt.',
    ),
    eqs: [{ tex: 'C = \\frac{Q}{V}' }],
    reveal: () => p('Most real capacitors are way smaller than 1 F. The board uses 0.5 F so the capacitor takes a few seconds to fill.'),
  },
  {
    id: 'cap-in', chapter: 5, title: 'Drop in an empty capacitor',
    cam: 'cap-R5',
    camAfter: 'series',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W }, batteryIn: true, capV: 0 },
    spot: { slots: ['R5'], chips: ['cap'], hud: true, time: true },
    body: () => p('R₅ is empty, so no current flows. The capacitor in the tray is empty: 0 V across the plates.'),
    // the battery current before the drop; right after the drop the same current is the capacitor's
    freeze: { ask: [{ q: 'I', show: 'before' }, { q: 'Ic', show: 'before' }], after: 'hold' },
    predict: { q: 'Drop the empty capacitor into R₅. Right when the capacitor lands, how much current flows?', options: ['None, since charge can\'t cross the gap', 'As much as if R₅ were a plain wire', 'Some, but less than with a wire'], answer: c => capInAnswer(c) },
    task: { text: 'Drag the capacitor onto R₅.', done: s => isCap(s, 'R5'), auto: [{ place: 'R5', part: CAP() }] },
    measure: s => s.rc?.I0 ?? s.b.I,
    reveal: c => p(
      capInLead(c),
      'No charge actually crosses the gap: charge flows onto one plate while the same amount leaves the other plate.',
    ),
  },
  {
    id: 'cap-fill', chapter: 5, title: 'Watch the capacitor fill',
    cam: 'cap-R5',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP() }, batteryIn: true, capV: 0 },
    // kept from the last step only while the capacitor's curve starts empty (the step opens at t = 0 of that curve)
    keepIf: s => isCap(s, 'R5') && isRes(s, 'R1') && s.batteryIn && !full(s) && Math.abs(s.rc?.V0 ?? 1) < 1e-9,
    spot: { slots: ['R5'], hud: true, time: true },
    body: s => p(`The capacitor in R₅ is empty and filling through R₁. Right now ${A(s.b.cap?.Ic ?? s.b.I)} flows, and the capacitor has ${V(s.b.cap?.Vc ?? 0)}.`),
    eqsAfter: [{ tex: 'I_C(t) = I_0\\,e^{-t/\\tau}, \\qquad \\tau = RC' }],
    predict: { q: 'When the capacitor is full, how much current flows?', options: ['None', 'The same as at the start', 'Half of the starting current'], answer: c => (Math.abs(c.s.b.I) < 1e-2 * Math.abs(c.s.rc?.I0 ?? 1) ? 0 : 2) },
    freeze: { ask: [{ q: 'Ic', show: 'before' }], hold: ['say:rc-current', 'say:rc-tau'] },
    task: { text: 'Wait for the capacitor to fill. Press the 5× button to speed up the clock.', done: full, auto: [{ fill: true }], progress: fillProgress },
    reveal: c => p(
      'None, or very close. The full capacitor pushes back about as hard as the battery pushes, so almost no current flows.',
      `The current drops fast at first, then slower. <i>I</i><sub>0</sub> is the starting current, ${A(c.s.rc?.I0 ?? 0)}. After one <i>τ</i> (the time constant, ${sec(c.s.rc?.tau ?? 0)}) the current is down to 37% of <i>I</i><sub>0</sub>, and after 5<i>τ</i> the current is under 1%. A full capacitor acts like a gap.`,
    ),
  },
  {
    id: 'cap-slower', chapter: 5, title: 'Turn up R₁ while the capacitor fills',
    cam: 'cap-R5',
    camAfter: 'series',
    readout: { label: 'Time constant τ', unit: 's', kind: 'T' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP() }, batteryIn: true, capV: 0 },
    spot: { slots: ['R1'], hud: true, time: true, rows: ['rc-tau'] },
    body: s => p(`The capacitor is empty again, filling through R₁ = 4 Ω. Right now <i>τ</i> = ${sec(s.b.cap?.tau ?? 0)}.`),
    freeze: { hold: ['say:rc-tau'] },
    predict: { q: 'Turn R₁ up to 12 Ω. How will the capacitor fill?', options: ['Faster', 'Slower', 'At the same speed'], answer: c => { const t = trend(c.before, c.after); return t === 0 ? 1 : t === 1 ? 0 : 2 } },
    task: { text: 'Tap R₁ and use R₁\'s dial to reach 12 Ω or more.', done: s => ohmsOf(s, 'R1') >= 12, auto: [{ dial: 'R1', value: 12 }] },
    measure: s => s.b.cap?.tau ?? 0,
    reveal: c => p(
      `${c.after > c.before ? 'Slower' : 'Faster'}: <i>τ</i> = <i>RC</i> went from ${sec(c.before)} to ${sec(c.after)}. More resistance means less current, so charge piles onto the plates more slowly.`,
      'The capacitor still ends up at the battery\'s full voltage. R changes how fast the capacitor fills, not where the capacitor ends up.',
    ),
  },
  {
    id: 'cap-dial', chapter: 5, title: 'Change C on a full capacitor',
    cam: 'cap-R5',
    readout: { label: 'Capacitor voltage', unit: 'V', kind: 'V' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP(0.5) }, batteryIn: true, capV: 12 },
    spot: { slots: ['R5'], hud: true, time: true, done: { play: true } },
    body: s => p(`The capacitor is full: ${V(s.b.cap?.Vc ?? 0)} across ${exact(s.b.cap?.C ?? 0)} F, holding <i>q</i> = <i>CV</i> = ${reading(s.b.cap?.q ?? 0, 'C')}.`),
    freeze: { ask: [{ q: 'Vc', show: 'before' }], after: 'hold' },
    predict: { q: 'Turn the capacitor\'s dial from 0.5 F up to 1 F. Right then, what happens to the capacitor\'s voltage?', options: CAP_DIAL, answer: capDialAnswer },
    task: { text: 'Tap the capacitor and press + until the capacitor reads 1 F.', done: s => (s.b.cap?.C ?? 0) >= 1, auto: [{ dial: 'R5', value: 1 }] },
    measure: s => s.rc?.V0 ?? s.b.cap?.Vc ?? 0,
    reveal: c => p(
      `${CAP_DIAL[capDialAnswer(c)]}: from ${V(c.before)} to ${V(c.after)}. R₁ keeps charge from rushing on or off the plates all at once, and <i>V</i> = <i>q</i>/<i>C</i>, so the same charge on a bigger <i>C</i> means a lower voltage.`,
      'Press Play to watch the battery fill the capacitor back up.',
    ),
  },

  // ---------------- 7. A second path ----------------
  {
    id: 'cap-branch', chapter: 6, title: 'A capacitor beside a resistor',
    cam: 'cap-R3',
    camAfter: 'parallel-wide',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 0 },
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    spot: { slots: ['R3'], hud: true, time: true },
    body: () => p('The empty capacitor sits in R₃, side by side with R₂ (6 Ω). R₁ = 2 Ω is in series with both.'),
    predict: { q: 'Once the capacitor is full, will the battery still push current around the board?', options: ['Yes', 'No, everything stops'], answer: c => (c.s.b.I > 0 ? 0 : 1) },
    // the next step asks where the capacitor ends up, so every voltage (and the charge, q = CV) stays covered
    freeze: { ask: [], carry: [{ q: 'V', at: 'all' }, { q: 'q' }] },
    task: { text: 'Wait for the capacitor to fill.', done: full, auto: [{ fill: true }], progress: fillProgress },
    measure: capBranchMeasure,
    reveal: c => p(
      ...capBranchReveal(c),
    ),
  },
  {
    id: 'cap-branch-v', chapter: 6, title: 'Where a branch capacitor ends up',
    cam: 'cap-R3',
    // no keepIf: the capacitor's curve loops, so the board left by the last step may be partway through a replay;
    // this step reads V_C, so it always starts from its own full capacitor (the setup only changes what differs)
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R3'] },
    body: () => p('Earlier, the full capacitor ended up at the battery\'s full 12 V. This capacitor is in a different spot.'),
    predict: {
      q: 'What voltage did this capacitor end up at?',
      options: ['12 V', '9 V', '3 V', '0 V'],
      answer: c => { const v = c.s.b.cap?.Vc ?? 0; const at = [12, 9, 3, 0].map(x => Math.abs(v - x)); return at.indexOf(Math.min(...at)) },
    },
    freeze: { ask: [{ q: 'V', at: 'all', show: 'hide' }, { q: 'q', show: 'hide' }] },
    reveal: c => p(
      `${V(c.s.b.cap?.Vc ?? 0)}. The capacitor sits right beside R₂, so the capacitor ends up at R₂'s voltage: <i>V</i>₂ = <i>IR</i>₂ = (${factor(slotI(c.s, 'R2'), 'A', ohmsOf(c.s, 'R2'), slotV(c.s, 'R2'), 'V')})(${exact(ohmsOf(c.s, 'R2'))} Ω) = ${V(slotV(c.s, 'R2'))}.`,
      `The other ${V(slotV(c.s, 'R1'))} drops across R₁. A capacitor fills to the voltage across the capacitor's own two ends, which isn't always the battery's voltage.`,
    ),
  },
  {
    id: 'cap-branch-tau', chapter: 6, title: 'Which R goes in τ = RC?',
    cam: 'parallel-wide',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    keepIf: s => isCap(s, 'R3') && isRes(s, 'R1') && isRes(s, 'R2') && s.r === 0 && !s.slots.R4 && isWire(s, 'R5') && s.b.status === 'ok',
    spot: { hud: true, rows: ['rc-tau'] },
    body: s => p(
      'Here the R in <i>τ</i> = <i>RC</i> isn\'t R₁ + R₂. The capacitor\'s charge can flow through R₂, or back around through R₁ and the battery. That\'s two paths side by side, so R is R₁ and R₂ in parallel:',
      `<i>R</i> = (1/${s.r > 0 ? `(${exact(ohmsOf(s, 'R1'))} Ω${plusR(s)})` : `${exact(ohmsOf(s, 'R1'))} Ω`} + 1/${exact(ohmsOf(s, 'R2'))} Ω)<sup>−1</sup> = ${ohm(s.b.cap?.Rth ?? NaN)}, so <i>τ</i> = (${factor(s.b.cap?.Rth ?? NaN, 'Ω', s.b.cap?.C ?? 0, s.b.cap?.tau ?? 0, 's')})(${exact(s.b.cap?.C ?? 0)} F) = ${sec(s.b.cap?.tau ?? 0)}.`,
    ),
    reveal: () => p('A trick to find R: turn the battery\'s ε down to 0 (keep <i>r</i>), then ask what resistance the capacitor\'s charge flows through.'),
  },
  {
    id: 'cap-cutoff', chapter: 6, title: 'Cut the battery off',
    cam: 'parallel-wide',
    camAfter: 'cap-R3',
    readout: { label: 'Capacitor current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R1', 'R3'], hud: true, time: true, done: { slots: ['R2'] } },
    body: s => p(`The capacitor is full at ${V(s.b.cap?.Vc ?? 0)}, beside R₂.`),
    freeze: { ask: [{ q: 'Ic', show: 'before' }] },
    predict: { q: 'Take R₁ off the board. The battery is cut off. Will any current flow?', options: ['No, the circuit is open', 'Yes, for a while'], answer: c => (c.after !== 0 ? 1 : 0) },
    task: { text: 'Remove R₁: drag R₁ off the board, or tap R₁ and press Remove R₁.', done: s => !s.slots.R1, auto: [{ remove: 'R1' }] },
    measure: s => s.rc?.I0 ?? 0,
    reveal: c => p(
      ...cutoffReveal(c),
    ),
  },
  {
    id: 'cap-shorted', chapter: 6, title: 'A wire beside the capacitor',
    cam: 'branches',
    camAfter: 'branches',
    readout: { label: 'Charge on the capacitor', unit: 'C', kind: 'Q' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R3', 'R4'], chips: ['wire'], hud: true, time: true },
    body: s => p(`The capacitor is full again, holding ${reading(s.b.cap?.q ?? 0, 'C')} at ${V(s.b.cap?.Vc ?? 0)}.`),
    freeze: { ask: [] },
    predict: { q: 'Put a plain wire in R₄, beside the full capacitor. What happens to the capacitor\'s charge?', options: ['The charge stays', 'The charge drains slowly', 'The charge is gone at once'], answer: c => (c.after === 0 ? 2 : c.after < c.before ? 1 : 0) },
    task: { text: 'Drag a wire onto R₄.', done: s => isWire(s, 'R4'), auto: [{ place: 'R4', part: W }] },
    measure: s => s.b.cap?.q ?? 0,
    reveal: c => p(
      c.after === 0
        ? 'The charge is gone at once. The wire connects the two plates with 0 Ω, so the charge rushes straight through the wire.'
        : `The capacitor now holds ${reading(c.after, 'C')}, down from ${reading(c.before, 'C')}.`,
      `The wire takes all ${A(c.s.b.I)} of the battery current, so R₂ gets ${A(slotI(c.s, 'R2'))} and the capacitor ends with ${reading(c.s.b.cap?.q ?? 0, 'C')}.`,
    ),
  },

  // ---------------- 8. Emptying a capacitor ----------------
  {
    id: 'discharge', chapter: 7, title: 'Switch the battery out',
    cam: 'series',
    camAfter: 'cap-R5',
    readout: { label: 'Capacitor current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP() }, batteryIn: true, capV: 12 },
    spot: { slots: ['R5'], hud: true, time: true, rows: ['rc-current', 'rc-charge'] },
    body: s => p(`The capacitor in R₅ is full at ${V(s.b.cap?.Vc ?? 0)}, in series with R₁ = ${exact(ohmsOf(s, 'R1'))} Ω. With the battery switched out, a plain wire takes the battery's place.`),
    freeze: { ask: [{ q: 'Ic', show: 'before' }] },
    predict: { q: 'Switch the battery out. Compared with when the capacitor was filling, which way will the current flow?', options: DISCHARGE, answer: dischargeAnswer },
    task: { text: 'Press "Discharge: battery out".', done: s => !s.batteryIn, auto: [{ battery: false }] },
    measure: s => s.rc?.I0 ?? 0,
    reveal: c => p(
      ...dischargeReveal(c),
    ),
  },
  {
    id: 'done', chapter: 7, title: 'You built it all from charge',
    cam: 'overview',
    body: () => p(
      'Charge is never lost, so current into a junction comes back out (junction rule). Voltage goes up across the battery and down across the parts, adding to zero around any loop (loop rule). Resistors set how much current flows, and capacitors store charge and set how fast things change (<i>τ</i> = <i>RC</i>).',
      'Every number on this board comes from those two rules plus <i>V</i> = <i>IR</i>, <i>P</i> = <i>IV</i> and <i>q</i> = <i>CV</i>. Now go build your own circuits.',
    ),
  },
]
