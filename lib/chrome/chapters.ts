import { gsap } from 'gsap'
import type { BeatContent } from './types'

/** One chapter. Scene work happens in the callbacks; the chrome owns the card, the rail and the nav. */
export type BeatSpec = {
  id: string
  content: BeatContent
  /** Tool-belt ids earned on first entry. */
  tools?: readonly string[]
  /**
   * Entry choreography. Fill the timeline (scene inputs and chrome only; camera moves go through the rig).
   * With cut = true add nothing time-based; set end states directly.
   */
  enter?: (tl: gsap.core.Timeline, cut: boolean) => void
  leave?: () => void
  /** Explore-state snapshot taken on leaving, restored on back(). */
  snapshot?: () => unknown
  restore?: (state: unknown) => void
}

export type ChaptersOptions = {
  root: HTMLElement
  /** Class and id prefix, e.g. "sim01". Everything the chrome creates is prefixed, so four sims can share a page. */
  prefix: string
  beats: readonly BeatSpec[]
  reduced: () => boolean
  /** Fires after every navigation. mode 'enter' plays the beat's entry; 'return' is a cut to the saved explore state. */
  onChange?: (index: number, beat: BeatSpec, mode: 'enter' | 'return') => void
}

export type Chapters = {
  goTo(index: number, opts?: { cut?: boolean }): void
  next(): void
  back(): void
  index(): number
  /** Highest chapter reached so far (the rail lets the student jump back to any of these). */
  reached(): number
  /** Gate Next (a checkpoint is open). Cleared automatically on every goTo. */
  lockNext(locked: boolean): void
  el: { rail: HTMLElement; card: HTMLElement; nav: HTMLElement; beltSlot: HTMLElement; panelSlot: HTMLElement }
  destroy(): void
}

/**
 * Next and back with a progress rail. goTo(i) kills any running entry timeline and starts a fresh one
 * from the current state, so it is idempotent from any explore state. back() is a cut to the previous
 * chapter's saved explore state, never a timeline reverse.
 */
export function createChapters(opts: ChaptersOptions): Chapters {
  const { root, prefix: p, beats, reduced } = opts
  const doc = root.ownerDocument
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
    const el = doc.createElement(tag)
    el.className = `${p}-${cls}`
    if (text !== undefined) el.textContent = text
    return el
  }

  // Rail
  const rail = make('nav', 'rail')
  rail.setAttribute('aria-label', 'Chapters')
  const ticks = beats.map((b, i) => {
    const tick = make('button', 'tick')
    tick.type = 'button'
    tick.setAttribute('aria-label', `Chapter ${b.content.label}, ${b.content.title}`)
    tick.disabled = true
    tick.addEventListener('click', () => {
      if (i <= reachedIndex) goTo(i, { cut: i < current })
    })
    rail.appendChild(tick)
    return tick
  })

  // Card
  const card = make('article', 'card')
  const belt = make('div', 'belt-slot')
  const prompt = make('p', 'prompt')
  prompt.setAttribute('aria-live', 'polite')
  const kicker = make('p', 'kicker')
  const kickerLabel = make('span', 'kicker-label')
  const kickerTitle = make('span', 'kicker-title')
  kicker.append(kickerLabel, kickerTitle)
  const body = make('p', 'body')
  const anchor = make('p', 'anchor')
  const reveal = make('div', 'reveal')
  reveal.setAttribute('aria-live', 'polite')
  reveal.append(kicker, body, anchor)
  const panel = make('div', 'panel-slot')
  const nav = make('div', 'nav')
  const backBtn = make('button', 'back', 'Back')
  backBtn.type = 'button'
  const nextBtn = make('button', 'next', 'Next')
  nextBtn.type = 'button'
  nav.append(backBtn, nextBtn)
  card.append(belt, prompt, reveal, panel, nav)
  root.append(rail, card)

  let current = -1
  let reachedIndex = -1
  let locked = false
  let tl: gsap.core.Timeline | null = null
  const snapshots: unknown[] = []

  const paint = (i: number) => {
    const c = beats[i]!.content
    prompt.textContent = c.prompt ?? ''
    prompt.hidden = !c.prompt
    kickerLabel.textContent = c.label
    kickerTitle.textContent = c.title
    body.textContent = c.body
    anchor.textContent = c.anchor
    ticks.forEach((t, k) => {
      t.disabled = k > reachedIndex
      t.classList.toggle(`${p}-tick-current`, k === i)
      t.classList.toggle(`${p}-tick-reached`, k <= reachedIndex)
      if (k === i) t.setAttribute('aria-current', 'step')
      else t.removeAttribute('aria-current')
    })
    backBtn.disabled = i === 0
    nextBtn.disabled = locked || i === beats.length - 1
  }

  const goTo: Chapters['goTo'] = (i, o = {}) => {
    if (i < 0 || i >= beats.length || i === current) return
    const cut = Boolean(o.cut) || reduced()
    const returning = Boolean(o.cut) && i < current
    tl?.kill()
    tl = null
    if (current >= 0) {
      const prev = beats[current]!
      if (prev.snapshot) snapshots[current] = prev.snapshot()
      prev.leave?.()
    }
    current = i
    locked = false
    if (i > reachedIndex) reachedIndex = i
    const beat = beats[i]!
    paint(i)

    // The prompt opens the card; the label, body and anchor follow. One orchestrated reveal per chapter.
    // Focus stays on whatever the student pressed; the live regions announce the new text.
    if (cut) {
      gsap.set([prompt, reveal], { opacity: 1, y: 0 })
      const t = gsap.timeline()
      beat.enter?.(t, true)
      t.kill()
      // A return restores the saved explore state AFTER enter has set the chapter's defaults.
      if (returning && beat.restore && snapshots[i] !== undefined) beat.restore(snapshots[i])
    } else {
      tl = gsap.timeline()
      tl.fromTo(prompt, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0)
      tl.fromTo(reveal, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.35)
      beat.enter?.(tl, false)
    }
    opts.onChange?.(i, beat, returning ? 'return' : 'enter')
  }

  const next = () => goTo(current + 1)
  const back = () => goTo(current - 1, { cut: true })
  backBtn.addEventListener('click', back)
  nextBtn.addEventListener('click', next)

  return {
    goTo,
    next,
    back,
    index: () => current,
    reached: () => reachedIndex,
    lockNext(on) {
      locked = on
      if (current >= 0) paint(current)
    },
    el: { rail, card, nav, beltSlot: belt, panelSlot: panel },
    destroy() {
      tl?.kill()
      rail.remove()
      card.remove()
    },
  }
}
