import { describe, expect, it } from 'vitest'
import {
  K_E,
  add,
  cross,
  fieldAt,
  forceBetween,
  forceOn,
  length,
  normalize,
  scale,
  sub,
  vec3,
  type PointCharge,
} from '@lib/physics'
import { expectAbs, expectRel, expectVec3Abs, expectVec3Rel } from './helpers'

// SI throughout. q in C, distances in m, E in V/m, F in N.
const q = 1e-9
const rc = 0.01
const d = 0.1 // dipole / pair separation; d/2 = 0.05 is well outside rc

describe('charges', () => {
  it('point charge, E at r > rc: kq/r², radial (1e-9 rel)', () => {
    const r = 1
    // 0.36² + 0.48² + 0.8² = 1, so this is a unit vector with no zero component.
    const rhat = normalize(vec3(0.36, 0.48, 0.8))
    const c: PointCharge = { q, pos: vec3(0, 0, 0), rc }
    const p = scale(rhat, r)
    const E = fieldAt([c], p)
    const expected = scale(rhat, (K_E * q) / (r * r))
    expectVec3Rel(E, expected, 1e-9, 'E at r=1')
    // Radial: E ∥ r̂, pointing away from a positive charge.
    expectAbs(length(cross(E, rhat)), 0, 1e-9 * length(E), 'E × r̂')
    expect(E.x * rhat.x + E.y * rhat.y + E.z * rhat.z).toBeGreaterThan(0)
  })

  it('point charge, E at rc from inside and outside: equal (1e-9 rel, kernel continuity)', () => {
    const rhat = normalize(vec3(0.36, 0.48, 0.8))
    const c: PointCharge = { q, pos: vec3(0, 0, 0), rc }
    const pIn = scale(rhat, rc * (1 - 1e-10))
    const pOut = scale(rhat, rc * (1 + 1e-10))
    const eIn = fieldAt([c], pIn)
    const eOut = fieldAt([c], pOut)
    expectVec3Rel(eIn, eOut, 1e-9, 'E inside vs outside rc')
    // Both sides of rc sit at kq/rc² to first order: kernel kq r/rc³ and Coulomb kq/r² meet there.
    const atRc = scale(rhat, (K_E * q) / (rc * rc))
    expectVec3Rel(eIn, atRc, 1e-9, 'E just inside rc vs kq/rc²')
    expectVec3Rel(eOut, atRc, 1e-9, 'E just outside rc vs kq/rc²')
    // The boundary checks above pass for plain Coulomb with no kernel at all (they only see r ≈ rc).
    // Probe well inside the ball: kernel kq r/rc³ at r = rc/2 is kq/(2rc²); Coulomb there would be
    // 4kq/rc², 8× larger, so this line is what actually establishes the kernel exists.
    const pHalf = scale(rhat, rc / 2)
    const eHalf = fieldAt([c], pHalf)
    expectVec3Rel(eHalf, scale(rhat, (K_E * q) / (2 * rc * rc)), 1e-9, 'E at rc/2 vs kernel kq/(2rc²)')
  })

  it("Newton's third law: F12 = −F21 (exact)", () => {
    // Off-axis separation so every force component is nonzero.
    const a: PointCharge = { q: 2e-9, pos: vec3(0.1, 0.2, 0.3), rc }
    const b: PointCharge = { q: -3e-9, pos: vec3(0.4, -0.1, 0.7), rc }
    const F12 = forceBetween(a, b)
    const F21 = forceBetween(b, a)
    // Guard against a trivially antisymmetric zero result.
    expect(length(F12)).toBeGreaterThan(0)
    expect(F12.x).not.toBe(0)
    expect(F12.y).not.toBe(0)
    expect(F12.z).not.toBe(0)
    // x + (−x) is +0 in IEEE round-to-nearest, so toBe(0) is safe once F21 is bit-for-bit −F12.
    // That needs more than a negated separation vector: forceBetween must form the scalar prefactor
    // from q_a·q_b first (commutative, so bit-identical under swap) and then apply k and 1/r², e.g.
    // scale(normalize(sep), (K_E * (a.q * b.q)) / (r * r)). Computing q_b · E_a(b.pos) as the
    // doc comment literally reads rounds (k q_a/r²)·q_b and (k q_b/r²)·q_a differently and fails this.
    const s = add(F12, F21)
    expect(s.x).toBe(0)
    expect(s.y).toBe(0)
    expect(s.z).toBe(0)
    // Sanity on the magnitude: k qa qb r̂ / r² with r̂ from a to b.
    const sep = sub(b.pos, a.pos)
    const r = length(sep)
    const expected = scale(normalize(sep), (K_E * (a.q * b.q)) / (r * r))
    expectVec3Rel(F12, expected, 1e-9, 'F on b due to a')
  })

  it('two equal + charges, E at midpoint = 0 (abs 1e-12 × kq/(d/2)²)', () => {
    const c1: PointCharge = { q, pos: vec3(-d / 2, 0, 0), rc }
    const c2: PointCharge = { q, pos: vec3(d / 2, 0, 0), rc }
    const E = fieldAt([c1, c2], vec3(0, 0, 0))
    const scaleE = (K_E * q) / ((d / 2) * (d / 2))
    expectVec3Abs(E, vec3(0, 0, 0), 1e-12 * scaleE, 'E at midpoint of two + charges')
  })

  it('+ and −, E at midpoint = 2kq/(d/2)² toward − (1e-9 rel)', () => {
    const plus: PointCharge = { q, pos: vec3(-d / 2, 0, 0), rc }
    const minus: PointCharge = { q: -q, pos: vec3(d / 2, 0, 0), rc }
    const E = fieldAt([plus, minus], vec3(0, 0, 0))
    // Both charges push the field in +x at the midpoint (away from +, toward −).
    const expected = vec3((2 * K_E * q) / ((d / 2) * (d / 2)), 0, 0)
    expectVec3Rel(E, expected, 1e-9, 'E at midpoint of + and −')
  })

  it('dipole on axis, exact: 2kpz/(z² − d²/4)² (1e-9 rel)', () => {
    const plus: PointCharge = { q, pos: vec3(0, 0, d / 2), rc }
    const minus: PointCharge = { q: -q, pos: vec3(0, 0, -d / 2), rc }
    const p = q * d
    const z = 0.3
    const E = fieldAt([plus, minus], vec3(0, 0, z))
    // kq/(z−d/2)² − kq/(z+d/2)² = kq·2zd/(z²−d²/4)² = 2kpz/(z²−d²/4)².
    const Ez = (2 * K_E * p * z) / ((z * z - (d * d) / 4) * (z * z - (d * d) / 4))
    expectVec3Rel(E, vec3(0, 0, Ez), 1e-9, 'dipole E on axis')
  })

  it('dipole on axis, far field at z = 20d: 2kp/z³ (0.25% rel)', () => {
    const plus: PointCharge = { q, pos: vec3(0, 0, d / 2), rc }
    const minus: PointCharge = { q: -q, pos: vec3(0, 0, -d / 2), rc }
    const p = q * d
    const z = 20 * d
    const E = fieldAt([plus, minus], vec3(0, 0, z))
    // Exact/approx = 1/(1 − d²/(4z²))² ≈ 1 + d²/(2z²) = 1 + 1/800: truncation 0.125%.
    const Ez = (2 * K_E * p) / (z * z * z)
    expectVec3Rel(E, vec3(0, 0, Ez), 2.5e-3, 'dipole far field')
  })

  it('exponent: 2 explicitly equals the default', () => {
    const c: PointCharge = { q, pos: vec3(0.1, 0.2, 0.3), rc }
    const p = vec3(0.7, -0.4, 0.9)
    expect(fieldAt([c], p, { exponent: 2 })).toEqual(fieldAt([c], p))
    const b: PointCharge = { q: -q, pos: p, rc }
    expect(forceBetween(c, b, { exponent: 2 })).toEqual(forceBetween(c, b))
    expect(forceOn([c, b], b, { exponent: 2 })).toEqual(forceOn([c, b], b))
  })

  it('exponent n = 3 gives kq r̂ / r³ outside rc (1e-9 rel)', () => {
    const r = 2
    const rhat = normalize(vec3(0.36, 0.48, 0.8))
    const c: PointCharge = { q, pos: vec3(0, 0, 0), rc }
    const E = fieldAt([c], scale(rhat, r), { exponent: 3 })
    expectVec3Rel(E, scale(rhat, (K_E * q) / (r * r * r)), 1e-9, 'E with n = 3')
  })

  it('forceOn excludes the target itself: two charges, forceOn equals forceBetween', () => {
    const a: PointCharge = { q: 2e-9, pos: vec3(0.1, 0.2, 0.3), rc }
    // rc = 0 on the target: a self-term would divide 0 by 0 and poison the result with NaN,
    // whereas with rc > 0 the ball kernel at r = 0 would silently contribute the zero vector.
    const b: PointCharge = { q: -3e-9, pos: vec3(0.4, -0.1, 0.7), rc: 0 }
    const net = forceOn([a, b], b)
    expect(Number.isNaN(net.x) || Number.isNaN(net.y) || Number.isNaN(net.z)).toBe(false)
    // Not bit-exact: forceOn may scale a field (q_b·E_a) while forceBetween forms q_a·q_b first for
    // the third-law test, and those round differently by an ulp on most inputs. Tight relative bound.
    expectVec3Rel(net, forceBetween(a, b), 1e-12, 'forceOn with two charges')
    // Three charges: superposition of the two pair forces, same rounding caveat
    // (q_b·(E_a + E_c) vs F_ab + F_cb), so the same tight relative bound.
    const c: PointCharge = { q: 1.5e-9, pos: vec3(-0.3, 0.5, -0.2), rc }
    const net3 = forceOn([a, b, c], b)
    expectVec3Rel(net3, add(forceBetween(a, b), forceBetween(c, b)), 1e-12, 'forceOn with three charges')
  })
})
