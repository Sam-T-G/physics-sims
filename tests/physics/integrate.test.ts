import { describe, expect, it } from 'vitest'
import {
  K_E,
  advance,
  createIntegrator,
  fieldAt,
  interpolated,
  scale,
  step,
  vec3,
  type ParticleState,
  type PointCharge,
} from '@lib/physics'
import { expectAbs, expectRel, expectVec3Rel } from './helpers'

// Stage 0: every test below must fail with "not implemented: <name>" and nothing else.
// Rows owned by this file (01-charge-field-flux.md, Validation tests):
//   Released charge in uniform E: ½(qE/m)t², 1e-12 relative (Verlet is exact for constant a)
//   SHM in the ball kernel, one period at ω·dt = 0.01: x returns to x₀, 1e-5
// plus the accumulator / maxSteps contract of advance(), interpolated(), and createIntegrator().

// Powers of two keep every Verlet term bit-exact for the uniform-field rows: with a = 2 and
// dt = 2⁻¹⁰, x_n = n²·dt², v_n = 2n·dt and t_n = n·dt are all representable for n ≤ 1000, so the
// only thing the 1e-12 tolerance has to absorb is the implementation's own rounding.
const Q_UNIFORM = 2 ** -6 // C
const M_UNIFORM = 2 ** -8 // kg
const E_UNIFORM = 0.5 // V/m, along +z
const A_UNIFORM = (Q_UNIFORM * E_UNIFORM) / M_UNIFORM // = 2 m/s² exactly
const DT_UNIFORM = 2 ** -10 // s

const restAtOrigin = (q: number, m: number): ParticleState => ({ pos: vec3(0, 0, 0), vel: vec3(0, 0, 0), q, m })

describe('integrate', () => {
  it('Released charge in uniform E: ½(qE/m)t² (1e-12 rel, Verlet is exact for constant a)', () => {
    const a = A_UNIFORM
    const integ = createIntegrator(restAtOrigin(Q_UNIFORM, M_UNIFORM), () => vec3(0, 0, a), DT_UNIFORM)
    const N = 1000
    for (let i = 0; i < N; i++) step(integ)
    const t = integ.time
    expectRel(t, N * DT_UNIFORM, 1e-12, 'time = steps·dt')
    expectRel(integ.state.pos.z, 0.5 * a * t * t, 1e-12, 'pos.z = ½at²')
    expectRel(integ.state.vel.z, a * t, 1e-12, 'vel.z = at')
    // Nothing acts in x or y; sums dodge the Object.is(−0, 0) trap.
    expect(integ.state.pos.x + integ.state.pos.y).toBe(0)
    expect(integ.state.vel.x + integ.state.vel.y).toBe(0)
  })

  it('Released charge in uniform E driven through advance() in irregular chunks (1e-12 rel against integ.time)', () => {
    const a = A_UNIFORM
    const dt = DT_UNIFORM
    // maxSteps 8 is never hit: the largest chunk is 3.7·dt.
    const integ = createIntegrator(restAtOrigin(Q_UNIFORM, M_UNIFORM), () => vec3(0, 0, a), dt, 8)
    const chunks = [0.37, 2.2, 0.01, 1.0, 0.5, 3.7, 0.99, 1.01] // ×dt, sums to 9.78·dt per cycle
    const cycles = 100
    for (let c = 0; c < cycles; c++) {
      for (const k of chunks) {
        const { alpha } = advance(integ, k * dt)
        expect(alpha).toBeGreaterThanOrEqual(0)
        expect(alpha).toBeLessThan(1)
        const t = integ.time
        // time is always a whole number of steps
        expectAbs(t / dt, Math.round(t / dt), 1e-9, 'time/dt integer')
        expectRel(integ.state.pos.z, 0.5 * a * t * t, 1e-12, `pos.z = ½at² after chunk ${k}·dt`)
        expectRel(integ.state.vel.z, a * t, 1e-12, `vel.z = at after chunk ${k}·dt`)
      }
    }
    // floor(978·dt / dt) steps, give or take one for accumulator rounding
    const steps = Math.round(integ.time / dt)
    expect(Math.abs(steps - 978)).toBeLessThanOrEqual(1)
    expect(steps).toBeGreaterThan(0)
  })

  it('SHM in the ball kernel, one period at ω·dt = 0.01: x returns to x₀ (1e-5)', () => {
    const q = 1e-9 // ball charge, C
    const rc = 0.01 // m
    const Q = -1e-12 // test charge, C
    const m = 1e-9 // kg
    const ball: PointCharge = { q, pos: vec3(0, 0, 0), rc }
    // Inside rc: E = kq r/rc³, so F = QE = −(k q |Q| / rc³) r is Hooke's law with ω² = k q |Q| / (m rc³).
    const omega = Math.sqrt((K_E * q * Math.abs(Q)) / (m * rc ** 3))
    const T = (2 * Math.PI) / omega
    const N = 628
    const dt = T / N // ω·dt = 2π/628 ≈ 0.01
    const x0 = 0.5 * rc
    const accel = (pos: { x: number; y: number; z: number }) => scale(fieldAt([ball], pos), Q / m)
    const integ = createIntegrator({ pos: vec3(x0, 0, 0), vel: vec3(0, 0, 0), q: Q, m }, accel, dt, N)
    for (let i = 0; i < N; i++) step(integ)
    expectRel(integ.time, T, 1e-9, 'time = one period')
    expectRel(integ.state.pos.x, x0, 1e-5, 'x returns to x₀')
    // Verlet's phase drift over one period is 2π(ωdt)²/24 ≈ 2.6e-5 rad, so |v| ≲ 2.6e-5·ω·x₀.
    expectAbs(integ.state.vel.x, 0, 1e-4 * omega * x0, 'v returns to 0')
    // Motion is along x only; Math.abs folds −0 into 0.
    expect(Math.abs(integ.state.pos.y)).toBe(0)
    expect(Math.abs(integ.state.pos.z)).toBe(0)
    expect(Math.abs(integ.state.vel.y)).toBe(0)
    expect(Math.abs(integ.state.vel.z)).toBe(0)
  })

  it('step is velocity Verlet: x₁ = x₀ + v₀dt + ½a₀dt², v₁ = v₀ + ½(a₀ + a₁)dt', () => {
    // a = x·x̂ (position dependent) distinguishes velocity Verlet from Euler and from a₀-only schemes.
    const dt = 0.25
    const integ = createIntegrator({ pos: vec3(1, 2, 3), vel: vec3(0.5, -0.25, 0.75), q: 1, m: 1 }, (p) => vec3(p.x, 0, 0), dt)
    step(integ)
    const x1 = 1 + 0.5 * dt + 0.5 * 1 * dt * dt
    const v1 = 0.5 + 0.5 * (1 + x1) * dt
    expectRel(integ.state.pos.x, x1, 1e-14, 'x₁')
    expectRel(integ.state.vel.x, v1, 1e-14, 'v₁')
    expectRel(integ.state.pos.y, 2 - 0.25 * dt, 1e-14, 'y₁ drifts at v₀')
    expectRel(integ.state.pos.z, 3 + 0.75 * dt, 1e-14, 'z₁ drifts at v₀')
    expectRel(integ.state.vel.y, -0.25, 1e-14, 'v_y unchanged')
    expectRel(integ.state.vel.z, 0.75, 1e-14, 'v_z unchanged')
    expectRel(integ.time, dt, 1e-14, 'time = dt')
  })

  it('step snapshots prev = state before moving', () => {
    const integ = createIntegrator({ pos: vec3(1, 2, 3), vel: vec3(0.5, -0.25, 0.75), q: 1, m: 1 }, () => vec3(1, 1, 1), 0.25)
    step(integ)
    expect(integ.prev.pos).toEqual(vec3(1, 2, 3))
    expect(integ.prev.vel).toEqual(vec3(0.5, -0.25, 0.75))
    const afterOne = { pos: { ...integ.state.pos }, vel: { ...integ.state.vel } }
    step(integ)
    expect(integ.prev.pos).toEqual(afterOne.pos)
    expect(integ.prev.vel).toEqual(afterOne.vel)
    // prev must be a snapshot, not an alias of the live state
    expect(integ.prev.pos).not.toEqual(integ.state.pos)
  })

  it('accumulator: advance(0.005) with dt 0.01 → alpha 0.5, time 0, no step', () => {
    const integ = createIntegrator(restAtOrigin(1, 1), () => vec3(0, 0, 1), 0.01, 8)
    const { alpha } = advance(integ, 0.005)
    expectAbs(alpha, 0.5, 1e-9, 'alpha')
    expect(integ.time).toBe(0)
    expect(integ.state.pos.z).toBe(0)
    expect(integ.state.vel.z).toBe(0)
  })

  it('accumulator: advance(0.005) then advance(0.006) → one step, time 0.01, alpha 0.1', () => {
    const integ = createIntegrator(restAtOrigin(1, 1), () => vec3(0, 0, 1), 0.01, 8)
    advance(integ, 0.005)
    const { alpha } = advance(integ, 0.006)
    expectAbs(alpha, 0.1, 1e-9, 'alpha')
    expectRel(integ.time, 0.01, 1e-12, 'time')
    // one Verlet step from rest: z = ½·a·dt²
    expectRel(integ.state.pos.z, 0.5 * 1 * 0.01 * 0.01, 1e-12, 'pos.z')
  })

  it('maxSteps: advance(1.0) after 0.011 s takes exactly 8 more steps (time += 0.08) and drops the remainder (alpha 0)', () => {
    const dt = 0.01
    const a = 1
    const integ = createIntegrator(restAtOrigin(1, 1), () => vec3(0, 0, a), dt, 8)
    advance(integ, 0.005)
    advance(integ, 0.006)
    const { alpha } = advance(integ, 1.0)
    expect(alpha).toBe(0)
    expectRel(integ.time, 0.09, 1e-12, 'time = 9·dt')
    expect(Math.round(integ.time / dt)).toBe(9)
    // 9 constant-a steps from rest: z = ½·a·(9dt)²
    expectRel(integ.state.pos.z, 0.5 * a * (9 * dt) ** 2, 1e-12, 'pos.z after 9 steps')
    expectRel(integ.state.vel.z, a * 9 * dt, 1e-12, 'vel.z after 9 steps')
  })

  it('advance(0) and advance(−1) step nothing', () => {
    const dt = 0.01
    const integ = createIntegrator(restAtOrigin(1, 1), () => vec3(0, 0, 1), dt, 8)
    advance(integ, 0.035) // 3 steps, accumulator 0.005
    const time = integ.time
    const z = integ.state.pos.z
    const vz = integ.state.vel.z
    expect(Math.round(time / dt)).toBe(3)
    for (const delta of [0, -1]) {
      const { alpha } = advance(integ, delta)
      expect(alpha).toBeGreaterThanOrEqual(0)
      expect(alpha).toBeLessThan(1)
      expect(integ.time).toBe(time)
      expect(integ.state.pos.z).toBe(z)
      expect(integ.state.vel.z).toBe(vz)
    }
  })

  it('interpolated(integ, 0) = prev.pos, interpolated(integ, 1) = state.pos, 0.5 = midpoint', () => {
    // no zero components anywhere, so the exact comparisons never meet −0
    const integ = createIntegrator({ pos: vec3(1, 2, 3), vel: vec3(0.5, -0.25, 0.75), q: 1, m: 1 }, () => vec3(1, 1, 1), 0.25)
    step(integ)
    const prev = integ.prev.pos
    const cur = integ.state.pos
    expect(prev).not.toEqual(cur)
    expect(interpolated(integ, 0)).toEqual(prev)
    expectVec3Rel(interpolated(integ, 1), cur, 1e-14, 'alpha 1')
    const mid = vec3((prev.x + cur.x) / 2, (prev.y + cur.y) / 2, (prev.z + cur.z) / 2)
    expectVec3Rel(interpolated(integ, 0.5), mid, 1e-14, 'alpha 0.5')
  })

  it('createIntegrator copies the state and prev equals state before any step', () => {
    const input: ParticleState = { pos: vec3(1, 2, 3), vel: vec3(4, 5, 6), q: 7, m: 8 }
    const integ = createIntegrator(input, () => vec3(0, 0, 0), 0.01)
    expect(integ.state).toEqual({ pos: vec3(1, 2, 3), vel: vec3(4, 5, 6), q: 7, m: 8 })
    expect(integ.prev).toEqual(integ.state)
    expect(integ.dt).toBe(0.01)
    expect(integ.maxSteps).toBe(8) // default
    expect(integ.accumulator).toBe(0)
    expect(integ.time).toBe(0)
    // Deep copy, on purpose: the stub says only "copied, not aliased", but a shallow { ...state }
    // would leave integ.state.pos === input.pos and the caller's vectors would leak into the live
    // state. Stage 1 must copy pos and vel too. Mutating the input afterwards changes nothing.
    input.pos.x = 99
    input.vel.y = -99
    input.pos = vec3(-1, -2, -3)
    input.q = 0
    input.m = 0
    expect(integ.state).toEqual({ pos: vec3(1, 2, 3), vel: vec3(4, 5, 6), q: 7, m: 8 })
    expect(integ.prev).toEqual({ pos: vec3(1, 2, 3), vel: vec3(4, 5, 6), q: 7, m: 8 })
    // explicit maxSteps is honored
    const integ2 = createIntegrator({ pos: vec3(1, 1, 1), vel: vec3(1, 1, 1), q: 1, m: 1 }, () => vec3(0, 0, 0), 0.5, 3)
    expect(integ2.maxSteps).toBe(3)
    expect(integ2.dt).toBe(0.5)
  })
})

describe('integrate: review regressions (2026-09-20)', () => {
  it('exactly maxSteps steps fitting the frame keeps the sub-step remainder (alpha 0.4), so the clock never runs slow', () => {
    // A frame of 8.4·dt with maxSteps 8: eight steps are taken and 0.4·dt stays in the accumulator.
    // Zeroing it here (the old rule) would lose 0.4·dt every frame, a 5% slow clock with no interpolation.
    const dt = 0.01
    const state: ParticleState = { pos: vec3(0, 0, 0), vel: vec3(0, 0, 0), q: 1, m: 1 }
    const integ = createIntegrator(state, () => vec3(0, 0, 0), dt, 8)
    const { alpha } = advance(integ, 8.4 * dt)
    expectAbs(integ.time, 8 * dt, 1e-12, 'time after exactly eight steps')
    expectAbs(alpha, 0.4, 1e-9, 'alpha keeps the remainder')
    // A real backlog (a stall) is still dropped.
    const dropped = advance(integ, 9.4 * dt)
    expectAbs(integ.time, 16 * dt, 1e-12, 'eight more steps')
    expect(dropped.alpha).toBe(0)
  })
})
