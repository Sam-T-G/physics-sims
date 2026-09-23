import { gsap } from 'gsap'
import type { BeatContent } from './types'
import { setRichText } from './richText'

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
  /** body is the scrolling region of the card; the handle and the nav stay put. */
  el: { rail: HTMLElement; card: HTMLElement; head: HTMLElement; body: HTMLElement; nav: HTMLElement; beltSlot: HTMLElement; panelSlot: HTMLElement }
  /** Phone sheet height: tall shows most of the card, else the half-height peek. */
  setTall(on: boolean): void
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
    // The chapter label rides beside the current tick (shown by CSS); the button's aria-label already says it.
    const num = make('span', 'tick-label', b.content.label)
    num.setAttribute('aria-hidden', 'true')
    tick.appendChild(num)
    tick.disabled = true
    tick.addEventListener('click', () => {
      if (i <= reachedIndex) goTo(i, { cut: i < current })
    })
    rail.appendChild(tick)
    return tick
  })

  // Card: a bottom sheet on phones (readout strip, handle, scrolling body, fixed nav), a column on wide screens.
  const card = make('article', 'card')
  const head = make('div', 'card-head')
  const grab = make('button', 'grab')
  grab.type = 'button'
  grab.setAttribute('aria-label', 'Expand the card')
  grab.setAttribute('aria-expanded', 'false')
  const scroller = make('div', 'card-body')
  const belt = make('div', 'belt-slot')
  // Chapter label above the prompt, so the unlabelled rail has a name on the page; then the prompt opens
  // the card; the explanation follows with its curriculum anchor inline at the end.
  const kicker = make('p', 'kicker')
  const kickerLabel = make('span', 'kicker-label')
  const kickerTitle = make('span', 'kicker-title')
  kicker.append(kickerLabel, kickerTitle)
  const prompt = make('p', 'prompt')
  prompt.setAttribute('aria-live', 'polite')
  const body = make('p', 'body')
  const anchor = make('span', 'anchor')
  const reveal = make('div', 'reveal')
  reveal.setAttribute('aria-live', 'polite')
  reveal.append(body)
  const panel = make('div', 'panel-slot')
  const nav = make('div', 'nav')
  const backBtn = make('button', 'back', 'Back')
  backBtn.type = 'button'
  const nextBtn = make('button', 'next', 'Next')
  nextBtn.type = 'button'
  // Filled for a moment when Next is pressed while a checkpoint is still open. It stays in the tree (empty)
  // so the text change is announced; a region that appears with its text already in place is not.
  const hint = make('p', 'nav-hint')
  hint.setAttribute('role', 'status')
  nav.append(backBtn, hint, nextBtn)
  scroller.append(belt, kicker, prompt, reveal, panel)
  card.append(head, grab, scroller, nav)
  root.append(rail, card)

  // Sheet height. Tap the handle to toggle; drag it to choose. Pointer events stay on the handle, so
  // one-finger orbit on the canvas and scrolling in the body are untouched.
  let tall = false
  const setTall = (on: boolean) => {
    tall = on
    card.classList.toggle(`${p}-card-tall`, on)
    // The root class marks the tall sheet for anything outside the card (the rail, say) that wants to react.
    root.classList.toggle(`${p}-sheet-tall`, on)
    grab.setAttribute('aria-expanded', String(on))
    grab.setAttribute('aria-label', on ? 'Shrink the card' : 'Expand the card')
  }
  let drag: { id: number; startY: number; startH: number; moved: boolean } | null = null
  let swallowClick = false
  grab.addEventListener('pointerdown', e => {
    if (drag) return // a second finger does not restart the drag
    swallowClick = false
    drag = { id: e.pointerId, startY: e.clientY, startH: card.getBoundingClientRect().height, moved: false }
    grab.setPointerCapture(e.pointerId)
    card.classList.add(`${p}-card-dragging`)
  })
  grab.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return
    const dy = drag.startY - e.clientY // finger up = taller
    if (Math.abs(dy) > 6) drag.moved = true
    if (drag.moved) card.style.maxHeight = `${Math.max(120, drag.startH + dy)}px`
  })
  const endDrag = (e: PointerEvent, cancelled: boolean) => {
    if (!drag || e.pointerId !== drag.id) return
    const d = drag
    drag = null
    card.classList.remove(`${p}-card-dragging`)
    card.style.maxHeight = ''
    if (cancelled || !d.moved) return // a cancel decides nothing; a plain tap lets the click handler toggle
    // The click that follows a moved release (mouse, and some touch stacks) must not toggle as well. Touch
    // drags past the tap slop send no click at all, so the flag clears on the next task either way.
    swallowClick = true
    setTimeout(() => {
      swallowClick = false
    }, 0)
    const dy = d.startY - e.clientY
    if (Math.abs(dy) >= 40) setTall(dy > 0)
  }
  grab.addEventListener('pointerup', e => endDrag(e, false))
  grab.addEventListener('pointercancel', e => endDrag(e, true))
  grab.addEventListener('click', () => {
    if (swallowClick) {
      swallowClick = false
      return
    }
    setTall(!tall)
  })

  let current = -1
  let reachedIndex = -1
  let locked = false
  let tl: gsap.core.Timeline | null = null
  const snapshots: unknown[] = []

  // Text is written once per chapter (the live regions announce it once); nav state is painted separately,
  // so locking Next never re-announces the card.
  const paintText = (i: number) => {
    const c = beats[i]!.content
    setRichText(prompt, c.prompt ?? '')
    prompt.hidden = !c.prompt
    kickerLabel.textContent = c.label
    kickerTitle.textContent = c.title
    setRichText(body, c.body)
    anchor.textContent = c.anchor
    body.append(' ', anchor)
    ticks.forEach((t, k) => {
      t.disabled = k > reachedIndex
      t.classList.toggle(`${p}-tick-current`, k === i)
      t.classList.toggle(`${p}-tick-reached`, k <= reachedIndex)
      if (k === i) t.setAttribute('aria-current', 'step')
      else t.removeAttribute('aria-current')
    })
  }
  let hintTimer: ReturnType<typeof setTimeout> | null = null
  const paintNav = () => {
    backBtn.disabled = current === 0
    // A locked Next stays focusable and says why when pressed; only the last chapter really disables it.
    nextBtn.disabled = current === beats.length - 1
    nextBtn.setAttribute('aria-disabled', String(locked || nextBtn.disabled))
    nextBtn.classList.toggle(`${p}-next-locked`, locked)
    if (!locked && hintTimer !== null) {
      clearTimeout(hintTimer)
      hintTimer = null
      hint.textContent = ''
    }
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
    paintText(i)
    paintNav()
    // A new chapter always starts at the top of the card.
    scroller.scrollTop = 0

    // The prompt opens the card; the label, body and anchor follow. One orchestrated reveal per chapter.
    // Focus stays on whatever the student pressed; the live regions announce the new text.
    if (cut) {
      gsap.set([kicker, prompt, reveal], { opacity: 1, y: 0 })
      const t = gsap.timeline()
      beat.enter?.(t, true)
      t.kill()
      // A return restores the saved explore state AFTER enter has set the chapter's defaults.
      if (returning && beat.restore && snapshots[i] !== undefined) beat.restore(snapshots[i])
    } else {
      tl = gsap.timeline()
      tl.fromTo([kicker, prompt], { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0)
      tl.fromTo(reveal, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.35)
      beat.enter?.(tl, false)
    }
    opts.onChange?.(i, beat, returning ? 'return' : 'enter')
  }

  const next = () => {
    if (!locked) {
      goTo(current + 1)
      return
    }
    // Blocked: point at the open question instead of doing nothing. Earlier chapters' answered checkpoints
    // are still unhidden inside hidden panels, so pick the one that is actually laid out.
    const open = [...card.querySelectorAll<HTMLElement>(`.${p}-check:not([hidden])`)].find(el => el.offsetParent !== null)
    open?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' })
    hint.textContent = 'Answer the question first.'
    if (hintTimer !== null) clearTimeout(hintTimer)
    hintTimer = setTimeout(() => {
      hint.textContent = ''
      hintTimer = null
    }, 4000)
  }
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
      if (current >= 0) paintNav()
    },
    el: { rail, card, head, body: scroller, nav, beltSlot: belt, panelSlot: panel },
    setTall,
    destroy() {
      tl?.kill()
      if (hintTimer !== null) clearTimeout(hintTimer)
      root.classList.remove(`${p}-sheet-tall`)
      rail.remove()
      card.remove()
    },
  }
}
