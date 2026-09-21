// Beat 1, charge: a neutral pair pulled apart, the total that never moves, the counter in e.
import { createCheckpoint, createSegmented, createSlider, type Chapters } from '@lib/chrome'
import { CHARGE_COPY } from '../content'
import type { Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import type { Readout } from './beat5'
import { E_CHARGE } from '@lib/physics'

export type Beat1 = { panel: HTMLElement; enter(): void; leave(): void; update(): void }

export function createBeat1(o: { doc: Document; prefix: string; physics: Sim1Physics; render: Sim1Render; chapters: Chapters; readout: Readout }): Beat1 {
  const { doc, prefix: p, physics, render, chapters, readout } = o
  const pair = physics.pair
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true
  const pull = createSlider({ doc, prefix: p, label: CHARGE_COPY.pull, min: 0, max: 1, step: 0.01, value: 0, format: v => `${Math.round(v * 100)}%`, onInput: v => pair.set({ apart: v }) })
  const amount = createSlider({ doc, prefix: p, label: CHARGE_COPY.amount, min: 1, max: 8, step: 1, value: 3, format: v => `${v} e`, onInput: v => pair.set({ n: v }) })
  const other = createSegmented({
    doc,
    prefix: p,
    label: CHARGE_COPY.other,
    options: [
      { id: 'opposite', label: CHARGE_COPY.opposite },
      { id: 'same', label: CHARGE_COPY.same },
    ],
    value: 'opposite',
    onChange: id => pair.set({ same: id === 'same' }),
  })
  const conserved = doc.createElement('p')
  conserved.className = `${p}-note`
  conserved.textContent = CHARGE_COPY.conserved
  conserved.hidden = true
  const checkpoint = createCheckpoint({ doc, prefix: p })
  panel.append(pull.el, amount.el, other.el, conserved, checkpoint.el)

  let done = false
  let asked = false
  let flowId = 0
  const ask = async (id: number) => {
    asked = true
    conserved.hidden = false
    await checkpoint.ask({ kind: 'choice', ...CHARGE_COPY.mcq })
    if (id !== flowId) return
    checkpoint.reveal(CHARGE_COPY.mcqDone, 'right')
    done = true
    chapters.lockNext(false)
  }
  let last = ''
  return {
    panel,
    enter() {
      flowId++
      pair.reset()
      pull.set(0)
      amount.set(3)
      other.set('opposite')
      panel.hidden = false
      render.show('pair')
      readout.caption(null)
      readout.show()
      checkpoint.clear()
      if (done) {
        conserved.hidden = false
        checkpoint.reveal(CHARGE_COPY.mcqDone, 'right')
      } else {
        asked = false
        conserved.hidden = true
        chapters.lockNext(true)
      }
    },
    leave() {
      panel.hidden = true
      readout.hide()
    },
    update() {
      if (panel.hidden) return
      const total = pair.totalE()
      const e = (n: number) => (n > 0 ? `+${n}e` : n < 0 ? `−${-n}e` : '0')
      const main = `Total charge: ${e(total)}`
      const { a, b } = pair.charges()
      const na = Math.round(a / E_CHARGE)
      const nb = Math.round(b / E_CHARGE)
      const sum = `${e(na)} + (${e(nb)}) = ${e(na + nb)}`
      const sub = pair.apart < 0.05 ? (pair.same ? `${sum}. ${CHARGE_COPY.totalStacked}` : CHARGE_COPY.totalNothing) : `${sum}. ${pair.same ? CHARGE_COPY.totalSame : CHARGE_COPY.totalPair}`
      const key = main + sub
      if (key !== last) {
        readout.set(main, sub)
        last = key
      }
      // The what-do-you-see pause ends when they have pulled the pair apart and read the total.
      // The conservation note is about the opposite pair; hide it while the same-sign case is showing.
      if (asked || done) conserved.hidden = pair.same
      if (!done && !asked && !pair.same && pair.apart > 0.5) void ask(flowId)
    },
  }
}
