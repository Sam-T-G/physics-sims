import type { Vec3 } from './vec3'

export type ParticleState = { pos: Vec3; vel: Vec3; q: number; m: number }

/**
 * Fixed-timestep velocity-Verlet integrator. Holds the accumulator and takes a number of seconds,
 * never the ticker (ARCHITECTURE.md, one clock). state is the live state, prev the snapshot before
 * the most recent step (equal to state before any step), time the simulated seconds elapsed = steps·dt.
 */
export type Integrator = {
  state: ParticleState
  prev: ParticleState
  accel: (pos: Vec3) => Vec3
  dt: number
  maxSteps: number
  accumulator: number
  time: number
}

const copyState = (s: ParticleState): ParticleState => ({ pos: { ...s.pos }, vel: { ...s.vel }, q: s.q, m: s.m })

/**
 * state is deep-copied (pos and vel are fresh objects), so mutating the caller's objects afterwards changes
 * nothing. accel returns acceleration (m/s²) at a position; the caller folds q/m in.
 */
export function createIntegrator(state: ParticleState, accel: (pos: Vec3) => Vec3, dt: number, maxSteps = 8): Integrator {
  if (!(dt > 0)) throw new RangeError(`createIntegrator: dt must be positive, got ${dt}`)
  return { state: copyState(state), prev: copyState(state), accel, dt, maxSteps, accumulator: 0, time: 0 }
}

/**
 * One velocity-Verlet step of dt: x₁ = x₀ + v₀dt + ½a₀dt², v₁ = v₀ + ½(a₀ + a₁)dt.
 * Snapshots prev = state before moving. Exact for constant acceleration (up to rounding).
 */
export function step(integ: Integrator): void {
  const { state, dt } = integ
  integ.prev = copyState(state)
  const a0 = integ.accel(state.pos)
  const half = 0.5 * dt * dt
  const pos1 = {
    x: state.pos.x + state.vel.x * dt + a0.x * half,
    y: state.pos.y + state.vel.y * dt + a0.y * half,
    z: state.pos.z + state.vel.z * dt + a0.z * half,
  }
  const a1 = integ.accel(pos1)
  state.vel = {
    x: state.vel.x + 0.5 * (a0.x + a1.x) * dt,
    y: state.vel.y + 0.5 * (a0.y + a1.y) * dt,
    z: state.vel.z + 0.5 * (a0.z + a1.z) * dt,
  }
  state.pos = pos1
  integ.time += dt
}

/**
 * Adds deltaSeconds to the accumulator, steps while accumulator ≥ dt, at most maxSteps times.
 * If maxSteps was hit with a full step still pending (a stall), the remainder is dropped (accumulator = 0);
 * if exactly maxSteps steps fit, the sub-step remainder is kept, so the sim clock never runs slow at a
 * frame rate that happens to be a multiple of dt. Returns alpha = accumulator / dt ∈ [0, 1) for render
 * interpolation. deltaSeconds ≤ 0 steps nothing.
 */
export function advance(integ: Integrator, deltaSeconds: number): { alpha: number } {
  if (deltaSeconds > 0) integ.accumulator += deltaSeconds
  let steps = 0
  while (integ.accumulator >= integ.dt && steps < integ.maxSteps) {
    step(integ)
    integ.accumulator -= integ.dt
    steps++
  }
  if (steps === integ.maxSteps && integ.accumulator >= integ.dt) integ.accumulator = 0
  return { alpha: integ.accumulator / integ.dt }
}

/** (1 − alpha)·prev.pos + alpha·state.pos: the position to draw between fixed steps. Exact at 0 and 1. */
export function interpolated(integ: Integrator, alpha: number): Vec3 {
  const a = integ.prev.pos
  const b = integ.state.pos
  const w = 1 - alpha
  return { x: w * a.x + alpha * b.x, y: w * a.y + alpha * b.y, z: w * a.z + alpha * b.z }
}
