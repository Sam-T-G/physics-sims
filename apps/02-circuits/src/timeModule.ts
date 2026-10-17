// Layer 3: the capacitor-over-time module. Two live plots for the capacitor: current I(t) and voltage V_C(t),
// each with the book's exponential drawn dashed for the whole window and the live trace drawn over it.
// Under the plots, a timeline (drag along the plots or the timeline to move to any moment on the curve), loop on or
// off and the speed. Play/Pause, Reset and the time live in `transport`, the clock pill that sits on the board.

import { animate } from 'motion'
import { INSTANT_TAU, type CapReading } from './board'
import { sig3, reading, useMilli } from './format'
import { FREE, type Mask } from './freeze'

export type RcClock = {
  /** Seconds along this curve: 0 when the circuit last changed or the curve last started over. */
  t: number
  /** Capacitor voltage and current at that change (the start of this curve). */
  V0: number
  I0: number
  Voc: number
  tau: number
  speed: number
  batteryIn: boolean
  trace: { t: number; I: number; V: number }[]
  /** The clock runs while playing; paused, the board stays at time t. */
  playing: boolean
  /** At the end of the curve, wait a moment and start over at t = 0. */
  loop: boolean
  /** Seconds (real time) spent waiting at the end before starting over. */
  hold: number
  /** The circuit changed partway through a curve: when (performance.now(), ms) and the V_C the new curve starts from. */
  restart?: { at: number; V: number } | null
}

export type ScrubPhase = 'start' | 'move' | 'end' | 'key'
export type TimeHandlers = {
  onBattery(batteryIn: boolean): void
  onSpeed(n: number): void
  onPlay(): void
  /** Reset the capacitor (empty if it was charging, its starting charge if it was draining) and play from t = 0. */
  onReset(): void
  onLoop(): void
  /** Move to time t (seconds) on the curve; 'start' and 'end' bracket a drag. */
  onScrub(t: number, phase: ScrubPhase): void
}

export type TimeModule = {
  el: HTMLElement
  /** The capacitor clock pill (Play/Pause, Reset, t): mounted on the board by the app. */
  transport: HTMLElement
  /** `mask`: an open prediction locks the controls, covers the curve ahead of the playhead, or covers a whole plot. */
  update(cap: CapReading | undefined, clock: RcClock, mask?: Mask): void
  /** The next show or hide of the plots happens at once (no height tween): for changes the app anchors by hand. */
  snapNext(): void
  dispose(): void
}

// ---------- pure helpers (tested in tests/app/timeModule.test.ts) ----------

/** What kind of curve the clock holds: a live exponential, one already at its end, an instant jump, or no path at all. */
export type CurveKind = 'live' | 'flat' | 'instant' | 'none'
/** The capacitor already sits at its final voltage (to the solver's tolerance): nothing on the curve changes. */
export const isFlat = (V0: number, Voc: number) => Math.abs(V0 - Voc) < 1e-5 * Math.max(1, Math.abs(Voc))
export function curveKind(c: Pick<RcClock, 'tau' | 'V0' | 'Voc'>): CurveKind {
  if (!(c.tau < Infinity)) return 'none'
  if (c.tau < INSTANT_TAU) return 'instant'
  return isFlat(c.V0, c.Voc) ? 'flat' : 'live'
}
/** The plot window, in seconds: the clock's own end, 5τ with Loop on (the loop starts over there), 6τ with Loop off. */
export const plotWindow = (tau: number, loop: boolean, kind: CurveKind) =>
  kind === 'live' || kind === 'flat' ? (loop && kind === 'live' ? 5 : 6) * tau : 10
/**
 * The battery is in, yet the capacitor drains toward 0 V: a gap somewhere cuts the battery off, and the capacitor
 * empties through the resistors. Neither "Charge" nor "Discharge" describes that.
 */
export const batteryCutOff = (c: Pick<RcClock, 'tau' | 'V0' | 'Voc' | 'batteryIn'>) =>
  c.batteryIn && curveKind(c) === 'live' && Math.abs(c.Voc) < 1e-5 * Math.max(1, Math.abs(c.V0))
/** An axis reads in milli-units when its biggest number would (the same rule as the readout above it). */
export function axisScale(values: number[], unit: string): { k: number; unit: string } {
  const top = Math.max(0, ...values.map(Math.abs))
  return top > 0 && useMilli(top) ? { k: 1000, unit: `m${unit}` } : { k: 1, unit }
}
/**
 * A guide line's label sits just above the line unless the curve runs within `gap` px above the line under the
 * label, and has more room below. SVG y grows downward. `curveYs`: the curve's y under the label's width.
 */
export function labelSide(lineY: number, curveYs: number[], gap = 14): 'above' | 'below' {
  const above = Math.min(Infinity, ...curveYs.filter(y => y <= lineY).map(y => lineY - y))
  const below = Math.min(Infinity, ...curveYs.filter(y => y > lineY).map(y => y - lineY))
  return above < gap && below > above ? 'below' : 'above'
}
export type NoteState = { kind: CurveKind; locked: boolean; loop: boolean; hold: number; settled: boolean; cutOff: boolean
  /** V_C the new curve starts from, for 2 s after the circuit changed partway through a curve. */
  restart?: number | null }
/** How long the "New curve" note stays (ms). */
export const RESTART_NOTE_MS = 2000
/** The note under the time. */
export function noteFor(s: NoteState): string {
  const fiveTau = 'After 5τ, more than 99% of the change is complete.'
  if (s.locked && (s.kind === 'live' || s.kind === 'flat')) return 'Paused at <i>t</i> = 0 until you predict.'
  if (s.kind === 'instant') return 'Only wire is in the capacitor\'s path, so the capacitor charges or discharges instantly.'
  if (s.kind === 'none') return 'No loop passes through the capacitor, so the capacitor\'s voltage stays the same.'
  if (s.kind === 'flat') return 'The capacitor is already at the final voltage, so nothing changes.'
  if (s.restart != null) return `The circuit changed, so the clock restarts from <i>V</i><sub>C</sub> = ${sig3(s.restart)} V.`
  if (s.loop && s.hold > 0) return `${fiveTau} Replaying from <i>t</i> = 0.`
  if (s.settled) return fiveTau
  if (s.cutOff) return 'The battery is cut off, so the capacitor is discharging through the resistors.'
  return ''
}
/** The Play button's word: a curve with nothing to play (flat, instant, no path) shows a disabled Play, never Pause. */
export const playWord = (playing: boolean, kind: CurveKind): 'Play' | 'Pause' => (playing && kind === 'live' ? 'Pause' : 'Play')
/** Three significant figures as a plain number, for aria-valuenow and aria-valuemax. */
const num3 = (x: number) => (x === 0 ? 0 : Number(x.toPrecision(3)))

const W = 320
const H = 128
const M = { l: 46, r: 12, t: 12, b: 24 }
const pw = W - M.l - M.r
const ph = H - M.t - M.b

const ICON = {
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.5"/><rect x="13.5" y="5" width="4" height="14" rx="1.5"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7" fill="none"/><path d="M4 4v4.5h4.5" fill="none"/>',
  loop: '<path d="M17 3l3 3-3 3" fill="none"/><path d="M4 11V9a3 3 0 0 1 3-3h13" fill="none"/><path d="M7 21l-3-3 3-3" fill="none"/><path d="M20 13v2a3 3 0 0 1-3 3H4" fill="none"/>',
}
const icon = (d: string, solid = false) => `<svg viewBox="0 0 24 24" aria-hidden="true" class="${solid ? 'is-solid' : ''}">${d}</svg>`

export function createTimeModule(handlers: TimeHandlers, reduce: () => boolean = () => false): TimeModule {
  const el = document.createElement('section')
  el.className = 'sim02-time'
  el.setAttribute('aria-label', 'The capacitor over time')
  el.innerHTML = `
    <header class="sim02-row-head">
      <span class="sim02-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg></span>
      <h2>The capacitor over time</h2>
    </header>
    <div class="sim02-time-empty">
      <p>Place the capacitor on the board to plot the capacitor's current and voltage over time.</p>
    </div>
    <div class="sim02-time-live" hidden>
      <div class="sim02-seg" role="group" aria-label="Battery switch">
        <button type="button" data-bat="in" aria-pressed="true">Charge: battery in</button>
        <button type="button" data-bat="out" aria-pressed="false">Discharge: battery out</button>
      </div>
      <figure class="sim02-plot sim02-plot-I">
        <figcaption><span><i>I</i><sub>C</sub>, current into the capacitor</span><b class="sim02-plot-now" data-now="I"></b></figcaption>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Current into the capacitor over time"><g class="pl-base"></g><g class="pl-book"></g><g class="pl-top"></g></svg>
      </figure>
      <figure class="sim02-plot sim02-plot-V">
        <figcaption><span><i>V</i><sub>C</sub>, voltage across the capacitor</span><b class="sim02-plot-now" data-now="V"></b></figcaption>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Voltage across the capacitor over time"><g class="pl-base"></g><g class="pl-book"></g><g class="pl-top"></g></svg>
      </figure>
      <div class="sim02-timeline">
        <div class="sim02-tl-track">
          <i class="sim02-tl-fill"></i>
          <i class="sim02-tl-ticks"></i>
          <i class="sim02-tl-run"><span class="sim02-tl-knob" role="slider" tabindex="0" aria-label="Time on the capacitor's curve" aria-valuemin="0"></span></i>
        </div>
      </div>
      <div class="sim02-time-controls">
        <div class="sim02-seg sim02-tp-speed" role="group" aria-label="Speed and loop">
          <button type="button" data-speed="1" aria-pressed="true">1×</button>
          <button type="button" data-speed="5" aria-pressed="false">5×</button>
          <button type="button" data-speed="25" aria-pressed="false">25×</button>
          <button type="button" data-tp="loop" aria-pressed="true">${icon(ICON.loop)}<span>Loop</span></button>
        </div>
      </div>
      <!-- under the buttons: one fixed line for the time, then a note with two lines kept free, so nothing below moves -->
      <div class="sim02-time-clock"><p class="clock-t"></p><p class="clock-note"></p></div>
    </div>`
  // the clock pill: the app mounts it on the board, next to Reset view
  const transport = document.createElement('div')
  transport.className = 'sim02-tp-pill'
  transport.setAttribute('role', 'group')
  transport.setAttribute('aria-label', 'Capacitor clock')
  transport.inert = true
  transport.innerHTML = `
    <button type="button" data-tp="play"></button>
    <button type="button" data-tp="reset" aria-label="Reset the capacitor and play the curve again">${icon(ICON.restart)}<span class="bb-word">Reset</span></button>
    <output class="sim02-tp-t"></output>
    <i class="sim02-tp-track" aria-hidden="true"><i></i></i>`
  const emptyEl = el.querySelector<HTMLElement>('.sim02-time-empty')!
  const liveEl = el.querySelector<HTMLElement>('.sim02-time-live')!
  const svgI = el.querySelector<SVGSVGElement>('.sim02-plot-I svg')!
  const svgV = el.querySelector<SVGSVGElement>('.sim02-plot-V svg')!
  const nowI = el.querySelector<HTMLElement>('[data-now=I]')!
  const nowV = el.querySelector<HTMLElement>('[data-now=V]')!
  const clockT = el.querySelector<HTMLElement>('.clock-t')!
  const clockNote = el.querySelector<HTMLElement>('.clock-note')!
  const batBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-bat]')]
  const speedBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-speed]')]
  const playBtn = transport.querySelector<HTMLButtonElement>('[data-tp=play]')!
  const resetBtn = transport.querySelector<HTMLButtonElement>('[data-tp=reset]')!
  const tOut = transport.querySelector<HTMLElement>('.sim02-tp-t')!
  const tpTrack = transport.querySelector<HTMLElement>('.sim02-tp-track i')!
  const loopBtn = el.querySelector<HTMLButtonElement>('[data-tp=loop]')!
  const track = el.querySelector<HTMLElement>('.sim02-tl-track')!
  const fill = el.querySelector<HTMLElement>('.sim02-tl-fill')!
  const knob = el.querySelector<HTMLElement>('.sim02-tl-knob')!
  const knobRun = el.querySelector<HTMLElement>('.sim02-tl-run')!
  const figI = el.querySelector<HTMLElement>('.sim02-plot-I')!
  const figV = el.querySelector<HTMLElement>('.sim02-plot-V')!
  const ticksEl = el.querySelector<HTMLElement>('.sim02-tl-ticks')!
  let ticksPainted = 0
  /** The timeline's τ marks: 4 between 0 and 5τ, 5 between 0 and 6τ. */
  const paintTicks = (n: number) => {
    if (n === ticksPainted) return
    ticksPainted = n
    ticksEl.innerHTML = Array.from({ length: n - 1 }, (_, k) => `<i class="sim02-tl-tick" style="left:${(((k + 1) / n) * 100).toFixed(3)}%"></i>`).join('')
  }
  /** A carried cover (the student already picked on this step) lifts at the next step's pick, and its words say so. */
  let carried = false
  /** A covered plot's live value reads "?" (and says so to screen readers). */
  const paintNow = (b: HTMLElement, cover: boolean, text: string, what: string) => {
    const html = cover ? `<span class="sim02-q" aria-hidden="true">?</span><span class="sim02-sr">${what}: hidden until ${carried ? 'your next prediction' : 'you pick a prediction'}</span>` : text
    if (b.dataset.html !== html) { b.innerHTML = html; b.dataset.html = html }
  }
  // While the student predicts, every clock control stays focusable but takes no action (aria-disabled), and says why.
  const lockNote = document.createElement('span')
  lockNote.className = 'sim02-sr'
  lockNote.id = `sim02-lock-${Math.random().toString(36).slice(2, 8)}`
  lockNote.textContent = 'Pick your prediction first'
  el.appendChild(lockNote)
  let lockPainted: boolean | null = null
  const paintLock = (on: boolean) => {
    if (on === lockPainted) return
    lockPainted = on
    el.classList.toggle('is-locked', on)
    transport.classList.toggle('is-locked', on)
    for (const b of [...el.querySelectorAll<HTMLElement>('button, [role=slider]'), ...transport.querySelectorAll<HTMLElement>('button')]) {
      if (on) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-describedby', lockNote.id) }
      else if (b.getAttribute('aria-describedby') === lockNote.id) { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-describedby') }
    }
  }
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!b) return
    if (b.dataset.bat) handlers.onBattery(b.dataset.bat === 'in')
    else if (b.dataset.speed) handlers.onSpeed(Number(b.dataset.speed))
    else if (b.dataset.tp === 'play') handlers.onPlay()
    else if (b.dataset.tp === 'reset') handlers.onReset()
    else if (b.dataset.tp === 'loop') handlers.onLoop()
  }
  el.addEventListener('click', onClick)
  transport.addEventListener('click', onClick)

  let restartTimer = 0
  // the note under the time crossfades between its sentences instead of jumping
  let noteShown = ''
  let noteWant = ''
  let noteBusy = false
  const setNote = (html: string) => {
    noteWant = html
    if (html === noteShown || noteBusy) return
    if (reduce()) { clockNote.innerHTML = html; noteShown = html; return }
    noteBusy = true
    animate(clockNote, { opacity: 0 }, { duration: 0.12 }).then(() => {
      clockNote.innerHTML = noteWant
      noteShown = noteWant
      noteBusy = false
      animate(clockNote, { opacity: 1 }, { duration: 0.12 })
      if (noteWant !== noteShown) setNote(noteWant)
    })
  }
  /** Adding or taking away the capacitor grows or shrinks the module: tween its height so the change has a visible cause. */
  let painted = false
  let snap = false
  let heightTween: { stop(): void } | null = null
  /** Make a change that shows or hides part of the module, tweening the height from what it was. */
  const resize = (change: () => void) => {
    const from = el.offsetHeight
    change()
    heightTween?.stop()
    heightTween = null
    el.style.height = ''
    el.style.overflow = ''
    if (!painted || snap || reduce() || !el.isConnected) { painted = true; return }
    const to = el.offsetHeight
    if (Math.abs(to - from) < 1) return
    el.style.overflow = 'hidden'
    const a = animate(el, { height: [`${from}px`, `${to}px`] }, { duration: 0.32, ease: [0.22, 1, 0.36, 1] })
    heightTween = a
    a.then(() => { if (heightTween === a) { el.style.height = ''; el.style.overflow = ''; heightTween = null } })
  }
  /**
   * The module's shape, in one height tween: the plots show only with a capacitor on the board, a curve with
   * nothing to play hides the timeline, and a capacitor that fills or empties at once hides both plots.
   */
  let kindPainted: CurveKind | null = null
  const paintShape = (on: boolean, kind: CurveKind) => {
    if (liveEl.hidden === !on && painted && (!on || kind === kindPainted)) return
    resize(() => {
      emptyEl.hidden = on
      liveEl.hidden = !on
      if (!on) return
      kindPainted = kind
      liveEl.classList.toggle('is-static', kind !== 'live')
      figI.hidden = kind === 'instant'
      figV.hidden = kind === 'instant'
    })
  }

  // ---------- scrubbing: the timeline, and the plots themselves ----------
  /** The plot window: 0 to 5τ with Loop on, 0 to 6τ with Loop off (set on every update). */
  let T = 10
  let tau = Infinity
  /** Only a live curve can be moved along. */
  let scrubbable = false
  let playPainted = ''
  const clampT = (t: number) => Math.max(0, Math.min(T, t))
  const fromTrack = (x: number) => { const r = track.getBoundingClientRect(); return clampT(((x - r.left) / (r.width || 1)) * T) }
  /** A client x over a plot, as time: the plot area runs from M.l to W − M.r in the SVG's own units. */
  const fromPlot = (svg: SVGSVGElement, x: number) => { const r = svg.getBoundingClientRect(); return clampT((((x - r.left) / (r.width || 1)) * W - M.l) / pw * T) }
  let dragId: number | null = null
  /** The last time a drag reached: a drag that ends any way but a real release ends there (a cancel or a lost
   *  capture can report 0, 0). */
  let lastT = 0
  const endAt = (e: PointerEvent, t: number) => (e.type === 'pointerup' ? t : lastT)
  const onTrackDown = (e: PointerEvent) => {
    if (e.button !== 0 || !scrubbable) return
    e.preventDefault()
    dragId = e.pointerId
    track.setPointerCapture(e.pointerId)
    knob.focus({ preventScroll: true })
    lastT = fromTrack(e.clientX)
    handlers.onScrub(lastT, 'start')
  }
  const onTrackMove = (e: PointerEvent) => { if (e.pointerId === dragId) { lastT = fromTrack(e.clientX); handlers.onScrub(lastT, 'move') } }
  const onTrackUp = (e: PointerEvent) => {
    if (e.pointerId !== dragId) return
    dragId = null
    if (track.hasPointerCapture(e.pointerId)) track.releasePointerCapture(e.pointerId)
    handlers.onScrub(endAt(e, fromTrack(e.clientX)), 'end')
  }
  track.addEventListener('pointerdown', onTrackDown)
  track.addEventListener('pointermove', onTrackMove)
  track.addEventListener('pointerup', onTrackUp)
  track.addEventListener('pointercancel', onTrackUp)
  // On the plots a finger may be scrolling the page: a touch scrubs only once it moves sideways (or taps in place).
  // A mouse scrubs from the press.
  type PlotDrag = { id: number; svg: SVGSVGElement; x0: number; y0: number; on: boolean; touch: boolean }
  let pd: PlotDrag | null = null
  const plotDown = (svg: SVGSVGElement) => (e: PointerEvent) => {
    if (e.button !== 0 || !scrubbable) return
    // a press while an old one is still recorded: the old one lost its end somewhere, so it ends now
    if (pd) { const old = pd; pd = null; if (old.on) handlers.onScrub(lastT, 'end') }
    const touch = e.pointerType !== 'mouse'
    pd = { id: e.pointerId, svg, x0: e.clientX, y0: e.clientY, on: !touch, touch }
    if (!touch) { e.preventDefault(); svg.setPointerCapture(e.pointerId); lastT = fromPlot(svg, e.clientX); handlers.onScrub(lastT, 'start') }
  }
  const plotMove = (e: PointerEvent) => {
    if (!pd || e.pointerId !== pd.id) return
    if (!pd.on) {
      const dx = e.clientX - pd.x0, dy = e.clientY - pd.y0
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return
      pd.on = true
      pd.svg.setPointerCapture(e.pointerId)
      lastT = fromPlot(pd.svg, e.clientX)
      handlers.onScrub(lastT, 'start')
      return
    }
    lastT = fromPlot(pd.svg, e.clientX)
    handlers.onScrub(lastT, 'move')
  }
  const plotUp = (e: PointerEvent) => {
    if (!pd || e.pointerId !== pd.id) return
    const d = pd
    pd = null
    if (d.svg.hasPointerCapture(e.pointerId)) d.svg.releasePointerCapture(e.pointerId)
    const t = endAt(e, fromPlot(d.svg, e.clientX))
    if (d.on) handlers.onScrub(t, 'end')
    else if (e.type === 'pointerup' && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) { handlers.onScrub(t, 'start'); handlers.onScrub(t, 'end') }
  }
  const plotHandlers = [svgI, svgV].map(svg => {
    const down = plotDown(svg)
    svg.addEventListener('pointerdown', down)
    svg.addEventListener('pointermove', plotMove)
    svg.addEventListener('pointerup', plotUp)
    svg.addEventListener('pointercancel', plotUp)
    svg.addEventListener('lostpointercapture', plotUp)
    return { svg, down }
  })
  let tNowShown = 0
  const onKnobKey = (e: KeyboardEvent) => {
    if (!scrubbable) return
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.1 * tau
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.1 * tau
      : e.key === 'PageUp' ? tau : e.key === 'PageDown' ? -tau : NaN
    if (e.key === 'Home') { e.preventDefault(); handlers.onScrub(0, 'key'); return }
    if (e.key === 'End') { e.preventDefault(); handlers.onScrub(T, 'key'); return }
    if (Number.isNaN(step)) return
    e.preventDefault()
    handlers.onScrub(clampT(tNowShown + step), 'key')
  }
  knob.addEventListener('keydown', onKnobKey)

  /**
   * fog: the curve right of the playhead is covered ('predict' adds the words). covered: the whole plot is.
   * `ends`: the curve's start and end values, so the axis holds still for the whole curve and through a loop.
   * `still`: a curve with nothing to play (no τ marks, no live trace, the dot at t = 0).
   */
  const plot = (svg: SVGSVGElement, T: number, f: (t: number) => number, trace: [number, number][], tNow: number, yNow: number,
    marks: { y: number; label: string }[], ends: number[], tau: number, unit: string, fog: 'predict' | 'act' | null, covered: boolean,
    still: boolean) => {
    const ys = [0, f(0), f(T), yNow, ...ends, ...marks.map(m => m.y)]
    let lo = Math.min(...ys), hi = Math.max(...ys)
    // every value is the same (a flat 0 A line): draw the line, but with no made-up scale beside it
    const madeUp = hi - lo < 1e-9
    if (madeUp) { hi = lo + 1; lo = lo - (lo === 0 ? 0 : 1) }
    const pad = (hi - lo) * 0.08
    lo -= lo < 0 ? pad : 0; hi += pad
    const sc = axisScale(madeUp ? [] : [hi - pad, lo < 0 ? lo + pad : 0], unit)
    const X = (t: number) => M.l + (Math.min(t, T) / T) * pw
    const Y = (y: number) => M.t + (1 - (y - lo) / (hi - lo)) * ph
    const curve: string[] = []
    for (let k = 0; k <= 80; k++) { const t = (T * k) / 80; curve.push(`${k ? 'L' : 'M'}${X(t).toFixed(1)},${Y(f(t)).toFixed(1)}`) }
    const live = still ? '' : trace.filter(p => p[0] <= T).map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')
    const ticks: string[] = []
    if (!still && Number.isFinite(tau) && tau > 0) {
      for (let n = 1; n <= 6; n++) {
        const x = X(n * tau)
        if (n * tau > T + 1e-9) break
        ticks.push(`<line class="g" x1="${x}" x2="${x}" y1="${M.t}" y2="${M.t + ph}"/><text class="tx" x="${x}" y="${H - 8}">${n === 1 ? 'τ' : `${n}τ`}</text>`)
      }
    }
    const markEls = marks.map(m => {
      // the label sits at the right end; on a curve that ends just above the line, it moves under the line
      const y = Y(m.y)
      const x1 = M.l + pw - 2
      const x0 = Math.max(M.l, x1 - (m.label.length * 5.4 + 4))
      const under = Array.from({ length: 13 }, (_, k) => Y(f(((x0 + ((x1 - x0) * k) / 12 - M.l) / pw) * T)))
      const ly = labelSide(y, under) === 'below' ? y + 11 : y - 4
      return `<line class="m" x1="${M.l}" x2="${M.l + pw}" y1="${y}" y2="${y}"/><text class="ml" x="${x1}" y="${ly}">${m.label}</text>`
    }).join('')
    const [base, book, top] = [...svg.children] as [SVGGElement, SVGGElement, SVGGElement]
    // under a fog an axis number only shows if the curve has already been there (the end value is the answer)
    const seen = (y: number) => !fog || Math.abs(y - f(0)) < 1e-9 * Math.max(1, Math.abs(y))
    const axes = `
      <line class="ax" x1="${M.l}" x2="${M.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>
      <line class="ax" x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${M.t + ph}"/>
      <text class="tu" x="${M.l - 6}" y="${M.t + ph / 2}">${sc.unit}</text>`
    if (covered) {
      base.innerHTML = axes
      book.innerHTML = ''
      top.innerHTML = `<rect class="fog" x="${M.l + 1}" y="${M.t}" width="${pw - 1}" height="${ph}" rx="8"/><text class="fogt" x="${M.l + pw / 2}" y="${M.t + ph / 2 + 4}">${carried ? 'Shows up after your next pick' : 'Shows up after you predict'}</text>`
      return
    }
    base.innerHTML = `${axes}
      ${!madeUp && Math.abs(hi - pad) > 1e-12 && seen(hi - pad) ? `<text class="ty" x="${M.l - 6}" y="${Y(hi - pad) + 4}">${sig3((hi - pad) * sc.k)}</text>` : ''}
      ${!madeUp && lo < -1e-12 && seen(lo + pad) ? `<text class="ty" x="${M.l - 6}" y="${Y(lo + pad) + 4}">${sig3((lo + pad) * sc.k)}</text>` : ''}
      <text class="ty" x="${M.l - 6}" y="${Y(0) + 4}">0</text>
      ${ticks.join('')}`
    // the book curve keeps its element, so it can fade in when the fog lifts
    book.innerHTML = `${markEls}<path class="book" d="${curve.join('')}"/>`
    const fx = X(still ? 0 : tNow)
    const fogEl = !fog ? '' : `<rect class="fog" x="${fx + 3}" y="${M.t}" width="${Math.max(0, M.l + pw - fx - 3)}" height="${ph}" rx="8"/>${fog === 'predict' ? `<text class="fogt" x="${(fx + 3 + M.l + pw) / 2}" y="${M.t + ph / 2 + 4}">Plays after you predict</text>` : ''}`
    top.innerHTML = `
      ${still ? '' : `<line class="ph" x1="${fx}" x2="${fx}" y1="${M.t}" y2="${M.t + ph}"/>`}
      <path class="trace" d="${live}"/>${fogEl}
      <circle class="dot" cx="${fx}" cy="${Y(yNow)}" r="5"/>`
  }

  return {
    el,
    transport,
    snapNext() { snap = true },
    update(cap, c, mask = FREE) {
      const kind = curveKind(c)
      paintShape(!!cap, kind)
      paintLock(mask.locked)
      snap = false
      // the pill shows only while the board holds a capacitor; hidden, it takes no focus or presses
      transport.classList.toggle('is-on', !!cap)
      transport.inert = !cap
      // battery in but cut off by a gap: the capacitor empties, so neither "Charge" nor "Discharge" is pressed
      const cutOff = !!cap && batteryCutOff(c)
      batBtns.forEach(b => b.setAttribute('aria-pressed', String(!cutOff && (b.dataset.bat === 'in') === c.batteryIn)))
      speedBtns.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === c.speed)))
      if (!cap) return
      tau = c.tau
      const live = kind === 'live'
      const curve = live || kind === 'flat'
      scrubbable = live
      T = plotWindow(tau, c.loop, kind)
      if (curve) paintTicks(Math.round(T / tau))
      playBtn.disabled = !live
      resetBtn.disabled = !live
      const Vof = (t: number) => (curve ? c.Voc + (c.V0 - c.Voc) * Math.exp(-t / tau) : c.V0)
      const Iof = (t: number) => (curve ? c.I0 * Math.exp(-t / tau) : 0)
      const tShow = live ? Math.min(c.t, T) : 0
      carried = mask.next
      const coverI = mask.get(['Ic'], 'plot-I') === 'hide'
      const coverV = mask.get(['Vc'], 'plot-V') === 'hide'
      figI.classList.toggle('is-fog', !!mask.fog || coverI)
      figV.classList.toggle('is-fog', !!mask.fog || coverV)
      if (kind !== 'instant') {
        plot(svgI, T, Iof, c.trace.map(p => [p.t, p.I]), tShow, cap.Ic,
          live && Math.abs(c.I0) > 0 ? [{ y: 0.368 * c.I0, label: '37% of I₀ at τ' }] : [], [c.I0, 0], tau, 'A', mask.fog, coverI, !live)
        plot(svgV, T, Vof, c.trace.map(p => [p.t, p.V]), tShow, cap.Vc,
          live ? [{ y: c.V0 + 0.632 * (c.Voc - c.V0), label: '63% of the change at τ' }] : [], [c.V0, c.Voc], tau, 'V', mask.fog, coverV, !live)
      }
      paintNow(nowI, coverI, reading(cap.Ic, 'A'), 'Current into the capacitor')
      paintNow(nowV, coverV, reading(cap.Vc, 'V'), 'Voltage across the capacitor')
      const settled = live && tShow >= 5 * tau - 1e-9
      // the timeline and the transport
      tNowShown = tShow
      const f = live ? tShow / T : 0
      // transforms, not left/width: the knob moves every frame and must not cause layout
      fill.style.transform = `scaleX(${f.toFixed(4)})`
      knobRun.style.transform = `translateX(${(f * 100).toFixed(2)}%)`
      tpTrack.style.transform = `scaleX(${f.toFixed(4)})`
      // every place the time shows reads the same t (the knob's spoken value too)
      const tText = `t = ${sig3(tShow)} s`
      tOut.textContent = live ? tText : ''
      knob.setAttribute('aria-valuemax', String(num3(T)))
      knob.setAttribute('aria-valuenow', String(num3(tShow)))
      knob.setAttribute('aria-valuetext', live ? `${tText}, ${sig3(tShow / tau)} τ` : 'no curve')
      const word = playWord(c.playing, kind)
      const playHtml = `${icon(word === 'Pause' ? ICON.pause : ICON.play, true)}<span class="bb-word">${word}</span>`
      if (playHtml !== playPainted) { playBtn.innerHTML = playHtml; playPainted = playHtml; playBtn.setAttribute('aria-label', word) }
      loopBtn.setAttribute('aria-pressed', String(c.loop))
      const tLine = live ? `${tText} (${sig3(tShow / tau)} τ)` : ''
      if (clockT.textContent !== tLine) clockT.textContent = tLine
      const left = c.restart ? RESTART_NOTE_MS - (performance.now() - c.restart.at) : 0
      const ns: NoteState = { kind, locked: mask.locked, loop: c.loop, hold: c.hold, settled, cutOff, restart: left > 0 ? c.restart!.V : null }
      setNote(noteFor(ns))
      // the note goes after 2 s even when nothing repaints the module (a paused clock)
      window.clearTimeout(restartTimer)
      if (left > 0) restartTimer = window.setTimeout(() => setNote(noteFor({ ...ns, restart: null })), left + 20)
    },
    dispose() {
      window.clearTimeout(restartTimer)
      el.removeEventListener('click', onClick)
      transport.removeEventListener('click', onClick)
      heightTween?.stop()
      transport.remove()
      track.removeEventListener('pointerdown', onTrackDown)
      track.removeEventListener('pointermove', onTrackMove)
      track.removeEventListener('pointerup', onTrackUp)
      track.removeEventListener('pointercancel', onTrackUp)
      for (const { svg, down } of plotHandlers) {
        svg.removeEventListener('pointerdown', down)
        svg.removeEventListener('pointermove', plotMove)
        svg.removeEventListener('pointerup', plotUp)
        svg.removeEventListener('pointercancel', plotUp)
        svg.removeEventListener('lostpointercapture', plotUp)
      }
      knob.removeEventListener('keydown', onKnobKey)
      el.remove()
    },
  }
}
