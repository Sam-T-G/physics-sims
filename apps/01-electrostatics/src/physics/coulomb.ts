// Beat 2: two charges on a line, a third one off it. Layer 1.
import { K_E, forceOn, type PointCharge, type Vec3 } from '@lib/physics'

export const COULOMB_UNIT = 1e-6 // μC
export const COULOMB_RC = 0.04
export const COULOMB_R_MIN = 0.3
export const COULOMB_R_MAX = 1.6
/** Force at r = 0.5 m for 1 μC × 1 μC, the arrow-length reference. */
export const COULOMB_F_REF = (K_E * COULOMB_UNIT * COULOMB_UNIT) / 0.25

export type Coulomb = {
  /** μC */
  q1: number
  q2: number
  q3: number
  r: number
  third: boolean
  charges(): PointCharge[]
  /** Forces in newtons on q1, q2, q3 (q3's is {0,0,0} when off). */
  forces(): { f1: Vec3; f2: Vec3; f3: Vec3 }
  /** The two pair forces on q2 (from q1 and from q3), for the tip-to-tail drawing. */
  pairForcesOnQ2(): { fromQ1: Vec3; fromQ3: Vec3 }
  /** |F| between q1 and q2 alone, k|q1 q2|/r². */
  pairMagnitude(): number
  /** k q1 q2 / r² sampled along r for the plot. */
  curve(points: number): { x: number; y: number }[]
  set(patch: Partial<Pick<Coulomb, 'q1' | 'q2' | 'q3' | 'r' | 'third'>>): void
  reset(): void
}

export function createCoulomb(): Coulomb {
  const s: Coulomb = {
    q1: 1,
    q2: 1,
    q3: -1,
    r: 0.5,
    third: false,
    charges() {
      const list: PointCharge[] = [
        { q: s.q1 * COULOMB_UNIT, pos: { x: -0.5, y: 0, z: 0 }, rc: COULOMB_RC },
        { q: s.q2 * COULOMB_UNIT, pos: { x: -0.5 + s.r, y: 0, z: 0 }, rc: COULOMB_RC },
      ]
      if (s.third) list.push({ q: s.q3 * COULOMB_UNIT, pos: { x: 0.15, y: 0.6, z: 0 }, rc: COULOMB_RC })
      return list
    },
    forces() {
      const cs = s.charges()
      const f1 = forceOn(cs, cs[0]!)
      const f2 = forceOn(cs, cs[1]!)
      const f3 = cs[2] ? forceOn(cs, cs[2]) : { x: 0, y: 0, z: 0 }
      return { f1, f2, f3 }
    },
    pairForcesOnQ2() {
      const cs = s.charges()
      const fromQ1 = forceOn([cs[0]!, cs[1]!], cs[1]!)
      const fromQ3 = cs[2] ? forceOn([cs[2], cs[1]!], cs[1]!) : { x: 0, y: 0, z: 0 }
      return { fromQ1, fromQ3 }
    },
    pairMagnitude: () => (K_E * Math.abs(s.q1 * s.q2) * COULOMB_UNIT * COULOMB_UNIT) / (s.r * s.r),
    curve(points) {
      const out: { x: number; y: number }[] = []
      for (let k = 0; k <= points; k++) {
        const r = COULOMB_R_MIN + (k / points) * (COULOMB_R_MAX - COULOMB_R_MIN)
        out.push({ x: r, y: (K_E * Math.abs(s.q1 * s.q2) * COULOMB_UNIT * COULOMB_UNIT) / (r * r) })
      }
      return out
    },
    set(patch) {
      Object.assign(s, patch)
    },
    reset() {
      s.q1 = 1
      s.q2 = 1
      s.q3 = -1
      s.r = 0.5
      s.third = false
    },
  }
  return s
}
