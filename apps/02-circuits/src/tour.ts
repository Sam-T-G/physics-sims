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

export const CHAPTERS = ['Charge', 'Current', 'Resistors', 'Series', 'Parallel', 'Capacitors', 'Capacitor in a branch', 'Discharging'] as const

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
  const what = 'The branches act like a single resistor, <i>R</i><sub>P</sub>'
  if (!lanes) return `${what} = ${ohm(s.b.Rp)}.`
  const rs = lanes.map(id => ohmsOf(s, id))
  return `${what}: 1/<i>R</i><sub>P</sub> = ${rs.map(x => `1/(${exact(x)} Ω)`).join(' + ')}, so <i>R</i><sub>P</sub> = ${ohm(s.b.Rp)}${lanes.length > 1 ? ', smaller than the smallest branch' : ''}.`
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
  if (same(rp, rpBeforeRemove)) return `The branches' combined resistance is unchanged, so the voltage across R₂ stayed at ${V(v2)}.`
  const more = rp > rpBeforeRemove
  const share = isRes(s, 'R1') ? ` and take a ${more ? 'larger' : 'smaller'} share of the battery's ${V(s.emf)}` : ''
  const lead = `With one branch fewer, the branches together resist ${more ? 'more' : 'less'}${share}.`
  if (same(v2, v2BeforeRemove)) return `${lead} The voltage across R₂ stayed at ${V(v2)}.`
  const up = v2 > v2BeforeRemove
  const follows = up === (c.after > c.before) && !same(c.after, c.before)
  return `${lead} The voltage across R₂ ${up ? 'rose' : 'fell'} from ${V(v2BeforeRemove)} to ${V(v2)}${follows ? `, so R₂'s current ${up ? 'rose' : 'fell'} too` : ''}.`
}
const capInLead = (c: Ctx) => {
  const s = c.s
  if (capInAnswer(c) === 0) return `None: ${A(c.after)}, because the loop has another gap.`
  if (capInAnswer(c) === 2) return `Some, but less than with a wire: ${A(c.after)}, where a wire in R₅ would carry ${A(wireCurrent(s))}.`
  const terms = [`${exact(ohmsOf(s, 'R1'))} Ω`, ...(s.b.Rp > 0 ? [ohm(s.b.Rp)] : []), ...(s.r > 0 ? [`${exact(s.r)} Ω`] : [])]
  const sym = `<i>R</i>₁${s.b.Rp > 0 ? ' + <i>R</i><sub>P</sub>' : ''}${plusRSym(s)}`
  const f = terms.length > 1 ? `ε/(${sym}) = ${V(s.emf)} ÷ (${terms.join(' + ')})` : `ε/${sym} = ${V(s.emf)} ÷ ${terms[0]}`
  return `As much as a wire: <i>I</i> = ${f} = ${A(c.after)} at the start. An uncharged capacitor has no voltage opposing the battery, so at first the capacitor acts like a wire.`
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
  if (!(s.b.I > 0)) return [`No: the battery current is ${A(s.b.I)}. With the capacitor fully charged, nothing else completes the loop.`]
  if (!capBranchPlain(s)) return [`Yes: ${A(s.b.I)} keeps flowing. A fully charged capacitor acts like a gap, but the resistors in parallel with the capacitor provide another path.`]
  const sum = ohmsOf(s, 'R1') + ohmsOf(s, 'R2') + s.r
  const end = capBranchEnd(s)
  const ic = s.b.cap?.Ic ?? 0
  return [
    `Yes: ${A(end)} keeps flowing through R₁ and R₂. A fully charged capacitor acts like a gap, but R₂ provides a path around the gap.`,
    `With the capacitor fully charged, the circuit is R₁ and R₂ in series${s.r > 0 ? ' plus <i>r</i>' : ''}: <i>I</i> = ε/(<i>R</i>₁ + <i>R</i>₂${plusRSym(s)}) = ${V(s.emf)} ÷ ${ohmsText(sum)} Ω = ${A(end)}.`,
    ...(A(ic) !== A(0) ? [`At 5τ the capacitor still draws ${A(ic)}, so the battery current is slightly above ${A(end)}.`] : []),
  ]
}

// cap-cutoff: τ = R₂C only while R₂ is the capacitor's one path
const cutoffReveal = (c: Ctx): string[] => {
  const s = c.s
  if (c.after === 0) return [`No: the capacitor current is ${A(0)}. With R₁ gone, nothing completes a loop through the capacitor.`]
  const onlyR2 = isRes(s, 'R2') && !s.slots.R4 && !s.slots.R1
  const tau = sec(s.b.cap?.tau ?? 0)
  return [
    `Yes, for a while. The capacitor discharges through ${onlyR2 ? 'R₂' : 'the branches in parallel with the capacitor'}. The current starts at ${A(c.after)} and decays with ${onlyR2 ? `<i>τ</i> = <i>R</i>₂<i>C</i> = ${tau}` : `<i>τ</i> = ${tau}`}.`,
    'The minus sign means the current flows opposite to the charging current. With the battery cut off, the charged capacitor is the only source, so current flows until the capacitor is discharged.',
  ]
}

// discharge: the options compare with the charging current, so the answer keys off the sign of I₀
const DISCHARGE = ['The same way the charging current flowed', 'The opposite way', 'No current flows']
const dischargeAnswer = (c: Ctx) => (c.after < 0 ? 1 : c.after > 0 ? 0 : 2)
const dischargeReveal = (c: Ctx): string[] => {
  const s = c.s
  const k = dischargeAnswer(c)
  const lead = k === 1
    ? `The opposite way: the current starts at ${A(c.after)}. The charged capacitor is now the only source in the loop, so charge flows off the plates and around through R₁, opposite to the charging current.`
    : `${DISCHARGE[k]}: the current starts at ${A(c.after)}.`
  const r1Only = isRes(s, 'R1') && isWire(s, 'R2') && !s.slots.R3 && !s.slots.R4 && isCap(s, 'R5')
  const tau = `${r1Only ? '<i>R</i>₁<i>C</i>' : '<i>RC</i>'} = ${sec(s.b.cap?.tau ?? 0)}`
  return [lead, `The charge decays quickly at first, then more slowly, with <i>τ</i> = ${tau}. After 5<i>τ</i>, less than 1% of the charge remains.`]
}

export const STEPS: Step[] = [
  // ---------------- 1. Charge ----------------
  {
    id: 'charge', chapter: 0, title: 'Charge',
    cam: 'overview',
    setup: { emf: 12, r: 0, slots: {} },
    body: () => p(
      'Charge comes in two kinds, positive and negative. Like charges repel, and opposite charges attract. Charge is measured in coulombs (C).',
    ),
    reveal: () => p('Charge is conserved: charge moves from place to place, but the total amount never changes.'),
  },
  {
    id: 'push', chapter: 0, title: 'The battery and emf',
    cam: 'overview',
    camAfter: 'battery',
    setup: { emf: 12, r: 0, slots: {} },
    spot: { battery: true, slots: ['R1', 'R2', 'R3', 'R4', 'R5'] },
    body: () => p(
      'The battery has a + terminal and a − terminal. The battery\'s emf, <i>ε</i>, is the energy the battery gives each coulomb of charge: 12 V means 12 joules per coulomb.',
      'Moving yellow dots show the current.',
    ),
    predict: { q: 'All five slots on the board are empty. Will charge flow around the board?', options: ['Yes', 'No'], answer: c => (c.s.b.I > 0 ? 0 : 1) },
    freeze: {
      ask: [{ q: 'I', show: 'hide' }, { q: 'P', show: 'hide' }, { q: 'R', show: 'hide' }],
      hold: ['status', 'face', 'say:current', 'say:series', 'say:loop'],
    },
    reveal: c => p(
      `No. The battery current is ${A(c.s.b.I)}. Current needs a closed loop from the + terminal back to the − terminal, and each empty slot is a gap in that loop.`,
    ),
  },

  // ---------------- 2. Current ----------------
  {
    id: 'current', chapter: 1, title: 'Current',
    cam: 'loop',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: W } },
    body: s => p(
      'Current is the amount of charge passing a point each second. One ampere (A) is one coulomb per second.',
      `With a 4 Ω resistor in R₁ and wire in R₂ and R₅, the loop is closed and ${A(s.b.I)} flows.`,
    ),
    eqs: [{ tex: 'I = \\frac{\\Delta Q}{\\Delta t}' }],
    reveal: () => p(
      'By convention, current flows from the battery\'s + terminal, around the loop, to the − terminal.',
      'In a metal wire, the charges that actually move are electrons, which travel the opposite way. Both descriptions give the same results.',
    ),
  },
  {
    id: 'short', chapter: 1, title: 'A loop of wire',
    cam: 'loop',
    camAfter: 'battery',
    setup: { emf: 12, r: 0, slots: {} },
    spot: { slots: ['R1', 'R2', 'R5'], chips: ['wire'], hud: true, rows: ['current'] },
    body: () => p('Wire has 0 Ω on this board. The battery is ideal, with no internal resistance (<i>r</i> = 0).'),
    predict: { q: 'Fill R₁, R₂ and R₅ with wire. How large will the current be?', options: ['Small', 'Large but finite', 'Undefined'], answer: c => (c.s.b.idealShort ? 2 : 1) },
    freeze: { ask: [{ q: 'I', show: 'before' }] },
    task: {
      text: 'Put a wire in R₁, in R₂ and in R₅.',
      done: s => isWire(s, 'R1') && isWire(s, 'R5') && (['R2', 'R3', 'R4'] as SlotId[]).some(id => isWire(s, id)),
      auto: [{ place: 'R1', part: W }, { place: 'R2', part: W }, { place: 'R5', part: W }],
    },
    reveal: c => p(
      c.s.b.idealShort
        ? `Undefined. With 0 Ω in the whole loop, <i>I</i> = ε/<i>R</i> = ${V(c.s.emf)} ÷ 0 Ω, and dividing by zero does not give a number.`
        : `Large but finite: with only wire on the board, the internal resistance <i>r</i> = ${exact(c.s.r)} Ω is all that limits the current, so <i>I</i> = ε/<i>r</i> = ${V(c.s.emf)} ÷ ${exact(c.s.r)} Ω = ${A(c.s.b.I)}.`,
      'A real battery always has some internal resistance, which keeps the current finite.',
    ),
  },
  {
    id: 'real-battery', chapter: 1, title: 'A real battery',
    cam: 'battery',
    setup: { emf: 12, r: 0, slots: { R1: W, R2: W, R5: W } },
    spot: { battery: true, hud: true, rows: ['current', 'terminal'] },
    body: () => p('A real battery has internal resistance, <i>r</i>, in series with the rest of the loop.'),
    predict: { q: 'Raise r above 0 Ω. What will the battery current be?', options: ['Undefined', 'ε divided by r', '0 A'], answer: c => (c.s.b.idealShort ? 0 : c.s.b.I === 0 ? 2 : 1) },
    freeze: { ask: [{ q: 'I', show: 'before' }], hold: ['status', 'say:current'] },
    task: { text: 'Drag the r slider up from 0 Ω.', done: s => s.r > 0, auto: [{ r: 0.5 }] },
    liveReveal: true,
    reveal: c => p(
      `The current is ε/r = ${V(c.s.emf)} ÷ ${exact(c.s.r)} Ω = ${A(c.s.b.I)}. With only wire on the board, <i>r</i> is the only resistance in the loop. This is a <b>short circuit</b>, and a real battery heats up quickly in one.`,
      `The terminal voltage, the voltage across the battery's terminals, drops to ${V(c.s.b.Vt)}, because the whole ${V(c.s.emf)} drops across <i>r</i> inside the battery.`,
    ),
  },

  // ---------------- 3. Resistors ----------------
  {
    id: 'resistor', chapter: 2, title: 'Resistance',
    cam: 'R1',
    // a 4 Ω resistor in R₁, so the camera frames the bands the reveal reads (add-resistor sets its own board)
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    spot: { chips: ['2', '4', '6', '12'] },
    body: () => p(
      'A resistor limits current. Resistance <i>R</i>, measured in ohms (Ω), is the voltage needed to drive one ampere through a resistor.',
    ),
    eqs: [{ tex: 'R = \\frac{V}{I}' }],
    reveal: () => p('The color bands encode the resistance. On the 4 Ω resistor in R₁: yellow (4), black (0), then gold (divide by 10), so 40 ÷ 10 = 4 Ω. The last gold band is the tolerance: the true value is within 5% of 4 Ω.'),
  },
  {
    id: 'add-resistor', chapter: 2, title: 'Add a resistor',
    cam: 'R1',
    camAfter: 'loop-left',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0.5, slots: { R1: W, R2: W, R5: W } },
    spot: { slots: ['R1'], chips: ['4'], hud: true, rows: ['current'] },
    body: s => p(`A short circuit: wire in R₁, R₂ and R₅, with <i>r</i> = ${exact(s.r)} Ω inside the battery. The battery current is ${A(s.b.I)}.`),
    predict: { q: 'Swap the wire in R₁ for the 4 Ω resistor. What happens to the battery current?', options: upDownSame('The battery current'), answer: c => trend(c.before, c.after) },
    task: { text: 'Drag the 4 Ω resistor onto R₁ to replace the wire.', done: s => isRes(s, 'R1'), auto: [{ place: 'R1', part: R(4) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. The current now passes through R₁ as well as <i>r</i>: <i>I</i> = ε/(<i>R</i>₁ + <i>r</i>) = ${V(c.s.emf)} ÷ (${exact(ohmsOf(c.s, 'R1'))} Ω + ${exact(c.s.r)} Ω) = ${A(c.s.b.I)}.`,
    ),
  },
  {
    id: 'ohm', chapter: 2, title: 'Ohm\'s law',
    cam: 'R1',
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    keepIf: s => isRes(s, 'R1') && s.b.status === 'ok',
    spot: { slots: ['R1'], hud: true, rows: ['part'] },
    body: () => p('Each part on the board has its own current and voltage.'),
    task: { text: 'Tap R₁ on the board.', done: s => s.selected === 'R1', auto: [{ select: 'R1' }] },
    reveal: c => p(
      `R₁ carries ${A(slotI(c.s, 'R1'))} with ${V(slotV(c.s, 'R1'))} across R₁. Ohm's law relates the two: <i>V</i> = <i>IR</i> = (${factor(slotI(c.s, 'R1'), 'A', ohmsOf(c.s, 'R1'), slotV(c.s, 'R1'), 'V')})(${exact(ohmsOf(c.s, 'R1'))} Ω) = ${V(slotV(c.s, 'R1'))}.`,
    ),
  },
  {
    id: 'turn-up', chapter: 2, title: 'Turn R₁ up',
    cam: 'R1',
    camAfter: 'loop-left',
    readout: { label: 'Voltage across R₁', unit: 'V', kind: 'V' },
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    spot: { slots: ['R1'], hud: true, rows: ['part', 'terminal'] },
    body: () => p('A larger R₁ means a smaller current.'),
    predict: { q: 'Turn R₁\'s dial up to 20 Ω. What happens to the voltage across R₁?', options: upDownSame('The voltage across R₁'), answer: c => trend(c.before, c.after) },
    freeze: { ask: [{ q: 'V', at: 'R1', show: 'before' }], focus: 'R1', hold: ['say:terminal'] },
    task: { text: 'Tap R₁, then press + on R₁\'s dial until R₁ reads 20 Ω or more.', done: s => ohmsOf(s, 'R1') >= 20, auto: [{ dial: 'R1', value: 20 }] },
    measure: s => slotV(s, 'R1'),
    reveal: c => p(
      `The voltage across R₁ ${wentWord(c)}, from ${V(c.before)} to ${V(c.after)}, even though the current dropped to ${A(c.s.b.I)}.`,
      `The battery's ${V(c.s.emf)} is shared between R₁ and <i>r</i>. Less current means a smaller drop across <i>r</i> (<i>Ir</i>), so R₁ gets a larger share.`,
    ),
  },
  {
    id: 'heat', chapter: 2, title: 'Resistors produce heat',
    cam: 'R1',
    readout: { label: 'Power in R₁', unit: 'W', kind: 'P' },
    setup: { emf: 12, r: 0.5, slots: { R1: R(20), R2: W, R5: W } },
    keepIf: s => isRes(s, 'R1') && ohmsOf(s, 'R1') > 2 && s.r > 0 && s.r <= 0.5 && s.b.status === 'ok',
    spot: { slots: ['R1'], rows: ['part', 'energy'] },
    body: () => p('A resistor converts electrical energy into heat. Power <i>P</i> is the rate: the heat R₁ produces each second.'),
    eqs: [{ tex: 'P = I^2 R' }],
    predict: { q: 'Turn R₁ down to 2 Ω. Does R₁ produce heat faster or slower?', options: ['Faster', 'Slower', 'At the same rate'], answer: c => trend(c.before, c.after) },
    freeze: { ask: [{ q: 'P', at: 'R1', show: 'before' }], focus: 'R1' },
    task: { text: 'Use R₁\'s dial to bring R₁ down to 2 Ω or less.', done: s => isRes(s, 'R1') && ohmsOf(s, 'R1') <= 2, auto: [{ dial: 'R1', value: 2 }] },
    measure: s => s.b.slots.R1?.P ?? 0,
    reveal: c => p(
      `${['Faster', 'Slower', 'At the same rate'][trend(c.before, c.after)]}: R₁'s power ${wentWord(c)} from ${P(c.before)} to ${P(c.after)}. A smaller R lets much more current through, and power grows with the square of the current.`,
    ),
  },

  // ---------------- 4. Series ----------------
  {
    id: 'series', chapter: 3, title: 'Resistors in series',
    cam: 'series',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: W } },
    spot: { slots: ['R5'], chips: ['4'], hud: true, rows: ['series', 'current'] },
    body: s => p(`R₁ (4 Ω) is the only resistor, and the battery is ideal (<i>r</i> = 0). The battery current is ${A(s.b.I)}. Parts connected end to end, with one path through all of them, are <b>in series</b>.`),
    predict: { q: 'Put the 4 Ω resistor in R₅ too. What happens to the battery current?', options: upDownSame('The battery current'), answer: c => trend(c.before, c.after) },
    freeze: { hold: ['say:series', 'say:current'] },
    task: { text: 'Drag a resistor onto R₅.', done: s => isRes(s, 'R5'), auto: [{ place: 'R5', part: R(4) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. Resistances in series add, so the equivalent resistance is <i>R</i><sub>eq</sub> = ${exact(ohmsOf(c.s, 'R1'))} Ω${c.s.b.Rp > 0 ? ` + ${ohm(c.s.b.Rp)}` : ''} + ${exact(ohmsOf(c.s, 'R5'))} Ω = ${ohm(c.s.b.Req)}.`,
      c.s.r === 0 && c.s.b.Rp === 0 && ohmsOf(c.s, 'R1') === ohmsOf(c.s, 'R5') ? 'Twice the resistance, half the current.' : 'More total resistance, less current.',
    ),
  },
  {
    id: 'series-share', chapter: 3, title: 'Same current, shared voltage',
    cam: 'series',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: R(4) } },
    keepIf: s => isRes(s, 'R1') && isRes(s, 'R5') && s.b.status === 'ok' && s.r === 0 && s.b.Rp === 0,
    spot: { slots: ['R1', 'R5'], hud: true, rows: ['loop'] },
    body: () => p('In series there is only one path, so R₁ and R₅ carry the same current.'),
    task: { text: 'Tap R₅ to see R₅\'s readings.', done: s => s.selected === 'R5', auto: [{ select: 'R5' }] },
    reveal: c => p(
      `R₅ carries ${A(slotI(c.s, 'R5'))}, the same as R₁. The battery's ${V(c.s.emf)} divides between them: ${V(slotV(c.s, 'R1'))} across R₁${c.s.b.Rp > 0 ? ` plus ${V(c.s.b.I * c.s.b.Rp)} from B to C` : ''} plus ${V(slotV(c.s, 'R5'))} across R₅${c.s.r > 0 ? ` plus ${V(c.s.b.I * c.s.r)} across <i>r</i>` : ''} = ${V(c.s.emf)}.`,
      `Around the loop, the battery raises the voltage by ${V(c.s.emf)} and the parts drop the same total. This is the <b>loop rule</b>. A larger resistor takes a larger share.`,
    ),
  },
  {
    id: 'series-gap', chapter: 3, title: 'A gap in a series loop',
    cam: 'series',
    camAct: 'R1',
    camAfter: 'series',
    readout: { label: 'Current through R₅', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: R(4) } },
    spot: { slots: ['R1', 'R5'], hud: true, rows: ['loop'] },
    body: s => p(`R₁ and R₅ are in series, 4 Ω each. R₅ carries ${A(slotI(s, 'R5'))}.`),
    predict: { q: 'Take R₁ off the board. Will current still flow through R₅?', options: ['Yes, the same current', 'Yes, more current', 'No'], answer: c => (slotI(c.s, 'R5') === 0 ? 2 : slotI(c.s, 'R5') > c.before ? 1 : 0) },
    freeze: { ask: [{ q: 'I', at: 'R5', show: 'before' }] },
    task: { text: 'Drag R₁ off the board, or tap R₁ and press Remove R₁.', done: s => !s.slots.R1, auto: [{ remove: 'R1' }] },
    measure: s => slotI(s, 'R5'),
    reveal: c => p(
      `No. R₅ now carries ${A(slotI(c.s, 'R5'))}. A single gap in a series loop stops the current everywhere in the loop.`,
      `With no current, R₅ drops 0 V, so the full ${V(c.s.emf)} appears across the empty R₁ slot.`,
    ),
  },

  // ---------------- 5. Parallel ----------------
  {
    id: 'parallel', chapter: 4, title: 'Resistors in parallel',
    cam: 'parallel',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R5: W } },
    spot: { slots: ['R3'], chips: ['6'], hud: true, rows: ['parallel'] },
    body: s => p(`R₂, R₃ and R₄ sit side by side between junctions B and C, where the paths split and rejoin. Branches arranged this way are <b>in parallel</b>. Only R₂ (6 Ω) is filled, and the battery current is ${A(s.b.I)}.`),
    predict: { q: 'Add the 6 Ω resistor in R₃, next to R₂. What happens to the battery current?', options: upDownSame('The battery current'), answer: c => trend(c.before, c.after) },
    task: { text: 'Drag the 6 Ω resistor onto R₃.', done: s => isRes(s, 'R3'), auto: [{ place: 'R3', part: R(6) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}, even though a resistor was added. A second branch gives charge another path from B to C, so together the branches resist less than either one alone.`,
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
      'Every branch connects B to C, so every branch has the same voltage. The current divides among the branches.',
      `R₂ and R₃ are both ${exact(ohmsOf(s, 'R2'))} Ω, so each carries ${A(slotI(s, 'R2'))}.`,
    ),
    freeze: { ask: [{ q: 'I', at: 'R2', show: 'before' }, { q: 'I', at: 'R3', show: 'before' }] },
    predict: { q: 'Change R₃ to 2 Ω. Which branch will get more current?', options: ['R₂ (6 Ω)', 'R₃ (2 Ω)', 'They get the same'], answer: c => { const a = slotI(c.s, 'R2'), b = slotI(c.s, 'R3'); return Math.abs(a - b) < 1e-9 ? 2 : a > b ? 0 : 1 } },
    task: { text: 'Tap R₃, then use R₃\'s dial to set 2 Ω.', done: s => isRes(s, 'R3') && ohmsOf(s, 'R3') <= 2, auto: [{ dial: 'R3', value: 2 }] },
    reveal: c => p(
      `R₂ has ${V(slotV(c.s, 'R2'))} and ${A(slotI(c.s, 'R2'))}. R₃ has ${V(slotV(c.s, 'R3'))} and ${A(slotI(c.s, 'R3'))}. The voltage is the same, and the smaller resistor carries more current.`,
      `The current splits at B and rejoins at C: ${(['R2', 'R3', 'R4'] as SlotId[]).filter(id => c.s.slots[id]).map(id => A(slotI(c.s, id))).join(' + ')} = ${A(c.s.b.I)}. Charge is conserved at every junction, which is the <b>junction rule</b>.`,
    ),
  },
  {
    id: 'parallel-remove', chapter: 4, title: 'Remove a branch',
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
      now: s => (!s.slots.R3 && s.slots.R4 ? 'Remove R₄ too: R₄ is another branch in parallel with R₂. Drag R₄ off the board, or tap R₄ and press Remove R₄.' : null),
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
    predict: { q: 'Put a wire in R₄, in parallel with R₂ and R₃. What happens to the current through R₂ and R₃?', options: ['Nothing changes', 'Their current drops slightly', 'Their current drops to zero'], answer: c => (slotI(c.s, 'R2') === 0 ? 2 : slotI(c.s, 'R2') < c.before ? 1 : 0) },
    task: { text: 'Drag a wire onto R₄.', done: s => isWire(s, 'R4'), auto: [{ place: 'R4', part: W }] },
    measure: s => slotI(s, 'R2'),
    reveal: c => p(
      'Zero. The wire has 0 Ω, so the voltage from B to C drops to 0 V and all the current flows through the wire.',
      c.s.r > 0
        ? `Only R₁ and <i>r</i> now limit the battery current: <i>I</i> = ε/(<i>R</i>₁ + <i>r</i>) = ${V(c.s.emf)} ÷ (${exact(ohmsOf(c.s, 'R1'))} Ω + ${exact(c.s.r)} Ω) = ${A(c.s.b.I)}.`
        : `Only R₁ now limits the battery current: <i>I</i> = ε/<i>R</i>₁ = ${V(c.s.emf)} ÷ ${exact(ohmsOf(c.s, 'R1'))} Ω = ${A(c.s.b.I)}.`,
    ),
  },

  // ---------------- 6. Capacitors ----------------
  {
    id: 'capacitor', chapter: 5, title: 'Capacitors',
    cam: 'R5',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W }, batteryIn: true, capV: 0 },
    spot: { chips: ['cap'] },
    body: () => p(
      'A capacitor is two metal plates separated by a gap. Charge cannot cross the gap, so charge builds up instead: +<i>Q</i> on one plate and −<i>Q</i> on the other.',
      'Capacitance <i>C</i> is the charge stored per volt across the plates. One farad (F) is one coulomb per volt.',
    ),
    eqs: [{ tex: 'C = \\frac{Q}{V}' }],
    reveal: () => p('Most real capacitors range from picofarads to millifarads. The board uses 0.5 F so that charging takes a few seconds.'),
  },
  {
    id: 'cap-in', chapter: 5, title: 'Add an uncharged capacitor',
    cam: 'cap-R5',
    camAfter: 'series',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W }, batteryIn: true, capV: 0 },
    spot: { slots: ['R5'], chips: ['cap'], hud: true, time: true },
    body: () => p('R₅ is empty, so no current flows. The capacitor in the tray is uncharged: 0 V across the plates.'),
    // the battery current before the drop; right after the drop the same current is the capacitor's
    freeze: { ask: [{ q: 'I', show: 'before' }, { q: 'Ic', show: 'before' }], after: 'hold' },
    predict: { q: 'Place the uncharged capacitor in R₅. At that instant, how much current flows?', options: ['None, since charge cannot cross the gap', 'As much as if R₅ were a wire', 'Some, but less than with a wire'], answer: c => capInAnswer(c) },
    task: { text: 'Drag the capacitor onto R₅.', done: s => isCap(s, 'R5'), auto: [{ place: 'R5', part: CAP() }] },
    measure: s => s.rc?.I0 ?? s.b.I,
    reveal: c => p(
      capInLead(c),
      'No charge crosses the gap: charge flows onto one plate while an equal amount flows off the other.',
    ),
  },
  {
    id: 'cap-fill', chapter: 5, title: 'Charging a capacitor',
    cam: 'cap-R5',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP() }, batteryIn: true, capV: 0 },
    // kept from the last step only while the capacitor's curve starts empty (the step opens at t = 0 of that curve)
    keepIf: s => isCap(s, 'R5') && isRes(s, 'R1') && s.batteryIn && !full(s) && Math.abs(s.rc?.V0 ?? 1) < 1e-9,
    spot: { slots: ['R5'], hud: true, time: true },
    body: s => p(`The capacitor in R₅ starts uncharged and charges through R₁. The current is ${A(s.b.cap?.Ic ?? s.b.I)}, and the capacitor has ${V(s.b.cap?.Vc ?? 0)}.`),
    eqsAfter: [{ tex: 'I_C(t) = I_0\\,e^{-t/\\tau}, \\qquad \\tau = RC' }],
    predict: { q: 'When the capacitor is fully charged, how much current flows?', options: ['None', 'The same as at the start', 'Half of the starting current'], answer: c => (Math.abs(c.s.b.I) < 1e-2 * Math.abs(c.s.rc?.I0 ?? 1) ? 0 : 2) },
    freeze: { ask: [{ q: 'Ic', show: 'before' }], hold: ['say:rc-current', 'say:rc-tau'] },
    task: { text: 'Wait for the capacitor to charge fully. Press the 5× button to speed up the clock.', done: full, auto: [{ fill: true }], progress: fillProgress },
    reveal: c => p(
      'None, or very nearly none. In this single loop, the charged capacitor\'s voltage almost equals the emf, so almost no current flows.',
      `The current falls quickly at first, then more slowly. <i>I</i><sub>0</sub> is the starting current, ${A(c.s.rc?.I0 ?? 0)}. After one time constant <i>τ</i> (${sec(c.s.rc?.tau ?? 0)}) the current is 37% of <i>I</i><sub>0</sub>; after 5<i>τ</i> the current is under 1%. A fully charged capacitor acts like a gap.`,
    ),
  },
  {
    id: 'cap-slower', chapter: 5, title: 'Raise R₁ while charging',
    cam: 'cap-R5',
    camAfter: 'series',
    readout: { label: 'Time constant τ', unit: 's', kind: 'T' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP() }, batteryIn: true, capV: 0 },
    spot: { slots: ['R1'], hud: true, time: true, rows: ['rc-tau'] },
    body: s => p(`The capacitor starts uncharged and charges through R₁ = 4 Ω. The time constant is <i>τ</i> = ${sec(s.b.cap?.tau ?? 0)}.`),
    freeze: { hold: ['say:rc-tau'] },
    predict: { q: 'Raise R₁ to 12 Ω. How will the capacitor charge?', options: ['Faster', 'Slower', 'At the same speed'], answer: c => { const t = trend(c.before, c.after); return t === 0 ? 1 : t === 1 ? 0 : 2 } },
    task: { text: 'Tap R₁ and use R₁\'s dial to reach 12 Ω or more.', done: s => ohmsOf(s, 'R1') >= 12, auto: [{ dial: 'R1', value: 12 }] },
    measure: s => s.b.cap?.tau ?? 0,
    reveal: c => p(
      `${c.after > c.before ? 'Slower' : 'Faster'}: <i>τ</i> = <i>RC</i> went from ${sec(c.before)} to ${sec(c.after)}. More resistance means less current, so charge builds up on the plates more slowly.`,
      'The capacitor still charges to the battery\'s full emf. R changes how fast the capacitor charges, not the final voltage.',
    ),
  },
  {
    id: 'cap-dial', chapter: 5, title: 'Change C on a charged capacitor',
    cam: 'cap-R5',
    readout: { label: 'Capacitor voltage', unit: 'V', kind: 'V' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP(0.5) }, batteryIn: true, capV: 12 },
    spot: { slots: ['R5'], hud: true, time: true, done: { play: true } },
    body: s => p(`The capacitor is fully charged: ${V(s.b.cap?.Vc ?? 0)} across ${exact(s.b.cap?.C ?? 0)} F, holding <i>q</i> = <i>CV</i> = ${reading(s.b.cap?.q ?? 0, 'C')}.`),
    freeze: { ask: [{ q: 'Vc', show: 'before' }], after: 'hold' },
    predict: { q: 'Turn the capacitor\'s dial from 0.5 F up to 1 F. At that instant, what happens to the capacitor\'s voltage?', options: CAP_DIAL, answer: capDialAnswer },
    task: { text: 'Tap the capacitor and press + until the capacitor reads 1 F.', done: s => (s.b.cap?.C ?? 0) >= 1, auto: [{ dial: 'R5', value: 1 }] },
    measure: s => s.rc?.V0 ?? s.b.cap?.Vc ?? 0,
    reveal: c => p(
      `${CAP_DIAL[capDialAnswer(c)]}: from ${V(c.before)} to ${V(c.after)}. R₁ limits how fast charge can flow, so the charge on the plates cannot change in that instant. With <i>V</i> = <i>q</i>/<i>C</i>, the same charge on a larger <i>C</i> gives a lower voltage.`,
      'Press Play to let the battery recharge the capacitor.',
    ),
  },

  // ---------------- 7. A second path ----------------
  {
    id: 'cap-branch', chapter: 6, title: 'A capacitor in parallel with R₂',
    cam: 'cap-R3',
    camAfter: 'parallel-wide',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 0 },
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    spot: { slots: ['R3'], hud: true, time: true },
    body: () => p('The uncharged capacitor sits in R₃, in parallel with R₂ (6 Ω). R₁ = 2 Ω is in series with both.'),
    predict: { q: 'Once the capacitor is fully charged, does current still flow through the battery?', options: ['Yes', 'No'], answer: c => (c.s.b.I > 0 ? 0 : 1) },
    // the next step asks where the capacitor ends up, so every voltage (and the charge, q = CV) stays covered
    freeze: { ask: [], carry: [{ q: 'V', at: 'all' }, { q: 'q' }] },
    task: { text: 'Wait for the capacitor to charge fully.', done: full, auto: [{ fill: true }], progress: fillProgress },
    measure: capBranchMeasure,
    reveal: c => p(
      ...capBranchReveal(c),
    ),
  },
  {
    id: 'cap-branch-v', chapter: 6, title: 'The voltage of a branch capacitor',
    cam: 'cap-R3',
    // no keepIf: the capacitor's curve loops, so the board left by the last step may be partway through a replay;
    // this step reads V_C, so it always starts from its own full capacitor (the setup only changes what differs)
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R3'] },
    body: () => p('The capacitor in R₃ is fully charged. R₂ (6 Ω) is in parallel with the capacitor, and R₁ = 2 Ω is in series with both.'),
    predict: {
      q: 'What voltage does this capacitor charge to?',
      options: ['12 V', '9 V', '3 V', '0 V'],
      answer: c => { const v = c.s.b.cap?.Vc ?? 0; const at = [12, 9, 3, 0].map(x => Math.abs(v - x)); return at.indexOf(Math.min(...at)) },
    },
    freeze: { ask: [{ q: 'V', at: 'all', show: 'hide' }, { q: 'q', show: 'hide' }] },
    reveal: c => p(
      `${V(c.s.b.cap?.Vc ?? 0)}. The capacitor is in parallel with R₂, so the capacitor ends at R₂'s voltage: <i>V</i>₂ = <i>IR</i>₂ = (${factor(slotI(c.s, 'R2'), 'A', ohmsOf(c.s, 'R2'), slotV(c.s, 'R2'), 'V')})(${exact(ohmsOf(c.s, 'R2'))} Ω) = ${V(slotV(c.s, 'R2'))}.`,
      `The other ${V(slotV(c.s, 'R1'))} drops across R₁. A capacitor charges to the voltage between the two points the capacitor connects, here B and C, which is not always the emf.`,
    ),
  },
  {
    id: 'cap-branch-tau', chapter: 6, title: 'Which R goes in τ = RC?',
    cam: 'parallel-wide',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    keepIf: s => isCap(s, 'R3') && isRes(s, 'R1') && isRes(s, 'R2') && s.r === 0 && !s.slots.R4 && isWire(s, 'R5') && s.b.status === 'ok',
    spot: { hud: true, rows: ['rc-tau'] },
    body: s => p(
      'The R in <i>τ</i> = <i>RC</i> is the resistance the capacitor\'s charge flows through: R₂, or R₁ and the battery. These two paths are in parallel:',
      `<i>R</i> = (1/(${exact(ohmsOf(s, 'R1'))} Ω${plusR(s)}) + 1/(${exact(ohmsOf(s, 'R2'))} Ω))<sup>−1</sup> = ${ohm(s.b.cap?.Rth ?? NaN)}, so <i>τ</i> = (${factor(s.b.cap?.Rth ?? NaN, 'Ω', s.b.cap?.C ?? 0, s.b.cap?.tau ?? 0, 's')})(${exact(s.b.cap?.C ?? 0)} F) = ${sec(s.b.cap?.tau ?? 0)}.`,
    ),
    reveal: () => p('In general: set the battery\'s ε to 0, keep <i>r</i>, and find the resistance the capacitor\'s charge flows through.'),
  },
  {
    id: 'cap-cutoff', chapter: 6, title: 'Cut off the battery',
    cam: 'parallel-wide',
    camAfter: 'cap-R3',
    readout: { label: 'Capacitor current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R1', 'R3'], hud: true, time: true, done: { slots: ['R2'] } },
    body: s => p(`The capacitor is fully charged at ${V(s.b.cap?.Vc ?? 0)}, in parallel with R₂.`),
    freeze: { ask: [{ q: 'Ic', show: 'before' }] },
    predict: { q: 'Take R₁ off the board. The battery is cut off. Will any current flow?', options: ['No, the circuit is open', 'Yes, for a while'], answer: c => (c.after !== 0 ? 1 : 0) },
    task: { text: 'Remove R₁: drag R₁ off the board, or tap R₁ and press Remove R₁.', done: s => !s.slots.R1, auto: [{ remove: 'R1' }] },
    measure: s => s.rc?.I0 ?? 0,
    reveal: c => p(
      ...cutoffReveal(c),
    ),
  },
  {
    id: 'cap-shorted', chapter: 6, title: 'A wire across the capacitor',
    cam: 'branches',
    camAfter: 'branches',
    readout: { label: 'Charge on the capacitor', unit: 'C', kind: 'Q' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R3', 'R4'], chips: ['wire'], hud: true, time: true },
    body: s => p(`The capacitor is fully charged, holding ${reading(s.b.cap?.q ?? 0, 'C')} at ${V(s.b.cap?.Vc ?? 0)}.`),
    freeze: { ask: [] },
    predict: { q: 'Put a wire in R₄, in parallel with the charged capacitor. What happens to the capacitor\'s charge?', options: ['The capacitor keeps the charge', 'The capacitor discharges slowly', 'The capacitor discharges instantly'], answer: c => (c.after === 0 ? 2 : c.after < c.before ? 1 : 0) },
    task: { text: 'Drag a wire onto R₄.', done: s => isWire(s, 'R4'), auto: [{ place: 'R4', part: W }] },
    measure: s => s.b.cap?.q ?? 0,
    reveal: c => p(
      c.after === 0
        ? 'The capacitor discharges instantly. The wire connects the two plates with 0 Ω, so the charge flows straight through the wire.'
        : `The capacitor now holds ${reading(c.after, 'C')}, down from ${reading(c.before, 'C')}.`,
      `The wire carries all ${A(c.s.b.I)} of the battery current, so R₂ gets ${A(slotI(c.s, 'R2'))} and the capacitor ends with ${reading(c.s.b.cap?.q ?? 0, 'C')}.`,
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
    body: s => p(`The capacitor in R₅ is fully charged at ${V(s.b.cap?.Vc ?? 0)}, in series with R₁ = ${exact(ohmsOf(s, 'R1'))} Ω. With the battery switched out, a wire takes the battery's place.`),
    freeze: { ask: [{ q: 'Ic', show: 'before' }] },
    predict: { q: 'Switch the battery out. Compared with the charging current, which way will the current flow?', options: DISCHARGE, answer: dischargeAnswer },
    task: { text: 'Press "Discharge: battery out".', done: s => !s.batteryIn, auto: [{ battery: false }] },
    measure: s => s.rc?.I0 ?? 0,
    reveal: c => p(
      ...dischargeReveal(c),
    ),
  },
  {
    id: 'done', chapter: 7, title: 'The rules behind every number',
    cam: 'overview',
    body: () => p(
      'Charge is conserved, so the current into a junction equals the current out (junction rule). Around any closed loop, the total voltage rise equals the total voltage drop (loop rule). Resistors set how much current flows; capacitors store charge and, with resistance, set how quickly currents change (<i>τ</i> = <i>RC</i>).',
      'Every number on the board follows from these two rules together with <i>V</i> = <i>IR</i>, <i>P</i> = <i>I</i><sup>2</sup><i>R</i> and <i>q</i> = <i>CV</i>.',
    ),
  },
]
