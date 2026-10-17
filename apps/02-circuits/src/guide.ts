// Layer 3: the guided tour card. Runs the steps in tour.ts: sets up the board, asks for a prediction, waits for
// the student (or "Do it for me") to make the change, then shows what happened with the measured numbers.
// Motion carries every transition; with reduced motion the card only fades.

import katex from 'katex'
import { animate, stagger } from 'motion'
import { STEPS, CHAPTERS, type Action, type GuideState, type Setup, type ShotName, type Spot, type Step } from './tour'
import { reading } from './format'
import { linkRefs, cuesOf, onScreen, CONTROL_NAMES, type Stage } from './cues'
import { resolveFreeze, liftLine, type FreezePhase, type Resolved } from './freeze'
import { SLOT_IDS, type Part, type SlotId } from './board'

export type GuideApi = {
  state(): GuideState
  setup(s: Setup): void
  act(a: Action): void
  spot(s: Spot | null, acts?: readonly Action[]): void
  /** Turns the notebook's tour layout on or off. */
  touring(on: boolean): void
  /** A soft ring pulse on the step's slots when a task is done. */
  celebrate(): void
  /** Fly the camera to a named shot. */
  camera(shot: ShotName): void
  /** Where the step is: reading or predicting ('look'), asked to act ('act'), or past the action ('done'). */
  cue(stage: Stage): void
  /** A name in the card was touched: point at the thing it names. */
  poke(ref: string): void
  /** Act out the step's next action with a hand. */
  showMe(): void
  /** Freeze the board for a prediction ('predict'), let it go for the task ('act') or the answer ('done'); null lifts all. */
  freeze(r: Resolved | null, phase: FreezePhase | null): void
  /** Resolves once the parts the step's setup dropped in have landed. */
  settled(): Promise<void>
}

export type Guide = {
  el: HTMLElement
  startButton: HTMLButtonElement
  update(s: GuideState): void
  dispose(): void
}

type Phase = 'read' | 'predict' | 'task' | 'done'
const KEY = 'sim02-tour-step'
const store = {
  get(): number { try { const v = Number(localStorage.getItem(KEY)); return Number.isInteger(v) && v > 0 && v < STEPS.length ? v : 0 } catch { return 0 } },
  set(v: number) { try { localStorage.setItem(KEY, String(v)) } catch { /* private window: the tour still works, it just starts over */ } },
}

const tex = (src: string) => katex.renderToString(`\\displaystyle ${src}`, { throwOnError: false })

const ICON = {
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L3.6 15.5a1.5 1.5 0 0 1 2.3-1.9L8 16"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
}
const svg = (d: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`
/** The words of a bit of card HTML, for a screen reader sentence. */
const plain = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent ?? '').trim() }
const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`)

/** The board as a comparable string. */
const boardKey = (s: GuideState) => JSON.stringify([s.emf, s.r, s.batteryIn, SLOT_IDS.map(id => s.slots[id] ?? null)])
const samePart = (a?: Part, b?: Part) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** True when starting this step would change the board the student has now. */
export const setupChanges = (st: Step, s: GuideState): boolean => {
  const su = st.setup
  if (!su || (st.keepIf?.(s) ?? false)) return false
  if (su.emf !== s.emf || su.r !== s.r || (su.batteryIn ?? true) !== s.batteryIn) return true
  return SLOT_IDS.some(id => !samePart(su.slots[id], s.slots[id]))
}
/** The part a step expects in a slot: its own setup, else what an earlier step put there. */
export const expectedPart = (k: number, slot: SlotId): Part | null => {
  const own = STEPS[k]?.setup?.slots[slot]
  if (own) return own
  for (let j = k - 1; j >= 0; j--) {
    const placed = STEPS[j]!.task?.auto.find((a): a is Extract<Action, { place: SlotId }> => 'place' in a && a.place === slot)
    if (placed) return placed.part
    const p = STEPS[j]!.setup?.slots[slot]
    if (p) return p
  }
  return null
}

export function createGuide(api: GuideApi, reduce: () => boolean): Guide {
  const startButton = document.createElement('button')
  startButton.type = 'button'
  startButton.className = 'sim02-tour-start'

  const el = document.createElement('section')
  el.className = 'sim02-guide'
  el.setAttribute('aria-label', 'Guided tour')
  el.hidden = true
  el.innerHTML = `
    <header class="sim02-guide-top">
      <p class="sim02-guide-chapter"></p>
      <button type="button" class="sim02-guide-leave">Leave the tour</button>
    </header>
    <ol class="sim02-guide-map" aria-label="Parts of the tour">${CHAPTERS.map((c, k) => `<li><button type="button" data-chapter="${k}" aria-label="Part ${k + 1}: ${c}" title="${c}" tabindex="-1"><span></span></button></li>`).join('')}</ol>
    <div class="sim02-guide-body"></div>
    <p class="sim02-sr" role="status"></p>
    <footer class="sim02-guide-foot">
      <button type="button" class="sim02-guide-back">Back</button>
      <span class="sim02-guide-count"></span>
      <button type="button" class="sim02-guide-next"><span class="gn-go"></span><span class="gn-skip">Skip this step</span></button>
    </footer>`
  const chapterEl = el.querySelector<HTMLElement>('.sim02-guide-chapter')!
  const body = el.querySelector<HTMLElement>('.sim02-guide-body')!
  const back = el.querySelector<HTMLButtonElement>('.sim02-guide-back')!
  const next = el.querySelector<HTMLButtonElement>('.sim02-guide-next')!
  const goLabel = next.querySelector<HTMLElement>('.gn-go')!
  const count = el.querySelector<HTMLElement>('.sim02-guide-count')!
  const mapBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-chapter]')]
  const status = el.querySelector<HTMLElement>('[role="status"]')!
  const foot = el.querySelector<HTMLElement>('.sim02-guide-foot')!

  const running = new Set<{ stop(): void }>()
  const run = <T extends { stop(): void; then(f: () => void): unknown }>(a: T): T => { running.add(a); a.then(() => running.delete(a)); return a }
  const timers = new Set<number>()
  /** Bumped on every step change, start and leave: a timer from an older visit does nothing. */
  let gen = 0
  const later = (ms: number, fn: () => void) => {
    const mine = gen
    const t = window.setTimeout(() => { timers.delete(t); if (mine === gen) fn() }, ms)
    timers.add(t)
  }
  const clearTimers = () => { for (const t of timers) clearTimeout(t); timers.clear() }

  let on = false
  let idx = 0
  let phase: Phase = 'read'
  let pick = -1
  let before = NaN
  let after = NaN
  let doneAt: GuideState | null = null
  let autoBusy = false
  /** The step's prediction freeze, whether the board has settled (options take a pick), and a pick made before that. */
  let fz: Resolved | null = null
  let ready = true
  let queued = -1

  const step = (): Step => STEPS[idx]!
  /** The board as the page opened it or the tour left it; once the student touches the board, a change is theirs. */
  let leftKey = ''
  let touched = false
  let startLabel = ''
  const paintStart = () => {
    const resume = store.get()
    let resets = false
    try { const s = api.state(); resets = !!leftKey && boardKey(s) !== leftKey && setupChanges(STEPS[resume]!, s) } catch { /* board not built yet */ }
    const label = resets ? (resume ? 'Continue the tour (resets the board)' : 'Take the tour (resets the board)') : resume ? 'Continue the guided tour' : 'Take the guided tour'
    if (label === startLabel) return
    startLabel = label
    startButton.innerHTML = `${svg(ICON.spark)}<span>${label}</span>`
  }
  paintStart()
  const onTouch = (e: Event) => { if (!on && e.target instanceof Node && !el.contains(e.target) && !startButton.contains(e.target)) touched = true }
  for (const t of ['pointerdown', 'keydown', 'input'] as const) document.addEventListener(t, onTouch, { capture: true, passive: true })

  // ---------- keeping things in view ----------
  /** The scroll box the card sits in: the notebook on wide screens, the page on phones. */
  const scrollBox = (): HTMLElement | null => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowY
      if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
    }
    return null
  }
  /** The strip of the screen a reader can see: under the pinned board on phones, above the card's sticky footer. */
  const band = () => {
    const box = scrollBox()?.getBoundingClientRect()
    // the notebook's buttons carry the pinned board's height (plus a gap) as their scroll margin
    const pin = parseFloat(getComputedStyle(next).scrollMarginTop) || 0
    return {
      pin,
      top: Math.max(0, box?.top ?? 0) + pin,
      bottom: Math.min(innerHeight, box?.bottom ?? innerHeight) - foot.offsetHeight,
    }
  }
  /** Scroll a part of the card into the visible strip, unless it is already there. `over`: px that stick out above
   *  it (the reveal's stamp). */
  const bring = (t: HTMLElement | null, block: 'nearest' | 'start', over = 0) => {
    if (!t || !t.getClientRects().length) return
    const b = band()
    const r = t.getBoundingClientRect()
    if (r.top - over >= b.top && r.bottom <= b.bottom) return
    t.style.scrollMarginTop = `${b.pin + over}px`
    t.style.scrollMarginBottom = `${foot.offsetHeight + 12}px`
    t.scrollIntoView({ block, behavior: reduce() ? 'auto' : 'smooth' })
  }
  // Tab onto an answer or a button in the card: the card's sticky footer (Back, Step n of 29, Skip) must not cover it
  el.addEventListener('focusin', e => {
    if (phase === 'task') paintGoto()
    const t = e.target
    if (!(t instanceof HTMLElement) || t.tabIndex < 0 || foot.contains(t) || !t.matches(':focus-visible')) return
    bring(t, 'nearest')
  })
  // the keyboard's "Go to ..." goes away once focus leaves the card (checked a frame later, after focus lands)
  el.addEventListener('focusout', () => { if (phase === 'task') requestAnimationFrame(() => { if (phase === 'task') paintGoto() }) })
  /** Focus without scrolling (the card scrolls on its own terms) and without a ring on text. */
  const focusQuiet = (t: HTMLElement | null) => { if (t && !t.closest('[hidden]')) t.focus({ preventScroll: true }) }

  /** One sentence for screen readers: cleared first, so the same words read again on a new step. */
  const announce = (text: string) => {
    status.textContent = ''
    if (text) later(80, () => { status.textContent = text })
  }

  /** "Scroll to the r slider": shown in Try it while the control to use is off screen. */
  const paintGoto = () => {
    const g = body.querySelector<HTMLButtonElement>('.sim02-guide-goto')
    if (!g) return
    const cues = phase === 'task' ? cuesOf(el.closest('.sim02')) : null
    const tgt = cues?.doTarget() ?? null
    const far = !!tgt && !onScreen(tgt.el)
    // a keyboard in the card gets a shortcut to the thing to use, even when it is on screen (it can be 20 Tabs away)
    const a = document.activeElement
    const key = !far && a instanceof HTMLElement && el.contains(a) && a.matches(':focus-visible') ? cues?.doKey() ?? null : null
    const show = far || !!key
    let html = ''
    if (far && tgt) {
      const above = tgt.el.getBoundingClientRect().bottom < band().top
      g.dataset.control = tgt.control
      html = `${above ? '↑' : '↓'} Scroll to ${CONTROL_NAMES[tgt.control]}`
    } else if (key) {
      delete g.dataset.control
      html = `Go to ${key.name}`
    }
    if (show && g.innerHTML !== html) g.innerHTML = html
    if (g.hidden === show) g.hidden = !show
  }
  let gotoFrame = 0
  /** Scroll the control to use clear of the pinned board, as "Scroll to ..." does. */
  const scrollToTarget = (t: HTMLElement) => {
    t.style.scrollMarginTop = `${band().pin}px`
    t.style.scrollMarginBottom = '12px'
    t.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' })
  }
  /** Show me: a control off screen (5×, the r slider, battery out) scrolls into view first, and the hand plays once
   *  the control has landed and the scroll has stopped. */
  let showFrame = 0
  const showMe = () => {
    cancelAnimationFrame(showFrame)
    const tgt = phase === 'task' ? cuesOf(el.closest('.sim02'))?.doTarget() ?? null : null
    if (!tgt || onScreen(tgt.el)) { api.showMe(); return }
    scrollToTarget(tgt.el)
    const mine = gen, t0 = performance.now()
    let last = NaN, still = 0
    const wait = () => {
      showFrame = 0
      if (mine !== gen || !on || phase !== 'task') return
      const y = tgt.el.getBoundingClientRect().top
      still = Math.abs(y - last) < 0.5 ? still + 1 : 0
      last = y
      if ((still >= 3 && onScreen(tgt.el)) || performance.now() - t0 > 2500) { api.showMe(); return }
      showFrame = requestAnimationFrame(wait)
    }
    showFrame = requestAnimationFrame(wait)
  }
  const onScroll = () => { if (!on || phase !== 'task' || gotoFrame) return; gotoFrame = requestAnimationFrame(() => { gotoFrame = 0; paintGoto() }) }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })

  // ---------- rendering ----------
  const eqHtml = (st: Step, s: GuideState) => (st.eqs ?? [])
    .map(e => `<figure class="sim02-guide-eq"><div>${tex(typeof e.tex === 'string' ? e.tex : e.tex(s))}</div></figure>`).join('')

  const predictHtml = (st: Step) => !st.predict ? '' : `
    <div class="sim02-guide-q">
      <p class="sim02-guide-qtext"><span class="sim02-guide-badge">Predict</span>${st.predict.q}</p>
      <p class="sim02-sr" id="sim02-guide-paused">The board is paused until you pick.</p>
      <div class="sim02-guide-opts" role="group" aria-label="Your prediction">
        ${st.predict.options.map((o, k) => `<button type="button" class="sim02-guide-opt" data-opt="${k}" aria-pressed="false" aria-describedby="sim02-guide-paused"${ready ? '' : ' aria-disabled="true"'}><span>${o}</span></button>`).join('')}
      </div>
    </div>`

  const taskWords = (st: Step, s = api.state()) => st.task?.now?.(s) ?? st.task?.text ?? ''
  const taskText = (st: Step, text: string) => `<span class="sim02-guide-badge">Try it</span>${linkRefs(text, st.spot ?? null, st.task?.auto ?? [])}`
  const taskHtml = (st: Step) => !st.task ? '' : `
    <div class="sim02-guide-task" data-state="waiting" ${st.predict ? 'hidden' : ''}>
      <span class="sim02-guide-taskicon">${svg(ICON.hand)}</span>
      <p class="sim02-guide-tasktext" tabindex="-1" style="outline: none">${taskText(st, taskWords(st))}</p>
      ${st.task.progress ? '<div class="sim02-guide-bar" aria-hidden="true"><i></i></div>' : ''}
      <div class="sim02-guide-taskbtns"><button type="button" class="sim02-guide-showme">Show me</button><button type="button" class="sim02-guide-auto" data-auto>Do it for me</button><button type="button" class="sim02-guide-auto sim02-guide-goto" hidden></button></div>
    </div>`

  const render = () => {
    const st = step()
    const s = api.state()
    // "Part", not "Chapter": the book citations on the card are the book's chapters
    chapterEl.textContent = idx === STEPS.length - 1 ? 'Summary' : `Part ${st.chapter + 1}: ${CHAPTERS[st.chapter]}`
    count.textContent = `Step ${idx + 1} of ${STEPS.length}`
    mapBtns.forEach((b, k) => {
      b.classList.toggle('is-here', k === st.chapter)
      b.classList.toggle('is-past', k < st.chapter)
      // one tab stop for the whole map, on the chapter you are in; arrow keys move between chapters
      b.tabIndex = k === st.chapter ? 0 : -1
      if (k === st.chapter) b.setAttribute('aria-current', 'step')
      else b.removeAttribute('aria-current')
    })
    back.disabled = idx === 0
    body.innerHTML = `
      <h2 class="sim02-guide-title" tabindex="-1" style="outline: none">${st.title}</h2>
      <div class="sim02-guide-text">${st.body(s)}</div>
      ${eqHtml(st, s)}
      ${predictHtml(st)}
      ${taskHtml(st)}
      <div class="sim02-guide-reveal" hidden></div>`
    body.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach(b => b.addEventListener('click', () => choose(Number(b.dataset.opt))))
    body.querySelector<HTMLButtonElement>('[data-auto]')?.addEventListener('click', doForMe)
    body.querySelector<HTMLButtonElement>('.sim02-guide-goto')?.addEventListener('click', () => {
      const cues = cuesOf(el.closest('.sim02'))
      const tgt = cues?.doTarget()
      if (!tgt || onScreen(tgt.el)) {
        // on screen: the keyboard jumps straight to the chip, the slot, the dial button or the control
        const k = cues?.doKey()
        const f = k && (k.el.matches('input, button') ? k.el : k.el.querySelector<HTMLElement>('input, button'))
        f?.focus({ preventScroll: true })
        return
      }
      scrollToTarget(tgt.el)
      // the keyboard lands on the control too: the slider's input, or the button itself
      const f = tgt.el.matches('input, button') ? tgt.el : tgt.el.querySelector<HTMLElement>('input, button')
      f?.focus({ preventScroll: true })
    })
    body.querySelector<HTMLButtonElement>('.sim02-guide-showme')?.addEventListener('click', showMe)
    // a name in the task text points at its part: on hover with a mouse, on touch with a finger
    wireRefs(body)
    paintNext()
  }

  const wireRefs = (root: HTMLElement) => root.querySelectorAll<HTMLElement>('.sim02-guide-ref').forEach(ref => {
    let last = 0
    const poke = () => { const now = performance.now(); if (now - last > 700) { last = now; api.poke(ref.dataset.ref!) } }
    ref.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') poke() })
    ref.addEventListener('pointerdown', poke)
  })

  const paintNext = () => {
    const last = idx === STEPS.length - 1
    const ready = phase === 'done'
    // the hidden label still holds the width, and visibility: hidden keeps it out of the button's name
    goLabel.textContent = last ? 'Explore on my own' : 'Next'
    next.classList.toggle('is-ready', ready || last)
  }

  /** The card grows or shrinks to the new step's height instead of jumping (the footer then moves smoothly). */
  let heightTween: { stop(): void } | null = null
  const tweenHeight = (h0: number) => {
    heightTween?.stop()
    heightTween = null
    el.style.height = ''
    el.style.overflow = ''
    const h1 = el.offsetHeight
    if (reduce() || h0 <= 0 || Math.abs(h1 - h0) < 2) return
    el.style.overflow = 'clip'
    const a = run(animate(el, { height: [`${h0}px`, `${h1}px`] }, { duration: 0.3, ease: [0.22, 1, 0.36, 1] }))
    heightTween = a
    a.then(() => { if (heightTween === a) { heightTween = null; el.style.height = ''; el.style.overflow = '' } })
  }

  /** Children of the body enter one after another, rising softly into place. */
  const enterBody = (dir: number) => {
    const kids = [...body.children] as HTMLElement[]
    if (reduce()) { run(animate(body, { opacity: [0, 1] }, { duration: 0.18 })); return }
    run(animate(body, { opacity: [0, 1], x: [dir * 18, 0] }, { type: 'spring', stiffness: 320, damping: 30 }))
    run(animate(kids, { opacity: [0, 1], y: [10, 0] }, { delay: stagger(0.055, { startDelay: 0.04 }), type: 'spring', stiffness: 380, damping: 26 }))
  }

  // ---------- flow ----------
  const go = (k: number, dir = 1) => {
    gen++
    clearTimers()
    // the setup below commits to the board, which calls update(): no stale phase may act on the new step
    phase = 'read'
    idx = Math.max(0, Math.min(STEPS.length - 1, k))
    store.set(idx)
    const st = step()
    pick = -1
    after = NaN
    doneAt = null
    autoBusy = false
    queued = -1
    announce('')
    // the freeze goes up before the setup lands, so the landing itself paints frozen
    fz = resolveFreeze(st)
    api.freeze(fz, fz ? 'predict' : null)
    if (st.setup && !(st.keepIf?.(api.state()) ?? false)) api.setup(st.setup)
    api.spot(st.spot ?? null, st.task?.auto ?? [])
    api.camera(st.cam ?? 'overview')
    const s = api.state()
    before = st.measure ? st.measure(s) : NaN
    phase = st.predict ? 'predict' : st.task ? 'task' : 'done'
    const visit = gen
    // the options take a pick once the parts have landed; "before" is read from that settled, frozen board
    ready = !st.predict
    if (st.predict) api.settled().then(() => {
      if (visit !== gen) return
      ready = true
      if (phase === 'predict') before = st.measure ? st.measure(api.state()) : NaN
      body.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach(b => b.removeAttribute('aria-disabled'))
      if (queued >= 0 && phase === 'predict') choose(queued)
    })
    const swap = () => {
      if (visit !== gen) return
      body.inert = false
      const h0 = el.offsetHeight
      render()
      tweenHeight(h0)
      enterBody(dir)
      api.cue('look')
      if (phase === 'task') api.cue('act')
      else if (phase === 'done') api.cue('done')
      if (phase === 'done') showReveal(s, false)
      else if (phase === 'task') checkTask(api.state())
      // the step opens at its title: on a phone the card's top sits under the pinned board otherwise
      const b = band(), top = el.getBoundingClientRect().top
      if (top < b.top - 1 || top > b.top + 120) el.scrollIntoView({ block: 'start', behavior: reduce() ? 'auto' : 'smooth' })
      focusQuiet(body.querySelector<HTMLElement>('.sim02-guide-title'))
      if (phase === 'task') { paintGoto(); later(500, paintGoto) }
    }
    if (!body.childElementCount || reduce()) swap()
    else {
      // the outgoing card takes no clicks while the outgoing card fades
      body.inert = true
      run(animate(body, { opacity: 0, x: -dir * 14 }, { duration: 0.14, ease: 'easeIn' })).then(swap)
    }
  }

  const choose = (k: number) => {
    if (phase !== 'predict') return
    // a pick while the parts are still landing waits for them, then counts
    if (!ready) { queued = k; return }
    pick = k
    const opts = [...body.querySelectorAll<HTMLButtonElement>('[data-opt]')]
    const st0 = step()
    const t0 = body.querySelector<HTMLElement>('.sim02-guide-task')
    // the keyboard moves on before the options switch off, so focus never drops to the page
    if (st0.task && t0) { t0.hidden = false; focusQuiet(t0.querySelector<HTMLElement>('.sim02-guide-tasktext')) }
    else focusQuiet(next)
    opts.forEach((b, i) => {
      b.setAttribute('aria-pressed', String(i === k))
      b.classList.toggle('is-picked', i === k)
      b.classList.toggle('is-other', i !== k)
      b.disabled = true
    })
    if (!reduce()) run(animate(opts[k]!, { scale: [1, 0.93, 1.04, 1] }, { duration: 0.5, ease: 'easeOut' }))
    const st = step()
    const t = body.querySelector<HTMLElement>('.sim02-guide-task')
    if (st.task && t) {
      phase = 'task'
      api.freeze(fz, 'act')
      if (st.camAct) api.camera(st.camAct)
      t.hidden = false
      api.cue('act')
      if (!reduce()) run(animate(t, { opacity: [0, 1], y: [12, 0], scale: [0.97, 1] }, { type: 'spring', stiffness: 300, damping: 22, delay: 0.12 }))
      paintGoto()
      bring(t, 'nearest')
      later(500, paintGoto)
      checkTask(api.state())
    } else {
      phase = 'done'
      api.freeze(fz, 'done')
      api.cue('done')
      showReveal(api.state(), true)
    }
  }

  const checkTask = (s: GuideState) => {
    const st = step()
    if (phase !== 'task' || !st.task) return
    const bar = body.querySelector<HTMLElement>('.sim02-guide-bar i')
    if (bar && st.task.progress) bar.style.width = `${Math.round(st.task.progress(s) * 100)}%`
    const t = body.querySelector<HTMLElement>('.sim02-guide-task')
    // a part moved to a slot the task also has to clear: the words name that slot now
    const tx = t?.querySelector<HTMLElement>('.sim02-guide-tasktext')
    if (tx && st.task.now) {
      const words = taskWords(st, s)
      if (tx.textContent !== `Try it${words}`) { tx.innerHTML = taskText(st, words); wireRefs(tx) }
    }
    if (!t || !st.task.done(s)) return
    phase = 'done'
    // the answer is out: covers lift, and a filled capacitor lands on its end before anything is measured
    if (fz) { api.freeze(fz, 'done'); s = api.state() }
    after = st.measure ? st.measure(s) : NaN
    api.cue('done')
    t.dataset.state = 'done'
    t.querySelector('.sim02-guide-taskicon')!.innerHTML = svg(ICON.check)
    // focus in the card (on "Do it for me", say) goes to Next before the task's buttons go. A keyboard that just did
    // the task on the board (a chip, a slot, a dial button) goes to Next too, so the reveal is one Tab-free Enter
    // away; a slider or a number field keeps focus, since the student may still be pressing arrows there
    const a = document.activeElement
    const kbd = a instanceof HTMLElement && a.matches(':focus-visible') && !(a instanceof HTMLInputElement) && a.getAttribute('role') !== 'spinbutton' && !!a.closest('.sim02')
    if (!a || a === document.body || el.contains(a) || kbd) focusQuiet(next)
    t.querySelector<HTMLElement>('.sim02-guide-taskbtns')!.hidden = true
    if (!reduce()) run(animate(t.querySelector('.sim02-guide-taskicon')!, { scale: [0.4, 1.25, 1], rotate: [-20, 8, 0] }, { type: 'spring', stiffness: 420, damping: 14 }))
    api.celebrate()
    // let the board settle (parts land, numbers count) before the explanation slides in; the explanation uses the
    // board as it was when the task was done, so a scrub or a loop in those 520 ms cannot change the numbers
    later(reduce() ? 0 : 520, () => showReveal(s, true))
  }

  const showReveal = (s: GuideState, animateIn: boolean) => {
    const st = step()
    // a slider step reads the board as it is now: the slider may have kept moving during the 520 ms
    if (st.liveReveal) { const now = api.state(); if (st.task?.done(now) ?? true) s = now }
    doneAt = s
    const box = body.querySelector<HTMLElement>('.sim02-guide-reveal')
    if (!box) return
    if (st.camAfter) api.camera(st.camAfter)
    let stamp = ''
    let answerLine = ''
    const said: string[] = []
    if (st.predict) {
      const right = st.predict.answer({ s, before, after, pick })
      const ok = pick === right
      stamp = `<p class="sim02-guide-stamp ${ok ? 'is-right' : 'is-off'}">${svg(ok ? ICON.check : ICON.eye)}<span>${ok ? 'Your prediction was right' : 'Different from your prediction'}</span></p>`
      // the right option is also marked in the list; say it in words too, so color is never the only cue
      if (!ok) answerLine = `<p class="sim02-guide-answer">The answer: <b>${st.predict.options[right]}</b></p>`
      said.push(ok ? 'Your prediction was right.' : 'Different from your prediction.')
      if (!ok) said.push(sentence(`The answer: ${plain(st.predict.options[right] ?? '')}`))
      body.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b, i) => b.classList.toggle('is-answer', i === right))
    }
    const ro = st.readout && Number.isFinite(before) && Number.isFinite(after) ? st.readout : null
    const change = !ro ? '' : reading(before, ro.unit) === reading(after, ro.unit)
      ? `${ro.label} stayed at ${reading(after, ro.unit)}.`
      : `${ro.label} went from ${reading(before, ro.unit)} to ${reading(after, ro.unit)}.`
    if (change) said.push(change)
    // the tiles count up on screen; a screen reader gets the change as one sentence instead
    const readout = !ro ? '' : `
      <div class="sim02-guide-readout" data-kind="${ro.kind}">
        <p class="sim02-sr">${change}</p>
        <p class="sim02-guide-ro-label" aria-hidden="true">${ro.label}</p>
        <div class="sim02-guide-ro-row" aria-hidden="true">
          <span class="sim02-guide-ro-tile"><small>Before</small><b>${reading(before, ro.unit)}</b></span>
          <span class="sim02-guide-ro-arrow" aria-hidden="true">${svg('<path d="M4 12h15M14 6l6 6-6 6"/>')}</span>
          <span class="sim02-guide-ro-tile is-after"><small>After</small><b class="sim02-guide-ro-now">${reading(after, ro.unit)}</b></span>
        </div>
      </div>`
    const html = st.reveal ? st.reveal({ s, before, after, pick }) : ''
    if (!stamp && !html) { paintNext(); return }
    // for screen readers: the covered numbers that just came back
    const lift = liftLine(fz, s, reading)
    if (lift) said.push(lift)
    const eqsAfter = st.eqsAfter?.length ? eqHtml({ ...st, eqs: st.eqsAfter }, s) : ''
    box.innerHTML = stamp + readout + answerLine + `<div class="sim02-guide-why">${html}</div>` + eqsAfter
    box.hidden = false
    paintNext()
    if (animateIn) {
      announce(said.join(' '))
      // the answer lands in view (taller than the screen: its top does), and the sticky footer keeps Next in reach
      const b = band(), r = box.getBoundingClientRect()
      // the stamp sits on the box's top edge; offsetTop leaves out its pop-in scale and the box's rise
      const stampEl = box.querySelector<HTMLElement>('.sim02-guide-stamp')
      const over = stampEl ? Math.max(0, -stampEl.offsetTop) + 6 : 0
      bring(box, r.height + over > b.bottom - b.top ? 'start' : 'nearest', over)
    }
    if (animateIn && !reduce()) {
      run(animate(box, { opacity: [0, 1], y: [16, 0], scale: [0.96, 1] }, { type: 'spring', stiffness: 260, damping: 22 }))
      const stampEl = box.querySelector<HTMLElement>('.sim02-guide-stamp')
      if (stampEl) run(animate(stampEl, { scale: [1.6, 0.92, 1], opacity: [0, 1], rotate: [-12, 4, 3] }, { duration: 0.5, delay: 0.18, ease: 'easeOut' }))
      // the after number counts from the before number, the same way the HUD tiles count
      const now = box.querySelector<HTMLElement>('.sim02-guide-ro-now')
      if (now && ro) run(animate(before, after, { duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1], onUpdate: x => { now.textContent = reading(x, ro.unit) }, onComplete: () => { now.textContent = reading(after, ro.unit) } }))
      run(animate(next, { scale: [1, 1.1, 0.97, 1], rotate: [0, -3, 2, 0] }, { duration: 0.6, delay: 0.35, ease: 'easeOut' }))
    }
  }

  /** A live-reveal step: the answer's text and its After number follow the board, without a new stamp or count-up. */
  const followReveal = (s: GuideState) => {
    const st = step()
    const box = body.querySelector<HTMLElement>('.sim02-guide-reveal')
    if (!st.liveReveal || !doneAt || !box || box.hidden || !(st.task?.done(s) ?? true)) return
    doneAt = s
    after = st.measure ? st.measure(s) : after
    const why = box.querySelector<HTMLElement>('.sim02-guide-why')
    const html = st.reveal ? st.reveal({ s, before, after, pick }) : ''
    if (why && why.innerHTML !== html) why.innerHTML = html
    const now = box.querySelector<HTMLElement>('.sim02-guide-ro-now')
    if (now && st.readout) now.textContent = reading(after, st.readout.unit)
  }

  const doForMe = () => {
    const st = step()
    if (!st.task || autoBusy) return
    autoBusy = true
    // a dial, a tap or a fill needs its part on the board: put the step's part back first if the student took it off
    const s = api.state()
    const su = st.setup
    const capSlot = SLOT_IDS.find(id => expectedPart(idx, id)?.kind === 'capacitor') ?? null
    const acts: Action[] = []
    let reset = false
    for (const a of st.task.auto) {
      // a fill needs the step's whole loop, not only the capacitor: with R₁ gone (or the battery out) the clock has no
      // loop to run, so a part missing from the step's board (or the battery) puts the step's board back first
      if ('fill' in a && su && ((su.batteryIn ?? true) !== s.batteryIn || SLOT_IDS.some(id => {
        const want = su.slots[id], have = s.slots[id]
        return want ? have?.kind !== want.kind : !!have
      }))) { reset = true; acts.length = 0; acts.push(a); continue }
      const slot = 'dial' in a ? a.dial : 'select' in a ? a.select : 'fill' in a ? capSlot : null
      const want = slot ? expectedPart(idx, slot) : null
      if (slot && want && s.slots[slot]?.kind !== want.kind) {
        // a capacitor that starts charged can't come back from the tray (a new one is empty): the step's own
        // board goes back instead, charge and all, so the reveal compares the charge the prediction was about
        if (want.kind === 'capacitor' && su?.slots[slot] && (su.capV ?? 0) !== 0) reset = true
        else acts.push({ place: slot, part: { ...want } })
      }
      acts.push(a)
    }
    const visit = gen
    const runActs = () => {
      if (visit !== gen) return
      // one action at a time, so each part visibly drops in before the next
      acts.forEach((a, k) => later(k * 260, () => api.act(a)))
      // the button works again once the run is over (the student may undo it, or the run may not finish the task)
      later(acts.length * 260 + 300, () => { autoBusy = false })
    }
    if (reset && su) { api.setup(su); api.settled().then(runActs) }
    else runActs()
  }

  // ---------- controls ----------
  const start = () => {
    gen++
    clearTimers()
    on = true
    el.hidden = false
    startButton.hidden = true
    api.touring(true)
    if (!reduce()) run(animate(el, { opacity: [0, 1], y: [24, 0], scale: [0.97, 1] }, { type: 'spring', stiffness: 260, damping: 24 }))
    body.innerHTML = ''
    go(store.get(), 1)
  }
  const leave = () => {
    gen++
    clearTimers()
    phase = 'read'
    on = false
    api.spot(null)
    api.camera('overview')
    api.touring(false)
    fz = null
    api.freeze(null, null)
    announce('')
    // the board the tour leaves is not one the student built
    try { leftKey = boardKey(api.state()) } catch { leftKey = '' }
    touched = false
    paintStart()
    const done = () => {
      el.hidden = true
      startButton.hidden = false
      focusQuiet(startButton)
      if (!reduce()) run(animate(startButton, { scale: [0.9, 1] }, { type: 'spring', stiffness: 400, damping: 18 }))
    }
    if (reduce()) done()
    else run(animate(el, { opacity: 0, y: 16 }, { duration: 0.2 })).then(done)
  }
  const onNext = () => {
    if (idx === STEPS.length - 1) { store.set(0); leave(); return }
    go(idx + 1, 1)
  }
  startButton.addEventListener('click', start)
  el.querySelector('.sim02-guide-leave')!.addEventListener('click', leave)
  back.addEventListener('click', () => go(idx - 1, -1))
  next.addEventListener('click', onNext)
  mapBtns.forEach(b => b.addEventListener('click', () => {
    const c = Number(b.dataset.chapter)
    const k = STEPS.findIndex(s => s.chapter === c)
    if (k >= 0 && k !== idx) go(k, k > idx ? 1 : -1)
  }))
  el.querySelector('.sim02-guide-map')!.addEventListener('keydown', e => {
    const ke = e as KeyboardEvent
    const at = mapBtns.indexOf(document.activeElement as HTMLButtonElement)
    if (at < 0) return
    const n = mapBtns.length
    const to = ke.key === 'ArrowRight' || ke.key === 'ArrowDown' ? (at + 1) % n
      : ke.key === 'ArrowLeft' || ke.key === 'ArrowUp' ? (at - 1 + n) % n
      : ke.key === 'Home' ? 0 : ke.key === 'End' ? n - 1 : -1
    if (to < 0) return
    ke.preventDefault()
    mapBtns.forEach((b, k) => { b.tabIndex = k === to ? 0 : -1 })
    mapBtns[to]!.focus()
  })

  return {
    el,
    startButton,
    update(s) {
      if (!on) {
        // a board change before the student touched anything (the parts dropping in on load) is not theirs
        if (!touched) leftKey = boardKey(s)
        paintStart()
        return
      }
      if (phase === 'task') { checkTask(s); if (phase === 'task') paintGoto() }
      else if (phase === 'done') followReveal(s)
    },
    dispose() {
      for (const a of running) a.stop()
      for (const t of timers) clearTimeout(t)
      cancelAnimationFrame(gotoFrame)
      cancelAnimationFrame(showFrame)
      for (const t of ['pointerdown', 'keydown', 'input'] as const) document.removeEventListener(t, onTouch, { capture: true })
      document.removeEventListener('scroll', onScroll, { capture: true })
      el.remove()
      startButton.remove()
    },
  }
}
