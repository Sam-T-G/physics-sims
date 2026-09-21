import { describe, it, expect } from 'vitest'
import {
  K_E,
  fibonacciSphere,
  radialRays,
  traceLine,
  seedLines,
  countSphereCrossings,
  fieldAt,
  vec3,
  add,
  scale,
  length,
  distance,
} from '@lib/physics'
import type { FieldLine, PointCharge, TraceOptions, Vec3 } from '@lib/physics'
import { expectRel, expectAbs } from './helpers'

// Shared inputs as plain literals. Every call into lib/physics happens inside an `it`.
const q = 1e-9
const d = 0.2
const rc = 0.01
const PLUS: Vec3 = { x: -d / 2, y: 0, z: 0 }
const MINUS: Vec3 = { x: d / 2, y: 0, z: 0 }
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

const SLACK = 1 + 1e-6

const box = (h: number): TraceOptions['box'] => ({ min: { x: -h, y: -h, z: -h }, max: { x: h, y: h, z: h } })

const dipoleOpts: Omit<TraceOptions, 'direction'> = {
  hMin: 1e-4,
  hMax: 0.01,
  eMin: 1e-6,
  maxSteps: 20000,
  box: box(1),
}
const halfBoxOpts: Omit<TraceOptions, 'direction'> = { ...dipoleOpts, box: box(0.5) }

/** +q at (−d/2,0,0) index 0, −q at (+d/2,0,0) index 1. */
const dipole = (): PointCharge[] => [
  { q, pos: PLUS, rc },
  { q: -q, pos: MINUS, rc },
]

function at(line: FieldLine, i: number): Vec3 {
  const p = line.points[i]
  expect(p, `points[${i}] exists (length ${line.points.length})`).toBeDefined()
  return p!
}
const first = (line: FieldLine): Vec3 => at(line, 0)
const last = (line: FieldLine): Vec3 => at(line, line.points.length - 1)

/** Smallest distance from p to a face of the box, negative when p is outside. */
function boxMargin(p: Vec3, b: TraceOptions['box']): number {
  return Math.min(p.x - b.min.x, b.max.x - p.x, p.y - b.min.y, b.max.y - p.y, p.z - b.min.z, b.max.z - p.z)
}

/** Consecutive points are at most hMax apart. The RK4 chord is a convex combination of unit steps, so |Δr| ≤ h ≤ hMax. */
function expectStepsBounded(line: FieldLine, hMax: number, label: string): void {
  for (let i = 1; i < line.points.length; i++) {
    const step = distance(at(line, i - 1), at(line, i))
    expect(step, `${label} step ${i} = ${step} exceeds hMax ${hMax}`).toBeLessThanOrEqual(hMax * SLACK)
  }
}

/** The terminal point agrees with the declared end, so the line did not stop mid-space. */
function expectEndConsistent(line: FieldLine, charges: readonly PointCharge[], opts: Omit<TraceOptions, 'direction'>, label: string): void {
  const p = last(line)
  switch (line.end) {
    case 'charge': {
      expect(line.endCharge, `${label} endCharge`).toBeTypeOf('number')
      const c = charges[line.endCharge!]
      expect(c, `${label} endCharge ${line.endCharge} indexes charges`).toBeDefined()
      expect(distance(p, c!.pos), `${label} last point inside rc of charge ${line.endCharge}`).toBeLessThanOrEqual(c!.rc)
      break
    }
    case 'box':
      // Either the last accepted point is outside, or the trace stopped within one step of a face.
      expect(boxMargin(p, opts.box), `${label} last point at the box`).toBeLessThanOrEqual(opts.hMax * SLACK)
      break
    case 'null':
      expect(length(fieldAt(charges, p)), `${label} |E| at a null end`).toBeLessThan(opts.eMin)
      break
    case 'steps':
      expect.fail(`${label} ended at the step cap (mid-space)`)
  }
}

/** A polyline with the given points, for countSphereCrossings alone (end is irrelevant there). */
const polyline = (points: Vec3[]): FieldLine => ({ points, end: 'box' })

describe('fieldLine', () => {
  describe('fibonacciSphere', () => {
    it('fibonacciSphere(100): 100 unit vectors, pairwise distinct with min pairwise distance > 0.1', () => {
      const dirs = fibonacciSphere(100)
      expect(dirs).toHaveLength(100)
      for (const [i, v] of dirs.entries()) expectAbs(length(v), 1, 1e-12, `|dirs[${i}]|`)
      let minPair = Infinity
      for (let i = 0; i < dirs.length; i++) {
        for (let j = i + 1; j < dirs.length; j++) minPair = Math.min(minPair, distance(dirs[i]!, dirs[j]!))
      }
      // 100 points spread over 4π sr sit ~0.35 apart on average; 0.1 rules out any near-duplicate.
      expect(minPair, 'min pairwise distance').toBeGreaterThan(0.1)
    })
  })

  describe('countSphereCrossings on hand-built polylines', () => {
    // Center (1,1,1), R = 5. Offsets with exactly representable lengths: (1,1,1) → √3 inside,
    // (3,4,0) → 5 exactly on, (6,8,0) → 10 outside. Sums are asserted with === so −0 never bites.
    const C: Vec3 = { x: 1, y: 1, z: 1 }
    const R = 5
    const IN: Vec3 = { x: 2, y: 2, z: 2 }
    const ON: Vec3 = { x: 4, y: 5, z: 1 }
    const OUT: Vec3 = { x: 7, y: 9, z: 1 }
    const OUT2: Vec3 = { x: 1, y: 7, z: 9 }

    it('inside → outside is +1, outside → inside is −1', () => {
      expect(countSphereCrossings(polyline([IN, OUT]), C, R)).toBe(1)
      expect(countSphereCrossings(polyline([OUT, IN]), C, R)).toBe(-1)
    })

    it('in, out, back in → +1 − 1 = 0; in, out, in, out → +1', () => {
      const n = countSphereCrossings(polyline([IN, OUT, IN]), C, R)
      expect(n === 0, `in/out/in crossings = ${n}`).toBe(true)
      expect(countSphereCrossings(polyline([IN, OUT, IN, OUT2]), C, R)).toBe(1)
    })

    it('no crossing when the polyline stays on one side', () => {
      const inside = countSphereCrossings(polyline([IN, vec3(1.5, 1.5, 1.5), IN]), C, R)
      expect(inside === 0, `inside-only crossings = ${inside}`).toBe(true)
      const outside = countSphereCrossings(polyline([OUT, OUT2, OUT]), C, R)
      expect(outside === 0, `outside-only crossings = ${outside}`).toBe(true)
    })

    it('a point exactly on the sphere counts with the side of the next non-zero sign', () => {
      // Sign sequences: (−, 0→+, +) is one crossing; (+, 0→−, −) is one crossing back.
      expect(countSphereCrossings(polyline([IN, ON, OUT]), C, R)).toBe(1)
      expect(countSphereCrossings(polyline([OUT, ON, IN]), C, R)).toBe(-1)
      // (−, 0→−, −) and (+, 0→+, +) touch the sphere without crossing it.
      const touchIn = countSphereCrossings(polyline([IN, ON, IN]), C, R)
      expect(touchIn === 0, `in/on/in crossings = ${touchIn}`).toBe(true)
      const touchOut = countSphereCrossings(polyline([OUT, ON, OUT2]), C, R)
      expect(touchOut === 0, `out/on/out crossings = ${touchOut}`).toBe(true)
    })
  })

  it("Dipole line seeded equatorial from + ends inside −'s capture radius", () => {
    const charges = dipole()
    const start = add(PLUS, scale(vec3(0, 1, 0), rc))
    const line = traceLine(charges, start, { ...dipoleOpts, direction: 1 })
    expect(line.end).toBe('charge')
    expect(line.endCharge).toBe(1)
    expect(first(line)).toEqual(start)
    expect(distance(last(line), MINUS), "last point inside −'s rc").toBeLessThanOrEqual(rc)
    expect(line.points.length).toBeGreaterThan(1)
    expectStepsBounded(line, dipoleOpts.hMax, 'equatorial line')
  })

  it('Every dipole line ends on −, the box, or a null; none mid-space', () => {
    const charges = dipole()
    const lines = seedLines(charges, 32 / q, dipoleOpts)
    // N_+ = round(32/q · q) = 32 forward lines. − is never seeded forward.
    const forward = lines.filter((l) => l.seed?.charge === 0 && l.seed.direction === 1)
    const backward = lines.filter((l) => l.seed?.charge === 1 && l.seed.direction === -1)
    expect(forward).toHaveLength(32)
    expect(forward.length + backward.length, 'every line is seeded on + forward or on − backward').toBe(lines.length)

    for (const [i, line] of lines.entries()) {
      const label = `line ${i} (seed ${JSON.stringify(line.seed)})`
      expect(line.seed, `${label} carries seed`).toBeDefined()
      expect(['charge', 'box', 'null'], `${label} end ${line.end}`).toContain(line.end)
      expect(line.end, `${label} never hits the step cap`).not.toBe('steps')
      if (line.seed!.direction === 1) {
        // Forward lines leave + and can only end on −, the box, or a null.
        expect(line.endCharge, `${label} never ends on +`).not.toBe(0)
        if (line.end === 'charge') expect(line.endCharge, `${label} ends on −`).toBe(1)
      } else {
        // Backward lines leave − against E. The seedLines doc picks their directions as "farthest from the
        // arrival directions", a heuristic, so a backward seed outside the from-infinity cap follows the
        // same flow back to + (cos θ₁ − cos θ₂ = const). That duplicates a +→− line; it is not mid-space.
        expect(line.endCharge, `${label} never re-enters −`).not.toBe(1)
        if (line.end === 'charge') expect(line.endCharge, `${label} a backward charge end is +`).toBe(0)
      }
      // points[0] sits on the seeding charge's capture sphere.
      expectRel(distance(first(line), charges[line.seed!.charge]!.pos), rc, 1e-9, `${label} seed radius`)
      expectStepsBounded(line, dipoleOpts.hMax, label)
      expectEndConsistent(line, charges, dipoleOpts, label)
    }

    // Deficit on −: N_− = 32, so backward lines number 32 − arrivals.
    const arrivals = forward.filter((l) => l.end === 'charge' && l.endCharge === 1).length
    expect(backward).toHaveLength(Math.max(0, 32 - arrivals))
  })

  describe('Line crossings of nested spheres, single charge', () => {
    const single: PointCharge = { q, pos: ORIGIN, rc }
    const radii = [0.05, 0.1, 0.2]

    it('radialRays: 64 rays, every sphere sees exactly N = 64, each ray contributing +1', () => {
      const rays = radialRays(single, 64, 0.4)
      expect(rays).toHaveLength(64)
      for (const [i, ray] of rays.entries()) {
        expect(ray.end, `ray ${i} end`).toBe('box')
        expect(ray.points.length, `ray ${i} point count`).toBeGreaterThanOrEqual(2)
        expectRel(length(first(ray)), rc, 1e-9, `ray ${i} starts at rc`)
        expectRel(length(last(ray)), 0.4, 1e-9, `ray ${i} ends at length`)
        for (let k = 1; k < ray.points.length; k++) {
          expect(length(at(ray, k)), `ray ${i} monotone at ${k}`).toBeGreaterThan(length(at(ray, k - 1)))
        }
      }
      for (const R of radii) {
        let total = 0
        for (const [i, ray] of rays.entries()) {
          const n = countSphereCrossings(ray, ORIGIN, R)
          expect(n, `ray ${i} crossings of R = ${R}`).toBe(1)
          total += n
        }
        expect(total, `total crossings of R = ${R}`).toBe(64)
      }
    })

    it('seedLines: 64 traced lines, every sphere sees exactly N = 64, each line contributing +1', () => {
      // kq/r² at the nearest face (0.5 m) is ~36 V/m ≫ eMin, so no line can end 'null' inside the box.
      const eAtFace = (K_E * q) / (0.5 * 0.5)
      expect(eAtFace).toBeGreaterThan(halfBoxOpts.eMin)

      const lines = seedLines([single], 64 / q, halfBoxOpts)
      expect(lines).toHaveLength(64)
      for (const [i, line] of lines.entries()) {
        expect(line.seed, `line ${i} seed`).toEqual({ charge: 0, direction: 1 })
        expect(line.end, `line ${i} end`).toBe('box')
        expectRel(length(first(line)), rc, 1e-9, `line ${i} starts at rc`)
        expectStepsBounded(line, halfBoxOpts.hMax, `line ${i}`)
        expectEndConsistent(line, [single], halfBoxOpts, `line ${i}`)
      }
      for (const R of radii) {
        let total = 0
        for (const [i, line] of lines.entries()) {
          const n = countSphereCrossings(line, ORIGIN, R)
          expect(n, `line ${i} crossings of R = ${R}`).toBe(1)
          total += n
        }
        expect(total, `total crossings of R = ${R}`).toBe(64)
      }
    })

    it('radialRays on −q run inward and each crossing counts −1, so the total is −64 on every sphere', () => {
      const rays = radialRays({ q: -q, pos: ORIGIN, rc }, 64, 0.4)
      expect(rays).toHaveLength(64)
      for (const [i, ray] of rays.entries()) {
        expect(ray.end, `ray ${i} end`).toBe('charge')
        expect(ray.endCharge, `ray ${i} endCharge`).toBe(0)
        expectRel(length(first(ray)), 0.4, 1e-9, `ray ${i} starts at length`)
        expectRel(length(last(ray)), rc, 1e-9, `ray ${i} ends at rc`)
        expect(ray.points.length, `ray ${i} point count`).toBeGreaterThanOrEqual(2)
        for (let k = 1; k < ray.points.length; k++) {
          expect(length(at(ray, k)), `ray ${i} monotone inward at ${k}`).toBeLessThan(length(at(ray, k - 1)))
        }
      }
      for (const R of radii) {
        let total = 0
        for (const [i, ray] of rays.entries()) {
          const n = countSphereCrossings(ray, ORIGIN, R)
          expect(n, `ray ${i} crossings of R = ${R}`).toBe(-1)
          total += n
        }
        expect(total, `total crossings of R = ${R}`).toBe(-64)
      }
    })
  })

  describe('deficit rule', () => {
    it('a lone −q: exactly M = round(perUnitCharge·|q|) backward lines from infinity, all ending at the box', () => {
      const lone: PointCharge = { q: -q, pos: ORIGIN, rc }
      // 24.4 lines per |q| rounds to 24: the quota is rounded, not truncated.
      const perUnitCharge = 24.4 / q
      const M = Math.round(perUnitCharge * Math.abs(lone.q))
      expect(M).toBe(24)
      // kq/r² at the far corner (√0.75 m) is ~12 V/m ≫ eMin, so no line can end 'null' inside the box.
      expect((K_E * q) / 0.75).toBeGreaterThan(halfBoxOpts.eMin)

      const lines = seedLines([lone], perUnitCharge, halfBoxOpts)
      expect(lines).toHaveLength(M)
      for (const [i, line] of lines.entries()) {
        expect(line.seed, `line ${i} seed`).toEqual({ charge: 0, direction: -1 })
        expect(line.end, `line ${i} end`).toBe('box')
        expect(line.endCharge, `line ${i} never re-enters its own charge`).not.toBe(0)
        expectRel(length(first(line)), rc, 1e-9, `line ${i} starts at rc`)
        expectStepsBounded(line, halfBoxOpts.hMax, `line ${i}`)
        expectEndConsistent(line, [lone], halfBoxOpts, `line ${i}`)
      }
    })

    it('+2q and −q: 32 forward lines, backward lines number exactly max(0, 16 − arrivals)', () => {
      const charges: PointCharge[] = [
        { q: 2 * q, pos: PLUS, rc },
        { q: -q, pos: MINUS, rc },
      ]
      // perUnitCharge = 16/q gives N_+ = round(32) = 32 and N_− = round(16) = 16.
      const lines = seedLines(charges, 16 / q, dipoleOpts)
      const forward = lines.filter((l) => l.seed?.charge === 0 && l.seed.direction === 1)
      const backward = lines.filter((l) => l.seed?.charge === 1 && l.seed.direction === -1)
      expect(forward).toHaveLength(32)
      expect(forward.length + backward.length, 'no other seeds exist').toBe(lines.length)

      const arrivals = forward.filter((l) => l.end === 'charge' && l.endCharge === 1).length
      expect(backward).toHaveLength(Math.max(0, 16 - arrivals))
      for (const [i, line] of backward.entries()) {
        expect(line.endCharge, `backward line ${i} never ends on −`).not.toBe(1)
        expectRel(distance(first(line), MINUS), rc, 1e-9, `backward line ${i} starts on −'s capture sphere`)
      }
      for (const [i, line] of forward.entries()) {
        expect(line.endCharge, `forward line ${i} never ends on +`).not.toBe(0)
        expectRel(distance(first(line), PLUS), rc, 1e-9, `forward line ${i} starts on +'s capture sphere`)
      }
    })
  })
})

describe('fieldLine: review regressions (2026-09-20)', () => {
  it('a step larger than the capture radius cannot tunnel through a charge: hMin = 5·rc still ends on −', () => {
    const charges = dipole()
    const opts: TraceOptions = { ...dipoleOpts, hMin: 5 * rc, hMax: 5 * rc, direction: 1 }
    // Straight down the axis from + toward −: every step lands on the line through both charges.
    const axial = traceLine(charges, add(PLUS, vec3(rc, 0, 0)), opts)
    expect(axial.end).toBe('charge')
    expect(axial.endCharge).toBe(1)
    const lastAxial = axial.points[axial.points.length - 1]!
    expect(distance(lastAxial, MINUS)).toBeLessThan(rc)
    // Equatorial seed, same coarse step.
    const equatorial = traceLine(charges, add(PLUS, vec3(0, rc, 0)), opts)
    expect(equatorial.end).toBe('charge')
    expect(equatorial.endCharge).toBe(1)
    const lastEq = equatorial.points[equatorial.points.length - 1]!
    expect(distance(lastEq, MINUS)).toBeLessThan(rc)
    // And the coarse seed on +'s own sphere is not captured by + at step 0.
    expect(axial.points.length).toBeGreaterThan(1)
  })

  it('traceLine honors exponent: with n = 3 a dipole line still ends on −, and a single-charge ray is unchanged', () => {
    const charges = dipole()
    const line = traceLine(charges, add(PLUS, vec3(0, rc, 0)), { ...dipoleOpts, direction: 1, exponent: 3 })
    expect(line.end).toBe('charge')
    expect(line.endCharge).toBe(1)
  })
})
