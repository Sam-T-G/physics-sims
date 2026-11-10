import { describe, it, expect } from 'vitest'
import { MU_0, bFieldAt, wireField, vectorPotentialAt, circulation, enclosedCurrent, forcePerLength, pairForce, type Wire } from '@lib/physics'
import { expectRel, expectAbs } from './helpers'

// Book values read from the rendered pages of OpenStax University Physics Vol 2 (local PDF, 2026-11-10):
// Example 12.3 (p. 508): three 2 A wires into the page at three corners of a 1 cm square; at the fourth corner
//   B₁ = B₃ = 4 × 10⁻⁵ T, B₂ = 3 × 10⁻⁵ T (printed rounded from 2.83), B_x = B_y = −6 × 10⁻⁵ T, B_net = 8 × 10⁻⁵ T.
// Page 510: wires 1 m apart carrying 1 A each push or pull with 2 × 10⁻⁷ N/m (Eq 12.12).
// Example 12.4 (p. 510–511): 5.0 mA out of the page at (0, 3 cm) and (4 cm, 0); r = 5.0 cm, F/l = 1 × 10⁻¹⁰ N/m,
//   toward each other; the force on wire 2 points along −0.8 î + 0.6 ĵ.
// Example 12.7 (p. 518): inside a thick wire B = μ₀Ir/(2πa²), outside μ₀I/(2πr).
const A = 1e-4 // wire radius for tests that sit well outside every wire

describe('field of a long straight wire', () => {
  it('B = μ₀I/(2πr) and circles counterclockwise for current out of the plane', () => {
    const [bx, by] = bFieldAt([{ x: 0, y: 0, I: 10 }], 0.05, 0, A)
    expectAbs(bx, 0, 1e-18)
    expectRel(by, MU_0 * 10 / (2 * Math.PI * 0.05), 1e-12)
    expect(by).toBeGreaterThan(0)
    const [bx2] = bFieldAt([{ x: 0, y: 0, I: 10 }], 0, 0.05, A)
    expect(bx2).toBeLessThan(0)
  })
  it('flipping the current flips the field', () => {
    const [ax, ay] = bFieldAt([{ x: 0.01, y: 0.02, I: 3 }], 0.07, -0.03, A)
    const [bx, by] = bFieldAt([{ x: 0.01, y: 0.02, I: -3 }], 0.07, -0.03, A)
    expectRel(bx, -ax, 1e-14)
    expectRel(by, -ay, 1e-14)
  })
  it('Example 12.7: inside a thick wire B grows as r, and it meets μ₀I/(2πa) at the surface', () => {
    const a = 0.006, I = 10
    for (const r of [0.001, 0.003, 0.0059]) expectRel(Math.hypot(...bFieldAt([{ x: 0, y: 0, I }], r, 0, a)), MU_0 * I * r / (2 * Math.PI * a * a), 1e-12)
    expectRel(wireField(I, a * (1 - 1e-9), a), wireField(I, a * (1 + 1e-9), a), 1e-8)
    expect(Math.hypot(...bFieldAt([{ x: 0, y: 0, I }], 0, 0, a))).toBe(0)
  })
})

describe('Example 12.3: three wires at the corners of a square', () => {
  // I₂ top left, I₃ top right, I₁ bottom left, P bottom right (the book's figure), 1 cm sides, 2 A into the page.
  const wires: Wire[] = [{ x: 0, y: 0, I: -2 }, { x: 0, y: 0.01, I: -2 }, { x: 0.01, y: 0.01, I: -2 }]
  it('each wire alone: B₁ = B₃ = 4 × 10⁻⁵ T, B₂ = 2.83 × 10⁻⁵ T', () => {
    expectRel(Math.hypot(...bFieldAt([wires[0]!], 0.01, 0, A)), 4e-5, 1e-9)
    expectRel(Math.hypot(...bFieldAt([wires[2]!], 0.01, 0, A)), 4e-5, 1e-9)
    expectRel(Math.hypot(...bFieldAt([wires[1]!], 0.01, 0, A)), 4e-5 / Math.SQRT2, 1e-9)
  })
  it('B_x = B_y = −6 × 10⁻⁵ T and B_net = 8.49 × 10⁻⁵ T (printed as 8 × 10⁻⁵ T)', () => {
    const [bx, by] = bFieldAt(wires, 0.01, 0, A)
    expectRel(bx, -6e-5, 1e-9)
    expectRel(by, -6e-5, 1e-9)
    expectRel(Math.hypot(bx, by), 6e-5 * Math.SQRT2, 1e-9)
    expect(Math.round(Math.hypot(bx, by) / 1e-5)).toBe(8)
  })
})

describe('force between parallel wires', () => {
  it('1 A wires 1 m apart: 2 × 10⁻⁷ N/m', () => expectRel(pairForce(1, 1, 1), 2e-7, 1e-9))
  it('Example 12.4: 1.0 × 10⁻¹⁰ N/m, pulled together, along −0.8 î + 0.6 ĵ on wire 2', () => {
    const wires: Wire[] = [{ x: 0, y: 0.03, I: 0.005 }, { x: 0.04, y: 0, I: 0.005 }]
    const [fx, fy] = forcePerLength(wires, 1, A)
    expectRel(Math.hypot(fx, fy), 1e-10, 1e-9)
    expectRel(fx / Math.hypot(fx, fy), -0.8, 1e-12)
    expectRel(fy / Math.hypot(fx, fy), 0.6, 1e-12)
    const [gx, gy] = forcePerLength(wires, 0, A)
    expectRel(gx, -fx, 1e-12)
    expectRel(gy, -fy, 1e-12)
  })
  it('same-way currents pull together, opposite currents push apart, and I ẑ × B matches μ₀I₁I₂/(2πd)', () => {
    const same = forcePerLength([{ x: -0.05, y: 0, I: 10 }, { x: 0.05, y: 0, I: 10 }], 0, A)
    const opp = forcePerLength([{ x: -0.05, y: 0, I: 10 }, { x: 0.05, y: 0, I: -10 }], 0, A)
    expectRel(same[0], pairForce(10, 10, 0.1), 1e-12)
    expect(same[0]).toBeGreaterThan(0)
    expect(opp[0]).toBeLessThan(0)
  })
})

describe('field lines from the vector potential', () => {
  it('B = (∂A/∂y, −∂A/∂x) on random boards, outside and inside the wires', () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const a = 0.006
    for (let t = 0; t < 200; t++) {
      const wires: Wire[] = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ x: rnd() * 0.3 - 0.15, y: rnd() * 0.2 - 0.1, I: Math.round(rnd() * 40 - 20) }))
      const x = rnd() * 0.36 - 0.18, y = rnd() * 0.24 - 0.12
      const h = 1e-7
      const ax = (vectorPotentialAt(wires, x, y + h, a) - vectorPotentialAt(wires, x, y - h, a)) / (2 * h)
      const ay = -(vectorPotentialAt(wires, x + h, y, a) - vectorPotentialAt(wires, x - h, y, a)) / (2 * h)
      const [bx, by] = bFieldAt(wires, x, y, a)
      const scale = Math.max(Math.hypot(bx, by), 1e-9)
      expectAbs(ax, bx, 1e-4 * scale)
      expectAbs(ay, by, 1e-4 * scale)
    }
  })
})

describe("Ampère's law", () => {
  const a = 0.006
  it('one wire inside: ∮B·dl = μ₀I; outside: 0', () => {
    expectRel(circulation([{ x: 0.02, y: 0.01, I: 10 }], { x: 0, y: 0, r: 0.06 }, a), MU_0 * 10, 1e-6)
    expectAbs(circulation([{ x: 0.1, y: 0, I: 10 }], { x: 0, y: 0, r: 0.06 }, a), 0, 1e-12)
  })
  it('300 random boards: the step sum around the loop equals μ₀ × the current inside', () => {
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    let checked = 0
    for (let t = 0; t < 300; t++) {
      const wires: Wire[] = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => ({ x: rnd() * 0.36 - 0.18, y: rnd() * 0.24 - 0.12, I: Math.round(rnd() * 40 - 20) }))
      const loop = { x: rnd() * 0.2 - 0.1, y: rnd() * 0.12 - 0.06, r: 0.015 + rnd() * 0.1 }
      const enc = enclosedCurrent(wires, loop, a, 0.004)
      if (enc.cut.length) continue
      checked++
      expectAbs(circulation(wires, loop, a), MU_0 * enc.I, 2e-3 * MU_0 + 1e-6 * MU_0 * Math.abs(enc.I))
    }
    expect(checked).toBeGreaterThan(150)
  })
  it('a loop through a wire is flagged as cut, not counted', () => {
    const enc = enclosedCurrent([{ x: 0.06, y: 0, I: 10 }], { x: 0, y: 0, r: 0.06 }, a)
    expect(enc.cut).toEqual([0])
    expect(enc.I).toBe(0)
  })
})
