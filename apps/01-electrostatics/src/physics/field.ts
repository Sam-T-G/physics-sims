// Beat 3: the field of one or two charges, a probe, a slice plane, lines, and a released charge. Layer 1.
import {
  K_E,
  advance,
  createIntegrator,
  fieldAt,
  length,
  scale,
  seedLines,
  traceLine,
  type FieldLine,
  type Integrator,
  type PointCharge,
  type Vec3,
} from '@lib/physics'

export const FIELD_UNIT = 1e-6 // μC source charges
export const FIELD_RC = 0.06
export const PROBE_UNIT = 1e-9 // C, one probe unit
export const SLICE_N = 15
export const SLICE_HALF = 1.1
export const LINES_PER_UC = 24
/** Released test particle: 1 nC on a 1 ng speck. */
export const PARTICLE_Q = 1e-9
export const PARTICLE_M = 1e-12
/** ω_max·dt ≤ 0.1 with ω_max ≈ 2.0e5 rad/s for these numbers (PARTICLE_OMEGA_MAX below). */
export const DT = 4e-7
/** Sim seconds per wall second: the ~ms flight across a metre plays out over a few seconds. */
export const TIME_SCALE = 0.0025
export const MAX_PATH = 4000

export type Field = {
  /** single: one +; dipole: + and −; like: + and +. */
  pair: 'single' | 'dipole' | 'like'
  charges(): PointCharge[]
  /** Probe multiplier: +1, +2, −1 (× PROBE_UNIT). */
  q0: number
  probe: Vec3
  /** Force on the probe and the field there: F changes with q0, E does not. */
  probeForce(): Vec3
  probeField(): Vec3
  /** Each charge's own contribution at the probe, for the superposition drawing. */
  contributions(): Vec3[]
  /** Slice plane z = sliceZ: SLICE_N × SLICE_N samples of E. Writes positions and fields; returns log10 |E| range. */
  sliceZ: number
  slice(pos: Float64Array, dir: Float64Array, mag: Float64Array): { logMin: number; logMax: number }
  lines: FieldLine[]
  linesVersion: number
  retrace(): void
  /** The released charge. */
  particle: Integrator | null
  /** false once captured or out of the box; the path stays drawn. */
  flying: boolean
  path: Vec3[]
  releaseAt(p: Vec3): void
  clearParticle(): void
  /** Advance the particle by wall-clock seconds (scaled). Returns false once it is captured or gone. */
  tick(deltaSeconds: number): boolean
  /** Field line through the particle's release point, for the comparison. */
  lineThrough(p: Vec3): FieldLine
  set(patch: Partial<Pick<Field, 'pair' | 'q0' | 'sliceZ'>>): void
  setProbe(p: Vec3): void
  reset(): void
}

export function createField(): Field {
  const box = { min: { x: -2.2, y: -2.2, z: -2.2 }, max: { x: 2.2, y: 2.2, z: 2.2 } }
  const traceOpts = { hMin: 2e-3, hMax: 0.05, eMin: 1e-2, maxSteps: 4000, box }
  const s: Field = {
    pair: 'single',
    q0: 1,
    probe: { x: 0.35, y: -0.25, z: 0 },
    sliceZ: 0,
    lines: [],
    linesVersion: 0,
    particle: null,
    flying: false,
    path: [],
    charges() {
      const list: PointCharge[] = [{ q: FIELD_UNIT, pos: { x: -0.5, y: 0, z: 0 }, rc: FIELD_RC }]
      if (s.pair === 'dipole') list.push({ q: -FIELD_UNIT, pos: { x: 0.5, y: 0, z: 0 }, rc: FIELD_RC })
      if (s.pair === 'like') list.push({ q: FIELD_UNIT, pos: { x: 0.5, y: 0, z: 0 }, rc: FIELD_RC })
      return list
    },
    probeForce: () => scale(fieldAt(s.charges(), s.probe), s.q0 * PROBE_UNIT),
    probeField: () => fieldAt(s.charges(), s.probe),
    contributions: () => s.charges().map(c => fieldAt([c], s.probe)),
    slice(pos, dir, mag) {
      const cs = s.charges()
      let logMin = Infinity
      let logMax = -Infinity
      let k = 0
      for (let i = 0; i < SLICE_N; i++) {
        for (let j = 0; j < SLICE_N; j++) {
          const x = -SLICE_HALF + (2 * SLICE_HALF * i) / (SLICE_N - 1)
          const y = -SLICE_HALF + (2 * SLICE_HALF * j) / (SLICE_N - 1)
          const p = { x, y, z: s.sliceZ }
          const E = fieldAt(cs, p)
          const m = length(E)
          const singular = cs.some(c => length({ x: p.x - c.pos.x, y: p.y - c.pos.y, z: p.z - c.pos.z }) < c.rc)
          pos[3 * k] = x
          pos[3 * k + 1] = y
          pos[3 * k + 2] = s.sliceZ
          dir[3 * k] = E.x
          dir[3 * k + 1] = E.y
          dir[3 * k + 2] = E.z
          mag[k] = singular || m === 0 ? NaN : Math.log10(m)
          if (!Number.isNaN(mag[k]!)) {
            if (mag[k]! < logMin) logMin = mag[k]!
            if (mag[k]! > logMax) logMax = mag[k]!
          }
          k++
        }
      }
      return { logMin, logMax }
    },
    retrace() {
      s.lines = seedLines(s.charges(), LINES_PER_UC / FIELD_UNIT, traceOpts)
      s.linesVersion++
    },
    releaseAt(p) {
      // Reads the live sources, so the particle always flies in the field on screen.
      const accel = (pos: Vec3) => scale(fieldAt(s.charges(), pos), PARTICLE_Q / PARTICLE_M)
      s.particle = createIntegrator({ pos: { ...p }, vel: { x: 0, y: 0, z: 0 }, q: PARTICLE_Q, m: PARTICLE_M }, accel, DT, 160)
      s.flying = true
      s.path = [{ ...p }]
    },
    clearParticle() {
      s.particle = null
      s.flying = false
      s.path = []
    },
    tick(deltaSeconds) {
      const integ = s.particle
      if (!integ || !s.flying) return false
      advance(integ, deltaSeconds * TIME_SCALE)
      const p = integ.state.pos
      if (s.path.length < MAX_PATH) s.path.push({ ...p })
      const cs = s.charges()
      const captured = cs.some(c => length({ x: p.x - c.pos.x, y: p.y - c.pos.y, z: p.z - c.pos.z }) < c.rc)
      // Wider than the line box: a charge released from rest here is bound and turns around near 2.9 m.
      const gone = Math.abs(p.x) > 3.6 || Math.abs(p.y) > 3.6 || Math.abs(p.z) > 3.6
      if (captured || gone) s.flying = false
      return s.flying
    },
    lineThrough: p => traceLine(s.charges(), p, { ...traceOpts, direction: 1 }),
    set(patch) {
      Object.assign(s, patch)
    },
    setProbe(p) {
      s.probe = { ...p }
    },
    reset() {
      s.pair = 'single'
      s.q0 = 1
      s.probe = { x: 0.35, y: -0.25, z: 0 }
      s.sliceZ = 0
      s.clearParticle()
      s.retrace()
    },
  }
  s.retrace()
  return s
}

/** ω_max of the ball kernel for the released particle, to document the dt choice: ω·dt ≤ 0.1. */
export const PARTICLE_OMEGA_MAX = Math.sqrt((K_E * FIELD_UNIT * PARTICLE_Q) / (PARTICLE_M * FIELD_RC ** 3))
