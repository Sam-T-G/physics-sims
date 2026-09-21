import type { Vec3 } from './vec3'
import type { TriMesh } from './mesh'

function vosOmega(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): number {
  const la = Math.sqrt(ax * ax + ay * ay + az * az)
  const lb = Math.sqrt(bx * bx + by * by + bz * bz)
  const lc = Math.sqrt(cx * cx + cy * cy + cz * cz)
  const num = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)
  const den = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (ax * cx + ay * cy + az * cz) * lb + (bx * cx + by * cy + bz * cz) * la
  return 2 * Math.atan2(num, den)
}

/**
 * Signed solid angle (sr) subtended by triangle (a, b, c) at the origin, with a, b, c already measured
 * from the observation point. Van Oosterom and Strackee (1983):
 *   Ω = 2·atan2( a·(b×c), |a||b||c| + (a·b)|c| + (a·c)|b| + (b·c)|a| )
 * Sign follows the winding: positive when the triangle is wound counter-clockwise as seen from the
 * point, which is the outward winding of a closed mesh viewed from inside. Exact, no quadrature.
 */
export function triangleSolidAngle(a: Vec3, b: Vec3, c: Vec3): number {
  return vosOmega(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
}

/**
 * Σ over faces of triangleSolidAngle(A − p, B − p, C − p). Closed outward-wound mesh: 4π for any p
 * inside, 0 for any p outside, at any subdivision and any morph value. Open mesh: the partial sum.
 * Allocation-free: this runs over the live mesh every frame.
 */
export function meshSolidAngle(mesh: TriMesh, p: Vec3): number {
  const P = mesh.positions
  const I = mesh.index
  let sum = 0
  for (let f = 0; f < mesh.faceCount; f++) {
    const ia = 3 * I[3 * f]!
    const ib = 3 * I[3 * f + 1]!
    const ic = 3 * I[3 * f + 2]!
    sum += vosOmega(
      P[ia]! - p.x, P[ia + 1]! - p.y, P[ia + 2]! - p.z,
      P[ib]! - p.x, P[ib + 1]! - p.y, P[ib + 2]! - p.z,
      P[ic]! - p.x, P[ic + 1]! - p.y, P[ic + 2]! - p.z,
    )
  }
  return sum
}
