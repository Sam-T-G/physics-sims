// Long straight wires perpendicular to a plane (OpenStax University Physics Vol 2, Sections 12.2, 12.3, 12.5).
// Pure: no DOM, no Three. Positions in meters, currents in amperes, fields in tesla.
// Sign convention: I > 0 is current out of the plane (toward the viewer), so its field circles counterclockwise.
// Each wire is a solid round conductor of radius `a` carrying its current uniformly (Example 12.7), which keeps
// the field finite at the wire and makes "current inside a loop" well defined except when the loop cuts a wire.

import { MU_0 } from './constants'

/** μ₀ / 2π, T·m/A. Exactly 2 × 10⁻⁷ by the pre-2019 definition; within 1e-9 relative after it. */
export const MU0_OVER_2PI = MU_0 / (2 * Math.PI)

export type Wire = { x: number; y: number; I: number }
export type Loop = { x: number; y: number; r: number }
export type Vec2 = [number, number]

/** Field at (x, y) from every wire except `skip`. Outside a wire B = μ₀I/(2πr); inside, μ₀Ir/(2πa²). */
export function bFieldAt(wires: readonly Wire[], x: number, y: number, a: number, skip = -1): Vec2 {
  let bx = 0, by = 0
  const a2 = a * a
  for (let i = 0; i < wires.length; i++) {
    if (i === skip) continue
    const w = wires[i]!
    const dx = x - w.x, dy = y - w.y, r2 = dx * dx + dy * dy
    // B = (μ₀I/2π) ẑ × r̂ / r = (μ₀I/2π)(−dy, dx)/r²
    const f = MU0_OVER_2PI * w.I / (r2 < a2 ? a2 : r2)
    bx -= dy * f
    by += dx * f
  }
  return [bx, by]
}

/** One wire's field magnitude at distance r, B = μ₀|I|/(2πr) outside, μ₀|I|r/(2πa²) inside. */
export function wireField(I: number, r: number, a: number): number {
  return r < a ? MU0_OVER_2PI * Math.abs(I) * r / (a * a) : MU0_OVER_2PI * Math.abs(I) / r
}

/**
 * The z part of the vector potential, with B = (∂A/∂y, −∂A/∂x). Its level curves are the field lines exactly, and
 * equal steps in A put the lines closer together where B is stronger. Continuous with its slope at r = a.
 */
export function vectorPotentialAt(wires: readonly Wire[], x: number, y: number, a: number): number {
  let A = 0
  const a2 = a * a, lnA = Math.log(a)
  for (const w of wires) {
    const dx = x - w.x, dy = y - w.y, r2 = dx * dx + dy * dy
    A -= MU0_OVER_2PI * w.I * (r2 < a2 ? lnA + (r2 / a2 - 1) / 2 : 0.5 * Math.log(r2))
  }
  return A
}

/** ∮B·dl counterclockwise around a circle, added up over n straight steps (midpoint rule). */
export function circulation(wires: readonly Wire[], loop: Loop, a: number, n = 2000): number {
  let sum = 0
  let px = loop.x + loop.r, py = loop.y
  for (let k = 1; k <= n; k++) {
    const t = (2 * Math.PI * k) / n
    const nx = loop.x + loop.r * Math.cos(t), ny = loop.y + loop.r * Math.sin(t)
    const [bx, by] = bFieldAt(wires, (px + nx) / 2, (py + ny) / 2, a)
    sum += bx * (nx - px) + by * (ny - py)
    px = nx
    py = ny
  }
  return sum
}

/**
 * Net current through the loop, counted positive out of the plane (the right-hand rule for a counterclockwise loop).
 * `cut` lists wires the loop passes through (closer than a + margin to the loop): only part of their current is
 * inside, and the step sum near them is no longer accurate, so the app asks for the wire to be moved.
 */
export function enclosedCurrent(wires: readonly Wire[], loop: Loop, a: number, margin = 0): { I: number; cut: number[]; inside: number[] } {
  let I = 0
  const cut: number[] = [], inside: number[] = []
  wires.forEach((w, i) => {
    const d = Math.hypot(w.x - loop.x, w.y - loop.y)
    if (Math.abs(d - loop.r) < a + margin) cut.push(i)
    else if (d < loop.r) { I += w.I; inside.push(i) }
  })
  return { I, cut, inside }
}

/** Force per meter on wire i from every other wire: F/l = I ẑ × B = I(−By, Bx). */
export function forcePerLength(wires: readonly Wire[], i: number, a: number): Vec2 {
  const w = wires[i]
  if (!w) return [0, 0]
  const [bx, by] = bFieldAt(wires, w.x, w.y, a, i)
  return [-w.I * by, w.I * bx]
}

/** Force per meter between two parallel wires d apart, μ₀I₁I₂/(2πd). Positive means they pull together. */
export function pairForce(I1: number, I2: number, d: number): number {
  return MU0_OVER_2PI * I1 * I2 / d
}
