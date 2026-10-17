// Layer 3: the HUD. Four big readouts for the whole circuit, for one part while you point at it or tap it,
// or for the capacitor while one is on the board. Numbers count to new values and flash, like the notebook.

import { animate } from 'motion'
import type { BoardResult, Slots, SlotId } from './board'
import { sig3, exact, unitPrefix, SUB } from './format'
import { FREE, type Mask, type MaskState } from './freeze'

type Kind = 'I' | 'V' | 'R' | 'P' | 'Q' | 'T'
/** One tile: what it measures, its value, a short note that names the component, and the quantity keys of its value
 *  (freeze.ts), so a prediction can tag or cover it. */
export type TileSpec = { kind: Kind; name: string; sym: string; value: number; unit: string; note: string; exact?: boolean; keys: string[]
  /** What a screen reader calls the tile when the prediction tags or covers it, when name + note would read oddly. */
  label?: string }
type Tile = {
  el: HTMLElement; name: HTMLElement; read: HTMLElement; value: HTMLElement; unit: HTMLElement; note: HTMLElement; icon: HTMLElement; sr: HTMLElement
  /** The note as last written (it can hold markup: a part phones leave out). */
  noteHtml: string
  last: number | null; lastScale?: number; lastMilli?: boolean; kind: Kind | null
  /** The flash running on this tile (a pop of the number and a fade of the background), stopped before the next. */
  flash: { stop(): void }[]
  /** What the prediction does to this tile now. `lift`: the one tween that writes this tile's number (a count to a
   *  new value, or the count-up when a cover lifts), and `liftTo` the value it lands on. */
  masked: MaskState; lift: { stop(): void } | null; liftTo: number
  /** The running count is a cover lifting: it counts up to whatever the tile's value is on each frame. */
  liftCover: boolean
}

const ICON: Record<Kind, string> = {
  I: '<path d="M3 12h13"/><path d="M12 7l5 5-5 5"/><circle cx="6" cy="12" r="1.6"/>',
  V: '<path d="M4 18h5V12h5V6h6"/><path d="M17 3l3 3-3 3"/>',
  R: '<path d="M2 12h4l2-4 3 8 3-8 3 8 2-4h3"/>',
  P: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 3 3 4 1-3 1-5 1-8z"/>',
  Q: '<path d="M9 4v16M15 4v16M3 12h6M15 12h6"/>',
  T: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
}

export type Hud = {
  el: HTMLElement
  /** `focus`: the part being pointed at or tapped, if any. `live`: numbers change every frame (no flash).
   *  `mask`: what an open prediction tags or covers. */
  update(b: BoardResult, slots: Slots, focus: SlotId | null, animateIt: boolean, live?: boolean, mask?: Mask): void
  /** The title chip says this for a moment, then goes back (a press the frozen board refused). */
  flashChip(text: string, ms: number): void
  /** A number is still counting to its value. */
  counting(): boolean
  /** True while keyboard focus walks the slot buttons: the title follows the focus without being read aloud (each
   *  slot button's own name already carries the reading). */
  quiet(on: boolean): void
  dispose(): void
}

const partName = (slots: Slots, id: SlotId): string => (slots[id]?.kind === 'capacitor' ? 'C' : SUB[id]!)

export function specsFor(b: BoardResult, slots: Slots, focus: SlotId | null): { title: string; status: string; tiles: TileSpec[] } {
  const part = focus ? slots[focus] : undefined
  if (focus && part) {
    const rd = b.slots[focus]
    const n = partName(slots, focus)
    if (part.kind === 'capacitor') {
      return {
        title: 'Capacitor', status: `${exact(part.farads)} F`,
        tiles: [
          { kind: 'I', name: 'Current', sym: 'I_C', value: rd?.I ?? 0, unit: 'A', note: 'into the capacitor', keys: ['Ic', `I@${focus}`], label: 'Capacitor current' },
          { kind: 'V', name: 'Voltage', sym: 'V_C', value: rd?.V ?? 0, unit: 'V', note: 'across the capacitor', keys: ['Vc', `V@${focus}`] },
          { kind: 'Q', name: 'Charge', sym: 'q', value: b.cap?.q ?? 0, unit: 'C', note: 'stored on the plates', keys: ['q'], label: 'Charge on the capacitor' },
          { kind: 'T', name: 'Time constant', sym: 'τ', value: b.cap?.tau ?? Infinity, unit: 's', note: 'τ = RC', keys: ['tau'], label: 'Time constant' },
        ],
      }
    }
    const ohms = part.kind === 'wire' ? 0 : part.ohms
    return {
      title: n, status: part.kind === 'wire' ? 'wire' : 'resistor',
      tiles: [
        { kind: 'I', name: 'Current', sym: 'I', value: rd?.I ?? 0, unit: 'A', note: `through ${n}`, keys: [`I@${focus}`] },
        { kind: 'V', name: 'Voltage', sym: 'V', value: rd?.V ?? 0, unit: 'V', note: `across ${n}`, keys: [`V@${focus}`] },
        { kind: 'R', name: 'Resistance', sym: 'R', value: ohms, unit: 'Ω', note: `${n} setting`, exact: true, keys: [`set@${focus}`], label: `Resistance of ${n}` },
        { kind: 'P', name: 'Power', sym: 'P', value: rd?.P ?? 0, unit: 'W', note: `heat each second in ${n}`, keys: [`P@${focus}`], label: `Power in ${n}, the heat each second` },
      ],
    }
  }
  if (b.cap) {
    return {
      title: 'Capacitor circuit', status: capStatus(b),
      tiles: [
        // "Current I_C" (not "Capacitor current I_C", which a 156 px tile cuts off): the title and the note name the capacitor
        { kind: 'I', name: 'Current', sym: 'I_C', value: b.cap.Ic, unit: 'A', note: 'into the capacitor', keys: ['Ic'], label: 'Capacitor current' },
        { kind: 'V', name: 'Voltage', sym: 'V_C', value: b.cap.Vc, unit: 'V', note: 'across the capacitor', keys: ['Vc'] },
        { kind: 'R', name: 'Resistance', sym: 'R', value: b.cap.Rth, unit: 'Ω', note: "in the capacitor's path", keys: ['Rth'] },
        { kind: 'T', name: 'Time constant', sym: 'τ', value: b.cap.tau, unit: 's', note: 'τ = RC', keys: ['tau'], label: 'Time constant' },
      ],
    }
  }
  const status = b.batteryOut ? 'battery out' : b.status === 'open' ? 'open circuit' : b.status === 'short' ? 'short circuit' : b.I === 0 ? 'no current' : 'current flowing'
  return {
    title: 'Whole circuit', status,
    tiles: [
      // an ideal short has no finite current, voltage or power: the tiles say so instead of printing ∞.
      // "Voltage V_terminal" (not "Terminal voltage V_terminal", three lines on a 360 px phone): the symbol and the note
      // say it is the terminal voltage, not ε
      { kind: 'I', name: 'Current', sym: 'I', value: b.idealShort ? NaN : b.I, unit: 'A', note: 'from the battery', keys: ['I'] },
      { kind: 'V', name: 'Voltage', sym: 'V_terminal', value: b.idealShort ? NaN : b.Vt, unit: 'V', note: 'across the terminals', keys: ['V'], label: "Terminal voltage, across the battery's terminals" },
      { kind: 'R', name: 'Resistance', sym: 'R_eq', value: b.Req, unit: 'Ω', note: 'not counting r', keys: ['R'], label: 'Total resistance of the parts, not counting r' },
      { kind: 'P', name: 'Power', sym: 'P', value: b.idealShort ? NaN : b.Pemf, unit: 'W', note: 'produced by the battery', keys: ['P'], label: 'Power produced by the battery, Iε' },
    ],
  }
}

/** What the capacitor is doing, for the HUD title. The battery cut off or out stays named, as the board shows it. */
export function capStatus(b: BoardResult): string {
  const k = b.cap!
  if (b.batteryOut) return 'battery out'
  if (b.status === 'open' && k.Ic !== 0) return 'battery cut off'
  if (b.status === 'short') return 'short circuit'
  const tiny = 1e-9 * Math.max(1, Math.abs(k.Voc), Math.abs(k.Vc))
  if (Math.abs(k.Ic) > 1e-12 && Math.abs(k.Voc - k.Vc) > tiny) return Math.abs(k.Voc) > Math.abs(k.Vc) ? 'charging' : 'discharging'
  if (b.status === 'open' && !Number.isFinite(k.tau)) return 'open circuit'
  return Math.abs(k.Vc) > tiny ? 'charged' : 'uncharged'
}

const symHtml = (s: string) => {
  const [base, sub] = s.split('_')
  return `<i>${base}</i>${sub ? `<sub>${sub}</sub>` : ''}`
}

export function createHud(reduce: () => boolean): Hud {
  const el = document.createElement('section')
  el.className = 'sim02-hud'
  el.setAttribute('aria-label', 'Readouts')
  el.innerHTML = `<p class="sim02-hud-title" aria-live="polite"></p><div class="sim02-hud-tiles"></div><p class="sim02-sr sim02-hud-refusal" aria-live="polite"></p>`
  const title = el.querySelector<HTMLElement>('.sim02-hud-title')!
  const refusal = el.querySelector<HTMLElement>('.sim02-hud-refusal')!
  const box = el.querySelector<HTMLElement>('.sim02-hud-tiles')!
  const tiles: Tile[] = [0, 1, 2, 3].map(() => {
    const t = document.createElement('div')
    t.className = 'sim02-tile'
    t.innerHTML = `<span class="sim02-tile-icon" aria-hidden="true"></span><span class="sim02-tile-name"></span>
      <span class="sim02-tile-read"><b class="sim02-tile-value">0</b><span class="sim02-tile-unit"></span><span class="sim02-tile-q" aria-hidden="true">?</span></span>
      <span class="sim02-tile-note"></span><span class="sim02-sr sim02-tile-sr"></span>`
    box.appendChild(t)
    return {
      el: t, name: t.querySelector('.sim02-tile-name')!, read: t.querySelector('.sim02-tile-read')!, value: t.querySelector('.sim02-tile-value')!, unit: t.querySelector('.sim02-tile-unit')!,
      note: t.querySelector('.sim02-tile-note')!, icon: t.querySelector('.sim02-tile-icon')!, sr: t.querySelector('.sim02-tile-sr')!, noteHtml: '', last: null, kind: null,
      masked: null, lift: null, liftTo: NaN, liftCover: false, flash: [],
    }
  })
  const running = new Set<{ stop(): void }>()
  const track = (a: { stop(): void; then(f: () => void): unknown }) => { running.add(a); a.then(() => running.delete(a)) }
  let lastKey: string | undefined
  let lastTitle = ''
  /** The freeze the HUD shows, the one whose line the title has said, and the title it was said with. */
  let maskId = ''
  let saidFor = ''
  let saidWith = ''
  let chipFlash: { text: string; until: number } | null = null
  /** The words a refused press shows, already in the chip (hidden), so a refusal changes no text in the title. */
  let refusedText = 'Pick your prediction first'
  let chipTimer = 0
  /** A refused press shows on the chip without touching the title's words, so the live title never reads again. */
  const paintRefused = (fresh = false) => {
    const c = title.querySelector<HTMLElement>('.sim02-hud-chip')
    if (!c) return
    // written with the title itself (a new title is read anyway), or into the hidden half of the chip, never alone
    const no = c.querySelector<HTMLElement>('.sim02-hud-chip-no')!
    if (fresh || no.textContent !== refusedText) no.textContent = refusedText
    const on = !!chipFlash && performance.now() < chipFlash.until
    c.classList.toggle('is-refused', on)
  }

  /** Stop a tile's flash. The flash is a plain Web Animation with no fill, so it never leaves an inline color behind
   *  (a stopped Motion tween could commit a mid-flash color after the stop): the tile shows its own kind's background. */
  const stopFlash = (t: Tile) => {
    for (const a of t.flash) a.stop()
    t.flash = []
    t.el.style.removeProperty('background-color')
  }
  const waapi = (a: Animation) => ({ stop: () => a.cancel(), then: (f: () => void) => a.finished.then(f, f) })
  const flash = (t: Tile, delay: number) => {
    stopFlash(t)
    const ms = delay * 1000
    const pop = waapi(t.value.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.16)', offset: 0.3 }, { transform: 'scale(1)' }],
      { duration: 450, delay: ms, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }))
    track(pop)
    t.flash.push(pop)
    const cs = getComputedStyle(t.el)
    const from = cs.getPropertyValue('--tile-flash').trim(), to = cs.getPropertyValue('--tile-bg').trim()
    if (from && to) {
      const bg = waapi(t.el.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: 800, delay: ms, easing: 'ease-out' }))
      track(bg)
      t.flash.push(bg)
    }
  }

  let quietTimer = 0
  return {
    el,
    quiet(on) {
      clearTimeout(quietTimer)
      if (on) title.setAttribute('aria-live', 'off')
      // back on only after the title change this focus move made has gone by unread
      else quietTimer = window.setTimeout(() => title.setAttribute('aria-live', 'polite'), 300)
    },
    update(b, slots, focus, animateIt, live = false, mask = FREE) {
      const spec = specsFor(b, slots, focus)
      const key = `${spec.title}|${spec.tiles.map(t => t.kind + t.name).join()}`
      const switched = lastKey !== undefined && key !== lastKey
      lastKey = key
      el.classList.toggle('is-part', !!focus && !!slots[focus])
      // red only for a short, as on the status line: an open circuit or a battery taken out is calm
      el.classList.toggle('is-warn', !mask.chip && b.status === 'short')
      // while a prediction is open the chip says the board is paused, in place of the circuit's status
      // (which would give some answers away: "open circuit", "no current")
      const chip = mask.chip
      const base = chip ? `${spec.title}|${chip}` : ''
      // the title is a polite live region and only changes when the freeze or the focus does. The freeze's line is
      // read once: with the first title of that freeze (the chip's own words are then left to the line, so nothing
      // is read twice), and not again when the focus changes later in the step
      if (mask.id !== maskId) { maskId = mask.id; saidFor = '' }
      const say = !!mask.announce && (saidFor !== mask.id || saidWith === base)
      if (say) { saidFor = mask.id; saidWith = base }
      const chipHtml = `<span class="sim02-hud-chip"${say ? ' aria-hidden="true"' : ''}><span class="sim02-hud-chip-now">${chip}</span><span class="sim02-hud-chip-no" aria-hidden="true"></span></span>`
      const head = chip ? `${spec.title} ${chipHtml}${say ? `<span class="sim02-sr"> ${mask.announce}</span>` : ''}` : `${spec.title} <span>${spec.status}</span>`
      if (head !== lastTitle) { title.innerHTML = head; lastTitle = head; paintRefused(true) }
      if (switched) {
        for (const t of tiles) { t.last = null; stopFlash(t) }
        if (!reduce()) tiles.forEach((t, k) => track(animate(t.el, { y: [6, 0], scale: [0.94, 1] }, { type: 'spring', stiffness: 500, damping: 18, delay: k * 0.035 })))
      }
      spec.tiles.forEach((s, k) => {
        const t = tiles[k]!
        if (t.kind !== s.kind) {
          t.kind = s.kind
          t.lastMilli = undefined
          stopFlash(t)
          t.el.className = `sim02-tile sim02-tile-${s.kind}`
          t.icon.innerHTML = `<svg viewBox="0 0 24 24">${ICON[s.kind]}</svg>`
        }
        const nameHtml = `${s.name} ${symHtml(s.sym)}`
        if (t.name.innerHTML !== nameHtml) t.name.innerHTML = nameHtml
        // small values read in milli-units (3.72 mA, not 0.00372 A), with hysteresis so a live value near 0.1 keeps its
        // unit; 1000 and up reads in kilo-units (11.5 kW, not 11520 W)
        const { prefix, scale } = unitPrefix(s.value, s.unit, t.lastMilli)
        t.lastMilli = prefix === 'm'
        t.unit.textContent = ` ${prefix}${s.unit}`
        const fmt = (x: number) => (Number.isNaN(x) ? 'undefined' : s.exact ? exact(x) : sig3(x * scale))
        // the prediction: "?" over a covered value, a ring and "before the change" on the asked one
        const m = mask.get(s.keys, 'hud')
        const wasHidden = t.masked === 'hide'
        t.masked = m
        // a phone tile is narrow: there the note reads "before change", "after change", "after you pick". A carried
        // cover (the student already picked on this step) lifts at the next step's pick and says so
        const note = m === 'hide' ? (mask.next ? 'after <span class="sim02-long">your </span>next pick' : 'after you <span class="sim02-long">predict</span><span class="sim02-short">pick</span>')
          : m === 'before' ? 'before <span class="sim02-long">the </span>change'
          : m === 'after' ? '<span class="sim02-long">right </span>after <span class="sim02-long">the </span>change' : s.note
        if (t.noteHtml !== note) { t.note.innerHTML = note; t.noteHtml = note }
        t.el.classList.toggle('is-covered', m === 'hide')
        t.el.classList.toggle('is-asked', m === 'before' || m === 'after')
        // a tagged or covered tile reads as one line ("Voltage across R₁ before the change: 10.7 V"), so a screen
        // reader hears what the tile is and when its number is from, once
        for (const part of [t.name, t.read, t.note]) { if (m) part.setAttribute('aria-hidden', 'true'); else part.removeAttribute('aria-hidden') }
        // the two names that take two lines on a phone shrink to one there when the note needs the second
        t.el.classList.toggle('is-longname', s.name.length + s.sym.replace('_', '').length > 12)
        const label = s.label ?? `${s.name} ${s.note}`
        const sr = m === 'hide' ? `${label}: hidden until ${mask.next ? 'your next prediction' : 'you pick a prediction'}`
          : m ? `${label} ${m === 'before' ? 'before' : 'right after'} the change: ${fmt(s.value)}${Number.isNaN(s.value) ? '' : t.unit.textContent}` : ''
        if (t.sr.textContent !== sr) t.sr.textContent = sr
        t.el.classList.toggle('is-na', Number.isNaN(s.value))
        const old = t.lastScale === scale ? t.last : null
        t.lastScale = scale
        t.last = s.value
        // a cover lifts: the number counts up from 0 (one short fade with reduced motion)
        if (wasHidden && m !== 'hide' && !switched) {
          t.lift?.stop()
          t.lift = null
          t.value.textContent = fmt(s.value)
          if (reduce()) { track(animate(t.read, { opacity: [0, 1] }, { duration: 0.18 })); return }
          if (!Number.isFinite(s.value) || s.exact) { track(animate(t.read, { opacity: [0, 1], scale: [0.85, 1] }, { duration: 0.35, delay: k * 0.05 })); return }
          // the count reads the tile's value on every frame, so a value on a live curve is counted to where it is now
          t.value.textContent = fmt(0)
          const a = animate(0, 1, {
            duration: 0.65, delay: k * 0.05, ease: [0.22, 1, 0.36, 1],
            onUpdate: u => { t.value.textContent = fmt(u * (t.last ?? 0)) },
            onComplete: () => { t.value.textContent = fmt(t.last ?? 0) },
          })
          t.lift = a
          t.liftCover = true
          track(a)
          a.then(() => { if (t.lift === a) t.lift = null })
          return
        }
        // a running count owns the number until it lands, unless the value moves on (then it stops before the write,
        // so an old count can never finish on an old number). A jump (a new step's board: not animated, not a live
        // curve) stops any count, a cover's count-up too, and paints the settled value
        if (t.lift) {
          if (!switched && (animateIt || live) && (t.liftCover || s.value === t.liftTo)) return
          t.lift.stop()
          t.lift = null
        }
        const changed = old !== null && old !== s.value
        // a dialed value (exact) is an input: it snaps to the new value and flashes, it never counts through decimals
        if (live || !animateIt || !changed || s.exact || !Number.isFinite(old!) || !Number.isFinite(s.value) || reduce()) {
          t.value.textContent = fmt(s.value)
          if (!live && animateIt && changed && !reduce()) flash(t, k * 0.05)
          return
        }
        const from = old!, to = s.value
        // a count shows only the digits its two ends have (6.00 to 0 counts in steps of 0.01), so the tail of the
        // ease never prints float dust like 0.000000232
        const step = 10 ** (Math.floor(Math.log10(Math.max(Math.abs(from), Math.abs(to)) * scale || 1)) - 2) / scale
        const a = animate(from, to, {
          duration: 0.55, delay: k * 0.05, ease: [0.22, 1, 0.36, 1],
          onUpdate: x => { t.value.textContent = fmt(Math.round(x / step) * step) },
          onComplete: () => { t.value.textContent = fmt(to) },
        })
        t.lift = a
        t.liftTo = to
        t.liftCover = false
        track(a)
        a.then(() => { if (t.lift === a) t.lift = null })
        flash(t, k * 0.05)
      })
    },
    counting: () => tiles.some(t => t.lift !== null),
    flashChip(text, ms) {
      // said once per refusal: more presses while the chip still shows it only keep it up longer
      const showing = !!chipFlash && performance.now() < chipFlash.until
      chipFlash = { text, until: performance.now() + ms }
      refusedText = text
      if (!showing) { refusal.textContent = ''; requestAnimationFrame(() => { refusal.textContent = text }) }
      paintRefused()
      window.clearTimeout(chipTimer)
      chipTimer = window.setTimeout(() => { chipFlash = null; paintRefused() }, ms + 20)
    },
    dispose() {
      window.clearTimeout(chipTimer)
      window.clearTimeout(quietTimer)
      for (const a of running) a.stop()
      el.remove()
    },
  }
}
