/**
 * A small inline-SVG plot: linear axes, one series, up to a few marked points, labeled units.
 * DOM-only (no three, no gsap). Built once; set() rewrites the path and the marks in place.
 */
export type PlotPoint = { x: number; y: number }
export type PlotMark = PlotPoint & { label: string }

export type Plot2d = {
  el: SVGSVGElement
  set(series: readonly PlotPoint[], marks?: readonly PlotMark[]): void
}

export type Plot2dOptions = {
  doc: Document
  prefix: string
  /** Axis captions, e.g. "r (m)" and "E (N/C)". */
  xLabel: string
  yLabel: string
  title?: string
  /** Fixed y range; auto from the data when omitted. */
  yMax?: number
}

const NS = 'http://www.w3.org/2000/svg'
const W = 320
const H = 180
const PAD = { left: 44, right: 12, top: 18, bottom: 34 }

export function createPlot2d(opts: Plot2dOptions): Plot2d {
  const { doc, prefix: p } = opts
  const svg = doc.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svg.setAttribute('class', `${p}-plot`)
  svg.setAttribute('role', 'img')
  svg.setAttribute('aria-label', `${opts.title ? `${opts.title}: ` : ''}${opts.yLabel} against ${opts.xLabel}`)
  const mk = (tag: string, cls: string) => {
    const e = doc.createElementNS(NS, tag)
    e.setAttribute('class', `${p}-plot-${cls}`)
    svg.appendChild(e)
    return e
  }
  const axes = mk('path', 'axes')
  axes.setAttribute('d', `M${PAD.left},${PAD.top} V${H - PAD.bottom} H${W - PAD.right}`)
  const path = mk('path', 'series')
  const marksGroup = mk('g', 'marks')
  const xText = mk('text', 'label')
  xText.setAttribute('x', String(W - PAD.right))
  xText.setAttribute('y', String(H - 8))
  xText.setAttribute('text-anchor', 'end')
  xText.textContent = opts.xLabel
  const yText = mk('text', 'label')
  yText.setAttribute('x', String(PAD.left))
  yText.setAttribute('y', String(PAD.top - 6))
  yText.textContent = opts.yLabel
  const xMinText = mk('text', 'tick')
  xMinText.setAttribute('y', String(H - PAD.bottom + 14))
  xMinText.setAttribute('x', String(PAD.left))
  const xMaxText = mk('text', 'tick')
  xMaxText.setAttribute('y', String(H - PAD.bottom + 14))
  xMaxText.setAttribute('x', String(W - PAD.right))
  xMaxText.setAttribute('text-anchor', 'end')
  const yMaxText = mk('text', 'tick')
  yMaxText.setAttribute('x', String(PAD.left - 6))
  yMaxText.setAttribute('y', String(PAD.top + 4))
  yMaxText.setAttribute('text-anchor', 'end')
  if (opts.title) {
    // Top right, so it never collides with the y-axis caption at the top left.
    const t = mk('text', 'title')
    t.setAttribute('x', String(W - PAD.right))
    t.setAttribute('y', String(PAD.top - 6))
    t.setAttribute('text-anchor', 'end')
    t.textContent = opts.title
  }

  const fmt = (v: number) => (Math.abs(v) >= 100 || Number.isInteger(v) ? v.toFixed(0) : v.toPrecision(2))

  return {
    el: svg,
    set(series, marks = []) {
      if (series.length === 0) return
      let xMin = Infinity
      let xMax = -Infinity
      let yMax = opts.yMax ?? -Infinity
      for (const q of [...series, ...marks]) {
        if (q.x < xMin) xMin = q.x
        if (q.x > xMax) xMax = q.x
        if (opts.yMax === undefined && q.y > yMax) yMax = q.y
      }
      if (xMax === xMin) xMax = xMin + 1
      if (!(yMax > 0)) yMax = 1
      const sx = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * (W - PAD.left - PAD.right)
      const sy = (y: number) => H - PAD.bottom - (Math.min(y, yMax) / yMax) * (H - PAD.top - PAD.bottom)
      path.setAttribute('d', series.map((q, i) => `${i ? 'L' : 'M'}${sx(q.x).toFixed(1)},${sy(q.y).toFixed(1)}`).join(''))
      xMinText.textContent = fmt(xMin)
      xMaxText.textContent = fmt(xMax)
      yMaxText.textContent = fmt(yMax)
      marksGroup.replaceChildren()
      for (const m of marks) {
        const c = doc.createElementNS(NS, 'circle')
        c.setAttribute('cx', sx(m.x).toFixed(1))
        c.setAttribute('cy', sy(m.y).toFixed(1))
        c.setAttribute('r', '4')
        c.setAttribute('class', `${p}-plot-mark`)
        const t = doc.createElementNS(NS, 'text')
        t.setAttribute('x', (sx(m.x) + 6).toFixed(1))
        t.setAttribute('y', (sy(m.y) - 6).toFixed(1))
        t.setAttribute('class', `${p}-plot-marklabel`)
        t.textContent = m.label
        marksGroup.append(c, t)
      }
    },
  }
}
