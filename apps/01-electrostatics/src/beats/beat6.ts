// Beat 6, always true, not always useful: |E| on the surface, the dipole, centering, when Gauss hands you E.
import { createCheckpoint, createLinkedEquation, createSegmented, createSlider, type CameraPreset, type Chapters } from '@lib/chrome'
import { CAMERA_SCENES, SYMMETRY_COPY } from '../content'
import type { Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import type { Readout } from './beat5'
import { formatFlux, waitClick } from '../flow'
import { createButton } from '@lib/chrome'

export type Beat6 = { panel: HTMLElement; enter(): void; leave(): void; update(): void }

export function createBeat6(o: { doc: Document; prefix: string; physics: Sim1Physics; render: Sim1Render; chapters: Chapters; readout: Readout; camera: (preset: CameraPreset) => void }): Beat6 {
  const { doc, prefix: p, physics, render, chapters, readout } = o
  const sy = physics.symmetry
  const scene = render.scenes.symmetry
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true
  const checkpoint = createCheckpoint({ doc, prefix: p })
  const inside = createSegmented({
    doc,
    prefix: p,
    label: SYMMETRY_COPY.inside,
    options: [
      { id: 'one', label: SYMMETRY_COPY.one },
      { id: 'dipole', label: SYMMETRY_COPY.dipole },
    ],
    value: 'one',
    onChange: id => {
      sy.set({ dipole: id === 'dipole' })
      dipoleNote.hidden = id !== 'dipole'
    },
  })
  const dipoleNote = doc.createElement('p')
  dipoleNote.className = `${p}-note`
  dipoleNote.textContent = SYMMETRY_COPY.dipoleNote
  const position = createSlider({ doc, prefix: p, label: SYMMETRY_COPY.position, min: 0, max: 0.8, step: 0.01, value: 0.55, format: v => (v < 0.005 ? 'dead center' : `${v.toFixed(2)} m off center`), onInput: v => sy.set({ x: v }) })
  const eq = createLinkedEquation({
    doc,
    prefix: p,
    label: 'Gauss with symmetry',
    parts: [
      { id: 'E', text: 'E', tip: SYMMETRY_COPY.tips.E },
      ' · ',
      { id: 'area', text: '4πr²', tip: SYMMETRY_COPY.tips.area },
      ' = q / ε₀',
    ],
    onFocus: id => scene.pulseShell(id === 'area'),
  })
  const centered = doc.createElement('p')
  centered.className = `${p}-note`
  centered.textContent = SYMMETRY_COPY.centered
  const finalBtn = createButton({ doc, prefix: p, label: 'Last question', onClick: () => {} })
  const finalCheck = createCheckpoint({ doc, prefix: p })
  const endCard = doc.createElement('div')
  endCard.className = `${p}-endcard`
  const endTitle = doc.createElement('p')
  endTitle.className = `${p}-note`
  endTitle.textContent = SYMMETRY_COPY.endCard.title
  const endList = doc.createElement('ol')
  endList.className = `${p}-list`
  for (const q of [SYMMETRY_COPY.endCard.q1, SYMMETRY_COPY.endCard.q2]) {
    const li = doc.createElement('li')
    li.textContent = q
    endList.appendChild(li)
  }
  endCard.append(endTitle, endList)
  const exploreEls = [inside.el, dipoleNote, position.el, eq.el, centered]
  panel.append(checkpoint.el, ...exploreEls, finalBtn, finalCheck.el, endCard)

  let done = false
  let flowId = 0
  const hide = (...els: HTMLElement[]) => els.forEach(e => (e.hidden = true))
  const show = (...els: HTMLElement[]) => els.forEach(e => (e.hidden = false))

  const flow = async (id: number) => {
    scene.setColored(false)
    await checkpoint.ask({ kind: 'choice', ...SYMMETRY_COPY.commit })
    if (id !== flowId) return
    scene.setColored(true)
    checkpoint.reveal(SYMMETRY_COPY.commitDone, 'right')
    show(inside.el, position.el, eq.el, finalBtn)
    await waitClick(finalBtn)
    if (id !== flowId) return
    finalBtn.hidden = true
    await finalCheck.ask({ kind: 'multi', ...SYMMETRY_COPY.final })
    if (id !== flowId) return
    scene.setReveal(true)
    o.camera(CAMERA_SCENES.reveal)
    readout.hide()
    finalCheck.reveal(SYMMETRY_COPY.finalDone, 'right')
    endCard.hidden = false
    done = true
    chapters.lockNext(false)
  }

  let last = ''
  return {
    panel,
    enter() {
      flowId++
      sy.reset()
      inside.set('one')
      position.set(sy.x)
      panel.hidden = false
      render.show('symmetry')
      scene.setReveal(false)
      scene.setColored(done)
      readout.caption(null)
      readout.show()
      checkpoint.clear()
      finalCheck.clear()
      hide(...exploreEls, finalBtn, endCard)
      eq.focus(null)
      o.camera(CAMERA_SCENES.symmetry)
      if (done) {
        show(inside.el, position.el, eq.el, endCard)
        finalCheck.reveal(SYMMETRY_COPY.finalDone, 'right')
      } else {
        chapters.lockNext(true)
        void flow(flowId)
      }
    },
    leave() {
      panel.hidden = true
      readout.hide()
      scene.pulseShell(false)
      eq.focus(null)
    },
    update() {
      if (panel.hidden || readout.isHidden()) return
      const spread = sy.spread()
      const main = formatFlux(sy.flux())
      const sub = sy.dipole ? '|E| is not zero on a single face' : `|E| varies by ${(spread * 100).toFixed(0)}% across the surface${spread < 0.01 ? ': uniform' : ''}`
      const key = main + sub
      if (key !== last) {
        readout.set(main, sub)
        last = key
      }
      centered.hidden = !(spread < 0.01 && !sy.dipole && !inside.el.hidden)
    },
  }
}
