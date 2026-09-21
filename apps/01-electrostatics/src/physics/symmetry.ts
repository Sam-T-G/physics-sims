// Beat 6: a charge inside a sphere, |E| on the surface, when Gauss hands you E. Layer 1.
import { K_E, cubeSphere, faceCentroid, fieldAt, fluxExact, length, type PointCharge, type TriMesh } from '@lib/physics'

/** Slider range for the charge's offset from the center, m (the sphere has R = 1 m). */
export const MAX_OFFSET = 0.8
/**
 * Keeps the + and − of the dipole apart: at zero they cancel exactly and E vanishes, and below about 0.16 m its
 * weakest field drops under the color scale's floor. At 0.2 m the weakest |E| is about 3.4 N/C.
 */
export const MIN_DIPOLE_OFFSET = 0.2

export type Symmetry = {
  mesh: TriMesh
  /** Primary charge x, slider; the dipole partner sits at −x with −q. */
  x: number
  dipole: boolean
  charges(): PointCharge[]
  flux(): number
  /** |E| at every face centroid; returns [min, max]. */
  faceMagnitudes(out: Float64Array): [number, number]
  /** How uniform |E| is over the surface: (max − min)/max, 0 when the charge is centered. */
  spread(): number
  /**
   * The fixed |E| range the surface colors use: weakest and strongest |E| anywhere on the sphere with one charge
   * at the slider's farthest offset (kq/(R + x)² and kq/(R − x)²). Fixed, so a nearly centered charge really
   * looks nearly uniform instead of being stretched to full contrast.
   */
  colorRange(): [number, number]
  set(patch: Partial<Pick<Symmetry, 'x' | 'dipole'>>): void
  reset(): void
}

export function createSymmetry(): Symmetry {
  const mesh = cubeSphere(8, 1)
  // |E| is sampled where each flat patch's direction meets the true sphere, so the picture is the sphere's:
  // a centered charge reads exactly uniform instead of the 2% sag of the flat patches.
  const centroids: { x: number; y: number; z: number }[] = []
  for (let f = 0; f < mesh.faceCount; f++) {
    const c = faceCentroid(mesh, f)
    const r = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z) || 1
    centroids.push({ x: c.x / r, y: c.y / r, z: c.z / r })
  }
  const scratch = new Float64Array(mesh.faceCount)
  const s: Symmetry = {
    mesh,
    x: 0.55,
    dipole: false,
    charges() {
      const list: PointCharge[] = [{ q: 1e-9, pos: { x: s.x, y: 0, z: 0 }, rc: 0.04 }]
      if (s.dipole) list.push({ q: -1e-9, pos: { x: -s.x, y: 0, z: 0 }, rc: 0.04 })
      return list
    },
    flux: () => fluxExact(mesh, s.charges()),
    faceMagnitudes(out) {
      const cs = s.charges()
      let min = Infinity
      let max = 0
      for (let f = 0; f < mesh.faceCount; f++) {
        const m = length(fieldAt(cs, centroids[f]!))
        out[f] = m
        if (m < min) min = m
        if (m > max) max = m
      }
      return [min, max]
    },
    colorRange() {
      const kq = K_E * 1e-9
      return [kq / (1 + MAX_OFFSET) ** 2, kq / (1 - MAX_OFFSET) ** 2]
    },
    spread() {
      const [min, max] = s.faceMagnitudes(scratch)
      return max === 0 ? 0 : (max - min) / max
    },
    set(patch) {
      Object.assign(s, patch)
    },
    reset() {
      s.x = 0.55
      s.dipole = false
    },
  }
  return s
}
