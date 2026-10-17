// Layer 3: the app. Owns state, input, springs and the page. Motion lives here and in panel.ts only.

import * as THREE from 'three'
import { animate, springValue, motionValue, frame, cancelFrame, type MotionValue } from 'motion'
import {
  solveBoard, SLOTS, SLOT_IDS, OHM_STEPS, FARAD_STEPS, PRESETS, NODES,
  type BoardResult, type Part, type Slots, type SlotId, type Pt, type Preset,
} from './board'
import { createScene, REST_Y, type CameraPose, type CameraShot, type PieceView, type Scene } from './scene'
import { createPanel, type Panel } from './panel'
import { createHud } from './hud'
import { createTimeModule, isFlat, type RcClock } from './timeModule'
import { createGuide, type Guide } from './guide'
import { createCues, type Cues } from './cues'
import { SHOTS, type Action, type GuideState, type Setup, type ShotName, type Spot } from './tour'
import { relaxVoltage } from '@lib/physics'
import { colorBands, BAND_HEX } from './colorCode'
import { sig, sig3, exact, reading, SUB } from './format'
import { statusFor, previewPaints, emptyDisabled, createUndo, boardKey, CLEARED, type BoardSnap } from './boardbar'
import { maskFor, gateFor, clockRuns, FREE, type FreezePhase, type Gate, type Mask, type Resolved } from './freeze'
import { meta } from './sim.meta'
import './styles.css'

type Piece = {
  view: PieceView
  slot: SlotId | null
  tx: MotionValue<number>; tz: MotionValue<number>; ty: MotionValue<number>; tr: MotionValue<number>
  x: MotionValue<number>; z: MotionValue<number>; y: MotionValue<number>; r: MotionValue<number>
  squash: MotionValue<number>
  wob: MotionValue<number>
  scale: MotionValue<number>
  heat: number
  dead: boolean
  /** Set while a part falls into a socket; the frame it touches down, it squashes and the ring pulses. */
  landing: SlotId | null
}

type Drag = {
  piece: Piece
  pointerId: number
  from: SlotId | null
  fromTray: boolean
  startX: number; startY: number
  moved: boolean
  lockSlot: SlotId | null
  near: SlotId | null
  captureEl: HTMLElement
}

const TRAY: { label: string; part: Part }[] = [
  { label: '2 Ω', part: { kind: 'resistor', ohms: 2 } },
  { label: '4 Ω', part: { kind: 'resistor', ohms: 4 } },
  { label: '6 Ω', part: { kind: 'resistor', ohms: 6 } },
  { label: '12 Ω', part: { kind: 'resistor', ohms: 12 } },
  { label: 'Wire', part: { kind: 'wire' } },
  { label: '0.5 F', part: { kind: 'capacitor', farads: 0.5 } },
]

/** A unit's name for a screen reader: "1 ohm", "0.5 ohms", "12.0 volts". */
const unitWord = (v: number, unit: string) => (v === 1 ? unit : `${unit}s`)
/** What a part is called in sentences: "4 Ω resistor", "wire", "0.5 F capacitor". */
const partLabel = (p: Part) => (p.kind === 'wire' ? 'wire' : p.kind === 'resistor' ? `${p.ohms} Ω resistor` : `${p.farads} F capacitor`)

const START: Slots = {
  R1: { kind: 'resistor', ohms: 2 },
  R2: { kind: 'resistor', ohms: 6 },
  R5: { kind: 'wire' },
}

const MAGNET = 2.2 // board units: a part starts leaning toward a socket inside this radius
const LOCK = 0.85 // and clicks into it inside this one
const HOLD = 1.3 // a latched part stays latched until it is this many LOCK radii away (no flicker at the edge)
const LIFT = 0.95
/** Sockets are long, so distance is measured to a segment this far either side of the socket's center. */
const SOCKET_HALF = 0.7

const svgIcon = (d: string, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}>${d}</svg>`
/** Reset view: four frame corners around a dot. */
const ICON_VIEW = '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2.2"/>'
const ICON_TRASH = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/>'
const ICON_UNDO = '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'

export type MountOptions = { basePath?: string }
let active: { unmount(): void } | null = null

export function mount(el: HTMLElement, _opts: MountOptions = {}): void {
  active?.unmount()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  let reduce = reduced.matches

  el.classList.add('sim02')
  el.innerHTML = `
    <div class="sim02-stage">
      <div class="sim02-canvas-wrap">
        <canvas class="sim02-canvas" aria-label="3D circuit board with five slots. Drag parts onto the slots, or use the slot buttons."></canvas>
        <div class="sim02-labels" aria-hidden="true"></div>
        <div class="sim02-slots" role="group" aria-label="Slots on the board"></div>
        <div class="sim02-pop" hidden></div>
        <p class="sim02-status" role="status" aria-live="polite"></p>
        <p class="sim02-replay" aria-hidden="true">Replaying from t = 0</p>
        <div class="sim02-boardbar" role="group" aria-label="Board controls">
          <div class="bb-left">
            <button class="sim02-recenter bb-btn is-home" type="button" aria-label="Reset view">${svgIcon(ICON_VIEW)}<span class="bb-word">Reset view</span></button>
          </div>
          <div class="bb-clock"></div>
          <div class="bb-right">
            <button class="sim02-clear-board bb-btn" type="button">
              <span class="bb-lab-clear">${svgIcon(ICON_TRASH)}<span>Clear<span class="bb-word"> the board</span></span></span>
              <span class="bb-lab-undo"><span class="bb-ring" aria-hidden="true"><svg viewBox="0 0 24 24" class="ring"><circle cx="12" cy="12" r="10"/></svg>${svgIcon(ICON_UNDO, 'ico')}</span><span>Undo</span></span>
            </button>
          </div>
        </div>
        <span class="sim02-sr" id="sim02-lock-note">Pick your prediction first</span>
      </div>
      <div class="sim02-hud-slot"></div>
      <div class="sim02-dock">
        <div class="sim02-dock-cell">
          <p class="sim02-dock-hint">Drag a part onto a slot, or tap a part and then a slot.</p>
          <p class="sim02-dock-hint sim02-dock-locked" hidden>Parts unlock after you predict.</p>
          <p class="sim02-preview-pill" aria-hidden="true">Release to place the part</p>
        </div>
        <div class="sim02-tray" role="toolbar" aria-label="Parts"></div>
      </div>
    </div>
    <aside class="sim02-notebook">
      <header class="sim02-head">
        <h1>${meta.title}</h1>
        <p>Build circuits from resistors, wires and a capacitor. Every current and voltage updates as the board changes.</p>
        <div class="sim02-tour-slot"></div>
      </header>
      <div class="sim02-guide-slot"></div>
      <section class="sim02-battery" aria-label="Battery">
        <h2><span class="sim02-mini-batt" aria-hidden="true"></span>Battery</h2>
        <label class="sim02-slider"><span class="sim02-slider-name" id="sim02-emf-name">Battery emf, <i>ε</i></span><output class="sim02-out" data-for="emf"></output>
          <input type="range" name="emf" min="1" max="24" step="0.5" aria-labelledby="sim02-emf-name" /></label>
        <label class="sim02-slider"><span class="sim02-slider-name" id="sim02-r-name">Internal resistance, <i>r</i></span><output class="sim02-out" data-for="r"></output>
          <input type="range" name="r" min="0" max="2" step="0.05" aria-labelledby="sim02-r-name" /></label>
      </section>
      <div class="sim02-time-slot"></div>
      <section class="sim02-book" aria-label="Book examples">
        <h2>Book examples</h2>
        <div class="sim02-presets"></div>
        <div class="sim02-compare" hidden></div>
      </section>
      <header class="sim02-notes-head">
        <h2>Equations</h2>
      </header>
      <div class="sim02-eqs-slot"></div>
      <details class="sim02-approx">
        <summary>Simplifications</summary>
        <ul>
          <li>Wires have 0 Ω. The battery is an ideal emf <i>ε</i> in series with one internal resistance <i>r</i>.</li>
          <li>Resistors keep a fixed <i>R</i> even as they heat up.</li>
          <li>The capacitors are 0.05 to 5 F, far larger than typical, so charging takes seconds. One capacitor at a time.</li>
          <li>Changing <i>C</i> keeps the charge on the plates fixed, so the capacitor's voltage changes instead.</li>
          <li>A wire across the capacitor discharges the capacitor instantly; with 0 Ω the discharge current is undefined. A real wire's small resistance makes the discharge fast but finite.</li>
          <li>The capacitor's curve replays in a loop. A real capacitor does not reset.</li>
          <li>The dots show the direction of current; faster dots mean more current. Real charges drift far more slowly.</li>
          <li>A ✓ on an equation means the equation gives the same number as the board.</li>
        </ul>
      </details>
      <footer class="sim02-sources" aria-labelledby="sim02-sources-h">
        <h2 id="sim02-sources-h">Credits</h2>
        <p>Based on <a href="https://openstax.org/details/books/university-physics-volume-2" target="_blank" rel="noopener"><cite>University Physics Volume 2</cite></a> by William Moebs, Samuel J. Ling and Jeff Sanny (OpenStax), licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>. Access for free at <a href="https://openstax.org" target="_blank" rel="noopener">openstax.org</a>. Text paraphrased; worked examples rebuilt as interactive circuits.</p>
      </footer>
    </aside>`

  const $ = <T extends Element>(s: string) => el.querySelector<T>(s)!
  const canvas = $<HTMLCanvasElement>('.sim02-canvas')
  const wrap = $<HTMLDivElement>('.sim02-canvas-wrap')
  const pill = $<HTMLParagraphElement>('.sim02-preview-pill')
  const labelsEl = $<HTMLDivElement>('.sim02-labels')
  const slotsEl = $<HTMLDivElement>('.sim02-slots')
  const pop = $<HTMLDivElement>('.sim02-pop')
  const statusEl = $<HTMLParagraphElement>('.sim02-status')
  const replayEl = $<HTMLParagraphElement>('.sim02-replay')
  const trayEl = $<HTMLDivElement>('.sim02-tray')
  const emfIn = $<HTMLInputElement>('input[name=emf]')
  const rIn = $<HTMLInputElement>('input[name=r]')
  const compare = $<HTMLDivElement>('.sim02-compare')
  const bar = $<HTMLDivElement>('.sim02-boardbar')
  const recenterBtn = $<HTMLButtonElement>('.sim02-recenter')
  const clearBtn = $<HTMLButtonElement>('.sim02-clear-board')
  const ringCircle = clearBtn.querySelector<SVGCircleElement>('.ring circle')!
  // the board box and the app never scroll (CSS clips them); if a browser scrolls one anyway, put it back
  const onBoxScroll = (e: Event) => {
    const box = e.currentTarget as HTMLElement
    if (box.scrollLeft || box.scrollTop) { box.scrollLeft = 0; box.scrollTop = 0 }
  }
  for (const box of [wrap, el]) box.addEventListener('scroll', onBoxScroll)
  /** Phones and short landscape screens: the value dial docks in the board bar's band instead of floating. */
  const dockedMq = window.matchMedia('(max-width: 860px), (max-width: 960px) and (orientation: landscape) and (max-height: 520px)')

  const scene: Scene | null = createScene(canvas, Math.min(window.devicePixelRatio || 1, 2))
  if (!scene) {
    // nothing on the page works without the board: one card instead of a dead, half-built page
    el.innerHTML = `<div class="sim02-nogl"><h1>${meta.title}</h1>
      <p>This sim needs WebGL to draw the circuit board, and this browser could not start WebGL.</p>
      <p>${window.matchMedia('(pointer: coarse)').matches ? 'Try a recent Chrome or Safari.' : 'Turn on hardware acceleration in your browser settings, or open this page on your phone.'}</p></div>`
    active = { unmount() { el.removeEventListener('scroll', onBoxScroll); el.innerHTML = ''; el.classList.remove('sim02'); active = null } }
    return
  }
  const sc = scene

  // ---------- state ----------
  let emf = 12
  let r = 0
  const pieces = new Map<SlotId, Piece>()
  const loose = new Set<Piece>() // dragged or leaving
  let selected: SlotId | null = null
  let holding: Part | null = null
  let holdingChip: HTMLButtonElement | null = null
  let drag: Drag | null = null
  let hovered: Piece | null = null
  let linked: SlotId | null = null
  let result: BoardResult = solveBoard({ emf, r, slots: {} })
  let preview = false
  let shown: Slots = {}
  let guide: Guide | null = null
  /** Created with the guide, below; the first commit comes after that. */
  let cues!: Cues
  /** Slots the guided tour is pointing at: their sockets glow softly. */
  const guideSpots = new Set<SlotId>()
  /** Whether the last committed board held a capacitor: previews never change what the panels show. */
  let committedHasCap = false
  /** The board a book example built (boardKey), while its table shows; null once the board moves on. */
  let presetKey: string | null = null
  let inTour = false
  /** Undo for Clear and the book examples (see boardbar.ts). */
  const undo = createUndo()
  let undoFrom: 'clear' | 'preset' | null = null
  const timers = new Set<number>()
  const later = (ms: number, fn: () => void) => { const t = window.setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }

  // ---------- the prediction freeze (freeze.ts) ----------
  // While a prediction is open the board shows the circuit before the change: input is locked, the capacitor's clock
  // holds at t = 0 (gate 'held'), the dots stand still, and the asked value is tagged or covered. "Right then" steps
  // hold the clock again at t = 0 of the new curve (gate 'after') until Play or Next.
  let fz: Resolved | null = null
  let fzPhase: FreezePhase | null = null
  let gate: Gate = 'free'
  let mask: Mask = FREE
  /** The part the HUD opens on while predicting (no dial). */
  let tourFocus: SlotId | null = null
  let fillTimer = 0
  const locked = () => fzPhase === 'predict'
  const remask = () => { mask = maskFor(fz, fzPhase, gate === 'after') }
  /** Parts still dropping in (a step's setup lands them one after another), and who waits for them. */
  let landTimers = 0
  let settleWaiters: (() => void)[] = []
  const anims = new Set<{ stop(): void }>()
  const run = <T extends { stop(): void; then(f: () => void): unknown }>(a: T): T => { anims.add(a); a.then(() => anims.delete(a)); return a }

  const committedSlots = (): Slots => {
    const s: Slots = {}
    for (const [id, p] of pieces) s[id] = p.view.part
    return s
  }

  // ---------- springs ----------
  const spring = (reduceIt: boolean, kind: 'move' | 'drop' | 'turn') => {
    if (reduceIt) return { stiffness: 900, damping: 60, mass: 1 }
    if (kind === 'drop') return { stiffness: 420, damping: 21, mass: 1 }
    if (kind === 'turn') return { stiffness: 300, damping: 20, mass: 1 }
    return { stiffness: 520, damping: 32, mass: 1 }
  }
  const makePiece = (part: Part, at: Pt, y: number): Piece => {
    const view = sc.makePiece({ ...part })
    if (part.kind === 'resistor') view.setOhms(part.ohms)
    const tx = motionValue(at.x), tz = motionValue(at.z), ty = motionValue(y), tr = motionValue(0)
    const p: Piece = {
      view, slot: null, tx, tz, ty, tr,
      x: springValue(tx, spring(reduce, 'move')),
      z: springValue(tz, spring(reduce, 'move')),
      y: springValue(ty, spring(reduce, 'drop')),
      r: springValue(tr, spring(reduce, 'turn')),
      squash: motionValue(1), wob: motionValue(0), scale: motionValue(1), heat: 0, dead: false, landing: null,
    }
    view.group.position.set(at.x, y, at.z)
    return p
  }
  const squish = (p: Piece, amount = 0.72) => {
    if (reduce) return
    run(animate(p.squash, [amount, 1], { type: 'spring', stiffness: 380, damping: 9 }))
  }
  const jiggle = (p: Piece, size = 0.16) => {
    if (reduce) return
    run(animate(p.wob, [0, size, -size * 0.7, size * 0.4, 0], { duration: 0.55, ease: 'easeOut' }))
  }
  const sendTo = (p: Piece, id: SlotId, drop = true) => {
    const c = SLOTS[id].center
    p.tx.set(c.x); p.tz.set(c.z)
    p.tr.set(SLOTS[id].vertical ? Math.PI / 2 : 0)
    p.ty.set(drop ? REST_Y : REST_Y + 0.25)
  }
  const ringTweens = new Map<SlotId, { stop(): void }>()
  /** How long a socket's glow keeps pulsing after the tour's last ripple on it (a beacon play ripples every 1.5 s) (ms). */
  const CUE_PULSE_MS = 1700
  /** When each socket's current run of tour ripples began, and its latest ripple (performance.now() ms). */
  const cuePulse = new Map<SlotId, { from: number; last: number }>()
  const markCuePulse = (id: SlotId) => {
    const now = performance.now()
    const p = cuePulse.get(id)
    if (p && now - p.last < CUE_PULSE_MS) p.last = now
    else cuePulse.set(id, { from: now, last: now })
  }
  const ringPulse = (id: SlotId, cue = false) => {
    const ring = sc.sockets[id].ring
    const mat = ring.material as THREE.MeshBasicMaterial
    // one tween per ring: a new pulse (a landing, a tour ripple) replaces the one still running
    ringTweens.get(id)?.stop()
    // the tour's ripple is grape-deep and wider, so the tour's ripple reads on the mint board; a landing stays butter
    mat.color.set(cue ? 0x5a4daa : 0xffd15c)
    const o = { s: cue ? 0.9 : 0.8, a: 0.9 }
    const end = reduce ? 1 : cue ? 1.85 : 2.1
    const tw = run(animate(o, { s: end, a: 0 }, {
      duration: reduce ? 0.2 : cue ? 1.0 : 0.6, ease: 'easeOut',
      onUpdate: () => { ring.scale.setScalar(o.s); mat.opacity = o.a },
    }))
    ringTweens.set(id, tw)
    // Motion never calls onUpdate with the last value: land on it, unless a newer pulse took the ring over
    tw.then(() => { if (ringTweens.get(id) !== tw) return; ring.scale.setScalar(end); mat.opacity = 0; ringTweens.delete(id) })
  }
  const poof = (p: Piece) => {
    // a part that leaves the board takes its hover link with it
    if (hovered === p) { hovered = null; wrap.classList.remove('is-grabbable') }
    if (p.slot && linked === p.slot) unlink()
    p.dead = true
    p.slot = null
    p.landing = null
    loose.add(p)
    p.ty.set(p.y.get() + 0.6)
    const a = run(animate(p.scale, 0, { duration: reduce ? 0.12 : 0.35, ease: [0.5, 0, 0.75, 0] }))
    if (!reduce) run(animate(p.wob, 0.9, { duration: 0.35 }))
    a.then(() => { loose.delete(p); p.view.dispose() })
  }

  // ---------- solving ----------
  // ---------- the capacitor's clock ----------
  // With one capacitor the board relaxes as one exponential (Eq 10.9). Whenever the circuit changes, the
  // capacitor starts a new curve from the voltage it has right then; between changes V_C follows that curve
  // exactly, and the board is re-solved each frame with the capacitor at that voltage.
  // The clock loops by default: at 5τ (the end of the plots) it holds a moment, then the capacitor resets and the
  // curve plays again (see resetCurve). A capacitor that is already settled has nothing to replay and stays put.
  // With reduced motion the curve plays once, to 6τ, and stays at the end.
  const clockRC: RcClock = { t: 0, V0: 0, I0: 0, Voc: 0, tau: Infinity, speed: 1, batteryIn: true, trace: [], playing: true, loop: !reduce, hold: 0, restart: null }
  /** Real seconds the end of a curve stays on screen before the loop resets the capacitor. */
  const LOOP_HOLD = 1.0
  // The loop's replay badge: on the board from the start of the hold at 5τ until 1 s into the replay, so a capacitor
  // that empties (or refills) by itself reads as the sim starting the curve over. aria-hidden: the time module's
  // note says the same in words.
  /** Real ms the badge stays into the replay. */
  const REPLAY_TAIL = 1000
  let replayOn = false
  let replayOffAt = 0
  const showReplay = (on: boolean) => {
    if (replayOn === on) return
    replayOn = on
    replayOffAt = Infinity
    replayEl.classList.toggle('is-on', on)
    wrap.classList.toggle('is-replay', on)
  }
  let capV = 0
  let circuitKey = ''
  /** Counts curves: a new one starts each time the circuit changes (anchor), not when a loop starts over. */
  let curveId = 0
  const capOnBoard = () => [...pieces.values(), ...(drag ? [drag.piece] : [])].some(p => p.view.part.kind === 'capacitor' && !p.dead)
  const solveWith = (slots: Slots) => solveBoard({ emf, r, slots, capV, batteryIn: clockRC.batteryIn })
  /** `mid`: the circuit changed partway through a curve, so the time module says why t went back to 0. */
  const anchor = (mid = false) => {
    const k = result.cap
    clockRC.restart = mid && k && Number.isFinite(k.tau) && k.tau > 0 ? { at: performance.now(), V: k.Vc } : null
    clockRC.t = 0
    clockRC.hold = 0
    // a "right then" step holds the instant its task made; one more change after that (one more + on the dial) is
    // the student's own, so the hold lets go and that curve plays, instead of a board that no longer matches the
    // reveal still saying "paused right after the change"
    if (gate === 'after' && fzPhase === 'done') { gate = 'free'; remask() }
    // a new curve (the circuit changed) plays from its start, even if the last one was paused or had ended,
    // unless a prediction holds the clock
    clockRC.playing = gate === 'free'
    clockRC.trace = []
    curveId++
    showReplay(false)
    if (!k) return
    capV = k.Vc
    clockRC.V0 = k.Vc; clockRC.I0 = k.Ic; clockRC.Voc = k.Voc; clockRC.tau = k.tau
    // no loop through the capacitor (τ = ∞) or nothing to wait for (τ = 0): the clock has nothing to play, so it
    // stands paused at t = 0 (the time module shows a disabled Play) until a change gives the capacitor a curve
    if (!(Number.isFinite(k.tau) && k.tau > 0)) clockRC.playing = false
    clockRC.trace.push({ t: 0, I: k.Ic, V: k.Vc })
  }
  const apply = (slots: Slots, opts: { preview: boolean; animate?: boolean }) => {
    if (!capOnBoard()) {
      // the capacitor left the board: a new one starts empty, and the battery switches back in
      capV = 0
      if (!clockRC.batteryIn) { clockRC.batteryIn = true }
    }
    result = solveWith(slots)
    shown = slots
    const key = boardKey(slots, emf, r, clockRC.batteryIn)
    // a preview (a part hovering over a slot) never moves the capacitor's charge; the commit re-anchors
    if (!opts.preview && (key !== circuitKey || result.cap?.snapped)) {
      // the student changed the circuit partway through a live curve (a new step's board or a Reset clears the key first)
      const mid = circuitKey !== '' && key !== circuitKey && committedHasCap && clockRC.t > 0 && Number.isFinite(clockRC.tau) && clockRC.tau > 0
      circuitKey = key
      anchor(mid)
    }
    preview = opts.preview
    el.classList.toggle('is-previewing', preview)
    if (!preview) committedHasCap = !!result.cap
    // a preview changes numbers, never the layout: no rows, tiles or plots appear or go while a part is held
    const paints = previewPaints(preview, committedHasCap, !!result.cap)
    // a book example's table only matches the board it built: any other committed board hides it
    if (!preview && presetKey !== null && key !== presetKey) { presetKey = null; compare.hidden = true }
    if (paints.panel) {
      // a preview gets its own clock from the previewed solve (t = 0 of the curve it would start); clockRC keeps
      // the committed curve, so the capacitor rows never mix two circuits
      const k = preview ? result.cap : undefined
      const rc: RcClock = k ? { ...clockRC, t: 0, I0: k.Ic, V0: k.Vc, Voc: k.Voc, tau: k.tau, trace: [] } : clockRC
      panel.update({ b: result, slots, selected, rc }, { preview, animate: (opts.animate ?? true) && !reduce }, mask)
      panelDirty = false
      panelNow = false
    }
    if (paints.time) timeMod.update(result.cap, clockRC, mask)
    if (paints.status) paintStatus(slots)
    paintSlotButtons(slots)
    paintTray()
    if (paints.hud) hud.update(result, slots, hudFocus(), opts.animate ?? true, false, mask)
    if (!opts.preview) {
      undo.change(boardKey(slots, emf, r, clockRC.batteryIn))
      paintClear()
      const gs = guideState(); guide?.update(gs); cues.sync(gs)
    }
  }
  /** The time module follows the committed board only. */
  const paintTime = () => { if (!preview) timeMod.update(result.cap, clockRC, mask) }
  const hudFocus = () => selected ?? linked ?? tourFocus
  const guideState = (): GuideState => ({
    emf, r, slots: committedSlots(), batteryIn: clockRC.batteryIn, b: result, selected, speed: clockRC.speed, waiting: gate === 'after',
    rc: result.cap ? { t: clockRC.t, tau: clockRC.tau, I0: clockRC.I0, V0: clockRC.V0, Voc: clockRC.Voc } : null,
  })
  const commit = (animateNums = true) => apply(committedSlots(), { preview: false, animate: animateNums })

  // ---------- moving along the capacitor's curve ----------
  const curveLive = () => !!result.cap && !preview && Number.isFinite(clockRC.tau) && clockRC.tau > 0
  /** The typeset equations re-render about 8 times a second, not on every step of the clock. */
  let panelDirty = false
  let panelNow = false
  /** The whole curve sampled through the solver, for jumping back and forth along it. One per curve. */
  let traceCache: { id: number; pts: RcClock['trace'] } | null = null
  const fullTrace = () => {
    if (traceCache?.id === curveId) return traceCache.pts
    const keep = capV
    const pts: RcClock['trace'] = []
    // out to 6τ (where Loop off stops), at the same spacing the live trace keeps (5τ / 240)
    for (let k = 0; k <= 288; k++) {
      const t = (5 * clockRC.tau * k) / 240
      capV = relaxVoltage(clockRC.V0, clockRC.Voc, clockRC.tau, t)
      const c = solveWith(shown).cap
      if (c) pts.push({ t, I: c.Ic, V: c.Vc })
    }
    capV = keep
    traceCache = { id: curveId, pts }
    return pts
  }
  /** Put the board at time t on this curve. `jump` (a drag or key) rebuilds the plotted trace up to t. */
  const setClock = (t: number, jump: boolean) => {
    const end = 6 * clockRC.tau
    clockRC.t = Math.max(0, Math.min(end, t))
    // at 6τ the curve is 0.25% from the end; land on the end exactly so no stray current stays on screen
    capV = clockRC.t >= end ? clockRC.Voc : relaxVoltage(clockRC.V0, clockRC.Voc, clockRC.tau, clockRC.t)
    result = solveWith(shown)
    const now = { t: clockRC.t, I: result.cap!.Ic, V: result.cap!.Vc }
    if (jump) {
      clockRC.trace = fullTrace().filter(p => p.t < clockRC.t)
      clockRC.trace.push(now)
    } else {
      const last = clockRC.trace[clockRC.trace.length - 1]
      const gap = (5 * clockRC.tau) / 240
      // a fast clock (25×, or a slow frame) moves many samples in one frame: the points it skipped come from the
      // same curve, so the trace keeps the curve's shape instead of cutting straight across it
      if (!last) clockRC.trace.push(now)
      else if (clockRC.t - last.t >= 2 * gap) {
        for (const p of fullTrace()) if (p.t > last.t + 1e-12 && p.t < clockRC.t - 1e-12) clockRC.trace.push(p)
        clockRC.trace.push(now)
      } else if (clockRC.t - last.t >= gap) clockRC.trace.push(now)
    }
    hud.update(result, shown, hudFocus(), false, true, mask)
    paintTime()
    guide?.update(guideState())
    panelDirty = true
    if (clockRC.t >= end) panelNow = true
  }
  /** A settled capacitor (the curve starts at its end voltage) has nothing to replay. The time module's own test. */
  const flatCurve = () => isFlat(clockRC.V0, clockRC.Voc)
  const loops = () => clockRC.loop && !flatCurve()
  /** Where the clock stops: 5τ (the end of the plots) when it loops, 6τ (landed exactly) when it plays once. */
  const curveEnd = () => (loops() ? 5 : 6) * clockRC.tau
  /**
   * Reset the capacitor, then play from t = 0. A charging curve starts again from an empty capacitor (a curve that
   * began partway, after a circuit change, becomes a fresh curve from 0 V); a draining curve starts again from the
   * charge it began with. Reset always plays, even from a pause.
   */
  const resetCurve = () => {
    if (!curveLive()) return
    clockRC.hold = 0
    clockRC.playing = true
    const charging = Math.abs(clockRC.Voc) > Math.abs(clockRC.V0) + 1e-9
    if (charging && Math.abs(clockRC.V0) > 1e-9) {
      capV = 0
      circuitKey = ''
      commit(false) // anchor() starts the new curve from empty and plays it
      return
    }
    clockRC.trace = []
    setClock(0, false)
    paintTime()
  }
  /** Drags in progress (the timeline and a plot can both be held); the play state comes back when the last ends. */
  let scrubs = 0
  let scrubWasPlaying = true

  // The status line keeps its text while it fades out, and a new message crossfades in (120 ms) instead of
  // jumping in place. The text is HTML from boardbar.ts or this file only.
  let statusHtml = ''
  let statusTimer = 0
  const setStatus = (html: string, warn: boolean) => {
    // the same message again while its crossfade is still pending: let that crossfade finish (clearing its timer here
    // left the old message on screen for good)
    if (html && html === statusHtml && statusEl.classList.contains('is-swap')) return
    window.clearTimeout(statusTimer)
    if (!html) {
      statusEl.classList.remove('is-on', 'is-swap')
      statusHtml = ''
      statusTimer = window.setTimeout(() => { if (!statusHtml) statusEl.innerHTML = '' }, reduce ? 0 : 300)
      return
    }
    const wasOn = statusEl.classList.contains('is-on') && statusEl.innerHTML !== ''
    if (html === statusHtml && wasOn) { statusEl.classList.remove('is-swap'); statusEl.classList.toggle('is-warn', warn); return }
    statusHtml = html
    const show = () => { statusEl.innerHTML = html; statusEl.classList.toggle('is-warn', warn); statusEl.classList.remove('is-swap'); statusEl.classList.add('is-on') }
    if (!wasOn || reduce) { show(); return }
    statusEl.classList.add('is-swap')
    statusTimer = window.setTimeout(show, 120)
  }
  const paintStatus = (slots: Slots) => {
    // a prediction keeps the status line empty: "open circuit" or "no current" would answer some questions
    if (mask.status) { setStatus('', false); return }
    const st = statusFor(result, slots, r, undo.inWindow && undoFrom === 'clear')
    setStatus(st.html, st.warn)
  }

  // ---------- HUD ----------
  const hud = createHud(() => reduce)
  $('.sim02-hud-slot').replaceWith(hud.el)
  const timeMod = createTimeModule({
    onBattery: v => { if (refused()) return; if (clockRC.batteryIn === v) return; clockRC.batteryIn = v; commit() },
    onSpeed: n => { if (refused()) return; clockRC.speed = n; paintTime(); cues.sync(guideState()) },
    onPlay: () => {
      if (refused()) return
      // Play on a clock held right after a change lets the curve run on from there
      if (gate === 'after') { releaseAfter(); clockRC.playing = true; clockRC.hold = 0; paintTime(); return }
      // Play at the end of a curve (Loop off, or a settled capacitor, stops there) resets the capacitor and plays
      if (!clockRC.playing && curveLive() && clockRC.t >= curveEnd() - 1e-9) { resetCurve(); return }
      // a capacitor with no curve (no loop through it, or only wire) has nothing to play
      if (!curveLive()) { paintTime(); return }
      clockRC.playing = !clockRC.playing
      clockRC.hold = 0
      paintTime()
    },
    onReset: () => { if (refused()) return; releaseAfter(); resetCurve() },
    onLoop: () => {
      if (refused()) return
      clockRC.loop = !clockRC.loop
      clockRC.hold = 0
      // Loop on shortens the curve to 5τ: a clock past 5τ moves back to 5τ, so the time and the board agree
      if (curveLive() && clockRC.t > curveEnd()) setClock(curveEnd(), true)
      paintTime()
    },
    onScrub: (t, phase) => {
      if (phase === 'start' || phase === 'key') { if (refused()) return }
      else if (locked()) return
      if (phase !== 'end') releaseAfter()
      // dragging holds the clock still; letting go goes back to playing if the clock was playing. The play state
      // comes back even when the curve stopped being live mid-drag (the capacitor left, a part is hovering).
      if (phase === 'start') {
        if (!curveLive()) return
        if (scrubs++ === 0) scrubWasPlaying = clockRC.playing
        clockRC.playing = false
      }
      // an arrow key on the timeline pauses the clock, so the keyed moment stays put (Play runs on from there)
      if (phase === 'key' && curveLive()) clockRC.playing = false
      if (phase === 'end') {
        if (scrubs === 0) return
        if (--scrubs === 0) clockRC.playing = scrubWasPlaying
      }
      if (!curveLive()) return
      clockRC.hold = 0
      // the right end of the timeline is the end of the curve: 5τ with Loop on, 6τ with Loop off. The last 1% of
      // the window snaps to the end (setClock lands 6τ exactly, so no stray current stays on screen); a key step
      // (0.1τ) back from the end lands outside that 1%
      const end = curveEnd()
      setClock(t >= 0.99 * end ? end : t, true)
      if (phase === 'end') paintTime()
    },
  }, () => reduce)
  $('.sim02-time-slot').replaceWith(timeMod.el)
  $('.bb-clock').appendChild(timeMod.transport)

  // ---------- panel ----------
  const panel: Panel = createPanel(id => setLinked(id), () => reduce)
  $('.sim02-eqs-slot').replaceWith(panel.el)
  /** Drop the hover link (if any) without a repaint when there is nothing to drop. */
  const unlink = () => { if (linked !== null) setLinked(null) }
  const setLinked = (id: SlotId | null) => {
    linked = id
    for (const [sid, p] of pieces) p.view.setHighlight(sid === id || sid === selected)
    panel.setLinked(id)
    labelEls.forEach((l, sid) => l.classList.toggle('is-linked', sid === id))
    hud.update(result, shown, hudFocus(), true, false, mask)
  }
  const partName = (slots: Slots, id: SlotId) => (slots[id]?.kind === 'capacitor' ? 'C' : SUB[id]!)

  // ---------- battery sliders ----------
  const syncSliders = () => {
    emfIn.value = String(emf)
    rIn.value = String(r)
    $('output[data-for=emf]').textContent = `${sig3(emf)} V`
    $('output[data-for=r]').textContent = `${exact(r)} Ω`
    emfIn.setAttribute('aria-valuetext', `${sig3(emf)} ${unitWord(emf, 'volt')}`)
    rIn.setAttribute('aria-valuetext', `${exact(r)} ${unitWord(r, 'ohm')}`)
  }
  // mid-drag, keep showing the preview of the part in hand
  // while predicting the sliders stay where they are (the input snaps back) and say why
  const onEmf = () => { if (locked()) { syncSliders(); refuse(); return } emf = Number(emfIn.value); syncSliders(); if (drag) updatePreview(); else commit() }
  const onR = () => { if (locked()) { syncSliders(); refuse(); return } r = Number(rIn.value); syncSliders(); if (drag) updatePreview(); else commit() }
  emfIn.addEventListener('input', onEmf)
  rIn.addEventListener('input', onR)
  syncSliders()

  // ---------- labels over the board ----------
  const labelEls = new Map<SlotId, HTMLDivElement>()
  /** Where each label hangs from its anchor point (matches the CSS translate): above, below, to the left, to the right. */
  type LabelMode = 'top' | 'below' | 'side' | 'right' | 'center'
  const labelMode = new Map<HTMLElement, LabelMode>()
  for (const id of SLOT_IDS) {
    const l = document.createElement('div')
    l.className = 'sim02-label'
    l.dataset.slot = id
    labelMode.set(l, 'top')
    if (SLOTS[id].vertical) { l.classList.add('is-side'); labelMode.set(l, 'side') }
    if (id === 'R3' || id === 'R4') { l.classList.add('is-below'); labelMode.set(l, 'below') }
    labelsEl.appendChild(l)
    labelEls.set(id, l)
  }
  const junctionEls: [HTMLDivElement, Pt][] = (['B', 'C'] as const).map(name => {
    const d = document.createElement('div')
    d.className = 'sim02-junction'
    d.textContent = name
    labelsEl.appendChild(d)
    return [d, NODES[name === 'B' ? 6 : 15]!] as [HTMLDivElement, Pt]
  })
  const battLabel = document.createElement('div')
  battLabel.className = 'sim02-batt-label'
  labelMode.set(battLabel, 'right')
  labelsEl.appendChild(battLabel)
  const plusEl = document.createElement('div')
  plusEl.className = 'sim02-terminal'
  plusEl.textContent = '+'
  const minusEl = document.createElement('div')
  minusEl.className = 'sim02-terminal'
  minusEl.textContent = '−'
  labelsEl.append(plusEl, minusEl)

  let battHtml = ''
  const paintLabels = () => {
    for (const id of SLOT_IDS) {
      const l = labelEls.get(id)!
      // the labels follow the board on screen: while a part hovers over a slot that is the previewed board (a part
      // held right over the socket it came from previews the committed board, so its label keeps its reading)
      const part = shown[id]
      const rd = result.slots[id]
      // a capacitor goes by its slot too ("R₃ 0.5 F"): the only C on the board is the junction
      const name = `<b>${SUB[id]}</b>`
      if (!part) {
        const html = `${name}<span class="sim02-label-empty">empty</span>`
        if (l.dataset.html !== html) { l.innerHTML = html; l.dataset.html = html; l.classList.add('is-empty') }
        continue
      }
      l.classList.remove('is-empty')
      const val = part.kind === 'wire' ? 'wire' : part.kind === 'resistor' ? `${exact(part.ohms)} Ω` : `${exact(part.farads)} F`
      // a prediction can cover either half of the reading ("? V")
      const isC = part.kind === 'capacitor'
      const qI = mask.get(isC ? [`I@${id}`, 'Ic'] : [`I@${id}`], 'label') === 'hide'
      const qV = mask.get(isC ? [`V@${id}`, 'Vc'] : [`V@${id}`], 'label') === 'hide'
      const Q = (u: string) => `<span class="sim02-q">? ${u}</span>`
      const rI = qI ? Q('A') : !Number.isFinite(rd?.I ?? 0) ? 'undefined' : reading(rd?.I ?? 0, 'A')
      const read = !rd ? '' : part.kind === 'wire' ? rI : `${rI}, ${qV ? Q('V') : reading(rd.V, 'V')}`
      // the reading changes every frame on a curve: change its text in place, so the span (and its fade-in) stays
      const shell = `<span class="sim02-label-top">${name}<span class="sim02-label-val">${val}</span></span>${read ? '<span class="sim02-label-read"></span>' : ''}`
      if (l.dataset.html !== shell) { l.innerHTML = shell; l.dataset.html = shell }
      const rdEl = read ? l.lastElementChild as HTMLElement : null
      if (rdEl && rdEl.dataset.read !== read) { rdEl.innerHTML = read; rdEl.dataset.read = read }
    }
    const bh = result.batteryOut ? 'Battery out' : `<i>ε</i> = ${sig3(emf)} V${r > 0 ? `<br><i>r</i> = ${exact(r)} Ω` : ''}`
    if (bh !== battHtml) { battLabel.innerHTML = bh; battHtml = bh }
  }

  // ---------- slot buttons (keyboard and tap-to-place) ----------
  const slotBtns = new Map<SlotId, HTMLButtonElement>()
  for (const id of SLOT_IDS) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sim02-slotbtn'
    b.dataset.slot = id
    slotsEl.appendChild(b)
    slotBtns.set(id, b)
    b.addEventListener('click', e => onSlotButton(id, e.detail === 0))
    // the keyboard lights the slot's symbols in the equations, the way pointing at the part does
    b.addEventListener('focus', () => { if (b.matches(':focus-visible')) { hud.quiet(true); setLinked(id) } })
    b.addEventListener('blur', () => { if (linked === id) setLinked(null); hud.quiet(false) })
    b.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && pieces.has(id)) { e.preventDefault(); if (!refused()) removeFromSlot(id) }
    })
  }
  const paintSlotButtons = (slots: Slots) => {
    for (const id of SLOT_IDS) {
      const p = slots[id]
      const rd = result.slots[id]
      // the part's reading, as on its board label ("1.50 A, 9.00 V"), minus anything a prediction covers
      const isC = p?.kind === 'capacitor'
      const showI = !!rd && mask.get(isC ? [`I@${id}`, 'Ic'] : [`I@${id}`], 'label') !== 'hide'
      const showV = !!rd && p?.kind !== 'wire' && mask.get(isC ? [`V@${id}`, 'Vc'] : [`V@${id}`], 'label') !== 'hide'
      const read = [showI ? (Number.isFinite(rd!.I) ? reading(rd!.I, 'A') : 'the current is undefined') : '', showV ? reading(rd!.V, 'V') : ''].filter(Boolean).join(', ')
      const what = !p ? 'empty' : `${partLabel(p)}${read ? `, ${read}` : ''}`
      const action = holding ? `Press to place the ${partLabel(holding)} here.` : p ? `Press to change or remove the ${partLabel(p)}.` : 'Pick a part from the tray first.'
      const label = `Slot ${SUB[id]}, ${what}. ${action}`
      const b = slotBtns.get(id)!
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label)
    }
  }
  const onSlotButton = (id: SlotId, fromKey: boolean) => {
    if (holding) {
      if (blockCap(holding, id)) return
      placeFromTray(holding, id); endHold(); commit()
      // a tap or a click leaves no focus ring behind on the board
      if (!fromKey) slotBtns.get(id)?.blur()
      return
    }
    if (pieces.has(id)) select(id, fromKey)
    else flashTray()
  }
  const flashTray = () => {
    if (reduce) return
    trayEl.querySelectorAll('.sim02-chip').forEach((c, k) => run(animate(c, { y: [0, -8, 0] }, { duration: 0.4, delay: k * 0.04 })))
  }

  // ---------- tray ----------
  TRAY.forEach(item => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sim02-chip'
    if (item.part.kind === 'resistor') {
      const bands = colorBands(item.part.ohms).map(n => `<span style="background:${BAND_HEX[n]}"></span>`).join('')
      b.innerHTML = `<span class="sim02-chip-art is-resistor" aria-hidden="true"><span class="sim02-chip-body">${bands}<span style="background:${BAND_HEX.gold}"></span></span></span><span class="sim02-chip-label">${item.label}<span class="sim02-sr"> resistor</span></span>`
    } else if (item.part.kind === 'capacitor') {
      b.innerHTML = `<span class="sim02-chip-art is-cap" aria-hidden="true"><span></span><span></span></span><span class="sim02-chip-label">${item.label}<span class="sim02-sr"> capacitor</span></span>`
      b.dataset.cap = '1'
    } else {
      b.innerHTML = `<span class="sim02-chip-art is-wire" aria-hidden="true"><svg viewBox="0 0 60 24"><path d="M4 20 Q30 -6 56 20" /></svg></span><span class="sim02-chip-label">Wire<span class="sim02-sr">, 0 Ω</span></span>`
    }
    b.dataset.part = item.part.kind === 'resistor' ? String(item.part.ohms) : item.part.kind === 'wire' ? 'wire' : 'cap'
    trayEl.appendChild(b)
    b.addEventListener('pointerdown', e => onChipDown(e, item.part, b))
    b.addEventListener('click', e => {
      // pointer taps are handled in onChipDown/up; this is the keyboard path
      if ((e as MouseEvent).detail === 0) startHold(item.part, b, 'key')
    })
  })

  // only one capacitor at a time: its chip greys out while a capacitor is on the board. aria-disabled, not disabled,
  // so the chip stays in the Tab order and a press (blockCap) says why on the status line
  const paintTray = () => {
    const capChip = trayEl.querySelector<HTMLButtonElement>('[data-cap]')
    if (!capChip) return
    const on = capOnBoard()
    if (capChip.disabled) capChip.disabled = false
    capChip.classList.toggle('is-full', on)
    // a prediction's lock also marks every chip aria-disabled; that mark stays until the lock lifts
    if (on) capChip.setAttribute('aria-disabled', 'true')
    else if (capChip.getAttribute('aria-describedby') !== 'sim02-lock-note') capChip.removeAttribute('aria-disabled')
    capChip.title = on ? 'One capacitor at a time: take the capacitor on the board off first.' : ''
  }

  /** Only one capacitor fits on the board (the solver models one). Says why and returns true when this one can't go. */
  const ONE_CAP = 'One capacitor at a time. Take the capacitor off the board first.'
  const blockCap = (part: Part, into?: SlotId) => {
    if (part.kind !== 'capacitor') return false
    const other = [...pieces].some(([id, p]) => id !== into && p.view.part.kind === 'capacitor' && !p.dead)
    if (!other) return false
    const at = [...pieces].find(([, p]) => p.view.part.kind === 'capacitor' && !p.dead)?.[0]
    setStatus(at ? `One capacitor at a time. Take the capacitor in ${SUB[at]} off the board first.` : ONE_CAP, false)
    return true
  }
  type HoldFrom = 'touch' | 'mouse' | 'key'
  const startHold = (part: Part, chip: HTMLButtonElement, from: HoldFrom) => {
    if (refused()) return
    if (holdingChip === chip) { endHold(); return }
    if (blockCap(part)) return
    endHold()
    deselect()
    holding = part
    holdingChip = chip
    chip.classList.add('is-holding')
    chip.setAttribute('aria-pressed', 'true')
    el.classList.add('is-holding')
    paintSlotButtons(committedSlots())
    const name = partLabel(part)
    setStatus(from === 'key'
      ? `Pick a slot for the ${name} with Tab and press Enter. Press Escape to cancel.`
      : from === 'mouse'
        ? `Click a slot on the board for the ${name}. Click the ${name} in the tray again to cancel.`
        : `Tap a slot on the board for the ${name}. Tap the ${name} in the tray again to cancel.`, false)
    // the keyboard goes to a slot: the one the tour asks for, else the first empty one. A tap or click leaves focus alone.
    if (from === 'key') {
      const target = (inTour ? SLOT_IDS.find(id => cues.role(id) === 'do') : undefined) ?? SLOT_IDS.find(id => !pieces.has(id)) ?? 'R1'
      slotBtns.get(target)!.focus({ preventScroll: true })
    }
  }
  const endHold = () => {
    if (!holding) return
    holding = null
    holdingChip?.classList.remove('is-holding')
    holdingChip?.removeAttribute('aria-pressed')
    holdingChip = null
    el.classList.remove('is-holding')
    paintSlotButtons(committedSlots())
    paintStatus(committedSlots())
  }

  // ---------- pointer helpers ----------
  const ndc = new THREE.Vector2()
  const toNdc = (cx: number, cy: number) => {
    const rect = canvas.getBoundingClientRect()
    ndc.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1)
    return ndc
  }
  const slotDist = (p: Pt, id: SlotId) => {
    const c = SLOTS[id].center
    const dx = SLOTS[id].vertical ? p.x - c.x : Math.max(0, Math.abs(p.x - c.x) - SOCKET_HALF)
    const dz = SLOTS[id].vertical ? Math.max(0, Math.abs(p.z - c.z) - SOCKET_HALF) : p.z - c.z
    return Math.hypot(dx, dz)
  }
  const nearestSlot = (p: Pt, exclude: Piece) => {
    let best: SlotId | null = null
    let bd = Infinity
    for (const id of SLOT_IDS) {
      const d = slotDist(p, id)
      if (d < bd && pieces.get(id) !== exclude) { bd = d; best = id }
    }
    return { id: best, d: bd }
  }

  // ---------- dragging ----------
  const beginDrag = (piece: Piece, e: PointerEvent, from: SlotId | null, fromTray: boolean, captureEl: HTMLElement) => {
    endHold()
    deselect()
    if (hovered === piece) { hovered = null; unlink() }
    drag = { piece, pointerId: e.pointerId, from, fromTray, startX: e.clientX, startY: e.clientY, moved: fromTray, lockSlot: from, near: null, captureEl }
    captureEl.setPointerCapture(e.pointerId)
    piece.ty.set(REST_Y + (fromTray ? LIFT : 0.3))
    squish(piece, 0.85)
    run(animate(piece.scale, 1.08, { type: 'spring', stiffness: 400, damping: 18 }))
    wrap.classList.add('is-dragging')
  }

  const moveDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const d = drag
    const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
    if (!d.moved && dist < 6) return
    if (!d.moved) {
      d.moved = true
      // the part has left its socket: the circuit changes right now
      if (d.from) { pieces.delete(d.from); loose.add(d.piece); d.piece.slot = null; d.lockSlot = null; updatePreview() }
    }
    const p = sc.boardPoint(toNdc(e.clientX, e.clientY), REST_Y)
    if (!p) return
    // Two magnet points. The pointer's spot on the board, and the spot the floating part appears to be over:
    // the part is drawn LIFT above the pointer's spot, and from the camera's angle that reads as further up
    // the board. Measured from where the part floats with no pull, so the pull never feeds back into it.
    const seen = sc.groundUnder(p.x, REST_Y + LIFT, p.z) ?? p
    const byPointer = nearestSlot(p, d.piece)
    const bySight = nearestSlot(seen, d.piece)
    const useSight = bySight.d < byPointer.d
    let { id, d: dd } = useSight ? bySight : byPointer
    let lock: SlotId | null = null
    // a latched part holds on a little longer before letting go, unless another socket is clearly closer
    const held = d.lockSlot && d.moved && pieces.get(d.lockSlot) !== d.piece ? d.lockSlot : null
    if (held) {
      const dl = Math.min(slotDist(p, held), slotDist(seen, held))
      if (dl < LOCK * HOLD && (id === held || dd > dl * 0.7)) { id = held; dd = dl; lock = held }
    }
    if (!lock && id && dd < LOCK) lock = id
    let tx = p.x, tz = p.z, ty = REST_Y + LIFT
    if (lock) {
      const c = SLOTS[lock].center
      tx = c.x; tz = c.z; ty = REST_Y + 0.28
    } else if (id && dd < MAGNET) {
      const c = SLOTS[id].center
      // the pull grows smoothly as you get closer: the magnet feel. It closes the gap between the socket and
      // whichever magnet point is nearer, so the part slides toward the socket the way the student sees it.
      const from = useSight ? seen : p
      const u = 1 - (dd - LOCK) / (MAGNET - LOCK)
      const pull = u * u * (3 - 2 * u) * 0.55
      tx = p.x + (c.x - from.x) * pull
      tz = p.z + (c.z - from.z) * pull
      ty = REST_Y + LIFT - pull * 0.5
    }
    d.near = id && dd < MAGNET ? id : null
    d.piece.tx.set(tx); d.piece.tz.set(tz); d.piece.ty.set(ty)
    if (lock !== d.lockSlot) {
      d.lockSlot = lock
      if (lock) {
        d.piece.tr.set(SLOTS[lock].vertical ? Math.PI / 2 : 0)
        squish(d.piece, 0.86)
        // a drag doesn't count as a tap, so before the first tap the browser refuses (and logs) a vibrate
        if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.(8)
      } else {
        d.piece.tr.set(0)
      }
      updatePreview()
    }
  }

  /** While dragging, show what the circuit would be if you let go right now. */
  const updatePreview = () => {
    if (!drag || locked()) return
    const s = committedSlots()
    const lock = drag.lockSlot
    if (lock) {
      // a part already there swaps to where this one came from (or leaves the board)
      const occupant = pieces.get(lock)
      if (occupant && drag.from) s[drag.from] = occupant.view.part
      s[lock] = drag.piece.view.part
    }
    // the bar says what the release does: a part held off the board leaves it, a tray part over no slot goes back
    pill.textContent = lock ? `Release to place the part in ${SUB[lock]}`
      : drag.from ? `Release to remove ${SUB[drag.from]}` : 'Release to return the part to the tray'
    apply(s, { preview: true })
  }

  const endDrag = (e: PointerEvent, cancelled = false) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const d = drag
    drag = null
    if (d.captureEl.hasPointerCapture(e.pointerId)) d.captureEl.releasePointerCapture(e.pointerId)
    wrap.classList.remove('is-dragging')
    run(animate(d.piece.scale, 1, { type: 'spring', stiffness: 400, damping: 18 }))
    if (cancelled) {
      // the system took the touch away (a gesture, a call): nobody chose to drop it, so put it back
      if (d.from && (!pieces.has(d.from) || pieces.get(d.from) === d.piece)) {
        loose.delete(d.piece); pieces.set(d.from, d.piece); d.piece.slot = d.from; sendTo(d.piece, d.from)
      } else poof(d.piece)
      commit()
      return
    }

    if (!d.moved && d.from) {
      // a tap: drop it back and open its dial
      sendTo(d.piece, d.from)
      squish(d.piece)
      select(d.from)
      return
    }
    if (!d.moved && d.fromTray) return
    const lock = d.lockSlot
    let turned: SlotId | null = null
    // never a second capacitor (the chip is blocked before a drag starts; this is the last guard)
    if (lock && d.fromTray && blockCap(d.piece.view.part, lock)) { poof(d.piece); commit(); return }
    if (lock) {
      const occupant = pieces.get(lock)
      if (occupant) {
        if (d.from) {
          if (occupant.view.part.kind === 'capacitor' && SLOTS[d.from].vertical !== SLOTS[lock].vertical) { capV = -capV; turned = d.from }
          pieces.set(d.from, occupant); occupant.slot = d.from
          sendTo(occupant, d.from); occupant.ty.set(REST_Y + 1.2); later(160, () => occupant.ty.set(REST_Y))
          jiggle(occupant)
        } else {
          pieces.delete(lock); poof(occupant)
        }
      }
      loose.delete(d.piece)
      pieces.set(lock, d.piece)
      d.piece.slot = lock
      // V_C is measured from the slot's a end; the vertical slot turns the piece so its a end is the other
      // plate. Flip the sign so the charge stays on the same plates.
      if (d.piece.view.part.kind === 'capacitor' && d.from && SLOTS[d.from].vertical !== SLOTS[lock].vertical) { capV = -capV; turned = lock }
      sendTo(d.piece, lock)
      squish(d.piece, 0.62)
      jiggle(d.piece, 0.1)
      ringPulse(lock)
      selected = null
      commit()
      if (turned) sayTurned(turned)
    } else {
      poof(d.piece)
      commit()
    }
  }

  /**
   * A charged capacitor moved between a level slot and the standing R₅ slot ends up turned around: its + plate now
   * faces the other way around the loop. In every slot the a end is where conventional current goes in, so a
   * positive V_C pushes back on the battery and a negative one pushes the same way.
   */
  const sayTurned = (id: SlotId) => {
    const v = result.cap?.id === id ? result.cap.Vc : 0
    if (Math.abs(v) < 1e-3 || mask.status) return
    setStatus(result.batteryOut
      ? "You turned the charged capacitor around, so the capacitor's + plate now faces the other way."
      : `You turned the charged capacitor around, so the capacitor's voltage now ${v < 0 ? 'adds to' : 'opposes'} the battery's emf.`, false)
  }

  // ---------- canvas input ----------
  const onWrapDown = (e: PointerEvent) => {
    if (drag) return // one part at a time: a second finger never steals the drag
    if (e.target !== canvas) return
    if (e.button !== 0) return
    const hit = sc.pickPiece(toNdc(e.clientX, e.clientY), [...pieces.values()].map(p => p.view))
    if (!hit) {
      if (sc.pickBattery(ndc)) { e.stopPropagation(); emfIn.focus(); jiggleBattery(); return }
      if (holding) return // let them orbit; slot buttons place
      deselect()
      return // OrbitControls takes it from here
    }
    e.stopPropagation() // keep OrbitControls out of it
    e.preventDefault()
    const piece = [...pieces.values()].find(p => p.view === hit)!
    // while predicting a tap still selects the part (its readouts show, its dial stays greyed); a drag is refused
    if (locked()) { if (piece.slot) select(piece.slot); lockedPress = { id: e.pointerId, x: e.clientX, y: e.clientY, said: false }; return }
    beginDrag(piece, e, piece.slot, false, wrap)
  }
  let lockedPress: { id: number; x: number; y: number; said: boolean } | null = null
  const onWrapMove = (e: PointerEvent) => {
    if (lockedPress && e.pointerId === lockedPress.id) {
      if (!lockedPress.said && Math.hypot(e.clientX - lockedPress.x, e.clientY - lockedPress.y) > 6) { lockedPress.said = true; refuse() }
      return
    }
    if (drag) { moveDrag(e); return }
    if (e.pointerType !== 'mouse') return
    // over anything but the canvas (a label, the dial, the HUD, the bar) the mouse points at no part
    const hit = e.target === canvas ? sc.pickPiece(toNdc(e.clientX, e.clientY), [...pieces.values()].map(p => p.view)) : null
    const p = hit ? [...pieces.values()].find(q => q.view === hit) ?? null : null
    if (p !== hovered) {
      hovered = p
      wrap.classList.toggle('is-grabbable', !!p)
      if (p) { jiggle(p, 0.08); run(animate(p.scale, [1, 1.06, 1.03], { duration: 0.35 })) }
      for (const q of pieces.values()) if (q !== p) run(animate(q.scale, 1, { duration: 0.2 }))
      setLinked(p?.slot ?? null)
    }
  }
  const onWrapUp = (e: PointerEvent) => { if (lockedPress?.id === e.pointerId) lockedPress = null; endDrag(e, e.type === 'pointercancel') }
  /** The mouse left the board: no part is pointed at any more. */
  const onWrapLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || drag || !hovered) return
    hovered = null
    wrap.classList.remove('is-grabbable')
    for (const q of pieces.values()) run(animate(q.scale, 1, { duration: 0.2 }))
    unlink()
  }
  wrap.addEventListener('pointerleave', onWrapLeave)
  wrap.addEventListener('pointerdown', onWrapDown, { capture: true })
  wrap.addEventListener('pointermove', onWrapMove)
  wrap.addEventListener('pointerup', onWrapUp)
  wrap.addEventListener('pointercancel', onWrapUp)

  let batteryKick = 0
  /** 0: battery in; 1: battery out (slid BATTERY_SLIDE board units in off the rail, ghosted). */
  let outK = 0
  const BATTERY_SLIDE = 1.15
  const jiggleBattery = () => {
    if (reduce) return
    const o = { k: 1 }
    run(animate(o, { k: 0 }, { duration: 0.6, onUpdate: () => { batteryKick = o.k } })).then(() => { batteryKick = 0 })
  }

  // ---------- tray chips: drag out, or tap to hold ----------
  const onChipDown = (e: PointerEvent, part: Part, chip: HTMLButtonElement) => {
    if (e.button !== 0 || drag) return
    e.preventDefault()
    if (refused()) {
      // a drag that ends somewhere else (onto a slot) hears the same answer when it lets go
      const x0 = e.clientX, y0 = e.clientY
      // a touch that turns into a scroll ends in pointercancel: that takes the listeners off too, with no answer
      const up = (ev: PointerEvent) => {
        if (ev.pointerId !== e.pointerId) return
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (ev.type === 'pointerup' && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6 && locked()) refuse()
      }
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
      return
    }
    // the greyed capacitor chip still gets pointer events: no drag and no hold, and the status line says why
    if (blockCap(part)) return
    const startX = e.clientX, startY = e.clientY
    let started: Piece | null = null
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
        const at = sc.boardPoint(toNdc(ev.clientX, ev.clientY), REST_Y) ?? { x: 0, z: 3 }
        started = makePiece(part, at, REST_Y + LIFT + 0.6)
        started.scale.set(0.4)
        loose.add(started)
        if (part.kind === 'resistor') started.view.setOhms(part.ohms)
        beginDrag(started, ev, null, true, chip)
        run(animate(chip, { scale: [0.9, 1] }, { type: 'spring', stiffness: 500, damping: 14 }))
      }
      moveDrag(ev)
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return
      chip.removeEventListener('pointermove', move)
      chip.removeEventListener('pointerup', up)
      chip.removeEventListener('pointercancel', up)
      if (chip.hasPointerCapture(ev.pointerId)) chip.releasePointerCapture(ev.pointerId)
      if (started) endDrag(ev, ev.type === 'pointercancel')
      else if (ev.type === 'pointerup') startHold(part, chip, ev.pointerType === 'mouse' ? 'mouse' : 'touch')
    }
    chip.setPointerCapture(e.pointerId)
    chip.addEventListener('pointermove', move)
    chip.addEventListener('pointerup', up)
    chip.addEventListener('pointercancel', up)
  }

  const placeFromTray = (part: Part, id: SlotId, delayMs = 0) => {
    const c = SLOTS[id].center
    const p = makePiece(part, { x: c.x, z: c.z + 0.4 }, REST_Y + 2.6)
    p.scale.set(0.5)
    p.tr.set(SLOTS[id].vertical ? Math.PI / 2 : 0)
    p.r.jump(SLOTS[id].vertical ? Math.PI / 2 : 0)
    const old = pieces.get(id)
    if (old) { pieces.delete(id); poof(old) }
    pieces.set(id, p)
    p.slot = id
    p.view.group.visible = delayMs === 0
    const land = () => {
      if (p.dead) return // taken off the board before it landed (a second preset click)
      p.view.group.visible = true
      sendTo(p, id)
      run(animate(p.scale, 1, { type: 'spring', stiffness: 380, damping: 16 }))
      p.landing = id
    }
    if (delayMs) { landTimers++; later(delayMs, () => { landTimers--; land() }) }
    else land()
    return p
  }

  // ---------- selection and the value dial ----------
  /** The tapped part's label shows its reading (phones hide readings otherwise). */
  const paintSel = () => labelEls.forEach((l, sid) => l.classList.toggle('is-sel', sid === selected))
  /** Open a part's dial. `focus`: the dial was opened from the keyboard, so the keyboard goes to its value. */
  const select = (id: SlotId, focus = false) => {
    endHold()
    selected = id
    for (const [sid, p] of pieces) p.view.setHighlight(sid === id || sid === linked)
    paintSel()
    renderPop(focus)
    commit(false)
  }
  /** Close the dial; a docked dial hands the bar band back to the board bar. */
  const hidePop = () => {
    pop.hidden = true
    pop.classList.remove('is-docked')
    bar.inert = false
    bar.classList.remove('is-under')
  }
  const deselect = () => {
    if (!selected) return
    selected = null
    hidePop()
    paintSel()
    for (const [sid, p] of pieces) p.view.setHighlight(sid === linked)
    commit(false)
  }
  let popPlace = ''
  /** `focus`: true moves the keyboard to the dial's value (arrow keys step it); 'keep' does so only if focus was in the dial. */
  const renderPop = (focus: boolean | 'keep' = false) => {
    const hadFocus = pop.contains(document.activeElement)
    const p = selected ? pieces.get(selected) : null
    if (!p || !selected) { hidePop(); return }
    const id = selected
    const part = p.view.part
    // phones and short landscape screens: one row in the bar band, under the board; the bar steps aside meanwhile
    const docked = dockedMq.matches
    pop.hidden = false
    pop.classList.toggle('is-docked', docked)
    bar.inert = docked
    bar.classList.toggle('is-under', docked)
    if (docked) { pop.style.left = ''; pop.style.top = ''; pop.classList.remove('is-below', 'is-right', 'is-left'); popPlace = '' }
    const remove = (long: string, short: string) => `<button type="button" class="sim02-pop-remove">Remove ${docked ? short : long}</button>`
    const dial = (name: string, label: string, what: string, unitName: string, unit: string, steps: readonly number[], value: number) => {
      const out = `<output role="spinbutton" tabindex="0" aria-label="${label}" aria-valuemin="${steps[0]}" aria-valuemax="${steps[steps.length - 1]}" aria-valuenow="${value}" aria-valuetext="${exact(value)} ${unitWord(value, unitName)}">${exact(value)} ${unit}</output>`
      return `${docked ? '' : `<p class="sim02-pop-name">${name}</p>`}
         <div class="sim02-dial" role="group" aria-label="${label}">
           <button type="button" data-step="-1" aria-label="Lower ${what}">−</button>
           ${docked ? `<span class="sim02-pop-name" aria-hidden="true">${name}</span>` : ''}${out}
           <button type="button" data-step="1" aria-label="Higher ${what}">+</button>
         </div>`
    }
    pop.innerHTML = part.kind === 'resistor'
      ? dial(SUB[id]!, `Resistance of ${SUB[id]}`, `the resistance of ${SUB[id]}`, 'ohm', 'Ω', OHM_STEPS, part.ohms) + remove(SUB[id]!, SUB[id]!)
      : part.kind === 'capacitor'
        ? dial(docked ? 'C' : 'Capacitor', 'Capacitance of the capacitor', 'the capacitance', 'farad', 'F', FARAD_STEPS, part.farads)
          + `<button type="button" class="sim02-pop-empty">${docked ? 'Discharge' : 'Discharge the capacitor'}</button>` + remove('the capacitor', 'C')
        : `<p class="sim02-pop-name">Wire in ${SUB[id]}</p>${docked ? '' : '<p class="sim02-small">Wires are 0 Ω and have no setting.</p>'}${remove('the wire', 'the wire')}`
    if (!reduce) run(animate(pop, { scale: [docked ? 0.9 : 0.6, 1], opacity: [0, 1] }, { type: 'spring', stiffness: 420, damping: 20 }))
    pop.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(b => b.addEventListener('click', () => stepOhms(Number(b.dataset.step))))
    pop.querySelector<HTMLButtonElement>('.sim02-pop-remove')!.addEventListener('click', () => removeFromSlot(id))
    pop.querySelector<HTMLButtonElement>('.sim02-pop-empty')?.addEventListener('click', emptyCap)
    paintEmpty()
    paintPopLock()
    // the value takes the keyboard (its arrow keys step it), never the − button; a tap or the tour leaves focus alone
    if (focus === true || (focus === 'keep' && hadFocus)) (pop.querySelector<HTMLElement>('[role=spinbutton]') ?? pop.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true })
  }
  const onDockedChange = () => { if (selected && !pop.hidden) renderPop('keep') }
  dockedMq.addEventListener('change', onDockedChange)
  /** Empty the capacitor: a charging curve resets to an empty capacitor and plays (the same as Reset); otherwise the plates go to 0 V now. */
  const emptyCap = () => {
    if (refused()) return
    const b = pop.querySelector<HTMLButtonElement>('.sim02-pop-empty')
    if (!b || b.getAttribute('aria-disabled') === 'true' || !result.cap) return
    const charging = Math.abs(clockRC.Voc) > Math.abs(clockRC.V0) + 1e-9
    if (curveLive() && charging) resetCurve()
    else { capV = 0; circuitKey = ''; commit(false) }
    paintEmpty()
  }
  const paintEmpty = () => {
    const b = pop.hidden ? null : pop.querySelector<HTMLButtonElement>('.sim02-pop-empty')
    if (!b || locked()) return
    const settled = flatCurve() || clockRC.t >= curveEnd() - 1e-9
    const off = String(emptyDisabled(result.cap?.Vc ?? 0, clockRC.playing, curveLive(), settled))
    if (b.getAttribute('aria-disabled') !== off) b.setAttribute('aria-disabled', off)
  }
  const stepOhms = (dir: number) => {
    if (!selected || refused()) return
    const p = pieces.get(selected)
    if (!p) return
    const part = p.view.part
    if (part.kind === 'wire') return
    const steps = part.kind === 'resistor' ? OHM_STEPS : FARAD_STEPS
    const now = part.kind === 'resistor' ? part.ohms : part.farads
    const k = steps.indexOf(now)
    const next = steps[Math.max(0, Math.min(steps.length - 1, (k < 0 ? 0 : k) + dir))]!
    if (next === now) { jiggle(p, 0.05); return }
    if (part.kind === 'resistor') p.view.setOhms(next)
    else {
      // the charge on the plates stays put when C changes, so V_C = q/C changes instead
      capV *= now / next
      part.farads = next
    }
    squish(p, dir > 0 ? 0.8 : 1.18)
    jiggle(p, 0.06)
    const out = pop.querySelector('output')!
    const unit = part.kind === 'resistor' ? ['Ω', 'ohm'] : ['F', 'farad']
    out.textContent = `${exact(next)} ${unit[0]}`
    out.setAttribute('aria-valuenow', String(next))
    out.setAttribute('aria-valuetext', `${exact(next)} ${unitWord(next, unit[1]!)}`)
    commit()
  }
  const removeFromSlot = (id: SlotId) => {
    if (refused()) return
    const p = pieces.get(id)
    if (!p) return
    pieces.delete(id)
    poof(p)
    if (selected === id) { selected = null; hidePop(); paintSel() }
    commit()
    // the keyboard stays on the board at the emptied slot, unless the press came from somewhere else (the tour)
    if (pop.contains(document.activeElement) || slotsEl.contains(document.activeElement)) slotBtns.get(id)?.focus({ preventScroll: true })
  }
  const onPopKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === '+' || e.key === '=') { e.preventDefault(); stepOhms(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); stepOhms(-1) }
    else if (e.key === 'Escape') { const id = selected; deselect(); if (id) slotBtns.get(id)?.focus() }
  }
  pop.addEventListener('keydown', onPopKey)
  const onRootKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    // Escape drops a held part, and the keyboard goes back to the chip it came from
    const chip = holdingChip
    endHold()
    deselect()
    if (chip && document.activeElement && slotsEl.contains(document.activeElement)) chip.focus({ preventScroll: true })
  }
  el.addEventListener('keydown', onRootKey)

  // ---------- presets ----------
  const loadSlots = (slots: Slots, stagger = 110) => {
    deselect()
    endHold()
    hovered = null
    unlink()
    let k = 0
    for (const [id, p] of [...pieces]) { pieces.delete(id); later(k++ * 40, () => poof(p)) }
    let n = 0
    let caps = 0
    for (const id of SLOT_IDS) {
      const part = slots[id]
      // one capacitor at most, whatever the saved board says
      if (part?.kind === 'capacitor' && caps++ > 0) continue
      if (part) placeFromTray(part, id, 220 + (reduce ? 0 : n++ * stagger))
    }
    commit()
  }
  const presetBox = $('.sim02-presets')
  PRESETS.forEach(pr => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sim02-preset'
    b.innerHTML = `<b>${pr.title}</b><span>${pr.note}</span>`
    b.addEventListener('click', () => loadPreset(pr, b))
    presetBox.appendChild(b)
  })
  // ---------- Clear and Undo ----------
  const snapNow = (): BoardSnap => ({
    slots: committedSlots(), emf, r, batteryIn: clockRC.batteryIn, capV, playing: clockRC.playing, compare: { hidden: compare.hidden === true, html: compare.innerHTML },
  })
  const RING = 2 * Math.PI * 10
  let ringPainted = -1
  const paintRing = () => {
    // reduced motion: the ring stays whole instead of counting down
    const f = reduce ? 1 : Math.round(undo.fraction * 200) / 200
    if (f === ringPainted) return
    ringPainted = f
    ringCircle.style.strokeDasharray = `${RING}`
    ringCircle.style.strokeDashoffset = `${RING * (1 - f)}`
  }
  /** Clear turns into Undo for 8 s; it is off when there is nothing to clear, and for the whole tour. */
  const paintClear = () => {
    const undoing = undo.inWindow
    clearBtn.classList.toggle('is-undo', undoing)
    const nothing = pieces.size === 0 && emf === CLEARED.emf && r === CLEARED.r && clockRC.batteryIn === CLEARED.batteryIn
    const off = inTour || (!undoing && nothing)
    if (clearBtn.disabled !== off) clearBtn.disabled = off
    if (undoing) paintRing()
  }
  const armUndo = (snap: BoardSnap, from: 'clear' | 'preset') => {
    undo.arm(snap, boardKey(committedSlots(), emf, r, clockRC.batteryIn))
    undoFrom = from
    ringPainted = -1
    paintClear()
    paintStatus(committedSlots())
  }
  const onClear = () => {
    if (inTour) return
    if (undo.inWindow) { doUndo(); return }
    const snap = snapNow()
    compare.hidden = true
    // Clear resets the battery too: ε = 12 V, r = 0, battery in
    emf = CLEARED.emf
    r = CLEARED.r
    clockRC.batteryIn = CLEARED.batteryIn
    syncSliders()
    loadSlots({})
    armUndo(snap, 'clear')
  }
  const UNDONE = 'Board restored.'
  const doUndo = () => {
    if (inTour) return
    const s = undo.take()
    if (!s) return
    undoFrom = null
    dropDrag()
    deselect()
    endHold()
    emf = s.emf
    r = s.r
    clockRC.batteryIn = s.batteryIn
    syncSliders()
    // the capacitor gets its charge back; the commit in loadSlots starts its curve from there
    capV = s.capV
    circuitKey = ''
    loadSlots(s.slots)
    // a clock that was paused stays paused (the new curve starts at t = 0 from the saved charge)
    if (!s.playing && result.cap) { clockRC.playing = false; paintTime() }
    compare.hidden = s.compare.hidden
    compare.innerHTML = s.compare.html
    // a table that comes back belongs to the board that comes back with it
    presetKey = compare.hidden ? null : boardKey(committedSlots(), emf, r, clockRC.batteryIn)
    paintClear()
    // say so through the status line (role="status"), then go back to the board's own message
    setStatus(UNDONE, false)
    later(2600, () => { if (statusHtml === UNDONE) paintStatus(committedSlots()) })
  }
  /** The timer pauses while a mouse is over the button or the keyboard is on it. */
  let clearHover = false
  const onClearEnter = (e: PointerEvent) => { if (e.pointerType === 'mouse') clearHover = true }
  const onClearLeave = () => { clearHover = false }
  clearBtn.addEventListener('pointerenter', onClearEnter)
  clearBtn.addEventListener('pointerleave', onClearLeave)
  const tickUndo = (ms: number) => {
    if (!undo.inWindow) return
    const closed = undo.tick(ms, clearHover || clearBtn.matches(':focus-visible'))
    if (closed) { paintClear(); paintStatus(committedSlots()) }
    else paintRing()
  }
  const onUndoKey = (e: KeyboardEvent) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'z') return
    if (inTour || !undo.canUndo) return
    e.preventDefault()
    doUndo()
  }
  document.addEventListener('keydown', onUndoKey)

  const notebookEl = $<HTMLElement>('.sim02-notebook')
  const loadPreset = (pr: Preset, btn: HTMLElement) => {
    if (refused()) return
    // keep the pressed button where it is (rows above it may change height), then bring the table into view
    const top0 = btn.getBoundingClientRect().top
    const snap = snapNow()
    emf = pr.input.emf
    r = pr.input.r
    syncSliders()
    // the plots may come or go above the button: no tween here, so the scroll fix below catches the whole change
    deselect()
    endHold()
    timeMod.snapNext()
    loadSlots(pr.input.slots)
    const b = solveBoard(pr.input)
    compare.hidden = false
    compare.innerHTML = `<table><caption>${pr.title}</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Book</th><th scope="col">Sim</th></tr></thead><tbody>${pr.book
      .map(v => `<tr><th scope="row">${v.label.replace('_terminal', '<sub>terminal</sub>').replace('_P', '<sub>P</sub>').replace('_eq', '<sub>eq</sub>')}</th><td>${v.value}</td><td>${sig(v.of(b), 4)} ${v.unit}</td></tr>`)
      .join('')}</tbody></table>`
    // notes say why a printed value and the sim's differ (Example 10.1 prints 11.90 V for 11.88 V)
    const notes = pr.book.filter(v => v.note).map(v => `<p class="sim02-small">${v.note}</p>`).join('')
    if (notes) compare.insertAdjacentHTML('beforeend', notes)
    presetKey = boardKey(committedSlots(), emf, r, clockRC.batteryIn)
    if (!reduce) run(animate(compare, { opacity: [0, 1], y: [8, 0] }, { duration: 0.4 }))
    armUndo(snap, 'preset')
    // fix the scroll in the same frame (before paint), so the pressed button never moves on screen
    const dy = btn.getBoundingClientRect().top - top0
    if (Math.abs(dy) > 0.5) {
      const ownScroll = getComputedStyle(notebookEl).overflowY !== 'visible' && notebookEl.scrollHeight > notebookEl.clientHeight
      if (ownScroll) notebookEl.scrollTop += dy
      else window.scrollBy(0, dy)
    }
    requestAnimationFrame(() => compare.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }))
  }
  clearBtn.addEventListener('click', onClear)
  const onRecenter = () => flyTo(null)
  recenterBtn.addEventListener('click', onRecenter)
  /** Reset view goes quiet while the camera is at the overview. */
  const setHome = (home: boolean) => recenterBtn.classList.toggle('is-home', home)

  // ---------- camera direction ----------
  // The tour flies the camera between framed shots of the board. Motion drives one number from 0 to 1 and the
  // pose is blended from it: the look-at point slides, the camera swings around the board on the short way,
  // and the distance bows outward mid-flight so the move reads as a gentle pull back and push in.
  let camTween: { stop(): void } | null = null
  /** The shot the camera should hold through a resize; undefined once the student orbits by hand. */
  let shotNow: CameraShot | null | undefined
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u
  const turn = (a: number, b: number) => { const d = (((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return d }
  const flyTo = (shot: CameraShot | null) => {
    shotNow = shot
    camTween?.stop()
    camTween = null
    const to = sc.shotPose(shot)
    if (shot) setHome(false)
    // reduced motion: cut straight to the shot, no flight
    if (reduce) { sc.applyPose(to); setHome(!shot); return }
    const from: CameraPose = sc.cameraPose()
    const dTheta = turn(from.theta, to.theta)
    const travel = Math.hypot(to.tx - from.tx, to.tz - from.tz) + Math.abs(to.radius - from.radius) * 0.35 + Math.abs(dTheta) * 4 + Math.abs(to.phi - from.phi) * 4
    if (travel < 0.04) { setHome(!shot); return }
    const duration = Math.min(1.9, 0.95 + travel * 0.07)
    const bow = Math.min(2.6, 0.1 * travel + 0.05 * Math.max(from.radius, to.radius))
    const tween = run(animate(0, 1, {
      duration,
      ease: [0.45, 0.05, 0.22, 1],
      onUpdate: u => sc.applyPose({
        tx: lerp(from.tx, to.tx, u), ty: lerp(from.ty, to.ty, u), tz: lerp(from.tz, to.tz, u),
        radius: lerp(from.radius, to.radius, u) + Math.sin(Math.PI * u) * bow,
        theta: from.theta + dTheta * u,
        phi: lerp(from.phi, to.phi, u),
      }),
    }))
    camTween = tween
    // the flight is over when it ends; a stopped flight is cleared where it is stopped
    tween.then(() => { if (camTween === tween) { camTween = null; if (!shot) setHome(true) } })
  }
  const camera = (name: ShotName) => flyTo(name === 'overview' ? null : SHOTS[name])
  // a hand on the board wins: orbiting stops the flight and the camera stays where the student puts it
  const onOrbitStart = () => { camTween?.stop(); camTween = null; shotNow = undefined; setHome(false) }
  sc.controls.addEventListener('start', onOrbitStart)

  // ---------- the prediction freeze ----------
  const lockNoteId = 'sim02-lock-note'
  const optsHop = () => {
    if (reduce) return
    el.querySelectorAll<HTMLElement>('.sim02-guide-opt').forEach((b, k) => run(animate(b, { y: [0, -2, 0] }, { duration: 0.32, delay: k * 0.03, ease: 'easeOut' })))
  }
  /** A press the frozen board takes no action on: the options hop and the HUD chip says why for a moment. */
  const refuse = () => { optsHop(); hud.flashChip('Pick your prediction first', 1600) }
  /** True (and the press is refused) while a prediction is open. */
  const refused = () => { if (!locked()) return false; refuse(); return true }
  /** A clock held right after a change lets go (Play, Reset, a scrub, or the next step). */
  const releaseAfter = () => { if (gate !== 'after') return; gate = 'free'; remask(); repaint(); cues.sync(guideState()) }
  /** Every locked control stays focusable, marked aria-disabled and described. */
  const setLock = (b: Element, on: boolean) => {
    if (on) { b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-describedby', lockNoteId) }
    else if (b.getAttribute('aria-describedby') === lockNoteId) { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-describedby') }
  }
  const paintPopLock = () => {
    if (pop.hidden) return
    pop.classList.toggle('is-locked', locked())
    pop.querySelectorAll('button, [role=spinbutton]').forEach(b => setLock(b, locked()))
  }
  const hintEls = [...el.querySelectorAll<HTMLElement>('.sim02-dock-hint')]
  let lockPainted = false
  const paintLock = () => {
    const on = locked()
    paintPopLock()
    if (on === lockPainted) return
    lockPainted = on
    el.classList.toggle('is-predicting', on)
    hintEls[0]!.hidden = on
    hintEls[1]!.hidden = !on
    for (const b of [emfIn, rIn, ...trayEl.querySelectorAll('.sim02-chip'), ...presetBox.querySelectorAll('.sim02-preset')]) setLock(b, on)
    // the lock lifting took the capacitor chip's own mark too: put it back while a capacitor is on the board
    paintTray()
  }
  /** Repaint every readout with the current mask (nothing is re-solved and the clock does not move). */
  const repaint = () => {
    hud.update(result, shown, hudFocus(), true, false, mask)
    panel.update({ b: result, slots: shown, selected, rc: clockRC }, { preview, animate: false }, mask)
    paintTime()
    paintStatus(shown)
    paintLock()
  }
  /** Back to t = 0 of the curve on the board, held there. */
  const holdAtStart = () => {
    clockRC.playing = false
    clockRC.hold = 0
    if (curveLive() && clockRC.t !== 0) { clockRC.trace = []; setClock(0, true) }
  }
  const freeze = (res: Resolved | null, phase: FreezePhase | null) => {
    window.clearTimeout(fillTimer)
    const g = gateFor(res, res ? phase : null, gate)
    gate = g.gate
    if (g.play !== null) { clockRC.playing = g.play; clockRC.hold = 0 }
    if (!res || !phase) {
      // the tour left, or a step without a prediction: everything lifts at once
      fz = null; fzPhase = null; tourFocus = null
      remask()
      // leaving the tour: the clock plays and loops again (Loop stays off with reduced motion)
      if (!inTour) { clockRC.playing = true; clockRC.hold = 0; clockRC.loop = !reduce }
      repaint()
      return
    }
    fz = res
    fzPhase = phase
    if (phase === 'predict') {
      dropDrag()
      endHold()
      tourFocus = res.focus
      holdAtStart()
    }
    // a fill step: the capacitor starts filling by itself a beat after the pick. Other steps: the change on the
    // board starts the new curve (anchor), and a "right then" step waits at its t = 0 for Play.
    if (g.beat) fillTimer = window.setTimeout(() => {
      if (fz !== res || fzPhase !== 'act' || gate !== 'held') return
      gate = 'free'
      remask()
      clockRC.playing = true
      paintTime()
      cues.sync(guideState())
    }, 400)
    // the answer is out: a filled capacitor lands on the clock's own end (5τ while it loops, 6τ exactly when it plays
    // once), so the clock, the readouts and the reveal all show the same instant
    if (phase === 'done' && res.fill && curveLive()) setClock(curveEnd(), true)
    // a clock waiting for Play: a docked dial (phones) steps aside, so the board bar and its Play button come back
    if (phase === 'done' && gate === 'after' && !pop.hidden && pop.classList.contains('is-docked')) deselect()
    remask()
    repaint()
    cues.sync(guideState())
  }
  /** Resolves once the parts a step's setup dropped in have landed and the readouts have counted to the board's
   *  numbers (at once with reduced motion). */
  const settled = () => new Promise<void>(resolve => {
    if (reduce) { resolve(); return }
    settleWaiters.push(resolve)
  })
  const pendingLand = () => landTimers > 0 || [...pieces.values()].some(p => p.landing !== null) || hud.counting()

  // ---------- guided tour ----------
  const samePart = (a?: Part, b?: Part) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  /** Move the board to a step's starting point, changing only the slots that differ. */
  /** A part in hand goes back where it came from before the tour changes the board under it. */
  const dropDrag = () => { if (drag) endDrag({ pointerId: drag.pointerId } as PointerEvent, true) }
  const setupBoard = (su: Setup) => {
    dropDrag()
    endHold()
    deselect()
    hovered = null
    unlink()
    compare.hidden = true
    emf = su.emf
    r = su.r
    syncSliders()
    clockRC.batteryIn = su.batteryIn ?? true
    clockRC.speed = 1
    clockRC.playing = gate === 'free'
    clockRC.hold = 0
    let k = 0
    for (const id of SLOT_IDS) {
      const want = su.slots[id]
      const p = pieces.get(id)
      const have = p?.view.part
      if (samePart(have, want)) continue
      if (!want) { pieces.delete(id); poof(p!); continue }
      if (p && have?.kind === 'resistor' && want.kind === 'resistor') { p.view.setOhms(want.ohms); squish(p, 0.8); jiggle(p, 0.06); continue }
      if (p && have?.kind === 'capacitor' && want.kind === 'capacitor') { have.farads = want.farads; continue }
      placeFromTray({ ...want }, id, reduce ? 0 : 140 + k++ * 130)
    }
    if (su.capV !== undefined) capV = su.capV
    circuitKey = ''
    // a new step's board is not a change the student made: the readouts land on its numbers at once, instead of
    // counting through values between the last step's board and this one
    commit(false)
  }
  const act = (a: Action) => {
    dropDrag()
    if ('place' in a) { if (blockCap(a.part, a.place)) return; placeFromTray({ ...a.part }, a.place); commit() }
    else if ('remove' in a) removeFromSlot(a.remove)
    else if ('dial' in a) {
      const p = pieces.get(a.dial)
      if (!p) return
      const part = p.view.part
      if (part.kind === 'resistor') p.view.setOhms(a.value)
      else if (part.kind === 'capacitor') { capV *= part.farads / a.value; part.farads = a.value }
      squish(p, 0.8)
      jiggle(p, 0.06)
      commit()
      if (selected === a.dial) renderPop('keep')
    } else if ('r' in a) { r = a.r; syncSliders(); commit() }
    else if ('battery' in a) { clockRC.batteryIn = a.battery; commit() }
    else if ('select' in a) select(a.select)
    else if ('fill' in a) { window.clearTimeout(fillTimer); gate = 'free'; remask(); clockRC.speed = 25; clockRC.playing = true; paintTime() }
  }
  const spot = (sp: Spot | null, acts: readonly Action[] = []) => {
    // every tour step opens with the capacitor's clock running (a pause from the last step does not carry over),
    // unless the step's prediction holds it at t = 0
    if (sp) { clockRC.playing = gate === 'free'; clockRC.hold = 0; paintTime() }
    // cues.ts marks what the step points at (data-spot); the is-spot classes below pick which notebook boxes the
    // tour shows, and guideSpots are the slots the end-of-task ring pulse celebrates
    cues.set(sp, acts, guideState())
    guideSpots.clear()
    for (const id of sp?.slots ?? []) guideSpots.add(id)
    $('.sim02-battery').classList.toggle('is-spot', !!sp?.battery)
    timeMod.el.classList.toggle('is-spot', !!sp?.time)
    const rows = sp?.rows ?? []
    el.querySelectorAll<HTMLElement>('.sim02-row').forEach(row => row.classList.toggle('is-spot', rows.some(id => row.classList.contains(`sim02-row-${id}`))))
    el.classList.toggle('has-spot-rows', rows.length > 0)
    if (sp?.battery) jiggleBattery()
  }
  const notebook = $<HTMLElement>('.sim02-notebook')
  // phones: the browser counts a control under the pinned board as on screen, so a Tab onto it (the Simplifications
  // summary near the page end, say) would leave the focus hidden. Scroll it to just below the board instead. The
  // tour card does the same for its own buttons.
  notebook.addEventListener('focusin', e => {
    const t = e.target
    if (!(t instanceof HTMLElement) || guide?.el.contains(t) || !t.matches(':focus-visible')) return
    requestAnimationFrame(() => {
      if (document.activeElement !== t) return
      const stage = $<HTMLElement>('.sim02-stage')
      if (getComputedStyle(stage).position !== 'sticky') return
      const pin = stage.getBoundingClientRect().bottom
      const r = t.getBoundingClientRect()
      if (r.top >= pin + 4 || r.bottom <= 0) return
      t.style.scrollMarginTop = `${pin + 12}px`
      t.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    })
  })
  // ---------- guide cues (cues.ts: the Coach set, the one that ships) ----------
  const unitPx = (id: SlotId) => {
    const c = SLOTS[id].center
    const v = SLOTS[id].vertical
    const a = sc.project(c.x, REST_Y, c.z), b = sc.project(c.x + (v ? 0 : 1), REST_Y, c.z + (v ? 1 : 0))
    return Math.hypot(b.x - a.x, b.y - a.y)
  }
  cues = createCues({
    root: el,
    wrap,
    reduce: () => reduce,
    chip: id => trayEl.querySelector<HTMLElement>(`.sim02-chip[data-part="${id}"]`),
    label: id => labelEls.get(id) ?? null,
    hud: () => hud.el,
    battery: () => $<HTMLElement>('.sim02-battery'),
    time: () => timeMod.el,
    row: id => el.querySelector<HTMLElement>(`.sim02-row-${id}`),
    control: c => (c === 'r' ? rIn.closest<HTMLElement>('.sim02-slider') : c === 'play' ? timeMod.transport.querySelector<HTMLElement>('[data-tp="play"]') : timeMod.el.querySelector<HTMLElement>(c === 'bat-out' ? '[data-bat="out"]' : '[data-speed="5"]')),
    dialButton: dir => (pop.hidden ? null : pop.querySelector<HTMLElement>(`[data-step="${dir}"]`)),
    removeButton: () => (pop.hidden ? null : pop.querySelector<HTMLElement>('.sim02-pop-remove')),
    slotButton: id => slotBtns.get(id) ?? null,
    slotPoint: id => {
      const c = SLOTS[id].center
      const p = sc.project(c.x, REST_Y, c.z)
      return p.visible ? { x: p.x, y: p.y, r: unitPx(id) * 1.1 } : null
    },
    dropsOff: (x, y, past = false) => {
      if (document.elementFromPoint(x, y) !== canvas) return false
      // the hand (and the part copy riding above it) stays clear of the HUD, the board bar, the dial, the status
      // line and the tray, even where those let presses through to the canvas
      const box = { l: x - 30, r: x + 30, t: y - 64, b: y + 36 }
      const keepOut = [hud.el, ...el.querySelectorAll<HTMLElement>('.sim02-boardbar > *, .sim02-pop:not([hidden]), .sim02-status, .sim02-dock')]
      for (const k of keepOut) {
        const r = k.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (box.l < r.right && box.r > r.left && box.t < r.bottom && box.b > r.top) return false
      }
      const q = sc.boardPoint(toNdc(x, y), REST_Y)
      if (!q) return false
      // both magnet points a drag uses (the pointer's spot and the spot the lifted part looks over), with a margin
      const seen = sc.groundUnder(q.x, REST_Y + LIFT, q.z) ?? q
      // the board's rim is 11.3 by 6.2 board units (scene.ts)
      if (past && Math.abs(q.x) < 5.65 + 0.3 && Math.abs(q.z) < 3.1 + 0.3) return false
      return SLOT_IDS.every(id => Math.min(slotDist(q, id), slotDist(seen, id)) > MAGNET * 1.15)
    },
    ripple: id => { ringPulse(id, true); markCuePulse(id) },
    busy: () => !!drag || !!holding,
    flying: () => camTween !== null,
    // a held equation row, or the time box while its curve is covered for the prediction
    covered: e => (e === timeMod.el ? mask.fog === 'predict' : [...e.classList].some(c => c.startsWith('sim02-row-') && mask.say(c.slice(10)))),
  })
  guide = createGuide({
    state: guideState,
    setup: setupBoard,
    act,
    spot,
    touring: on => {
      el.classList.toggle('is-touring', on)
      notebook.scrollTop = 0
      // the tour owns the board: Clear stays in place but off, and a pending Undo is dropped
      inTour = on
      if (on) { undo.drop(); undoFrom = null }
      paintClear()
    },
    camera,
    celebrate: () => { for (const id of guideSpots) if (pieces.has(id)) ringPulse(id) },
    cue: stage => cues.stage(stage, guideState()),
    poke: ref => cues.poke(ref),
    showMe: () => cues.showMe(),
    freeze,
    settled,
  }, () => reduce)
  $('.sim02-tour-slot').replaceWith(guide.startButton)
  $('.sim02-guide-slot').replaceWith(guide.el)

  // ---------- layout ----------
  let portrait: boolean | null = null
  let lastW = 0, lastH = 0
  const ro = new ResizeObserver(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight
    const poseBefore = sc.cameraPose()
    // on wide screens the HUD floats over the board's top edge, so keep that strip clear
    el.style.setProperty('--sim02-stage-h', `${$('.sim02-stage').getBoundingClientRect().height}px`)
    const floating = getComputedStyle(hud.el).position === 'absolute'
    hudFloating = floating
    sc.setInsetTop(floating ? hud.el.offsetHeight + 34 : 0)
    // the board bar's band along the bottom edge stays clear of the board
    sc.setInsetBottom(Math.max(0, wrap.clientHeight - bar.offsetTop))
    const p = w / Math.max(1, h) < 0.82
    if (p !== portrait) { portrait = p; sc.setPortrait(p) }
    // browser zoom or a move to another screen changes the pixel ratio: re-size the drawing buffer to match
    syncPixelRatio()
    // only a real size change re-fits; the HUD's width changes with its text
    const sized = w !== lastW || h !== lastH
    if (sized) { lastW = w; lastH = h; sc.resize(w, h) }
    // a re-fit keeps an orbited view and moves an overview to the new overview; a tour shot is framed again
    const poseAfter = sc.cameraPose()
    const moved = Math.abs(poseAfter.radius - poseBefore.radius) + Math.abs(poseAfter.tx - poseBefore.tx) + Math.abs(poseAfter.theta - poseBefore.theta) > 1e-6
    if (shotNow && (moved || sized)) { camTween?.stop(); camTween = null; sc.applyPose(sc.shotPose(shotNow)) }
    else if (moved && shotNow === null) setHome(true)
  })
  ro.observe(wrap)
  ro.observe(hud.el)
  /** The drawing buffer follows the screen's pixel ratio (capped at 2), so the board stays sharp after a zoom. */
  const syncPixelRatio = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (dpr === sc.renderer.getPixelRatio()) return
    sc.renderer.setPixelRatio(dpr)
    if (lastW && lastH) sc.resize(lastW, lastH)
  }
  // a resolution query matches one pixel ratio only, so it is armed again for the new ratio after each change
  let dprMq: MediaQueryList | null = null
  const onDpr = () => { armDpr(); syncPixelRatio() }
  const armDpr = () => {
    dprMq?.removeEventListener('change', onDpr)
    dprMq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
    dprMq.addEventListener('change', onDpr)
  }
  armDpr()
  const onMotionPref = () => { reduce = reduced.matches }
  reduced.addEventListener('change', onMotionPref)

  // ---------- where each socket sits on screen ----------
  /** Gap between a socket's edge on screen and its label (px). */
  const LABEL_GAP = 6
  /** The screen box (canvas px) around a socket's pad and the part standing in it. */
  const socketBox = (id: SlotId): Box => {
    const { center: c, vertical: v } = SLOTS[id]
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity
    // the pad on the board (2.1 by 0.78), and the top of a part's body above it (about 1.5 by 0.6)
    for (const [y, along, across] of [[0.05, 1.05, 0.39], [REST_Y + 0.36, 0.75, 0.3]] as const) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const q = sc.project(c.x + sx * (v ? across : along), y, c.z + sz * (v ? along : across))
      l = Math.min(l, q.x); r = Math.max(r, q.x); t = Math.min(t, q.y); b = Math.max(b, q.y)
    }
    return { l, t, r, b }
  }
  /**
   * The slot buttons (keyboard and tap-to-place targets) cover their own socket: at least 44 px where there is
   * room, never overlapping a neighbor (the lanes stand close on phones), and inside the board box.
   */
  const paintSlotBoxes = (boxes: Map<SlotId, Box>) => {
    const W = wrap.clientWidth
    const floor = bar.offsetTop - 2
    const out = new Map<SlotId, Box & { cx: number; cy: number }>()
    for (const [id, k] of boxes) {
      const m = sc.project(SLOTS[id].center.x, REST_Y, SLOTS[id].center.z)
      const hw = Math.max(22, (k.r - k.l) / 2), hh = Math.max(22, (k.b - k.t) / 2)
      out.set(id, { l: m.x - hw, r: m.x + hw, t: m.y - hh, b: m.y + hh, cx: m.x, cy: m.y })
    }
    const list = [...out.values()]
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, c = list[j]!
      if (!overlaps(a, c)) continue
      // split the overlap halfway between the two centers, along the axis they stand apart on
      if (Math.abs(a.cy - c.cy) >= Math.abs(a.cx - c.cx)) {
        const [up, dn] = a.cy < c.cy ? [a, c] : [c, a]
        const cut = (up.cy + dn.cy) / 2
        up.b = Math.min(up.b, cut - 2); dn.t = Math.max(dn.t, cut + 2)
      } else {
        const [lt, rt] = a.cx < c.cx ? [a, c] : [c, a]
        const cut = (lt.cx + rt.cx) / 2
        lt.r = Math.min(lt.r, cut - 2); rt.l = Math.max(rt.l, cut + 2)
      }
    }
    for (const [id, k] of out) {
      const l = Math.max(2, k.l), r = Math.min(W - 2, k.r), t = Math.max(2, k.t), b = Math.min(floor, k.b)
      const btn = slotBtns.get(id)!
      const w = `${Math.max(0, r - l).toFixed(1)}px`, h = `${Math.max(0, b - t).toFixed(1)}px`
      const tf = `translate(${((l + r) / 2).toFixed(1)}px, ${((t + b) / 2).toFixed(1)}px)`
      if (btn.style.width !== w) btn.style.width = w
      if (btn.style.height !== h) btn.style.height = h
      if (btn.style.transform !== tf) btn.style.transform = tf
      // a slot whose center sits off the board box (a close-up camera) leaves the Tab order until it is back
      const c = out.get(id)!
      const ti = c.cx < 0 || c.cx > W || c.cy < 0 || c.cy > floor ? -1 : 0
      if (btn.tabIndex !== ti) btn.tabIndex = ti
      // the tour's do slot stands out from the other places a held part could go
      const isDo = cues.role(id) === 'do'
      if (btn.classList.contains('is-do') !== isDo) btn.classList.toggle('is-do', isDo)
    }
  }

  // ---------- keeping the labels readable ----------
  // Every frame each label stays inside the board box (above the bar band) and slides the shortest way out from
  // under the HUD, the status line and the floating dial. An open label (a selected or pointed-at part, which
  // shows its reading) hides the labels it would cover, and a part's label hides an empty slot's name. The
  // floating dial then keeps off the labels.
  type Box = { l: number; t: number; r: number; b: number }
  /** Which label keeps its place when two collide: the battery's, then the series parts, then the branches. */
  const LABEL_ORDER: (SlotId | 'batt')[] = ['batt', 'R1', 'R5', 'R2', 'R3', 'R4']
  const labelAnchor = new Map<HTMLElement, { x: number; y: number }>()
  const labelBox = new Map<HTMLElement, Box>()
  const labelShift = new Map<HTMLElement, { x: number; y: number }>()
  let hudFloating = false
  const overlaps = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b
  const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
  /** How far a point is from a box (0 inside it). */
  const pointGap = (x: number, y: number, k: Box) => Math.hypot(Math.max(0, k.l - x, x - k.r), Math.max(0, k.t - y, y - k.b))
  /** A label reads as its own socket's when its center is no nearer any other socket than its own. */
  const owns = (id: SlotId, q: Box, sockets: Map<SlotId, Box>) => {
    const x = (q.l + q.r) / 2, y = (q.t + q.b) / 2
    const mine = pointGap(x, y, sockets.get(id)!)
    for (const [o, k] of sockets) if (o !== id && pointGap(x, y, k) < mine) return false
    return true
  }
  /** The anchor a label hangs from: a gap above, below, or to the left of its socket's screen box. */
  const hangFrom = (mode: LabelMode, box: Box, mid: { x: number; y: number }) =>
    mode === 'top' ? { x: mid.x, y: box.t - LABEL_GAP } : mode === 'below' ? { x: mid.x, y: box.b + LABEL_GAP } : { x: box.l - LABEL_GAP, y: mid.y }
  /** The label's box when it hangs from that anchor (matches layoutLabels). */
  const hangBox = (mode: LabelMode, a: { x: number; y: number }, w: number, h: number): Box => {
    const l = mode === 'side' ? a.x - w : mode === 'right' ? a.x : a.x - w / 2
    const t = mode === 'top' ? a.y - h : mode === 'below' ? a.y : a.y - h / 2
    return { l, t, r: l + w, b: t + h }
  }
  const layoutLabels = (dt: number, sockets: Map<SlotId, Box>) => {
    const W = wrap.clientWidth
    const floor = bar.offsetTop - 4
    const wr = wrap.getBoundingClientRect()
    const boxOf = (e: Element, pad: number): Box | null => {
      const q = e.getBoundingClientRect()
      return q.width ? { l: q.left - wr.left - pad, t: q.top - wr.top - pad, r: q.right - wr.left + pad, b: q.bottom - wr.top + pad } : null
    }
    const blocks: Box[] = []
    const hb = hudFloating ? boxOf(hud.el, 4) : null
    if (hb) blocks.push(hb)
    const sb = statusEl.classList.contains('is-on') && statusHtml && !replayOn ? boxOf(statusEl, 4) : null
    if (sb) blocks.push(sb)
    const rb = replayOn ? boxOf(replayEl, 4) : null
    if (rb) blocks.push(rb)
    // the floating dial picks the spot that covers the fewest labels; a label it still clips slides out
    const pb = !pop.hidden && !pop.classList.contains('is-docked') ? boxOf(pop, 4) : null
    if (pb) blocks.push(pb)
    // the junction dots B and C stay readable too
    for (const [d] of junctionEls) { const jb = boxOf(d, 2); if (jb) blocks.push(jb) }
    const ease = reduce ? 1 : Math.min(1, dt * 14)
    // where each label wants to be: hung from its anchor, inside the board box
    const want = new Map<HTMLElement, { l0: number; t0: number; l: number; t: number; w: number; h: number; mode: LabelMode }>()
    for (const [e, a] of labelAnchor) {
      const mode = labelMode.get(e) ?? 'top'
      const w = e.offsetWidth, h = e.offsetHeight
      const l0 = mode === 'side' ? a.x - w : mode === 'right' ? a.x : a.x - w / 2
      const t0 = mode === 'top' ? a.y - h : mode === 'below' ? a.y : a.y - h / 2
      want.set(e, { l0, t0, l: Math.max(4, Math.min(W - 4 - w, l0)), t: Math.max(4, Math.min(floor - h, t0)), w, h, mode })
    }
    // each label slides the shortest way out from under each block (HUD, status, dial, junction dots), staying on the
    // board, and where it can, staying nearer its own socket than any other. A part's label with no such way out
    // from under the floating dial stays put and hides while the dial is open, instead of turning up beside
    // another part.
    const buried = new Set<HTMLElement>()
    for (const [e, q] of want) {
      const id = e.dataset.slot as SlotId | undefined
      for (const k of blocks) {
        if (!overlaps({ l: q.l, t: q.t, r: q.l + q.w, b: q.t + q.h }, k)) continue
        const fits = ([[0, k.b - q.t], [0, k.t - q.t - q.h], [k.r - q.l, 0], [k.l - q.l - q.w, 0]] as const)
          .filter(([dx, dy]) => q.l + dx >= 4 && q.l + dx + q.w <= W - 4 && q.t + dy >= 4 && q.t + dy + q.h <= floor)
        const mine = id ? fits.filter(([dx, dy]) => owns(id, { l: q.l + dx, t: q.t + dy, r: q.l + dx + q.w, b: q.t + dy + q.h }, sockets)) : []
        if (id && !mine.length && k === pb) { buried.add(e); continue }
        const moves = mine.length ? mine : fits
        if (!moves.length) continue
        const [dx, dy] = moves.reduce((m, v) => (Math.abs(v[0]) + Math.abs(v[1]) < Math.abs(m[0]) + Math.abs(m[1]) ? v : m))
        q.l += dx; q.t += dy
      }
    }
    // two part labels that collide: the later one in LABEL_ORDER slides just far enough to clear the labels ranked
    // above it and the blocks, preferably along its own side (a label above or below a socket slides sideways, a
    // label beside one slides up or down). A slide never takes a label nearer another socket than its own (R₃'s
    // label must not end up beside R₅), and it avoids covering other sockets.
    const ranked = LABEL_ORDER.map(x => (x === 'batt' ? battLabel : labelEls.get(x)!)).filter(e => !e.classList.contains('is-empty') && e.style.visibility !== 'hidden' && !buried.has(e) && want.has(e))
    for (let i = 1; i < ranked.length; i++) {
      const e = ranked[i]!
      const me = want.get(e)!
      const id = e.dataset.slot as SlotId | undefined
      const above = ranked.slice(0, i).map(o => { const k = want.get(o)!; return { l: k.l - 3, t: k.t - 3, r: k.l + k.w + 3, b: k.t + k.h + 3 } })
      const vert = me.mode === 'side' || me.mode === 'right'
      const at = (dx: number, dy: number): Box => ({ l: me.l + dx, t: me.t + dy, r: me.l + dx + me.w, b: me.t + dy + me.h })
      if (above.every(k => overlapArea(at(0, 0), k) === 0)) continue
      const edges = [...above, ...blocks]
      const xs = [0, ...edges.flatMap(k => [k.r - me.l, k.l - me.w - me.l])].filter(d => me.l + d >= 4 && me.l + d + me.w <= W - 4)
      const ys = [0, ...edges.flatMap(k => [k.b - me.t, k.t - me.h - me.t])].filter(d => me.t + d >= 4 && me.t + d + me.h <= floor)
      const tries = [...xs.map(d => [d, 0] as const), ...ys.map(d => [0, d] as const)].map(([dx, dy]) => {
        const q = at(dx, dy)
        let hit = 0, cover = 0
        for (const k of edges) hit += overlapArea(q, k)
        if (id) for (const [o, k] of sockets) if (o !== id) cover += overlapArea(q, k)
        // a slide across its own side costs double; covering another socket costs its overlap's depth
        const move = vert ? Math.abs(dy) + 2 * Math.abs(dx) : Math.abs(dx) + 2 * Math.abs(dy)
        return { dx, dy, hit, mine: !id || owns(id, q, sockets), cost: move + cover / me.h }
      })
      const best = (list: typeof tries) => list.reduce<(typeof tries)[number] | null>((m, k) => (!m || k.hit < m.hit || (k.hit === m.hit && k.cost < m.cost) ? k : m), null)
      // the cheapest clean slide that keeps the label its own socket's; else the least overlap that does; else the least overlap
      const pick = best(tries.filter(k => k.mine && k.hit === 0)) ?? best(tries.filter(k => k.mine)) ?? best(tries)
      if (pick) { me.l += pick.dx; me.t += pick.dy }
    }
    for (const [e, q] of want) {
      const { l0, t0, l, t, w, h } = q
      // the slide eases in and out, so a label never jumps when the status line comes or goes
      const sh = labelShift.get(e) ?? { x: 0, y: 0 }
      sh.x += (l - l0 - sh.x) * ease
      sh.y += (t - t0 - sh.y) * ease
      // (a frame with no size yet, or a label off the screen, must not leave a NaN behind)
      if (!(Math.abs(sh.x - (l - l0)) >= 0.25)) sh.x = Number.isFinite(l - l0) ? l - l0 : 0
      if (!(Math.abs(sh.y - (t - t0)) >= 0.25)) sh.y = Number.isFinite(t - t0) ? t - t0 : 0
      labelShift.set(e, sh)
      // never cut off at the board's edge (at once, not eased)
      const fl = Math.max(4, Math.min(W - 4 - w, l0 + sh.x))
      const ft = Math.max(4, Math.min(floor - h, t0 + sh.y))
      // the box's top-left goes in the translate property, the outermost of the CSS transforms, so the open
      // label's scale (CSS) grows the label about its own center instead of scaling its distance from the corner
      e.style.translate = `${fl}px ${ft}px`
      labelBox.set(e, { l: fl, t: ft, r: fl + w, b: ft + h })
    }
    const open = [...labelEls.values()].filter(e => (e.classList.contains('is-sel') || e.classList.contains('is-linked')) && e.style.visibility !== 'hidden')
    const parts = [...labelEls.values()].filter(e => !e.classList.contains('is-empty'))
    /** A close-up camera leaves some parts off the board box or under the floating HUD: their labels would only pile
     *  up at the edge (R₁'s over the battery's on the capacitor shots), so they step out until the part is back. */
    const offstage = (e: HTMLElement) => {
      const id = e.dataset.slot as SlotId | undefined
      const k = id ? sockets.get(id) : undefined
      const c = k ? { x: (k.l + k.r) / 2, y: (k.t + k.b) / 2 } : labelAnchor.get(e)
      if (!c) return false
      if (c.x < 0 || c.x > W || c.y < 0 || c.y > floor) return true
      return !!hb && c.x > hb.l && c.x < hb.r && c.y > hb.t && c.y < hb.b
    }
    for (const e of labelAnchor.keys()) {
      const box = labelBox.get(e)!
      // an empty slot's name also gives way to a part's label it collides with
      const over = e.classList.contains('is-empty') ? parts : open
      const under = !e.dataset.spot && (buried.has(e) || offstage(e) || over.some(o => o !== e && overlaps(labelBox.get(o)!, box)))
      if (e.classList.contains('is-tucked') !== under) e.classList.toggle('is-tucked', under)
    }
  }

  // ---------- where the floating dial goes ----------
  // Above the part, below it, beside it, or past the part's own label; never over the board bar's band or the HUD,
  // never off the board, and of the spots that fit, the one that covers the least of the labels.
  type Spot2 = { id: string; cls: '' | 'is-below' | 'is-right' | 'is-left'; x: number; y: number; l: number; t: number }
  let popSpot = ''
  let popFor: SlotId | null = null
  const placePop = (id: SlotId) => {
    if (id !== popFor) { popFor = id; popSpot = '' }
    const W = wrap.clientWidth, H = wrap.clientHeight
    const pw = pop.offsetWidth, ph = pop.offsetHeight
    const floor = bar.offsetTop - 4
    const wr = wrap.getBoundingClientRect()
    let hr: { l: number; t: number; r: number; b: number } | null = null
    if (getComputedStyle(hud.el).position === 'absolute') {
      const h = hud.el.getBoundingClientRect()
      hr = { l: h.left - wr.left - 6, t: h.top - wr.top - 6, r: h.right - wr.left + 6, b: h.bottom - wr.top + 6 }
    }
    const c = SLOTS[id].center
    const up = sc.project(c.x, REST_Y + 0.4, c.z)
    const down = sc.project(c.x, 0, c.z + 0.35)
    const mid = sc.project(c.x, REST_Y, c.z)
    const half = unitPx(id) * 0.75
    const cx = (x: number) => Math.max(pw / 2 + 8, Math.min(W - pw / 2 - 8, x))
    const cy = (y: number) => Math.max(ph / 2 + 8, Math.min(floor - ph / 2, y))
    const ux = cx(up.x), dx = cx(down.x), sy = cy(mid.y)
    const own = labelBox.get(labelEls.get(id)!)
    const spots: Spot2[] = [
      { id: 'up', cls: '', x: ux, y: up.y, l: ux - pw / 2, t: up.y - 18 - ph },
      { id: 'down', cls: 'is-below', x: dx, y: down.y, l: dx - pw / 2, t: down.y + 18 },
      { id: 'right', cls: 'is-right', x: mid.x + half, y: sy, l: mid.x + half + 20, t: sy - ph / 2 },
      { id: 'left', cls: 'is-left', x: mid.x - half, y: sy, l: mid.x - half - 20 - pw, t: sy - ph / 2 },
    ]
    // past the part's own label, so the label and its reading stay in sight while the value changes
    if (own && own.b <= mid.y) spots.push({ id: 'up-label', cls: '', x: ux, y: own.t, l: ux - pw / 2, t: own.t - 18 - ph })
    if (own && own.t >= mid.y) spots.push({ id: 'down-label', cls: 'is-below', x: dx, y: own.b, l: dx - pw / 2, t: own.b + 18 })
    /** How much of the dial lands where it may not: off the board, in the bar band, over the HUD (px²). */
    const bad = (k: Spot2) => {
      const r = k.l + pw, b = k.t + ph
      const inside = Math.max(0, Math.min(r, W - 4) - Math.max(k.l, 4)) * Math.max(0, Math.min(b, floor) - Math.max(k.t, 4))
      let cost = pw * ph - inside
      if (hr) cost += Math.max(0, Math.min(r, hr.r) - Math.max(k.l, hr.l)) * Math.max(0, Math.min(b, hr.b) - Math.max(k.t, hr.t))
      return cost
    }
    /** How much of the board's labels the dial would cover (px²); the part's own label counts double. */
    const covers = (k: Spot2) => {
      const box = { l: k.l, t: k.t, r: k.l + pw, b: k.t + ph }
      let sum = 0
      for (const [e, lb] of labelBox) if (!e.classList.contains('is-tucked') && e.style.visibility !== 'hidden') sum += overlapArea(box, lb) * (lb === own ? 2 : 1)
      return sum
    }
    const score = (k: Spot2) => bad(k) * 50 + covers(k)
    const best = spots.reduce((a, k) => (score(k) < score(a) ? k : a))
    // keep the last spot while it still fits about as well, so the dial doesn't hop between spots as the camera moves
    const last = spots.find(k => k.id === popSpot)
    const pick = last && bad(last) === 0 && covers(last) <= covers(best) + 400 ? last : best
    popSpot = pick.id
    if (pick.cls !== popPlace) {
      pop.classList.remove('is-below', 'is-right', 'is-left')
      if (pick.cls) pop.classList.add(pick.cls)
      popPlace = pick.cls
    }
    void H
    // left/top, not transform: Motion's pop-in scale owns the transform property
    pop.style.left = `${pick.x}px`
    pop.style.top = `${pick.y}px`
  }

  // ---------- one clock ----------
  /** How long an empty series socket's glow pulses after the gaps change, before it rests (ms). */
  const GAP_PULSE_MS = 3200
  let gapsWere = ''
  let gapsSince = 0
  let blinkAt = 2500
  let blinkUntil = 0
  let clock = 0
  let lastPanelPaint = 0
  const loop = ({ delta }: { delta: number }) => {
    const dt = Math.min(delta, 100) / 1000
    clock += delta
    // the capacitor moves along its exponential; the whole board is re-solved at the new V_C
    // a capacitor with no curve (τ = ∞ or 0) never reads as playing, whichever step or button set the clock going
    if (result.cap && !preview && !curveLive() && clockRC.playing) { clockRC.playing = false; paintTime() }
    if (curveLive() && clockRuns(gate, clockRC.playing)) {
      const end = curveEnd()
      if (clockRC.t < end) setClock(Math.min(end, clockRC.t + dt * clockRC.speed), false)
      else if (!loops()) { clockRC.playing = false; paintTime() }
      else {
        // the end stays on screen a moment (the full, or empty, capacitor), then the capacitor resets and plays again
        const first = clockRC.hold === 0
        clockRC.hold += dt
        if (first) { paintTime(); showReplay(true) }
        if (clockRC.hold >= LOOP_HOLD) { resetCurve(); showReplay(true); replayOffAt = clock + REPLAY_TAIL }
      }
    }
    // the badge goes 1 s into the replay, or at once when the hold ended some other way (Pause, a scrub, Reset)
    if (replayOn && clockRC.hold === 0 && (replayOffAt === Infinity || clock >= replayOffAt || !clockRuns(gate, clockRC.playing))) showReplay(false)
    if (panelDirty && !preview && (panelNow || clock - lastPanelPaint > 120)) {
      panelDirty = false
      panelNow = false
      lastPanelPaint = clock
      panel.update({ b: result, slots: shown, selected, rc: clockRC }, { preview: false, animate: false }, mask)
      paintSlotButtons(shown)
    }
    const all = [...pieces.values(), ...loose]
    for (const p of all) {
      const g = p.view.group
      if (p.landing && p.y.get() <= REST_Y + 0.02) { squish(p, 0.6); ringPulse(p.landing); p.landing = null }
      // a falling part never sinks into the board: it stops at its feet and the squash shows the hit
      g.position.set(p.x.get(), Math.max(p.y.get(), REST_Y - 0.03), p.z.get())
      g.rotation.y = p.r.get()
      const s = p.scale.get()
      g.scale.setScalar(Math.max(0.0001, s))
      // tilt into the motion, like something soft being carried
      const vx = p.x.getVelocity(), vz = p.z.getVelocity()
      const ang = -g.rotation.y
      const lx = vx * Math.cos(ang) - vz * Math.sin(ang)
      const lz = vx * Math.sin(ang) + vz * Math.cos(ang)
      const k = reduce ? 0 : 0.035
      const sq = p.squash.get()
      p.view.inner.rotation.z = THREE.MathUtils.clamp(-lx * k, -0.45, 0.45) + p.wob.get() * 0.6
      p.view.inner.rotation.x = THREE.MathUtils.clamp(lz * k, -0.45, 0.45)
      p.view.inner.scale.set(1 + (1 - sq) * 0.55, sq, 1 + (1 - sq) * 0.55)
      if (p.view.part.kind === 'capacitor') {
        // plates glow with the stored charge; a vertical slot turns the piece, so its a end is the far plate
        const full = Math.max(1e-9, Math.abs(emf), Math.abs(capV), Math.abs(clockRC.Voc))
        const f = capV / full
        // while carried, the piece keeps the orientation of the slot it came from for the sign
        const home = p.slot ?? (drag?.piece === p ? drag.from : null)
        p.view.setCharge(home && SLOTS[home].vertical ? -f : f)
        continue
      }
      // heat tint eases toward the solved power
      const P = p.slot ? result.slots[p.slot]?.P ?? 0 : 0
      const target = Number.isFinite(P) ? 1 - Math.exp(-P / 7) : 1
      p.heat += (target - p.heat) * (1 - Math.exp(-dt * 4))
      p.view.setHeat(p.heat)
    }
    // socket glow: bright when a dragged or held part could go there. A tour "do" socket pulses while the tour's
    // ripples play on it (each beacon play, on arrival and on every idle nudge), then rests on a steady glow; an
    // empty series socket pulses for a few seconds when the gaps change. With reduced motion nothing pulses.
    const gapKey = result.gaps.join()
    if (gapKey !== gapsWere) { gapsWere = gapKey; gapsSince = clock }
    const wave = (since: number, period: number) => (reduce || clock - since > GAP_PULSE_MS ? 0 : Math.sin((clock - since) / period))
    const wallNow = performance.now()
    const cueWave = (id: SlotId) => { const p = cuePulse.get(id); return reduce || !p || wallNow - p.last > CUE_PULSE_MS ? 0 : Math.sin((wallNow - p.from) / 300) }
    const holdDo = !!holding && SLOT_IDS.some(id => cues.role(id) === 'do')
    for (const id of SLOT_IDS) {
      const s = sc.sockets[id]
      const role = cues.role(id)
      let goal = 0
      if (drag?.moved) goal = drag.lockSlot === id ? 0.85 : drag.near === id ? 0.45 : pieces.has(id) ? 0 : 0.16
      // holding a part during the tour: the step's do slot glows brighter than every other place it could go
      else if (holding) goal = !holdDo ? (reduce ? 0.7 : 0.35 + 0.25 * Math.sin(clock / 260))
        : role === 'do' ? (reduce ? 0.85 : 0.72 + 0.14 * Math.sin(clock / 260)) : (reduce ? 0.3 : 0.2 + 0.1 * Math.sin(clock / 260))
      else if (role) goal = role === 'do' ? (reduce ? 0.7 : 0.62 + 0.14 * cueWave(id)) : 0.32
      else if (result.gaps.includes(id)) goal = reduce ? 0.24 : 0.18 + 0.12 * wave(gapsSince, 400)
      const m = s.glow.material as THREE.MeshBasicMaterial
      m.opacity += (goal - m.opacity) * (1 - Math.exp(-dt * 12))
      const padScale = 1 + m.opacity * 0.08
      s.glow.scale.set(padScale, 1, padScale)
      // the butter glow alone is faint on the mint board: a "do" socket also keeps a steady grape ring through the
      // whole act phase (between ripples, and under reduced motion), which a low-vision student can find
      if (!ringTweens.has(id)) {
        const rm = s.ring.material as THREE.MeshBasicMaterial
        const want = role === 'do' ? 0.8 : 0
        if (want > 0) { rm.color.set(0x5a4daa); s.ring.scale.setScalar(1.6) }
        rm.opacity = reduce ? want : rm.opacity + (want - rm.opacity) * (1 - Math.exp(-dt * 8))
        if (rm.opacity < 0.005) rm.opacity = 0
      }
    }
    // current dots
    const slotI: Partial<Record<SlotId, number>> = {}
    const arches: Partial<Record<SlotId, boolean>> = {}
    for (const id of SLOT_IDS) {
      const rd = result.slots[id]
      if (rd) slotI[id] = Number.isFinite(rd.I) ? rd.I : 6
      arches[id] = shown[id]?.kind === 'wire'
    }
    const wireI = result.idealShort ? result.deadWire.map(d => (d ? 0 : 6)) : result.wireI
    // while predicting the dots stand still where they are. A switched-out battery's stand-in wire carries the
    // battery current (− to +, the way the battery's own current runs)
    const bI = result.batteryOut ? (Number.isFinite(result.I) ? result.I : 6) : null
    sc.updateDots(wireI, slotI, arches, locked() ? 0 : dt, reduce, bI)
    // battery: blink now and then, sleepy with no current, panicking on a short
    if (clock > blinkAt) { blinkUntil = clock + 140; blinkAt = clock + 2800 + Math.random() * 2600 }
    const mood = mask.face ? 'awake' : result.status === 'short' ? 'yikes' : result.status === 'open' || result.batteryOut || result.I === 0 ? 'sleepy' : 'happy'
    sc.setBatteryMood(mood, clock < blinkUntil)
    const shake = result.status === 'short' && !reduce ? 0.03 * Math.sin(clock / 22) : 0
    // battery out: the battery slides in off the rail, ghosted, and a plain wire takes its place
    const outGoal = result.batteryOut ? 1 : 0
    outK = reduce ? outGoal : outK + (outGoal - outK) * (1 - Math.exp(-dt * 7))
    if (Math.abs(outK - outGoal) < 1e-3) outK = outGoal
    sc.setBatteryOut(outK)
    sc.battery.position.x = NODES[0]!.x + shake + BATTERY_SLIDE * outK
    sc.battery.scale.setScalar(1 - 0.1 * outK + batteryKick * 0.08 * Math.sin(clock / 40))
    const badge = String(1 - outK)
    if (plusEl.style.opacity !== badge) { plusEl.style.opacity = badge; minusEl.style.opacity = badge }
    sc.render()
    // DOM overlays follow the board. Each label hangs a fixed gap off the edge of its socket and part as seen on
    // screen (top row above, lower branches below, R₅ on its inner side where that is clear), so a label never sits on its own socket.
    const boxes = new Map<SlotId, Box>()
    for (const id of SLOT_IDS) boxes.set(id, socketBox(id))
    const boardW = wrap.clientWidth, boardFloor = bar.offsetTop - 4
    for (const id of SLOT_IDS) {
      const box = boxes.get(id)!
      const l = labelEls.get(id)!
      const mid = sc.project(SLOTS[id].center.x, REST_Y, SLOTS[id].center.z)
      const w = l.offsetWidth, h = l.offsetHeight
      let mode = labelMode.get(l)!
      if (SLOTS[id].vertical) {
        // R₅'s label sits on its inner side, unless that spot reaches over another socket (on a small board it lands
        // on R₃'s part): then above the socket, else below it. The label keeps its spot while that spot stays clear.
        const cost = (m: LabelMode) => {
          // where the label lands once it is kept on the board (as layoutLabels keeps it)
          const a = hangBox(m, hangFrom(m, box, mid), w, h)
          const l0 = Math.max(4, Math.min(boardW - 4 - w, a.l)), t0 = Math.max(4, Math.min(boardFloor - h, a.t))
          const q = { l: l0, t: t0, r: l0 + w, b: t0 + h }
          if (!owns(id, q, boxes)) return Infinity
          let n = 0
          for (const [o, k] of boxes) if (o !== id) n += overlapArea(q, k)
          return n
        }
        const order: LabelMode[] = ['side', 'top', 'below']
        const costs = order.map(cost)
        const ok = 0.1 * w * h
        const next = costs[0] === 0 ? 'side' : cost(mode) <= ok ? mode : order[costs.findIndex(c => c <= ok)] ?? order[costs.indexOf(Math.min(...costs))] ?? 'side'
        if (next !== mode) {
          mode = next
          labelMode.set(l, mode)
          l.classList.toggle('is-side', mode === 'side')
          l.classList.toggle('is-below', mode === 'below')
        }
      }
      let pos = hangFrom(mode, box, mid)
      if (mode === 'below') {
        // the next socket down (R₄ under R₃) leaves too small a gap on a small board: the label stays as close to
        // its own socket as it can, clipping the front edge of its own pad before it clips the socket below
        const next = SLOT_IDS.map(o => boxes.get(o)!).filter(o => o !== box && o.t >= box.b - 2 && o.l < box.r && box.l < o.r).sort((a, b) => a.t - b.t)[0]
        if (next && next.t - box.b < h + 2 * LABEL_GAP) pos = { x: mid.x, y: Math.max(box.b - 0.4 * h, Math.min(box.b + LABEL_GAP, next.t - h - 2)) }
      }
      labelAnchor.set(l, pos)
    }
    paintSlotBoxes(boxes)
    for (const [d, p] of junctionEls) {
      const q = sc.project(p.x, 0.2, p.z)
      d.style.transform = `translate(${q.x}px, ${q.y}px)`
    }
    // the battery's label sits beside the battery; once the battery is out, on the ghosted battery itself
    const battOut = outK > 0.5
    labelMode.set(battLabel, battOut ? 'center' : 'right')
    labelAnchor.set(battLabel, sc.project(NODES[0]!.x + (battOut ? 0 : 0.95) + BATTERY_SLIDE * outK, 0.5, 0))
    const pl = sc.project(NODES[2]!.x - 0.62, 0.3, NODES[2]!.z - 0.1)
    plusEl.style.transform = `translate(${pl.x}px, ${pl.y}px)`
    const ml = sc.project(NODES[0]!.x - 0.62, 0.3, NODES[0]!.z + 0.1)
    minusEl.style.transform = `translate(${ml.x}px, ${ml.y}px)`
    paintLabels()
    // a floating dial names its part, so the part's own label steps aside instead of peeking out from under it
    const ownHidden = selected && !pop.hidden && !pop.classList.contains('is-docked') ? labelEls.get(selected)! : null
    for (const l of labelEls.values()) { const v = l === ownHidden ? 'hidden' : ''; if (l.style.visibility !== v) l.style.visibility = v }
    layoutLabels(dt, boxes)
    // a docked dial sits in the bar band (CSS); a floating one follows its part and keeps off the labels
    if (selected && !pop.hidden && !pop.classList.contains('is-docked')) placePop(selected)
    if (selected && !pop.hidden) paintEmpty()
    tickUndo(delta)
    cues.frame()
    if (settleWaiters.length && !pendingLand()) { const w = settleWaiters; settleWaiters = []; w.forEach(f => f()) }
  }
  frame.update(loop, true)

  // ---------- first paint: the parts drop in one after another ----------
  commit(false)
  loadSlots(START, 140)

  // dev-only hook for browser checks
  if (import.meta.env.DEV) (el as unknown as Record<string, unknown>).__sim02 = {
    get result() { return result },
    get slots() { return committedSlots() },
    project: (id: SlotId) => { const c = SLOTS[id].center; const p = sc.project(c.x, REST_Y, c.z); const rect = canvas.getBoundingClientRect(); return { x: p.x + rect.left, y: p.y + rect.top } },
    renderer: sc.renderer,
    partCount: () => ({ placed: pieces.size, loose: loose.size, inScene: sc.board.children.filter(c => c.children.length === 2 && c.type === 'Group' && c !== sc.battery).length }),
    rc: clockRC,
    /** Page position of a board-local point at any height (for drag checks that aim the visible part). */
    projectPoint: (x: number, y: number, z: number) => { const p = sc.project(x, y, z); const rect = canvas.getBoundingClientRect(); return { x: p.x + rect.left, y: p.y + rect.top } },
    lift: LIFT,
    restY: REST_Y,
    lockSlot: () => drag?.lockSlot ?? null,
    slotCenter: (id: SlotId) => SLOTS[id].center,
    cameraPose: () => sc.cameraPose(),
    shotPose: (name: ShotName) => sc.shotPose(name === 'overview' ? null : SHOTS[name]),
    pieceY: (id: SlotId) => pieces.get(id)?.view.group.position.y ?? null,
    pieceSquash: (id: SlotId) => pieces.get(id)?.view.inner.scale.y ?? null,
    freeze: () => ({ phase: fzPhase, gate, step: fz?.id ?? null, locked: locked() }),
    glow: (id: SlotId) => (sc.sockets[id].glow.material as THREE.MeshBasicMaterial).opacity,
    /** Board-box px: each socket's screen box and each shown label's box (for label placement checks). */
    boxes: () => ({
      sockets: Object.fromEntries(SLOT_IDS.map(id => [id, socketBox(id)])),
      labels: Object.fromEntries(SLOT_IDS.map(id => [id, labelEls.get(id)!.style.visibility === 'hidden' ? null : labelBox.get(labelEls.get(id)!) ?? null])),
      batt: labelBox.get(battLabel) ?? null,
    }),
  }

  active = {
    unmount() {
      cancelFrame(loop)
      sc.controls.removeEventListener('start', onOrbitStart)
      cues.dispose()
      for (const t of timers) clearTimeout(t)
      for (const a of anims) a.stop()
      ro.disconnect()
      dprMq?.removeEventListener('change', onDpr)
      reduced.removeEventListener('change', onMotionPref)
      wrap.removeEventListener('pointerdown', onWrapDown, { capture: true })
      wrap.removeEventListener('pointermove', onWrapMove)
      wrap.removeEventListener('pointerup', onWrapUp)
      wrap.removeEventListener('pointercancel', onWrapUp)
      wrap.removeEventListener('pointerleave', onWrapLeave)
      el.removeEventListener('keydown', onRootKey)
      document.removeEventListener('keydown', onUndoKey)
      dockedMq.removeEventListener('change', onDockedChange)
      clearBtn.removeEventListener('pointerenter', onClearEnter)
      clearBtn.removeEventListener('pointerleave', onClearLeave)
      window.clearTimeout(statusTimer)
      window.clearTimeout(fillTimer)
      el.removeEventListener('scroll', onBoxScroll)
      for (const p of [...pieces.values(), ...loose]) p.view.dispose()
      guide?.dispose()
      panel.dispose()
      hud.dispose()
      timeMod.dispose()
      sc.dispose()
      el.innerHTML = ''
      el.classList.remove('sim02')
      active = null
    },
  }
}

export function unmount(): void {
  active?.unmount()
}
