import { describe, expect, it } from 'vitest'
import { EPSILON_0, K_E, cubeSphere, fluxExact, halfMesh } from '@lib/physics'
import { createBowl, createBundleLoops, createFluxLoop, UNIFORM_E } from '../../apps/01-electrostatics/src/physics/flux'
import { MAX_OFFSET, MIN_DIPOLE_OFFSET, createSymmetry } from '../../apps/01-electrostatics/src/physics/symmetry'
import { expectRel } from '../physics/helpers'

describe('beat 4, the loop', () => {
  it('flipping n̂ flips the sign of Φ and nothing else', () => {
    const loop = createFluxLoop()
    loop.set({ thetaDeg: 30 })
    const up = loop.flux()
    loop.set({ flipped: true })
    expect(loop.flux()).toBe(-up)
    expectRel(up, UNIFORM_E * loop.area() * Math.cos(Math.PI / 6), 1e-12)
  })
})

describe('beat 4, two loops in one bundle', () => {
  it('every drawn bundle ray passes through both loops, so the counts match exactly', () => {
    const b = createBundleLoops()
    const { near, far } = b.raysThrough()
    expect(near).toBe(b.rays.length)
    expect(far).toBe(b.rays.length)
    expect(near).toBeGreaterThanOrEqual(16)
  })
  it('the two loops carry the same flux (same solid angle), computed exactly', () => {
    const { near, far } = createBundleLoops().fluxes()
    expectRel(far, near, 1e-12)
  })
})

describe('beat 4, the bowl', () => {
  it('the smooth-bowl flux formula matches the exact flux through a fine bowl mesh', () => {
    const bowl = createBowl()
    bowl.set({ z: -0.3 })
    // Charge on the axis at depth h below the rim of a unit bowl: Ω = 2π(1 + h/√(1 + h²)), Φ = qΩ/(4πε₀).
    const h = 0.3
    expectRel(bowl.smoothExact(), (1e-9 / EPSILON_0) * 0.5 * (1 + h / Math.sqrt(1 + h * h)), 1e-12)
    // A 16×16-per-face bowl is inscribed in the smooth one; its exact flux sits within 0.5%.
    const fine = halfMesh(cubeSphere(16, 1), false)
    expectRel(fluxExact(fine, [bowl.charge]), bowl.smoothExact(), 5e-3)
  })
})

describe('beat 6, symmetry', () => {
  it('a centered charge gives the same |E| = kq/r² on every patch', () => {
    const sy = createSymmetry()
    sy.set({ x: 0 })
    const out = new Float64Array(sy.mesh.faceCount)
    const [min, max] = sy.faceMagnitudes(out)
    expectRel(min, K_E * 1e-9, 1e-12)
    expectRel(max, K_E * 1e-9, 1e-12)
  })
})

describe('beat 6, the dipole and the color scale', () => {
  it('a + and − stacked at the center cancel to E = 0 everywhere, which is why the slider keeps them apart', () => {
    const sy = createSymmetry()
    sy.set({ dipole: true, x: 0 })
    const out = new Float64Array(sy.mesh.faceCount)
    const [, max] = sy.faceMagnitudes(out)
    expect(max).toBe(0)
    sy.set({ x: MIN_DIPOLE_OFFSET })
    const [min] = sy.faceMagnitudes(out)
    expect(min).toBeGreaterThan(0)
    expectRel(sy.flux() + 1, 1, 1e-9) // Φ = 0 either way
  })
  it('the fixed color range brackets every |E| a single charge can put on the sphere', () => {
    const sy = createSymmetry()
    const [lo, hi] = sy.colorRange()
    expectRel(lo, (K_E * 1e-9) / (1 + MAX_OFFSET) ** 2, 1e-12)
    expectRel(hi, (K_E * 1e-9) / (1 - MAX_OFFSET) ** 2, 1e-12)
    const out = new Float64Array(sy.mesh.faceCount)
    for (const x of [0, 0.3, 0.55, MAX_OFFSET]) {
      sy.set({ dipole: false, x })
      const [min, max] = sy.faceMagnitudes(out)
      expect(min).toBeGreaterThanOrEqual(lo * (1 - 1e-12))
      expect(max).toBeLessThanOrEqual(hi * (1 + 1e-12))
    }
    // The dipole too, anywhere the slider allows it.
    for (const x of [MIN_DIPOLE_OFFSET, 0.4, MAX_OFFSET]) {
      sy.set({ dipole: true, x })
      const [min, max] = sy.faceMagnitudes(out)
      expect(min).toBeGreaterThanOrEqual(lo)
      expect(max).toBeLessThanOrEqual(hi)
    }
  })
})
