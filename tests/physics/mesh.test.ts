import { describe, expect, it } from 'vitest'
import {
  checkClosed,
  cubeSphere,
  dot,
  faceArea,
  faceCentroid,
  faceNormal,
  halfMesh,
  length,
  makeMorphTargets,
  morph,
  type TriMesh,
  vec3,
  type Vec3,
} from '@lib/physics'
import { expectAbs, expectRel } from './helpers'

// Table row: "Mesh closed and consistently wound — every edge shared by exactly two faces with
// opposite direction — exact, every morph value." Plus the counts and outward-normal checks.

const N_VALUES = [1, 2, 3, 4, 6, 8]
const T_VALUES = [0, 0.5, 1, 1.5, 2]
const R = 1.7 // not 1, so a missing radius factor shows up
const A = 0.3 // blob amplitude, inside the [0, 0.5] clamp
// mesh.ts fixes only "linear in between", not the blend formula. (1 − s)·a + s·b hits the far target
// and the midpoint bitwise; a + (b − a)·s misses both by up to one ulp. A few ulps at the largest
// coordinate (≤ R√3) accepts either; a wrong formula misses by ~a·R.
const LERP_SLACK = 4 * Number.EPSILON * R

/** Vertex v of a position buffer as a Vec3 (the buffer is xyz-interleaved). */
const vertexAt = (p: Float64Array, v: number): Vec3 => vec3(p[3 * v]!, p[3 * v + 1]!, p[3 * v + 2]!)

/** Face i as its three vertex ids. */
const faceIds = (m: TriMesh, i: number): [number, number, number] => [
  m.index[3 * i]!,
  m.index[3 * i + 1]!,
  m.index[3 * i + 2]!,
]

/** Orientation-preserving canonical key: rotate the triple so the smallest id comes first. */
const faceKey = (m: TriMesh, i: number): string => {
  const [a, b, c] = faceIds(m, i)
  if (a <= b && a <= c) return `${a},${b},${c}`
  if (b <= a && b <= c) return `${b},${c},${a}`
  return `${c},${a},${b}`
}

/**
 * Bitwise equality up to the sign of zero: Math.abs(a − b) === 0 (Math.abs(−0) is +0). toBe alone is
 * Object.is, which rejects −0 against +0, and a + (b − a)·s turns a −0 target into +0.
 */
const expectSame = (actual: Float64Array, expected: Float64Array, label: string): void => {
  expect(actual.length, `${label} length`).toBe(expected.length)
  for (let k = 0; k < expected.length; k++) {
    expect(Math.abs(actual[k]! - expected[k]!), `${label} [${k}] ${actual[k]} vs ${expected[k]}`).toBe(0)
  }
}

/** |actual − expected| ≤ LERP_SLACK per coordinate. */
const expectNear = (actual: Float64Array, expected: Float64Array, label: string): void => {
  expect(actual.length, `${label} length`).toBe(expected.length)
  for (let k = 0; k < expected.length; k++) expectAbs(actual[k]!, expected[k]!, LERP_SLACK, `${label} [${k}]`)
}

/** Follows the guidance build recipe: cube-sphere, targets, then morph the mesh buffer in place. */
const buildMorphed = (n: number, t: number): TriMesh => {
  const m = cubeSphere(n, R)
  const tg = makeMorphTargets(m, A)
  morph(m.positions, tg, t)
  return m
}

/** Independent directed-edge audit, so the row does not rest on checkClosed alone. */
const auditEdges = (m: TriMesh): { directedDuplicates: number; unpaired: number; undirected: number } => {
  const seen = new Map<string, number>()
  for (let i = 0; i < m.faceCount; i++) {
    const [a, b, c] = faceIds(m, i)
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = `${u}>${v}`
      seen.set(key, (seen.get(key) ?? 0) + 1)
    }
  }
  let directedDuplicates = 0
  let unpaired = 0
  const undirected = new Set<string>()
  for (const [key, count] of seen) {
    if (count !== 1) directedDuplicates++
    const [u, v] = key.split('>').map(Number) as [number, number]
    if (seen.get(`${v}>${u}`) !== 1) unpaired++
    undirected.add(u < v ? `${u},${v}` : `${v},${u}`)
  }
  return { directedDuplicates, unpaired, undirected: undirected.size }
}

describe('mesh', () => {
  it('cubeSphere counts: V = 6n² + 2, F = 12n², buffer lengths, every index in range', () => {
    for (const n of N_VALUES) {
      const m = cubeSphere(n, R)
      const label = `n=${n}`
      expect(m.vertexCount, `${label} vertexCount`).toBe(6 * n * n + 2)
      expect(m.faceCount, `${label} faceCount`).toBe(12 * n * n)
      expect(m.positions.length, `${label} positions.length`).toBe(3 * m.vertexCount)
      expect(m.index.length, `${label} index.length`).toBe(3 * m.faceCount)
      for (let k = 0; k < m.index.length; k++) {
        const id = m.index[k]!
        expect(id, `${label} index[${k}]`).toBeLessThan(m.vertexCount)
        expect(Number.isInteger(id), `${label} index[${k}] integer`).toBe(true)
      }
    }
  })

  it('Mesh closed and consistently wound: every edge shared by exactly two faces with opposite direction (exact, every morph value)', () => {
    for (const n of N_VALUES) {
      for (const t of T_VALUES) {
        const m = buildMorphed(n, t)
        const label = `n=${n} t=${t}`
        expect(checkClosed(m), `${label} checkClosed`).toEqual({ closed: true, badEdges: 0 })
        // Morphing moves positions only; the index is what the row is about, so audit it directly.
        const audit = auditEdges(m)
        expect(audit.directedDuplicates, `${label} directed edges appearing more than once`).toBe(0)
        expect(audit.unpaired, `${label} directed edges without a single reverse`).toBe(0)
        expect(audit.undirected, `${label} undirected edge count E = 18n²`).toBe(18 * n * n)
      }
    }
  })

  it('outward normals: dot(faceNormal, faceCentroid) > 0, faceArea > 0, |faceNormal| = 1 (every n, every morph value)', () => {
    for (const n of N_VALUES) {
      for (const t of T_VALUES) {
        const m = buildMorphed(n, t)
        for (let i = 0; i < m.faceCount; i++) {
          const label = `n=${n} t=${t} face ${i}`
          const nrm = faceNormal(m, i)
          const c = faceCentroid(m, i)
          // Every target is star-shaped about the origin, so outward means "away from the origin".
          expect(dot(nrm, c), `${label} dot(normal, centroid)`).toBeGreaterThan(0)
          expect(faceArea(m, i), `${label} faceArea`).toBeGreaterThan(0)
          expectRel(length(nrm), 1, 1e-12, `${label} |faceNormal|`)
        }
      }
    }
  })

  it('faceCentroid, faceArea and faceNormal match their closed forms on the raw index', () => {
    const m = cubeSphere(3, R)
    for (let i = 0; i < m.faceCount; i++) {
      const [ia, ib, ic] = faceIds(m, i)
      const a = vertexAt(m.positions, ia)
      const b = vertexAt(m.positions, ib)
      const c = vertexAt(m.positions, ic)
      const ab = vec3(b.x - a.x, b.y - a.y, b.z - a.z)
      const ac = vec3(c.x - a.x, c.y - a.y, c.z - a.z)
      const cr = vec3(ab.y * ac.z - ab.z * ac.y, ab.z * ac.x - ab.x * ac.z, ab.x * ac.y - ab.y * ac.x)
      const crLen = length(cr)
      const label = `face ${i}`
      const cen = faceCentroid(m, i)
      expectAbs(cen.x, (a.x + b.x + c.x) / 3, 1e-12 * R, `${label} centroid.x`)
      expectAbs(cen.y, (a.y + b.y + c.y) / 3, 1e-12 * R, `${label} centroid.y`)
      expectAbs(cen.z, (a.z + b.z + c.z) / 3, 1e-12 * R, `${label} centroid.z`)
      expectRel(faceArea(m, i), crLen / 2, 1e-12, `${label} area`)
      const nrm = faceNormal(m, i)
      expectAbs(nrm.x, cr.x / crLen, 1e-12, `${label} normal.x`)
      expectAbs(nrm.y, cr.y / crLen, 1e-12, `${label} normal.y`)
      expectAbs(nrm.z, cr.z / crLen, 1e-12, `${label} normal.z`)
    }
  })

  it('sphere target: every vertex at distance R (1e-12 relative); radius and amplitude reported', () => {
    for (const n of N_VALUES) {
      const m = cubeSphere(n, R)
      const tg = makeMorphTargets(m, A)
      expectRel(tg.radius, R, 1e-12, `n=${n} radius`)
      expect(tg.amplitude, `n=${n} amplitude`).toBe(A)
      expect(tg.sphere.length, `n=${n} sphere.length`).toBe(3 * m.vertexCount)
      for (let v = 0; v < m.vertexCount; v++) {
        expectRel(length(vertexAt(tg.sphere, v)), R, 1e-12, `n=${n} sphere vertex ${v}`)
        // The raw cubeSphere output is the sphere target, so it sits at R too.
        expectRel(length(vertexAt(m.positions, v)), R, 1e-12, `n=${n} cubeSphere vertex ${v}`)
      }
    }
  })

  it('cube target: every vertex has max(|x|,|y|,|z|) = R (1e-12 relative)', () => {
    for (const n of N_VALUES) {
      const m = cubeSphere(n, R)
      const tg = makeMorphTargets(m, A)
      expect(tg.cube.length, `n=${n} cube.length`).toBe(3 * m.vertexCount)
      for (let v = 0; v < m.vertexCount; v++) {
        const p = vertexAt(tg.cube, v)
        const maxNorm = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z))
        expectRel(maxNorm, R, 1e-12, `n=${n} cube vertex ${v}`)
      }
    }
  })

  it('blob target: every vertex within [R(1 − a), R(1 + a)]; amplitude clamps to [0, 0.5]', () => {
    for (const n of N_VALUES) {
      const m = cubeSphere(n, R)
      const tg = makeMorphTargets(m, A)
      expect(tg.blob.length, `n=${n} blob.length`).toBe(3 * m.vertexCount)
      // 1e-12·R slack so a vertex sitting exactly on the bound is not lost to rounding.
      const lo = R * (1 - A) - 1e-12 * R
      const hi = R * (1 + A) + 1e-12 * R
      for (let v = 0; v < m.vertexCount; v++) {
        const r = length(vertexAt(tg.blob, v))
        expect(r, `n=${n} blob vertex ${v} below R(1 − a)`).toBeGreaterThanOrEqual(lo)
        expect(r, `n=${n} blob vertex ${v} above R(1 + a)`).toBeLessThanOrEqual(hi)
      }
    }
    // Non-degeneracy: the doc promises radial extent R(1 − a) to R(1 + a), so the blob must leave the
    // sphere. A discrete mesh cannot be required to sample g = ±1, hence the weak 0.25·a·R bound.
    const fine = cubeSphere(8, R)
    const fineTg = makeMorphTargets(fine, A)
    let maxDeparture = 0
    for (let v = 0; v < fine.vertexCount; v++) {
      maxDeparture = Math.max(maxDeparture, Math.abs(length(vertexAt(fineTg.blob, v)) - R))
    }
    expect(maxDeparture, 'n=8 blob max ||v| − R| (blob ≡ sphere?)').toBeGreaterThanOrEqual(0.25 * A * R)
    const m = cubeSphere(4, R)
    const over = makeMorphTargets(m, 0.9)
    expect(over.amplitude, 'amplitude 0.9 clamps to 0.5').toBe(0.5)
    for (let v = 0; v < m.vertexCount; v++) {
      const r = length(vertexAt(over.blob, v))
      expect(r, `clamped blob vertex ${v}`).toBeGreaterThanOrEqual(R * 0.5 - 1e-12 * R)
      expect(r, `clamped blob vertex ${v}`).toBeLessThanOrEqual(R * 1.5 + 1e-12 * R)
    }
    const under = makeMorphTargets(m, -0.2)
    expect(under.amplitude, 'amplitude −0.2 clamps to 0').toBe(0)
    for (let v = 0; v < m.vertexCount; v++) {
      // a = 0 makes the blob the sphere.
      expectRel(length(vertexAt(under.blob, v)), R, 1e-12, `a=0 blob vertex ${v}`)
    }
  })

  it('morph: t = 0 is the sphere and 1 the cube (exact); 2 the blob and 0.5, 1.5 the per-coordinate midpoints (a few ulps); t clamped', () => {
    for (const n of N_VALUES) {
      const m = cubeSphere(n, R)
      const tg = makeMorphTargets(m, A)
      const len = 3 * m.vertexCount
      const out = new Float64Array(len)
      const mid = (p: Float64Array, q: Float64Array): Float64Array => p.map((x, k) => (x + q[k]!) / 2)
      // t = 0 and t = 1 are exact under any linear form: the weight on the far target is 0, or
      // (sphere→cube) cube/sphere ∈ [1, √3] per coordinate makes cube − sphere exact by Sterbenz.
      morph(out, tg, 0)
      expectSame(out, tg.sphere, `n=${n} t=0`)
      morph(out, tg, 1)
      expectSame(out, tg.cube, `n=${n} t=1`)
      // cube→blob has blob/cube down to (1 − a)/√3 < 1/2, so blob − cube can round: slack here.
      morph(out, tg, 2)
      expectNear(out, tg.blob, `n=${n} t=2`)
      morph(out, tg, 0.5)
      expectNear(out, mid(tg.sphere, tg.cube), `n=${n} t=0.5`)
      morph(out, tg, 1.5)
      expectNear(out, mid(tg.cube, tg.blob), `n=${n} t=1.5`)
      morph(out, tg, -1)
      expectSame(out, tg.sphere, `n=${n} t=−1 clamps to sphere`)
      morph(out, tg, 3)
      expectNear(out, tg.blob, `n=${n} t=3 clamps to blob`)
    }
  })

  it('morph in place: targets survive writes into the mesh buffer they were built from', () => {
    const m = cubeSphere(4, R)
    const original = Float64Array.from(m.positions)
    const tg = makeMorphTargets(m, A)
    // The documented use morphs m.positions itself, so no target may alias that buffer.
    morph(m.positions, tg, 2)
    morph(m.positions, tg, 1)
    morph(m.positions, tg, 0)
    expectSame(m.positions, original, 'positions after 2 → 1 → 0')
  })

  it('halfMesh at even n: F = 6n², vertices unchanged, kept centroids on the right side, badEdges = 4n, halves partition the faces', () => {
    for (const n of N_VALUES.filter((k) => k % 2 === 0)) {
      const full = cubeSphere(n, R)
      const top = halfMesh(full, true)
      const bottom = halfMesh(full, false)
      const label = `n=${n}`
      for (const [name, half] of [
        ['top', top],
        ['bottom', bottom],
      ] as const) {
        expect(half.faceCount, `${label} ${name} faceCount`).toBe(6 * n * n)
        expect(half.index.length, `${label} ${name} index.length`).toBe(3 * half.faceCount)
        expect(half.vertexCount, `${label} ${name} vertexCount`).toBe(full.vertexCount)
        expect(half.positions.length, `${label} ${name} positions.length`).toBe(full.positions.length)
        for (let k = 0; k < full.positions.length; k++) {
          expect(half.positions[k]! - full.positions[k]!, `${label} ${name} positions[${k}]`).toBe(0)
        }
        // Open bowl: the equator is a boundary of 4n edges (four side faces, n segments each).
        expect(checkClosed(half), `${label} ${name} checkClosed`).toEqual({ closed: false, badEdges: 4 * n })
      }
      for (let i = 0; i < top.faceCount; i++) {
        expect(faceCentroid(top, i).z, `${label} top face ${i} centroid.z`).toBeGreaterThanOrEqual(0)
      }
      for (let i = 0; i < bottom.faceCount; i++) {
        expect(faceCentroid(bottom, i).z, `${label} bottom face ${i} centroid.z`).toBeLessThan(0)
      }
      // Partition: the two index sets are disjoint and together are exactly the full mesh's faces.
      const fullKeys = new Set<string>()
      for (let i = 0; i < full.faceCount; i++) fullKeys.add(faceKey(full, i))
      expect(fullKeys.size, `${label} full mesh has distinct faces`).toBe(full.faceCount)
      const topKeys = new Set<string>()
      for (let i = 0; i < top.faceCount; i++) topKeys.add(faceKey(top, i))
      const bottomKeys = new Set<string>()
      for (let i = 0; i < bottom.faceCount; i++) bottomKeys.add(faceKey(bottom, i))
      expect(topKeys.size, `${label} top faces distinct`).toBe(top.faceCount)
      expect(bottomKeys.size, `${label} bottom faces distinct`).toBe(bottom.faceCount)
      for (const key of topKeys) {
        expect(bottomKeys.has(key), `${label} face ${key} in both halves`).toBe(false)
        expect(fullKeys.has(key), `${label} top face ${key} not in full mesh (winding changed?)`).toBe(true)
      }
      for (const key of bottomKeys) {
        expect(fullKeys.has(key), `${label} bottom face ${key} not in full mesh (winding changed?)`).toBe(true)
      }
      expect(topKeys.size + bottomKeys.size, `${label} halves cover the full mesh`).toBe(full.faceCount)
    }
  })

  it('sanity: total faceArea at n = 8 on the sphere is within 5% of 4πR² and below it', () => {
    const m = cubeSphere(8, R)
    let total = 0
    for (let i = 0; i < m.faceCount; i++) total += faceArea(m, i)
    const exact = 4 * Math.PI * R * R
    // Chords lie inside the sphere, so the inscribed polyhedron's area is strictly less.
    expect(total, 'inscribed area below 4πR²').toBeLessThan(exact)
    expectRel(total, exact, 0.05, 'total area vs 4πR²')
  })
})
