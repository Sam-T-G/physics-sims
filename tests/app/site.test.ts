import { describe, expect, it } from 'vitest'
import { packageOf, OPENSTAX_CREDIT } from '../../scripts/site-build'
import { meta } from '../../apps/02-circuits/src/sim.meta'

describe('site build extras', () => {
  it('finds the package behind a bundled module id, pnpm layout and scoped names included', () => {
    expect(packageOf('/r/node_modules/.pnpm/three@0.186.0/node_modules/three/build/three.core.js'))
      .toEqual({ name: 'three', dir: '/r/node_modules/.pnpm/three@0.186.0/node_modules/three' })
    expect(packageOf('/r/node_modules/@fontsource-variable/nunito/index.css?inline')?.name).toBe('@fontsource-variable/nunito')
    expect(packageOf('\0/r/node_modules/katex/dist/katex.mjs')?.name).toBe('katex')
    expect(packageOf('/r/apps/02-circuits/src/sim.ts')).toBeNull()
    expect(packageOf('/r/node_modules/.vite/deps/x.js')).toBeNull()
  })

  it('the OpenStax credit names the book, the license and the required attribution line', () => {
    expect(OPENSTAX_CREDIT).toContain('University Physics Volume 2')
    expect(OPENSTAX_CREDIT).toContain('https://openstax.org/details/books/university-physics-volume-2')
    expect(OPENSTAX_CREDIT).toContain('CC BY-NC-SA 4.0')
    expect(OPENSTAX_CREDIT).toContain('Access for free at openstax.org.')
  })

  it('sim 2 coverage matches the tour: Ch 8 to 10, with C = Q/V, I = ΔQ/Δt and R = V/I covered', () => {
    expect(meta.chapters).toBe('OpenStax University Physics Vol 2, Ch 8–10')
    const covers = meta.coverage.covers.join(' | ')
    for (const s of ['8.1 (C = Q/V', '9.1 (I = ΔQ/Δt', '9.3 (R = V/I', '10.5']) expect(covers).toContain(s)
    for (const s of meta.coverage.notCovered) expect(meta.coverage.covers).not.toContain(s)
  })
})
