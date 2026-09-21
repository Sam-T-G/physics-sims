// Beat 3b, "Why squared?": live rays, live crossing counts, the area table and plot, the fourth-sphere predict.
import { createButton, createCheckpoint, type Chapters } from '@lib/chrome'
import { createPlot2d } from '@lib/render'
import { SPHERES_COPY } from '../content'
import type { Sim1Physics } from '../physics'
import type { Sim1Render } from '../render/index'
import { waitClick, type Run } from '../flow'

export type Beat3b = { panel: HTMLElement; enter(): void; leave(): void; update(): void }

export function createBeat3b(o: { doc: Document; prefix: string; physics: Sim1Physics; render: Sim1Render; chapters: Chapters; run: Run }): Beat3b {
  const { doc, prefix: p, physics, render, chapters } = o
  const panel = doc.createElement('div')
  panel.className = `${p}-panel`
  panel.hidden = true

  const countBtn = createButton({ doc, prefix: p, label: SPHERES_COPY.count, onClick: () => {} })
  const table = doc.createElement('table')
  table.className = `${p}-table`
  table.hidden = true
  const head = doc.createElement('tr')
  for (const h of [SPHERES_COPY.table.sphere, SPHERES_COPY.table.lines, SPHERES_COPY.table.area, SPHERES_COPY.table.density]) {
    const th = doc.createElement('th')
    th.textContent = h
    head.appendChild(th)
  }
  table.appendChild(head)
  const rows = physics.spheres.radii.map((r, i) => {
    const tr = doc.createElement('tr')
    const cells = [0, 1, 2, 3].map(() => {
      const td = doc.createElement('td')
      tr.appendChild(td)
      return td
    })
    cells[0]!.textContent = `${SPHERES_COPY.labels[i]} = ${r.toFixed(2)} m`
    cells[2]!.textContent = `${physics.sphereArea(i).toFixed(2)} m²`
    tr.hidden = i === 3
    table.appendChild(tr)
    return { tr, cells }
  })
  const afterCount = doc.createElement('p')
  afterCount.className = `${p}-note`
  afterCount.textContent = SPHERES_COPY.afterCount
  afterCount.hidden = true
  const plot = createPlot2d({ doc, prefix: p, xLabel: 'r (m)', yLabel: 'E (N/C)', title: 'Field strength against distance' })
  plot.el.classList.add(`${p}-hidden`)
  const checkpoint = createCheckpoint({ doc, prefix: p })
  panel.append(countBtn, table, afterCount, plot.el, checkpoint.el)

  const setPlot = () => {
    const rs = physics.spheres.radii
    const n = physics.spheres.fourth ? 4 : 3
    const series: { x: number; y: number }[] = []
    for (let k = 0; k <= 60; k++) {
      const r = 0.2 + (k / 60) * (rs[3]! * 1.15 - 0.2)
      series.push({ x: r, y: physics.fieldAtR(r) })
    }
    plot.set(
      series,
      rs.slice(0, n).map((r, i) => ({ x: r, y: physics.fieldAtR(r), label: SPHERES_COPY.labels[i]! })),
    )
  }

  /** fresh: nothing counted yet; counted: table shown, prediction still open; done: predicted, Next open. */
  let stage: 'fresh' | 'counted' | 'done' = 'fresh'
  let lastCounts = ''
  let flowId = 0
  const fmt = (v: number) => `${(v * 100).toFixed(0)}% of the first sphere`

  const showCounts = () => {
    countBtn.hidden = true
    table.hidden = false
    afterCount.hidden = false
    plot.el.classList.remove(`${p}-hidden`)
    setPlot()
  }

  const askFourth = async (id: number) => {
    const said = await checkpoint.ask({ kind: 'slider', question: SPHERES_COPY.fourth.question, min: 0, max: 1, step: 0.01, initial: 0.5, format: fmt })
    if (id !== flowId) return
    physics.setFourth(true)
    rows[3]!.tr.hidden = false
    setPlot()
    const right = Math.abs(said - 1 / 16) <= 0.015
    checkpoint.reveal(right ? SPHERES_COPY.fourth.right : SPHERES_COPY.fourth.wrong(fmt(said)), right ? 'right' : 'wrong')
    stage = 'done'
    chapters.lockNext(false)
  }

  const flow = async (id: number) => {
    await waitClick(countBtn)
    if (id !== flowId) return
    stage = 'counted'
    showCounts()
    await askFourth(id)
  }

  return {
    panel,
    enter() {
      flowId++
      physics.setExponent(2)
      physics.setFourth(stage === 'done')
      render.show('spheres')
      panel.hidden = false
      if (stage === 'fresh') {
        countBtn.hidden = false
        table.hidden = true
        afterCount.hidden = true
        plot.el.classList.add(`${p}-hidden`)
        checkpoint.clear()
        chapters.lockNext(true)
        void flow(flowId)
      } else if (stage === 'counted') {
        // Left with the prediction open: the counts stay, the question is asked again.
        showCounts()
        checkpoint.clear()
        chapters.lockNext(true)
        void askFourth(flowId)
      } else {
        showCounts()
        rows[3]!.tr.hidden = false
      }
    },
    leave() {
      panel.hidden = true
    },
    update() {
      if (panel.hidden || table.hidden) return
      const counts = physics.crossings()
      const key = counts.join(',')
      if (key === lastCounts) return
      lastCounts = key
      counts.forEach((c, i) => {
        const row = rows[i]!
        row.cells[1]!.textContent = String(c)
        const d = physics.density(i)
        row.cells[3]!.textContent = d === 1 ? '1' : `1/${(1 / d).toFixed(0)}`
      })
    },
  }
}
