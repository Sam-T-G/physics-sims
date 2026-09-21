// Beat 5, "Gauss's law": the cap closes, five predictions answered by moves, the callback with the exponent
// toggle on 3b's spheres, the tool question, then free play.
import { createButton, createCheckpoint, createSegmented, createSlider, type Chapters } from '@lib/chrome'
import { createPlot2d } from '@lib/render'
import { CHARGE_START, type Exponent, type SecondCharge, type Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import { GAUSS_COPY, PHI_CHOICES, PREDICTIONS, SPHERES_COPY } from '../content'
import { fmtFixed, formatFlux, sig3, tweenValue, wait, waitClick, type Run } from '../flow'

export type Readout = { show(): void; hide(): void; isHidden(): boolean; caption(text: string | null): void; set(main: string, sub: string): void }

export type Beat5 = { panel: HTMLElement; enter(cut: boolean): void; leave(): void; update(): void }

const EPSILON_0 = 8.8541878128e-12

export function createBeat5(o: {
  doc: Document
  prefix: string
  physics: Sim1Physics
  render: Sim1Render
  chapters: Chapters
  readout: Readout
  reduced: () => boolean
  run: Run
}): Beat5 {
  const { doc, prefix: p, physics, render, chapters, readout, reduced, run } = o
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true
  const note = doc.createElement('p')
  note.className = `${p}-note`
  const closeBtn = createButton({ doc, prefix: p, label: GAUSS_COPY.closeCap, onClick: () => {} })
  const signSeg = createSegmented({
    doc,
    prefix: p,
    label: 'Charge sign',
    options: [
      { id: '+', label: '+q' },
      { id: '−', label: '−q' },
    ],
    value: '+',
    onChange: id => {
      physics.setSign(id === '+' ? 1 : -1)
      if (stepText.textContent === GAUSS_COPY.closed || stepText.textContent === GAUSS_COPY.flipped) stepText.textContent = id === '+' ? GAUSS_COPY.closed : GAUSS_COPY.flipped
    },
  })
  signSeg.el.hidden = true
  const stepText = doc.createElement('p')
  stepText.className = `${p}-note`
  stepText.hidden = true
  const startBtn = createButton({ doc, prefix: p, label: GAUSS_COPY.start, onClick: () => {} })
  startBtn.hidden = true
  const checkpoint = createCheckpoint({ doc, prefix: p })
  const nextBtn = createButton({ doc, prefix: p, label: GAUSS_COPY.nextPrediction, kind: 'quiet', onClick: () => {} })
  nextBtn.hidden = true

  // Callback: 3b's spheres with the flux printed on each, the exponent toggle, the product plot.
  const callback = doc.createElement('div')
  callback.className = `${p}-callback`
  callback.hidden = true
  const callbackText = doc.createElement('p')
  callbackText.className = `${p}-note`
  callbackText.textContent = GAUSS_COPY.callback
  const exponentSeg = createSegmented({
    doc,
    prefix: p,
    label: 'How E falls off',
    options: [
      { id: '1', label: '1/r', hint: GAUSS_COPY.notOurs },
      { id: '2', label: '1/r²' },
      { id: '3', label: '1/r³', hint: GAUSS_COPY.notOurs },
    ],
    value: '2',
    onChange: id => {
      physics.setExponent(Number(id) as Exponent)
      paintCallback()
    },
  })
  const notOurs = doc.createElement('p')
  notOurs.className = `${p}-anchor`
  const sphereList = doc.createElement('ul')
  sphereList.className = `${p}-list`
  const sphereItems = [0, 1, 2].map(() => {
    const li = doc.createElement('li')
    sphereList.appendChild(li)
    return li
  })
  const productPlot = createPlot2d({ doc, prefix: p, xLabel: 'r (m)', yLabel: 'E × area (N·m²/C)', title: 'Field times area' })
  const backBtn = createButton({ doc, prefix: p, label: GAUSS_COPY.backToSurface, kind: 'quiet', onClick: () => {} })
  callback.append(callbackText, exponentSeg.el, notOurs, sphereList, productPlot.el, backBtn)

  // Free play, after the tool question.
  const play = doc.createElement('div')
  play.className = `${p}-play`
  play.hidden = true
  const playTitle = doc.createElement('p')
  playTitle.className = `${p}-note`
  playTitle.textContent = GAUSS_COPY.play
  const radius = createSlider({ doc, prefix: p, label: 'Radius', min: 0.5, max: 2, step: 0.05, value: 1, format: v => `${v.toFixed(2)} m`, onInput: v => physics.setScale(v) })
  const shape = createSlider({ doc, prefix: p, label: 'Shape', min: 0, max: 2, step: 0.05, value: 0, format: v => (v <= 0.02 ? 'sphere' : v >= 1.98 ? 'blob' : Math.abs(v - 1) < 0.03 ? 'cube' : v < 1 ? 'sphere → cube' : 'cube → blob'), onInput: v => physics.setMorph(v) })
  const chargeX = createSlider({ doc, prefix: p, label: 'Charge position', min: -1.8, max: 1.8, step: 0.05, value: CHARGE_START.x, format: v => `x = ${fmtFixed(v, 2)} m`, onInput: v => physics.setChargeX(v) })
  const secondSeg = createSegmented({
    doc,
    prefix: p,
    label: 'Second charge',
    options: [
      { id: 'off', label: 'none' },
      { id: 'plus', label: '+q' },
      { id: 'minus', label: '−q' },
    ],
    value: 'off',
    onChange: id => physics.setSecond(id as SecondCharge),
  })
  const capSeg = createSegmented({
    doc,
    prefix: p,
    label: 'Cap',
    options: [
      { id: 'on', label: 'closed' },
      { id: 'off', label: 'open' },
    ],
    value: 'on',
    onChange: id => {
      physics.setCap(id === 'on')
      render.cap.setOpacity(id === 'on' ? 0.5 : 0)
    },
  })
  play.append(playTitle, radius.el, shape.el, chargeX.el, secondSeg.el, signSeg.el, capSeg.el)

  panel.append(note, closeBtn, stepText, startBtn, checkpoint.el, nextBtn, callback, play)

  const paintCallback = () => {
    const n = physics.spheres.exponent
    notOurs.textContent = n === 2 ? 'Our universe. Same number on every sphere.' : `${GAUSS_COPY.notOurs}: the spheres disagree, so lines would not mean strength here (they are hidden).`
    sphereItems.forEach((li, i) => {
      li.textContent = `Sphere at ${SPHERES_COPY.labels[i]}: Φ = ${sig3(physics.sphereFlux(i))} N·m²/C`
    })
    const rs = physics.spheres.radii
    const series: { x: number; y: number }[] = []
    for (let k = 0; k <= 60; k++) {
      const r = 0.2 + (k / 60) * (rs[2]! * 1.2 - 0.2)
      series.push({ x: r, y: physics.fieldAtR(r) * 4 * Math.PI * r * r })
    }
    productPlot.set(
      series,
      [0, 1, 2].map(i => ({ x: rs[i]!, y: physics.sphereFlux(i), label: SPHERES_COPY.labels[i]! })),
    )
  }

  let done = false
  let flowId = 0
  const capOpacity = { v: 0 }
  const alive = (id: number) => () => id === flowId

  const showCap = async (on: boolean, id: number) => {
    await tweenValue(run, capOpacity.v, on ? 0.5 : 0, 0.9, v => {
      capOpacity.v = v
      render.cap.setOpacity(v)
    }, reduced(), alive(id))
    if (id !== flowId) return
    physics.setCap(on)
  }

  const moves: Record<(typeof PREDICTIONS)[number]['id'], (id: number) => Promise<void>> = {
    async scale(id) {
      await tweenValue(run, 1, 2, 1.4, v => physics.setScale(v), reduced(), alive(id))
      if (id !== flowId) return
      await wait(run, 900)
      if (id !== flowId) return
      await tweenValue(run, 2, 1, 1.4, v => physics.setScale(v), reduced(), alive(id))
    },
    async inside(id) {
      await tweenValue(run, CHARGE_START.x, -0.5, 1.6, v => physics.setChargeX(v), reduced(), alive(id), 'sine.inOut')
    },
    async morph(id) {
      await tweenValue(run, 0, 2, 2.4, v => physics.setMorph(v), reduced(), alive(id), 'sine.inOut')
    },
    async outside(id) {
      render.setColoring(true)
      await tweenValue(run, -0.5, 1.55, 2.2, v => physics.setChargeX(v), reduced(), alive(id), 'sine.inOut')
    },
    async second(id) {
      await tweenValue(run, 1.55, 0.3, 1.4, v => physics.setChargeX(v), reduced(), alive(id), 'sine.inOut')
      if (id !== flowId) return
      await wait(run, 400)
      if (id !== flowId) return
      physics.setSecond('plus')
    },
  }

  const flow = async (id: number) => {
    // The what-do-you-see pause: the bowl is open until the student closes it.
    note.textContent = GAUSS_COPY.open
    await waitClick(closeBtn)
    if (id !== flowId) return
    closeBtn.hidden = true
    note.hidden = true
    await showCap(true, id)
    if (id !== flowId) return
    stepText.textContent = GAUSS_COPY.closed
    stepText.hidden = false
    signSeg.el.hidden = false
    panel.insertBefore(signSeg.el, startBtn)
    startBtn.hidden = false
    await waitClick(startBtn)
    if (id !== flowId) return
    startBtn.hidden = true
    signSeg.el.hidden = true
    physics.setSign(1)
    signSeg.set('+')
    stepText.hidden = true

    for (const pred of PREDICTIONS) {
      readout.hide()
      const picked = await checkpoint.ask({ kind: 'choice', question: pred.question, options: PHI_CHOICES })
      if (id !== flowId) return
      readout.show()
      await moves[pred.id](id)
      if (id !== flowId) return
      checkpoint.reveal(pred.reveal, picked === pred.truth ? 'right' : 'wrong')
      nextBtn.textContent = pred.id === 'second' ? GAUSS_COPY.toCallback : GAUSS_COPY.nextPrediction
      nextBtn.hidden = false
      await waitClick(nextBtn)
      if (id !== flowId) return
      nextBtn.hidden = true
      checkpoint.clear()
    }

    // The callback on 3b's spheres.
    render.setColoring(false)
    physics.setFourth(false)
    physics.setExponent(2)
    exponentSeg.set('2')
    render.shells.meshes.forEach((m, i) => m.scale.setScalar(physics.spheres.radii[i]!))
    render.show('spheres')
    readout.hide()
    paintCallback()
    callback.hidden = false
    await waitClick(backBtn)
    if (id !== flowId) return
    callback.hidden = true
    physics.setExponent(2)
    // The question is about one charge at a random spot in the blob: take the second one back out.
    physics.setSecond('off')
    render.show('gauss')
    readout.show()

    const picked = await checkpoint.ask({ kind: 'choice', ...GAUSS_COPY.mcq })
    if (id !== flowId) return
    void picked
    checkpoint.reveal(GAUSS_COPY.mcqDone, 'right')
    done = true
    chapters.lockNext(false)
    openPlay()
  }

  const openPlay = () => {
    play.hidden = false
    radius.set(physics.gauss.scale)
    shape.set(physics.gauss.morphT)
    chargeX.set(physics.gauss.charges[0]!.pos.x)
    secondSeg.set(physics.gauss.second)
    signSeg.el.hidden = false
    signSeg.set(physics.gauss.sign > 0 ? '+' : '−')
    capSeg.set(physics.gauss.capOn ? 'on' : 'off')
    play.appendChild(signSeg.el)
  }

  let lastMain = ''
  let lastSub = ''

  return {
    panel,
    enter(cut) {
      flowId++
      panel.hidden = false
      render.show('gauss')
      render.setColoring(false)
      readout.caption(null)
      readout.show()
      checkpoint.clear()
      callback.hidden = true
      nextBtn.hidden = true
      if (!done) {
        physics.resetGauss()
        capOpacity.v = 0
        render.cap.setOpacity(0)
        note.hidden = false
        closeBtn.hidden = false
        stepText.hidden = true
        startBtn.hidden = true
        signSeg.el.hidden = true
        play.hidden = true
        chapters.lockNext(true)
        void flow(flowId)
      } else {
        // Done before: the closed surface with the controls live.
        note.hidden = true
        closeBtn.hidden = true
        stepText.hidden = true
        startBtn.hidden = true
        if (!cut) physics.resetGauss()
        physics.setCap(true)
        capOpacity.v = 0.5
        render.cap.setOpacity(0.5)
        openPlay()
      }
    },
    leave() {
      panel.hidden = true
      render.setColoring(false)
      readout.hide()
    },
    update() {
      if (panel.hidden) return
      if (!callback.hidden) return
      const phi = physics.flux()
      const qEnc = physics.enclosedCharge()
      const main = formatFlux(phi)
      const sub = physics.gauss.capOn
        ? `${sig3(qEnc * 1e9)} nC inside, so q/ε₀ = ${sig3(qEnc / EPSILON_0)}`
        : 'open surface: some lines escape through the hole'
      if (main !== lastMain || sub !== lastSub) {
        readout.set(main, sub)
        lastMain = main
        lastSub = sub
      }
    },
  }
}
