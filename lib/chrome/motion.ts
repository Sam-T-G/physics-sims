import { gsap } from 'gsap'

/**
 * Tracks prefers-reduced-motion through gsap.matchMedia. Call INSIDE the sim's gsap.context() so the
 * listener is reverted with it. When reduced, transitions become cuts; the physics still runs.
 */
export function watchReducedMotion(): { reduced(): boolean } {
  let reduced = false
  const mm = gsap.matchMedia()
  mm.add({ reduce: '(prefers-reduced-motion: reduce)', full: '(prefers-reduced-motion: no-preference)' }, ctx => {
    const c = ctx.conditions as { reduce?: boolean } | undefined
    reduced = Boolean(c?.reduce)
  })
  return { reduced: () => reduced }
}
