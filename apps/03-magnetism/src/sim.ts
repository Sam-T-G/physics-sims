// Layer 2 + app: the board drawn on a 2D canvas, the HUD, the notebook, and every control.
// The board is a slice through long straight wires, so a flat view shows it exactly; field lines are level curves
// of the vector potential (lib/physics/wires.ts), so line spacing follows the field's strength.
import { animate } from 'motion'
import { MU0_OVER_2PI, bFieldAt, vectorPotentialAt } from '@lib/physics'
import { ASPECT, MAX_WIRES, PRESETS, STOPS, measure, wireRadius, type Board, type Measure, type Preset } from './board'
import { notebookHtml } from './panel'
import { si, amps, scaleLabel } from './format'
import { meta } from './sim.meta'
import './styles.css'

const C = {
  sky: '#e9e7ff', board: '#d9f0e2', peg: '#a9d4bb', edge: '#b8dcc7', line: '#7467c2', arrow: '#5a4daa',
  out: '#7467c2', in: '#d4486a', zero: '#9a93b8', ink: '#3a3358', ink2: '#625a82', paper: '#fffdfb',
  probe: '#24707f', force: '#b8561c', butter: '#ffd15c',
}
const FONT = "'Nunito Variable', ui-rounded, system-ui, sans-serif"

const TILE_ICON = {
  B: '<circle cx="12" cy="12" r="8"/><path d="M12 6l2.5 6H9.5z" fill="currentColor"/>',
  L: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17 3.5v4h-4"/>',
  M: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
  F: '<path d="M4 12h14"/><path d="M13 7l5 5-5 5"/>',
}
const svg = (p: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`

let teardown: (() => void) | null = null

export function mount(el: HTMLElement): void {
  unmount()
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  el.classList.add('sim03')
  el.innerHTML = `
    <div class="sim03-stage">
      <div class="sim03-hud" role="group" aria-label="Readouts">
        ${(['B', 'L', 'M', 'F'] as const).map(k => `<div class="sim03-tile sim03-tile-${k}"><span class="sim03-tile-icon">${svg(TILE_ICON[k])}</span><span class="sim03-tile-name" data-name="${k}"></span><span class="sim03-tile-read"><span class="sim03-tile-value" data-v="${k}"></span></span></div>`).join('')}
      </div>
      <div class="sim03-canvas-wrap">
        <canvas class="sim03-canvas" tabindex="0" aria-label="Board of long straight wires seen end on, with field lines, a probe and a loop. Arrow keys move the picked wire."></canvas>
      </div>
      <div class="sim03-dock" role="toolbar" aria-label="Board">
        <button type="button" class="sim03-chip" data-add="1" aria-label="Add a wire, current out"><span class="sim03-glyph is-out" aria-hidden="true"></span><span class="sim03-long">Add a wire, current out</span><span class="sim03-short" aria-hidden="true">Wire out</span></button>
        <button type="button" class="sim03-chip" data-add="-1" aria-label="Add a wire, current in"><span class="sim03-glyph is-in" aria-hidden="true"></span><span class="sim03-long">Add a wire, current in</span><span class="sim03-short" aria-hidden="true">Wire in</span></button>
        <button type="button" class="sim03-chip is-quiet" data-clear aria-label="Clear the board"><span class="sim03-long">Clear the board</span><span class="sim03-short" aria-hidden="true">Clear</span></button>
      </div>
    </div>
    <aside class="sim03-notebook">
      <header class="sim03-head">
        <h1>${meta.title}</h1>
        <p>Each dot is a long straight wire running through the board. Drag a wire, the probe or the dashed loop, and every field, loop sum and force updates. Drag the white knob on the loop to resize it.</p>
        <p class="sim03-key"><span><span class="sim03-glyph is-out" aria-hidden="true"></span>current out of the board, toward you</span><span><span class="sim03-glyph is-in" aria-hidden="true"></span>current into the board</span></p>
      </header>
      <section class="sim03-card" aria-labelledby="sim03-pick-h">
        <h2 id="sim03-pick-h">Picked wire</h2>
        <div class="sim03-picks" role="group" aria-label="Pick a wire"></div>
        <div class="sim03-pick-body">
          <div class="sim03-seg" role="group" aria-label="Current direction">
            <button type="button" data-dir="1">Out of the board</button>
            <button type="button" data-dir="-1">Into the board</button>
          </div>
          <label class="sim03-slider"><span id="sim03-cur-name">Current, <i>I</i></span><output class="sim03-out"></output>
            <input type="range" name="current" min="0" max="${STOPS.length - 1}" step="1" aria-labelledby="sim03-cur-name" /></label>
          <button type="button" class="sim03-chip is-quiet" data-remove>Remove this wire</button>
        </div>
        <p class="sim03-small sim03-empty" hidden>Add a wire to start.</p>
      </section>
      <section class="sim03-book" aria-label="Examples">
        <h2>Examples</h2>
        <div class="sim03-presets"></div>
        <div class="sim03-compare" hidden></div>
      </section>
      <header class="sim03-notes-head"><h2>Equations</h2></header>
      <div class="sim03-eqs" aria-live="off"></div>
      <details class="sim03-approx">
        <summary>Simplifications</summary>
        <ul>
          <li>The wires are infinitely long and straight and run straight through the board, so the board shows a slice through them.</li>
          <li>Each wire is a solid rod with its current spread evenly across it, so the field inside a wire grows from 0 at its center. The rods are 1.5% of the board's width across in radius (6 mm on the 40 cm board).</li>
          <li>Field lines are spaced so they bunch up where the field is stronger. The spacing is set by the strongest wire on the board, so compare spacing on one board, not between boards.</li>
          <li>The loop sum adds B·dl over 2000 straight steps around the circle, counterclockwise.</li>
          <li>Force arrows show the direction of the push or pull. Their length grows with the force on a log scale, so a weak force still shows.</li>
          <li>A ✓ means two separate calculations give the same number.</li>
        </ul>
      </details>
      <footer class="sim03-sources" aria-labelledby="sim03-sources-h">
        <h2 id="sim03-sources-h">Credits</h2>
        <p>Based on <a href="https://openstax.org/details/books/university-physics-volume-2" target="_blank" rel="noopener"><cite>University Physics Volume 2</cite></a> by William Moebs, Samuel J. Ling and Jeff Sanny (OpenStax), licensed under <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>. Access for free at <a href="https://openstax.org" target="_blank" rel="noopener">openstax.org</a>. Text paraphrased; worked examples rebuilt as interactive boards.</p>
      </footer>
    </aside>`

  const $ = <T extends Element>(s: string) => el.querySelector<T>(s)!
  const canvas = $<HTMLCanvasElement>('.sim03-canvas')
  const ctx = canvas.getContext('2d')!
  const eqs = $<HTMLDivElement>('.sim03-eqs')
  const picks = $<HTMLDivElement>('.sim03-picks')
  const pickBody = $<HTMLDivElement>('.sim03-pick-body')
  const empty = $<HTMLParagraphElement>('.sim03-empty')
  const curIn = $<HTMLInputElement>('input[name=current]')
  const curOut = $<HTMLOutputElement>('.sim03-out')
  const compare = $<HTMLDivElement>('.sim03-compare')
  const tileV = (k: string) => $<HTMLSpanElement>(`[data-v="${k}"]`)
  const tileN = (k: string) => $<HTMLSpanElement>(`[data-name="${k}"]`)

  // ---------- state ----------
  let board: Board = clone(PRESETS[0]!.board)
  let pick = 0
  let me: Measure = measure(board)
  /** Size multiplier per wire while it pops in. */
  const pop = new WeakMap<object, number>()

  // ---------- layout ----------
  let cw = 0, ch = 0, dpr = 1
  /** Board rectangle on the canvas, in CSS px, and px per meter. */
  let bx = 0, by = 0, bw = 0, bh = 0, s = 1
  const layout = () => {
    const r = canvas.getBoundingClientRect()
    cw = r.width; ch = r.height
    dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr)
    const pad = cw < 500 ? 8 : 18
    bw = Math.max(10, Math.min(cw - 2 * pad, (ch - 2 * pad) / ASPECT))
    bh = bw * ASPECT
    bx = (cw - bw) / 2; by = (ch - bh) / 2
    s = bw / board.view.w
  }
  const toPx = (x: number, y: number): [number, number] => [bx + bw / 2 + (x - board.view.cx) * s, by + bh / 2 - (y - board.view.cy) * s]
  const toW = (px: number, py: number): [number, number] => [board.view.cx + (px - bx - bw / 2) / s, board.view.cy - (py - by - bh / 2) / s]
  const clampW = (x: number, y: number): [number, number] => {
    const { cx, cy, w } = board.view, h = w * ASPECT, m = w * 0.02
    return [Math.max(cx - w / 2 + m, Math.min(cx + w / 2 - m, x)), Math.max(cy - h / 2 + m, Math.min(cy + h / 2 - m, y))]
  }
  const wirePx = () => Math.max(10, wireRadius(board.view) * s)
  /** The resize knob sits on the loop's upper left, clear of the wire labels above each wire. */
  const knobPx = (): [number, number] => { const [lx, ly] = toPx(board.loop.x, board.loop.y), k = board.loop.r * s * Math.SQRT1_2; return [lx - k, ly - k] }

  // ---------- drawing ----------
  function arrow(x0: number, y0: number, x1: number, y1: number, color: string, width: number) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy)
    if (L < 2) return
    const ux = dx / L, uy = dy / L, hd = 5 + width * 2
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * hd * 0.6, y1 - uy * hd * 0.6); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x1, y1)
    ctx.lineTo(x1 - ux * hd - uy * hd * 0.55, y1 - uy * hd + ux * hd * 0.55)
    ctx.lineTo(x1 - ux * hd + uy * hd * 0.55, y1 - uy * hd - ux * hd * 0.55)
    ctx.closePath(); ctx.fill()
  }
  function roundRect(x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath()
  }
  /** A nice grid step for the board: 1, 2 or 5 times a power of ten, about 1/40 of the width. */
  const gridStep = (w: number) => { const raw = w / 40, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : 5) * p }

  function drawContours(a: number) {
    const Imax = Math.max(1e-9, ...board.wires.map(w => Math.abs(w.I)))
    const dA = MU0_OVER_2PI * Imax * 0.25
    const g = Math.max(4, Math.round(bw / 170))
    const nx = Math.ceil(bw / g) + 1, ny = Math.ceil(bh / g) + 1
    const A = new Float64Array(nx * ny)
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const [x, y] = toW(bx + i * g, by + j * g)
      A[j * nx + i] = vectorPotentialAt(board.wires, x, y, a)
    }
    ctx.beginPath()
    const pts: number[] = []
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const v0 = A[j * nx + i]!, v1 = A[j * nx + i + 1]!, v2 = A[(j + 1) * nx + i + 1]!, v3 = A[(j + 1) * nx + i]!
      const lo = Math.min(v0, v1, v2, v3), hi = Math.max(v0, v1, v2, v3)
      const k0 = Math.ceil(lo / dA), k1 = Math.floor(hi / dA)
      if (k1 - k0 > 5) continue // too dense to read, right next to a wire
      const x0 = bx + i * g, y0 = by + j * g
      for (let k = k0; k <= k1; k++) {
        const L = k * dA
        pts.length = 0
        const edge = (p: number, q: number, ax: number, ay: number, cx: number, cy: number) => {
          if ((p < L) !== (q < L)) { const t = (L - p) / (q - p); pts.push(ax + (cx - ax) * t, ay + (cy - ay) * t) }
        }
        edge(v0, v1, x0, y0, x0 + g, y0)
        edge(v1, v2, x0 + g, y0, x0 + g, y0 + g)
        edge(v2, v3, x0 + g, y0 + g, x0, y0 + g)
        edge(v3, v0, x0, y0 + g, x0, y0)
        for (let p = 0; p + 3 < pts.length; p += 4) { ctx.moveTo(pts[p]!, pts[p + 1]!); ctx.lineTo(pts[p + 2]!, pts[p + 3]!) }
      }
    }
    ctx.strokeStyle = C.line; ctx.globalAlpha = 0.7; ctx.lineWidth = bw < 500 ? 1.1 : 1.5; ctx.stroke(); ctx.globalAlpha = 1
  }

  function drawArrows(a: number) {
    const step = Math.max(34, bw / 15)
    ctx.fillStyle = C.arrow
    const nx = Math.floor(bw / step), ny = Math.floor(bh / step)
    const ox = bx + (bw - (nx - 1) * step) / 2, oy = by + (bh - (ny - 1) * step) / 2
    let Bref = 0
    const cells: [number, number, number, number, number][] = []
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const px = ox + i * step, py = oy + j * step
      const [x, y] = toW(px, py)
      if (board.wires.some(w => Math.hypot(px - toPx(w.x, w.y)[0], py - toPx(w.x, w.y)[1]) < wirePx() * 2.2)) continue
      const [Bx, By] = bFieldAt(board.wires, x, y, a), m = Math.hypot(Bx, By)
      if (m === 0) continue
      Bref = Math.max(Bref, m)
      cells.push([px, py, Bx / m, -By / m, m])
    }
    for (const [px, py, ux, uy, m] of cells) {
      ctx.globalAlpha = Math.max(0.18, Math.min(0.85, 0.85 + Math.log10(m / Bref) * 0.4))
      ctx.beginPath()
      ctx.moveTo(px + ux * 6, py + uy * 6)
      ctx.lineTo(px - ux * 4 - uy * 4, py - uy * 4 + ux * 4)
      ctx.lineTo(px - ux * 4 + uy * 4, py - uy * 4 - ux * 4)
      ctx.closePath(); ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  function draw() {
    if (!cw) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    const a = me.a
    // board
    ctx.save()
    roundRect(bx, by, bw, bh, 22)
    ctx.fillStyle = C.board; ctx.fill()
    ctx.lineWidth = 2; ctx.strokeStyle = C.edge; ctx.stroke()
    ctx.clip()
    const g = gridStep(board.view.w)
    const { cx, cy, w } = board.view, h = w * ASPECT
    ctx.fillStyle = C.peg
    for (let gx = Math.ceil((cx - w / 2) / g) * g; gx <= cx + w / 2; gx += g)
      for (let gy = Math.ceil((cy - h / 2) / g) * g; gy <= cy + h / 2; gy += g) {
        const [px, py] = toPx(gx, gy)
        const big = Math.abs(Math.round(gx / g) % 5) === 0 && Math.abs(Math.round(gy / g) % 5) === 0
        ctx.beginPath(); ctx.arc(px, py, big ? 2.2 : 1.3, 0, 2 * Math.PI); ctx.fill()
      }
    if (board.wires.length) { drawContours(a); drawArrows(a) }

    // loop
    const [lx, ly] = toPx(board.loop.x, board.loop.y), lr = board.loop.r * s
    ctx.setLineDash([9, 7]); ctx.strokeStyle = me.cut.length ? C.in : C.ink; ctx.lineWidth = 2.4
    ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([])
    // counterclockwise arrow at the lower right of the loop
    const t = Math.PI / 4
    const ax = lx + lr * Math.cos(t), ay = ly + lr * Math.sin(t)
    arrow(ax + Math.sin(t) * 8, ay - Math.cos(t) * 8 + 0, ax - Math.sin(t) * 10, ay + Math.cos(t) * 10, me.cut.length ? C.in : C.ink, 2.4)

    // force arrows: direction exact, length on a log scale relative to the biggest force on the board
    const fmax = Math.max(0, ...me.forces.map(f => Math.hypot(f[0], f[1])))
    if (board.wires.length > 1 && fmax > 0) me.forces.forEach(([fx, fy], i) => {
      const f = Math.hypot(fx, fy)
      if (f < fmax * 1e-4) return
      const wi = board.wires[i]!
      const [px, py] = toPx(wi.x, wi.y), r = wirePx() + 3
      const len = 22 + 46 * Math.max(0, 1 + Math.log10(f / fmax) / 3)
      arrow(px + (fx / f) * r, py - (fy / f) * r, px + (fx / f) * (r + len), py - (fy / f) * (r + len), C.force, 4)
    })
    ctx.restore()

    // loop knob (outside the clip so it never gets cut at the board edge)
    ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 2.2
    const [kx, ky] = knobPx(); ctx.beginPath(); ctx.arc(kx, ky, 9, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()

    // wires
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
    board.wires.forEach((wi, i) => {
      const [px, py] = toPx(wi.x, wi.y), r = wirePx() * (pop.get(wi) ?? 1)
      if (i === pick) { ctx.fillStyle = C.butter; ctx.beginPath(); ctx.arc(px, py, r + 5, 0, 2 * Math.PI); ctx.fill() }
      ctx.fillStyle = wi.I > 0 ? C.out : wi.I < 0 ? C.in : C.zero
      ctx.beginPath(); ctx.arc(px, py, r, 0, 2 * Math.PI); ctx.fill()
      ctx.fillStyle = C.paper; ctx.strokeStyle = C.paper; ctx.lineWidth = 2.6; ctx.lineCap = 'round'
      if (wi.I > 0) { ctx.beginPath(); ctx.arc(px, py, Math.max(2.5, r * 0.3), 0, 2 * Math.PI); ctx.fill() }
      else if (wi.I < 0) { const d = r * 0.42; ctx.beginPath(); ctx.moveTo(px - d, py - d); ctx.lineTo(px + d, py + d); ctx.moveTo(px + d, py - d); ctx.lineTo(px - d, py + d); ctx.stroke() }
      const label = `${i + 1} · ${amps(wi.I)}`
      ctx.font = `800 12.5px ${FONT}`
      const tw = ctx.measureText(label).width
      ctx.fillStyle = 'rgba(255, 253, 251, 0.92)'
      roundRect(px - tw / 2 - 7, py - r - 27, tw + 14, 19, 9.5); ctx.fill()
      ctx.fillStyle = C.ink; ctx.fillText(label, px, py - r - 13)
    })

    // probe
    const [qx, qy] = toPx(board.probe.x, board.probe.y)
    if (me.Bmag > 0) arrow(qx, qy, qx + (me.B[0] / me.Bmag) * 40, qy - (me.B[1] / me.Bmag) * 40, C.probe, 3.5)
    ctx.fillStyle = C.paper; ctx.strokeStyle = C.probe; ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(qx, qy, 9, 0, 2 * Math.PI); ctx.fill(); ctx.stroke()
    // the label sits on the side away from the field arrow
    ctx.fillStyle = C.probe; ctx.font = `800 12px ${FONT}`
    const ux = me.Bmag > 0 ? me.B[0] / me.Bmag : 0
    ctx.textAlign = ux > 0.3 ? 'right' : 'left'
    ctx.fillText('probe', ux > 0.3 ? qx - 13 : qx + 13, qy + 19)
    ctx.textAlign = 'left'

    // scale bar: five grid steps
    const [sx0, sy0] = [bx + 16, by + bh - 16]
    ctx.fillStyle = C.ink; ctx.fillRect(sx0, sy0, 5 * g * s, 3)
    ctx.font = `800 12px ${FONT}`; ctx.fillText(scaleLabel(5 * g), sx0, sy0 - 7)
  }

  // ---------- readouts ----------
  let eqTimer = 0
  function readouts() {
    const w = board.wires[pick]
    tileN('B').innerHTML = 'Field at the probe, <i>B</i>'
    tileV('B').textContent = si(me.Bmag, 'T')
    tileN('L').innerHTML = 'Around the loop, ∮<i>B</i>·d<i>l</i>'
    tileV('L').textContent = si(me.circ, 'T·m')
    tileN('M').innerHTML = '<i>μ</i>₀ × current inside'
    tileV('M').textContent = me.cut.length ? 'loop cuts a wire' : si(me.mu0Iin, 'T·m')
    el.querySelector('.sim03-tile-M')!.classList.toggle('is-na', me.cut.length > 0)
    tileN('F').innerHTML = w ? `Force on wire ${pick + 1}, <i>F</i>/<i>l</i>` : 'Force on a wire, <i>F</i>/<i>l</i>'
    tileV('F').textContent = w && board.wires.length > 1 ? si(Math.hypot(...me.forces[pick]!), 'N/m') : '0 N/m'

    // picked wire card
    picks.innerHTML = board.wires.map((wi, i) => `<button type="button" data-pick="${i}" aria-pressed="${i === pick}"><span class="sim03-glyph ${wi.I > 0 ? 'is-out' : wi.I < 0 ? 'is-in' : 'is-zero'}" aria-hidden="true"></span>${i + 1}</button>`).join('')
    pickBody.hidden = !w
    empty.hidden = !!w
    if (w) {
      for (const b of el.querySelectorAll<HTMLButtonElement>('[data-dir]')) b.setAttribute('aria-pressed', String(Math.sign(w.I || 1) === Number(b.dataset.dir)))
      const idx = STOPS.indexOf(Math.abs(w.I) as (typeof STOPS)[number])
      curIn.value = String(idx < 0 ? STOPS.length - 1 : idx)
      curIn.setAttribute('aria-valuetext', amps(w.I))
      curOut.textContent = amps(w.I)
    }
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-add]')) b.disabled = board.wires.length >= MAX_WIRES

    // the notebook typesets once per frame at most; during a drag that is every frame
    if (!eqTimer) eqTimer = requestAnimationFrame(() => { eqTimer = 0; eqs.innerHTML = notebookHtml(board, me, pick) })
  }

  let drawQueued = 0
  function update(editing = true) {
    if (editing && !compare.hidden) compare.hidden = true
    me = measure(board)
    readouts()
    if (!drawQueued) drawQueued = requestAnimationFrame(() => { drawQueued = 0; draw() })
  }

  // ---------- presets ----------
  const presetBox = $('.sim03-presets')
  PRESETS.forEach(pr => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sim03-preset'
    b.innerHTML = `<b>${pr.title}</b><span>${pr.note}</span>`
    b.addEventListener('click', () => loadPreset(pr))
    presetBox.appendChild(b)
  })
  function loadPreset(pr: Preset) {
    board = clone(pr.board)
    pick = pr.pick
    layout()
    update(false)
    if (pr.book) {
      compare.hidden = false
      compare.innerHTML = `<table><caption>${pr.title}</caption><thead><tr><th scope="col">Quantity</th><th scope="col">Book</th><th scope="col">Sim</th></tr></thead><tbody>${pr.book
        .map(r => `<tr><th scope="row">${r.label}</th><td>${r.book}</td><td>${r.sim(board, me)}</td></tr>`).join('')}</tbody></table>` +
        pr.book.filter(r => r.note).map(r => `<p class="sim03-small">${r.note}</p>`).join('')
      if (!reduce) animate(compare, { opacity: [0, 1], y: [8, 0] }, { duration: 0.4 })
      requestAnimationFrame(() => compare.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }))
    } else compare.hidden = true
  }

  // ---------- controls ----------
  picks.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-pick]')
    if (!b) return
    pick = Number(b.dataset.pick)
    update(false)
    picks.querySelector<HTMLButtonElement>(`[data-pick="${pick}"]`)?.focus()
  })
  el.querySelectorAll<HTMLButtonElement>('[data-dir]').forEach(b => b.addEventListener('click', () => {
    const w = board.wires[pick]
    if (!w) return
    const dir = Number(b.dataset.dir)
    w.I = dir * (Math.abs(w.I) || 1)
    update()
  }))
  curIn.addEventListener('input', () => {
    const w = board.wires[pick]
    if (!w) return
    const sign = w.I < 0 ? -1 : 1
    w.I = sign * STOPS[Number(curIn.value)]!
    update()
  })
  $<HTMLButtonElement>('[data-remove]').addEventListener('click', () => {
    if (!board.wires[pick]) return
    board.wires.splice(pick, 1)
    pick = Math.max(0, Math.min(pick, board.wires.length - 1))
    update()
  })
  $<HTMLButtonElement>('[data-clear]').addEventListener('click', () => { board.wires = []; pick = 0; update() })
  el.querySelectorAll<HTMLButtonElement>('[data-add]').forEach(b => b.addEventListener('click', () => {
    if (board.wires.length >= MAX_WIRES) return
    const dir = Number(b.dataset.add)
    const I0 = board.wires[pick] ? Math.abs(board.wires[pick]!.I) || 10 : 10
    const spot = freeSpot()
    const w = { x: spot[0], y: spot[1], I: dir * I0 }
    board.wires.push(w)
    pick = board.wires.length - 1
    if (!reduce) animate(0, 1, { duration: 0.45, ease: [0.34, 1.56, 0.64, 1], onUpdate: v => { pop.set(w, Math.max(0.05, v)); draw() }, onComplete: () => { pop.delete(w); draw() } })
    update()
  }))
  /** The free spot nearest the middle of the board, on a grid, clear of other wires and of the loop's line. */
  function freeSpot(): [number, number] {
    const { cx, cy, w } = board.view, step = w / 12, a = wireRadius(board.view)
    const spots: [number, number][] = []
    for (let i = -5; i <= 5; i++) for (let j = -3; j <= 3; j++) spots.push([cx + i * step, cy + j * step])
    spots.sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy))
    return spots.find(([x, y]) => board.wires.every(o => Math.hypot(o.x - x, o.y - y) > step * 0.9)
      && Math.abs(Math.hypot(x - board.loop.x, y - board.loop.y) - board.loop.r) > 3 * a
      && Math.hypot(x - board.probe.x, y - board.probe.y) > step * 0.6) ?? [cx, cy]
  }

  // ---------- pointer input ----------
  type Drag = { kind: 'wire'; i: number; ox: number; oy: number } | { kind: 'probe' | 'loop'; ox: number; oy: number } | { kind: 'rim' }
  let drag: Drag | null = null
  const local = (e: PointerEvent): [number, number] => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  function hit(px: number, py: number): Drag['kind'] | ['wire', number] | null {
    const touch = 8
    for (let i = board.wires.length - 1; i >= 0; i--) {
      const [x, y] = toPx(board.wires[i]!.x, board.wires[i]!.y)
      if (Math.hypot(px - x, py - y) < wirePx() + touch) return ['wire', i]
    }
    const [qx, qy] = toPx(board.probe.x, board.probe.y)
    if (Math.hypot(px - qx, py - qy) < 20) return 'probe'
    const [lx, ly] = toPx(board.loop.x, board.loop.y), lr = board.loop.r * s, d = Math.hypot(px - lx, py - ly)
    const [kx, ky] = knobPx()
    if (Math.hypot(px - kx, py - ky) < 18 || Math.abs(d - lr) < 9) return 'rim'
    if (d < lr) return 'loop'
    return null
  }
  const onDown = (e: PointerEvent) => {
    const [px, py] = local(e), h = hit(px, py)
    if (!h) return
    const [x, y] = toW(px, py)
    if (Array.isArray(h)) { pick = h[1]; const w = board.wires[pick]!; drag = { kind: 'wire', i: pick, ox: w.x - x, oy: w.y - y } }
    else if (h === 'probe') drag = { kind: 'probe', ox: board.probe.x - x, oy: board.probe.y - y }
    else if (h === 'loop') drag = { kind: 'loop', ox: board.loop.x - x, oy: board.loop.y - y }
    else drag = { kind: 'rim' }
    canvas.setPointerCapture(e.pointerId)
    canvas.classList.add('is-dragging')
    e.preventDefault()
    update(false)
  }
  const onMove = (e: PointerEvent) => {
    const [px, py] = local(e)
    if (!drag) { canvas.classList.toggle('is-grabbable', hit(px, py) !== null); return }
    const [x, y] = toW(px, py)
    if (drag.kind === 'wire') { const w = board.wires[drag.i]; if (w) [w.x, w.y] = clampW(x + drag.ox, y + drag.oy) }
    else if (drag.kind === 'probe') [board.probe.x, board.probe.y] = clampW(x + drag.ox, y + drag.oy)
    else if (drag.kind === 'loop') [board.loop.x, board.loop.y] = clampW(x + drag.ox, y + drag.oy)
    else board.loop.r = Math.max(board.view.w * 0.03, Math.min(board.view.w * 0.34, Math.hypot(x - board.loop.x, y - board.loop.y)))
    update()
  }
  const onUp = (e: PointerEvent) => {
    if (!drag) return
    drag = null
    canvas.classList.remove('is-dragging')
    try { canvas.releasePointerCapture(e.pointerId) } catch { /* already released */ }
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)
  canvas.addEventListener('keydown', e => {
    const w = board.wires[pick]
    const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] } as Record<string, [number, number]>)[e.key]
    if (!w || !d) return
    e.preventDefault()
    const step = gridStep(board.view.w) * (e.shiftKey ? 5 : 1)
    ;[w.x, w.y] = clampW(w.x + d[0] * step, w.y + d[1] * step)
    update()
  })

  const stageEl = $<HTMLDivElement>('.sim03-stage')
  const ro = new ResizeObserver(() => {
    layout(); draw()
    const pinned = getComputedStyle(stageEl).position === 'sticky'
    el.style.setProperty('--stage-h', pinned ? `${stageEl.offsetHeight + 12}px` : '0px')
  })
  ro.observe(canvas)
  ro.observe(stageEl)
  document.fonts?.ready.then(() => draw())
  layout()
  update(false)

  if (import.meta.env.DEV) (el as unknown as Record<string, unknown>).__sim03 = { get board() { return board }, get me() { return me }, get pick() { return pick }, toPx, loadPreset: (id: string) => loadPreset(PRESETS.find(p => p.id === id)!) }

  teardown = () => {
    ro.disconnect()
    cancelAnimationFrame(eqTimer); cancelAnimationFrame(drawQueued)
    el.innerHTML = ''
    el.classList.remove('sim03')
  }
}

export function unmount(): void {
  teardown?.()
  teardown = null
}

function clone(b: Board): Board {
  return { wires: b.wires.map(w => ({ ...w })), probe: { ...b.probe }, loop: { ...b.loop }, view: { ...b.view } }
}
