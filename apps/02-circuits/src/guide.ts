// Layer 3: the guided tour card. Runs the steps in tour.ts: sets up the board, asks for a prediction, waits for
// the student (or "Do it for me") to make the change, then shows what happened with the measured numbers.
// Motion carries every transition; with reduced motion the card only fades.

import katex from 'katex'
import { animate, stagger } from 'motion'
import { STEPS, CHAPTERS, type Action, type GuideState, type Setup, type Spot, type Step } from './tour'

export type GuideApi = {
  state(): GuideState
  setup(s: Setup): void
  act(a: Action): void
  spot(s: Spot | null): void
  /** Turns the notebook's tour layout on or off. */
  touring(on: boolean): void
  /** A soft ring pulse on the step's slots when a task is done. */
  celebrate(): void
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
    <ol class="sim02-guide-map" aria-label="Chapters">${CHAPTERS.map((c, k) => `<li><button type="button" data-chapter="${k}" aria-label="Chapter ${k + 1}: ${c}"><span></span></button></li>`).join('')}</ol>
    <div class="sim02-guide-body"></div>
    <footer class="sim02-guide-foot">
      <button type="button" class="sim02-guide-back">Back</button>
      <span class="sim02-guide-count"></span>
      <button type="button" class="sim02-guide-next"></button>
    </footer>`
  const chapterEl = el.querySelector<HTMLElement>('.sim02-guide-chapter')!
  const body = el.querySelector<HTMLElement>('.sim02-guide-body')!
  const back = el.querySelector<HTMLButtonElement>('.sim02-guide-back')!
  const next = el.querySelector<HTMLButtonElement>('.sim02-guide-next')!
  const count = el.querySelector<HTMLElement>('.sim02-guide-count')!
  const mapBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-chapter]')]

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

  const step = (): Step => STEPS[idx]!
  const paintStart = () => {
    const resume = store.get()
    startButton.innerHTML = `${svg(ICON.spark)}<span>${resume ? 'Continue the guided tour' : 'Take the guided tour'}</span>`
  }
  paintStart()

  // ---------- rendering ----------
  const eqHtml = (st: Step, s: GuideState) => (st.eqs ?? [])
    .map(e => `<figure class="sim02-guide-eq"><div>${tex(typeof e.tex === 'string' ? e.tex : e.tex(s))}</div><figcaption>${e.ref}</figcaption></figure>`).join('')

  const predictHtml = (st: Step) => !st.predict ? '' : `
    <div class="sim02-guide-q">
      <p class="sim02-guide-qtext"><span class="sim02-guide-badge">Predict</span>${st.predict.q}</p>
      <div class="sim02-guide-opts" role="group" aria-label="Your prediction">
        ${st.predict.options.map((o, k) => `<button type="button" class="sim02-guide-opt" data-opt="${k}" aria-pressed="false">${o}</button>`).join('')}
      </div>
    </div>`

  const taskHtml = (st: Step) => !st.task ? '' : `
    <div class="sim02-guide-task" data-state="waiting" ${st.predict ? 'hidden' : ''}>
      <span class="sim02-guide-taskicon">${svg(ICON.hand)}</span>
      <p><span class="sim02-guide-badge">Try it</span>${st.task.text}</p>
      ${st.task.progress ? '<div class="sim02-guide-bar" aria-hidden="true"><i></i></div>' : ''}
      <button type="button" class="sim02-guide-auto">Do it for me</button>
    </div>`

  const render = () => {
    const st = step()
    const s = api.state()
    chapterEl.textContent = `Chapter ${st.chapter + 1}: ${CHAPTERS[st.chapter]}`
    count.textContent = `Step ${idx + 1} of ${STEPS.length}`
    mapBtns.forEach((b, k) => {
      b.classList.toggle('is-here', k === st.chapter)
      b.classList.toggle('is-past', k < st.chapter)
      if (k === st.chapter) b.setAttribute('aria-current', 'step')
      else b.removeAttribute('aria-current')
    })
    back.disabled = idx === 0
    body.innerHTML = `
      <h2 class="sim02-guide-title">${st.title}</h2>
      <div class="sim02-guide-text">${st.body(s)}</div>
      ${eqHtml(st, s)}
      ${predictHtml(st)}
      ${taskHtml(st)}
      <div class="sim02-guide-reveal" hidden aria-live="polite"></div>`
    body.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach(b => b.addEventListener('click', () => choose(Number(b.dataset.opt))))
    body.querySelector<HTMLButtonElement>('.sim02-guide-auto')?.addEventListener('click', doForMe)
    paintNext()
  }

  const paintNext = () => {
    const last = idx === STEPS.length - 1
    const ready = phase === 'done'
    next.textContent = last ? 'Explore on my own' : ready ? 'Next' : 'Skip this step'
    next.classList.toggle('is-ready', ready || last)
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
    if (st.setup && !(st.keepIf?.(api.state()) ?? false)) api.setup(st.setup)
    api.spot(st.spot ?? null)
    const s = api.state()
    before = st.measure ? st.measure(s) : NaN
    phase = st.predict ? 'predict' : st.task ? 'task' : 'done'
    const visit = gen
    const swap = () => {
      if (visit !== gen) return
      body.inert = false
      render()
      enterBody(dir)
      if (phase === 'done') showReveal(s, false)
      else if (phase === 'task') checkTask(api.state())
      // keep the card in view: on a phone the card sits under the pinned board
      el.scrollIntoView({ block: 'nearest', behavior: reduce() ? 'auto' : 'smooth' })
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
    pick = k
    const opts = [...body.querySelectorAll<HTMLButtonElement>('[data-opt]')]
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
      t.hidden = false
      if (!reduce()) run(animate(t, { opacity: [0, 1], y: [12, 0], scale: [0.97, 1] }, { type: 'spring', stiffness: 300, damping: 22, delay: 0.12 }))
      checkTask(api.state())
    } else {
      phase = 'done'
      showReveal(api.state(), true)
    }
  }

  const checkTask = (s: GuideState) => {
    const st = step()
    if (phase !== 'task' || !st.task) return
    const bar = body.querySelector<HTMLElement>('.sim02-guide-bar i')
    if (bar && st.task.progress) bar.style.width = `${Math.round(st.task.progress(s) * 100)}%`
    const t = body.querySelector<HTMLElement>('.sim02-guide-task')
    if (!t || !st.task.done(s)) return
    phase = 'done'
    after = st.measure ? st.measure(s) : NaN
    t.dataset.state = 'done'
    t.querySelector('.sim02-guide-taskicon')!.innerHTML = svg(ICON.check)
    t.querySelector<HTMLButtonElement>('.sim02-guide-auto')!.hidden = true
    if (!reduce()) run(animate(t.querySelector('.sim02-guide-taskicon')!, { scale: [0.4, 1.25, 1], rotate: [-20, 8, 0] }, { type: 'spring', stiffness: 420, damping: 14 }))
    api.celebrate()
    // let the board settle (parts land, numbers count) before the explanation slides in
    later(reduce() ? 0 : 520, () => showReveal(api.state(), true))
  }

  const showReveal = (s: GuideState, animateIn: boolean) => {
    const st = step()
    doneAt = s
    const box = body.querySelector<HTMLElement>('.sim02-guide-reveal')
    if (!box) return
    let verdict = ''
    if (st.predict) {
      const right = st.predict.answer({ s, before, after, pick })
      const ok = pick === right
      verdict = `<p class="sim02-guide-verdict ${ok ? 'is-right' : 'is-off'}">${svg(ok ? ICON.check : ICON.eye)}<span>${ok ? 'Your prediction was right.' : `Your prediction was different. The answer: ${st.predict.options[right]}.`}</span></p>`
      body.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b, i) => b.classList.toggle('is-answer', i === right))
    }
    const html = st.reveal ? st.reveal({ s, before, after, pick }) : ''
    if (!verdict && !html) { paintNext(); return }
    box.innerHTML = verdict + html
    box.hidden = false
    paintNext()
    if (animateIn && !reduce()) {
      run(animate(box, { opacity: [0, 1], y: [14, 0], scale: [0.97, 1] }, { type: 'spring', stiffness: 260, damping: 22 }))
      run(animate(next, { scale: [1, 1.1, 0.97, 1], rotate: [0, -3, 2, 0] }, { duration: 0.6, delay: 0.25, ease: 'easeOut' }))
    }
  }

  const doForMe = () => {
    const st = step()
    if (!st.task || autoBusy) return
    autoBusy = true
    // one action at a time, so each part visibly drops in before the next
    st.task.auto.forEach((a, k) => later(k * 260, () => api.act(a)))
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
    api.touring(false)
    paintStart()
    const done = () => { el.hidden = true; startButton.hidden = false; if (!reduce()) run(animate(startButton, { scale: [0.9, 1] }, { type: 'spring', stiffness: 400, damping: 18 })) }
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

  return {
    el,
    startButton,
    update(s) {
      if (!on) return
      if (phase === 'task') checkTask(s)
      void doneAt
    },
    dispose() {
      for (const a of running) a.stop()
      for (const t of timers) clearTimeout(t)
      el.remove()
      startButton.remove()
    },
  }
}
