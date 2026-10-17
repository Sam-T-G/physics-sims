import { describe, it, expect } from 'vitest'
import { solveBoard } from '../../apps/02-circuits/src/board'
import { STEPS, type GuideState, type Setup } from '../../apps/02-circuits/src/tour'
import { readFileSync } from 'node:fs'
import { CUES, CONTROL_NAMES, resolveTargets, type Control } from '../../apps/02-circuits/src/cues'
import { setupChanges, expectedPart } from '../../apps/02-circuits/src/guide'

const fromSetup = (su: Setup): GuideState => {
  const b = solveBoard({ emf: su.emf, r: su.r, slots: su.slots, capV: su.capV ?? 0 })
  return { emf: su.emf, r: su.r, slots: { ...su.slots }, batteryIn: su.batteryIn ?? true, b, selected: null, rc: null }
}
const at = (id: string) => STEPS.findIndex(s => s.id === id)

describe('cue set', () => {
  it('ships Coach (onset, textlink, beacon, ghost) and nothing else', () => {
    expect([...CUES]).toEqual(['onset', 'textlink', 'beacon', 'ghost'])
    // the prototype's switcher, its ?cues= pick and the other sets are gone from the app and its styles
    const src = ['cues.ts', 'sim.ts', 'guide.ts', 'styles.css'].map(f => readFileSync(new URL(`../../apps/02-circuits/src/${f}`, import.meta.url), 'utf8')).join('\n')
    for (const gone of ['cuepanel', "get('cues')", 'sim02-veil', 'data-cues~="dim"', ':not([data-cues', 'CUE_PRESETS']) expect(src, gone).not.toContain(gone)
  })

  it('every notebook control has a name for the "Scroll to" line', () => {
    const all: Control[] = ['r', 'bat-out', 'speed-5', 'play']
    for (const c of all) expect(CONTROL_NAMES[c]).toMatch(/^the /)
  })

  it('the fill step points at 5× until the clock is sped up', () => {
    const st = STEPS[at('cap-fill')]!
    const s = fromSetup(st.setup!)
    expect(resolveTargets(st.spot ?? null, st.task!.auto, { ...s, speed: 1 }).control).toBe('speed-5')
    expect(resolveTargets(st.spot ?? null, st.task!.auto, { ...s, speed: 5 }).control).toBeNull()
  })
})

describe('tour start and "Do it for me" helpers', () => {
  it('a board that matches the step setup is not reset; any change is', () => {
    for (const st of STEPS) {
      if (!st.setup) continue
      const s = fromSetup(st.setup)
      expect(setupChanges(st, s), st.id).toBe(false)
      const moved = { ...s, r: s.r + 0.5 }
      expect(setupChanges(st, moved), st.id).toBe(!(st.keepIf?.(moved) ?? false))
    }
    const st = STEPS[at('add-resistor')]!
    const s = fromSetup(st.setup!)
    expect(setupChanges(st, { ...s, slots: { ...s.slots, R3: { kind: 'resistor', ohms: 8 } } })).toBe(true)
    expect(setupChanges(st, { ...s, batteryIn: false })).toBe(true)
  })

  it('every dial and tap in a task has a part to put back first', () => {
    STEPS.forEach((st, k) => {
      for (const a of st.task?.auto ?? []) {
        const slot = 'dial' in a ? a.dial : 'select' in a ? a.select : null
        if (!slot) continue
        const p = expectedPart(k, slot)
        expect(p, `${st.id} ${slot}`).not.toBeNull()
      }
    })
    expect(expectedPart(at('turn-up'), 'R1')?.kind).toBe('resistor')
    expect(expectedPart(at('cap-dial'), 'R5')?.kind).toBe('capacitor')
  })
})
