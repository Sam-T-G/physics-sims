// Beat 6, always true, not always useful: |E| on the surface, the dipole, centering, when Gauss hands you E.
import { createCheckpoint, createLinkedEquation, createSegmented, createSlider, type CameraPreset, type Chapters } from '@lib/chrome'
import { CAMERA_SCENES, SYMMETRY_COPY } from '../content'
import { MAX_OFFSET, MIN_DIPOLE_OFFSET, type Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import type { Readout } from './beat5'
import { formatFlux, sig3, waitClick } from '../flow'
import { K_E } from '@lib/physics'
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
      if (id === 'dipole' && sy.x < MIN_DIPOLE_OFFSET) {
        sy.set({ x: MIN_DIPOLE_OFFSET })
        position.set(MIN_DIPOLE_OFFSET)
      }
      dipoleNote.hidden = id !== 'dipole'
    },
  })
  const dipoleNote = doc.createElement('p')
  dipoleNote.className = `${p}-note`
  dipoleNote.textContent = SYMMETRY_COPY.dipoleNote
  const position = createSlider({
    doc,
    prefix: p,
    label: SYMMETRY_COPY.position,
    min: 0,
    max: MAX_OFFSET,
    step: 0.01,
    value: 0.55,
    format: v => (v < 0.005 ? 'dead center' : `${v.toFixed(2)} m off center`),
    onInput: v => {
      // With the dipole on, the + and − stay at least a little apart; stacked, they would cancel to E = 0.
      const x = sy.dipole ? Math.max(v, MIN_DIPOLE_OFFSET) : v
      if (x !== v) position.set(x)
      sy.set({ x })
    },
  })
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
  const legend = doc.createElement('div')
  legend.className = `${p}-legend`
  legend.setAttribute('role', 'group')
  legend.setAttribute('aria-label', 'Surface color shows how strong E is')
  const legendMin = doc.createElement('span')
  const legendBar = doc.createElement('div')
  legendBar.className = `${p}-legend-bar`
  const legendMax = doc.createElement('span')
  // Two ticks bracket the range the sphere is using right now on the fixed scale.
  const nowLo = doc.createElement('i')
  nowLo.className = `${p}-legend-now`
  const nowHi = doc.createElement('i')
  nowHi.className = `${p}-legend-now`
  legendBar.append(nowLo, nowHi)
  legend.append(legendMin, legendBar, legendMax)
  const legendCaption = doc.createElement('p')
  legendCaption.className = `${p}-legend-caption`
  legendCaption.textContent = 'Surface color = how strong E is on that patch (log scale, the same scale wherever the charge sits).'
  {
    const [lo, hi] = sy.colorRange()
    legendMin.textContent = `${sig3(lo)} N/C`
    legendMax.textContent = `${sig3(hi)} N/C`
  }
  const mags = new Float64Array(sy.mesh.faceCount)
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
  const exploreEls = [legend, legendCaption, inside.el, dipoleNote, position.el, eq.el, centered]
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
    show(legend, legendCaption, inside.el, position.el, eq.el, finalBtn)
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
        show(legend, legendCaption, inside.el, position.el, eq.el, endCard)
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
      const [min, max] = sy.faceMagnitudes(mags)
      const spread = max === 0 ? 0 : (max - min) / max
      {
        const [lo, hi] = sy.colorRange()
        const span = Math.log(hi) - Math.log(lo)
        const at = (v: number) => `${(100 * Math.min(1, Math.max(0, (Math.log(Math.max(v, lo)) - Math.log(lo)) / span))).toFixed(1)}%`
        nowLo.style.left = at(min)
        nowHi.style.left = at(max)
      }
      const main = formatFlux(sy.flux())
      const kq = K_E * 1e-9 // kq/r² on the unit sphere
      const sub = sy.dipole
        ? `|E| runs from ${sig3(min)} to ${sig3(max)} N/C: nonzero on every patch`
        : spread < 1e-6
          ? `|E| = ${sig3(max)} N/C on every patch, and kq/r² = ${sig3(kq)} N/C`
          : `|E| runs from ${sig3(min)} to ${sig3(max)} N/C across the surface`
      const key = main + sub
      if (key !== last) {
        readout.set(main, sub)
        last = key
      }
      centered.hidden = !(spread < 1e-6 && !sy.dipole && !inside.el.hidden)
    },
  }
}
