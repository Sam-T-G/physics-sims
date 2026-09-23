import { gsap } from 'gsap'
import { watchReducedMotion } from '@lib/chrome'
import '@lib/tokens.css'
import './styles.css'
import { meta } from './sim.meta'
import { createSim1Physics } from './physics'
import { createSim1Render, type Sim1Render } from './render/index'
import { isWideLayout } from '@lib/render'
import { createSim1Chrome, type Sim1Chrome } from './chrome'

// Layer 3 (chrome) owns this file. It and chrome.ts are the only places gsap is imported in this app.
// mount/unmount is the compile-later contract: assume nothing about owning the page,
// leave no global listeners, no window globals, and revert everything on unmount.

export type MountOptions = { basePath?: string }

type Mounted = {
  ctx: gsap.Context
  render: Sim1Render | null
  chrome: Sim1Chrome | null
  ro: ResizeObserver | null
  tick: ((time: number, deltaMs: number) => void) | null
  /** Nodes this sim appended to the mount; unmount removes exactly these. */
  created: Element[]
}

const instances = new WeakMap<HTMLElement, Mounted>()

export function mount(el: HTMLElement, _opts: MountOptions = {}): void {
  if (instances.has(el)) return
  el.classList.add('sim01')
  el.setAttribute('aria-label', meta.title)

  const canvas = document.createElement('canvas')
  canvas.className = 'sim01-canvas'
  canvas.id = 'sim01-canvas'
  el.appendChild(canvas)

  const css = getComputedStyle(el)
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  const physics = createSim1Physics()
  const render = createSim1Render(
    canvas,
    physics,
    {
      bg: token('--ps-bg', '#101a2e'),
      pos: token('--ps-pos', '#ff7a59'),
      neg: token('--ps-neg', '#58a6ff'),
      shell: token('--ps-shell', '#9fb4d8'),
      surface: token('--ps-surface', '#c9d6ea'),
      line: token('--ps-line', '#f3d9a4'),
      fg: token('--ps-fg', '#eef1f6'),
      magLo: token('--ps-mag-lo', '#3e4c6a'),
      magMid: token('--ps-mag-mid', '#8e97ad'),
      magHi: token('--ps-mag-hi', '#fff0c2'),
    },
    { pixelRatio: Math.min(window.devicePixelRatio, 2), document: el.ownerDocument },
  )

  if (!render) {
    // The page says so instead of failing silently (README definition of done).
    const notice = document.createElement('p')
    notice.className = 'sim01-notice'
    notice.id = 'sim01-notice'
    notice.textContent = 'This simulation needs WebGL, and this browser does not have it enabled.'
    el.appendChild(notice)
    instances.set(el, { ctx: gsap.context(() => {}, el), render: null, chrome: null, ro: null, tick: null, created: [canvas, notice] })
    return
  }

  // Size from the mount element, never window. The layout class and the camera offset come from one predicate.
  const resize = () => {
    const w = el.clientWidth
    const h = el.clientHeight
    el.classList.toggle('sim01-wide', isWideLayout(w, h))
    render.layout(w, h)
  }
  const ro = new ResizeObserver(resize)
  ro.observe(el)
  resize()

  let chrome: Sim1Chrome | null = null
  const ctx = gsap.context(() => {
    const motion = watchReducedMotion()
    // Every tween created later (in click handlers, flows) goes through run, so the context still owns it.
    const run = <T,>(fn: () => T): T => ctx.add(fn) as T
    chrome = createSim1Chrome({ el, render, physics, reduced: motion.reduced, run })
  }, el)

  // One clock. Chrome subscribes to gsap.ticker and hands deltaSeconds down; layer 1 never sees the ticker.
  // gsap.ticker.deltaTime is in milliseconds.
  const tick = (_time: number, deltaMs: number) => {
    chrome?.update(deltaMs / 1000)
    render.frame()
  }
  gsap.ticker.add(tick)

  if (import.meta.env.DEV) {
    // Dev-only hook for the memory assertion (renderer.info.memory unchanged after a full pass). Not a window global.
    Object.defineProperty(el, '__sim01', {
      value: { memory: () => ({ ...render.stage.renderer.info.memory }), chapters: chrome!.chapters, physics },
      configurable: true,
    })
  }

  instances.set(el, { ctx, render, chrome, ro, tick, created: [canvas] })
}

export function unmount(el: HTMLElement): void {
  const m = instances.get(el)
  if (!m) return
  if (m.tick) gsap.ticker.remove(m.tick)
  m.ctx.revert()
  m.chrome?.destroy()
  m.ro?.disconnect()
  m.render?.dispose()
  if (import.meta.env.DEV) delete (el as unknown as Record<string, unknown>)['__sim01']
  for (const node of m.created) node.remove()
  el.classList.remove('sim01', 'sim01-wide')
  el.removeAttribute('aria-label')
  instances.delete(el)
}
