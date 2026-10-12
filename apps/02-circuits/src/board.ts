// The circuit board: where the slots and wires are, and how a filled board becomes numbers.
// Layer 1 for this app: pure TypeScript, no Three.js, no DOM, no Motion.
//
//   + ──[ R₁ ]──B──[ R₂ ]──C── TR
//   |            ├─[ R₃ ]──┤    |
//  bat           └─[ R₄ ]──┘  [ R₅ ]
//   |                            |
//   − ─────────────────────────── BR
//
// R₁ and R₅ are in series with everything; R₂, R₃, R₄ are the parallel branches. The numbering matches
// OpenStax Example 10.4 (R₁ in series with R₂ ∥ R₃), so the book's preset reads the same as the page.

import {
  solveCircuit,
  seriesResistance,
  parallelResistance,
  batteryCurrent,
  terminalVoltage,
  type CircuitElement,
} from '@lib/physics'

export type SlotId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5'
export const SLOT_IDS: readonly SlotId[] = ['R1', 'R2', 'R3', 'R4', 'R5']
export const LANES: readonly SlotId[] = ['R2', 'R3', 'R4']

export type Part = { kind: 'resistor'; ohms: number } | { kind: 'wire' } | { kind: 'capacitor'; farads: number }
export type Slots = Partial<Record<SlotId, Part>>
export type BoardInput = {
  emf: number
  r: number
  slots: Slots
  /** Voltage on the capacitor right now, from its slot's a end to its b end (V). Ignored with no capacitor. */
  capV?: number
  /** false: the battery is switched out and a plain wire takes its place (the book's discharge circuit). */
  batteryIn?: boolean
}

/** A fixed wire carries current in the model, so it is a resistor this small. Changes no printed digit. */
export const WIRE_OHMS = 1e-7

/** Resistor values a student can dial (Ω). Includes every value the book presets need. */
export const OHM_STEPS: readonly number[] = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 13, 15, 20, 30, 50, 100]
/** Capacitor values (F). Big, supercapacitor-sized, so τ = RC lands in seconds you can watch. */
export const FARAD_STEPS: readonly number[] = [0.05, 0.1, 0.2, 0.5, 1, 2, 5]

// Board coordinates: x to the right, z toward the viewer (down the screen), in scene units.
export type Pt = { x: number; z: number }
const TOP = -2.1
const MID = -0.55
const LOW = 1.0
const BOT = 2.1
const LEFT = -4.6
const RIGHT = 4.6
const BX = -0.55
const CX = 2.75

/** Node 0 is the battery's − terminal (ground); node 1 sits between the ideal emf and r; node 2 is +. */
export const NODES: readonly (Pt | null)[] = [
  { x: LEFT, z: 0.85 }, // 0 battery −
  null, // 1 inside the battery
  { x: LEFT, z: -0.85 }, // 2 battery +
  { x: LEFT, z: TOP }, // 3 top-left corner
  { x: -3.55, z: TOP }, // 4 R₁ left
  { x: -1.75, z: TOP }, // 5 R₁ right
  { x: BX, z: TOP }, // 6 junction B, top
  { x: BX, z: MID }, // 7 B, middle
  { x: BX, z: LOW }, // 8 B, low
  { x: 0.2, z: TOP }, // 9 R₂ left
  { x: 2.0, z: TOP }, // 10 R₂ right
  { x: 0.2, z: MID }, // 11 R₃ left
  { x: 2.0, z: MID }, // 12 R₃ right
  { x: 0.2, z: LOW }, // 13 R₄ left
  { x: 2.0, z: LOW }, // 14 R₄ right
  { x: CX, z: TOP }, // 15 junction C, top
  { x: CX, z: MID }, // 16 C, middle
  { x: CX, z: LOW }, // 17 C, low
  { x: RIGHT, z: TOP }, // 18 top-right corner
  { x: RIGHT, z: -0.9 }, // 19 R₅ top
  { x: RIGHT, z: 0.9 }, // 20 R₅ bottom
  { x: RIGHT, z: BOT }, // 21 bottom-right corner
  { x: LEFT, z: BOT }, // 22 bottom-left corner
]
export const NODE_COUNT = NODES.length

/** Fixed wire segments, each written in the direction conventional current takes when it flows. */
export const WIRES: readonly (readonly [number, number])[] = [
  [2, 3], [3, 4], [5, 6],
  [6, 9], [6, 7], [7, 11], [7, 8], [8, 13],
  [10, 15], [12, 16], [16, 15], [14, 17], [17, 16],
  [15, 18], [18, 19], [20, 21], [21, 22], [22, 0],
]

export type SlotGeom = { a: number; b: number; center: Pt; vertical: boolean; series: boolean }
const mid = (a: number, b: number): Pt => {
  const p = NODES[a]!, q = NODES[b]!
  return { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }
}
export const SLOTS: Readonly<Record<SlotId, SlotGeom>> = {
  R1: { a: 4, b: 5, center: mid(4, 5), vertical: false, series: true },
  R2: { a: 9, b: 10, center: mid(9, 10), vertical: false, series: false },
  R3: { a: 11, b: 12, center: mid(11, 12), vertical: false, series: false },
  R4: { a: 13, b: 14, center: mid(13, 14), vertical: false, series: false },
  R5: { a: 19, b: 20, center: mid(19, 20), vertical: true, series: true },
}
export const SLOT_LENGTH = 1.8
export const BATTERY_CENTER: Pt = { x: LEFT, z: 0 }

export type SlotReading = { I: number; V: number; P: number }
export type Check = { id: string; eq: string; label: string; ok: boolean }

export type BoardResult = {
  /** ok: current flows. open: a gap somewhere stops it. short: nothing but wire from + to −. */
  status: 'ok' | 'open' | 'short'
  /** An ideal battery (r = 0) on a dead short: the current has no finite answer. */
  idealShort: boolean
  /** Empty series slots, or 'lanes' when every parallel branch is empty. */
  gaps: (SlotId | 'lanes')[]
  /** Resistors in a branch next to a wire branch: the wire takes all the current. */
  bypassed: SlotId[]
  emf: number
  r: number
  /** Eq 10.3 over the filled branches (Infinity when none). */
  Rp: number
  /** Eq 10.2: R₁ + R_P + R₅, the load the battery sees. */
  Req: number
  /** Battery current, I = ε/(R_eq + r). */
  I: number
  /** Eq 10.1. */
  Vt: number
  /** Battery power out (Eq 9.12, Iε), lost inside (I²r), delivered to the load. */
  Pemf: number
  Pr: number
  Pload: number
  /** Per filled slot: current through it (A), voltage across it (V), power (W). Wires read 0 V, 0 W. */
  slots: Partial<Record<SlotId, SlotReading>>
  /** Current along each fixed wire in WIRES order, positive in the written direction. 0 on an ideal short. */
  wireI: Float64Array
  /** Node potentials relative to the − terminal (V). */
  V: Float64Array
  /** Voltage across the parallel set, B to C (V). */
  Vp: number
  /** Fixed wires that carry no current because their branch is bypassed (for the dots on an ideal short). */
  deadWire: Uint8Array
  checks: Check[]
  /** The battery is switched out (a wire in its place). */
  batteryOut: boolean
  /** Present when a capacitor is on the board. */
  cap?: CapReading
}

export type CapReading = {
  id: SlotId
  /** Capacitance (F). */
  C: number
  /** Voltage across it now, a end to b end (V), and charge q = CV (Eq 8.1). */
  Vc: number
  q: number
  /** Current into its a end right now (A): positive while it charges up toward Voc. */
  Ic: number
  /** The voltage it is heading for: what it would read with no current through it (V). */
  Voc: number
  /** The resistance it sees, with the battery's push set to zero (Ω). Infinity if nothing connects it. */
  Rth: number
  /** Eq 10.9, τ = RC with R = Rth (s). */
  tau: number
  /** τ was too short to watch (a plain wire across it), so it jumped straight to Voc. The app adopts Vc. */
  snapped: boolean
}

/** Below this τ a capacitor empties or fills in a blink (a plain wire across it): jump straight to the end. */
export const INSTANT_TAU = 1e-4

/** Steady-state resistance: a capacitor passes no current once it is full, so it counts as a gap. */
const ohmsOf = (p: Part): number => (p.kind === 'wire' ? 0 : p.kind === 'capacitor' ? Infinity : p.ohms)
const modelOhms = (p: Part): number => (p.kind === 'wire' ? WIRE_OHMS : p.kind === 'resistor' ? p.ohms : Infinity)
export const capSlot = (slots: Slots): SlotId | undefined => SLOT_IDS.find(id => slots[id]?.kind === 'capacitor')

/**
 * Below these a solved current or voltage is a 0.1 µΩ wire artifact; the exact answer is 0. Scaled to the
 * battery current and emf, because the leak through a stand-in grows with them (48 A across 0.3 µΩ is 14 µV).
 * The smallest real reading on this board is far above them: a 100 Ω branch beside a 0.5 Ω one still gets
 * 5e-3 of the current.
 */
const REL_ZERO = 1e-5
const clean = (x: number, eps: number) => (Math.abs(x) < eps ? 0 : x)

/** The fixed stubs that belong to each branch (indices into WIRES). */
const LANE_WIRES: Record<string, number[]> = { R2: [3, 8], R3: [5, 9], R4: [7, 11] }

export function solveBoard(input: BoardInput): BoardResult {
  const out = input.batteryIn === false
  // Switched out: no push, and a plain wire where the battery was (so no r either).
  const emf = out ? 0 : input.emf
  const r = out ? 0 : input.r
  const { slots } = input
  if (capSlot(slots)) return solveRC({ ...input, emf, r, batteryIn: !out })
  const filledLanes = LANES.filter(id => slots[id])
  const gaps: (SlotId | 'lanes')[] = []
  if (!slots.R1) gaps.push('R1')
  if (filledLanes.length === 0) gaps.push('lanes')
  if (!slots.R5) gaps.push('R5')

  // The book's closed forms (Eq 10.2, 10.3, and 10.1's I = ε/(R + r)).
  const Rp = parallelResistance(filledLanes.map(id => ohmsOf(slots[id]!)))
  const Req = seriesResistance(
    gaps.length ? [Infinity] : [ohmsOf(slots.R1!), Rp, ohmsOf(slots.R5!)],
  )
  const status: BoardResult['status'] = gaps.length ? 'open' : Req === 0 ? 'short' : 'ok'
  const idealShort = status === 'short' && r === 0
  const I = batteryCurrent(emf, Req, r)
  const Vt = idealShort ? NaN : clean(terminalVoltage(emf, I, r), REL_ZERO * Math.max(1, emf))

  const hasWireLane = filledLanes.some(id => slots[id]!.kind === 'wire')
  const bypassed = hasWireLane ? filledLanes.filter(id => slots[id]!.kind === 'resistor') : []

  // The full solve: Kirchhoff's junction rule at every node of the real board.
  const els: CircuitElement[] = [
    { kind: 'source', a: 0, b: 1, emf },
    { kind: 'resistor', a: 1, b: 2, R: Math.max(r, WIRE_OHMS) },
  ]
  for (const [a, b] of WIRES) els.push({ kind: 'resistor', a, b, R: WIRE_OHMS })
  const slotIndex: Partial<Record<SlotId, number>> = {}
  for (const id of SLOT_IDS) {
    const part = slots[id]
    if (!part) continue
    slotIndex[id] = els.length
    els.push({ kind: 'resistor', a: SLOTS[id].a, b: SLOTS[id].b, R: modelOhms(part) })
  }

  const wireI = new Float64Array(WIRES.length)
  const deadWire = new Uint8Array(WIRES.length)
  // a branch carries current only if it is filled and not bypassed; so do the connectors that feed it
  const live = (id: SlotId) => !!slots[id] && !bypassed.includes(id)
  for (const id of LANES) if (!live(id)) for (const k of LANE_WIRES[id]!) deadWire[k] = 1
  if (!live('R3') && !live('R4')) { deadWire[4] = 1; deadWire[10] = 1 }
  if (!live('R4')) { deadWire[6] = 1; deadWire[12] = 1 }
  const V = new Float64Array(NODE_COUNT)
  const readings: Partial<Record<SlotId, SlotReading>> = {}
  let solveI = 0
  let solveVt = emf

  if (idealShort) {
    // No finite answer exists. Report it instead of printing a million amps from the 0.1 µΩ stand-ins.
    for (const id of SLOT_IDS) if (slots[id]) readings[id] = { I: bypassed.includes(id) ? 0 : Infinity, V: 0, P: 0 }
    return {
      status, idealShort, gaps, bypassed, emf, r, Rp, Req, I: Infinity, Vt, Pemf: Infinity, Pr: 0, Pload: Infinity,
      slots: readings, wireI, V, Vp: 0, deadWire, checks: [], batteryOut: out,
    }
  }

  const sol = solveCircuit(NODE_COUNT, els)
  let Vp = 0
  if (sol.ok) {
    const zeroI = REL_ZERO * Math.max(1, Math.abs(sol.I[0]!))
    const zeroV = REL_ZERO * Math.max(1, emf)
    solveI = clean(sol.I[0]!, zeroI)
    for (let k = 0; k < NODE_COUNT; k++) V[k] = clean(sol.V[k]!, zeroV)
    solveVt = V[2]! - V[0]!
    Vp = clean(V[6]! - V[15]!, zeroV)
    WIRES.forEach((_, k) => { wireI[k] = deadWire[k] ? 0 : clean(sol.I[2 + k]!, zeroI) })
    for (const id of SLOT_IDS) {
      const k = slotIndex[id]
      if (k === undefined) continue
      const part = slots[id]!
      // a resistor beside a wire branch carries exactly 0 (Eq 10.3 with a 0 Ω branch); say so exactly
      const dead = bypassed.includes(id)
      const Ik = dead ? 0 : clean(sol.I[k]!, zeroI)
      const Vk = part.kind === 'wire' || dead ? 0 : clean(V[SLOTS[id].a]! - V[SLOTS[id].b]!, zeroV)
      readings[id] = { I: Ik, V: Vk, P: part.kind === 'resistor' ? Ik * Ik * part.ohms : 0 }
    }
  }

  const Pemf = I * emf
  const Pr = I * I * r
  const Pload = clean(Pemf - Pr, REL_ZERO * Math.max(1, Pemf))

  // Book check: each rule from the book against the full solve's numbers.
  const close = (a: number, b: number) =>
    Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b))
  // Voltages are compared on the battery's scale: on a dead short the 0.1 µΩ stand-ins hold a few
  // tenths of a millivolt where the book's ideal wire holds exactly 0.
  const closeV = (a: number, b: number) => Math.abs(a - b) <= 1e-4 * Math.max(1, emf)
  const checks: Check[] = []
  if (status !== 'open') {
    const read = (id: SlotId) => readings[id]
    checks.push({ id: 'current', eq: '10.1', label: 'I = ε/(R_eq + r) matches the full solve', ok: close(I, solveI) })
    checks.push({ id: 'terminal', eq: '10.1', label: 'V_terminal = ε − Ir', ok: closeV(Vt, solveVt) })
    checks.push({
      id: 'series',
      eq: '10.2',
      label: 'R₁ and R₅ carry the same current',
      ok: close(read('R1')!.I, solveI) && close(read('R5')!.I, solveI),
    })
    const laneVs = filledLanes.map(id => V[SLOTS[id].a]! - V[SLOTS[id].b]!)
    checks.push({
      id: 'parallel',
      eq: '10.3',
      label: 'every branch has the same voltage across it',
      ok: laneVs.every(v => closeV(v, laneVs[0]!)),
    })
    const laneSum = filledLanes.reduce((s, id) => s + read(id)!.I, 0)
    checks.push({ id: 'junction', eq: '10.4', label: 'current into B = current out of B', ok: close(laneSum, solveI) })
    // One loop: up through the battery, then down R₁, across the parallel set (B to C), down R₅.
    const loop = emf - I * r - read('R1')!.V - Vp - read('R5')!.V
    checks.push({ id: 'loop', eq: '10.5', label: 'ε − Ir − V₁ − V_P − V₅ = 0', ok: closeV(loop, 0) })
    const heat = SLOT_IDS.reduce((s, id) => s + (readings[id]?.P ?? 0), 0) + Pr
    checks.push({ id: 'energy', eq: '9.12, 9.13', label: 'battery power Iε = I²r + every I²R', ok: close(Pemf, heat) })
  }

  return { status, idealShort, gaps, bypassed, emf, r, Rp, Req, I, Vt, Pemf, Pr, Pload, slots: readings, wireI, V, Vp, deadWire, checks, batteryOut: out }
}

/** Every element of the board, with the capacitor drawn the way `cap` says. */
function boardElements(slots: Slots, emf: number, r: number, capId: SlotId, cap: { mode: 'source'; V: number } | { mode: 'open' }) {
  const els: CircuitElement[] = [
    { kind: 'source', a: 0, b: 1, emf },
    { kind: 'resistor', a: 1, b: 2, R: Math.max(r, WIRE_OHMS) },
  ]
  for (const [a, b] of WIRES) els.push({ kind: 'resistor', a, b, R: WIRE_OHMS })
  const index: Partial<Record<SlotId, number>> = {}
  for (const id of SLOT_IDS) {
    const part = slots[id]
    if (!part) continue
    if (id === capId) {
      if (cap.mode === 'open') continue
      // a source from b to a holds V_a − V_b = V: the capacitor's voltage at this instant
      index[id] = els.length
      els.push({ kind: 'source', a: SLOTS[id].b, b: SLOTS[id].a, emf: cap.V })
      continue
    }
    index[id] = els.length
    els.push({ kind: 'resistor', a: SLOTS[id].a, b: SLOTS[id].b, R: modelOhms(part) })
  }
  return { els, index }
}

/**
 * The board with one capacitor, at one instant. Over a short moment the capacitor holds its voltage, so it
 * acts like a battery of V_C (the book's loop rule ε − V_R − V_C = 0, Section 10.5); solving the whole board
 * with it in place gives every current right now. Two more solves give where it is heading (its voltage with
 * the slot open) and the resistance it sees (push set to zero, 1 V test in the slot). With one capacitor the
 * whole board relaxes as one exponential with τ = R_th·C (Eq 10.9), so the app moves V_C along that curve.
 */
function solveRC(input: BoardInput): BoardResult {
  const { emf, r, slots } = input
  const out = input.batteryIn === false
  const capId = capSlot(slots)!
  const capPart = slots[capId] as { kind: 'capacitor'; farads: number }
  const C = capPart.farads
  let Vc = input.capV ?? 0
  const filledLanes = LANES.filter(id => slots[id])
  const gaps: (SlotId | 'lanes')[] = []
  if (!slots.R1) gaps.push('R1')
  if (filledLanes.length === 0) gaps.push('lanes')
  if (!slots.R5) gaps.push('R5')
  const Rp = parallelResistance(filledLanes.map(id => ohmsOf(slots[id]!)))
  const Req = seriesResistance(gaps.length ? [Infinity] : [ohmsOf(slots.R1!), Rp, ohmsOf(slots.R5!)])
  const resistorLanes = filledLanes.filter(id => slots[id]!.kind !== 'wire')
  const hasWireLane = filledLanes.length > resistorLanes.length
  const bypassed = hasWireLane ? resistorLanes.filter(id => slots[id]!.kind === 'resistor') : []
  const status: BoardResult['status'] = gaps.length ? 'open' : Req === 0 ? 'short' : 'ok'
  // an ideal short needs a push to be infinite: with the battery switched out nothing drives it
  const idealShort = status === 'short' && r === 0 && emf !== 0
  // a capacitor in a branch beside a wire branch is shorted by that wire: it empties at once
  const capShorted = hasWireLane && LANES.includes(capId)

  const wireI = new Float64Array(WIRES.length)
  const deadWire = new Uint8Array(WIRES.length)
  const live = (id: SlotId) => !!slots[id] && !bypassed.includes(id) && !(capShorted && id === capId)
  for (const id of LANES) if (!live(id)) for (const k of LANE_WIRES[id]!) deadWire[k] = 1
  if (!live('R3') && !live('R4')) { deadWire[4] = 1; deadWire[10] = 1 }
  if (!live('R4')) { deadWire[6] = 1; deadWire[12] = 1 }
  const V = new Float64Array(NODE_COUNT)
  const readings: Partial<Record<SlotId, SlotReading>> = {}
  const empty = (): BoardResult => ({
    status, idealShort, gaps, bypassed, emf, r, Rp, Req, I: idealShort ? Infinity : 0, Vt: idealShort ? NaN : emf,
    Pemf: idealShort ? Infinity : 0, Pr: 0, Pload: 0, slots: readings, wireI, V, Vp: 0, deadWire, checks: [], batteryOut: out,
    cap: { id: capId, C, Vc, q: C * Vc, Ic: 0, Voc: Vc, Rth: Infinity, tau: Infinity, snapped },
  })
  let snapped = false
  if (idealShort) {
    // the short runs through the wire branch, which also shorts the capacitor: it is empty
    snapped = Vc !== 0
    Vc = 0
    for (const id of SLOT_IDS) if (slots[id]) readings[id] = { I: bypassed.includes(id) || id === capId ? 0 : Infinity, V: 0, P: 0 }
    return empty()
  }

  const a = SLOTS[capId].a, b = SLOTS[capId].b
  // where it is heading: the slot left open
  const open = boardElements(slots, emf, r, capId, { mode: 'open' })
  const so = solveCircuit(NODE_COUNT, open.els)
  const zeroV = REL_ZERO * Math.max(1, emf, Math.abs(Vc))
  const Voc = so.ok ? clean(so.V[a]! - so.V[b]!, zeroV) : 0
  // the resistance it sees: no push, 1 V in the slot
  const test = boardElements(slots, 0, r, capId, { mode: 'source', V: 1 })
  const st = solveCircuit(NODE_COUNT, test.els)
  const Itest = st.ok ? -st.I[test.index[capId]!]! : 0
  const Rth = Math.abs(Itest) < 1e-9 ? Infinity : -1 / Itest
  const tau = Rth * C
  snapped = tau < INSTANT_TAU && Math.abs(Vc - Voc) > 0
  if (snapped) Vc = Voc

  // right now: the capacitor as a source of V_C. At its end voltage it carries no current at all, so it is
  // solved as an open slot then (a 0 V source beside a 0.1 µΩ wire would wrongly take the wire's current).
  const steady = Math.abs(Voc - Vc) <= zeroV
  const now = steady ? open : boardElements(slots, emf, r, capId, { mode: 'source', V: Vc })
  const sol = steady ? so : solveCircuit(NODE_COUNT, now.els)
  if (!sol.ok) return empty()
  // stand-in residue sits far below the biggest current anywhere on the board
  let biggest = 1e-3
  for (const x of sol.I) biggest = Math.max(biggest, Math.abs(x))
  // plus a floor for float rounding through the 10⁷ S stand-ins (about 1e-8 A per volt); the smallest real
  // current on this board is 1 V across 300 Ω, about 3 mA
  const zeroI = Math.max(REL_ZERO * biggest, 1e-6 * Math.max(1, Math.abs(emf), Math.abs(Vc)))
  const I = clean(sol.I[0]!, zeroI)
  for (let k = 0; k < NODE_COUNT; k++) V[k] = clean(sol.V[k]!, zeroV)
  const Vp = clean(V[6]! - V[15]!, zeroV)
  WIRES.forEach((_, k) => { wireI[k] = deadWire[k] ? 0 : clean(sol.I[2 + k]!, zeroI) })
  let Ic = 0
  for (const id of SLOT_IDS) {
    const k = now.index[id]
    if (k === undefined) continue
    const part = slots[id]!
    if (id === capId) {
      Ic = clean(-sol.I[k]!, zeroI)
      readings[id] = { I: Ic, V: Vc, P: Ic * Vc }
      continue
    }
    const dead = bypassed.includes(id)
    const Ik = dead ? 0 : clean(sol.I[k]!, zeroI)
    const Vk = part.kind === 'wire' || dead ? 0 : clean(V[SLOTS[id].a]! - V[SLOTS[id].b]!, zeroV)
    readings[id] = { I: Ik, V: Vk, P: part.kind === 'resistor' ? Ik * Ik * part.ohms : 0 }
  }
  if (steady) readings[capId] = { I: 0, V: Vc, P: 0 }
  const Vt = clean(emf - I * r, zeroV)
  const Pemf = I * emf
  const Pr = I * I * r

  const close = (x: number, y: number, scale = 1) => Math.abs(x - y) <= 1e-4 * Math.max(scale, Math.abs(x), Math.abs(y))
  const laneScale = Math.max(1e-3, ...filledLanes.map(id => Math.abs(readings[id]?.I ?? 0)))
  const closeV = (x: number, y: number) => Math.abs(x - y) <= 1e-4 * Math.max(1, emf, Math.abs(Vc))
  const checks: Check[] = []
  // with a gap the battery is cut off, but the capacitor can still discharge through the branches
  if (status !== 'open' || Ic !== 0) {
    const read = (id: SlotId) => readings[id] ?? { I: 0, V: 0, P: 0 }
    const laneSum = filledLanes.reduce((s, id) => s + read(id).I, 0)
    checks.push({ id: 'junction', eq: '10.4', label: 'current into B = current out of B, right now', ok: close(laneSum, I, laneScale) })
    if (status !== 'open') {
      const loop = emf - I * r - read('R1').V - Vp - read('R5').V
      checks.push({ id: 'loop', eq: '10.5', label: 'ε − Ir − V₁ − V_P − V₅ = 0, right now', ok: closeV(loop, 0) })
    }
    if (Number.isFinite(Rth)) checks.push({ id: 'rc', eq: '10.10', label: 'current into the capacitor = (V heading − V now)/R', ok: close(Ic, (Voc - Vc) / Rth, 1e-3) })
    const heat = SLOT_IDS.reduce((s, id) => s + (slots[id]?.kind === 'resistor' ? readings[id]!.P : 0), 0) + Pr
    const sink = heat + Ic * Vc
    checks.push({ id: 'energy', eq: '9.12, 9.13', label: 'battery power = heat in every resistor + power going into the capacitor', ok: close(Pemf, sink, Math.max(1e-3, heat, Math.abs(Ic * Vc))) })
  }
  return {
    status, idealShort, gaps, bypassed, emf, r, Rp, Req, I, Vt, Pemf, Pr, Pload: Pemf - Pr, slots: readings, wireI, V, Vp, deadWire,
    checks, batteryOut: out, cap: { id: capId, C, Vc, q: C * Vc, Ic, Voc, Rth, tau, snapped },
  }
}

/** The worked examples from OpenStax Ch 10 that fit this board. */
export type BookValue = { label: string; value: string; of: (b: BoardResult) => number; unit: string }
export type Preset = { id: string; title: string; note: string; input: BoardInput; book: BookValue[] }

export const PRESETS: readonly Preset[] = [
  {
    id: 'ex10-1',
    title: 'Example 10.1',
    note: 'A 12.00 V battery with r = 0.100 Ω driving a 10.00 Ω load.',
    input: { emf: 12, r: 0.1, slots: { R1: { kind: 'resistor', ohms: 10 }, R2: { kind: 'wire' }, R5: { kind: 'wire' } } },
    book: [
      { label: 'I', value: '1.188 A', unit: 'A', of: b => b.I },
      { label: 'V_terminal', value: '11.90 V', unit: 'V', of: b => b.Vt },
    ],
  },
  {
    id: 'ex10-3',
    title: 'Example 10.3',
    note: '1.00, 2.00 and 2.00 Ω in parallel on a 3.00 V source. The book calls them R₁, R₂, R₃; here they sit in the three branch slots.',
    input: {
      emf: 3,
      r: 0,
      slots: {
        R1: { kind: 'wire' },
        R2: { kind: 'resistor', ohms: 1 },
        R3: { kind: 'resistor', ohms: 2 },
        R4: { kind: 'resistor', ohms: 2 },
        R5: { kind: 'wire' },
      },
    },
    book: [
      { label: 'R_P', value: '0.50 Ω', unit: 'Ω', of: b => b.Rp },
      { label: 'I', value: '6.00 A', unit: 'A', of: b => b.I },
      { label: 'I in the 1.00 Ω', value: '3.00 A', unit: 'A', of: b => b.slots.R2?.I ?? NaN },
      { label: 'P', value: '18.00 W', unit: 'W', of: b => b.Pemf },
    ],
  },
  {
    id: 'ex10-4',
    title: 'Example 10.4',
    note: 'R₁ = 1.00 Ω in series with 6.00 Ω ∥ 13.00 Ω on 12.0 V.',
    input: {
      emf: 12,
      r: 0,
      slots: {
        R1: { kind: 'resistor', ohms: 1 },
        R2: { kind: 'resistor', ohms: 6 },
        R3: { kind: 'resistor', ohms: 13 },
        R5: { kind: 'wire' },
      },
    },
    book: [
      { label: 'R_eq', value: '5.10 Ω', unit: 'Ω', of: b => b.Req },
      { label: 'I', value: '2.35 A', unit: 'A', of: b => b.I },
      { label: 'V₂', value: '9.65 V', unit: 'V', of: b => b.slots.R2?.V ?? NaN },
      { label: 'I₂', value: '1.61 A', unit: 'A', of: b => b.slots.R2?.I ?? NaN },
    ],
  },
]
