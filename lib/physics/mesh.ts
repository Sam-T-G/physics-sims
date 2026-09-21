import type { Vec3 } from './vec3'

/**
 * Indexed triangle mesh owned by layer 1. positions is xyz-interleaved (length 3·vertexCount),
 * index holds three vertex ids per face (length 3·faceCount). Winding is counter-clockwise seen
 * from outside, so faceNormal points outward for a closed surface.
 */
export type TriMesh = {
  positions: Float64Array
  index: Uint32Array
  vertexCount: number
  faceCount: number
}

// Right-handed local frames (right × up = normal) for the six cube faces. Quads (i,j),(i+1,j),(i+1,j+1),(i,j+1)
// in the (right, up) plane are then counter-clockwise seen from outside on every face.
const FACES: ReadonlyArray<{ n: Vec3; r: Vec3; u: Vec3 }> = [
  { n: { x: 0, y: 0, z: 1 }, r: { x: 1, y: 0, z: 0 }, u: { x: 0, y: 1, z: 0 } },
  { n: { x: 0, y: 0, z: -1 }, r: { x: 0, y: 1, z: 0 }, u: { x: 1, y: 0, z: 0 } },
  { n: { x: 1, y: 0, z: 0 }, r: { x: 0, y: 1, z: 0 }, u: { x: 0, y: 0, z: 1 } },
  { n: { x: -1, y: 0, z: 0 }, r: { x: 0, y: 0, z: 1 }, u: { x: 0, y: 1, z: 0 } },
  { n: { x: 0, y: 1, z: 0 }, r: { x: 0, y: 0, z: 1 }, u: { x: 1, y: 0, z: 0 } },
  { n: { x: 0, y: -1, z: 0 }, r: { x: 1, y: 0, z: 0 }, u: { x: 0, y: 0, z: 1 } },
]

/**
 * Cube-sphere of the given radius: six cube faces, each an n×n grid of quads (two triangles each),
 * every grid point projected radially onto the sphere. Edges and corners are welded, so the mesh is
 * closed with V = 6n² + 2 vertices, F = 12n² faces, E = 18n² edges, each edge shared by exactly two
 * faces in opposite directions. n ≥ 1. Vertex order is unspecified; use the index.
 */
export function cubeSphere(n: number, radius: number): TriMesh {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`cubeSphere: n must be a positive integer, got ${n}`)
  const V = 6 * n * n + 2
  const F = 12 * n * n
  const positions = new Float64Array(3 * V)
  const index = new Uint32Array(3 * F)
  // Weld by the integer grid coordinate on the cube: gx, gy, gz ∈ 0..n, at least one of them 0 or n.
  const ids = new Map<number, number>()
  let nextId = 0
  let nextFace = 0
  const stride = n + 1
  const vertexId = (face: { n: Vec3; r: Vec3; u: Vec3 }, i: number, j: number): number => {
    // Cube point in units where the cube is [-1, 1]³, as exact integer grid coordinates 0..n.
    const ci = 2 * i - n // -n..n along right
    const cj = 2 * j - n // -n..n along up
    const gx = ((face.n.x * n + face.r.x * ci + face.u.x * cj) + n) / 2
    const gy = ((face.n.y * n + face.r.y * ci + face.u.y * cj) + n) / 2
    const gz = ((face.n.z * n + face.r.z * ci + face.u.z * cj) + n) / 2
    const key = gx + stride * (gy + stride * gz)
    const found = ids.get(key)
    if (found !== undefined) return found
    const id = nextId++
    ids.set(key, id)
    const x = (2 * gx) / n - 1
    const y = (2 * gy) / n - 1
    const z = (2 * gz) / n - 1
    const s = radius / Math.sqrt(x * x + y * y + z * z)
    positions[3 * id] = x * s
    positions[3 * id + 1] = y * s
    positions[3 * id + 2] = z * s
    return id
  }
  for (const face of FACES) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = vertexId(face, i, j)
        const b = vertexId(face, i + 1, j)
        const c = vertexId(face, i + 1, j + 1)
        const d = vertexId(face, i, j + 1)
        index[3 * nextFace] = a
        index[3 * nextFace + 1] = b
        index[3 * nextFace + 2] = c
        nextFace++
        index[3 * nextFace] = a
        index[3 * nextFace + 1] = c
        index[3 * nextFace + 2] = d
        nextFace++
      }
    }
  }
  if (nextId !== V || nextFace !== F) throw new Error(`cubeSphere: welded ${nextId} vertices, ${nextFace} faces; expected ${V}, ${F}`)
  return { positions, index, vertexCount: V, faceCount: F }
}

/** Position arrays for the three morph targets, plus the numbers a caller needs to pick safe test points. */
export type MorphTargets = {
  sphere: Float64Array
  cube: Float64Array
  blob: Float64Array
  /** The sphere radius R read off the input mesh. */
  radius: number
  /** The blob amplitude a actually used, after clamping to [0, 0.5]. */
  amplitude: number
}

/** The blob's shape function on the unit sphere: g = 3√3·x·y·z, a degree-3 harmonic with |g| ≤ 1. */
const blobShape = (x: number, y: number, z: number): number => 3 * Math.sqrt(3) * x * y * z

/**
 * Builds the three targets from a cube-sphere. Every target keeps each vertex on its own ray from
 * the origin, so any blend of them is star-shaped about the origin, closed, and consistently wound:
 *   sphere: the input positions (|v| = R).
 *   cube:   each vertex scaled onto the cube |x|,|y|,|z| ≤ R (max-norm = R), i.e. the grid point it
 *           was projected from. Radial extent R (face centers) to R·√3 (corners).
 *   blob:   r(d̂) = R·(1 + a·g(d̂)) with g a fixed smooth function, |g| ≤ 1, a = clamp(blobAmplitude, 0, 0.5).
 *           Radial extent R(1 − a) to R(1 + a). Never self-intersects (radial graph over the sphere).
 * The flat faces sag inward between vertices, badly at coarse subdivision (the sphere target at n = 1 is
 * a cube inscribed in the sphere, inradius R/√3; n = 2, 3, 8 give 0.844R, 0.905R, 0.985R). The bound that
 * holds for EVERY n and t: each vertex on cube face â has v·â ≥ |v|/√3 ≥ R(1 − a)/√3, and so does every
 * point of every face (a convex combination), so the surface never comes closer to the origin than
 * R(1 − a)/√3. Safe test points: inside if |p| < R(1 − a)/√3; outside if |p| > R·√3.
 */
export function makeMorphTargets(mesh: TriMesh, blobAmplitude: number): MorphTargets {
  const P = mesh.positions
  const V = mesh.vertexCount
  const radius = Math.sqrt(P[0]! * P[0]! + P[1]! * P[1]! + P[2]! * P[2]!)
  const amplitude = Math.min(0.5, Math.max(0, blobAmplitude))
  const sphere = P.slice()
  const cube = new Float64Array(3 * V)
  const blob = new Float64Array(3 * V)
  for (let v = 0; v < V; v++) {
    const x = P[3 * v]!
    const y = P[3 * v + 1]!
    const z = P[3 * v + 2]!
    const m = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
    const sc = radius / m
    cube[3 * v] = x * sc
    cube[3 * v + 1] = y * sc
    cube[3 * v + 2] = z * sc
    const r = Math.sqrt(x * x + y * y + z * z)
    const ux = x / r
    const uy = y / r
    const uz = z / r
    const rb = radius * (1 + amplitude * blobShape(ux, uy, uz))
    blob[3 * v] = ux * rb
    blob[3 * v + 1] = uy * rb
    blob[3 * v + 2] = uz * rb
  }
  return { sphere, cube, blob, radius, amplitude }
}

/**
 * Writes the blended positions into out (length 3·vertexCount). t ∈ [0, 2]:
 * 0 = sphere, 1 = cube, 2 = blob, linear in between (0..1 sphere→cube, 1..2 cube→blob). t is clamped.
 * Endpoints reproduce the targets exactly: the blend is (1 − s)·A + s·B.
 */
export function morph(out: Float64Array, targets: MorphTargets, t: number): void {
  const tc = Math.min(2, Math.max(0, t))
  const A = tc <= 1 ? targets.sphere : targets.cube
  const B = tc <= 1 ? targets.cube : targets.blob
  const s = tc <= 1 ? tc : tc - 1
  const w = 1 - s
  const len = out.length
  for (let i = 0; i < len; i++) out[i] = w * A[i]! + s * B[i]!
}

function corners(mesh: TriMesh, i: number): [number, number, number, number, number, number, number, number, number] {
  const P = mesh.positions
  const ia = 3 * mesh.index[3 * i]!
  const ib = 3 * mesh.index[3 * i + 1]!
  const ic = 3 * mesh.index[3 * i + 2]!
  return [P[ia]!, P[ia + 1]!, P[ia + 2]!, P[ib]!, P[ib + 1]!, P[ib + 2]!, P[ic]!, P[ic + 1]!, P[ic + 2]!]
}

/** Unit normal of face i from its winding: normalize((B − A) × (C − A)). Outward on a closed mesh. */
export function faceNormal(mesh: TriMesh, i: number): Vec3 {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = corners(mesh, i)
  const ux = bx - ax
  const uy = by - ay
  const uz = bz - az
  const vx = cx - ax
  const vy = cy - ay
  const vz = cz - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz)
  return l === 0 ? { x: 0, y: 0, z: 0 } : { x: nx / l, y: ny / l, z: nz / l }
}

/** (A + B + C) / 3 for face i. */
export function faceCentroid(mesh: TriMesh, i: number): Vec3 {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = corners(mesh, i)
  return { x: (ax + bx + cx) / 3, y: (ay + by + cy) / 3, z: (az + bz + cz) / 3 }
}

/** |(B − A) × (C − A)| / 2 for face i, in m². */
export function faceArea(mesh: TriMesh, i: number): number {
  const [ax, ay, az, bx, by, bz, cx, cy, cz] = corners(mesh, i)
  const ux = bx - ax
  const uy = by - ay
  const uz = bz - az
  const vx = cx - ax
  const vy = cy - ay
  const vz = cz - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2
}

/**
 * closed is true iff every directed edge (a→b) appears exactly once and its reverse (b→a) exactly once.
 * badEdges counts undirected edges that violate that (boundary edges, non-manifold edges, or two faces
 * wound the same way across an edge). A hemisphere from halfMesh has badEdges > 0 and closed = false.
 */
export function checkClosed(mesh: TriMesh): { closed: boolean; badEdges: number } {
  const V = mesh.vertexCount
  const directed = new Map<number, number>()
  const key = (a: number, b: number): number => a * V + b
  const I = mesh.index
  for (let f = 0; f < mesh.faceCount; f++) {
    const a = I[3 * f]!
    const b = I[3 * f + 1]!
    const c = I[3 * f + 2]!
    for (const [s, t] of [[a, b], [b, c], [c, a]] as const) {
      const k = key(s, t)
      directed.set(k, (directed.get(k) ?? 0) + 1)
    }
  }
  const seen = new Set<number>()
  let badEdges = 0
  for (const k of directed.keys()) {
    const a = Math.floor(k / V)
    const b = k - a * V
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const uk = key(lo, hi)
    if (seen.has(uk)) continue
    seen.add(uk)
    const fwd = directed.get(key(lo, hi)) ?? 0
    const rev = directed.get(key(hi, lo)) ?? 0
    if (fwd !== 1 || rev !== 1) badEdges++
  }
  return { closed: badEdges === 0, badEdges }
}

/**
 * The open half: faces whose centroid has z ≥ 0 (keepZPositive) or z < 0 (otherwise).
 * positions are copied whole and vertexCount is unchanged; only index and faceCount shrink.
 * Winding is preserved, so the half's solid angle from a point in the bowl is the exact partial sum.
 */
export function halfMesh(mesh: TriMesh, keepZPositive: boolean): TriMesh {
  const kept: number[] = []
  for (let f = 0; f < mesh.faceCount; f++) {
    const z = faceCentroid(mesh, f).z
    if (keepZPositive ? z >= 0 : z < 0) kept.push(f)
  }
  const index = new Uint32Array(3 * kept.length)
  kept.forEach((f, k) => {
    index[3 * k] = mesh.index[3 * f]!
    index[3 * k + 1] = mesh.index[3 * f + 1]!
    index[3 * k + 2] = mesh.index[3 * f + 2]!
  })
  return { positions: mesh.positions.slice(), index, vertexCount: mesh.vertexCount, faceCount: kept.length }
}

