// Beat 2, Coulomb's law and superposition: equal and opposite arrows, F versus r, the third charge.
import { createCheckpoint, createLinkedEquation, createSegmented, createSlider, type Chapters } from '@lib/chrome'
import { createPlot2d } from '@lib/render'
import { COULOMB_COPY } from '../content'
import { COULOMB_R_MAX, type Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import type { Readout } from './beat5'
import { sig3, tweenValue, waitClick, type Run } from '../flow'
import { createButton } from '@lib/chrome'

export type Beat2 = { panel: HTMLElement; enter(): void; leave(): void; update(): void }

export function createBeat2(o: { doc: Document; prefix: string; physics: Sim1Physics; render: Sim1Render; chapters: Chapters; readout: Readout; reduced: () => boolean; run: Run }): Beat2 {
  const { doc, prefix: p, physics, render, chapters, readout, reduced, run } = o
  const c = physics.coulomb
  const scene = render.scenes.coulomb
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true

  const eq = createLinkedEquation({
    doc,
    prefix: p,
    label: 'Coulomb’s law',
    parts: [
      { id: 'F', text: 'F' },
      ' = ',
      { id: 'k', text: 'k', tip: COULOMB_COPY.tips.k },
      ' · ',
      { id: 'q1', text: 'q₁', tip: COULOMB_COPY.tips.q1 },
      ' · ',
      { id: 'q2', text: 'q₂', tip: COULOMB_COPY.tips.q2 },
      ' / ',
      { id: 'r2', text: 'r²', tip: COULOMB_COPY.tips.r2 },
    ],
    onFocus: id => {
      scene.highlight(id === 'q1' || id === 'q2' || id === 'r2' ? id : null)
      plot.el.classList.toggle(`${p}-plot-hot`, id === 'r2')
      if (id === 'r2') scene.highlight('r')
    },
  })
  const rSlider = createSlider({ doc, prefix: p, label: COULOMB_COPY.r, min: 0.3, max: COULOMB_R_MAX, step: 0.01, value: 0.5, format: v => `${v.toFixed(2)} m`, onInput: v => c.set({ r: v }) })
  const q1Slider = createSlider({ doc, prefix: p, label: COULOMB_COPY.q1, min: -4, max: 4, step: 0.5, value: 1, format: v => `${v > 0 ? '+' : ''}${v.toFixed(1)} μC`, onInput: v => c.set({ q1: v }) })
  const q2Slider = createSlider({ doc, prefix: p, label: COULOMB_COPY.q2, min: -4, max: 4, step: 0.5, value: 1, format: v => `${v > 0 ? '+' : ''}${v.toFixed(1)} μC`, onInput: v => c.set({ q2: v }) })
  const third = createSegmented({
    doc,
    prefix: p,
    label: COULOMB_COPY.third,
    options: [
      { id: 'off', label: COULOMB_COPY.off },
      { id: 'on', label: COULOMB_COPY.on },
    ],
    value: 'off',
    onChange: id => {
      c.set({ third: id === 'on' })
      thirdNote.hidden = id !== 'on'
    },
  })
  const thirdNote = doc.createElement('p')
  thirdNote.className = `${p}-note`
  thirdNote.textContent = COULOMB_COPY.thirdNote
  thirdNote.hidden = true
  const plot = createPlot2d({ doc, prefix: p, xLabel: 'r (m)', yLabel: 'F (N)', title: 'Force against distance' })
  const startBtn = createButton({ doc, prefix: p, label: 'Try a prediction', onClick: () => {} })
  const checkpoint = createCheckpoint({ doc, prefix: p })
  const nextBtn = createButton({ doc, prefix: p, label: 'One more', kind: 'quiet', onClick: () => {} })
  nextBtn.hidden = true
  panel.append(eq.el, plot.el, rSlider.el, q1Slider.el, q2Slider.el, third.el, thirdNote, startBtn, checkpoint.el, nextBtn)

  let done = false
  let flowId = 0
  const alive = (id: number) => () => id === flowId

  const lockSliders = (on: boolean) => {
    rSlider.disable(on)
    q1Slider.disable(on)
    q2Slider.disable(on)
  }
  const flow = async (id: number) => {
    await waitClick(startBtn)
    if (id !== flowId) return
    startBtn.hidden = true
    // The reveals assume the default r and q₁, so the sliders rest until both predictions are done.
    lockSliders(true)
    // Prediction 1: double r.
    const r0 = c.r
    const fmt = (v: number) => `×${v.toFixed(2)}`
    readout.hide()
    const said = await checkpoint.ask({ kind: 'slider', question: COULOMB_COPY.predict.question, min: 0, max: 2, step: 0.05, initial: 1, format: fmt })
    if (id !== flowId) return
    readout.show()
    const r1 = Math.min(COULOMB_R_MAX, 2 * r0)
    await tweenValue(run, r0, r1, 1.4, v => {
      c.set({ r: v })
      rSlider.set(v)
    }, reduced(), alive(id))
    if (id !== flowId) return
    const right = Math.abs(said - 0.25) <= 0.05
    checkpoint.reveal(right ? COULOMB_COPY.predict.right : COULOMB_COPY.predict.wrong(fmt(said)), right ? 'right' : 'wrong')
    nextBtn.hidden = false
    await waitClick(nextBtn)
    if (id !== flowId) return
    nextBtn.hidden = true
    checkpoint.clear()
    // Prediction 2: triple q1, both arrows.
    const q0 = c.q1
    await checkpoint.ask({ kind: 'choice', ...COULOMB_COPY.mcq })
    if (id !== flowId) return
    const q1 = Math.max(-4, Math.min(4, 3 * q0))
    await tweenValue(run, q0, q1, 1.2, v => {
      c.set({ q1: v })
      q1Slider.set(v)
    }, reduced(), alive(id))
    if (id !== flowId) return
    checkpoint.reveal(COULOMB_COPY.mcqDone, 'right')
    done = true
    lockSliders(false)
    chapters.lockNext(false)
  }

  let last = ''
  const paintPlot = () => plot.set(c.curve(60), [{ x: c.r, y: c.pairMagnitude(), label: `${c.r.toFixed(2)} m` }])
  let lastPlot = ''
  return {
    panel,
    enter() {
      flowId++
      c.reset()
      rSlider.set(c.r)
      q1Slider.set(c.q1)
      q2Slider.set(c.q2)
      third.set('off')
      thirdNote.hidden = true
      panel.hidden = false
      render.show('coulomb')
      readout.caption(null)
      readout.show()
      checkpoint.clear()
      nextBtn.hidden = true
      eq.focus(null)
      lockSliders(false)
      if (done) {
        startBtn.hidden = true
        checkpoint.reveal(COULOMB_COPY.mcqDone, 'right')
      } else {
        startBtn.hidden = false
        chapters.lockNext(true)
        void flow(flowId)
      }
    },
    leave() {
      panel.hidden = true
      readout.hide()
      eq.focus(null)
    },
    update() {
      if (panel.hidden) return
      const F = c.pairMagnitude()
      const main = `F = ${sig3(F)} N on each`
      const sub = `r = ${c.r.toFixed(2)} m${c.third ? ', plus the third charge’s push on q₂' : ''}`
      const key = main + sub
      if (key !== last) {
        readout.set(main, sub)
        last = key
      }
      eq.setTerm('F', `${sig3(F)} N`)
      eq.setTerm('q1', `${c.q1.toFixed(1)} μC`)
      eq.setTerm('q2', `${c.q2.toFixed(1)} μC`)
      eq.setTerm('r2', `(${c.r.toFixed(2)} m)²`)
      const pk = `${c.q1}|${c.q2}|${c.r}`
      if (pk !== lastPlot) {
        paintPlot()
        lastPlot = pk
      }
    },
  }
}
