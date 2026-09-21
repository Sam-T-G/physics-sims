import { describe, it, expect } from 'vitest'
import {
  K_E,
  EPSILON_0,
  vec3,
  length,
  scale,
  forceBetween,
  forceOn,
  fluxExact,
  fluxUniformLoop,
  cubeSphere,
  type PointCharge,
} from '@lib/physics'
import { expectRel, expectAbs, expectVec3Rel } from './helpers'

// Rows covered (sims/01-charge-field-flux.md, Validation tests table):
//   OpenStax Vol 2 Ch 5 worked example [TBD: pick one]                       → Examples 5.1 and 5.2
//   OpenStax Vol 2 Ch 6 worked example [TBD: flux through a closed surface]  → Examples 6.3 and 6.5
//
// OpenStax prints k = 8.99e9 and ε₀ = 8.85e-12, so a printed 3-sig-fig value can sit ~0.1–0.2% from the
// CODATA computation. Tolerance against a printed value is therefore relative 5e-3 (3 sig figs); the
// same lib result is also held to the closed form computed here from K_E / EPSILON_0 at 1e-9 relative.
// Confirmed on 2026-09-20 against openstax.org (the URLs below rendered; no mirror was needed).

/** 3 sig figs, per the table. */
const SIG3 = 5e-3
/** Closed-form check of the same lib result, independent of the textbook's rounded constants. */
const CLOSED = 1e-9

describe('openstax', () => {
  // Example 5.1 "The Force on the Electron in Hydrogen", Ch 5.3 Coulomb's Law
  // https://openstax.org/books/university-physics-volume-2/pages/5-3-coulombs-law
  // Inputs: q₁ = +e = +1.602e-19 C (proton), q₂ = −e = −1.602e-19 C (electron), r = 5.29e-11 m, k = 8.99e9.
  // Printed: F = 8.25e-8 N on the electron, directed radially toward the proton.
  it('OpenStax Vol 2 Ch 5 worked example: Example 5.1, force on the electron in hydrogen (forceBetween)', () => {
    const e = 1.602e-19
    const r = 5.29e-11
    const PRINTED_F = 8.25e-8
    // Unit direction from proton to electron with no zero components (0.36² + 0.48² + 0.8² = 1).
    const rhat = vec3(0.36, 0.48, 0.8)
    const proton: PointCharge = { q: +e, pos: vec3(0, 0, 0), rc: 0 }
    const electron: PointCharge = { q: -e, pos: scale(rhat, r), rc: 0 }

    const F = forceBetween(proton, electron)

    // Attraction: the force on the electron points back along −r̂ toward the proton.
    expectVec3Rel(F, scale(rhat, -PRINTED_F), SIG3, 'Example 5.1 vector vs printed')
    expectRel(length(F), PRINTED_F, SIG3, 'Example 5.1 |F| vs printed 8.25e-8 N')
    // Closed form: F = k e² / r².
    expectVec3Rel(F, scale(rhat, -(K_E * e * e) / (r * r)), CLOSED, 'Example 5.1 vs closed form')
  })

  // Example 5.2 "The Net Force from Two Source Charges", Ch 5.3 Coulomb's Law
  // https://openstax.org/books/university-physics-volume-2/pages/5-3-coulombs-law
  // Inputs: q₁ = 2e = 3.204e-19 C, q₂ = −3e = −4.806e-19 C (the test charge), q₃ = −5e = −8.01e-19 C,
  //         r₁₂ = 2.0e-7 m along +y from q₂, r₃₂ = 4.0e-7 m along +x from q₂, k = 8.99e9.
  // Printed: on q₂, Fₓ = −2.16e-14 N, Fᵧ = 3.46e-14 N, F = 4.08e-14 N at 58° above the −x axis.
  it('OpenStax Vol 2 Ch 5 worked example: Example 5.2, net force from two source charges (forceOn)', () => {
    const e = 1.602e-19
    const r12 = 2.0e-7
    const r32 = 4.0e-7
    const PRINTED_FX = -2.16e-14
    const PRINTED_FY = 3.46e-14
    const PRINTED_F = 4.08e-14
    const PRINTED_DEG = 58
    // q₁ (+) attracts q₂ toward +y; q₃ (−) repels q₂ toward −x, so q₃ sits on +x. Matches the book's figure.
    const q1: PointCharge = { q: 2 * e, pos: vec3(0, r12, 0), rc: 0 }
    const q2: PointCharge = { q: -3 * e, pos: vec3(0, 0, 0), rc: 0 }
    const q3: PointCharge = { q: -5 * e, pos: vec3(r32, 0, 0), rc: 0 }

    const F = forceOn([q1, q2, q3], q2)

    expectRel(F.x, PRINTED_FX, SIG3, 'Example 5.2 Fx vs printed')
    expectRel(F.y, PRINTED_FY, SIG3, 'Example 5.2 Fy vs printed')
    expectAbs(F.z, 0, 1e-12 * PRINTED_F, 'Example 5.2 Fz is zero (planar geometry)')
    expectRel(length(F), PRINTED_F, SIG3, 'Example 5.2 |F| vs printed 4.08e-14 N')
    // 58° above the −x axis: angle measured from −x toward +y. Printed to the nearest degree.
    const deg = (Math.atan2(F.y, -F.x) * 180) / Math.PI
    expectAbs(deg, PRINTED_DEG, 0.5, 'Example 5.2 angle above −x axis')
    // Closed form: Fx = −k|q₂||q₃|/r₃₂², Fy = +k|q₂||q₁|/r₁₂².
    const closed = vec3(-(K_E * 3 * e * 5 * e) / (r32 * r32), (K_E * 3 * e * 2 * e) / (r12 * r12), 0)
    expectVec3Rel(F, closed, CLOSED, 'Example 5.2 vs closed form')
  })

  // Example 6.3 "Electric Flux through a Plane, Integral Method", Ch 6.1 Electric Flux
  // https://openstax.org/books/university-physics-volume-2/pages/6-1-electric-flux
  // Inputs: uniform E = 10 N/C, angle between E and the surface unit normal = 30°, planar area 6.0 m².
  // Printed: Φ = 52 N·m²/C (E·A·cos 30° = 51.96..., the print rounds to 2 sig figs but is within 7e-4).
  // Open flat surface, so this goes through fluxUniformLoop; the closed-surface case is Example 6.5 below.
  it('OpenStax Vol 2 Ch 6 worked example: Example 6.3, flux through a plane in a uniform field (fluxUniformLoop)', () => {
    const E0 = 10
    const A = 6.0
    const theta = Math.PI / 6
    const PRINTED_PHI = 52
    // Surface in the xy-plane with normal +z; E tilted 30° off the normal toward +x.
    const E = vec3(E0 * Math.sin(theta), 0, E0 * Math.cos(theta))
    // Unnormalized on purpose: the contract says normal is normalized first.
    const normal = vec3(0, 0, 3)

    const phi = fluxUniformLoop(E, A, normal)

    expectRel(phi, PRINTED_PHI, SIG3, 'Example 6.3 Φ vs printed 52 N·m²/C')
    // Closed form: Φ = E A cos θ.
    expectRel(phi, E0 * A * Math.cos(theta), CLOSED, 'Example 6.3 vs closed form')
  })

  // Example 6.5 "Electric Flux through Gaussian Surfaces", Ch 6.2 Explaining Gauss's Law
  // https://openstax.org/books/university-physics-volume-2/pages/6-2-explaining-gausss-law
  // The book prints these to TWO sig figs (2.3e5 for 2.0 μC/ε₀; CODATA gives 2.259e5, a 1.8% gap; part (d)
  // 1.1e5 vs 1.129e5, 2.7%), so the table's 3-sig-fig 5e-3 tolerance cannot be met against the printed
  // value. It is the only closed-surface example with numbers in Ch 6 (6.6–6.8 are symbolic), so it stays.
  // Three checks per part:
  //   1. printed value at the printed precision: half a unit in the last printed digit (0.05e5 absolute);
  //   2. the book's own unrounded arithmetic q_enc / 8.85e-12 (the ε₀ OpenStax prints) at SIG3, which is
  //      4.7e-4 from the CODATA result and is the closest the book gets to a 3-sig-fig closed-surface value;
  //   3. the closed form q_enc / EPSILON_0 at 1e-9 relative.
  // CONTRACT NOTE: the table row (sims/01-charge-field-flux.md, "Ch 6 worked example [TBD]") still says
  // "3 sig figs". For the file and the table to agree it should read: Example 6.5(c–e), flux through
  // Gaussian surfaces | 2.3e5, 1.1e5, 0 N·m²/C | printed precision (2 sig figs, ±0.05e5 absolute), plus
  // 3 sig figs against the book's own q_enc/ε₀ arithmetic. The table is outside this file's edit scope.
  // The Gaussian surface is a cubeSphere(4, 1 m). It is inscribed in the unit sphere, so its planar faces
  // bow inside it: the inradius is ≈ 0.947 (n = 1..4: 0.577, 0.844, 0.905, 0.947). Only |p| < 0.947 is
  // guaranteed inside and only |p| > 1 guaranteed outside. Test points below stay at |p| ≤ 0.53 inside and
  // |p| ≥ 2.2 outside, well clear of both bounds.
  const HALF_ULP_2SIG = 0.05e5
  /** ε₀ as OpenStax prints it (the book's arithmetic rounds 2.0e-6 / 8.85e-12 = 2.26e5 to 2.3e5). */
  const BOOK_EPSILON_0 = 8.85e-12
  const uC = 1e-6
  const R = 1

  // Part (c): +2.0 μC enclosed; +4.0 μC and −2.0 μC outside. Printed: Φ = 2.3e5 N·m²/C.
  it('OpenStax Vol 2 Ch 6 worked example: Example 6.5(c), one charge enclosed and two outside (fluxExact)', () => {
    const PRINTED_PHI = 2.3e5
    const charges: PointCharge[] = [
      { q: 2.0 * uC, pos: vec3(0.2, 0.1, -0.15), rc: 0 }, // |p| = 0.27 < R
      { q: 4.0 * uC, pos: vec3(3.0, 0.5, 0.2), rc: 0 }, // outside
      { q: -2.0 * uC, pos: vec3(-2.5, 1.0, -0.7), rc: 0 }, // outside
    ]
    const mesh = cubeSphere(4, R)

    const phi = fluxExact(mesh, charges)

    expectAbs(phi, PRINTED_PHI, HALF_ULP_2SIG, 'Example 6.5(c) Φ vs printed 2.3e5 (2 sig figs)')
    // The book's own arithmetic before rounding: 2.0 μC / 8.85e-12 = 2.26e5, 3 sig figs.
    expectRel(phi, (2.0 * uC) / BOOK_EPSILON_0, SIG3, 'Example 6.5(c) Φ vs book q_enc/ε₀ with ε₀ = 8.85e-12')
    // Closed form: only the enclosed +2.0 μC counts.
    expectRel(phi, (2.0 * uC) / EPSILON_0, CLOSED, 'Example 6.5(c) vs q_enc/ε₀')
  })

  // Part (d): −1.0 μC, −4.0 μC, +6.0 μC enclosed; −5.0 μC and +4.0 μC outside. Printed: Φ = 1.1e5 N·m²/C.
  it('OpenStax Vol 2 Ch 6 worked example: Example 6.5(d), net +1.0 μC enclosed with charges outside (fluxExact)', () => {
    const PRINTED_PHI = 1.1e5
    const charges: PointCharge[] = [
      { q: -1.0 * uC, pos: vec3(0.3, -0.2, 0.1), rc: 0 }, // inside
      { q: -4.0 * uC, pos: vec3(-0.25, 0.35, -0.3), rc: 0 }, // inside
      { q: 6.0 * uC, pos: vec3(0.1, 0.15, 0.4), rc: 0 }, // inside
      { q: -5.0 * uC, pos: vec3(2.0, -1.5, 0.6), rc: 0 }, // outside
      { q: 4.0 * uC, pos: vec3(-1.2, -0.8, 1.9), rc: 0 }, // outside
    ]
    const mesh = cubeSphere(4, R)

    const phi = fluxExact(mesh, charges)

    expectAbs(phi, PRINTED_PHI, HALF_ULP_2SIG, 'Example 6.5(d) Φ vs printed 1.1e5 (2 sig figs)')
    // The book's own arithmetic before rounding: 1.0 μC / 8.85e-12 = 1.13e5, 3 sig figs.
    expectRel(phi, (1.0 * uC) / BOOK_EPSILON_0, SIG3, 'Example 6.5(d) Φ vs book q_enc/ε₀ with ε₀ = 8.85e-12')
    // Closed form: q_enc = −1 − 4 + 6 = +1.0 μC.
    expectRel(phi, (1.0 * uC) / EPSILON_0, CLOSED, 'Example 6.5(d) vs q_enc/ε₀')
  })

  // Part (e): +4.0 μC, +6.0 μC, −10.0 μC enclosed; +5.0 μC and +3.0 μC outside. Printed: Φ = 0.
  it('OpenStax Vol 2 Ch 6 worked example: Example 6.5(e), enclosed charges sum to zero (fluxExact)', () => {
    const charges: PointCharge[] = [
      { q: 4.0 * uC, pos: vec3(0.3, 0.2, -0.1), rc: 0 }, // inside
      { q: 6.0 * uC, pos: vec3(-0.2, -0.3, 0.25), rc: 0 }, // inside
      { q: -10.0 * uC, pos: vec3(0.05, 0.4, 0.3), rc: 0 }, // inside
      { q: 5.0 * uC, pos: vec3(1.8, 0.7, -1.1), rc: 0 }, // outside
      { q: 3.0 * uC, pos: vec3(-0.9, 2.2, 0.4), rc: 0 }, // outside
    ]
    const mesh = cubeSphere(4, R)

    const phi = fluxExact(mesh, charges)

    // Zero by cancellation, so the bound scales with the largest term that cancels: Σ|q|/ε₀ over all charges.
    const sumAbsQ = charges.reduce((s, c) => s + Math.abs(c.q), 0)
    expectAbs(phi, 0, 1e-9 * (sumAbsQ / EPSILON_0), 'Example 6.5(e) Φ = 0')
    expect(Number.isFinite(phi)).toBe(true)
  })
})
