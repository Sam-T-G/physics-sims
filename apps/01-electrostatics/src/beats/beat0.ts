// Beat 0, the hook: two charged bobs on strings, nothing touching. The flash-forward lives in chrome.ts.
import { createSegmented, createSlider, type Chapters } from '@lib/chrome'
import { HOOK_COPY } from '../content'
import type { Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import type { Readout } from './beat5'
import { sig3 } from '../flow'

export type Beat0 = { panel: HTMLElement; enter(): void; leave(): void; update(): void }

export function createBeat0(o: { doc: Document; prefix: string; physics: Sim1Physics; render: Sim1Render; chapters: Chapters; readout: Readout }): Beat0 {
  const { doc, prefix: p, physics, render, readout } = o
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true
  const note = doc.createElement('p')
  note.className = `${p}-note`
  note.textContent = HOOK_COPY.note
  const apart = createSlider({ doc, prefix: p, label: HOOK_COPY.apart, min: 0.35, max: 1.0, step: 0.01, value: 0.5, format: v => `${v.toFixed(2)} m`, onInput: v => physics.pendulum.set({ D: v }) })
  const signs = createSegmented({
    doc,
    prefix: p,
    label: HOOK_COPY.signs,
    options: [
      { id: 'same', label: HOOK_COPY.same },
      { id: 'opposite', label: HOOK_COPY.opposite },
    ],
    value: 'same',
    onChange: id => physics.pendulum.set({ opposite: id === 'opposite' }),
  })
  panel.append(note, apart.el, signs.el)
  let last = ''
  return {
    panel,
    enter() {
      physics.pendulum.reset()
      apart.set(physics.pendulum.D)
      signs.set('same')
      panel.hidden = false
      render.show('pendulum')
      readout.caption(null)
      readout.show()
      last = '' // the flash-forward may have written its own number; repaint on the next frame
    },
    leave() {
      panel.hidden = true
      readout.hide()
    },
    update() {
      if (panel.hidden) return
      const pd = physics.pendulum
      const deg = (pd.theta() * 180) / Math.PI
      const main = `${deg.toFixed(1)}° off vertical`
      const sub = pd.touching() ? `they swung in until they touched: pull ${sig3(pd.force())} N, the strings hold them there` : `${pd.opposite ? 'pull' : 'push'} between them: ${sig3(pd.force())} N, ${(pd.separation() * 100).toFixed(0)} cm apart`
      const key = main + sub
      if (key !== last) {
        readout.set(main, sub)
        last = key
      }
    },
  }
}
