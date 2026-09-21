// Beat 3, the field: probe, F/q₀, the slice plane, field lines, superposition, and the released charge.
import { createButton, createCheckpoint, createLinkedEquation, createSegmented, createSlider, type CameraPreset, type Chapters, type CompassDir } from '@lib/chrome'
import { CAMERA_SCENES, FIELD_COPY } from '../content'
import type { Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import type { Readout } from './beat5'
import { sig3, waitClick, type Run } from '../flow'

export type Beat3 = { panel: HTMLElement; enter(): void; leave(): void; update(dt: number): void }

export function createBeat3(o: {
  doc: Document
  prefix: string
  physics: Sim1Physics
  render: Sim1Render
  chapters: Chapters
  readout: Readout
  reduced: () => boolean
  run: Run
  camera: (preset: CameraPreset) => void
}): Beat3 {
  const { doc, prefix: p, physics, render, chapters, readout } = o
  const f = physics.field
  const scene = render.scenes.field
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true

  const eq = createLinkedEquation({
    doc,
    prefix: p,
    label: 'The field',
    parts: [
      { id: 'E', text: 'E', tip: FIELD_COPY.tips.E },
      ' = ',
      { id: 'F', text: 'F', tip: FIELD_COPY.tips.F },
      ' / ',
      { id: 'q0', text: 'q₀', tip: FIELD_COPY.tips.q0 },
    ],
    onFocus: id => scene.highlight(id === 'F' || id === 'E' || id === 'q0' ? id : null),
  })
  const px = createSlider({ doc, prefix: p, label: FIELD_COPY.probeX, min: -1, max: 1, step: 0.02, value: 0.35, format: v => `${v.toFixed(2)} m`, onInput: v => f.setProbe({ ...f.probe, x: v }) })
  const py = createSlider({ doc, prefix: p, label: FIELD_COPY.probeY, min: -1, max: 1, step: 0.02, value: -0.25, format: v => `${v.toFixed(2)} m`, onInput: v => f.setProbe({ ...f.probe, y: v }) })
  const q0 = createSegmented({
    doc,
    prefix: p,
    label: FIELD_COPY.q0,
    options: [
      { id: '1', label: '+1' },
      { id: '2', label: '+2' },
      { id: '-1', label: '−1' },
    ],
    value: '1',
    onChange: id => f.set({ q0: Number(id) }),
  })
  const takeAway = createButton({ doc, prefix: p, label: FIELD_COPY.takeAway, onClick: () => {} })
  const stayed = doc.createElement('p')
  stayed.className = `${p}-note`
  stayed.textContent = FIELD_COPY.stayed
  const legend = doc.createElement('div')
  legend.className = `${p}-legend`
  const legendBar = doc.createElement('div')
  legendBar.className = `${p}-legend-bar`
  const legendMin = doc.createElement('span')
  const legendMax = doc.createElement('span')
  legend.append(legendMin, legendBar, legendMax)
  const sliceZ = createSlider({ doc, prefix: p, label: FIELD_COPY.sliceZ, min: -0.8, max: 0.8, step: 0.02, value: 0, format: v => `z = ${v.toFixed(2)} m`, onInput: v => f.set({ sliceZ: v }) })
  const showLines = createButton({ doc, prefix: p, label: FIELD_COPY.showLines, onClick: () => {} })
  const rules = doc.createElement('p')
  rules.className = `${p}-note`
  rules.textContent = FIELD_COPY.rules
  const sources = createSegmented({
    doc,
    prefix: p,
    label: FIELD_COPY.sources,
    options: [
      { id: 'single', label: FIELD_COPY.single },
      { id: 'dipole', label: FIELD_COPY.dipole },
      { id: 'like', label: FIELD_COPY.like },
    ],
    value: 'single',
    onChange: id => {
      f.set({ pair: id as 'single' | 'dipole' | 'like' })
      f.retrace()
      // A particle mid-flight belongs to the old field; drop it and its comparison line.
      f.clearParticle()
      scene.compare(null)
      scene.setShow('particle', false)
      releaseNote.hidden = true
    },
  })
  const checkpoint = createCheckpoint({ doc, prefix: p })
  const moreBtn = createButton({ doc, prefix: p, label: 'Next case', kind: 'quiet', onClick: () => {} })
  const onwardBtn = createButton({ doc, prefix: p, label: 'Now let one go', kind: 'quiet', onClick: () => {} })
  const goBtn = createButton({ doc, prefix: p, label: FIELD_COPY.release, onClick: () => {} })
  const axisBtn = createButton({ doc, prefix: p, label: FIELD_COPY.onAxis, kind: 'quiet', onClick: () => {} })
  const releaseNote = doc.createElement('p')
  releaseNote.className = `${p}-note`
  const stage2 = [stayed, legend, sliceZ.el]
  const stage3 = [rules, sources.el]
  panel.append(eq.el, px.el, py.el, q0.el, takeAway, ...stage2, showLines, ...stage3, checkpoint.el, moreBtn, onwardBtn, goBtn, axisBtn, releaseNote)

  let done = false
  let flowId = 0
  const hide = (...els: HTMLElement[]) => els.forEach(e => (e.hidden = true))
  const show = (...els: HTMLElement[]) => els.forEach(e => (e.hidden = false))

  const setSources = (pair: 'single' | 'dipole' | 'like') => {
    f.set({ pair })
    f.retrace()
    sources.set(pair)
  }

  const flow = async (id: number) => {
    await waitClick(takeAway)
    if (id !== flowId) return
    takeAway.hidden = true
    hide(eq.el, px.el, py.el, q0.el)
    scene.setShow('probe', false)
    scene.setShow('slice', true)
    readout.hide()
    show(...stage2, showLines)
    await waitClick(showLines)
    if (id !== flowId) return
    showLines.hidden = true
    scene.setShow('lines', true)
    show(...stage3)
    // Superposition, two cases, commit before the reveal.
    const dirName: Record<CompassDir, string> = { N: 'up', NE: 'up and right', E: 'right', SE: 'down and right', S: 'down', SW: 'down and left', W: 'left', NW: 'up and left', '0': 'nowhere, it is zero' }
    setSources('dipole')
    sources.disable(true)
    let picked = await checkpoint.ask({ kind: 'compass', question: FIELD_COPY.compass1, allowZero: true })
    if (id !== flowId) return
    f.setProbe({ x: 0, y: 0, z: 0 })
    scene.setShow('probe', true)
    scene.setShow('contrib', true)
    checkpoint.reveal(picked === 'E' ? FIELD_COPY.compassRight : FIELD_COPY.compassWrong(dirName.E), picked === 'E' ? 'right' : 'wrong')
    moreBtn.hidden = false
    await waitClick(moreBtn)
    if (id !== flowId) return
    moreBtn.hidden = true
    setSources('like')
    scene.setShow('probe', false)
    scene.setShow('contrib', false)
    picked = await checkpoint.ask({ kind: 'compass', question: FIELD_COPY.compass2, allowZero: true })
    if (id !== flowId) return
    f.setProbe({ x: 0, y: 0.45, z: 0 })
    scene.setShow('probe', true)
    scene.setShow('contrib', true)
    checkpoint.reveal(picked === 'N' ? FIELD_COPY.compassRight : FIELD_COPY.compassWrong(dirName.N), picked === 'N' ? 'right' : 'wrong')
    onwardBtn.hidden = false
    await waitClick(onwardBtn)
    if (id !== flowId) return
    onwardBtn.hidden = true
    // The released charge: commit first, then release as the reveal.
    setSources('dipole')
    scene.setShow('probe', false)
    scene.setShow('contrib', false)
    const start = { x: 0.05, y: 0.55, z: 0 }
    f.setProbe(start)
    scene.setShow('probe', true)
    await checkpoint.ask({ kind: 'choice', ...FIELD_COPY.releaseMcq })
    if (id !== flowId) return
    goBtn.hidden = false
    await waitClick(goBtn)
    if (id !== flowId) return
    goBtn.hidden = true
    scene.setShow('probe', false)
    scene.compare(f.lineThrough(start))
    f.releaseAt(start)
    scene.setShow('particle', true)
    releaseNote.textContent = FIELD_COPY.released
    releaseNote.hidden = false
    checkpoint.reveal(FIELD_COPY.releaseMcq.options[1]!.reason, 'right')
    done = true
    chapters.lockNext(false)
    sources.disable(false)
    axisBtn.hidden = false
    await waitClick(axisBtn)
    if (id !== flowId) return
    axisBtn.hidden = true
    const onAxis = { x: -0.2, y: 0, z: 0 }
    scene.compare(f.lineThrough(onAxis))
    f.releaseAt(onAxis)
    releaseNote.textContent = FIELD_COPY.onAxisNote
  }

  let last = ''
  let lastLegend = ''
  return {
    panel,
    enter() {
      flowId++
      f.reset()
      px.set(f.probe.x)
      py.set(f.probe.y)
      q0.set('1')
      sliceZ.set(0)
      sources.set('single')
      sources.disable(false)
      panel.hidden = false
      render.show('field')
      scene.setShow('probe', true)
      scene.setShow('slice', false)
      scene.setShow('lines', false)
      scene.setShow('contrib', false)
      scene.setShow('particle', false)
      scene.compare(null)
      readout.caption(null)
      readout.show()
      checkpoint.clear()
      hide(...stage2, showLines, ...stage3, moreBtn, onwardBtn, goBtn, axisBtn, releaseNote)
      eq.focus(null)
      show(eq.el, px.el, py.el, q0.el)
      if (done) {
        takeAway.hidden = true
        hide(eq.el, px.el, py.el, q0.el)
        scene.setShow('probe', false)
        scene.setShow('slice', true)
        scene.setShow('lines', true)
        readout.hide()
        show(...stage2, ...stage3)
      } else {
        takeAway.hidden = false
        chapters.lockNext(true)
        void flow(flowId)
      }
      o.camera(CAMERA_SCENES.field)
    },
    leave() {
      panel.hidden = true
      readout.hide()
      f.clearParticle()
      eq.focus(null)
    },
    update(dt) {
      if (panel.hidden) return
      if (f.flying) f.tick(dt)
      if (!readout.isHidden()) {
        const F = f.probeForce()
        const E = f.probeField()
        const mag = (v: { x: number; y: number; z: number }) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
        const main = `F on the probe = ${sig3(mag(F))} N`
        const sub = `E there = ${sig3(mag(E))} N/C. Swap q₀: F changes, E does not.`
        const key = main + sub
        if (key !== last) {
          readout.set(main, sub)
          last = key
        }
        eq.setTerm('F', `${sig3(mag(F))} N`)
        eq.setTerm('q0', `${f.q0 > 0 ? '+' : ''}${f.q0} nC`)
        eq.setTerm('E', `${sig3(mag(E))} N/C`)
      }
      if (!legend.hidden) {
        const r = scene.sliceRange()
        const key = `${r.logMin.toFixed(2)}|${r.logMax.toFixed(2)}`
        if (key !== lastLegend) {
          legendMin.textContent = `${sig3(10 ** r.logMin)} N/C`
          legendMax.textContent = `${sig3(10 ** r.logMax)} N/C`
          lastLegend = key
        }
      }
    },
  }
}
