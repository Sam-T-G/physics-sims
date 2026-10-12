// Layer 3: the app. Owns state, input, springs and the page. Motion lives here and in panel.ts only.

import * as THREE from 'three'
import { animate, springValue, motionValue, frame, cancelFrame, type MotionValue } from 'motion'
import {
  solveBoard, SLOTS, SLOT_IDS, OHM_STEPS, FARAD_STEPS, PRESETS, NODES,
  type BoardResult, type Part, type Slots, type SlotId, type Pt, type Preset,
} from './board'
import { createScene, REST_Y, type PieceView, type Scene } from './scene'
import { createPanel, type Panel } from './panel'
import { createHud } from './hud'
import { createTimeModule, type RcClock } from './timeModule'
import { relaxVoltage } from '@lib/physics'
import { colorBands, BAND_HEX } from './colorCode'
import { sig, sig3, exact, reading, SUB } from './format'
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

/** What a part is called in sentences: "4 Ω resistor", "wire", "0.5 F capacitor". */
const partLabel = (p: Part) => (p.kind === 'wire' ? 'wire' : p.kind === 'resistor' ? `${p.ohms} Ω resistor` : `${p.farads} F capacitor`)

const START: Slots = {
  R1: { kind: 'resistor', ohms: 2 },
  R2: { kind: 'resistor', ohms: 6 },
  R5: { kind: 'wire' },
}

const MAGNET = 1.6 // board units: a part starts leaning toward a socket inside this radius
const LOCK = 0.62 // and clicks into it inside this one
const LIFT = 0.95

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
        <button class="sim02-recenter" type="button">Reset view</button>
      </div>
      <div class="sim02-hud-slot"></div>
      <div class="sim02-dock">
        <p class="sim02-dock-hint">Drag a part onto a glowing slot<span class="sim02-long">, or tap a part, then tap a slot</span>.</p>
        <div class="sim02-tray" role="toolbar" aria-label="Parts"></div>
      </div>
    </div>
    <aside class="sim02-notebook">
      <header class="sim02-head">
        <h1>${meta.title}</h1>
        <p>Drag resistors, wires and a capacitor onto the board. Every number below is calculated from the circuit on the board, using the equations in OpenStax Chapter 10.</p>
      </header>
      <section class="sim02-battery" aria-label="Battery">
        <h2><span class="sim02-mini-batt" aria-hidden="true"></span>Battery</h2>
        <label class="sim02-slider"><span class="sim02-slider-name">Battery voltage (emf), <i>ε</i></span><output class="sim02-out" data-for="emf"></output>
          <input type="range" name="emf" min="1" max="24" step="0.5" /></label>
        <label class="sim02-slider"><span class="sim02-slider-name">Battery's internal resistance, <i>r</i></span><output class="sim02-out" data-for="r"></output>
          <input type="range" name="r" min="0" max="2" step="0.05" /></label>
        <p class="sim02-small">Most book examples use <i>r</i> = 0 (an ideal battery).</p>
      </section>
      <div class="sim02-time-slot"></div>
      <div class="sim02-preview-pill" aria-hidden="true">Preview: release to place the part</div>
      <header class="sim02-notes-head">
        <h2>Equations</h2>
        <p class="sim02-small">Point at a symbol such as <i>R</i><sub>2</sub> to highlight that part on the board.</p>
      </header>
      <div class="sim02-eqs-slot"></div>
      <section class="sim02-book" aria-label="Book examples">
        <h2>Book examples</h2>
        <p class="sim02-small">Each button builds a worked example from the book and compares the book's answers with the sim's.</p>
        <div class="sim02-presets"></div>
        <div class="sim02-compare" hidden></div>
        <button class="sim02-clear" type="button">Clear the board</button>
      </section>
      <details class="sim02-approx">
        <summary>Simplifications</summary>
        <ul>
          <li>Wires have 0 Ω. Inside the calculation each fixed wire is 0.1 µΩ so the solver can split current between wires; no displayed digit changes.</li>
          <li>The battery is an ideal emf ε in series with one internal resistance <i>r</i> (the Section 10.1 model).</li>
          <li>Resistors keep a fixed <i>R</i> (<i>V</i> = <i>IR</i>) even when they heat up.</li>
          <li>The capacitor values are in farads (supercapacitor size) so the time constant τ lasts seconds. The 5× and 25× buttons speed up the clock.</li>
          <li>The moving dots show the direction of conventional current, and the dot speed shows the current's size compared with the rest of the board. Real electron drift is much slower.</li>
          <li>Each check mark compares a book equation with a full solve of the board (the junction rule, Eq 10.4, at every junction).</li>
        </ul>
      </details>
    </aside>`

  const $ = <T extends Element>(s: string) => el.querySelector<T>(s)!
  const canvas = $<HTMLCanvasElement>('.sim02-canvas')
  const wrap = $<HTMLDivElement>('.sim02-canvas-wrap')
  const labelsEl = $<HTMLDivElement>('.sim02-labels')
  const slotsEl = $<HTMLDivElement>('.sim02-slots')
  const pop = $<HTMLDivElement>('.sim02-pop')
  const statusEl = $<HTMLParagraphElement>('.sim02-status')
  const trayEl = $<HTMLDivElement>('.sim02-tray')
  const emfIn = $<HTMLInputElement>('input[name=emf]')
  const rIn = $<HTMLInputElement>('input[name=r]')
  const compare = $<HTMLDivElement>('.sim02-compare')

  const scene: Scene | null = createScene(canvas, Math.min(window.devicePixelRatio || 1, 2))
  if (!scene) {
    wrap.innerHTML = '<p class="sim02-nogl">This sim needs WebGL, and this browser could not start WebGL. Try a recent Chrome, Safari or Firefox.</p>'
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
  const timers = new Set<number>()
  const later = (ms: number, fn: () => void) => { const t = window.setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }
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
  const ringPulse = (id: SlotId) => {
    const ring = sc.sockets[id].ring
    const mat = ring.material as THREE.MeshBasicMaterial
    const o = { s: 0.8, a: 0.9 }
    run(animate(o, { s: reduce ? 1 : 2.1, a: 0 }, {
      duration: reduce ? 0.2 : 0.6, ease: 'easeOut',
      onUpdate: () => { ring.scale.setScalar(o.s); mat.opacity = o.a },
    }))
  }
  const poof = (p: Piece) => {
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
  const clockRC: RcClock = { t: 0, V0: 0, I0: 0, Voc: 0, tau: Infinity, speed: 1, batteryIn: true, trace: [] }
  let capV = 0
  let circuitKey = ''
  const capOnBoard = () => [...pieces.values(), ...(drag ? [drag.piece] : [])].some(p => p.view.part.kind === 'capacitor' && !p.dead)
  const solveWith = (slots: Slots) => solveBoard({ emf, r, slots, capV, batteryIn: clockRC.batteryIn })
  const anchor = () => {
    const k = result.cap
    clockRC.t = 0
    clockRC.trace = []
    if (!k) return
    capV = k.Vc
    clockRC.V0 = k.Vc; clockRC.I0 = k.Ic; clockRC.Voc = k.Voc; clockRC.tau = k.tau
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
    const key = JSON.stringify([emf, r, clockRC.batteryIn, SLOT_IDS.map(id => slots[id] ?? null)])
    // a preview (a part hovering over a slot) never moves the capacitor's charge; the commit re-anchors
    if (!opts.preview && (key !== circuitKey || result.cap?.snapped)) { circuitKey = key; anchor() }
    preview = opts.preview
    el.classList.toggle('is-previewing', preview)
    panel.update({ b: result, slots, selected, rc: clockRC }, { preview, animate: opts.animate ?? true })
    timeMod.update(result.cap, clockRC)
    paintStatus(slots)
    paintSlotButtons(slots)
    paintTray()
    hud.update(result, slots, selected ?? linked, opts.animate ?? true)
  }
  const commit = (animateNums = true) => apply(committedSlots(), { preview: false, animate: animateNums })

  const paintStatus = (slots: Slots) => {
    const b = result
    let msg = ''
    if (b.idealShort) msg = 'Short circuit with r = 0: the current has no limit. Raise r or remove a wire.'
    else if (b.status === 'short') msg = `Short circuit: only the battery's internal resistance r = ${exact(r)} Ω limits the current.`
    else if (b.status === 'open') {
      const g = b.gaps.map(x => (x === 'lanes' ? 'every branch slot (R₂, R₃, R₄)' : `slot ${SUB[x]}`)).join(' and ')
      const draining = b.cap && b.cap.Ic !== 0
      msg = draining
        ? `The battery is cut off (${g} ${b.gaps.length > 1 ? 'are' : 'is'} empty). The capacitor discharges through the branches still connected to the capacitor.`
        : `The circuit is open: ${g} ${b.gaps.length > 1 ? 'are' : 'is'} empty, so no current flows.`
    } else if (b.batteryOut) msg = 'Battery out: the capacitor discharges through the resistors.'
    else if (b.bypassed.length) msg = `The wire in a branch carries all the current, so ${b.bypassed.map(id => SUB[id]).join(' and ')} get${b.bypassed.length > 1 ? '' : 's'} 0 A.`
    statusEl.textContent = msg
    statusEl.classList.toggle('is-on', !!msg)
    statusEl.classList.toggle('is-warn', b.status !== 'ok' || b.bypassed.length > 0 || b.batteryOut)
    void slots
  }

  // ---------- HUD ----------
  const hud = createHud(() => reduce)
  $('.sim02-hud-slot').replaceWith(hud.el)
  const timeMod = createTimeModule({
    onBattery: v => { if (clockRC.batteryIn === v) return; clockRC.batteryIn = v; commit() },
    onSpeed: n => { clockRC.speed = n; timeMod.update(result.cap, clockRC) },
    onEmpty: () => { capV = 0; circuitKey = ''; commit() },
  })
  $('.sim02-time-slot').replaceWith(timeMod.el)

  // ---------- panel ----------
  const panel: Panel = createPanel(id => setLinked(id))
  $('.sim02-eqs-slot').replaceWith(panel.el)
  const setLinked = (id: SlotId | null) => {
    linked = id
    for (const [sid, p] of pieces) p.view.setHighlight(sid === id || sid === selected)
    panel.setLinked(id)
    labelEls.forEach((l, sid) => l.classList.toggle('is-linked', sid === id))
    hud.update(result, shown, selected ?? linked, true)
  }
  const partName = (slots: Slots, id: SlotId) => (slots[id]?.kind === 'capacitor' ? 'C' : SUB[id]!)

  // ---------- battery sliders ----------
  const syncSliders = () => {
    emfIn.value = String(emf)
    rIn.value = String(r)
    $('output[data-for=emf]').textContent = `${sig3(emf)} V`
    $('output[data-for=r]').textContent = `${exact(r)} Ω`
  }
  // mid-drag, keep showing the preview of the part in hand
  const onEmf = () => { emf = Number(emfIn.value); syncSliders(); if (drag) updatePreview(); else commit() }
  const onR = () => { r = Number(rIn.value); syncSliders(); if (drag) updatePreview(); else commit() }
  emfIn.addEventListener('input', onEmf)
  rIn.addEventListener('input', onR)
  syncSliders()

  // ---------- labels over the board ----------
  const labelEls = new Map<SlotId, HTMLDivElement>()
  for (const id of SLOT_IDS) {
    const l = document.createElement('div')
    l.className = 'sim02-label'
    l.dataset.slot = id
    if (SLOTS[id].vertical) l.classList.add('is-side')
    if (id === 'R3' || id === 'R4') l.classList.add('is-below')
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
  labelsEl.appendChild(battLabel)
  const plusEl = document.createElement('div')
  plusEl.className = 'sim02-terminal'
  plusEl.textContent = '+'
  const minusEl = document.createElement('div')
  minusEl.className = 'sim02-terminal'
  minusEl.textContent = '−'
  labelsEl.append(plusEl, minusEl)

  const paintLabels = () => {
    for (const id of SLOT_IDS) {
      const l = labelEls.get(id)!
      const p = pieces.get(id)
      const rd = result.slots[id]
      const part = p?.view.part
      const name = `<b>${part?.kind === 'capacitor' ? 'C' : SUB[id]}</b>`
      if (!p || !part) { l.innerHTML = `${name}<span class="sim02-label-empty">empty</span>`; l.classList.add('is-empty'); delete l.dataset.html; continue }
      l.classList.remove('is-empty')
      const val = part.kind === 'wire' ? 'wire' : part.kind === 'resistor' ? `${exact(part.ohms)} Ω` : `${exact(part.farads)} F`
      const read = !rd ? '' : !Number.isFinite(rd.I) ? '∞ A' : part.kind === 'wire' ? reading(rd.I, 'A') : `${reading(rd.I, 'A')}, ${reading(rd.V, 'V')}`
      const html = `<span class="sim02-label-top">${name}<span class="sim02-label-val">${val}</span></span>${read ? `<span class="sim02-label-read">${read}</span>` : ''}`
      if (l.dataset.html !== html) { l.innerHTML = html; l.dataset.html = html }
    }
    battLabel.innerHTML = result.batteryOut ? 'Battery out' : `<i>ε</i> = ${sig3(emf)} V${r > 0 ? `<br><i>r</i> = ${exact(r)} Ω` : ''}`
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
    b.addEventListener('click', () => onSlotButton(id))
    b.addEventListener('keydown', e => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && pieces.has(id)) { e.preventDefault(); removeFromSlot(id) }
    })
  }
  const paintSlotButtons = (slots: Slots) => {
    for (const id of SLOT_IDS) {
      const p = slots[id]
      const what = !p ? 'empty' : `holds a ${partLabel(p)}`
      const action = holding ? `Press to place the ${partLabel(holding)} here.` : p ? `Press to change or remove the ${partLabel(p)}.` : 'Pick a part from the tray first.'
      slotBtns.get(id)!.setAttribute('aria-label', `Slot ${SUB[id]}, ${what}. ${action}`)
    }
  }
  const onSlotButton = (id: SlotId) => {
    if (holding) { placeFromTray(holding, id); endHold(); commit(); return }
    if (pieces.has(id)) select(id)
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
    trayEl.appendChild(b)
    b.addEventListener('pointerdown', e => onChipDown(e, item.part, b))
    b.addEventListener('click', e => {
      // pointer taps are handled in onChipDown/up; this is the keyboard path
      if ((e as MouseEvent).detail === 0) startHold(item.part, b)
    })
  })

  // only one capacitor at a time: its chip greys out while a capacitor is on the board
  const paintTray = () => {
    const capChip = trayEl.querySelector<HTMLButtonElement>('[data-cap]')
    if (!capChip) return
    const on = capOnBoard()
    capChip.disabled = on
    capChip.title = on ? 'One capacitor at a time: remove the capacitor on the board first.' : ''
  }

  const startHold = (part: Part, chip: HTMLButtonElement) => {
    if (holdingChip === chip) { endHold(); return }
    endHold()
    deselect()
    holding = part
    holdingChip = chip
    chip.classList.add('is-holding')
    chip.setAttribute('aria-pressed', 'true')
    el.classList.add('is-holding')
    paintSlotButtons(committedSlots())
    statusEl.textContent = `Tap a slot on the board for the ${partLabel(part)}. Tap the ${partLabel(part)} in the tray again to cancel.`
    statusEl.classList.add('is-on')
    statusEl.classList.remove('is-warn')
    slotBtns.get(SLOT_IDS.find(id => !pieces.has(id)) ?? 'R1')!.focus({ preventScroll: true })
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
  const nearestSlot = (p: Pt, exclude: Piece) => {
    let best: SlotId | null = null
    let bd = Infinity
    for (const id of SLOT_IDS) {
      const c = SLOTS[id].center
      // sockets are long, so measure to the segment, not the center: easier to hit
      const halfLen = 0.5
      const dx = SLOTS[id].vertical ? p.x - c.x : Math.max(0, Math.abs(p.x - c.x) - halfLen)
      const dz = SLOTS[id].vertical ? Math.max(0, Math.abs(p.z - c.z) - halfLen) : p.z - c.z
      const d = Math.hypot(dx, dz)
      if (d < bd && pieces.get(id) !== exclude) { bd = d; best = id }
    }
    return { id: best, d: bd }
  }

  // ---------- dragging ----------
  const beginDrag = (piece: Piece, e: PointerEvent, from: SlotId | null, fromTray: boolean, captureEl: HTMLElement) => {
    endHold()
    deselect()
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
    const { id, d: dd } = nearestSlot(p, d.piece)
    let tx = p.x, tz = p.z, ty = REST_Y + LIFT
    let lock: SlotId | null = null
    if (id && dd < MAGNET) {
      const c = SLOTS[id].center
      if (dd < LOCK) {
        lock = id
        tx = c.x; tz = c.z; ty = REST_Y + 0.28
      } else {
        // the pull grows smoothly as you get closer: the magnet feel
        const u = 1 - (dd - LOCK) / (MAGNET - LOCK)
        const pull = u * u * (3 - 2 * u) * 0.55
        tx = p.x + (c.x - p.x) * pull
        tz = p.z + (c.z - p.z) * pull
        ty = REST_Y + LIFT - pull * 0.5
      }
    }
    d.near = id && dd < MAGNET ? id : null
    d.piece.tx.set(tx); d.piece.tz.set(tz); d.piece.ty.set(ty)
    if (lock !== d.lockSlot) {
      d.lockSlot = lock
      if (lock) {
        d.piece.tr.set(SLOTS[lock].vertical ? Math.PI / 2 : 0)
        squish(d.piece, 0.86)
        navigator.vibrate?.(8)
      } else {
        d.piece.tr.set(0)
      }
      updatePreview()
    }
  }

  /** While dragging, show what the circuit would be if you let go right now. */
  const updatePreview = () => {
    if (!drag) return
    const s = committedSlots()
    const lock = drag.lockSlot
    if (lock) {
      // a part already there swaps to where this one came from (or leaves the board)
      const occupant = pieces.get(lock)
      if (occupant && drag.from) s[drag.from] = occupant.view.part
      s[lock] = drag.piece.view.part
    }
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
    if (lock) {
      const occupant = pieces.get(lock)
      if (occupant) {
        if (d.from) {
          if (occupant.view.part.kind === 'capacitor' && SLOTS[d.from].vertical !== SLOTS[lock].vertical) capV = -capV
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
      if (d.piece.view.part.kind === 'capacitor' && d.from && SLOTS[d.from].vertical !== SLOTS[lock].vertical) capV = -capV
      sendTo(d.piece, lock)
      squish(d.piece, 0.62)
      jiggle(d.piece, 0.1)
      ringPulse(lock)
      selected = null
      commit()
    } else {
      poof(d.piece)
      commit()
    }
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
    beginDrag(piece, e, piece.slot, false, wrap)
  }
  const onWrapMove = (e: PointerEvent) => {
    if (drag) { moveDrag(e); return }
    if (e.pointerType !== 'mouse' || e.target !== canvas) return
    const hit = sc.pickPiece(toNdc(e.clientX, e.clientY), [...pieces.values()].map(p => p.view))
    const p = hit ? [...pieces.values()].find(q => q.view === hit) ?? null : null
    if (p !== hovered) {
      hovered = p
      wrap.classList.toggle('is-grabbable', !!p)
      if (p) { jiggle(p, 0.08); run(animate(p.scale, [1, 1.06, 1.03], { duration: 0.35 })) }
      for (const q of pieces.values()) if (q !== p) run(animate(q.scale, 1, { duration: 0.2 }))
      setLinked(p?.slot ?? null)
    }
  }
  const onWrapUp = (e: PointerEvent) => endDrag(e, e.type === 'pointercancel')
  wrap.addEventListener('pointerdown', onWrapDown, { capture: true })
  wrap.addEventListener('pointermove', onWrapMove)
  wrap.addEventListener('pointerup', onWrapUp)
  wrap.addEventListener('pointercancel', onWrapUp)

  let batteryKick = 0
  const jiggleBattery = () => {
    if (reduce) return
    const o = { k: 1 }
    run(animate(o, { k: 0 }, { duration: 0.6, onUpdate: () => { batteryKick = o.k } }))
  }

  // ---------- tray chips: drag out, or tap to hold ----------
  const onChipDown = (e: PointerEvent, part: Part, chip: HTMLButtonElement) => {
    if (e.button !== 0 || drag) return
    e.preventDefault()
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
      else if (ev.type === 'pointerup') startHold(part, chip)
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
    if (delayMs) later(delayMs, land)
    else land()
    return p
  }

  // ---------- selection and the value dial ----------
  const select = (id: SlotId) => {
    endHold()
    selected = id
    for (const [sid, p] of pieces) p.view.setHighlight(sid === id || sid === linked)
    renderPop()
    commit(false)
  }
  const deselect = () => {
    if (!selected) return
    selected = null
    pop.hidden = true
    for (const [sid, p] of pieces) p.view.setHighlight(sid === linked)
    commit(false)
  }
  const renderPop = () => {
    const p = selected ? pieces.get(selected) : null
    if (!p || !selected) { pop.hidden = true; return }
    const id = selected
    const part = p.view.part
    pop.hidden = false
    const dial = (name: string, what: string, unitWord: string, unit: string, steps: readonly number[], value: number) => `
         <p class="sim02-pop-name">${name}</p>
         <div class="sim02-dial" role="group" aria-label="${name} ${what}">
           <button type="button" data-step="-1" aria-label="Lower ${what}">−</button>
           <output role="spinbutton" tabindex="0" aria-label="${name} ${what}" aria-valuemin="${steps[0]}" aria-valuemax="${steps[steps.length - 1]}" aria-valuenow="${value}" aria-valuetext="${exact(value)} ${unitWord}">${exact(value)} ${unit}</output>
           <button type="button" data-step="1" aria-label="Higher ${what}">+</button>
         </div>
         <button type="button" class="sim02-pop-remove">Remove ${name}</button>`
    pop.innerHTML = part.kind === 'resistor'
      ? dial(SUB[id]!, 'resistance', 'ohms', 'Ω', OHM_STEPS, part.ohms)
      : part.kind === 'capacitor'
        ? dial('Capacitor', 'capacitance', 'farads', 'F', FARAD_STEPS, part.farads)
        : `<p class="sim02-pop-name">Wire in ${SUB[id]}</p><p class="sim02-small">Wires are 0 Ω and have no setting.</p><button type="button" class="sim02-pop-remove">Remove the wire</button>`
    if (!reduce) run(animate(pop, { scale: [0.6, 1], opacity: [0, 1] }, { type: 'spring', stiffness: 420, damping: 20 }))
    pop.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(b => b.addEventListener('click', () => stepOhms(Number(b.dataset.step))))
    pop.querySelector<HTMLButtonElement>('.sim02-pop-remove')!.addEventListener('click', () => removeFromSlot(id))
    pop.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }
  const stepOhms = (dir: number) => {
    if (!selected) return
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
    const unit = part.kind === 'resistor' ? ['Ω', 'ohms'] : ['F', 'farads']
    out.textContent = `${exact(next)} ${unit[0]}`
    out.setAttribute('aria-valuenow', String(next))
    out.setAttribute('aria-valuetext', `${exact(next)} ${unit[1]}`)
    commit()
  }
  const removeFromSlot = (id: SlotId) => {
    const p = pieces.get(id)
    if (!p) return
    pieces.delete(id)
    poof(p)
    if (selected === id) { selected = null; pop.hidden = true }
    commit()
    slotBtns.get(id)?.focus({ preventScroll: true })
  }
  const onPopKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === '+' || e.key === '=') { e.preventDefault(); stepOhms(1) }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown' || e.key === '-') { e.preventDefault(); stepOhms(-1) }
    else if (e.key === 'Escape') { const id = selected; deselect(); if (id) slotBtns.get(id)?.focus() }
  }
  pop.addEventListener('keydown', onPopKey)
  const onRootKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { endHold(); deselect() } }
  el.addEventListener('keydown', onRootKey)

  // ---------- presets ----------
  const loadSlots = (slots: Slots, stagger = 110) => {
    deselect()
    endHold()
    let k = 0
    for (const [id, p] of [...pieces]) { pieces.delete(id); later(k++ * 40, () => poof(p)) }
    let n = 0
    for (const id of SLOT_IDS) {
      const part = slots[id]
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
    b.addEventListener('click', () => loadPreset(pr))
    presetBox.appendChild(b)
  })
  const loadPreset = (pr: Preset) => {
    emf = pr.input.emf
    r = pr.input.r
    syncSliders()
    loadSlots(pr.input.slots)
    const b = solveBoard(pr.input)
    compare.hidden = false
    compare.innerHTML = `<p class="sim02-small">${pr.title}: the book's printed answers next to the sim's results. The sim column has one extra digit, which shows where the book rounded.</p><table><thead><tr><th scope="col">Quantity</th><th scope="col">Book</th><th scope="col">Sim</th></tr></thead><tbody>${pr.book
      .map(v => `<tr><th scope="row">${v.label.replace('_terminal', '<sub>terminal</sub>').replace('_P', '<sub>P</sub>').replace('_eq', '<sub>eq</sub>')}</th><td>${v.value}</td><td>${sig(v.of(b), 4)} ${v.unit}</td></tr>`)
      .join('')}</tbody></table>`
    if (!reduce) run(animate(compare, { opacity: [0, 1], y: [8, 0] }, { duration: 0.4 }))
  }
  const onClear = () => { compare.hidden = true; loadSlots({}) }
  $('.sim02-clear').addEventListener('click', onClear)
  const onRecenter = () => sc.resetView()
  $('.sim02-recenter').addEventListener('click', onRecenter)

  // ---------- layout ----------
  let portrait: boolean | null = null
  let lastW = 0, lastH = 0
  const ro = new ResizeObserver(() => {
    const w = wrap.clientWidth, h = wrap.clientHeight
    // on wide screens the HUD floats over the board's top edge, so keep that strip clear
    el.style.setProperty('--sim02-stage-h', `${$('.sim02-stage').getBoundingClientRect().height}px`)
    const floating = getComputedStyle(hud.el).position === 'absolute'
    sc.setInsetTop(floating ? hud.el.offsetHeight + 34 : 0)
    const p = w / Math.max(1, h) < 0.82
    if (p !== portrait) { portrait = p; sc.setPortrait(p) }
    // only a real size change re-fits (and resets the view); the HUD's width changes with its text
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; sc.resize(w, h) }
  })
  ro.observe(wrap)
  ro.observe(hud.el)
  const onMotionPref = () => { reduce = reduced.matches }
  reduced.addEventListener('change', onMotionPref)

  // ---------- one clock ----------
  let blinkAt = 2500
  let blinkUntil = 0
  let clock = 0
  let lastPanelPaint = 0
  const loop = ({ delta }: { delta: number }) => {
    const dt = Math.min(delta, 100) / 1000
    clock += delta
    // the capacitor moves along its exponential; the whole board is re-solved at the new V_C
    const kc = result.cap
    if (kc && !preview && Number.isFinite(clockRC.tau) && clockRC.tau > 0 && clockRC.t < 6 * clockRC.tau) {
      clockRC.t = Math.min(6 * clockRC.tau, clockRC.t + dt * clockRC.speed)
      // at 6τ the curve is 0.25% from the end; land on the end exactly so no stray current stays on screen
      capV = clockRC.t >= 6 * clockRC.tau ? clockRC.Voc : relaxVoltage(clockRC.V0, clockRC.Voc, clockRC.tau, clockRC.t)
      result = solveWith(shown)
      const last = clockRC.trace[clockRC.trace.length - 1]
      if (!last || clockRC.t - last.t >= (5 * clockRC.tau) / 240) clockRC.trace.push({ t: clockRC.t, I: result.cap!.Ic, V: result.cap!.Vc })
      hud.update(result, shown, selected ?? linked, false, true)
      timeMod.update(result.cap, clockRC)
      // the typeset equations re-render about 8 times a second, not every frame
      if (clock - lastPanelPaint > 120 || clockRC.t >= 6 * clockRC.tau) {
        lastPanelPaint = clock
        panel.update({ b: result, slots: shown, selected, rc: clockRC }, { preview: false, animate: false })
      }
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
    // socket glow: bright when a dragged or held part could go there
    for (const id of SLOT_IDS) {
      const s = sc.sockets[id]
      let goal = 0
      if (drag?.moved) goal = drag.lockSlot === id ? 0.85 : drag.near === id ? 0.45 : pieces.has(id) ? 0 : 0.16
      else if (holding) goal = 0.35 + 0.25 * Math.sin(clock / 260)
      else if (result.gaps.includes(id)) goal = 0.18 + 0.12 * Math.sin(clock / 400)
      const m = s.glow.material as THREE.MeshBasicMaterial
      m.opacity += (goal - m.opacity) * (1 - Math.exp(-dt * 12))
      const padScale = 1 + m.opacity * 0.08
      s.glow.scale.set(padScale, 1, padScale)
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
    sc.updateDots(wireI, slotI, arches, dt, reduce)
    // battery: blink now and then, sleepy with no current, panicking on a short
    if (clock > blinkAt) { blinkUntil = clock + 140; blinkAt = clock + 2800 + Math.random() * 2600 }
    const mood = result.status === 'short' ? 'yikes' : result.status === 'open' || result.batteryOut || result.I === 0 ? 'sleepy' : 'happy'
    sc.setBatteryMood(mood, clock < blinkUntil)
    const shake = result.status === 'short' && !reduce ? 0.03 * Math.sin(clock / 22) : 0
    sc.battery.position.x = NODES[0]!.x + shake
    sc.battery.scale.setScalar((result.batteryOut ? 0.82 : 1) + batteryKick * 0.08 * Math.sin(clock / 40))
    sc.render()
    // DOM overlays follow the board
    for (const id of SLOT_IDS) {
      const c = SLOTS[id].center
      const v = SLOTS[id].vertical
      // top-row labels sit above their part, the lower branches below theirs, R₅ on its inner side
      const below = id === 'R3' || id === 'R4'
      const pos = sc.project(c.x - (v ? 0.62 : 0), REST_Y + (v ? 0.1 : 0.62), c.z + (v ? 0.3 : below ? 0.62 : -0.5))
      const l = labelEls.get(id)!
      l.style.transform = `translate(${pos.x}px, ${pos.y}px)`
      const b = slotBtns.get(id)!
      const bp = sc.project(c.x, REST_Y, c.z)
      b.style.transform = `translate(${bp.x}px, ${bp.y}px)`
    }
    for (const [d, p] of junctionEls) {
      const q = sc.project(p.x, 0.2, p.z)
      d.style.transform = `translate(${q.x}px, ${q.y}px)`
    }
    const bl = sc.project(NODES[0]!.x + 0.95, 0.5, 0)
    battLabel.style.transform = `translate(${bl.x}px, ${bl.y}px)`
    const pl = sc.project(NODES[2]!.x - 0.62, 0.3, NODES[2]!.z - 0.1)
    plusEl.style.transform = `translate(${pl.x}px, ${pl.y}px)`
    const ml = sc.project(NODES[0]!.x - 0.62, 0.3, NODES[0]!.z + 0.1)
    minusEl.style.transform = `translate(${ml.x}px, ${ml.y}px)`
    if (selected && !pop.hidden) {
      const c = SLOTS[selected].center
      const pp = sc.project(c.x, REST_Y + 0.4, c.z)
      // flip below the part when the dial would not fit above it
      const below = pp.y < pop.offsetHeight + 28
      pop.classList.toggle('is-below', below)
      const at = below ? sc.project(c.x, 0, c.z + 0.35) : pp
      // left/top, not transform: Motion's pop-in scale owns the transform property
      pop.style.left = `${Math.max(pop.offsetWidth / 2 + 8, Math.min(wrap.clientWidth - pop.offsetWidth / 2 - 8, at.x))}px`
      pop.style.top = `${at.y}px`
    }
    paintLabels()
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
    pieceY: (id: SlotId) => pieces.get(id)?.view.group.position.y ?? null,
    pieceSquash: (id: SlotId) => pieces.get(id)?.view.inner.scale.y ?? null,
  }

  active = {
    unmount() {
      cancelFrame(loop)
      for (const t of timers) clearTimeout(t)
      for (const a of anims) a.stop()
      ro.disconnect()
      reduced.removeEventListener('change', onMotionPref)
      wrap.removeEventListener('pointerdown', onWrapDown, { capture: true })
      wrap.removeEventListener('pointermove', onWrapMove)
      wrap.removeEventListener('pointerup', onWrapUp)
      wrap.removeEventListener('pointercancel', onWrapUp)
      el.removeEventListener('keydown', onRootKey)
      for (const p of [...pieces.values(), ...loose]) p.view.dispose()
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
