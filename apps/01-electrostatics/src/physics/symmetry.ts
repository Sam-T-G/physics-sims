// Beat 6: a charge inside a sphere, |E| on the surface, when Gauss hands you E. Layer 1.
import { cubeSphere, faceCentroid, fieldAt, fluxExact, length, type PointCharge, type TriMesh } from '@lib/physics'

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
