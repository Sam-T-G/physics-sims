// Layer 2: the prediction freeze, as pure rules. While the student predicts, the board shows the circuit as it is
// before the change: input is locked, the capacitor's clock holds at t = 0, the current dots stand still, and the
// value the question is about is tagged "before the change" or covered with "?". Each renderer asks the mask about
// the numbers it paints (by quantity key), so a cover is formatted at the source and survives every repaint.
//
// Derived rules (a step declares only what differs):
//  D1  Every step with a prediction freezes.
//  D2  No `ask` and a `readout`: the readout's quantity is tagged "before".
//  D3  A fill task ("wait for the capacitor"): the future part of the curve is covered.
//  D4  While the student reads and predicts, no cue sits on the task's chips or controls.

import type { SlotId } from './board'
import type { Freeze, GuideState, QRef, Qty, Readout, Step } from './tour'
import type { Targets } from './cues'

export type Ask = QRef & { show: 'before' | 'hide' }
export type Resolved = {
  id: string
  ask: Ask[]
  focus: SlotId | null
  hold: NonNullable<Freeze['hold']>
  carry: QRef[]
  /** "Right then": the clock waits at t = 0 of the new curve until Play or Next. */
  after: boolean
  /** D3: the step waits for the capacitor to fill, so the curve ahead of the playhead is covered. */
  fill: boolean
}
/** predict: before the pick. act: the Try it card is up. done: the answer is out. */
export type FreezePhase = 'predict' | 'act' | 'done'

const READOUT_Q: Record<Readout['kind'], Qty> = { I: 'I', V: 'V', P: 'P', T: 'tau', Q: 'q' }

export function resolveFreeze(st: Step): Resolved | null {
  if (!st.predict) return null
  const f = st.freeze ?? {}
  const ask: Ask[] = f.ask ?? (st.readout ? [{ q: READOUT_Q[st.readout.kind], show: 'before' }] : [])
  return {
    id: st.id,
    ask: ask.map(a => ({ ...a })),
    focus: f.focus ?? null,
    hold: [...(f.hold ?? [])],
    carry: (f.carry ?? []).map(c => ({ ...c })),
    after: f.after === 'hold',
    fill: !!st.task?.auto.some(a => 'fill' in a),
  }
}

// ---------- the capacitor's clock ----------
/** free: the clock runs as usual. held: at t = 0 for the prediction. after: at t = 0 of the new curve until Play. */
export type Gate = 'free' | 'held' | 'after'
/**
 * The clock gate when the freeze moves to `phase`. `beat`: a fill step lets the clock go by itself a moment after the
 * pick. `play`: what the clock's play state becomes (null: unchanged; a change on the board starts the new curve).
 */
export function gateFor(r: Resolved | null, phase: FreezePhase | null, now: Gate): { gate: Gate; beat: boolean; play: boolean | null } {
  if (!r || !phase) return { gate: 'free', beat: false, play: now === 'free' ? null : true }
  if (phase === 'predict') return { gate: 'held', beat: false, play: false }
  if (phase === 'act') {
    if (r.after) return { gate: 'after', beat: false, play: null }
    if (r.fill) return { gate: 'held', beat: true, play: null }
    return { gate: 'free', beat: false, play: null }
  }
  if (r.after) return { gate: now === 'free' ? 'free' : 'after', beat: false, play: null }
  // a clock still held from the prediction (a step with no task) runs from t = 0 once the answer is out
  return { gate: 'free', beat: false, play: now === 'held' ? true : null }
}
/** Does the clock move this frame? */
export const clockRuns = (gate: Gate, playing: boolean) => gate === 'free' && playing

// ---------- quantities and where they show ----------
/**
 * A number on screen is named by quantity keys: 'I' battery current, 'I@R2' through R₂, 'Ic' into the capacitor,
 * 'V' terminal voltage, 'V@R1', 'V@P' (across the branches), 'Vc', 'P' battery power, 'P@R1', 'R' total resistance,
 * 'R@P', 'Rth', 'tau', 'q'. A part's own setting ('set@R1') never matches anything.
 */
export type Key = string
/** Where a number is painted. */
export type View = 'hud' | 'label' | 'plot-I' | 'plot-V' | 'curve-I' | 'curve-V' | 'eq'

const family = (k: string): string => (k === 'tau' ? 'tau' : k === 'q' ? 'q' : k === 'Rth' ? 'R' : k.startsWith('set@') ? '' : k[0]!)
const BASE: Record<Qty, string> = { I: 'I', Ic: 'I', V: 'V', Vc: 'V', P: 'P', R: 'R', tau: 'tau', q: 'q' }

/** Does this reference name the number with this key? */
export function covers(ref: QRef, key: Key): boolean {
  if (ref.at === 'all') return family(key) !== '' && family(key) === BASE[ref.q]
  if (ref.at) return key === `${BASE[ref.q]}@${ref.at}`
  return key === ref.q
}

/** Every view a quantity shows up in. */
export function viewsOf(ref: QRef): View[] {
  const f = BASE[ref.q]
  const views: View[] = ['hud', 'eq']
  const onPart = !!ref.at || ref.q === 'Ic' || ref.q === 'Vc'
  if ((f === 'I' || f === 'V') && onPart) views.push('label')
  if (f === 'I' && (ref.q === 'Ic' || ref.at === 'all')) views.push('plot-I', 'curve-I')
  if (f === 'V' && (ref.q === 'Vc' || ref.at === 'all')) views.push('plot-V', 'curve-V')
  return views
}

/** Rows whose sentence prints a value with no key (V_C = 9.00 V in words): held while that kind of value is covered. */
const SAY_PRINTS: Record<string, string[]> = { 'rc-charge': ['V', 'q'] }

// ---------- the mask the renderers read ----------
export type MaskState = 'before' | 'after' | 'hide' | null
export type Mask = {
  /** A step id and phase: changes when the freeze does (the HUD announces once per change). */
  id: string
  phase: FreezePhase | null
  /** The board takes no input (predicting). */
  locked: boolean
  get(keys: Key[], view: View): MaskState
  /** The row's sentence is held back. */
  say(row: string): boolean
  /** The status line stays empty. */
  status: boolean
  /** The battery wears its plain awake face. */
  face: boolean
  /** The curve right of the playhead is covered: 'predict' (with words) or 'act' (the edge follows the playhead). */
  fog: 'predict' | 'act' | null
  /** The HUD title's chip, in place of the circuit status. */
  chip: string | null
  /** Read once by screen readers when the freeze starts. */
  announce: string | null
  /** Anything is covered right now. */
  covering: boolean
  /** The covers are carried: they lift at the next step's pick, not this one (the student already picked here). */
  next: boolean
}

export const FREE: Mask = {
  id: '', phase: null, locked: false, get: () => null, say: () => false, status: false, face: false, fog: null, chip: null, announce: null, covering: false, next: false,
}

/** `waiting`: the clock is held right after the change ("right then" steps, until Play). */
export function maskFor(r: Resolved | null, phase: FreezePhase | null, waiting = false): Mask {
  if (!r || !phase) return FREE
  const predicting = phase === 'predict'
  const hidden: QRef[] = [...(predicting ? r.ask.filter(a => a.show === 'hide') : []), ...(predicting ? [] : r.carry)]
  const tagged = predicting ? r.ask.filter(a => a.show === 'before') : waiting && phase === 'done' ? r.ask.filter(a => a.show === 'before') : []
  const tag: MaskState = predicting ? 'before' : 'after'
  const held = new Set(phase === 'done' ? [] : r.hold)
  const hiddenFamilies = new Set(hidden.map(h => (h.at === 'all' ? BASE[h.q] : h.q === 'q' ? 'q' : h.q === 'Vc' ? 'V' : '')).filter(Boolean))
  return {
    id: `${r.id}:${phase}:${waiting ? 'w' : ''}`,
    phase,
    locked: predicting,
    get(keys, view) {
      for (const h of hidden) if (viewsOf(h).includes(view) && keys.some(k => covers(h, k))) return 'hide'
      for (const t of tagged) if (viewsOf(t).includes(view) && keys.some(k => covers(t, k))) return tag
      return null
    },
    say: row => held.has(`say:${row}` as never) || (SAY_PRINTS[row] ?? []).some(f => hiddenFamilies.has(f)),
    // the status line says nothing while predicting; a held status stays quiet until the reveal
    status: predicting || (phase === 'act' && held.has('status')),
    face: held.has('face'),
    fog: r.fill && phase !== 'done' ? (predicting ? 'predict' : 'act') : null,
    chip: predicting ? 'paused for your prediction' : waiting && phase === 'done' ? 'paused right after the change' : null,
    announce: predicting
      ? `Paused for your prediction.${hidden.length ? ' Some numbers are hidden until you pick.' : ''}`
      : waiting && phase === 'done' ? 'Paused right after the change. Press Play to start the clock again.' : null,
    covering: hidden.length > 0,
    next: !predicting && r.carry.length > 0,
  }
}

/** D4: before the pick, the task's chips and controls are not pointed at (they would invite acting early). */
export function lookTargets(t: Targets): Targets {
  return { ...t, doChips: [], control: null, dial: null }
}

// ---------- the line that names what came back ----------
const NAME: Record<Qty, string> = {
  I: 'Battery current', Ic: 'Capacitor current', V: 'Terminal voltage', Vc: 'Capacitor voltage', P: 'Power made by the battery, Iε', R: 'Total resistance of the parts, not counting r', tau: 'Time constant', q: 'Charge on the capacitor',
}
/** For screen readers, at the reveal: the covered values that came back, e.g. "Capacitor voltage: 9.00 V." */
export function liftLine(r: Resolved | null, s: GuideState, fmt: (x: number, unit: string) => string): string {
  if (!r) return ''
  const out: string[] = []
  for (const a of r.ask) {
    if (a.show !== 'hide') continue
    const q: Qty = a.at === 'all' && BASE[a.q] === 'V' && s.b.cap ? 'Vc' : a.at === 'all' && BASE[a.q] === 'I' && s.b.cap ? 'Ic' : a.q
    const v = valueOf(q, s)
    if (v === null) continue
    out.push(`${NAME[q]}: ${v.unit === 'Ω' && !Number.isFinite(v.x) ? '∞ Ω' : fmt(v.x, v.unit)}.`)
  }
  return out.join(' ')
}
const valueOf = (q: Qty, s: GuideState): { x: number; unit: string } | null => {
  const b = s.b
  switch (q) {
    case 'I': return { x: b.I, unit: 'A' }
    case 'V': return { x: b.Vt, unit: 'V' }
    case 'P': return { x: b.Pemf, unit: 'W' }
    case 'R': return { x: b.Req, unit: 'Ω' }
    case 'Ic': return b.cap ? { x: b.cap.Ic, unit: 'A' } : null
    case 'Vc': return b.cap ? { x: b.cap.Vc, unit: 'V' } : null
    case 'tau': return b.cap ? { x: b.cap.tau, unit: 's' } : null
    case 'q': return b.cap ? { x: b.cap.q, unit: 'C' } : null
  }
}
