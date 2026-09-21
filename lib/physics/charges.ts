import type { Vec3 } from './vec3'
import { K_E } from './constants'

/** A point charge with a capture radius rc (m). Inside rc the field uses the uniform-ball kernel. */
export type PointCharge = { q: number; pos: Vec3; rc: number }

/**
 * exponent = n in E ∝ 1/rⁿ. Default 2. Only the "not our universe" toggle sets anything else.
 * With n ≠ 2 the outside field is k q r̂ / rⁿ and the ball kernel becomes k q r / rc^(n+1), still continuous at rc.
 */
export type FieldOptions = { exponent?: number }

/**
 * Scalar multiplier f such that the field of `c` at displacement (dx,dy,dz), distance r, is f·(dx,dy,dz).
 * Outside rc: k q / r^(n+1) (so |E| = k q / rⁿ). Inside rc: k q / rc^(n+1), equal at r = rc; at n = 2 that is the uniform ball, at other n it is just the linear continuation.
 * r = 0 with rc = 0 returns 0: that charge contributes nothing instead of NaN.
 */
function radialFactor(q: number, rc: number, r2: number, n: number): number {
  const r = Math.sqrt(r2)
  if (r < rc) return (K_E * q) / (n === 2 ? rc * rc * rc : Math.pow(rc, n + 1))
  if (r === 0) return 0
  return (K_E * q) / (n === 2 ? r2 * r : Math.pow(r, n + 1))
}

/**
 * Exact superposition of every charge's field at p, in V/m (N/C).
 * For each charge with r = |p − pos|: r ≥ rc gives k q r̂ / r² (exact Coulomb);
 * r < rc gives k q (p − pos) / rc³, the field of a uniformly charged ball, which equals the outside
 * value at r = rc. At r = 0 the kernel gives the zero vector, so nothing is singular.
 * rc = 0 means "exact everywhere"; p exactly on a charge with rc = 0 gets no contribution from it.
 */
export function fieldAt(charges: readonly PointCharge[], p: Vec3, opts: FieldOptions = {}): Vec3 {
  const n = opts.exponent ?? 2
  let ex = 0
  let ey = 0
  let ez = 0
  for (const c of charges) {
    const dx = p.x - c.pos.x
    const dy = p.y - c.pos.y
    const dz = p.z - c.pos.z
    const f = radialFactor(c.q, c.rc, dx * dx + dy * dy + dz * dz, n)
    ex += f * dx
    ey += f * dy
    ez += f * dz
  }
  return { x: ex, y: ey, z: ez }
}

/**
 * Force on b due to a, in N: q_b · E_a(b.pos), with a's ball kernel if b sits inside a.rc.
 * The charge product is formed as a.q · b.q before anything else, and the separation vector of the
 * swapped call is the exact negation, so outside both capture radii forceBetween(a, b) and
 * forceBetween(b, a) are bit-for-bit negatives (Newton's third law holds exactly).
 */
export function forceBetween(a: PointCharge, b: PointCharge, opts: FieldOptions = {}): Vec3 {
  const n = opts.exponent ?? 2
  const dx = b.pos.x - a.pos.x
  const dy = b.pos.y - a.pos.y
  const dz = b.pos.z - a.pos.z
  const f = radialFactor(a.q * b.q, a.rc, dx * dx + dy * dy + dz * dz, n)
  return { x: f * dx, y: f * dy, z: f * dz }
}

/** Net force on target from every charge in the array that is not target itself (reference identity). */
export function forceOn(charges: readonly PointCharge[], target: PointCharge, opts: FieldOptions = {}): Vec3 {
  let fx = 0
  let fy = 0
  let fz = 0
  for (const c of charges) {
    if (c === target) continue
    const f = forceBetween(c, target, opts)
    fx += f.x
    fy += f.y
    fz += f.z
  }
  return { x: fx, y: fy, z: fz }
}
