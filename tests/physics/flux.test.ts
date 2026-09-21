import { describe, it, expect } from 'vitest'
import {
  cubeSphere,
  makeMorphTargets,
  morph,
  halfMesh,
  meshSolidAngle,
  fluxExact,
  fluxCentroid,
  fluxUniformLoop,
  fluxCenteredSphere,
  vec3,
  scale,
  normalize,
  dot,
  length,
  EPSILON_0,
  K_E,
  type MorphTargets,
  type PointCharge,
  type TriMesh,
  type Vec3,
} from '@lib/physics'
import { expectRel, expectAbs } from './helpers'

// Spec rows: Physics-4B/projects/honors-contract/sims/01-charge-field-flux.md, "Validation tests".
// Every call into lib/physics lives inside an `it` so each row fails on its own with "not implemented".

const R = 1
const BLOB_AMPLITUDE = 0.3
const SUBDIVISIONS = [1, 2, 3, 4, 6, 8]
const MORPH_T = [0, 0.5, 1, 1.5, 2]
const FOUR_PI = 4 * Math.PI

/** cubeSphere(n, R) morphed in place to t, plus the targets so a test can read the safe bounds. */
function morphedMesh(n: number, t: number): { mesh: TriMesh; targets: MorphTargets } {
  const mesh = cubeSphere(n, R)
  const targets = makeMorphTargets(mesh, BLOB_AMPLITUDE)
  morph(mesh.positions, targets, t)
  return { mesh, targets }
}

/**
 * Points provably inside the live mesh at every n and every t.
 * The mesh.ts line "inside if |p| < R(1 − a)" holds for the radial targets, not the flat-faced
 * triangulation: at n = 1, t = 0 the mesh is the cube inscribed in the sphere (half-side R/√3 = 0.577R),
 * so a generic direction at 0.99·R(1 − a) = 0.693R lands outside and ΣΩ is 0, not 4π.
 * Two facts from the mesh.ts doc make the points below safe:
 *   - every vertex stays on its own ray with |v| ≥ R(1 − a) on every target, and the mesh is star-shaped
 *     about the origin, so a point on a CUBE-CORNER ray (a vertex at every n) with |p| < R(1 − a) is inside;
 *   - each face's three vertices come from one cube face, so along that face's axis â each has
 *     v·â ≥ |v|/√3 ≥ R(1 − a)/√3, and so does every point of the triangle (a convex combination); the open
 *     ball |p| < R(1 − a)/√3 is therefore inside in ANY direction, for any blob g with |g| ≤ 1.
 * Independent reference (Van Oosterom sum on a hand-built cube-sphere): Ω/4π = 1 for every point below at
 * n = 1..3, and 0 for the old generic point at 0.99·R(1 − a).
 */
function interiorPoints(targets: MorphTargets): Vec3[] {
  const bound = targets.radius * (1 - targets.amplitude)
  const ball = bound / Math.sqrt(3)
  return [
    vec3(0, 0, 0),
    // generic direction, |p| = 0.27·bound = 0.47·ball
    vec3(0.2 * bound, -0.1 * bound, 0.15 * bound),
    // generic direction at 90% of the provable ball
    scale(normalize(vec3(-0.4, 0.3, -0.5)), 0.9 * ball),
    // cube-corner rays: mid-radius, then two at 99% of the target bound
    scale(normalize(vec3(-1, 1, 1)), 0.6 * bound),
    scale(normalize(vec3(1, -1, 1)), 0.99 * bound),
    scale(normalize(vec3(-1, -1, -1)), 0.99 * bound),
  ]
}

/** Points safely outside every morph target: |p| > R√3 (mesh.ts). First one sits at 101% of the bound. */
function exteriorPoints(targets: MorphTargets): Vec3[] {
  const bound = targets.radius * Math.sqrt(3)
  return [
    scale(normalize(vec3(1, 1, 1)), 1.01 * bound),
    scale(normalize(vec3(1, 0, 0)), 1.01 * bound),
    vec3(2 * bound, -0.5 * bound, 0.25 * bound),
    vec3(-3 * bound, 3 * bound, -3 * bound),
  ]
}

const charge = (q: number, pos: Vec3, rc = 0): PointCharge => ({ q, pos, rc })

describe('flux', () => {
  it('solid angle, closed mesh, interior point: ΣΩ = 4π at every subdivision and every morph value', () => {
    for (const n of SUBDIVISIONS) {
      for (const t of MORPH_T) {
        const { mesh, targets } = morphedMesh(n, t)
        for (const p of interiorPoints(targets)) {
          expectRel(meshSolidAngle(mesh, p), FOUR_PI, 1e-9, `n=${n} t=${t} p=(${p.x},${p.y},${p.z})`)
        }
      }
    }
  })

  it('solid angle, closed mesh, exterior point: ΣΩ = 0 at every subdivision and every morph value', () => {
    for (const n of SUBDIVISIONS) {
      for (const t of MORPH_T) {
        const { mesh, targets } = morphedMesh(n, t)
        for (const p of exteriorPoints(targets)) {
          expectAbs(meshSolidAngle(mesh, p), 0, 1e-9 * FOUR_PI, `n=${n} t=${t} p=(${p.x},${p.y},${p.z})`)
        }
      }
    }
  })

  it('flux, charge anywhere inside = q/ε₀', () => {
    const q = 2.5e-9
    const expected = q / EPSILON_0
    for (const n of SUBDIVISIONS) {
      for (const t of MORPH_T) {
        const { mesh, targets } = morphedMesh(n, t)
        for (const p of interiorPoints(targets)) {
          // rc is deliberately nonzero: flux never uses the ball kernel, so it must not matter.
          expectRel(fluxExact(mesh, [charge(q, p, 0.1 * R)]), expected, 1e-9, `n=${n} t=${t} p=(${p.x},${p.y},${p.z})`)
        }
      }
    }
  })

  it('flux, charge at 1.001R and at 10R outside = 0', () => {
    const q = 2.5e-9
    const bound = 1e-9 * (q / EPSILON_0)
    const directions = [vec3(1, 0, 0), vec3(0, -1, 0), vec3(0, 0, 1), vec3(1, 1, 1), vec3(-2, 1, 3)]
    for (const n of SUBDIVISIONS) {
      // Sphere target (t = 0): every vertex has |v| = R and the flat faces lie inside, so 1.001R is outside.
      const { mesh } = morphedMesh(n, 0)
      for (const d of directions) {
        const u = normalize(d)
        expectAbs(fluxExact(mesh, [charge(q, scale(u, 1.001 * R))]), 0, bound, `n=${n} 1.001R dir=(${d.x},${d.y},${d.z})`)
        expectAbs(fluxExact(mesh, [charge(q, scale(u, 10 * R))]), 0, bound, `n=${n} 10R dir=(${d.x},${d.y},${d.z})`)
        expectAbs(fluxExact(mesh, [charge(-q, scale(u, 10 * R))]), 0, bound, `n=${n} 10R negative dir=(${d.x},${d.y},${d.z})`)
      }
    }
  })

  it('flux, two charges inside = (q₁ + q₂)/ε₀', () => {
    const pairs: Array<[number, number]> = [
      [3e-9, 1e-9],
      [3e-9, -1e-9],
      [-2e-9, -5e-9],
    ]
    for (const n of [1, 3, 8]) {
      for (const t of MORPH_T) {
        const { mesh, targets } = morphedMesh(n, t)
        const pts = interiorPoints(targets)
        const p1 = pts[1]! // small generic point
        const p2 = pts[4]! // corner ray at 99% of R(1 − a), near the surface at t = 2
        for (const [q1, q2] of pairs) {
          const expected = (q1 + q2) / EPSILON_0
          expectRel(fluxExact(mesh, [charge(q1, p1), charge(q2, p2)]), expected, 1e-9, `n=${n} t=${t} q1=${q1} q2=${q2}`)
        }
      }
    }
  })

  it('flux, hemisphere with the charge in the bowl = exact half-mesh Ω sum', () => {
    const q = 4e-9
    const bowlPoints = [vec3(0, 0, 0.3 * R), vec3(0.1 * R, -0.2 * R, 0.4 * R), vec3(-0.3 * R, 0.25 * R, 0.05 * R)]
    for (const n of SUBDIVISIONS) {
      const half = halfMesh(cubeSphere(n, R), true)
      for (const p of bowlPoints) {
        // Φ = q·Ω/(4πε₀) is the per-face law summed over the open half; the half's Ω is the partial sum.
        const expected = (q * meshSolidAngle(half, p)) / (FOUR_PI * EPSILON_0)
        expectRel(fluxExact(half, [charge(q, p)]), expected, 1e-9, `n=${n} p=(${p.x},${p.y},${p.z})`)
      }
    }
  })

  it('flux, hemisphere: centered charge on the sphere target with even n sees Ω = 2π from the half mesh', () => {
    // Even n puts a grid line on z = 0, so the z ≥ 0 half is exactly half the sphere by symmetry.
    for (const n of [2, 4, 6, 8]) {
      const half = halfMesh(cubeSphere(n, R), true)
      expectRel(meshSolidAngle(half, vec3(0, 0, 0)), 2 * Math.PI, 1e-9, `n=${n}`)
    }
  })

  it('centroid toy, centered charge: within 5% at subdivision 3 and within 0.5% at subdivision 10', () => {
    // Measured on two independent references with exact Coulomb E (2026-09-20): the error is clean O(h²),
    // n²·err ≈ 0.406 for both quad diagonals, so n = 3 gives 4.475% and 0.5% first holds at n = 10 (0.406%).
    // The plan's table row says the same (it originally claimed 0.5% at n = 3, which was a guess).
    const q = 1e-9
    expectRel(fluxCentroid(cubeSphere(3, R), [charge(q, vec3(0, 0, 0))]), q / EPSILON_0, 5e-2, 'n=3')
    expectRel(fluxCentroid(cubeSphere(10, R), [charge(q, vec3(0, 0, 0))]), q / EPSILON_0, 5e-3, 'n=10')
  })

  it('centroid toy converges: error at n+1 < error at n for n = 1..5', () => {
    const q = 1e-9
    const exact = q / EPSILON_0
    const errors: number[] = []
    for (let n = 1; n <= 6; n++) {
      const mesh = cubeSphere(n, R)
      errors.push(Math.abs(fluxCentroid(mesh, [charge(q, vec3(0, 0, 0))]) - exact))
    }
    for (let n = 1; n <= 5; n++) {
      const errN = errors[n - 1]!
      const errNext = errors[n]!
      expect(errNext, `error at n=${n + 1} (${errNext}) should be below error at n=${n} (${errN})`).toBeLessThan(errN)
    }
  })

  it('flat loop in uniform E = EA cos θ', () => {
    const E0 = 500
    const E = vec3(0, 0, E0)
    const area = 0.25
    // Unit normal tilted by θ from E in the xz-plane: Φ = E A cos θ.
    for (const theta of [0, Math.PI / 6, Math.PI / 4, Math.PI / 3, (2 * Math.PI) / 3, Math.PI]) {
      const normal = vec3(Math.sin(theta), 0, Math.cos(theta))
      expectRel(fluxUniformLoop(E, area, normal), E0 * area * Math.cos(theta), 1e-12, `θ=${theta}`)
    }
    // θ = π/2: cos is ~6e-17 in floats, so compare against 0 at the 1e-12 × EA scale.
    expectAbs(fluxUniformLoop(E, area, vec3(1, 0, 0)), 0, 1e-12 * E0 * area, 'θ=π/2')
    // Non-unit normal (3, 0, 4): normalized to (0.6, 0, 0.8), so cos θ = 0.8 regardless of its length.
    expectRel(fluxUniformLoop(E, area, vec3(3, 0, 4)), E0 * area * 0.8, 1e-12, 'non-unit normal')
    expectRel(fluxUniformLoop(E, area, vec3(30, 0, 40)), E0 * area * 0.8, 1e-12, 'non-unit normal ×10')
    // General E and general normal: E · n̂ · A with cos θ = (E · n)/(|E||n|).
    const Eg = vec3(120, -340, 75)
    const ng = vec3(-2, 1, 0.5)
    const cosTheta = dot(Eg, ng) / (length(Eg) * length(ng))
    expectRel(fluxUniformLoop(Eg, area, ng), length(Eg) * area * cosTheta, 1e-12, 'general E and normal')
  })

  it('exponent toggle, n = 3, centered sphere: Φ ∝ 1/r', () => {
    const q = 3e-9
    for (const r of [0.5, 1, 2.5]) {
      const atR = fluxCenteredSphere(q, r, 3)
      const at2R = fluxCenteredSphere(q, 2 * r, 3)
      // Φ ∝ 1/r, so doubling r halves the flux.
      expectRel(atR, 2 * at2R, 1e-9, `r=${r} vs 2r`)
      // Closed form: E · 4πr² with E = k q / r³ gives 4π k q / r.
      expectRel(atR, (FOUR_PI * K_E * q) / r, 1e-9, `r=${r} closed form`)
    }
  })

  it('exponent toggle, n = 2 (and the default), centered sphere = q/ε₀', () => {
    const q = 3e-9
    const expected = q / EPSILON_0
    for (const r of [0.5, 1, 2.5]) {
      // 4π k q r⁰ = q/ε₀ up to the ~6e-11 agreement between K_E and 1/(4π ε₀) noted in constants.ts.
      expectRel(fluxCenteredSphere(q, r, 2), expected, 1e-9, `r=${r} n=2`)
      expectRel(fluxCenteredSphere(q, r), expected, 1e-9, `r=${r} default exponent`)
    }
  })
})

describe('flux: review regressions (2026-09-20)', () => {
  it('fluxExact refuses the exponent toggle (n ≠ 2) instead of returning q/ε₀, and n = 2 explicit equals the default', () => {
    const mesh = cubeSphere(4, R)
    const charges = [charge(1e-9, vec3(0.1, -0.2, 0.05))]
    expect(() => fluxExact(mesh, charges, { exponent: 3 })).toThrow(/exponent 2/)
    expect(fluxExact(mesh, charges, { exponent: 2 })).toBe(fluxExact(mesh, charges))
  })
})
