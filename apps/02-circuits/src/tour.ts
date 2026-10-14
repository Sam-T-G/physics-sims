// The guided tour: what each step says, what it sets up, what it asks, and how it knows the student did it.
// Pure data plus small functions of the board state; guide.ts runs it and sim.ts carries out the actions.
// Every fact cites the OpenStax page it came from (University Physics Vol 2, printed page numbers).

import type { BoardResult, Part, Slots, SlotId } from './board'
import type { CameraShot } from './scene'
import { reading, sig3, exact } from './format'

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
export type GuideState = { emf: number; r: number; slots: Slots; batteryIn: boolean; b: BoardResult; rc: RcView | null; selected: SlotId | null }
export type Spot = { slots?: SlotId[]; chips?: string[]; hud?: boolean; battery?: boolean; time?: boolean; rows?: string[] }
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
  R1: { x: -2.65, z: -2.0, span: 3.4, az: -0.25, el: 0.85 },
  series: { x: 0, z: 0, span: 11, az: 0.3, el: 1.12 },
  R5: { x: 4.3, z: 0, span: 4.0, az: 0.55, el: 0.8 },
  'cap-R5': { x: 4.4, z: 0, span: 3.6, az: 0.6, el: 0.8 },
  parallel: { x: 1.1, z: -0.55, span: 5.0, az: 0.12, el: 1.05 },
  'parallel-wide': { x: 0.1, z: -0.8, span: 7.2, az: -0.1, el: 1.0 },
  branches: { x: 1.1, z: 0.25, span: 4.2, az: 0.2, el: 0.9 },
  'cap-R3': { x: 1.1, z: -1.3, span: 4.0, az: -0.2, el: 0.85 },
} satisfies Record<string, CameraShot>
export type ShotName = keyof typeof SHOTS | 'overview'

/** The number a step measures, shown before → after in the reveal, styled like the HUD tile of that quantity. */
export type Readout = { label: string; unit: 'A' | 'V' | 'W' | 's' | 'C'; kind: 'I' | 'V' | 'P' | 'T' | 'Q' }

export type Eq = { tex: string | ((s: GuideState) => string); ref: string }
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
  readout?: Readout
  predict?: { q: string; options: string[]; answer: (c: Ctx) => number }
  task?: { text: string; done: (s: GuideState) => boolean; auto: Action[]; progress?: (s: GuideState) => number }
  /** The number this step is about, read once when the step starts and again when the task is done. */
  measure?: (s: GuideState) => number
  reveal?: (c: Ctx) => string
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
const UP_DOWN_SAME = ['It goes up', 'It goes down', 'It stays the same']
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

export const STEPS: Step[] = [
  // ---------------- 1. Charge ----------------
  {
    id: 'charge', chapter: 0, title: 'Everything starts with charge',
    cam: 'overview',
    setup: { emf: 12, r: 0, slots: {} },
    body: () => p(
      'Charge is a property of matter, like mass. It comes in two types, positive and negative. Two charges of the same type push each other apart, and opposite types pull together.',
      'Charge is measured in coulombs (C). Every charge is a whole number of the smallest possible charge, <i>e</i>:',
    ),
    eqs: [{ tex: 'e = 1.602 \\times 10^{-19}\\,\\text{C}', ref: 'Section 5.1, p. 173' }],
    reveal: () => p('Charge is also conserved: charge moves from place to place, but the total amount never changes. Keep charge conservation in mind: the junction rule in chapter 5 is the same idea.'),
  },
  {
    id: 'push', chapter: 0, title: 'The battery pushes charge',
    cam: 'battery',
    camAfter: 'overview',
    setup: { emf: 12, r: 0, slots: {} },
    spot: { battery: true, hud: true, slots: ['R1', 'R2', 'R3', 'R4', 'R5'] },
    body: () => p(
      'The battery on the left has a + end and a − end. The battery voltage, <i>ε</i> (the emf), says how hard the battery pushes charge around a loop. Right now ε is 12 V.',
      'When charge flows, yellow dots move along the wires to show the current. With no current, the dots fade into the wire color and stop.',
    ),
    predict: { q: 'All five slots on the board are empty. Will charge flow around the board?', options: ['Yes, the battery pushes the charge around', 'No'], answer: c => (c.s.b.I > 0 ? 0 : 1) },
    reveal: c => p(
      `No. The battery current is ${A(c.s.b.I)} and no yellow dots move. Charge needs a complete path from the battery's + end, through the circuit, and back to the − end (p. 365).`,
      'Every empty slot is a gap in that path. Next, let\'s close the loop.',
    ),
  },

  // ---------------- 2. Current ----------------
  {
    id: 'current', chapter: 1, title: 'Current is charge per second',
    cam: 'loop',
    setup: { emf: 12, r: 0, slots: {} },
    body: () => p(
      'Current is how much charge passes a point each second. One amp (A) is one coulomb of charge per second.',
    ),
    eqs: [{ tex: 'I = \\frac{\\Delta Q}{\\Delta t}, \\qquad 1\\,\\text{A} = 1\\,\\frac{\\text{C}}{\\text{s}}', ref: 'Eq 9.1, 9.2, p. 362' }],
    reveal: () => p(
      'The dots move the way <b>conventional current</b> goes: out of the battery\'s + end and back into the − end (p. 365).',
      'In a metal wire, the charges that actually move are electrons, which are negative and travel the other way (p. 173). As long as we stay consistent, the math comes out the same, so we\'ll follow the + to − direction like the book.',
    ),
  },
  {
    id: 'short', chapter: 1, title: 'A loop of plain wire',
    cam: 'loop',
    camAfter: 'battery',
    setup: { emf: 12, r: 0, slots: {} },
    spot: { slots: ['R1', 'R2', 'R5'], chips: ['wire'], hud: true, rows: ['current'] },
    body: () => p('Plain wire has 0 Ω of resistance, so a wire adds nothing that slows charge down. Right now the battery is perfect: its internal resistance <i>r</i> is 0.'),
    predict: { q: 'Fill R₁, R₂ and R₅ with plain wire. How big will the current be?', options: ['Small', 'Large, but some set number', 'There\'s no limit'], answer: c => (c.s.b.idealShort ? 2 : 1) },
    task: {
      text: 'Put a wire in R₁, in R₂ and in R₅.',
      done: s => isWire(s, 'R1') && isWire(s, 'R5') && (['R2', 'R3', 'R4'] as SlotId[]).some(id => isWire(s, id)),
      auto: [{ place: 'R1', part: W }, { place: 'R2', part: W }, { place: 'R5', part: W }],
    },
    reveal: () => p(
      'There\'s no limit. With only wire in the loop and <i>r</i> = 0, the battery current equation divides by zero: ε/(0 Ω + 0 Ω). The battery\'s face looks worried.',
      'No real battery is perfect. Every battery has some resistance inside it, and that\'s what we\'ll add next.',
    ),
  },
  {
    id: 'real-battery', chapter: 1, title: 'A real battery',
    cam: 'battery',
    setup: { emf: 12, r: 0, slots: { R1: W, R2: W, R5: W } },
    spot: { battery: true, hud: true, rows: ['current', 'terminal'] },
    body: () => p('The battery\'s internal resistance, <i>r</i>, sits inside the battery, in series with everything you connect to the battery (Section 10.1).'),
    predict: { q: 'Raise r above 0 Ω. What will the battery current be?', options: ['Still no limit', 'ε divided by r', '0 A'], answer: c => (c.s.b.idealShort ? 0 : c.s.b.I === 0 ? 2 : 1) },
    task: { text: 'Drag the r slider (the battery\'s internal resistance) up from 0 Ω.', done: s => s.r > 0, auto: [{ r: 0.5 }] },
    reveal: c => p(
      `The current is ε/r = ${V(c.s.emf)} ÷ ${exact(c.s.r)} Ω = ${A(c.s.b.I)}. The only resistance in the loop is inside the battery, so <i>r</i> alone sets the current. That's a <b>short circuit</b>. A real battery and real wires get hot fast this way.`,
      `The battery's terminal voltage drops to ${V(c.s.b.Vt)}: ε − <i>Ir</i> = 0, because all of the push gets used up inside the battery (Eq 10.1).`,
    ),
  },

  // ---------------- 3. Resistors ----------------
  {
    id: 'resistor', chapter: 2, title: 'What a resistor is',
    cam: 'R1',
    spot: { chips: ['2', '4', '6', '12'] },
    body: () => p(
      'A resistor limits the current (p. 376). Resistance <i>R</i> says how many volts it takes to push one amp through the resistor. One ohm (Ω) is one volt per amp (p. 372).',
      'What sets <i>R</i> is the resistor\'s material and shape: a longer resistor has more resistance, and a thicker one has less. <i>ρ</i> (rho) is the material\'s resistivity, <i>L</i> the length and <i>A</i> the cross-sectional area.',
    ),
    eqs: [
      { tex: 'R = \\frac{V}{I}, \\qquad 1\\,\\Omega = 1\\,\\frac{\\text{V}}{\\text{A}}', ref: 'Eq 9.9, p. 376; p. 372' },
      { tex: 'R = \\rho\\,\\frac{L}{A}', ref: 'Eq 9.9, p. 376' },
    ],
    reveal: () => p('The colored bands on each resistor spell out its value. On the 4 Ω resistor: yellow (4), black (0), and a gold band that means divide by 10. That gives 40 ÷ 10 = 4 Ω.'),
  },
  {
    id: 'add-resistor', chapter: 2, title: 'Add a resistor',
    cam: 'R1',
    camAfter: 'loop-left',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0.5, slots: { R1: W, R2: W, R5: W } },
    spot: { slots: ['R1'], chips: ['4'], hud: true, rows: ['current'] },
    body: s => p(`The board is a short circuit again: wire everywhere, with <i>r</i> = ${exact(s.r)} Ω inside the battery. The battery current is ${A(s.b.I)}.`),
    predict: { q: 'Swap the wire in R₁ for the 4 Ω resistor. What happens to the battery current?', options: UP_DOWN_SAME, answer: c => trend(c.before, c.after) },
    task: { text: 'Drag the 4 Ω resistor onto R₁. The wire in R₁ pops off.', done: s => isRes(s, 'R1'), auto: [{ place: 'R1', part: R(4) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. Now the charge has to get through R₁ as well as <i>r</i>:`,
      `<i>I</i> = ε/(<i>R</i>₁ + <i>r</i>) = ${V(c.s.emf)} ÷ (${exact(ohmsOf(c.s, 'R1'))} Ω + ${exact(c.s.r)} Ω) = ${A(c.s.b.I)}.`,
    ),
  },
  {
    id: 'ohm', chapter: 2, title: 'Ohm\'s law on one resistor',
    cam: 'R1',
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    keepIf: s => isRes(s, 'R1') && s.b.status === 'ok',
    spot: { slots: ['R1'], hud: true, rows: ['part'] },
    body: () => p('The readouts at the top show the whole circuit. Tap R₁ on the board and the readouts switch to R₁ alone.'),
    task: { text: 'Tap R₁ on the board.', done: s => s.selected === 'R1', auto: [{ select: 'R1' }] },
    reveal: c => p(
      `R₁ has ${A(slotI(c.s, 'R1'))} through R₁ and ${V(slotV(c.s, 'R1'))} across R₁. Ohm's law says those two always go together (Eq 9.11):`,
      `<i>V</i> = <i>IR</i> = (${A(slotI(c.s, 'R1'))})(${exact(ohmsOf(c.s, 'R1'))} Ω) = ${V(slotV(c.s, 'R1'))}.`,
    ),
  },
  {
    id: 'turn-up', chapter: 2, title: 'Turn R₁ up',
    cam: 'R1',
    camAfter: 'loop-left',
    readout: { label: 'Voltage across R₁', unit: 'V', kind: 'V' },
    setup: { emf: 12, r: 0.5, slots: { R1: R(4), R2: W, R5: W } },
    spot: { slots: ['R1'], hud: true, rows: ['part', 'terminal'] },
    body: () => p('A bigger R₁ means a smaller current. That part is expected. Here\'s a trickier one.'),
    predict: { q: 'Turn R₁\'s dial up to 20 Ω. What happens to the voltage across R₁?', options: UP_DOWN_SAME, answer: c => trend(c.before, c.after) },
    task: { text: 'Tap R₁, then press + on R₁\'s dial until R₁ reads 20 Ω or more.', done: s => ohmsOf(s, 'R1') >= 20, auto: [{ dial: 'R1', value: 20 }] },
    measure: s => slotV(s, 'R1'),
    reveal: c => p(
      `The voltage across R₁ ${wentWord(c)}, from ${V(c.before)} to ${V(c.after)}, even though the current fell to ${A(c.s.b.I)}.`,
      `The battery's push gets shared between R₁ and <i>r</i>. With less current, less voltage is used up inside the battery (<i>Ir</i> = ${V(c.s.b.I * c.s.r)}), so R₁ gets a bigger share: <i>V</i>₁ = ε − <i>Ir</i>.`,
    ),
  },
  {
    id: 'heat', chapter: 2, title: 'Resistors make heat',
    cam: 'R1',
    readout: { label: 'Heat in R₁', unit: 'W', kind: 'P' },
    setup: { emf: 12, r: 0.5, slots: { R1: R(20), R2: W, R5: W } },
    keepIf: s => isRes(s, 'R1') && ohmsOf(s, 'R1') > 2 && s.r > 0 && s.r <= 0.5 && s.b.status === 'ok',
    spot: { slots: ['R1'], rows: ['part', 'energy'] },
    body: () => p('Every resistor turns electrical energy into heat. On the board, a resistor glows pinker as its power goes up.'),
    eqs: [{ tex: 'P = I^2 R', ref: 'Eq 9.13, p. 386' }],
    predict: { q: 'Turn R₁ back down to 2 Ω. Does R₁ make more heat or less?', options: ['More heat', 'Less heat', 'The same'], answer: c => trend(c.before, c.after) },
    task: { text: 'Use R₁\'s dial to bring R₁ down to 2 Ω or less.', done: s => isRes(s, 'R1') && ohmsOf(s, 'R1') <= 2, auto: [{ dial: 'R1', value: 2 }] },
    measure: s => s.b.slots.R1?.P ?? 0,
    reveal: c => p(
      `${c.after > c.before ? 'More' : 'Less'}: R₁'s power ${wentWord(c)} from ${P(c.before)} to ${P(c.after)}. A smaller R lets much more current through, and the power grows with the current squared.`,
      `The battery puts out <i>I</i>ε = ${P(c.s.b.Pemf)}. That always equals the heat in <i>r</i> plus the heat in every resistor (Power balance, Eq 9.12, 9.13).`,
    ),
  },

  // ---------------- 4. Series ----------------
  {
    id: 'series', chapter: 3, title: 'Two resistors in a row',
    cam: 'series',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: W } },
    spot: { slots: ['R5'], chips: ['4'], hud: true, rows: ['series', 'current'] },
    body: s => p(`R₁ (4 Ω) is the only resistor, and the battery current is ${A(s.b.I)}. Parts in a row like this, with one path through all of them, are <b>in series</b>.`),
    predict: { q: 'Put the 4 Ω resistor in R₅ too. What happens to the battery current?', options: UP_DOWN_SAME, answer: c => trend(c.before, c.after) },
    task: { text: 'Drag a resistor onto R₅.', done: s => isRes(s, 'R5'), auto: [{ place: 'R5', part: R(4) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. Resistances in series add (Eq 10.2): <i>R</i><sub>eq</sub> = ${exact(ohmsOf(c.s, 'R1'))} Ω + ${exact(ohmsOf(c.s, 'R5'))} Ω = ${ohm(c.s.b.Req)}.`,
      ohmsOf(c.s, 'R1') === ohmsOf(c.s, 'R5') ? 'Twice the resistance, half the current.' : 'More total resistance, less current.',
    ),
  },
  {
    id: 'series-share', chapter: 3, title: 'Same current, shared voltage',
    cam: 'series',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: R(4) } },
    keepIf: s => isRes(s, 'R1') && isRes(s, 'R5') && s.b.status === 'ok' && s.r === 0,
    spot: { slots: ['R1', 'R5'], hud: true, rows: ['loop'] },
    body: () => p('In series there\'s only one path, so the same current has to go through R₁ and through R₅.'),
    task: { text: 'Tap R₅ to see R₅\'s readouts.', done: s => s.selected === 'R5', auto: [{ select: 'R5' }] },
    reveal: c => p(
      `R₅ carries ${A(slotI(c.s, 'R5'))}, the same as R₁. The battery's voltage gets split between them: ${V(slotV(c.s, 'R1'))} across R₁ plus ${V(slotV(c.s, 'R5'))} across R₅ = ${V(c.s.emf)}.`,
      'Going around the loop, the battery raises the voltage by ε and the resistors lower the voltage by the same total. That\'s the loop rule (Eq 10.5). A bigger resistor takes a bigger share.',
    ),
  },
  {
    id: 'series-gap', chapter: 3, title: 'Take one out',
    cam: 'R1',
    camAfter: 'series',
    readout: { label: 'Current through R₅', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: R(4) } },
    spot: { slots: ['R1', 'R5'], hud: true, rows: ['loop'] },
    body: () => p('Here are R₁ and R₅ in series again, 4 Ω each.'),
    predict: { q: 'Take R₁ off the board. Will current still flow through R₅?', options: ['Yes, the same current', 'Yes, more current', 'No'], answer: c => (slotI(c.s, 'R5') === 0 ? 2 : slotI(c.s, 'R5') > c.before ? 1 : 0) },
    task: { text: 'Drag R₁ off the board, or tap R₁ and press Remove R₁.', done: s => !s.slots.R1, auto: [{ remove: 'R1' }] },
    measure: s => slotI(s, 'R5'),
    reveal: c => p(
      `No. R₅ now carries ${A(slotI(c.s, 'R5'))}. One gap anywhere in a series loop stops the current everywhere in the loop.`,
      `With no current, R₅ uses up none of the voltage, so the battery's full ${V(c.s.emf)} sits across the empty R₁ slot (loop rule).`,
    ),
  },

  // ---------------- 5. Parallel ----------------
  {
    id: 'parallel', chapter: 4, title: 'Two paths side by side',
    cam: 'parallel',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R5: W } },
    spot: { slots: ['R3'], chips: ['6'], hud: true, rows: ['parallel', 'series'] },
    body: s => p(`R₂, R₃ and R₄ sit side by side between junctions B and C. Branches like these are <b>in parallel</b>: charge can take any filled branch. Right now only R₂ (6 Ω) is filled, and the battery current is ${A(s.b.I)}.`),
    predict: { q: 'Add the 6 Ω resistor in R₃, next to R₂. What happens to the battery current?', options: UP_DOWN_SAME, answer: c => trend(c.before, c.after) },
    task: { text: 'Drag the 6 Ω resistor onto R₃.', done: s => isRes(s, 'R3'), auto: [{ place: 'R3', part: R(6) }] },
    measure: s => s.b.I,
    reveal: c => p(
      `The battery current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}. A lot of people expect it to go down, since you added a resistor.`,
      `But a second branch gives the charge one more way to get from B to C. Together the branches resist less than either one alone (Eq 10.3): <i>R</i><sub>P</sub> = ${ohm(c.s.b.Rp)}, smaller than the smallest branch.`,
    ),
  },
  {
    id: 'parallel-split', chapter: 4, title: 'Same voltage, split current',
    cam: 'parallel',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: R(6), R5: W } },
    keepIf: s => isRes(s, 'R2') && isRes(s, 'R3') && ohmsOf(s, 'R2') === ohmsOf(s, 'R3') && s.b.status === 'ok' && s.b.bypassed.length === 0,
    spot: { slots: ['R2', 'R3'], rows: ['parallel', 'junction'] },
    body: () => p('Every branch connects B to C, so every branch has the same voltage across it. The current splits between the branches.'),
    predict: { q: 'Change R₃ to 2 Ω. Which branch will get more current?', options: ['R₂ (6 Ω)', 'R₃ (2 Ω)', 'They get the same'], answer: c => { const a = slotI(c.s, 'R2'), b = slotI(c.s, 'R3'); return Math.abs(a - b) < 1e-9 ? 2 : a > b ? 0 : 1 } },
    task: { text: 'Tap R₃, then use R₃\'s dial to set 2 Ω.', done: s => isRes(s, 'R3') && ohmsOf(s, 'R3') <= 2, auto: [{ dial: 'R3', value: 2 }] },
    reveal: c => p(
      `R₂ has ${V(slotV(c.s, 'R2'))} and ${A(slotI(c.s, 'R2'))}. R₃ has ${V(slotV(c.s, 'R3'))} and ${A(slotI(c.s, 'R3'))}. Same voltage, and the smaller resistor gets more current.`,
      `At junction B the current splits, and at C the current joins back up: ${A(slotI(c.s, 'R2'))} + ${A(slotI(c.s, 'R3'))} = ${A(c.s.b.I)}. Charge isn't lost or made at a junction. That's the junction rule (Eq 10.4), which is charge conservation from chapter 1.`,
    ),
  },
  {
    id: 'parallel-remove', chapter: 4, title: 'Take a branch away',
    cam: 'parallel',
    camAfter: 'parallel-wide',
    readout: { label: 'Current through R₂', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: R(2), R5: W } },
    spot: { slots: ['R2', 'R3'], hud: true, rows: ['parallel', 'loop'] },
    body: s => p(`R₁ = 2 Ω in series, then R₂ = 6 Ω and R₃ = 2 Ω in parallel. R₂ carries ${A(slotI(s, 'R2'))}.`),
    predict: { q: 'Take R₃ off the board. What happens to the current through R₂?', options: UP_DOWN_SAME, answer: c => trend(c.before, c.after) },
    task: { text: 'Remove R₃: drag R₃ off the board, or tap R₃ and press Remove R₃.', done: s => !s.slots.R3, auto: [{ remove: 'R3' }] },
    measure: s => slotI(s, 'R2'),
    reveal: c => p(
      `R₂'s current ${wentWord(c)}, from ${A(c.before)} to ${A(c.after)}, even though the battery current went down to ${A(c.s.b.I)}.`,
      `Without R₃, the parallel part resists more (<i>R</i><sub>P</sub> = ${ohm(c.s.b.Rp)}), so the parallel part takes a bigger share of the battery's 12 V and R₁ takes less. The voltage across R₂ rose to ${V(slotV(c.s, 'R2'))}, so R₂'s current rose too.`,
    ),
  },
  {
    id: 'parallel-wire', chapter: 4, title: 'A wire in a branch',
    cam: 'branches',
    camAfter: 'parallel',
    readout: { label: 'Current through R₂', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: R(6), R5: W } },
    spot: { slots: ['R4'], chips: ['wire'], hud: true, rows: ['parallel', 'junction'] },
    body: s => p(`R₂ and R₃ (6 Ω each) are in parallel. Each carries ${A(slotI(s, 'R2'))}.`),
    predict: { q: 'Put a plain wire in R₄, beside R₂ and R₃. What happens to the current through R₂ and R₃?', options: ['Nothing changes', 'Their current goes down a bit', 'Their current drops to zero'], answer: c => (slotI(c.s, 'R2') === 0 ? 2 : slotI(c.s, 'R2') < c.before ? 1 : 0) },
    task: { text: 'Drag a wire onto R₄.', done: s => isWire(s, 'R4'), auto: [{ place: 'R4', part: W }] },
    measure: s => slotI(s, 'R2'),
    reveal: c => p(
      `Zero. The wire has 0 Ω, so the voltage across B to C drops to 0 V and no current goes through R₂ or R₃. All of the current takes the wire. <i>R</i><sub>P</sub> is 0 Ω.`,
      `Now only R₁ limits the battery current: <i>I</i> = ε/<i>R</i>₁ = ${V(c.s.emf)} ÷ ${exact(ohmsOf(c.s, 'R1'))} Ω = ${A(c.s.b.I)}.`,
    ),
  },

  // ---------------- 6. Capacitors ----------------
  {
    id: 'capacitor', chapter: 5, title: 'What a capacitor is',
    cam: 'R5',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W }, batteryIn: true, capV: 0 },
    spot: { chips: ['cap'] },
    body: () => p(
      'A capacitor is two metal plates with a gap between them. Charge can\'t cross the gap. Instead, charge piles up: one plate collects +<i>Q</i> and the other plate is left with −<i>Q</i>.',
      'Capacitance <i>C</i> says how much charge the capacitor stores for each volt across the plates. One farad (F) is one coulomb per volt.',
    ),
    eqs: [{ tex: 'C = \\frac{Q}{V}, \\qquad 1\\,\\text{F} = 1\\,\\frac{\\text{C}}{\\text{V}}', ref: 'Eq 8.1, p. 325' }],
    reveal: () => p(
      'Real capacitors are usually picofarads to millifarads, and 1 F is very large (p. 325). The sim uses 0.5 F so you can watch the capacitor fill over a few seconds.',
      'One of the first capacitors was the Leyden jar: a glass jar with metal foil inside and out (p. 172).',
    ),
  },
  {
    id: 'cap-in', chapter: 5, title: 'Drop in an empty capacitor',
    cam: 'R5',
    camAfter: 'series',
    readout: { label: 'Battery current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W }, batteryIn: true, capV: 0 },
    spot: { slots: ['R5'], chips: ['cap'], hud: true, time: true },
    body: () => p('R₅ is empty, so the circuit is open and no current flows. The capacitor in the tray is empty: 0 V across the plates.'),
    predict: { q: 'Drop the empty capacitor into R₅. Right when the capacitor lands, how much current flows?', options: ['None, since charge can\'t cross the gap', 'As much as if R₅ were a plain wire', 'Some, but less than with a wire'], answer: c => (c.after === 0 ? 0 : Math.abs(c.after - c.s.emf / ohmsOf(c.s, 'R1')) < 1e-3 * c.after ? 1 : 2) },
    task: { text: 'Drag the capacitor onto R₅.', done: s => isCap(s, 'R5'), auto: [{ place: 'R5', part: CAP() }] },
    measure: s => s.rc?.I0 ?? s.b.I,
    reveal: c => p(
      `As much as a wire: ${A(c.after)} = ε/<i>R</i>₁ at the start. An empty capacitor has no voltage pushing back yet, so at first the current flows as if the capacitor were a wire (Eq 10.10 at <i>t</i> = 0).`,
      'No charge crosses the gap. Charge flows onto one plate and the same amount flows off the other plate, so the current is the same on both sides of the capacitor.',
    ),
  },
  {
    id: 'cap-fill', chapter: 5, title: 'Watch the capacitor fill',
    cam: 'cap-R5',
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP() }, batteryIn: true, capV: 0 },
    keepIf: s => isCap(s, 'R5') && isRes(s, 'R1') && s.batteryIn && !full(s),
    spot: { slots: ['R5'], hud: true, time: true, rows: ['rc-current', 'rc-tau'] },
    body: () => p('As charge piles up, the capacitor\'s voltage <i>V</i><sub>C</sub> grows and pushes back against the battery, so the current fades. The time constant <i>τ</i> = <i>RC</i> sets how fast.'),
    eqs: [{ tex: 'I(t) = I_0\\,e^{-t/\\tau}, \\qquad \\tau = RC', ref: 'Eq 10.9, 10.10, pp. 441–442' }],
    predict: { q: 'When the capacitor is full, how much current flows?', options: ['None', 'The same as at the start', 'Half of the starting current'], answer: c => (Math.abs(c.s.b.I) < 1e-2 * Math.abs(c.s.rc?.I0 ?? 1) ? 0 : 2) },
    task: { text: 'Wait for the capacitor to fill (5τ). The 5× button in "Current over time" speeds up the clock.', done: full, auto: [{ fill: true }], progress: fillProgress },
    reveal: c => p(
      `None, or very close. The full capacitor holds <i>V</i><sub>C</sub> = ${V(c.s.b.cap?.Vc ?? 0)}, the battery's full ε, and pushes back just as hard as the battery pushes.`,
      `After one <i>τ</i> (${sec(c.s.rc?.tau ?? 0)}) the current was 37% of where the current started. After 5<i>τ</i> the current is under 1%. A full capacitor acts like a gap.`,
    ),
  },
  {
    id: 'cap-slower', chapter: 5, title: 'More resistance, slower filling',
    cam: 'loop-left',
    camAfter: 'cap-R5',
    readout: { label: 'Time constant τ', unit: 's', kind: 'T' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP() }, batteryIn: true, capV: 0 },
    spot: { slots: ['R1'], hud: true, time: true, rows: ['rc-tau'] },
    body: s => p(`The capacitor is empty again and filling through R₁ = 4 Ω. Right now <i>τ</i> = ${sec(s.b.cap?.tau ?? 0)}.`),
    predict: { q: 'Turn R₁ up to 12 Ω. How will the capacitor fill?', options: ['Faster', 'Slower', 'At the same speed'], answer: c => { const t = trend(c.before, c.after); return t === 0 ? 1 : t === 1 ? 0 : 2 } },
    task: { text: 'Tap R₁ and use R₁\'s dial to reach 12 Ω or more.', done: s => ohmsOf(s, 'R1') >= 12, auto: [{ dial: 'R1', value: 12 }] },
    measure: s => s.b.cap?.tau ?? 0,
    reveal: c => p(
      `${c.after > c.before ? 'Slower' : 'Faster'}: <i>τ</i> = <i>RC</i> went from ${sec(c.before)} to ${sec(c.after)}. More resistance means less current, so charge piles onto the plates more slowly.`,
      'The capacitor still ends at the battery\'s full ε. R changes how fast the capacitor fills, not where the capacitor ends up.',
    ),
  },
  {
    id: 'cap-dial', chapter: 5, title: 'Change C on a full capacitor',
    cam: 'cap-R5',
    readout: { label: 'Capacitor voltage', unit: 'V', kind: 'V' },
    setup: { emf: 12, r: 0, slots: { R1: R(4), R2: W, R5: CAP(0.5) }, batteryIn: true, capV: 12 },
    spot: { slots: ['R5'], hud: true, time: true },
    body: s => p(`The capacitor is full: ${V(s.b.cap?.Vc ?? 0)} across 0.5 F, holding <i>Q</i> = <i>CV</i> = ${reading(s.b.cap?.q ?? 0, 'C')}.`),
    predict: { q: 'Turn the capacitor\'s dial from 0.5 F up to 1 F. Right then, what happens to the capacitor\'s voltage?', options: ['It doubles', 'It halves', 'It stays at 12 V'], answer: c => (c.after > c.before * 1.5 ? 0 : c.after < c.before * 0.75 ? 1 : 2) },
    task: { text: 'Tap the capacitor and press + until the capacitor reads 1 F.', done: s => (s.b.cap?.C ?? 0) >= 1, auto: [{ dial: 'R5', value: 1 }] },
    measure: s => s.rc?.V0 ?? s.b.cap?.Vc ?? 0,
    reveal: c => p(
      `${c.after < c.before * 0.75 ? 'It halves' : c.after > c.before * 1.5 ? 'It grows' : 'It barely changes'}: from ${V(c.before)} to ${V(c.after)}. Charge can't jump on or off the plates in an instant, and <i>V</i> = <i>Q</i>/<i>C</i>. The same charge on a bigger capacitance means a smaller voltage.`,
      'Now the battery pushes more charge on until the capacitor is back at ε. Watch the current jump up and fade again.',
    ),
  },

  // ---------------- 7. A second path ----------------
  {
    id: 'cap-branch', chapter: 6, title: 'A capacitor beside a resistor',
    cam: 'cap-R3',
    camAfter: 'parallel-wide',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 0 },
    spot: { slots: ['R2', 'R3'], hud: true, time: true },
    body: () => p('The empty capacitor sits in R₃, in parallel with R₂ (6 Ω). R₁ = 2 Ω is in series with both.'),
    predict: { q: 'Once the capacitor is full, will the battery still push current around the board?', options: ['Yes, through R₂', 'No, everything stops'], answer: c => (c.s.b.I > 0 ? 0 : 1) },
    task: { text: 'Wait for the capacitor to fill (5τ).', done: full, auto: [{ fill: true }], progress: fillProgress },
    reveal: c => p(
      `Yes: ${A(c.s.b.I)} keeps flowing through R₁ and R₂. The full capacitor acts like a gap, but R₂ is a second path around the gap.`,
      `With the capacitor full, the circuit is just R₁ and R₂ in series: <i>I</i> = ε/(<i>R</i>₁ + <i>R</i>₂) = ${V(c.s.emf)} ÷ ${exact(ohmsOf(c.s, 'R1') + ohmsOf(c.s, 'R2'))} Ω = ${A(c.s.b.I)}.`,
    ),
  },
  {
    id: 'cap-branch-v', chapter: 6, title: 'How full is full?',
    cam: 'cap-R3',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    keepIf: s => isCap(s, 'R3') && isRes(s, 'R1') && isRes(s, 'R2') && full(s),
    spot: { slots: ['R2', 'R3'], hud: true },
    body: () => p('In chapter 6 the full capacitor ended at the battery\'s full 12 V. This capacitor is in a different spot.'),
    predict: {
      q: 'What voltage did this capacitor end up at?',
      options: ['12 V, the battery\'s full ε', '9 V, the same as R₂', '0 V'],
      answer: c => { const v = c.s.b.cap?.Vc ?? 0; return Math.abs(v - c.s.emf) < 0.05 ? 0 : Math.abs(v) < 0.05 ? 2 : 1 },
    },
    reveal: c => p(
      `${V(c.s.b.cap?.Vc ?? 0)}. The capacitor sits across B and C, right beside R₂, so the capacitor ends at R₂'s voltage: <i>V</i>₂ = <i>IR</i>₂ = (${A(slotI(c.s, 'R2'))})(${exact(ohmsOf(c.s, 'R2'))} Ω) = ${V(slotV(c.s, 'R2'))}.`,
      `R₁ uses up the other ${V(slotV(c.s, 'R1'))}. A capacitor fills to the voltage across its own two ends, which isn't always ε.`,
    ),
  },
  {
    id: 'cap-branch-tau', chapter: 6, title: 'Which R goes in τ = RC?',
    cam: 'parallel-wide',
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    keepIf: s => isCap(s, 'R3') && isRes(s, 'R1') && isRes(s, 'R2') && s.b.status === 'ok',
    spot: { hud: true, rows: ['rc-tau'] },
    body: s => p(
      'Here, the R in <i>τ</i> = <i>RC</i> isn\'t R₁ + R₂. The capacitor\'s charge can flow through R₂, or back around through R₁ and the battery. Those are two paths side by side, so R is R₁ and R₂ in parallel:',
      `<i>R</i> = (1/${exact(ohmsOf(s, 'R1'))} Ω + 1/${exact(ohmsOf(s, 'R2'))} Ω)<sup>−1</sup> = ${ohm(s.b.cap?.Rth ?? NaN)}, so <i>τ</i> = (${ohm(s.b.cap?.Rth ?? NaN)})(${exact(s.b.cap?.C ?? 0)} F) = ${sec(s.b.cap?.tau ?? 0)}.`,
    ),
    reveal: () => p('The Resistance tile in the readouts shows this R whenever a capacitor is on the board. To find R, imagine turning the battery\'s push off and ask what resistance the capacitor\'s charge would flow through.'),
  },
  {
    id: 'cap-cutoff', chapter: 6, title: 'Cut the battery off',
    cam: 'parallel-wide',
    camAfter: 'cap-R3',
    readout: { label: 'Capacitor current', unit: 'A', kind: 'I' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R1', 'R2', 'R3'], hud: true, time: true },
    body: () => p('The capacitor is full at 9 V, beside R₂.'),
    predict: { q: 'Take R₁ off the board. The battery is cut off. Will any current flow?', options: ['No, the circuit is open', 'Yes, for a while'], answer: c => (c.after !== 0 ? 1 : 0) },
    task: { text: 'Remove R₁: drag R₁ off the board, or tap R₁ and press Remove R₁.', done: s => !s.slots.R1, auto: [{ remove: 'R1' }] },
    measure: s => s.rc?.I0 ?? 0,
    reveal: c => p(
      `Yes. The capacitor empties through R₂, in a small loop of its own. The current starts at ${A(c.after)} and fades with <i>τ</i> = <i>R</i>₂<i>C</i> = ${sec(c.s.b.cap?.tau ?? 0)}.`,
      'The minus sign means the current through the capacitor runs backward: charge is flowing off the plates now. The battery is cut off, but the capacitor is a small battery of its own until the capacitor runs empty.',
    ),
  },
  {
    id: 'cap-shorted', chapter: 6, title: 'A wire beside the capacitor',
    cam: 'branches',
    camAfter: 'cap-R3',
    readout: { label: 'Charge on the capacitor', unit: 'C', kind: 'Q' },
    setup: { emf: 12, r: 0, slots: { R1: R(2), R2: R(6), R3: CAP(), R5: W }, batteryIn: true, capV: 9 },
    spot: { slots: ['R3', 'R4'], chips: ['wire'], hud: true, time: true },
    body: s => p(`The capacitor is full again, holding ${reading(s.b.cap?.q ?? 0, 'C')} at ${V(s.b.cap?.Vc ?? 0)}.`),
    predict: { q: 'Put a plain wire in R₄, beside the full capacitor. What happens to the capacitor\'s charge?', options: ['The charge stays', 'The charge drains slowly', 'The charge is gone at once'], answer: c => (c.after === 0 ? 2 : c.after < c.before ? 1 : 0) },
    task: { text: 'Drag a wire onto R₄.', done: s => isWire(s, 'R4'), auto: [{ place: 'R4', part: W }] },
    measure: s => s.b.cap?.q ?? 0,
    reveal: c => p(
      'The charge is gone at once. The wire joins the two plates with 0 Ω, so <i>τ</i> = <i>RC</i> is 0 and the charge rushes straight through the wire.',
      `R₂ gets ${A(slotI(c.s, 'R2'))} too: the wire takes all of the battery current, ${A(c.s.b.I)}.`,
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
    body: () => p('The capacitor in R₅ is full at 12 V, in series with R₁ = 4 Ω. "Discharge: battery out" in the Current over time box swaps the battery for a plain wire.'),
    predict: { q: 'Switch the battery out. Which way will the current flow?', options: ['The same way as before', 'The opposite way', 'It won\'t flow'], answer: c => (c.after < 0 ? 1 : c.after > 0 ? 0 : 2) },
    task: { text: 'Press "Discharge: battery out" in the Current over time box.', done: s => !s.batteryIn, auto: [{ battery: false }] },
    measure: s => s.rc?.I0 ?? 0,
    reveal: c => p(
      `The opposite way: the current starts at ${A(c.after)}. The full capacitor is now the only push in the loop, so charge flows back off the plates, through R₁, the other way around (Eq 10.12).`,
      `The charge falls as <i>q</i> = <i>Q</i>e<sup>−t/τ</sup> (Eq 10.11), with <i>τ</i> = <i>R</i>₁<i>C</i> = ${sec(c.s.b.cap?.tau ?? 0)}. After 5<i>τ</i> the capacitor is empty.`,
    ),
  },
  {
    id: 'done', chapter: 7, title: 'You built it all from charge',
    cam: 'overview',
    body: () => p(
      'Charge is conserved, so current that flows into a junction flows out (junction rule). Voltage goes up across the battery and down across the parts, adding to zero around a loop (loop rule). Resistors set how much current flows, and capacitors store charge and set how fast the current changes.',
      'Every number on this board comes from those rules. Now try your own circuits: every equation in the notebook updates as you build.',
    ),
  },
]
