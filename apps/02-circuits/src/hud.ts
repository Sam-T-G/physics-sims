// Layer 3: the HUD. Four big readouts for the whole circuit, for one part while you point at it or tap it,
// or for the capacitor while one is on the board. Numbers count to new values and flash, like the notebook.

import { animate } from 'motion'
import type { BoardResult, Slots, SlotId } from './board'
import { sig3, exact, SUB } from './format'

const SCALABLE = new Set(['A', 'V', 'W', 'C'])

type Kind = 'I' | 'V' | 'R' | 'P' | 'Q' | 'T'
/** One tile: what it measures, its value, and a short note that names the component. */
export type TileSpec = { kind: Kind; name: string; sym: string; value: number; unit: string; note: string; exact?: boolean }
type Tile = { el: HTMLElement; name: HTMLElement; value: HTMLElement; unit: HTMLElement; note: HTMLElement; icon: HTMLElement; last: number | null; lastScale?: number; kind: Kind | null }

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
  /** `focus`: the part being pointed at or tapped, if any. `live`: numbers change every frame (no flash). */
  update(b: BoardResult, slots: Slots, focus: SlotId | null, animateIt: boolean, live?: boolean): void
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
          { kind: 'I', name: 'Current', sym: 'I', value: rd?.I ?? 0, unit: 'A', note: 'into the capacitor' },
          { kind: 'V', name: 'Voltage', sym: 'V_C', value: rd?.V ?? 0, unit: 'V', note: 'across the capacitor' },
          { kind: 'Q', name: 'Charge', sym: 'q', value: b.cap?.q ?? 0, unit: 'C', note: 'stored on the plates' },
          { kind: 'T', name: 'Time constant', sym: 'τ', value: b.cap?.tau ?? Infinity, unit: 's', note: 'τ = RC' },
        ],
      }
    }
    const ohms = part.kind === 'wire' ? 0 : part.ohms
    return {
      title: n, status: part.kind === 'wire' ? 'wire' : 'resistor',
      tiles: [
        { kind: 'I', name: 'Current', sym: 'I', value: rd?.I ?? 0, unit: 'A', note: `through ${n}` },
        { kind: 'V', name: 'Voltage', sym: 'V', value: rd?.V ?? 0, unit: 'V', note: `across ${n}` },
        { kind: 'R', name: 'Resistance', sym: 'R', value: ohms, unit: 'Ω', note: `${n} setting`, exact: true },
        { kind: 'P', name: 'Power', sym: 'P', value: rd?.P ?? 0, unit: 'W', note: `heat in ${n}` },
      ],
    }
  }
  const status = b.batteryOut ? 'battery out' : b.status === 'open' && b.cap && b.cap.Ic !== 0 ? 'battery cut off' : b.status === 'open' ? 'open circuit' : b.status === 'short' ? 'short circuit' : b.I === 0 ? 'no current' : 'current flowing'
  if (b.cap) {
    return {
      title: 'Whole circuit', status,
      tiles: [
        { kind: 'I', name: 'Current', sym: 'I', value: b.cap.Ic, unit: 'A', note: 'into the capacitor' },
        { kind: 'V', name: 'Voltage', sym: 'V_C', value: b.cap.Vc, unit: 'V', note: 'across the capacitor' },
        { kind: 'R', name: 'Resistance', sym: 'R', value: b.cap.Rth, unit: 'Ω', note: 'in the capacitor’s path' },
        { kind: 'T', name: 'Time constant', sym: 'τ', value: b.cap.tau, unit: 's', note: 'τ = RC' },
      ],
    }
  }
  return {
    title: 'Whole circuit', status,
    tiles: [
      { kind: 'I', name: 'Current', sym: 'I', value: b.I, unit: 'A', note: 'from the battery' },
      { kind: 'V', name: 'Voltage', sym: 'V', value: b.idealShort ? NaN : b.Vt, unit: 'V', note: 'at the battery terminals' },
      { kind: 'R', name: 'Resistance', sym: 'R_eq', value: b.Req, unit: 'Ω', note: 'total, all parts' },
      { kind: 'P', name: 'Power', sym: 'P', value: b.Pemf, unit: 'W', note: 'battery output' },
    ],
  }
}

const symHtml = (s: string) => {
  const [base, sub] = s.split('_')
  return `<i>${base}</i>${sub ? `<sub>${sub}</sub>` : ''}`
}

export function createHud(reduce: () => boolean): Hud {
  const el = document.createElement('section')
  el.className = 'sim02-hud'
  el.setAttribute('aria-label', 'Readouts')
  el.innerHTML = `<p class="sim02-hud-title" aria-live="polite"></p><div class="sim02-hud-tiles"></div>`
  const title = el.querySelector<HTMLElement>('.sim02-hud-title')!
  const box = el.querySelector<HTMLElement>('.sim02-hud-tiles')!
  const tiles: Tile[] = [0, 1, 2, 3].map(() => {
    const t = document.createElement('div')
    t.className = 'sim02-tile'
    t.innerHTML = `<span class="sim02-tile-icon" aria-hidden="true"></span><span class="sim02-tile-name"></span>
      <span class="sim02-tile-read"><b class="sim02-tile-value">0</b><span class="sim02-tile-unit"></span></span>
      <span class="sim02-tile-note"></span>`
    box.appendChild(t)
    return {
      el: t, name: t.querySelector('.sim02-tile-name')!, value: t.querySelector('.sim02-tile-value')!, unit: t.querySelector('.sim02-tile-unit')!,
      note: t.querySelector('.sim02-tile-note')!, icon: t.querySelector('.sim02-tile-icon')!, last: null, kind: null,
    }
  })
  const running = new Set<{ stop(): void }>()
  const track = (a: { stop(): void; then(f: () => void): unknown }) => { running.add(a); a.then(() => running.delete(a)) }
  let lastKey: string | undefined
  let lastTitle = ''

  const flash = (t: Tile, delay: number) => {
    track(animate(t.value, { scale: [1, 1.16, 1] }, { type: 'spring', stiffness: 520, damping: 14, delay }))
    const cs = getComputedStyle(t.el)
    const from = cs.getPropertyValue('--tile-flash').trim(), to = cs.getPropertyValue('--tile-bg').trim()
    if (from && to) track(animate(t.el, { backgroundColor: [from, to] }, { duration: 0.8, delay, ease: 'easeOut' }))
  }

  return {
    el,
    update(b, slots, focus, animateIt, live = false) {
      const spec = specsFor(b, slots, focus)
      const key = `${spec.title}|${spec.tiles.map(t => t.kind + t.name).join()}`
      const switched = lastKey !== undefined && key !== lastKey
      lastKey = key
      el.classList.toggle('is-part', spec.title !== 'Whole circuit')
      el.classList.toggle('is-warn', b.status !== 'ok' || b.batteryOut)
      const head = `${spec.title} <span>${spec.status}</span>`
      if (head !== lastTitle) { title.innerHTML = head; lastTitle = head }
      if (switched) {
        for (const t of tiles) t.last = null
        if (!reduce()) tiles.forEach((t, k) => track(animate(t.el, { y: [6, 0], scale: [0.94, 1] }, { type: 'spring', stiffness: 500, damping: 18, delay: k * 0.035 })))
      }
      spec.tiles.forEach((s, k) => {
        const t = tiles[k]!
        if (t.kind !== s.kind) {
          t.kind = s.kind
          t.el.className = `sim02-tile sim02-tile-${s.kind}`
          t.icon.innerHTML = `<svg viewBox="0 0 24 24">${ICON[s.kind]}</svg>`
        }
        const nameHtml = `${s.name} ${symHtml(s.sym)}`
        if (t.name.innerHTML !== nameHtml) t.name.innerHTML = nameHtml
        // small values read in milli-units (3.72 mA, not 0.00372 A)
        const milli = SCALABLE.has(s.unit) && Number.isFinite(s.value) && s.value !== 0 && Math.abs(s.value) < 0.1
        const scale = milli ? 1000 : 1
        t.unit.textContent = ` ${milli ? 'm' : ''}${s.unit}`
        if (t.note.textContent !== s.note) t.note.textContent = s.note
        const fmt = (x: number) => (Number.isNaN(x) ? 'no value' : s.exact ? exact(x) : sig3(x * scale))
        t.el.classList.toggle('is-na', Number.isNaN(s.value))
        const old = t.lastScale === scale ? t.last : null
        t.lastScale = scale
        t.last = s.value
        const changed = old !== null && old !== s.value
        if (live || !animateIt || !changed || !Number.isFinite(old!) || !Number.isFinite(s.value) || reduce()) {
          t.value.textContent = fmt(s.value)
          if (!live && animateIt && changed && !reduce()) flash(t, k * 0.05)
          return
        }
        const from = old!, to = s.value
        track(animate(from, to, {
          duration: 0.55, delay: k * 0.05, ease: [0.22, 1, 0.36, 1],
          onUpdate: x => { t.value.textContent = fmt(x) },
          onComplete: () => { t.value.textContent = fmt(to) },
        }))
        flash(t, k * 0.05)
      })
    },
    dispose() {
      for (const a of running) a.stop()
      el.remove()
    },
  }
}
