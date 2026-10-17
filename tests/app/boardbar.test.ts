import { describe, expect, it } from 'vitest'
import { solveBoard, type Slots } from '../../apps/02-circuits/src/board'
import {
  statusFor, gapWords, previewPaints, pillOn, emptyDisabled, createUndo, snapBoard, boardKey, CLEARED, UNDO_MS, type BoardSnap,
} from '../../apps/02-circuits/src/boardbar'
import { useMilli, reading } from '../../apps/02-circuits/src/format'

const board = (slots: Slots, emf = 12, r = 0) => solveBoard({ emf, r, slots })

describe('status line', () => {
  it('names every empty slot', () => {
    expect(gapWords(['R1'])).toEqual({ text: 'R₁', plural: false })
    expect(gapWords(['R1', 'R5'])).toEqual({ text: 'R₁ and R₅', plural: true })
    expect(gapWords(['lanes'])).toEqual({ text: 'R₂, R₃ and R₄', plural: true })
    expect(gapWords(['R1', 'lanes'])).toEqual({ text: 'R₁, R₂, R₃ and R₄', plural: true })
  })
  it('says the board is empty, and offers Undo right after Clear', () => {
    const b = board({})
    expect(statusFor(b, {}, 0, false)).toEqual({ html: 'The board is empty. Drag a part onto a slot.', warn: false })
    expect(statusFor(b, {}, 0, true)).toEqual({ html: 'Board cleared. Drag a part onto a slot, or press Undo.', warn: false })
  })
  it('a full capacitor in series: no wire "carries all the current" while nothing flows', () => {
    const s: Slots = { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R3: { kind: 'resistor', ohms: 6 }, R4: { kind: 'wire' }, R5: { kind: 'capacitor', farads: 0.5 } }
    const b = solveBoard({ emf: 12, r: 0, slots: s, capV: 12 })
    expect(b.bypassed.length).toBeGreaterThan(0)
    expect(statusFor(b, s, 0, false)).toEqual({ html: 'The capacitor is fully charged, so no current flows.', warn: false })
  })
  it('words an open circuit with the gaps, the reason hidden on phones', () => {
    const one: Slots = { R2: { kind: 'resistor', ohms: 6 }, R5: { kind: 'wire' } }
    expect(statusFor(board(one), one, 0, false).html).toBe('Open circuit: R₁ is empty<span class="sim02-long">, so no current flows</span>.')
    const lanes: Slots = { R1: { kind: 'resistor', ohms: 2 }, R5: { kind: 'wire' } }
    expect(statusFor(board(lanes), lanes, 0, false).html).toBe('Open circuit: R₂, R₃ and R₄ are empty<span class="sim02-long">, so no current flows</span>.')
  })
  it('words a cut-off battery with a discharging capacitor in one short line on phones', () => {
    const cut: Slots = { R2: { kind: 'resistor', ohms: 6 }, R3: { kind: 'capacitor', farads: 0.5 }, R5: { kind: 'wire' } }
    const b = solveBoard({ emf: 12, r: 0, slots: cut, capV: 9 })
    expect(statusFor(b, cut, 0, false).html).toBe('The empty R₁ slot cuts off the battery.<span class="sim02-long"> The capacitor discharges through R₂.</span>')
  })
  it('an open circuit stays calm even when a wire also bypasses a branch; a short stays red', () => {
    const s: Slots = { R2: { kind: 'wire' }, R3: { kind: 'resistor', ohms: 6 }, R4: { kind: 'capacitor', farads: 0.5 }, R5: { kind: 'wire' } }
    const b = board(s)
    expect(b.status).toBe('open')
    expect(b.bypassed.length).toBeGreaterThan(0)
    expect(statusFor(b, s, 0, false)).toEqual({ html: 'Open circuit: R₁ is empty<span class="sim02-long">, so no current flows</span>.', warn: false })
    const short: Slots = { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R5: { kind: 'wire' } }
    expect(statusFor(board(short, 12, 0.5), short, 0.5, false).warn).toBe(true)
  })
  it('stays quiet for a plain closed circuit', () => {
    const ok: Slots = { R1: { kind: 'resistor', ohms: 2 }, R2: { kind: 'resistor', ohms: 6 }, R5: { kind: 'wire' } }
    expect(statusFor(board(ok), ok, 0, false)).toEqual({ html: '', warn: false })
  })
  it('keeps the short-circuit wording', () => {
    const short: Slots = { R1: { kind: 'wire' }, R2: { kind: 'wire' }, R5: { kind: 'wire' } }
    expect(statusFor(board(short, 12, 0.5), short, 0.5, false).html).toBe('Short circuit: only the internal resistance r = 0.5 Ω limits the current.'.replace(/ = 0.5 Ω/, '\u00a0=\u00a00.5\u00a0Ω'))
  })
})

describe('previews never change the layout', () => {
  it('paints everything on a commit', () => {
    expect(previewPaints(false, true, true)).toEqual({ panel: true, hud: true, time: true, status: true })
  })
  it('a capacitor held over a slot changes nothing', () => {
    expect(previewPaints(true, false, true)).toEqual({ panel: false, hud: false, time: false, status: false })
    expect(previewPaints(true, true, false)).toEqual({ panel: false, hud: false, time: false, status: false })
  })
  it('a resistor preview updates numbers only (no time module, no status)', () => {
    expect(previewPaints(true, false, false)).toEqual({ panel: true, hud: true, time: false, status: false })
  })
  it('the clock pill follows the committed board, not the preview', () => {
    expect(pillOn(false)).toBe(false)
    expect(pillOn(true)).toBe(true)
  })
})

describe('Empty the capacitor', () => {
  it('is off when the capacitor is empty and nothing is charging it', () => {
    expect(emptyDisabled(0, false, true, false)).toBe(true) // paused
    expect(emptyDisabled(0, true, false, false)).toBe(true) // static curve
    expect(emptyDisabled(0.0004, true, true, true)).toBe(true) // the curve is over
  })
  it('is on while the capacitor holds charge, or while a charge is starting', () => {
    expect(emptyDisabled(5, false, true, true)).toBe(false)
    expect(emptyDisabled(0, true, true, false)).toBe(false)
  })
})

describe('Clear and Undo', () => {
  const before: BoardSnap = {
    slots: { R1: { kind: 'resistor', ohms: 2 }, R3: { kind: 'capacitor', farads: 0.5 }, R5: { kind: 'wire' } },
    emf: 20, r: 0.5, batteryIn: false, capV: 7.5, playing: false, compare: { hidden: false, html: '<table></table>' },
  }
  const clearedKey = boardKey({}, CLEARED.emf, CLEARED.r, CLEARED.batteryIn)

  it('restores everything: parts, battery, charge, a paused clock and the book table', () => {
    const u = createUndo()
    u.arm(before, clearedKey)
    expect(u.inWindow).toBe(true)
    expect(u.take()).toEqual(before)
    expect(u.canUndo).toBe(false)
  })
  it('keeps a deep copy, so later edits to the board never reach it', () => {
    const live = snapBoard(before)
    const u = createUndo()
    u.arm(live, clearedKey)
    ;(live.slots.R3 as { farads: number }).farads = 5
    live.emf = 3
    const s = u.take()!
    expect(s.slots.R3).toEqual({ kind: 'capacitor', farads: 0.5 })
    expect(s.emf).toBe(20)
  })
  it('the button reads Undo for 8 s; the timer waits while hovered or focused', () => {
    const u = createUndo()
    u.arm(before, clearedKey)
    expect(u.tick(UNDO_MS - 100, false)).toBe(false)
    expect(u.tick(5000, true)).toBe(false) // paused
    expect(u.inWindow).toBe(true)
    expect(u.tick(200, false)).toBe(true) // closes now
    expect(u.inWindow).toBe(false)
  })
  it('Cmd/Ctrl+Z still restores after the window, until the board changes', () => {
    const u = createUndo()
    u.arm(before, clearedKey)
    u.tick(UNDO_MS + 1, false)
    expect(u.inWindow).toBe(false)
    expect(u.canUndo).toBe(true)
    u.change(clearedKey) // a commit that didn't change the board (a tap, a deselect)
    expect(u.canUndo).toBe(true)
    u.change(boardKey({ R1: { kind: 'wire' } }, 12, 0, true))
    expect(u.canUndo).toBe(false)
    expect(u.take()).toBe(null)
  })
  it('a battery change counts as a board change', () => {
    const u = createUndo()
    u.arm(before, clearedKey)
    u.change(boardKey({}, 13, 0, true))
    expect(u.canUndo).toBe(false)
  })
})

describe('milli-unit hysteresis', () => {
  it('switches at 0.1 with no history, and holds its unit near 0.1 with one', () => {
    expect(useMilli(0.099)).toBe(true)
    expect(useMilli(0.099, false)).toBe(false)
    expect(useMilli(0.094, false)).toBe(true)
    expect(useMilli(0.102, true)).toBe(true)
    expect(useMilli(0.106, true)).toBe(false)
    expect(useMilli(0)).toBe(false)
    expect(reading(0.0975, 'A', false)).toBe('0.0975 A')
    expect(reading(0.0975, 'A', true)).toBe('97.5 mA')
  })
})
