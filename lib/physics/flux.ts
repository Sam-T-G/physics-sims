import type { Vec3 } from './vec3'
import { EPSILON_0, K_E } from './constants'
import { fieldAt, type PointCharge, type FieldOptions } from './charges'
import type { TriMesh } from './mesh'
import { meshSolidAngle } from './solidAngle'

/**
 * Exact electric flux (V·m) through the mesh: Σ over charges of q · meshSolidAngle(mesh, pos) / (4π ε₀).
 * For a closed outward-wound mesh this is (Σ enclosed q)/ε₀ exactly, independent of shape, position,
 * and subdivision, for any charge position off the surface (a charge exactly on a face or vertex is a
 * physical discontinuity and rounds either way; layer 2 nudges a dragged charge off the live surface).
 * Never uses the ball kernel and never uses a stored constant. Valid only in our universe: the solid-angle
 * identity is the 1/r² law, so an exponent other than 2 throws instead of quietly returning q/ε₀.
 */
export function fluxExact(mesh: TriMesh, charges: readonly PointCharge[], opts: FieldOptions = {}): number {
  const n = opts.exponent ?? 2
  if (n !== 2) throw new RangeError(`fluxExact is exact only for exponent 2 (got ${n}); use fluxCentroid or fluxCenteredSphere for the toggle`)
  let sum = 0
  for (const c of charges) sum += (c.q * meshSolidAngle(mesh, c.pos)) / (4 * Math.PI * EPSILON_0)
  return sum
}

/**
 * Centroid quadrature Σ_faces E(centroid) · n̂ · A, the beat-4 convergence toy only.
 * Uses the exact Coulomb field (every charge treated as rc = 0), so the kernel never touches flux.
 * Converges to fluxExact as the subdivision grows; its limit line on screen is the exact value.
 */
export function fluxCentroid(mesh: TriMesh, charges: readonly PointCharge[], opts: FieldOptions = {}): number {
  const bare = charges.map(c => ({ q: c.q, pos: c.pos, rc: 0 }))
  const P = mesh.positions
  const I = mesh.index
  const centroid = { x: 0, y: 0, z: 0 }
  let sum = 0
  for (let f = 0; f < mesh.faceCount; f++) {
    const ia = 3 * I[3 * f]!
    const ib = 3 * I[3 * f + 1]!
    const ic = 3 * I[3 * f + 2]!
    const ax = P[ia]!, ay = P[ia + 1]!, az = P[ia + 2]!
    const ux = P[ib]! - ax, uy = P[ib + 1]! - ay, uz = P[ib + 2]! - az
    const vx = P[ic]! - ax, vy = P[ic + 1]! - ay, vz = P[ic + 2]! - az
    // N = (B − A) × (C − A) has |N| = 2·area and points along the outward normal, so E·n̂·A = E·N / 2.
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    centroid.x = (ax + P[ib]! + P[ic]!) / 3
    centroid.y = (ay + P[ib + 1]! + P[ic + 1]!) / 3
    centroid.z = (az + P[ib + 2]! + P[ic + 2]!) / 3
    const E = fieldAt(bare, centroid, opts)
    sum += (E.x * nx + E.y * ny + E.z * nz) / 2
  }
  return sum
}

/** Flux through a flat loop of the given area in a uniform field: E · n̂ · A. normal is normalized first. */
export function fluxUniformLoop(E: Vec3, area: number, normal: Vec3): number {
  const l = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z)
  if (l === 0) return 0
  return ((E.x * normal.x + E.y * normal.y + E.z * normal.z) / l) * area
}

/**
 * Analytic flux through a sphere of radius r centered on q, for the exponent toggle:
 * E(r) · 4πr² with E = k q / rⁿ, i.e. 4π k q r^(2−n). Equals q/ε₀ (to ~6e-11 relative, see constants)
 * at n = 2 and is ∝ 1/r at n = 3.
 */
export function fluxCenteredSphere(q: number, r: number, exponent = 2): number {
  return 4 * Math.PI * K_E * q * Math.pow(r, 2 - exponent)
}
