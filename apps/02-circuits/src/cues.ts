// Guide cues: how the tour points at the part of the screen a step is about.
//
// Two roles. "Do" is where the student acts right now: the chip to drag, the slot to drop it on, the slider, the
// button. "Watch" is where the result shows up: the HUD, an equation row, the plots. Do cues wake up only when the
// step asks for the action (after the prediction), so the change itself draws the eye; watch cues stay quiet.
//
// One cue set ships, Coach (Sam's pick, 2026-10-14): the do targets arrive in the order the student uses them
// (onset), the names in the "Try it" text get a highlighter stroke (textlink), the do slot's label turns into a pin
// that bobs while the chip hops and the socket ripples (beacon), and after a pause a hand acts out the next move
// (ghost; also the card's "Show me" button). Reduced motion keeps the marks and drops every motion.

import type { Part, SlotId } from './board'
import type { Action, GuideState, Spot } from './tour'
import { lookTargets } from './freeze'
import { SUB } from './format'

/** The Coach set's parts, written on the sim root as data-cues (styles.css keys the cue look off it). */
export const CUES = ['onset', 'textlink', 'beacon', 'ghost'] as const

export type Control = 'r' | 'bat-out' | 'speed-5' | 'play'
/** What the show-me hand acts out for the step's next action. */
export type Gesture =
  | { kind: 'drag'; chip: string; slot: SlotId }
  | { kind: 'tap-slot'; slot: SlotId }
  | { kind: 'dial'; slot: SlotId; dir: 1 | -1 }
  | { kind: 'remove'; slot: SlotId }
  | { kind: 'drag-off'; slot: SlotId }
  | { kind: 'slide'; control: 'r' }
  | { kind: 'tap'; control: Control }
export type Targets = {
  doSlots: SlotId[]
  doChips: string[]
  control: Control | null
  /** The dial button to press, once the dial for that slot is open. */
  dial: { slot: SlotId; dir: 1 | -1 } | null
  /** The slot whose part comes off, once that part's dial is open: its Remove button is the thing to press. */
  remove: SlotId | null
  watchSlots: SlotId[]
  watchChips: string[]
  hud: boolean
  rows: string[]
  time: boolean
  battery: boolean
  gesture: Gesture | null
}
export type Stage = 'off' | 'look' | 'act' | 'done'
/** The highest the hand goes on screen: the chip copy rides 46 px above the hand's point (styles.css .sim02-ghost-chip). */
const GHOST_TOP = 62

/** The tray chip that holds a part (the chips' data-part values). */
export const chipId = (p: Part) => (p.kind === 'resistor' ? String(p.ohms) : p.kind === 'wire' ? 'wire' : 'cap')
const valueAt = (s: GuideState, id: SlotId) => {
  const p = s.slots[id]
  return p?.kind === 'resistor' ? p.ohms : p?.kind === 'capacitor' ? p.farads : NaN
}

/** What a step points at, given the board as it is now. A place or remove that is already done drops out. */
export function resolveTargets(spot: Spot | null, acts: readonly Action[], s: GuideState): Targets {
  const doSlots: SlotId[] = []
  const doChips: string[] = []
  let control: Control | null = null
  let dial: Targets['dial'] = null
  let remove: SlotId | null = null
  let gesture: Gesture | null = null
  const placing = acts.some(a => 'place' in a)
  for (const a of acts) {
    if ('place' in a) {
      if (s.slots[a.place]?.kind === a.part.kind) continue
      doSlots.push(a.place)
      // the chip for the action's own part when the step offers it; a step may offer another (any resistor will do)
      const own = chipId(a.part)
      const chip = !spot?.chips?.length || spot.chips.includes(own) ? own : spot.chips[0]!
      if (!doChips.includes(chip)) doChips.push(chip)
      gesture ??= { kind: 'drag', chip, slot: a.place }
    } else if ('remove' in a) {
      if (!s.slots[a.remove]) continue
      // with the part's dial open the dial covers the part, and the dial's Remove button is the thing to press
      if (s.selected === a.remove) { remove = a.remove; gesture ??= { kind: 'remove', slot: a.remove } }
      else { doSlots.push(a.remove); gesture ??= { kind: 'drag-off', slot: a.remove } }
    } else if ('dial' in a) {
      const now = valueAt(s, a.dial)
      const dir = a.value >= now ? 1 : -1
      // with the dial open the dial's button is the thing to press; the dial covers the part
      if (s.selected === a.dial) { dial = { slot: a.dial, dir }; gesture ??= { kind: 'dial', slot: a.dial, dir } }
      else { doSlots.push(a.dial); gesture ??= { kind: 'tap-slot', slot: a.dial } }
    } else if ('select' in a) {
      if (s.selected === a.select) continue
      doSlots.push(a.select)
      gesture ??= { kind: 'tap-slot', slot: a.select }
    } else if ('r' in a) {
      control = 'r'
      gesture ??= { kind: 'slide', control: 'r' }
    } else if ('battery' in a) {
      if (!a.battery) { control = 'bat-out'; gesture ??= { kind: 'tap', control: 'bat-out' } }
    } else if ('fill' in a) {
      // waiting for the capacitor: 5× is the one thing to press, until the clock is already sped up
      if ((s.speed ?? 1) < 5) { control = 'speed-5'; gesture ??= { kind: 'tap', control: 'speed-5' } }
    }
  }
  return {
    doSlots, doChips, control, dial, remove,
    watchSlots: (spot?.slots ?? []).filter(id => !doSlots.includes(id)),
    watchChips: placing ? [] : [...(spot?.chips ?? [])],
    hud: !!spot?.hud,
    rows: [...(spot?.rows ?? [])],
    time: !!spot?.time,
    // the r slider is the target inside the battery box, so the box itself is not marked
    battery: !!spot?.battery && control !== 'r',
    gesture,
  }
}

const SUBS: Record<string, SlotId> = { '₁': 'R1', '₂': 'R2', '₃': 'R3', '₄': 'R4', '₅': 'R5' }
/**
 * The task text with the names of things on screen wrapped as references (R₁, the 4 Ω resistor, the r slider, ...).
 * Touching a reference points at the thing it names.
 */
export function linkRefs(text: string, spot: Spot | null, acts: readonly Action[]): string {
  const dialAct = acts.find((a): a is Extract<Action, { dial: SlotId }> => 'dial' in a)
  const capChip = acts.some(a => 'place' in a && a.part.kind === 'capacitor')
  const rules: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [/"Discharge: battery out"/, () => 'ctl:bat-out'],
    [/5× button/, () => 'ctl:speed-5'],
    [/the r slider/, () => 'ctl:r'],
    [/press \+/, () => (dialAct ? 'dial' : null)],
    [/press Remove R[₁₂₃₄₅]/, () => (acts.some(a => 'remove' in a) ? 'remove' : null)],
    [/the (\d+(?:\.\d+)?) Ω resistor/, m => `chip:${m[1]}`],
    [/a resistor/, () => (spot?.chips?.[0] ? `chip:${spot.chips[0]}` : null)],
    [/a wire/, () => 'chip:wire'],
    [/the capacitor/, () => (capChip ? 'chip:cap' : dialAct ? `slot:${dialAct.dial}` : null)],
    [/R([₁₂₃₄₅])/, m => `slot:${SUBS[m[1]!]}`],
  ]
  let out = ''
  let rest = text
  for (;;) {
    let best: { i: number; len: number; ref: string } | null = null
    for (const [re, f] of rules) {
      const m = re.exec(rest)
      if (!m) continue
      const ref = f(m)
      if (!ref) continue
      if (!best || m.index < best.i || (m.index === best.i && m[0].length > best.len)) best = { i: m.index, len: m[0].length, ref }
    }
    if (!best) return out + rest
    out += `${rest.slice(0, best.i)}<span class="sim02-guide-ref" data-ref="${best.ref}">${rest.slice(best.i, best.i + best.len)}</span>`
    rest = rest.slice(best.i + best.len)
  }
}

// ---------------------------------------------------------------------------------------------------------------
// runtime

export type CueHost = {
  root: HTMLElement
  /** The canvas wrapper: slot points are measured in its box. */
  wrap: HTMLElement
  reduce(): boolean
  chip(id: string): HTMLElement | null
  label(id: SlotId): HTMLElement | null
  hud(): HTMLElement
  battery(): HTMLElement
  time(): HTMLElement
  row(id: string): HTMLElement | null
  control(c: Control): HTMLElement | null
  /** The open dial's + or − button, or null when no dial is open. */
  dialButton(dir: 1 | -1): HTMLElement | null
  /** The open dial's Remove button (docked or floating), or null when no dial is open. */
  removeButton(): HTMLElement | null
  /** A slot's keyboard button (over the board). */
  slotButton(id: SlotId): HTMLElement | null
  /** A slot's center in the canvas wrapper (CSS px) and the slot's half length on screen. */
  slotPoint(id: SlotId): { x: number; y: number; r: number } | null
  /**
   * True when a part let go at this viewport point leaves the board: the point is on the canvas itself (not under
   * the board bar, the HUD, a label or the dial) and farther than the magnet radius from every socket. With
   * `past`, the point must also be past the board's edge, so the part visibly leaves the board.
   */
  dropsOff(x: number, y: number, past?: boolean): boolean
  /** One expanding ring around a slot on the board. */
  ripple(id: SlotId): void
  /** True while a part is in hand (dragged or held): the student is busy, so no nudge and no hand. */
  busy(): boolean
  /** True while the camera flies to a shot: points on the board are still moving. */
  flying(): boolean
  /** True while a prediction covers this element (a held row, a fogged plot): it gets no watch cue until it lifts. */
  covered?(el: HTMLElement): boolean
}

export type Cues = {
  set(spot: Spot | null, acts: readonly Action[], s: GuideState): void
  stage(st: Stage, s: GuideState): void
  sync(s: GuideState): void
  /** Point at one named thing: a highlighted name in the card was touched. */
  poke(ref: string): void
  showMe(): void
  frame(): void
  /** How a slot's socket should glow: 'do' bright, 'watch' soft, null as before. */
  role(id: SlotId): 'do' | 'watch' | null
  /** The notebook control the student acts on right now (the r slider, 5×, battery out, Play), or null. */
  doTarget(): { control: Control; el: HTMLElement } | null
  /** Where a keyboard goes next for the step's action: the control, the dial button, the chip or the slot button,
   *  with its name for "Go to ..." ("the 6 Ω resistor", "R₃"). Null outside the act phase. */
  doKey(): { el: HTMLElement; name: string } | null
  dispose(): void
}

/** What a tray chip is called in the card ("Go to the 6 Ω resistor"). */
const chipName = (chip: string) => (chip === 'wire' ? 'the wire' : chip === 'cap' ? 'the capacitor' : `the ${chip} Ω resistor`)

/** What a control is called in the card ("Scroll to the r slider"). */
export const CONTROL_NAMES: Record<Control, string> = {
  r: 'the r slider',
  'bat-out': 'the "Discharge: battery out" button',
  'speed-5': 'the 5× button',
  play: 'the Play button',
}

/** True when a press at the element's center would land on it: inside the viewport and not under the pinned board,
 *  the card's footer or a scroll box's edge. */
export function onScreen(el: Element | null): boolean {
  if (!el) return false
  const r = el.getBoundingClientRect()
  if (r.width === 0 || r.height === 0) return false
  const x = r.left + r.width / 2, y = r.top + r.height / 2
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false
  const top = document.elementFromPoint(x, y)
  return !!top && (top === el || el.contains(top))
}

/** The cue runtime of a sim root, so the tour card can ask what the student should act on. */
const registry = new WeakMap<Element, Cues>()
export const cuesOf = (root: Element | null): Cues | null => (root ? registry.get(root) ?? null : null)

const EMPTY: Targets = { doSlots: [], doChips: [], control: null, dial: null, remove: null, watchSlots: [], watchChips: [], hud: false, rows: [], time: false, battery: false, gesture: null }
const NUDGE_FIRST = 6000
const NUDGE_GAPS = [8000, 11000]
/** Beacon motion plays this many times on arrival and on each nudge, then rests: motion that never stops turns into
 *  background (and moving content that starts by itself should stop within about 5 s). */
const BEACON_TIMES = 2
const BEACON_EVERY = 1500
const EASE_SPRING = 'cubic-bezier(0.34, 1.4, 0.64, 1)'
const ICON_HAND = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L3.6 15.5a1.5 1.5 0 0 1 2.3-1.9L8 16"/></svg>'

export function createCues(host: CueHost): Cues {
  let spot: Spot | null = null
  let acts: readonly Action[] = []
  let stage: Stage = 'off'
  let tg: Targets = EMPTY
  let state: GuideState | null = null
  /** In 'act' the do cues wait for their arrival (the camera landing, the task card opening); until then they are watch. */
  let actReady = false
  const marked = new Map<HTMLElement, 'do' | 'watch'>()
  const timers = new Set<number>()
  const later = (ms: number, fn: () => void) => { const t = window.setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t) }
  /** Every scripted animation the cues start, so a stage or step change stops them all. */
  const anims = new Set<Animation>()
  const track = (a: Animation) => { anims.add(a); a.finished.then(() => anims.delete(a), () => anims.delete(a)); return a }
  const paintRoot = () => {
    host.root.dataset.cues = ['on', ...CUES].join(' ')
    host.root.dataset.cueStage = stage
  }

  // ---------- marking ----------
  const desired = () => {
    const want = new Map<HTMLElement, 'do' | 'watch'>()
    if (stage === 'off') return want
    const put = (el: HTMLElement | null | undefined, role: 'do' | 'watch') => {
      if (!el || (role === 'watch' && (want.has(el) || host.covered?.(el)))) return
      want.set(el, role)
    }
    // Before the prediction the do targets show quietly, as things to look at; once acted on, the slot stays as a
    // place to watch (its label reads the new value) and the chip and buttons let go.
    const live = stage === 'act' && actReady
    // while reading and predicting, the task's chips and controls are not pointed at (freeze.ts, rule D4)
    const t = stage === 'look' ? lookTargets(tg) : tg
    if (stage !== 'done') {
      for (const c of t.doChips) put(host.chip(c), live ? 'do' : 'watch')
      if (t.control) put(host.control(t.control), live ? 'do' : 'watch')
      if (t.dial && live) put(host.dialButton(t.dial.dir), 'do')
      if (t.remove && live) put(host.removeButton(), 'do')
    }
    for (const id of t.doSlots) put(host.label(id), live ? 'do' : 'watch')
    for (const id of t.watchSlots) put(host.label(id), 'watch')
    for (const c of t.watchChips) put(host.chip(c), 'watch')
    if (t.hud) put(host.hud(), 'watch')
    if (t.time) put(host.time(), 'watch')
    if (t.battery) put(host.battery(), 'watch')
    for (const r of t.rows) put(host.row(r), 'watch')
    if (stage === 'done') {
      // once the answer is out: what to look at now, and Play while the clock waits right after the change
      for (const id of spot?.done?.slots ?? []) put(host.label(id), 'watch')
      if (spot?.done?.play && state?.waiting) put(host.control('play'), 'do')
    }
    return want
  }
  const remark = () => {
    const want = desired()
    for (const [el] of marked) if (!want.has(el)) { delete el.dataset.spot; marked.delete(el) }
    const fresh: [HTMLElement, 'do' | 'watch'][] = []
    for (const [el, role] of want) {
      if (marked.get(el) === role) continue
      el.dataset.spot = role
      marked.set(el, role)
      fresh.push([el, role])
    }
    const th = tg.control === 'r' ? host.control('r')?.querySelector('input') : null
    if (th) th.parentElement!.style.setProperty('--thumb', String((Number(th.value) - Number(th.min)) / (Number(th.max) - Number(th.min) || 1)))
    return fresh
  }

  // ---------- small motions (Web Animations: the frame loop owns the labels' translate) ----------
  /** The ring draws in from wide and clear. Chips carry their ring inside (the tray clips anything outside). */
  const ringIn = (el: HTMLElement, role: 'do' | 'watch', delay: number) => {
    if (host.reduce()) return
    if (el.classList.contains('sim02-chip')) {
      if (el.classList.contains('is-holding')) return
      const to = role === 'do' ? 'inset 0 0 0 3px rgb(90, 77, 170)' : 'inset 0 0 0 2px rgba(116, 103, 194, 0.55)'
      track(el.animate([{ boxShadow: 'inset 0 0 0 14px rgba(90, 77, 170, 0)' }, { boxShadow: to }], { duration: 620, delay, easing: EASE_SPRING, fill: 'backwards' }))
      return
    }
    const to = role === 'do' ? 'rgb(90, 77, 170)' : 'rgba(116, 103, 194, 0.6)'
    track(el.animate([{ outlineOffset: '16px', outlineColor: 'rgba(116, 103, 194, 0)' }, { outlineOffset: role === 'do' ? '2px' : '3px', outlineColor: to }], { duration: 620, delay, easing: EASE_SPRING, fill: 'backwards' }))
  }
  const hop = (el: HTMLElement | null, delay: number) => {
    if (!el || host.reduce() || el.classList.contains('is-holding')) return
    track(el.animate([{ translate: '0 0' }, { translate: '0 -5px', offset: 0.3 }, { translate: '0 0', offset: 0.6 }, { translate: '0 -2px', offset: 0.8 }, { translate: '0 0' }], { duration: 620, delay, easing: 'ease-out' }))
  }
  const pop = (el: HTMLElement | null, delay: number) => {
    if (!el || host.reduce()) return
    track(el.animate([{ scale: '1' }, { scale: '1.14', offset: 0.35 }, { scale: '0.97', offset: 0.7 }, { scale: '1' }], { duration: 560, delay, easing: 'ease-out' }))
  }
  /** Beacon: the pin label bobs toward its part, the chip hops, a button sends out rings, the socket ripples. */
  const beacon = (delay: number) => {
    if (host.reduce()) return
    const times = { iterations: BEACON_TIMES, delay }
    for (const id of tg.doSlots) {
      const l = host.label(id)
      if (l) {
        const side = l.classList.contains('is-side'), below = l.classList.contains('is-below')
        const kf = side ? [{ left: '0px' }, { left: '-5px' }, { left: '0px' }] : [{ top: '0px' }, { top: below ? '5px' : '-5px' }, { top: '0px' }]
        track(l.animate(kf, { duration: BEACON_EVERY, easing: 'ease-in-out', ...times }))
      }
      for (let k = 0; k < BEACON_TIMES; k++) later(delay + k * BEACON_EVERY, () => host.ripple(id))
    }
    for (const c of tg.doChips) {
      const el = host.chip(c)
      if (el && !el.classList.contains('is-holding')) track(el.animate([{ translate: '0 0' }, { translate: '0 0', offset: 0.55 }, { translate: '0 -4px', offset: 0.68 }, { translate: '0 0', offset: 0.8 }, { translate: '0 -1.5px', offset: 0.88 }, { translate: '0 0' }], { duration: BEACON_EVERY, ...times }))
    }
    // a control off screen gets no ring (nobody sees it); the card's "Scroll to" line is pointed at instead
    const ctl = tg.control ? host.control(tg.control) : null
    const rings = [ctl && onScreen(ctl) ? ctl : null, tg.dial ? host.dialButton(tg.dial.dir) : null, tg.remove ? host.removeButton() : null]
    for (const el of rings) if (el) track(el.animate([{ boxShadow: '0 0 0 0 rgba(90, 77, 170, 0.42)' }, { boxShadow: '0 0 0 14px rgba(90, 77, 170, 0)', offset: 0.7 }, { boxShadow: '0 0 0 14px rgba(90, 77, 170, 0)' }], { duration: BEACON_EVERY, easing: 'ease-out', ...times }))
  }
  const drawRefs = () => {
    const refs = [...host.root.querySelectorAll<HTMLElement>('.sim02-guide-task:not([hidden]) .sim02-guide-ref')]
    if (host.reduce()) { refs.forEach(r => r.classList.add('is-drawn')); return }
    refs.forEach(r => r.classList.remove('is-drawn'))
    void host.root.offsetWidth
    refs.forEach((r, k) => later(k * 130, () => r.classList.add('is-drawn')))
  }

  /** The card's "Scroll to ..." line, when the control to use is off screen: it gets the ring the control would get. */
  const pointGoto = (delay: number) => {
    const g = host.root.querySelector<HTMLElement>('.sim02-guide-goto:not([hidden])')
    if (g) { ringIn(g, 'do', delay); pop(g, delay) }
  }

  /** The do targets announce themselves in the order the student uses them: the words, the part, the place. */
  const arriveNow = () => {
    actReady = true
    remark()
    drawRefs()
    if (host.reduce()) return
    let t = 160
    for (const c of tg.doChips) { const el = host.chip(c); if (el) { ringIn(el, 'do', t); hop(el, t); t += 150 } }
    for (const id of tg.doSlots) { const at = t; later(at, () => host.ripple(id)); pop(host.label(id), at); t += 170 }
    if (tg.control) {
      const el = host.control(tg.control)
      if (el && onScreen(el)) { ringIn(el, 'do', t); pop(el.matches('button') ? el : null, t) }
      else pointGoto(t)
    }
    if (tg.dial) { const b = host.dialButton(tg.dial.dir); if (b) { ringIn(b, 'do', t); pop(b, t) } }
    if (tg.remove) { const b = host.removeButton(); if (b) { ringIn(b, 'do', t); pop(b, t) } }
    beacon(t + 500)
  }

  // ---------- idle nudges and the show-me hand ----------
  let nudgeAt = Infinity
  let nudges = 0
  const armNudges = (from: number) => { nudges = 0; nudgeAt = from + NUDGE_FIRST }
  const onInput = () => { if (nudgeAt !== Infinity) nudgeAt = performance.now() + NUDGE_FIRST; cancelGhost() }
  // on the document: a key pressed with focus on the page itself, or a scroll of the page, counts as the student at it
  const INPUTS = ['pointerdown', 'keydown', 'input', 'wheel', 'scroll'] as const
  for (const t of INPUTS) document.addEventListener(t, onInput, { capture: true, passive: true })

  let ghost: HTMLElement | null = null
  const ghostAnims = new Set<Animation>()
  const ghostTimers = new Set<number>()
  const ghostLater = (ms: number, fn: () => void) => { const t = window.setTimeout(() => { ghostTimers.delete(t); fn() }, ms); ghostTimers.add(t) }
  const cancelGhost = () => {
    for (const a of ghostAnims) a.cancel()
    ghostAnims.clear()
    for (const t of ghostTimers) clearTimeout(t)
    ghostTimers.clear()
    ghost?.remove()
    ghost = null
  }
  /** Stop everything the cues have going: timers, animations, the hand. */
  const stopAll = () => {
    for (const t of timers) clearTimeout(t)
    timers.clear()
    for (const a of anims) a.cancel()
    anims.clear()
    cancelGhost()
  }
  const wrapToViewport = (p: { x: number; y: number }) => { const r = host.wrap.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top } }
  const centerOf = (el: Element | null) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  /** A slot's point on screen, only when the slot is inside the board's own window (not off past the canvas edge). */
  const slotAt = (id: SlotId) => {
    const p = host.slotPoint(id)
    if (!p || p.x < 0 || p.y < 0 || p.x > host.wrap.clientWidth || p.y > host.wrap.clientHeight) return null
    const v = wrapToViewport(p)
    return v.x >= 0 && v.y >= 0 && v.x <= innerWidth && v.y <= innerHeight ? v : null
  }
  /**
   * Where the hand lets go of a part it takes off the board: the nearest point (searching outward from the slot,
   * mostly downward first) where a real release takes the part off the board, with room for the hand and the
   * part copy above it on screen. Null when there is no such point.
   */
  const dropPoint = (b: { x: number; y: number }) => {
    const pref = Math.atan2(150, -30)
    const turn = (a: number) => Math.abs(Math.atan2(Math.sin(a - pref), Math.cos(a - pref)))
    const angles = Array.from({ length: 24 }, (_, k) => (k * Math.PI) / 12).sort((p, q) => turn(p) - turn(q))
    // past the board's edge if there is room on screen, else anywhere the part can't snap back onto a socket
    for (const past of [true, false]) {
      for (let rad = 60; rad <= 480; rad += 15) {
        for (const ang of angles) {
          const q = { x: b.x + rad * Math.cos(ang), y: b.y + rad * Math.sin(ang) }
          if (q.x < 30 || q.x > innerWidth - 30 || q.y < GHOST_TOP || q.y > innerHeight - 40) continue
          if (host.dropsOff(q.x, q.y, past)) return q
        }
      }
    }
    return null
  }
  /** Play a path: the hand (and, for a drag, a copy of the chip) moves through points; `press` marks when it presses. */
  const play = (pts: { x: number; y: number; at: number; press?: boolean }[], duration: number, chip: HTMLElement | null, chipFrom = 0) => {
    cancelGhost()
    const g = document.createElement('div')
    g.className = 'sim02-ghost'
    g.setAttribute('aria-hidden', 'true')
    g.innerHTML = `${chip ? `<div class="sim02-ghost-chip">${chip.querySelector('.sim02-chip-art')?.outerHTML ?? ''}</div>` : ''}<div class="sim02-ghost-hand">${ICON_HAND}</div><div class="sim02-ghost-ring"></div>`
    host.root.appendChild(g)
    ghost = g
    const add = (a: Animation) => { ghostAnims.add(a); return a }
    const frames = pts.map(p => ({ translate: `${p.x}px ${p.y}px`, offset: p.at }))
    const fade = [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.86 }, { opacity: 0, offset: 1 }]
    const path = add(g.animate(frames, { duration, easing: 'ease-in-out', fill: 'both' }))
    add(g.animate(fade, { duration, fill: 'both' }))
    // a part picked up off the board shows up in the hand only once the hand presses on it
    const copy = g.querySelector<HTMLElement>('.sim02-ghost-chip')
    if (copy && chipFrom > 0) add(copy.animate([{ opacity: 0 }, { opacity: 0, offset: chipFrom }, { opacity: 0.92, offset: Math.min(1, chipFrom + 0.1) }, { opacity: 0.92 }], { duration, fill: 'both' }))
    const hand = g.querySelector<HTMLElement>('.sim02-ghost-hand')!
    const ring = g.querySelector<HTMLElement>('.sim02-ghost-ring')!
    for (const p of pts.filter(q => q.press)) {
      const at = p.at * duration
      add(hand.animate([{ scale: '1' }, { scale: '0.8', offset: 0.5 }, { scale: '1' }], { duration: 320, delay: Math.max(0, at - 120), fill: 'none' }))
      add(ring.animate([{ scale: '0.3', opacity: 0.9 }, { scale: '1.7', opacity: 0 }], { duration: 600, delay: at, easing: 'ease-out', fill: 'both' }))
    }
    path.finished.then(() => { if (ghost === g) cancelGhost() }, () => {})
  }
  /** Act out the next action. False when it could not play (the target is off screen, motion is reduced, ...). */
  const playGesture = (): boolean => {
    if (!state || host.reduce() || host.busy()) return false
    const gst = resolveTargets(spot, acts, state).gesture
    if (!gst) return false
    if (gst.kind === 'drag') {
      const a = centerOf(host.chip(gst.chip)), b = slotAt(gst.slot)
      if (!a || !b) return false
      // the arc's peak stays low enough that the chip copy riding above the hand (46 px up) stays on screen
      const mid = { x: (a.x + b.x) / 2, y: Math.max(Math.min(a.y, b.y) - 70, GHOST_TOP) }
      play([
        { ...a, at: 0 }, { ...a, at: 0.14, press: true }, { x: a.x, y: a.y - 24, at: 0.26 },
        { ...mid, at: 0.55 }, { x: b.x, y: b.y - 12, at: 0.78 }, { ...b, at: 0.86, press: true }, { ...b, at: 1 },
      ], 2100, host.chip(gst.chip))
      ghostLater(2100 * 0.86, () => host.ripple(gst.slot))
    } else if (gst.kind === 'tap-slot') {
      const b = slotAt(gst.slot)
      if (!b) return false
      play([{ x: b.x + 46, y: b.y + 58, at: 0 }, { ...b, at: 0.5 }, { ...b, at: 0.62, press: true }, { ...b, at: 1 }], 1500, null)
      ghostLater(1500 * 0.62, () => host.ripple(gst.slot))
    } else if (gst.kind === 'dial') {
      const b = centerOf(host.dialButton(gst.dir))
      if (!b) return false
      play([{ x: b.x + 40, y: b.y + 50, at: 0 }, { ...b, at: 0.4 }, { ...b, at: 0.5, press: true }, { ...b, at: 0.75, press: true }, { ...b, at: 1 }], 1800, null)
    } else if (gst.kind === 'remove') {
      const b = centerOf(host.removeButton())
      if (!b) return false
      play([{ x: b.x + 40, y: b.y + 50, at: 0 }, { ...b, at: 0.5 }, { ...b, at: 0.62, press: true }, { ...b, at: 1 }], 1500, null)
    } else if (gst.kind === 'drag-off') {
      const b = slotAt(gst.slot)
      const out = b ? dropPoint(b) : null
      if (!b || !out) return false
      const part = state.slots[gst.slot]
      const lift = { x: b.x + (out.x - b.x) * 0.2, y: b.y + (out.y - b.y) * 0.2 }
      play([{ ...b, at: 0 }, { ...b, at: 0.2, press: true }, { ...lift, at: 0.42 }, { ...out, at: 0.85 }, { ...out, at: 1 }], 1900, part ? host.chip(chipId(part)) : null, 0.2)
    } else if (gst.kind === 'slide') {
      const input = host.control('r')?.querySelector('input')
      if (!input) return false
      if (!onScreen(input)) return false
      const r = input.getBoundingClientRect()
      const f = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min) || 1)
      const a = { x: r.left + 10 + f * (r.width - 20), y: r.top + r.height / 2 }
      const b = { x: Math.min(r.right - 12, a.x + 80), y: a.y }
      play([{ ...a, at: 0 }, { ...a, at: 0.22, press: true }, { ...b, at: 0.75 }, { ...b, at: 1 }], 1700, null)
    } else {
      const ctl = host.control(gst.control)
      const b = onScreen(ctl) ? centerOf(ctl) : null
      if (!b) return false
      play([{ x: b.x + 40, y: b.y + 50, at: 0 }, { ...b, at: 0.5 }, { ...b, at: 0.62, press: true }, { ...b, at: 1 }], 1500, null)
    }
    return true
  }
  /** Show me: the hand, once the camera has landed; if the hand cannot play, the targets announce themselves again. */
  const showMe = (tries = 0) => {
    if (stage !== 'act') return
    if (host.flying() && tries < 8) { ghostLater(250, () => showMe(tries + 1)); return }
    if (!playGesture()) arriveNow()
  }

  let lookAt = 0
  const startAct = (lead: number) => {
    actReady = false
    armNudges(performance.now() + lead)
    remark()
    later(lead, arriveNow)
  }

  const api: Cues = {
    set(sp, a, s) {
      // a new step (or the end of the tour): its stage starts over
      stopAll()
      spot = sp
      acts = a
      state = s
      tg = sp ? resolveTargets(sp, a, s) : EMPTY
      stage = 'off'
      actReady = false
      nudgeAt = Infinity
      paintRoot()
      remark()
    },
    stage(st, s) {
      if (st === stage) return
      const prev = stage
      stopAll()
      stage = st
      state = s
      tg = spot ? resolveTargets(spot, acts, s) : EMPTY
      nudgeAt = Infinity
      paintRoot()
      if (st === 'act') {
        // a step that opens straight on its task waits for the camera to land; a task after a prediction is quicker
        startAct(prev === 'look' && performance.now() - lookAt > 400 ? 320 : 800)
      } else {
        if (st === 'look') lookAt = performance.now()
        const fresh = remark()
        if (st === 'look') fresh.forEach(([el, role], k) => ringIn(el, role, 500 + k * 90))
        // the answer's own targets draw in after the reveal lands
        if (st === 'done') fresh.forEach(([el, role], k) => ringIn(el, role, 700 + k * 90))
      }
    },
    sync(s) {
      state = s
      if (!spot) return
      const before = tg
      tg = resolveTargets(spot, acts, s)
      remark()
      // the dial just opened: its button (+, −, or Remove) takes over from the slot
      if (stage === 'act' && actReady && tg.dial && !before.dial) {
        const b = host.dialButton(tg.dial.dir)
        if (b) { ringIn(b, 'do', 120); pop(b, 120) }
      }
      if (stage === 'act' && actReady && tg.remove && !before.remove) {
        const b = host.removeButton()
        if (b) { ringIn(b, 'do', 120); pop(b, 120) }
      }
    },
    poke(ref) {
      if (host.reduce()) return
      const [kind, id] = ref.split(':') as [string, string | undefined]
      if (kind === 'slot' && id) { host.ripple(id as SlotId); pop(host.label(id as SlotId), 0) }
      else if (kind === 'chip' && id) hop(host.chip(id), 0)
      else if (kind === 'ctl' && id) { const el = host.control(id as Control); if (el) { ringIn(el, marked.get(el) ?? 'do', 0); pop(el.matches('button') ? el : null, 0) } }
      else if (kind === 'remove') {
        const b = tg.remove ? host.removeButton() : null
        if (b) pop(b, 0)
        else for (const sl of tg.doSlots) { host.ripple(sl); pop(host.label(sl), 0) }
      } else if (kind === 'dial') {
        const b = tg.dial ? host.dialButton(tg.dial.dir) : null
        if (b) pop(b, 0)
        else for (const sl of tg.doSlots) { host.ripple(sl); pop(host.label(sl), 0) }
      }
    },
    showMe: () => showMe(),
    frame() {
      if (stage !== 'act' || !actReady || host.reduce()) return
      const now = performance.now()
      // a part in hand means the student is at it: hold the nudges off
      if (host.busy()) { if (nudgeAt !== Infinity) nudgeAt = Math.max(nudgeAt, now + NUDGE_FIRST); return }
      if (now > nudgeAt) {
        nudgeAt = nudges < NUDGE_GAPS.length ? now + NUDGE_GAPS[nudges]! : Infinity
        nudges++
        // the hand acts the move out; where it cannot (the target is off screen), the targets announce themselves
        if (playGesture()) return
        arriveNow()
      }
    },
    role(id) {
      if (stage === 'off') return null
      if (stage === 'act' && actReady && tg.doSlots.includes(id)) return 'do'
      if (tg.watchSlots.includes(id) || tg.doSlots.includes(id)) return 'watch'
      return null
    },
    doKey() {
      if (stage !== 'act') return null
      const t = tg
      const ctl = t.control ? host.control(t.control) : null
      if (t.control && ctl) return { el: ctl, name: CONTROL_NAMES[t.control] }
      if (t.dial) { const b = host.dialButton(t.dial.dir); if (b) return { el: b, name: `the ${t.dial.dir > 0 ? '+' : '−'} button on ${SUB[t.dial.slot]}'s dial` } }
      if (t.remove) { const b = host.removeButton(); if (b) return { el: b, name: `Remove ${SUB[t.remove]}` } }
      const chip = t.doChips[0] ? host.chip(t.doChips[0]) : null
      if (chip && !chip.matches('[aria-disabled="true"], :disabled')) return { el: chip, name: chipName(t.doChips[0]!) }
      const slot = t.doSlots[0] ? host.slotButton(t.doSlots[0]) : null
      return slot ? { el: slot, name: SUB[t.doSlots[0]!]! } : null
    },
    doTarget() {
      if (stage !== 'act' || !tg.control) return null
      const el = host.control(tg.control)
      return el ? { control: tg.control, el } : null
    },
    dispose() {
      stopAll()
      registry.delete(host.root)
      for (const t of INPUTS) document.removeEventListener(t, onInput, { capture: true })
      for (const [el] of marked) delete el.dataset.spot
      marked.clear()
      delete host.root.dataset.cues
      delete host.root.dataset.cueStage
    },
  }
  registry.set(host.root, api)
  return api
}
