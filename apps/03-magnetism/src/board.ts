// Layer 1: the board model and everything it measures. Pure: no DOM, no canvas.
import { MU_0, bFieldAt, vectorPotentialAt, circulation, enclosedCurrent, forcePerLength, pairForce, type Wire, type Loop } from '@lib/physics'
import { si, direction } from './format'

/** The board's view: its center and width in meters. The height is always 0.7 of the width. */
export type View = { cx: number; cy: number; w: number }
export const ASPECT = 0.7

export type Board = { wires: Wire[]; probe: { x: number; y: number }; loop: Loop; view: View }

/** The current dial's stops, in amperes. The direction buttons set the sign. */
export const STOPS = [0, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20] as const
export const MAX_WIRES = 6

/** Wire radius: 1.5% of the board width (6 mm on the 40 cm board), so wires look the same size on every board. */
export const wireRadius = (v: View) => v.w * 0.015
/** How close a wire's edge can come to the loop before the loop counts as cutting through it. */
export const cutMargin = (v: View) => v.w * 0.005

export type Measure = {
  a: number
  B: [number, number]
  Bmag: number
  circ: number
  inside: number[]
  cut: number[]
  Iin: number
  mu0Iin: number
  ampereOk: boolean
  /** Force per meter on each wire from all the others. */
  forces: [number, number][]
  /** B from the slope of the field-line map (the vector potential), to check against the summed B. */
  Bslope: [number, number]
}

const close = (x: number, ref: number, rel: number, floor: number) => Math.abs(x - ref) <= Math.max(floor, rel * Math.abs(ref))

export function measure(b: Board): Measure {
  const a = wireRadius(b.view)
  const B = bFieldAt(b.wires, b.probe.x, b.probe.y, a)
  const circ = circulation(b.wires, b.loop, a)
  const enc = enclosedCurrent(b.wires, b.loop, a, cutMargin(b.view))
  const mu0Iin = MU_0 * enc.I
  // the step sum is good to about 1e-6 of μ₀ × (the largest current) away from the wires; 1e-4 leaves room
  const Imax = Math.max(1e-9, ...b.wires.map(w => Math.abs(w.I)))
  const ampereOk = enc.cut.length === 0 && close(circ, mu0Iin, 1e-3, 1e-4 * MU_0 * Imax)
  const h = a * 1e-3
  const { x, y } = b.probe
  const Bslope: [number, number] = [
    (vectorPotentialAt(b.wires, x, y + h, a) - vectorPotentialAt(b.wires, x, y - h, a)) / (2 * h),
    -(vectorPotentialAt(b.wires, x + h, y, a) - vectorPotentialAt(b.wires, x - h, y, a)) / (2 * h),
  ]
  return {
    a, B, Bmag: Math.hypot(B[0], B[1]), circ, inside: enc.inside, cut: enc.cut, Iin: enc.I, mu0Iin, ampereOk,
    forces: b.wires.map((_, i) => forcePerLength(b.wires, i, a)),
    Bslope,
  }
}

/** The pair-by-pair force on wire i, added as vectors: what the force row's equation lines add up. */
export function pairSum(b: Board, i: number): [number, number] {
  const w = b.wires[i]
  if (!w) return [0, 0]
  let fx = 0, fy = 0
  b.wires.forEach((o, j) => {
    if (j === i) return
    const dx = o.x - w.x, dy = o.y - w.y, d = Math.hypot(dx, dy)
    if (d === 0) return
    const f = pairForce(w.I, o.I, d) // positive pulls wire i toward wire j
    fx += f * dx / d
    fy += f * dy / d
  })
  return [fx, fy]
}

export type BookRow = { label: string; book: string; sim: (b: Board, m: Measure) => string; note?: string }
export type Preset = { id: string; title: string; note: string; board: Board; pick: number; book?: BookRow[] }

const cm = 0.01
export const PRESETS: Preset[] = [
  {
    id: 'same',
    title: 'Two wires, same way',
    note: '10 A each, 10 cm apart',
    pick: 0,
    board: {
      wires: [{ x: -5 * cm, y: 0, I: 10 }, { x: 5 * cm, y: 0, I: 10 }],
      probe: { x: 0, y: 8 * cm },
      loop: { x: -5 * cm, y: 0, r: 4.5 * cm },
      view: { cx: 0, cy: 0, w: 0.4 },
    },
  },
  {
    id: 'opp',
    title: 'Two wires, opposite ways',
    note: '10 A out and 10 A in, 10 cm apart',
    pick: 0,
    board: {
      wires: [{ x: -5 * cm, y: 0, I: 10 }, { x: 5 * cm, y: 0, I: -10 }],
      probe: { x: 0, y: 0 },
      loop: { x: 0, y: 0, r: 9 * cm },
      view: { cx: 0, cy: 0, w: 0.4 },
    },
  },
  {
    id: 'ex12.3',
    title: 'Example 12.3',
    note: 'Three 2 A wires on the corners of a 1 cm square',
    pick: 0,
    board: {
      // I₁ bottom left, I₂ top left, I₃ top right, probe at P bottom right (the book's figure)
      wires: [{ x: 0, y: 0, I: -2 }, { x: 0, y: 1 * cm, I: -2 }, { x: 1 * cm, y: 1 * cm, I: -2 }],
      probe: { x: 1 * cm, y: 0 },
      loop: { x: 0, y: 0, r: 0.45 * cm },
      view: { cx: 0.5 * cm, cy: 0.5 * cm, w: 0.035 },
    },
    book: [
      { label: 'B₁ (wire 1 alone at P)', book: '4 × 10⁻⁵ T', sim: b => si(Math.hypot(...bFieldAt([b.wires[0]!], b.probe.x, b.probe.y, wireRadius(b.view))), 'T') },
      { label: 'B₂ (wire 2 alone at P)', book: '3 × 10⁻⁵ T', sim: b => si(Math.hypot(...bFieldAt([b.wires[1]!], b.probe.x, b.probe.y, wireRadius(b.view))), 'T'), note: 'The book rounds B₂ = 2.83 × 10⁻⁵ T to one figure.' },
      { label: 'B<sub>net</sub>', book: '8 × 10⁻⁵ T', sim: (_b, m) => si(m.Bmag, 'T'), note: 'The book adds −6 × 10⁻⁵ T in x and in y, so B<sub>net</sub> = 8.49 × 10⁻⁵ T before rounding.' },
    ],
  },
  {
    id: 'ex12.4',
    title: 'Example 12.4',
    note: 'Two 5.0 mA wires at (0, 3 cm) and (4 cm, 0)',
    pick: 1,
    board: {
      wires: [{ x: 0, y: 3 * cm, I: 0.005 }, { x: 4 * cm, y: 0, I: 0.005 }],
      probe: { x: 0, y: 0 },
      loop: { x: 4 * cm, y: 0, r: 1.4 * cm },
      view: { cx: 2 * cm, cy: 1.5 * cm, w: 0.09 },
    },
    book: [
      { label: 'Distance between the wires', book: '5.0 cm', sim: b => `${Math.round(Math.hypot(b.wires[0]!.x - b.wires[1]!.x, b.wires[0]!.y - b.wires[1]!.y) * 1000) / 10} cm` },
      { label: 'F/l on each wire', book: '1 × 10⁻¹⁰ N/m', sim: (_b, m) => si(Math.hypot(...m.forces[1]!), 'N/m') },
      { label: 'Direction on wire 2', book: '−0.8 î + 0.6 ĵ', sim: (_b, m) => { const [fx, fy] = m.forces[1]!; const f = Math.hypot(fx, fy); return direction(fx / f, fy / f) } },
    ],
  },
]
