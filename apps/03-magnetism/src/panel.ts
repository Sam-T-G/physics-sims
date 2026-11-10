// Layer 3: the notebook. The equations the board obeys, typeset with KaTeX, with the live numbers plugged in.
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { wireField, pairForce } from '@lib/physics'
import { pairSum, type Board, type Measure } from './board'
import { texSci, si, cm, amps } from './format'

// Only \htmlClass is trusted; every string here is written by this file.
const OPTS = { throwOnError: false, strict: false, trust: (c: { command: string }) => c.command === '\\htmlClass' } as const
const cache = new Map<string, string>()
const render = (src: string) => {
  let html = cache.get(src)
  if (html === undefined) {
    html = katex.renderToString(src, OPTS)
    if (cache.size > 600) cache.clear()
    cache.set(src, html)
  }
  return html
}
const tex = (src: string) => `<div class="sim03-eq">${render(`\\displaystyle ${src}`)}</div>`
const sub = (src: string) => `<div class="sim03-eq sim03-sub">${render(`\\displaystyle ${src}`)}</div>`
const m = (src: string) => render(src)
/** A live number in a pill, with its unit. */
const num = (x: number, unit = '') => `\\htmlClass{sim03-num}{${texSci(x)}}${unit ? `\\,\\text{${unit}}` : ''}`
const MU = '(4\\pi \\times 10^{-7}\\,\\text{T·m/A})'

const ICON = {
  wire: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>',
  sum: '<path d="M5 19 L12 5 L19 19"/><path d="M8 13h8"/>',
  loop: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17 3.5v4h-4"/>',
  force: '<path d="M4 12h14"/><path d="M13 7l5 5-5 5"/>',
}
const icon = (k: keyof typeof ICON) => `<span class="sim03-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[k]}</svg></span>`

function row(kind: string, title: string, ic: keyof typeof ICON, body: string, say: string, check?: { ok: boolean; text: string }) {
  const chk = check ? `<p class="sim03-check ${check.ok ? 'is-ok' : 'is-bad'}"><span aria-hidden="true">${check.ok ? '✓' : '✕'}</span>${check.text}</p>` : ''
  return `<section class="sim03-row sim03-row-${kind}"><div class="sim03-row-head">${icon(ic)}<h3>${title}</h3></div><div class="sim03-row-body">${body}</div><p class="sim03-say">${say}</p>${chk}</section>`
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6 * Math.abs(b), 1e-15)

export function notebookHtml(b: Board, me: Measure, pick: number): string {
  const out: string[] = []
  const w = b.wires[pick]
  const n = pick + 1
  const { x: px, y: py } = b.probe

  // one wire at the probe
  if (w) {
    const r = Math.hypot(px - w.x, py - w.y)
    const Bn = wireField(w.I, r, me.a)
    const inside = r < me.a
    out.push(row('wire', `Wire ${n}'s field at the probe`, 'wire',
      inside
        ? tex(`B_{${n}} = \\frac{\\mu_0 I_{${n}}\\, r}{2\\pi a^2} = ${num(Bn, 'T')}`)
        : tex(`B_{${n}} = \\frac{\\mu_0 I_{${n}}}{2\\pi r}`) + sub(`= \\frac{${MU}(${num(Math.abs(w.I), 'A')})}{2\\pi(${num(r, 'm')})} = ${num(Bn, 'T')}`),
      inside
        ? `The probe is inside wire ${n}, so only the current closer to the center than the probe counts.`
        : `The probe is ${cm(r)} from wire ${n}. Twice as far away, the field is half as strong.`))
  }

  // all wires added as vectors
  if (b.wires.length) {
    const ok = close(me.Bslope[0], me.B[0]) && close(me.Bslope[1], me.B[1])
    out.push(row('sum', 'Every wire at the probe', 'sum',
      tex(`\\vec B = \\vec B_1 + \\dots + \\vec B_{${b.wires.length}}`) +
      sub(`B_x = ${num(me.B[0], 'T')},\\quad B_y = ${num(me.B[1], 'T')}`) +
      sub(`B = \\sqrt{B_x^2 + B_y^2} = ${num(me.Bmag, 'T')}`),
      `Each wire's field circles that wire, so the fields add as arrows, not as plain numbers. Earth's field is about 50 μT; the probe reads ${si(me.Bmag, 'T')}.`,
      { ok, text: ok ? 'Same field as the field lines drawn on the board' : 'Does not match the field lines on the board' }))
  }

  // Ampère's law
  if (me.cut.length) {
    const names = me.cut.map(i => i + 1).join(' and ')
    out.push(row('loop', "Ampère's law around the loop", 'loop',
      tex(`\\oint \\vec B \\cdot d\\vec l = \\mu_0 I_{\\text{inside}}`),
      `The loop runs through wire ${names}, so only part of that current is inside. Move the wire fully inside or outside the loop.`))
  } else {
    const inside = me.inside.map(i => `${b.wires[i]!.I < 0 ? '−' : '+'}${amps(b.wires[i]!.I)}`).join(' ').replace(/^\+/, '')
    out.push(row('loop', "Ampère's law around the loop", 'loop',
      tex(`\\oint \\vec B \\cdot d\\vec l = \\mu_0 I_{\\text{inside}}`) +
      sub(`${num(me.circ, 'T·m')} = ${MU}(${num(me.Iin, 'A')})`),
      me.inside.length
        ? `Current inside the loop: ${inside} = ${me.Iin < 0 ? '−' : ''}${amps(me.Iin)}. Current out of the board counts as +, into the board as −. Wires outside the loop change the field along it, but their total around the loop is 0.`
        : 'No wire is inside the loop, so the total around it is 0, even where the field along the loop is strong.',
      { ok: me.ampereOk, text: me.ampereOk ? `Adding B·dl over 2000 steps around the loop gives μ₀ × ${amps(me.Iin)}` : 'The sum around the loop does not match μ₀ × the current inside' }))
  }

  // force on the picked wire
  if (w && b.wires.length > 1) {
    const lines: string[] = []
    b.wires.forEach((o, j) => {
      if (j === pick) return
      const d = Math.hypot(o.x - w.x, o.y - w.y)
      const f = pairForce(w.I, o.I, d)
      lines.push(sub(`\\frac{F_{${n}${j + 1}}}{l} = \\frac{${MU}(${num(Math.abs(w.I), 'A')})(${num(Math.abs(o.I), 'A')})}{2\\pi(${num(d, 'm')})} = ${num(Math.abs(f), 'N/m')}\\ \\text{${f > 0 ? 'pull' : f < 0 ? 'push' : ''}}`))
    })
    const [fx, fy] = me.forces[pick]!
    const [sx, sy] = pairSum(b, pick)
    const ok = close(sx, fx) && close(sy, fy)
    const total = Math.hypot(fx, fy)
    if (b.wires.length > 2) lines.push(sub(`\\frac{F}{l}\\ \\text{on wire ${n}, all added as arrows} = ${num(total, 'N/m')}`))
    out.push(row('force', `Force on wire ${n}`, 'force',
      tex(`\\frac{F}{l} = \\frac{\\mu_0 I_1 I_2}{2\\pi d}`) + lines.join(''),
      'Currents going the same way pull the wires together. Opposite currents push them apart. The force is per meter of wire.',
      { ok, text: ok ? `Same as ${m('I\\,\\vec l \\times \\vec B')} from the field at wire ${n}` : `Does not match ${m('I\\,\\vec l \\times \\vec B')} at wire ${n}` }))
  }
  return out.join('')
}
