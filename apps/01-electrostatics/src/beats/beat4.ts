// Beat 4, flux: a loop in a uniform field, two loops in one bundle, and the hemisphere toy.
import { createButton, createCheckpoint, createLinkedEquation, createSlider, type CameraPreset, type Chapters } from '@lib/chrome'
import { createPlot2d } from '@lib/render'
import { gsap } from 'gsap'
import { CAMERA_SCENES, FLUX_COPY } from '../content'
import { UNIFORM_E, type Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import type { Readout } from './beat5'
import { sig3, tweenValue, waitClick, type Run } from '../flow'

export type Beat4 = { panel: HTMLElement; enter(): void; leave(): void; update(): void }

export function createBeat4(o: {
  doc: Document
  prefix: string
  physics: Sim1Physics
  render: Sim1Render
  chapters: Chapters
  readout: Readout
  reduced: () => boolean
  run: Run
  camera: (preset: CameraPreset) => void
}): Beat4 {
  const { doc, prefix: p, physics, render, chapters, readout, reduced, run } = o
  const loop = physics.loop
  const scene = render.scenes.flux
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true

  let nudge: gsap.core.Tween | null = null
  const eq = createLinkedEquation({
    doc,
    prefix: p,
    label: 'Flux through a flat loop',
    // Φ = E A cos θ with the live numbers; θ is the angle between E and n̂ (next line).
    parts: [
      { id: 'phi', text: 'Φ' },
      ' = ',
      { id: 'E', text: 'E', tip: FLUX_COPY.tips.E },
      ' × ',
      { id: 'A', text: 'A', tip: FLUX_COPY.tips.A },
      ' × ',
      { id: 'cos', text: 'cos θ', tip: FLUX_COPY.tips.cos },
    ],
    onFocus: id => {
      nudge?.kill()
      nudge = null
      const v = scene.visual
      v.tiltOffset = 0
      v.areaScale = 1
      v.lineOpacity = 0.6
      if (reduced() || !id) return
      if (id === 'cos') nudge = run(() => gsap.to(v, { tiltOffset: 8, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
      if (id === 'A') nudge = run(() => gsap.to(v, { areaScale: 1.15, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
      if (id === 'E') nudge = run(() => gsap.to(v, { lineOpacity: 1, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' }))
    },
  })
  // θ is measured from n̂. Tapping n̂ really flips it (in the physics), so Φ flips sign with it.
  const nEq = createLinkedEquation({
    doc,
    prefix: p,
    label: 'How θ is measured',
    parts: ['θ = the angle between E', ' and ', { id: 'n', text: 'n̂', tip: FLUX_COPY.tips.n }],
    onFocus: id => loop.set({ flipped: id === 'n' }),
  })
  const tilt = createSlider({ doc, prefix: p, label: FLUX_COPY.tilt, min: 0, max: 180, step: 1, value: 0, format: v => `${v}°`, onInput: v => loop.set({ thetaDeg: v }) })
  const side = createSlider({ doc, prefix: p, label: FLUX_COPY.side, min: 0.3, max: 0.8, step: 0.01, value: 0.5, format: v => `${v.toFixed(2)} m on a side`, onInput: v => loop.set({ side: v }) })
  const startBtn = createButton({ doc, prefix: p, label: 'Try a prediction', onClick: () => {} })
  const checkpoint = createCheckpoint({ doc, prefix: p })
  const moreBtn = createButton({ doc, prefix: p, label: 'One more', kind: 'quiet', onClick: () => {} })
  const bundleBtn = createButton({ doc, prefix: p, label: FLUX_COPY.toBundle, onClick: () => {} })
  const bowlBtn = createButton({ doc, prefix: p, label: FLUX_COPY.toBowl, onClick: () => {} })
  const bowlNote = doc.createElement('p')
  bowlNote.className = `${p}-note`
  bowlNote.textContent = FLUX_COPY.bowlNote
  const nSlider = createSlider({ doc, prefix: p, label: FLUX_COPY.n, min: 1, max: 5, step: 1, value: 3, format: v => `${6 * v * v} patches`, onInput: v => physics.bowl.set({ n: v }) })
  // Deepest point stays inside even the coarsest bowl (its bottom face sits at 1/√3 ≈ 0.577 m).
  const zSlider = createSlider({ doc, prefix: p, label: FLUX_COPY.z, min: -0.55, max: -0.05, step: 0.01, value: -0.3, format: v => `${Math.abs(v).toFixed(2)} m below the rim`, onInput: v => physics.bowl.set({ z: v }) })
  const plot = createPlot2d({ doc, prefix: p, xLabel: 'patches per edge', yLabel: 'Φ (N·m²/C)', title: 'Patch sum against the exact value' })
  const bowlEls = [bowlNote, nSlider.el, zSlider.el, plot.el]
  panel.append(eq.el, nEq.el, tilt.el, side.el, startBtn, checkpoint.el, moreBtn, bundleBtn, bowlBtn, ...bowlEls)

  let done = false
  let flowId = 0
  let part: 'loop' | 'bundle' | 'bowl' = 'loop'
  const alive = (id: number) => () => id === flowId
  const hide = (...els: Element[]) => els.forEach(e => e.toggleAttribute('hidden', true))
  const show = (...els: Element[]) => els.forEach(e => e.toggleAttribute('hidden', false))

  const showPart = (next: 'loop' | 'bundle' | 'bowl') => {
    part = next
    scene.setPart(next)
    o.camera(next === 'loop' ? CAMERA_SCENES.flux : next === 'bundle' ? CAMERA_SCENES.bundle : CAMERA_SCENES.bowl)
    tilt.el.hidden = next !== 'loop'
    side.el.hidden = next !== 'loop'
    eq.el.hidden = next !== 'loop'
    nEq.el.hidden = next !== 'loop'
    if (next !== 'loop') nEq.focus(null)
    if (next === 'bowl') show(...bowlEls)
    else hide(...bowlEls)
  }

  const flow = async (id: number) => {
    await waitClick(startBtn)
    if (id !== flowId) return
    startBtn.hidden = true
    // The reveals assume n̂ unflipped: clear it and set the n̂ line aside until both loop questions are done.
    nEq.focus(null)
    nEq.el.hidden = true
    readout.hide()
    const said = await checkpoint.ask({ kind: 'slider', question: FLUX_COPY.predict.question, min: 0, max: 180, step: 1, initial: 0, format: v => `${v}°` })
    if (id !== flowId) return
    readout.show()
    await tweenValue(run, loop.thetaDeg, said, 1.0, v => {
      loop.set({ thetaDeg: v })
      tilt.set(Math.round(v))
    }, reduced(), alive(id))
    if (id !== flowId) return
    const right = Math.abs(said - 60) <= 5
    const flipped = Math.abs(said - 120) <= 5
    checkpoint.reveal(right ? FLUX_COPY.predict.right : flipped ? FLUX_COPY.predict.flipped : FLUX_COPY.predict.wrong(`${said}°`), right || flipped ? 'right' : 'wrong')
    moreBtn.hidden = false
    await waitClick(moreBtn)
    if (id !== flowId) return
    moreBtn.hidden = true
    checkpoint.clear()
    await checkpoint.ask({ kind: 'choice', ...FLUX_COPY.mcq })
    if (id !== flowId) return
    await tweenValue(run, loop.thetaDeg, 90, 1.0, v => {
      loop.set({ thetaDeg: v })
      tilt.set(Math.round(v))
    }, reduced(), alive(id))
    if (id !== flowId) return
    checkpoint.reveal(FLUX_COPY.mcqDone, 'right')
    nEq.el.hidden = false
    bundleBtn.hidden = false
    await waitClick(bundleBtn)
    if (id !== flowId) return
    bundleBtn.hidden = true
    checkpoint.clear()
    showPart('bundle')
    readout.hide()
    const picked = await checkpoint.ask({ kind: 'choice', question: FLUX_COPY.bundleQ, options: FLUX_COPY.bundleOptions })
    if (id !== flowId) return
    readout.show()
    checkpoint.reveal(picked === 'same' ? FLUX_COPY.bundleRight : FLUX_COPY.bundleWrong, picked === 'same' ? 'right' : 'wrong')
    done = true
    chapters.lockNext(false)
    bowlBtn.hidden = false
    await waitClick(bowlBtn)
    if (id !== flowId) return
    bowlBtn.hidden = true
    checkpoint.clear()
    showPart('bowl')
    readout.show()
  }

  let last = ''
  let lastPlot = ''
  return {
    panel,
    enter() {
      flowId++
      loop.reset()
      physics.bowl.reset()
      tilt.set(0)
      side.set(0.5)
      nSlider.set(3)
      zSlider.set(-0.3)
      panel.hidden = false
      render.show('flux')
      readout.caption(null)
      readout.show()
      checkpoint.clear()
      hide(moreBtn, bundleBtn, bowlBtn)
      eq.focus(null)
      showPart('loop')
      if (done) {
        startBtn.hidden = true
        bundleBtn.hidden = false
        void (async () => {
          const id = flowId
          await waitClick(bundleBtn)
          if (id !== flowId) return
          bundleBtn.hidden = true
          showPart('bundle')
          bowlBtn.hidden = false
          await waitClick(bowlBtn)
          if (id !== flowId) return
          bowlBtn.hidden = true
          showPart('bowl')
        })()
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
      nEq.focus(null)
    },
    update() {
      if (panel.hidden || readout.isHidden()) return
      let main = ''
      let sub = ''
      if (part === 'loop') {
        const phi = loop.flux()
        const between = loop.flipped ? 180 - loop.thetaDeg : loop.thetaDeg
        main = `Φ = ${sig3(Math.abs(phi) < 1e-9 ? 0 : phi)} N·m²/C`
        sub = `${loop.linesThrough()} of the drawn lines poke through${loop.flipped ? ', with the normal arrow flipped' : ''}`
        eq.setTerm('phi', `${sig3(Math.abs(phi) < 1e-9 ? 0 : phi)} N·m²/C`)
        eq.setTerm('E', `${UNIFORM_E} N/C`)
        eq.setTerm('A', `${sig3(loop.area())} m²`)
        eq.setTerm('cos', `cos ${Math.round(between)}°`)
      } else if (part === 'bundle') {
        const fl = physics.bundle.fluxes()
        const rays = physics.bundle.raysThrough()
        main = `near Φ = ${sig3(fl.near)}, far Φ = ${sig3(fl.far)} N·m²/C`
        sub = `all ${rays.near} bright lines go through both loops`
      } else {
        const bw = physics.bowl
        main = `Patch sum = ${sig3(bw.centroidSum())} N·m²/C`
        sub = `exact for the smooth bowl = ${sig3(bw.smoothExact())} N·m²/C`
        const key = `${bw.n}|${bw.z}`
        if (key !== lastPlot) {
          // The flat line is the exact flux through the smooth bowl the patches approximate; it does not
          // depend on the patch count, and the sums walk toward it.
          const exact = bw.smoothExact()
          plot.set([{ x: 1, y: exact }, { x: 5, y: exact }], bw.series().map(pt => ({ ...pt, label: pt.x === bw.n ? 'now' : '' })))
          lastPlot = key
        }
      }
      const key = main + sub
      if (key !== last) {
        readout.set(main, sub)
        last = key
      }
    },
  }
}
