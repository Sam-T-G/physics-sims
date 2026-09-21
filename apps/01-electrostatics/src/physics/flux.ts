// Beat 4: a flat loop in a uniform field, two loops in one bundle, and the hemisphere toy. Layer 1.
import {
  EPSILON_0,
  cubeSphere,
  fieldAt,
  fluxCentroid,
  fluxExact,
  fluxUniformLoop,
  halfMesh,
  radialRays,
  triangleSolidAngle,
  type FieldLine,
  type PointCharge,
  type TriMesh,
  type Vec3,
} from '@lib/physics'

export const UNIFORM_E = 200 // N/C, along +x
export const LINE_SPACING = 0.12 // m between drawn lines in the uniform region
export const LINE_HALF_EXTENT = 0.6 // the region spans ±this in y and z
export const LINE_LENGTH = 2.4

export type FluxLoop = {
  /** Side of the square loop, m. */
  side: number
  /** Tilt of n̂ away from E, degrees, 0..180. */
  thetaDeg: number
  /** n̂ is a choice for an open surface; flipped points it the other way, and Φ changes sign. */
  flipped: boolean
  normal(): Vec3
  area(): number
  /** Φ = E·n̂·A, exact. */
  flux(): number
  /** The drawn lines are a fixed grid; this counts the ones that pass through the tilted loop. */
  linesThrough(): number
  /** The grid lines as segments, for drawing. */
  gridLines(): FieldLine[]
  set(patch: Partial<Pick<FluxLoop, 'side' | 'thetaDeg' | 'flipped'>>): void
  reset(): void
}

export type BundleLoops = {
  charge: PointCharge
  /** Near loop: distance d1, side a1; far loop at 2·d1 with side 2·a1 (same solid angle). */
  d1: number
  a1: number
  /** Exact flux through each square loop, by solid angle. Equal by construction, and computed anyway. */
  fluxes(): { near: number; far: number }
  /** The bundle: one ray from the charge through the center of each cell of a 5 × 5 grid on the near loop. */
  rays: FieldLine[]
  /** The rest of the charge's lines, drawn faint for context. */
  background: FieldLine[]
  /** How many of the drawn rays pass through each loop. */
  raysThrough(): { near: number; far: number }
  loopCorners(which: 'near' | 'far'): Vec3[]
}

export type Bowl = {
  /** Subdivision 1..5 of the bowl meshes, all preallocated. */
  n: number
  meshes: TriMesh[]
  charge: PointCharge
  /** Charge height in the bowl (z), slider. */
  z: number
  current(): TriMesh
  /** Σ E(centroid)·n̂ A over the current bowl: the toy. */
  centroidSum(): number
  /** The exact partial flux through the current bowl. */
  exact(): number
  /**
   * Exact flux through the smooth unit hemisphere the patches approximate, charge on the axis at depth h:
   * the bowl plus the flat disk over its rim enclose the charge, the disk takes Ω = 2π(1 − h/√(1 + h²)),
   * so the bowl gets 2π(1 + h/√(1 + h²)) and Φ = q·Ω/(4πε₀). This is the line the patch sums walk toward.
   */
  smoothExact(): number
  /** Centroid sums for every subdivision, for the convergence plot. */
  series(): { x: number; y: number }[]
  /** Per-face E·n̂ dA on the current bowl for the coloring. */
  faceFlux(out: Float64Array): number
  set(patch: Partial<Pick<Bowl, 'n' | 'z'>>): void
  reset(): void
}

export function createFluxLoop(): FluxLoop {
  const s: FluxLoop = {
    side: 0.5,
    thetaDeg: 0,
    flipped: false,
    normal() {
      const t = (s.thetaDeg * Math.PI) / 180
      const f = s.flipped ? -1 : 1
      return { x: f * Math.cos(t), y: f * Math.sin(t), z: 0 }
    },
    area: () => s.side * s.side,
    flux: () => fluxUniformLoop({ x: UNIFORM_E, y: 0, z: 0 }, s.area(), s.normal()),
    linesThrough() {
      // Lines run along x through (y, z) grid points. The loop, tilted by θ about z, projects onto the
      // y-z plane as a rectangle a|cos θ| by a, centered on the origin.
      // Open loop: a line exactly in the loop's plane (edge-on) brushes past and does not count.
      const t = (s.thetaDeg * Math.PI) / 180
      const halfY = (s.side * Math.abs(Math.cos(t))) / 2
      const halfZ = s.side / 2
      if (halfY < 1e-6) return 0
      let count = 0
      for (const y of gridCoords()) for (const z of gridCoords()) if (Math.abs(y) < halfY + 1e-9 && Math.abs(z) < halfZ + 1e-9) count++
      return count
    },
    gridLines() {
      const out: FieldLine[] = []
      for (const y of gridCoords())
        for (const z of gridCoords())
          out.push({ points: [{ x: -LINE_LENGTH / 2, y, z }, { x: LINE_LENGTH / 2, y, z }], end: 'box' })
      return out
    },
    set(patch) {
      Object.assign(s, patch)
    },
    reset() {
      s.side = 0.5
      s.thetaDeg = 0
      s.flipped = false
    },
  }
  return s
}

function gridCoords(): number[] {
  const out: number[] = []
  const k = Math.floor(LINE_HALF_EXTENT / LINE_SPACING)
  for (let i = -k; i <= k; i++) out.push(i * LINE_SPACING)
  return out
}

export function createBundleLoops(): BundleLoops {
  const charge: PointCharge = { q: 1e-9, pos: { x: 0, y: 0, z: 0 }, rc: 0.04 }
  const s: BundleLoops = {
    charge,
    d1: 0.5,
    a1: 0.3,
    rays: [],
    background: radialRays(charge, 48, 2.2),
    fluxes() {
      const near = squareFlux(s.loopCorners('near'))
      const far = squareFlux(s.loopCorners('far'))
      return { near, far }
    },
    raysThrough() {
      let near = 0
      let far = 0
      for (const ray of s.rays) {
        const d = ray.points[ray.points.length - 1]!
        if (rayHitsSquare(d, s.d1, s.a1)) near++
        if (rayHitsSquare(d, 2 * s.d1, 2 * s.a1)) far++
      }
      return { near, far }
    },
    loopCorners(which) {
      const d = which === 'near' ? s.d1 : 2 * s.d1
      const h = (which === 'near' ? s.a1 : 2 * s.a1) / 2
      // Square in the plane x = d, facing the charge at the origin, wound so its normal points +x (away).
      return [
        { x: d, y: -h, z: -h },
        { x: d, y: h, z: -h },
        { x: d, y: h, z: h },
        { x: d, y: -h, z: h },
      ]
    },
  }
  // The bundle: rays from the charge through the 25 cell centers of the near loop, long enough to pass the far one.
  const cells = 5
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      const y = -s.a1 / 2 + ((i + 0.5) * s.a1) / cells
      const z = -s.a1 / 2 + ((j + 0.5) * s.a1) / cells
      const reach = 2.6 / Math.sqrt(s.d1 * s.d1 + y * y + z * z)
      s.rays.push({ points: [{ x: 0, y: 0, z: 0 }, { x: s.d1 * reach, y: y * reach, z: z * reach }], end: 'box' })
    }
  }
  /** Exact flux of the 1 nC charge at the origin through a square: q·Ω/(4πε₀) with Ω from two triangles. */
  function squareFlux(c: Vec3[]): number {
    const omega = triangleSolidAngle(c[0]!, c[1]!, c[2]!) + triangleSolidAngle(c[0]!, c[2]!, c[3]!)
    return (charge.q * omega) / (4 * Math.PI * EPSILON_0)
  }
  function rayHitsSquare(p: Vec3, d: number, a: number): boolean {
    // The ray from the origin through p meets the plane x = d at t = d/p.x (needs p.x > 0).
    if (p.x <= 0) return false
    const t = d / p.x
    return Math.abs(p.y * t) <= a / 2 && Math.abs(p.z * t) <= a / 2
  }
  return s
}

export function createBowl(): Bowl {
  const meshes = [1, 2, 3, 4, 5].map(n => halfMesh(cubeSphere(n, 1), false))
  const charge: PointCharge = { q: 1e-9, pos: { x: 0, y: 0, z: -0.3 }, rc: 0.04 }
  const s: Bowl = {
    n: 3,
    meshes,
    charge,
    z: -0.3,
    current: () => meshes[s.n - 1]!,
    centroidSum: () => fluxCentroid(s.current(), [charge]),
    exact: () => fluxExact(s.current(), [charge]),
    smoothExact() {
      const h = Math.abs(s.z)
      const omega = 2 * Math.PI * (1 + h / Math.sqrt(1 + h * h))
      return (charge.q * omega) / (4 * Math.PI * EPSILON_0)
    },
    series: () => meshes.map((m, i) => ({ x: i + 1, y: fluxCentroid(m, [charge]) })),
    faceFlux(out) {
      const m = s.current()
      const P = m.positions
      const I = m.index
      let max = 0
      for (let f = 0; f < m.faceCount; f++) {
        const ia = 3 * I[3 * f]!
        const ib = 3 * I[3 * f + 1]!
        const ic = 3 * I[3 * f + 2]!
        const ax = P[ia]!, ay = P[ia + 1]!, az = P[ia + 2]!
        const ux = P[ib]! - ax, uy = P[ib + 1]! - ay, uz = P[ib + 2]! - az
        const vx = P[ic]! - ax, vy = P[ic + 1]! - ay, vz = P[ic + 2]! - az
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        const cx = (ax + P[ib]! + P[ic]!) / 3, cy = (ay + P[ib + 1]! + P[ic + 1]!) / 3, cz = (az + P[ib + 2]! + P[ic + 2]!) / 3
        const E = fieldAt([{ q: charge.q, pos: charge.pos, rc: 0 }], { x: cx, y: cy, z: cz })
        const phi = (E.x * nx + E.y * ny + E.z * nz) / 2
        out[f] = phi
        if (Math.abs(phi) > max) max = Math.abs(phi)
      }
      return max
    },
    set(patch) {
      if (patch.n !== undefined) s.n = Math.min(5, Math.max(1, Math.round(patch.n)))
      if (patch.z !== undefined) {
        s.z = patch.z
        charge.pos = { x: 0, y: 0, z: patch.z }
      }
    },
    reset() {
      s.set({ n: 3, z: -0.3 })
    },
  }
  return s
}
