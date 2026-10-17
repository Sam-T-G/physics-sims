// Layer 2: the pure rules behind the board bar (Reset view, the capacitor clock pill, Clear and Undo) and the
// status line over the board. No DOM here, so the rules can be tested in node.

import type { BoardResult, Slots, SlotId } from './board'
import { SUB, exact } from './format'

// ---------- status line ----------

/** The empty slots in a sentence: "R₁", "R₁ and R₅", "R₂, R₃ and R₄". */
export function gapWords(gaps: readonly (SlotId | 'lanes')[]): { text: string; plural: boolean } {
  const names = gaps.flatMap(g => (g === 'lanes' ? ['R2', 'R3', 'R4'] : [g])).map(id => SUB[id]!)
  const text = names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return { text, plural: names.length > 1 }
}

/**
 * What the status line over the board says for a committed board. `cleared`: the board was just cleared and Undo
 * can still bring it back. Returns HTML (the `sim02-long` part is hidden on phones) and whether it is a warning.
 */
export function statusFor(b: BoardResult, slots: Slots, r: number, cleared: boolean): { html: string; warn: boolean } {
  const empty = Object.values(slots).every(p => !p)
  if (empty) {
    return { html: cleared ? 'Board cleared. Drag a part onto a slot, or press Undo.' : 'The board is empty. Drag a part onto a slot.', warn: false }
  }
  // red is for shorts (and a wire that steals a branch's current); an open circuit or a switched-out battery is calm,
  // even when a wire also bypasses a branch (the gap is what the line names)
  const warn = b.status === 'short' || b.bypassed.length > 0
  // non-breaking spaces keep "r = 0.5 Ω" on one line
  const rIs = (v: string) => `r\u00a0=\u00a0${v}`
  if (b.idealShort) return { html: `Short circuit with ${rIs('0')}: the current has no number. Raise r or remove a wire.`, warn }
  if (b.status === 'short') return { html: `Short circuit: only ${rIs(`${exact(r)}\u00a0Ω`)} inside the battery holds the current back.`, warn }
  if (b.status === 'open') {
    const g = gapWords(b.gaps)
    const verb = g.plural ? 'are' : 'is'
    if (b.cap && !Number.isFinite(b.cap.tau)) {
      return { html: `${g.text} ${verb} empty, so the capacitor has no loop to fill or empty through<span class="sim02-long">, so the capacitor's charge stays the same</span>.`, warn: false }
    }
    if (b.cap && b.cap.Ic !== 0) {
      const path = drainPath(b)
      return { html: `The empty ${g.text} slot${g.plural ? 's cut' : ' cuts'} the battery off.${path ? `<span class="sim02-long"> The capacitor empties through ${path}.</span>` : ''}`, warn: false }
    }
    return { html: `Open circuit: ${g.text} ${verb} empty<span class="sim02-long">, so no current flows</span>.`, warn: false }
  }
  if (b.batteryOut) {
    const path = drainPath(b)
    return { html: path ? `Battery out: the capacitor empties through ${path}.` : 'Battery out, and the capacitor is empty.', warn: false }
  }
  if (b.bypassed.length) {
    // a full capacitor in the loop: nothing flows anywhere, so no wire "carries all the current"
    if (b.cap && Object.values(b.slots).every(sl => Math.abs(sl?.I ?? 0) < 1e-9)) return { html: 'The capacitor is full, so no current flows.', warn: false }
    const wires = (['R2', 'R3', 'R4'] as const).filter(id => slots[id]?.kind === 'wire').map(id => SUB[id]!)
    const names = b.bypassed.map(id => SUB[id]).join(' and ')
    const many = wires.length > 1
    return { html: `The wire${many ? 's' : ''} in ${wires.join(' and ')} carr${many ? 'y' : 'ies'} all the current, so ${names} get${b.bypassed.length > 1 ? '' : 's'} 0\u00a0A.`, warn }
  }
  return { html: '', warn: false }
}

/** The resistors the capacitor's current runs through right now: "R₂", "R₂ and R₃". Empty when none carries any. */
function drainPath(b: BoardResult): string {
  const ids = (['R1', 'R2', 'R3', 'R4', 'R5'] as const).filter(id => id !== b.cap?.id && (b.slots[id]?.P ?? 0) > 0)
  return gapWords(ids).text
}

// ---------- previews ----------

/**
 * A preview (a part held over a slot) may change numbers but never the layout. If the preview would add or take
 * away the capacitor, the panel, the HUD and the time module keep what the committed board shows. The time
 * module and the status line only follow commits.
 */
export function previewPaints(preview: boolean, committedHasCap: boolean, shownHasCap: boolean) {
  if (!preview) return { panel: true, hud: true, time: true, status: true }
  const same = committedHasCap === shownHasCap
  return { panel: same, hud: same, time: false, status: false }
}

/** The clock pill shows only while the committed board holds a capacitor (never for a preview). */
export const pillOn = (committedHasCap: boolean) => committedHasCap

// ---------- the capacitor's Empty button ----------

/**
 * "Empty the capacitor" does nothing (aria-disabled, still focusable) when the capacitor is already empty and
 * nothing will charge it right now: the clock is paused, the curve is static (τ is 0 or ∞), or the curve is over.
 */
export function emptyDisabled(Vc: number, playing: boolean, live: boolean, settled: boolean): boolean {
  return Math.abs(Vc) < 1e-3 && (!playing || !live || settled)
}

// ---------- Clear and Undo ----------

export type BoardSnap = {
  slots: Slots
  emf: number
  r: number
  batteryIn: boolean
  capV: number
  /** Whether the capacitor clock was running: a board paused before Clear comes back paused. */
  playing: boolean
  compare: { hidden: boolean; html: string }
}

/** A deep copy, so later changes to the board (a dialed capacitor changes its part in place) never reach it. */
export function snapBoard(s: BoardSnap): BoardSnap {
  return JSON.parse(JSON.stringify(s)) as BoardSnap
}

/** The board's identity for Undo: the parts and the battery. */
export const boardKey = (slots: Slots, emf: number, r: number, batteryIn: boolean) =>
  JSON.stringify([emf, r, batteryIn, (['R1', 'R2', 'R3', 'R4', 'R5'] as const).map(id => slots[id] ?? null)])

/** The board Clear leaves: no parts, ε = 12 V, r = 0, battery in. */
export const CLEARED = { emf: 12, r: 0, batteryIn: true } as const

export const UNDO_MS = 8000

/**
 * Undo for Clear and the book examples. Arm it with the board as it was and the board's key right after the
 * change. For UNDO_MS (paused while the button is hovered or keyboard-focused) the button reads Undo; after that,
 * Cmd/Ctrl+Z still restores until the board changes again.
 */
export function createUndo(windowMs = UNDO_MS) {
  let snap: BoardSnap | null = null
  let keyAfter = ''
  let left = 0
  return {
    arm(s: BoardSnap, key: string) { snap = snapBoard(s); keyAfter = key; left = windowMs },
    /** Advance the window; true on the tick the window closes. */
    tick(ms: number, paused: boolean): boolean {
      if (left <= 0 || paused) return false
      left -= ms
      return left <= 0
    },
    /** The board was committed with this key: any change other than the armed one ends Undo. */
    change(key: string) { if (snap && key !== keyAfter) { snap = null; left = 0 } },
    take(): BoardSnap | null { const s = snap; snap = null; left = 0; return s },
    drop() { snap = null; left = 0 },
    get inWindow() { return !!snap && left > 0 },
    get canUndo() { return !!snap },
    /** 1 at the start of the window, 0 at its end. */
    get fraction() { return snap ? Math.max(0, left) / windowMs : 0 },
  }
}
export type Undo = ReturnType<typeof createUndo>
