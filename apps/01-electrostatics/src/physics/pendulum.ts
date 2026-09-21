// Beat 0: two charged spheres on threads. Layer 1.
import { K_E } from '@lib/physics'

export const PEND_G = 9.81
export const PEND_MASS = 1e-4 // kg, 0.1 g
export const PEND_LENGTH = 0.6 // m
export const PEND_Q = 120e-9 // C, ±120 nC: like signs settle everywhere; opposite signs settle past ~0.9 m and touch below
/** Bob diameter: with opposite signs they swing in until they touch, and stop there. */
export const PEND_CONTACT = 0.15

export type Pendulum = {
  /** Distance between the two suspension points, m. GSAP tweens this; the angle is computed. */
  D: number
  /** true: opposite signs (swing toward), false: like signs (swing away). */
  opposite: boolean
  /** Equilibrium hang angle of each thread from vertical, radians, from tan θ = F/(m g) with F at the live separation. */
  theta(): number
  /** Opposite signs pulled in until the bobs touch: the threads hold them there. */
  touching(): boolean
  /** Live separation of the spheres, m. */
  separation(): number
  force(): number
  bobs(): { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }
  pivots(): { a: { x: number; y: number; z: number }; b: { x: number; y: number; z: number } }
  set(patch: Partial<Pick<Pendulum, 'D' | 'opposite'>>): void
  reset(): void
}

export function createPendulum(): Pendulum {
  const s: Pendulum = {
    D: 0.5,
    opposite: false,
    theta() {
      // Fixed point of tan θ = k q² / (d(θ)² m g) with d = D ∓ 2L sin θ. Like signs settle; opposite signs
      // can run away (attraction grows as they close), and then the real bobs meet and the threads hold
      // them at contact, so the angle is capped there.
      const contact = s.opposite ? Math.asin(Math.min(1, Math.max(0, (s.D - PEND_CONTACT) / (2 * PEND_LENGTH)))) : Math.PI / 2
      let t = 0
      for (let i = 0; i < 40; i++) {
        const d = separationAt(Math.min(t, contact))
        const F = (K_E * PEND_Q * PEND_Q) / (d * d)
        const next = Math.atan(F / (PEND_MASS * PEND_G))
        t = 0.5 * t + 0.5 * next
      }
      return Math.min(t, contact)
    },
    touching() {
      if (!s.opposite) return false
      const contact = Math.asin(Math.min(1, Math.max(0, (s.D - PEND_CONTACT) / (2 * PEND_LENGTH))))
      return s.theta() >= contact - 1e-9
    },
    separation: () => separationAt(s.theta()),
    force() {
      const d = s.separation()
      return (K_E * PEND_Q * PEND_Q) / (d * d)
    },
    bobs() {
      const t = s.theta()
      const dir = s.opposite ? 1 : -1 // toward each other or away
      const dx = PEND_LENGTH * Math.sin(t) * dir
      const dy = -PEND_LENGTH * Math.cos(t)
      return { a: { x: -s.D / 2 + dx, y: dy, z: 0 }, b: { x: s.D / 2 - dx, y: dy, z: 0 } }
    },
    pivots: () => ({ a: { x: -s.D / 2, y: 0, z: 0 }, b: { x: s.D / 2, y: 0, z: 0 } }),
    set(patch) {
      Object.assign(s, patch)
    },
    reset() {
      s.D = 0.5
      s.opposite = false
    },
  }
  function separationAt(t: number): number {
    const swing = 2 * PEND_LENGTH * Math.sin(t)
    const d = s.opposite ? s.D - swing : s.D + swing
    return Math.max(PEND_CONTACT, d)
  }
  return s
}
