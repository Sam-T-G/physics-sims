// Layer 3 helpers: promises over GSAP so chapter flows read top to bottom. Everything is created through
// run(), which the mount wires to gsap.context().add, so a revert at unmount kills it all.
import { gsap } from 'gsap'
import { fmtNum } from './format'

export type Run = <T>(fn: () => T) => T

/** Resolves after ms (through the GSAP clock, so it pauses with the ticker and dies with the context). */
export const wait = (run: Run, ms: number): Promise<void> => new Promise(resolve => run(() => gsap.delayedCall(ms / 1000, resolve)))

/**
 * Tweens a number from → to over duration seconds, calling apply each frame. Reduced motion applies `to` at
 * once. `alive` is checked on every update: the moment the owning flow is stale (the student left the
 * chapter) the tween kills itself, so no move can keep writing into state a fresh entry has reset.
 */
export function tweenValue(run: Run, from: number, to: number, duration: number, apply: (v: number) => void, reduced: boolean, alive: () => boolean, ease = 'power2.inOut'): Promise<void> {
  if (!alive()) return Promise.resolve()
  if (reduced || duration <= 0) {
    apply(to)
    return Promise.resolve()
  }
  const proxy = { v: from }
  return new Promise(resolve => {
    run(() =>
      gsap.to(proxy, {
        v: to,
        duration,
        ease,
        onUpdate() {
          if (!alive()) {
            this.kill()
            resolve()
            return
          }
          apply(proxy.v)
        },
        onComplete: resolve,
      }),
    )
  })
}

/** Resolves on the next click of the button. */
export const waitClick = (button: HTMLButtonElement): Promise<void> =>
  new Promise(resolve => button.addEventListener('click', () => resolve(), { once: true }))

export { fmtFixed, fmtNum } from './format'

/** 3 significant figures, student-readable (see format.ts). */
export const sig3 = (x: number): string => fmtNum(x, 3)

/** Flux to 3 sig figs; anything below 1e-6 N·m²/C is rounding noise from a cancelling sum and reads as 0. */
export const formatFlux = (phi: number): string => `Φ = ${sig3(Math.abs(phi) < 1e-6 ? 0 : phi)} N·m²/C`
