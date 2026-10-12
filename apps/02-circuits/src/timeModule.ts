// Layer 3: the "Current over time" module. Two live plots for the capacitor: current I(t) and voltage V_C(t),
// each with the book's exponential drawn dashed for the whole window and the live trace drawn over it.

import type { CapReading } from './board'
import { sig3, reading } from './format'

export type RcClock = {
  /** Seconds since the circuit last changed. */
  t: number
  /** Capacitor voltage and current at that change (the start of this curve). */
  V0: number
  I0: number
  Voc: number
  tau: number
  speed: number
  batteryIn: boolean
  trace: { t: number; I: number; V: number }[]
}

export type TimeModule = {
  el: HTMLElement
  update(cap: CapReading | undefined, clock: RcClock): void
  dispose(): void
}

const W = 320
const H = 128
const M = { l: 46, r: 12, t: 12, b: 24 }
const pw = W - M.l - M.r
const ph = H - M.t - M.b

export function createTimeModule(handlers: { onBattery(batteryIn: boolean): void; onSpeed(n: number): void; onEmpty(): void }): TimeModule {
  const el = document.createElement('section')
  el.className = 'sim02-time'
  el.setAttribute('aria-label', 'Current over time')
  el.innerHTML = `
    <header class="sim02-row-head">
      <span class="sim02-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg></span>
      <h2>Current over time</h2><span class="sim02-tag">Section 10.5</span>
    </header>
    <div class="sim02-time-empty">
      <p>Drag the capacitor from the tray onto any slot. The plots below then show the capacitor's current and voltage changing over time.</p>
    </div>
    <div class="sim02-time-live" hidden>
      <div class="sim02-seg" role="group" aria-label="Battery switch">
        <button type="button" data-bat="in" aria-pressed="true">Charge: battery in</button>
        <button type="button" data-bat="out" aria-pressed="false">Discharge: battery out</button>
      </div>
      <figure class="sim02-plot sim02-plot-I">
        <figcaption><span><i>I</i>, current into the capacitor</span><b class="sim02-plot-now" data-now="I"></b></figcaption>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Current into the capacitor over time"></svg>
      </figure>
      <figure class="sim02-plot sim02-plot-V">
        <figcaption><span><i>V</i><sub>C</sub>, voltage across the capacitor</span><b class="sim02-plot-now" data-now="V"></b></figcaption>
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Voltage across the capacitor over time"></svg>
      </figure>
      <p class="sim02-time-clock"></p>
      <div class="sim02-time-controls">
        <div class="sim02-seg" role="group" aria-label="Playback speed">
          <button type="button" data-speed="1" aria-pressed="true">1×</button>
          <button type="button" data-speed="5" aria-pressed="false">5×</button>
          <button type="button" data-speed="25" aria-pressed="false">25×</button>
        </div>
        <button type="button" class="sim02-clear sim02-empty-cap">Empty the capacitor</button>
      </div>
    </div>`
  const emptyEl = el.querySelector<HTMLElement>('.sim02-time-empty')!
  const liveEl = el.querySelector<HTMLElement>('.sim02-time-live')!
  const svgI = el.querySelector<SVGSVGElement>('.sim02-plot-I svg')!
  const svgV = el.querySelector<SVGSVGElement>('.sim02-plot-V svg')!
  const nowI = el.querySelector<HTMLElement>('[data-now=I]')!
  const nowV = el.querySelector<HTMLElement>('[data-now=V]')!
  const clockEl = el.querySelector<HTMLElement>('.sim02-time-clock')!
  const batBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-bat]')]
  const speedBtns = [...el.querySelectorAll<HTMLButtonElement>('[data-speed]')]
  const onClick = (e: Event) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button')
    if (!b) return
    if (b.dataset.bat) handlers.onBattery(b.dataset.bat === 'in')
    else if (b.dataset.speed) handlers.onSpeed(Number(b.dataset.speed))
    else if (b.classList.contains('sim02-empty-cap')) handlers.onEmpty()
  }
  el.addEventListener('click', onClick)

  const plot = (svg: SVGSVGElement, T: number, f: (t: number) => number, trace: [number, number][], tNow: number, yNow: number,
    marks: { y: number; label: string }[], tau: number, unit: string) => {
    const ys = [0, f(0), f(T), yNow, ...marks.map(m => m.y)]
    let lo = Math.min(...ys), hi = Math.max(...ys)
    if (hi - lo < 1e-9) { hi = lo + 1; lo = lo - (lo === 0 ? 0 : 1) }
    const pad = (hi - lo) * 0.08
    lo -= lo < 0 ? pad : 0; hi += pad
    const X = (t: number) => M.l + (Math.min(t, T) / T) * pw
    const Y = (y: number) => M.t + (1 - (y - lo) / (hi - lo)) * ph
    const curve: string[] = []
    for (let k = 0; k <= 80; k++) { const t = (T * k) / 80; curve.push(`${k ? 'L' : 'M'}${X(t).toFixed(1)},${Y(f(t)).toFixed(1)}`) }
    const live = trace.filter(p => p[0] <= T).map((p, k) => `${k ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('')
    const ticks: string[] = []
    if (Number.isFinite(tau) && tau > 0) {
      for (let n = 1; n <= 5; n++) {
        const x = X(n * tau)
        if (n * tau > T + 1e-9) break
        ticks.push(`<line class="g" x1="${x}" x2="${x}" y1="${M.t}" y2="${M.t + ph}"/><text class="tx" x="${x}" y="${H - 8}">${n === 1 ? 'τ' : `${n}τ`}</text>`)
      }
    }
    const markEls = marks.map(m => `<line class="m" x1="${M.l}" x2="${M.l + pw}" y1="${Y(m.y)}" y2="${Y(m.y)}"/><text class="ml" x="${M.l + pw - 2}" y="${Y(m.y) - 4}">${m.label}</text>`).join('')
    svg.innerHTML = `
      <line class="ax" x1="${M.l}" x2="${M.l + pw}" y1="${Y(0)}" y2="${Y(0)}"/>
      <line class="ax" x1="${M.l}" x2="${M.l}" y1="${M.t}" y2="${M.t + ph}"/>
      ${Math.abs(hi - pad) > 1e-12 ? `<text class="ty" x="${M.l - 6}" y="${Y(hi - pad) + 4}">${sig3(hi - pad)}</text>` : ''}
      ${lo < -1e-12 ? `<text class="ty" x="${M.l - 6}" y="${Y(lo + pad) + 4}">${sig3(lo + pad)}</text>` : ''}
      <text class="ty" x="${M.l - 6}" y="${Y(0) + 4}">0</text>
      <text class="tu" x="${M.l - 6}" y="${M.t + ph / 2}">${unit}</text>
      ${ticks.join('')}${markEls}
      <path class="book" d="${curve.join('')}"/>
      <path class="trace" d="${live}"/>
      <circle class="dot" cx="${X(tNow)}" cy="${Y(yNow)}" r="5"/>`
  }

  return {
    el,
    update(cap, c) {
      emptyEl.hidden = !!cap
      liveEl.hidden = !cap
      batBtns.forEach(b => b.setAttribute('aria-pressed', String((b.dataset.bat === 'in') === c.batteryIn)))
      speedBtns.forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === c.speed)))
      if (!cap) return
      const tau = c.tau
      const finite = Number.isFinite(tau) && tau > 0
      const T = finite ? 5 * tau : 10
      const Vof = (t: number) => (finite ? c.Voc + (c.V0 - c.Voc) * Math.exp(-t / tau) : c.V0)
      const Iof = (t: number) => (finite ? c.I0 * Math.exp(-t / tau) : 0)
      const tShow = Math.min(c.t, T)
      plot(svgI, T, Iof, c.trace.map(p => [p.t, p.I]), tShow, cap.Ic,
        finite && Math.abs(c.I0) > 0 ? [{ y: 0.368 * c.I0, label: '37% of I₀ at τ' }] : [], tau, 'A')
      plot(svgV, T, Vof, c.trace.map(p => [p.t, p.V]), tShow, cap.Vc,
        finite && Math.abs(c.Voc - c.V0) > 1e-9 ? [{ y: c.V0 + 0.632 * (c.Voc - c.V0), label: '63% of the way at τ' }] : [], tau, 'V')
      nowI.textContent = reading(cap.Ic, 'A')
      nowV.textContent = reading(cap.Vc, 'V')
      const settled = !finite || c.t > 5 * tau
      clockEl.textContent = tau === 0
        ? 'Only plain wire is in the capacitor\'s path (R = 0 Ω), so the capacitor jumped straight to its final voltage.'
        : !finite
        ? 'No closed path runs through the capacitor, so the capacitor voltage stays constant.'
        : `t = ${sig3(c.t)} s = ${sig3(c.t / tau)} τ, with τ = ${sig3(tau)} s.${settled ? ' After 5τ the capacitor voltage is within 1% of the final value.' : ''}`
    },
    dispose() {
      el.removeEventListener('click', onClick)
      el.remove()
    },
  }
}
