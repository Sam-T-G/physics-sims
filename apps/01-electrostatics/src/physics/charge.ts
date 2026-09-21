// Beat 1: a neutral pair pulled apart. Layer 1: imports only from @lib/physics.
import { E_CHARGE } from '@lib/physics'

export type ChargePair = {
  /** Units of e on each sphere, 1..8. */
  n: number
  /** 0 = overlapping and neutral-looking, 1 = fully apart. */
  apart: number
  /** false: the second sphere carries −n e (the pair came from nothing); true: both +n e (charge came from elsewhere). */
  same: boolean
  /** Separation at apart = 1, metres. */
  fullSeparation: number
  positions(): { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }
  charges(): { a: number; b: number }
  /** Σ q in units of e, computed, never assumed. */
  totalE(): number
  /** +1 attract (arrows point at each other), −1 repel, from the sign of q_a·q_b. 0 when overlapping. */
  attraction(): 1 | -1 | 0
  set(patch: Partial<Pick<ChargePair, 'n' | 'apart' | 'same'>>): void
  reset(): void
}

export function createChargePair(): ChargePair {
  const s: ChargePair = {
    n: 3,
    apart: 0,
    same: false,
    fullSeparation: 0.9,
    positions() {
      const half = (s.fullSeparation * s.apart) / 2
      return { a: { x: -half, y: 0, z: 0 }, b: { x: half, y: 0, z: 0 } }
    },
    charges() {
      const qa = s.n * E_CHARGE
      return { a: qa, b: s.same ? qa : -qa }
    },
    totalE() {
      const { a, b } = s.charges()
      return Math.round((a + b) / E_CHARGE)
    },
    attraction() {
      if (s.apart < 0.05) return 0
      const { a, b } = s.charges()
      return a * b < 0 ? 1 : -1
    },
    set(patch) {
      Object.assign(s, patch)
    },
    reset() {
      s.n = 3
      s.apart = 0
      s.same = false
    },
  }
  return s
}
