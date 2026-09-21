import type { Vec3 } from './vec3'
import { fieldAt, type FieldOptions, type PointCharge } from './charges'

/** n quasi-uniform unit vectors on the sphere (golden-angle spiral). All distinct, all unit length. */
export function fibonacciSphere(n: number): Vec3[] {
  const out: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const phi = i * golden
    out.push({ x: r * Math.cos(phi), y, z: r * Math.sin(phi) })
  }
  return out
}

export type LineEnd = 'charge' | 'box' | 'null' | 'steps'

/**
 * One traced field line. points run in the direction of travel (along E for direction 1, against E
 * for −1). end says why tracing stopped:
 *   'charge' entered some charge's capture radius (endCharge = its index in the charges array)
 *   'box'    left the bounding box
 *   'null'   |E| dropped below eMin
 *   'steps'  hit maxSteps
 * seed is set by seedLines (which charge the line was seeded on, and which way it was traced).
 */
export type FieldLine = {
  points: Vec3[]
  end: LineEnd
  endCharge?: number
  seed?: { charge: number; direction: 1 | -1 }
}

/**
 * Analytic radial rays for a single charge, n directions from fibonacciSphere(n).
 * q > 0: each ray runs outward from distance rc to distance `length`, end 'box'.
 * q < 0: each ray runs inward from `length` to rc (the direction of E), end 'charge', endCharge 0.
 * Every point lies on its ray with monotone distance from the charge; a ray has at least two points.
 */
export function radialRays(charge: PointCharge, n: number, length: number): FieldLine[] {
  const { pos, rc } = charge
  return fibonacciSphere(n).map(d => {
    const inner = { x: pos.x + rc * d.x, y: pos.y + rc * d.y, z: pos.z + rc * d.z }
    const outer = { x: pos.x + length * d.x, y: pos.y + length * d.y, z: pos.z + length * d.z }
    return charge.q >= 0
      ? { points: [inner, outer], end: 'box' as const }
      : { points: [outer, inner], end: 'charge' as const, endCharge: 0 }
  })
}

export type TraceOptions = {
  /** Step clamp in metres. Step = clamp(0.1 · distance to the nearest charge, hMin, hMax). */
  hMin: number
  hMax: number
  /** |E| below this (V/m) ends the line as 'null'. */
  eMin: number
  maxSteps: number
  box: { min: Vec3; max: Vec3 }
  /** 1 follows E (from + toward −), −1 follows −E. */
  direction: 1 | -1
  /** Passed to fieldAt. Default 2; the toggle's other values trace the lines of that field. */
  exponent?: number
}

const STEP_FRACTION = 0.1

function capturedBy(charges: readonly PointCharge[], p: Vec3): number {
  for (let i = 0; i < charges.length; i++) {
    const c = charges[i]!
    const dx = p.x - c.pos.x
    const dy = p.y - c.pos.y
    const dz = p.z - c.pos.z
    if (dx * dx + dy * dy + dz * dz < c.rc * c.rc) return i
  }
  return -1
}

function nearestDistance(charges: readonly PointCharge[], p: Vec3): number {
  let best = Infinity
  for (const c of charges) {
    const dx = p.x - c.pos.x
    const dy = p.y - c.pos.y
    const dz = p.z - c.pos.z
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d < best) best = d
  }
  return best
}

const inBox = (p: Vec3, box: TraceOptions['box']): boolean =>
  p.x >= box.min.x && p.x <= box.max.x && p.y >= box.min.y && p.y <= box.max.y && p.z >= box.min.z && p.z <= box.max.z

/** |E| at p. */
function fieldMagnitude(charges: readonly PointCharge[], p: Vec3, opts: FieldOptions): number {
  const E = fieldAt(charges, p, opts)
  return Math.sqrt(E.x * E.x + E.y * E.y + E.z * E.z)
}

/** Unit tangent direction·E/|E| at p; the zero vector where E vanishes (a mid-step stage may land on a null). */
function tangent(charges: readonly PointCharge[], p: Vec3, direction: 1 | -1, opts: FieldOptions): Vec3 {
  const E = fieldAt(charges, p, opts)
  const m = Math.sqrt(E.x * E.x + E.y * E.y + E.z * E.z)
  if (m === 0) return { x: 0, y: 0, z: 0 }
  const s = direction / m
  return { x: E.x * s, y: E.y * s, z: E.z * s }
}

/**
 * Index of a charge whose capture sphere the open segment (p, q] passes through, and the point of closest
 * approach (which lies inside that sphere), or null. The start point itself (t = 0) never counts, so a seed
 * sitting on or rounding just inside its own capture sphere leaves it.
 */
function segmentCapture(charges: readonly PointCharge[], p: Vec3, q: Vec3): { charge: number; at: Vec3 } | null {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const dz = q.z - p.z
  const dd = dx * dx + dy * dy + dz * dz
  if (dd === 0) return null
  for (let i = 0; i < charges.length; i++) {
    const c = charges[i]!
    if (c.rc <= 0) continue
    const t = Math.min(1, Math.max(0, ((c.pos.x - p.x) * dx + (c.pos.y - p.y) * dy + (c.pos.z - p.z) * dz) / dd))
    if (t === 0) continue
    const at = { x: p.x + t * dx, y: p.y + t * dy, z: p.z + t * dz }
    const ex = at.x - c.pos.x
    const ey = at.y - c.pos.y
    const ez = at.z - c.pos.z
    if (ex * ex + ey * ey + ez * ez < c.rc * c.rc) return { charge: i, at }
  }
  return null
}

/**
 * RK4 in arc length on dr/ds = direction · E/|E| from start until one of the four terminators fires.
 * fieldAt drives it (exact Coulomb, ball kernel inside rc, opts.exponent honored). RK4 stages within
 * 0.1·d of p can sample the kernel on a tangential pass near rc; the kernel is continuous there, so the
 * line is unaffected beyond rounding.
 * points[0] is start; each subsequent point is one accepted RK4 step. Capture is checked along the whole
 * step segment, not only at its end, so no step size can tunnel through a capture sphere; a line that
 * ends 'charge' has its last point inside that charge's rc. The start point itself is never a capture
 * (a seed placed on a capture sphere leaves it). The eMin test is made at accepted points only, so a line
 * that ends 'null' has |E| < eMin at its last point.
 */
export function traceLine(charges: readonly PointCharge[], start: Vec3, opts: TraceOptions): FieldLine {
  const { hMin, hMax, eMin, maxSteps, box, direction } = opts
  const fo: FieldOptions = { exponent: opts.exponent ?? 2 }
  const points: Vec3[] = [start]
  let p = start
  if (!inBox(p, box)) return { points, end: 'box' }
  for (let i = 0; i < maxSteps; i++) {
    if (fieldMagnitude(charges, p, fo) < eMin) return { points, end: 'null' }
    const k1 = tangent(charges, p, direction, fo)
    const h = Math.min(hMax, Math.max(hMin, STEP_FRACTION * nearestDistance(charges, p)))
    const k2 = tangent(charges, { x: p.x + 0.5 * h * k1.x, y: p.y + 0.5 * h * k1.y, z: p.z + 0.5 * h * k1.z }, direction, fo)
    const k3 = tangent(charges, { x: p.x + 0.5 * h * k2.x, y: p.y + 0.5 * h * k2.y, z: p.z + 0.5 * h * k2.z }, direction, fo)
    const k4 = tangent(charges, { x: p.x + h * k3.x, y: p.y + h * k3.y, z: p.z + h * k3.z }, direction, fo)
    const next = {
      x: p.x + (h / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
      y: p.y + (h / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
      z: p.z + (h / 6) * (k1.z + 2 * k2.z + 2 * k3.z + k4.z),
    }
    const hit = capturedBy(charges, next)
    if (hit >= 0) {
      points.push(next)
      return { points, end: 'charge', endCharge: hit }
    }
    const crossed = segmentCapture(charges, p, next)
    if (crossed) {
      points.push(crossed.at)
      return { points, end: 'charge', endCharge: crossed.charge }
    }
    p = next
    points.push(p)
    if (!inBox(p, box)) return { points, end: 'box' }
  }
  if (fieldMagnitude(charges, p, fo) < eMin) return { points, end: 'null' }
  return { points, end: 'steps' }
}

/**
 * The seeding rule. perUnitCharge is lines per coulomb; each charge's quota is N_i = round(perUnitCharge · |q_i|).
 * 1. Positive charges only: N_i seeds at pos + rc·d̂ for d̂ in fibonacciSphere(N_i), traced with direction 1.
 * 2. For each negative charge j: arrivals_j = forward lines that ended with endCharge j.
 *    deficit_j = max(0, N_j − arrivals_j) more lines are seeded on j, traced with direction −1
 *    (those are the lines from infinity). Their seed directions are the Fibonacci directions on j
 *    farthest from the arrival directions, so they do not retrace an arriving line.
 * Negative charges are never seeded forward, so no +→− line is drawn twice.
 * Every returned line carries seed = { charge, direction }.
 */
export function seedLines(charges: readonly PointCharge[], perUnitCharge: number, opts: Omit<TraceOptions, 'direction'>): FieldLine[] {
  const lines: FieldLine[] = []
  const quota = charges.map(c => Math.round(perUnitCharge * Math.abs(c.q)))
  const seedAt = (c: PointCharge, d: Vec3): Vec3 => ({ x: c.pos.x + c.rc * d.x, y: c.pos.y + c.rc * d.y, z: c.pos.z + c.rc * d.z })

  charges.forEach((c, ci) => {
    if (c.q <= 0) return
    for (const d of fibonacciSphere(quota[ci]!)) {
      const line = traceLine(charges, seedAt(c, d), { ...opts, direction: 1 })
      line.seed = { charge: ci, direction: 1 }
      lines.push(line)
    }
  })

  charges.forEach((c, cj) => {
    if (c.q >= 0) return
    const arrivals = lines.filter(l => l.end === 'charge' && l.endCharge === cj)
    const deficit = Math.max(0, quota[cj]! - arrivals.length)
    if (deficit === 0) return
    const arrivalDirs = arrivals.map(l => {
      const last = l.points[l.points.length - 1]!
      const dx = last.x - c.pos.x
      const dy = last.y - c.pos.y
      const dz = last.z - c.pos.z
      const m = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
      return { x: dx / m, y: dy / m, z: dz / m }
    })
    // Rank candidate directions by how close their nearest arrival is (largest dot = closest); seed the farthest.
    const ranked = fibonacciSphere(quota[cj]!)
      .map(d => ({ d, closest: arrivalDirs.reduce((best, a) => Math.max(best, d.x * a.x + d.y * a.y + d.z * a.z), -Infinity) }))
      .sort((p, q) => p.closest - q.closest)
      .slice(0, deficit)
    for (const { d } of ranked) {
      const line = traceLine(charges, seedAt(c, d), { ...opts, direction: -1 })
      line.seed = { charge: cj, direction: -1 }
      lines.push(line)
    }
  })

  return lines
}

/**
 * Signed crossings of the sphere |r − center| = R by the polyline: +1 for each consecutive pair that
 * goes from inside (|r − center| − R < 0) to outside (> 0), −1 for outside to inside. A point exactly
 * on the sphere counts with the side of the next non-zero sign. Straight rays from an enclosed charge
 * give +1 each, so nested spheres see the same total N.
 */
export function countSphereCrossings(line: FieldLine, center: Vec3, R: number): number {
  let count = 0
  let prev = 0
  for (const p of line.points) {
    const dx = p.x - center.x
    const dy = p.y - center.y
    const dz = p.z - center.z
    const s = Math.sign(Math.sqrt(dx * dx + dy * dy + dz * dz) - R)
    if (s === 0) continue
    if (prev !== 0 && s !== prev) count += s
    prev = s
  }
  return count
}
