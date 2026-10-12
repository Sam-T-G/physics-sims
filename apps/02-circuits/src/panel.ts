// Layer 3: the notebook. Every equation the board obeys, typeset with KaTeX, with the live numbers plugged in.
// Live numbers are tagged with \htmlData so they can count to their new value and flash, in the order the
// math depends on them.

import katex from 'katex'
import 'katex/dist/katex.min.css'
import { animate } from 'motion'
import { LANES, SLOT_IDS, type BoardResult, type Slots, type SlotId, type Check } from './board'
import { sig3, exact, SUB } from './format'
import type { RcClock } from './timeModule'

type Ctx = { b: BoardResult; slots: Slots; selected: SlotId | null; rc?: RcClock }

// Only the two tagging commands are trusted; every string here is written by this file.
const OPTS = {
  throwOnError: false,
  strict: false,
  trust: (c: { command: string }) => c.command === '\\htmlData' || c.command === '\\htmlClass',
} as const

/** Inline math, sized like display math so fractions stay readable. */
const tex = (src: string) => katex.renderToString(`\\displaystyle ${src}`, OPTS)
/** Small inline math for use inside a sentence. */
const m = (src: string) => katex.renderToString(src, OPTS)

const UNIT: Record<string, string> = { 'Ω': '\\Omega', A: '\\text{A}', V: '\\text{V}', W: '\\text{W}', F: '\\text{F}', C: '\\text{C}', s: '\\text{s}' }
const texNum = (s: string) => s.replace('−', '-').replace('∞', '\\infty')
const fmtNum = (v: number, f: string) => (f === 'exact' ? exact(v) : sig3(v))

/** A live number: keyed so the panel can tell what changed between two renders. */
const num = (key: string, value: number, unit: string, fmt: 'sig3' | 'exact' = 'sig3') =>
  `\\htmlData{k=${key}, v=${value}, f=${fmt}}{\\htmlClass{sim02-num}{${texNum(fmtNum(value, fmt))}}}${unit ? `\\,${UNIT[unit]}` : ''}`

const sym = (id: SlotId, letter = 'R') => `\\htmlClass{sim02-sym}{\\htmlData{sym=${id}}{${letter}_{${id.slice(1)}}}}`
const RP = 'R_{\\text{P}}'
const REQ = 'R_{\\text{eq}}'
const VT = 'V_{\\text{terminal}}'
const VP = 'V_{\\text{P}}'

const ohms = (slots: Slots, id: SlotId) => {
  const p = slots[id]
  return p ? (p.kind === 'resistor' ? p.ohms : 0) : NaN
}
const ohmNum = (slots: Slots, id: SlotId) => num(`ohm-${id}`, ohms(slots, id), 'Ω', 'exact')

const eq = (src: string, cls = '') => `<div class="sim02-eq${cls}">${tex(src)}</div>`
const say = (html: string) => `<p class="sim02-say">${html}</p>`

// Tiny drawn icons, one per idea. Stroke only, so they pick up each card's color.
const ICON: Record<string, string> = {
  parallel: '<path d="M2 12h4M18 12h4M6 12c3 0 3-6 6-6s3 6 6 6M6 12h12M6 12c3 0 3 6 6 6s3-6 6-6"/>',
  series: '<path d="M2 12h3M19 12h3"/><rect x="5" y="9" width="5" height="6" rx="3"/><rect x="14" y="9" width="5" height="6" rx="3"/><path d="M10 12h4"/>',
  current: '<path d="M3 12h13"/><path d="M12 7l5 5-5 5"/><circle cx="6" cy="12" r="1.6"/><circle cx="20.5" cy="12" r="1.2"/>',
  terminal: '<rect x="3" y="7" width="16" height="10" rx="4"/><path d="M19 10.5h2v3h-2M8 12h5M10.5 9.5v5"/>',
  junction: '<path d="M3 12h6l4-5h8M9 12l4 5h8"/><circle cx="9" cy="12" r="1.6"/>',
  loop: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M17.5 3.5v3.8h-3.8"/>',
  part: '<path d="M2 12h4l2-4 3 8 3-8 3 8 2-4h3"/>',
  'rc-tau': '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  'rc-current': '<path d="M3 5c3 0 5 14 18 14"/><path d="M3 19h18"/>',
  'rc-charge': '<path d="M9 4v16M15 4v16M3 12h6M15 12h6"/>',
  energy: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 3 3 4 1-3 1-5 1-8z"/>',
}

type Row = { id: string; rank: number; title: string; tag: string | ((c: Ctx) => string); check?: string; mode: 'dc' | 'rc' | 'both'; html: (c: Ctx) => string }

const isCap = (slots: Slots, id: SlotId) => slots[id]?.kind === 'capacitor'
/** Symbol for the voltage or current of a slot: V_C / I_C for the capacitor, V₁ / I₁ for a resistor. */
const vSym = (slots: Slots, id: SlotId) => (isCap(slots, id) ? `\\htmlClass{sim02-sym}{\\htmlData{sym=${id}}{V_{C}}}` : sym(id, 'V'))
const iSym = (slots: Slots, id: SlotId) => (isCap(slots, id) ? `\\htmlClass{sim02-sym}{\\htmlData{sym=${id}}{I_{C}}}` : sym(id, 'I'))
const slotWord = (id: SlotId) => m(`R_${id.slice(1)}`)

/** Which book case the current capacitor curve is: charging from empty, discharging to empty, or in between. */
const rcCase = (c: Ctx): 'charge' | 'discharge' | 'between' => {
  const k = c.rc!
  const scale = Math.max(1e-9, Math.abs(k.Voc), Math.abs(k.V0)) * 1e-6
  // the book's charging case: from empty up to the battery's full ε (a capacitor in series with the battery)
  if (Math.abs(k.V0) <= scale && Math.abs(k.Voc) > scale && Math.abs(k.Voc - c.b.emf) <= 1e-4 * Math.max(1, c.b.emf)) return 'charge'
  if (Math.abs(k.Voc) <= scale && Math.abs(k.V0) > scale) return 'discharge'
  return 'between'
}

const ROWS: Row[] = [
  {
    id: 'parallel', rank: 0, mode: 'dc', title: 'Parallel branches R₂, R₃, R₄', tag: 'Eq 10.3', check: 'parallel',
    html: ({ b, slots }) => {
      const filled = LANES.filter(id => slots[id])
      if (!filled.length) return eq(`\\frac{1}{${RP}} = \\frac{1}{${sym('R2')}} + \\frac{1}{${sym('R3')}} + \\frac{1}{${sym('R4')}}`)
        + say(`All three branch slots are empty, so no current can cross from B to C. Put a part in ${slotWord('R2')}, ${slotWord('R3')} or ${slotWord('R4')}.`)
      const top = `\\frac{1}{${RP}} = ${filled.map(id => `\\frac{1}{${sym(id)}}`).join(' + ')}`
      const hasWire = filled.some(id => slots[id]!.kind === 'wire')
      const sub = hasWire
        ? `${RP} = ${num('Rp', b.Rp, 'Ω')}`
        : `${RP} = \\left(${filled.map(id => `\\frac{1}{${ohmNum(slots, id)}}`).join(' + ')}\\right)^{-1} = ${num('Rp', b.Rp, 'Ω')}`
      const resistors = filled.filter(id => slots[id]!.kind === 'resistor')
      const words = hasWire
        ? `A wire in one branch makes ${m('R_P = 0\\,\\Omega')}, so all the current takes the wire.`
        : resistors.length > 1
          ? `${m('R_P')} is smaller than the smallest branch: each branch you add gives the current one more path.`
          : `Only one branch is filled, so ${m('R_P')} equals that branch's resistance.`
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'series', rank: 1, mode: 'dc', title: 'Total resistance', tag: 'Eq 10.2', check: 'series',
    html: ({ b, slots }) => {
      const top = `${REQ} = ${sym('R1')} + ${RP} + ${sym('R5')}`
      if (b.status === 'open') {
        const gap = b.gaps[0] === 'lanes' ? 'every branch slot' : `slot ${slotWord(b.gaps[0] as SlotId)}`
        return eq(top) + eq(`${REQ} = ${num('Req', Infinity, 'Ω')}`, ' sim02-sub') + say(`${gap[0]!.toUpperCase()}${gap.slice(1)} is empty, so the circuit is open and no current flows.`)
      }
      const sub = `${REQ} = ${ohmNum(slots, 'R1')} + ${num('Rp', b.Rp, 'Ω')} + ${ohmNum(slots, 'R5')} = ${num('Req', b.Req, 'Ω')}`
      return eq(top) + eq(sub, ' sim02-sub') + say('Resistances in series add.')
    },
  },
  {
    id: 'current', rank: 2, mode: 'dc', title: 'Battery current', tag: 'Section 10.1', check: 'current',
    html: ({ b }) => {
      const top = `I = \\frac{\\varepsilon}{${REQ} + r}`
      if (b.idealShort) return eq(top) + eq(`I = \\frac{${num('emf', b.emf, 'V')}}{0\\,\\Omega}`, ' sim02-sub')
        + say(`With ${m('R_{\\text{eq}} + r = 0')}, the equation has no finite answer. Raise the battery's internal resistance ${m('r')} or remove a wire.`)
      if (b.status === 'open') return eq(top) + eq(`I = ${num('I', 0, 'A')}`, ' sim02-sub') + say('The circuit is open, so the battery current is 0.')
      const sub = `I = \\frac{${num('emf', b.emf, 'V')}}{${num('Req', b.Req, 'Ω')} + ${num('r', b.r, 'Ω', 'exact')}} = ${num('I', b.I, 'A')}`
      const words = b.status === 'short' ? `Short circuit: only the battery's internal resistance ${m('r')} limits the current.` : 'A lower total resistance gives a larger battery current.'
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'terminal', rank: 3, mode: 'dc', title: 'Battery terminal voltage', tag: 'Eq 10.1', check: 'terminal',
    html: ({ b }) => {
      const top = `${VT} = \\varepsilon - I r`
      if (b.idealShort) return eq(top) + say('The battery current has no finite value, so the terminal voltage has none either.')
      const sub = `${VT} = ${num('emf', b.emf, 'V')} - (${num('I', b.I, 'A')})(${num('r', b.r, 'Ω', 'exact')}) = ${num('Vt', b.Vt, 'V')}`
      const words = b.r === 0
        ? `With ${m('r = 0')}, the terminal voltage equals ${m('\\varepsilon')}.`
        : b.I === 0 ? `With no current, nothing drops across ${m('r')}, so the terminal voltage equals ${m('\\varepsilon')}.` : `The internal resistance ${m('r')} drops ${m('Ir')}, so the terminal voltage is below ${m('\\varepsilon')}.`
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'rc-tau', rank: 0, mode: 'rc', title: 'Time constant τ', tag: 'Eq 10.9',
    html: ({ b }) => {
      const k = b.cap!
      if (!Number.isFinite(k.tau)) return eq('\\tau = RC') + say('An empty slot cuts the capacitor off from the battery, so the capacitor cannot charge or discharge.')
      if (k.tau === 0) return eq('\\tau = RC') + eq(`\\tau = (${num('Rth', 0, 'Ω')})(${num('C', k.C, 'F', 'exact')}) = ${num('tau', 0, 's')}`, ' sim02-sub')
        + say(`Only plain wire is in the capacitor's path, so ${m('R = 0\\,\\Omega')} and the capacitor jumps straight to its final voltage.`)
      return eq('\\tau = RC')
        + eq(`\\tau = (${num('Rth', k.Rth, 'Ω')})(${num('C', k.C, 'F', 'exact')}) = ${num('tau', k.tau, 's')}`, ' sim02-sub')
        + say(`${m('R')} is the total resistance the capacitor's current passes through, including the battery's ${m('r')}. A larger ${m('R')} or ${m('C')} makes the capacitor charge more slowly.`)
    },
  },
  {
    id: 'rc-current', rank: 1, mode: 'rc', title: 'Capacitor current', tag: c => (c.rc && rcCase(c) === 'discharge' ? 'Eq 10.12' : 'Eq 10.10'),
    html: c => {
      const k = c.b.cap!
      const t = c.rc!
      if (!Number.isFinite(k.tau)) return eq('I_C = 0') + say('No closed path runs through the capacitor.')
      if (k.tau === 0) return eq('I_C = 0') + say(`With ${m('R = 0\\,\\Omega')} the capacitor reached its final voltage at once, so no current goes into the capacitor now.`)
      const tt = num('t', t.t, 's')
      const tauN = num('tau', k.tau, 's')
      const kind = rcCase(c)
      if (kind === 'discharge') {
        return eq(`I(t) = -\\frac{Q}{RC}\\,e^{-t/\\tau}`)
          + eq(`I = -\\frac{${num('Q0', k.C * t.V0, 'C')}}{${tauN}}\\,e^{-${tt}/${tauN}} = ${num('Ic', k.Ic, 'A')}`, ' sim02-sub')
          + say(`The minus sign means the current flows backward while the capacitor discharges. The current falls to 37% of the starting current after each ${m('\\tau')}.`)
      }
      const I0 = kind === 'charge' ? `I_0 = \\frac{\\varepsilon}{R}` : `I_0 = \\frac{V_{\\text{end}} - V_0}{R}`
      return eq(`I(t) = I_0\\,e^{-t/\\tau}, \\quad ${I0}`)
        + eq(`I = (${num('I0', t.I0, 'A')})\\,e^{-${tt}/${tauN}} = ${num('Ic', k.Ic, 'A')}`, ' sim02-sub')
        + say(kind === 'charge'
          ? `The current starts at ${m('\\varepsilon/R')}, as if the capacitor were a wire, and falls to 37% of that after one ${m('\\tau')}.`
          : `The capacitor started part-charged, so ${m('I_0')} uses the voltage gap between the start and the end instead of ${m('\\varepsilon')}.`)
    },
  },
  {
    id: 'rc-charge', rank: 2, mode: 'rc', title: 'Capacitor charge', tag: c => (c.rc && rcCase(c) === 'discharge' ? 'Eq 10.11' : 'Eq 10.8'),
    html: c => {
      const k = c.b.cap!
      const t = c.rc!
      const kind = rcCase(c)
      const tt = num('t', t.t, 's')
      const tauN = num('tau', k.tau, 's')
      const V = `${m('V_C = q/C')}`
      if (!Number.isFinite(k.tau) || k.tau === 0) return eq(`q = C V_C = (${num('C', k.C, 'F', 'exact')})(${num('Vc', k.Vc, 'V')}) = ${num('q', k.q, 'C')}`)
      if (kind === 'discharge') {
        return eq('q(t) = Q\\,e^{-t/\\tau}')
          + eq(`q = (${num('Q0', k.C * t.V0, 'C')})\\,e^{-${tt}/${tauN}} = ${num('q', k.q, 'C')}`, ' sim02-sub')
          + say(`The capacitor voltage follows the charge, since ${V}: ${m(`V_C`)} = ${num0(k.Vc, 'V')}.`)
      }
      if (kind === 'charge') {
        return eq(`q(t) = Q\\left(1 - e^{-t/\\tau}\\right), \\quad Q = C\\varepsilon`)
          + eq(`q = (${num('Q', k.C * t.Voc, 'C')})\\left(1 - e^{-${tt}/${tauN}}\\right) = ${num('q', k.q, 'C')}`, ' sim02-sub')
          + say(`After one ${m('\\tau')} the capacitor holds 63% of ${m('Q')}. With ${V}, ${m('V_C')} = ${num0(k.Vc, 'V')}.`)
      }
      return eq(`q(t) = q_{\\text{end}} + (q_0 - q_{\\text{end}})\\,e^{-t/\\tau}`)
        + eq(`q = ${num('qend', k.C * t.Voc, 'C')} + (${num('q0', k.C * t.V0, 'C')} - ${num('qend', k.C * t.Voc, 'C')})\\,e^{-${tt}/${tauN}} = ${num('q', k.q, 'C')}`, ' sim02-sub')
        + say(`Eq 10.8 and 10.11 are the two cases of this curve that start or end at ${m('q = 0')}. With ${V}, ${m('V_C')} = ${num0(k.Vc, 'V')}.`)
    },
  },
  {
    id: 'junction', rank: 4, mode: 'both', title: 'Junction rule at B and C', tag: 'Eq 10.4', check: 'junction',
    html: ({ b, slots }) => {
      const filled = LANES.filter(id => slots[id])
      if (b.idealShort || !filled.length) return eq('\\sum I_{\\text{in}} = \\sum I_{\\text{out}}') + say('The current into a junction equals the current out of the junction.')
      const top = `I = ${filled.map(id => iSym(slots, id)).join(' + ')}`
      const sub = `${num('I', b.I, 'A')} = ${filled.map(id => num(`I-${id}`, b.slots[id]?.I ?? 0, 'A')).join(' + ')}`
      const bypass = b.bypassed.length ? ` The wire branch carries all the current, so ${b.bypassed.map(id => m(`R_${id.slice(1)}`)).join(' and ')} get${b.bypassed.length > 1 ? '' : 's'} 0 A.` : ''
      return eq(top) + eq(sub, ' sim02-sub') + say(`The branch currents add back up to the battery current ${m('I')}.${bypass}`)
    },
  },
  {
    id: 'loop', rank: 5, mode: 'both', title: 'Loop rule', tag: 'Eq 10.5', check: 'loop',
    html: ({ b, slots }) => {
      const top = `\\varepsilon - I r - ${vSym(slots, 'R1')} - ${VP} - ${vSym(slots, 'R5')} = 0`
      if (b.idealShort) return eq(top)
      if (b.status === 'open' && b.cap && b.cap.Ic !== 0) return eq(top) + say('The battery is cut off, so no current flows around this loop. The capacitor current flows in a smaller loop through the branches.')
      if (b.status === 'open') return eq(top) + say(`With no current, every part drops 0 V, so the battery's full ${m(`${sig3(b.emf)}\\,\\text{V}`)} appears across the empty slot.`)
      const sub = `${num('emf', b.emf, 'V')} - ${num('Ir', b.I * b.r, 'V')} - ${num('V-R1', b.slots.R1?.V ?? 0, 'V')} - ${num('Vp', b.Vp, 'V')} - ${num('V-R5', b.slots.R5?.V ?? 0, 'V')} = 0`
      const words = b.cap ? `The voltages around the loop add to 0 at every instant, including the capacitor voltage ${m('V_C')}.` : `The battery raises the potential by ${m('\\varepsilon')}, and the resistors lower the potential by the same total.`
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'part', rank: 6, mode: 'both', title: '', tag: 'Eq 9.11, 9.13',
    html: ({ b, slots, selected }) => {
      const id = partFor(slots, selected)
      if (!id) return say('Tap a resistor on the board to show the resistor’s voltage and power here.')
      const part = slots[id]!
      const rd = b.slots[id]
      const n = m(`R_${id.slice(1)}`)
      if (part.kind === 'capacitor') return eq(`q = C V_C = (${num('C', part.farads, 'F', 'exact')})(${num('Vc', rd?.V ?? 0, 'V')}) = ${num('q', b.cap?.q ?? 0, 'C')}`)
        + say('The charge on the capacitor, from the definition of capacitance (Eq 8.1, C = Q/V).')
      if (part.kind === 'wire') return eq(`${sym(id, 'V')} = ${sym(id, 'I')} \\times 0\\,\\Omega = 0\\,\\text{V}`) + say(`A wire in ${n} has 0 Ω, so the wire drops 0 V and makes no heat.`)
      if (!rd || !Number.isFinite(rd.I)) return eq(`${sym(id, 'V')} = ${sym(id, 'I')}\\,${sym(id)}`)
      return eq(`${sym(id, 'V')} = ${sym(id, 'I')}\\,${sym(id)} = (${num(`I-${id}`, rd.I, 'A')})(${ohmNum(slots, id)}) = ${num(`V-${id}`, rd.V, 'V')}`)
        + eq(`P_{${id.slice(1)}} = ${sym(id, 'I')}^{2}\\,${sym(id)} = (${num(`I-${id}`, rd.I, 'A')})^{2}(${ohmNum(slots, id)}) = ${num(`P-${id}`, rd.P, 'W')}`)
        + say(rd.I === 0 ? `No current flows through ${n}, so ${n} has no voltage and makes no heat.` : `${n} turns this power into heat. On the board, ${n} glows pinker as the power rises.`)
    },
  },
  {
    id: 'energy', rank: 7, mode: 'dc', title: 'Power balance', tag: 'Eq 9.12, 9.13', check: 'energy',
    html: ({ b, slots }) => {
      const top = `I\\varepsilon = I^{2} r + \\sum I^{2} R`
      if (b.idealShort) return eq(top)
      const parts = SLOT_IDS.filter(id => slots[id]?.kind === 'resistor')
      const sub = `${num('Pemf', b.Pemf, 'W')} = ${num('Pr', b.Pr, 'W')} + ${parts.length ? parts.map(id => num(`P-${id}`, b.slots[id]?.P ?? 0, 'W')).join(' + ') : '0\\,\\text{W}'}`
      return eq(top) + eq(sub, ' sim02-sub') + say(`The battery's output power equals the heat in ${m('r')} plus the heat in every resistor.`)
    },
  },
]

/** A live number inside a sentence (not counted or flashed). */
const num0 = (v: number, unit: string) => m(`${texNum(sig3(v))}\\,${UNIT[unit]}`)

const partFor = (slots: Slots, selected: SlotId | null) =>
  selected && slots[selected] ? selected : SLOT_IDS.find(s => slots[s]?.kind === 'resistor')

export type Panel = {
  el: HTMLElement
  update(c: Ctx, opts: { preview: boolean; animate: boolean }): void
  setLinked(id: SlotId | null): void
  dispose(): void
}

export function createPanel(onSymbol: (id: SlotId | null) => void): Panel {
  const el = document.createElement('section')
  el.className = 'sim02-eqs'
  el.setAttribute('aria-label', 'Live equations')
  const rows = new Map<string, { el: HTMLElement; body: HTMLElement; mark: HTMLElement; head: HTMLElement; tag: HTMLElement }>()
  for (const r of ROWS) {
    const row = document.createElement('article')
    row.className = `sim02-row sim02-row-${r.id}`
    row.innerHTML = `<header class="sim02-row-head"><span class="sim02-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[r.id]}</svg></span><h3>${r.title}</h3><span class="sim02-tag"></span></header><div class="sim02-row-body"></div><p class="sim02-check"></p>`
    el.appendChild(row)
    rows.set(r.id, {
      el: row,
      head: row.querySelector('h3')!,
      tag: row.querySelector('.sim02-tag')!,
      body: row.querySelector('.sim02-row-body')!,
      mark: row.querySelector('.sim02-check')!,
    })
  }
  const running = new Set<{ stop(): void }>()
  let prev = new Map<string, number>()
  let linked: SlotId | null = null

  const symOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.<HTMLElement>('[data-sym]') ?? null
  const onOver = (e: PointerEvent) => { const s = symOf(e.target); onSymbol(s ? (s.dataset.sym as SlotId) : null) }
  const onOut = (e: PointerEvent) => { if (symOf(e.target)) onSymbol(null) }
  el.addEventListener('pointerover', onOver)
  el.addEventListener('pointerout', onOut)

  const paintLinked = () => {
    el.querySelectorAll<HTMLElement>('[data-sym]').forEach(s => s.closest('.sim02-sym')?.classList.toggle('is-linked', s.dataset.sym === linked))
  }
  const track = (a: { stop(): void; then(f: () => void): unknown }) => { running.add(a); a.then(() => running.delete(a)) }

  return {
    el,
    update(c, opts) {
      el.classList.toggle('is-preview', opts.preview)
      const checks = new Map<string, Check>(c.b.checks.map(k => [k.id, k]))
      const next = new Map<string, number>()
      for (const r of ROWS) {
        const row = rows.get(r.id)!
        const shown = r.mode === 'both' || (r.mode === 'rc') === !!c.b.cap
        row.el.hidden = !shown
        if (!shown) continue
        row.tag.textContent = typeof r.tag === 'function' ? r.tag(c) : r.tag
        if (r.id === 'part') {
          const id = partFor(c.slots, c.selected)
          const isC = id && c.slots[id]?.kind === 'capacitor'
          row.head.innerHTML = !id ? 'Voltage and power of one resistor' : isC ? 'Charge on the capacitor' : `Voltage and power of ${SUB[id]}`
          row.tag.textContent = isC ? 'Eq 8.1' : 'Eq 9.11, 9.13'
        }
        row.body.innerHTML = r.html(c)
        const chk = r.check ? checks.get(r.check) : undefined
        row.mark.className = `sim02-check${chk ? (chk.ok ? ' is-ok' : ' is-bad') : ''}`
        row.mark.innerHTML = chk
          ? `<span aria-hidden="true">${chk.ok ? '✓' : '✕'}</span> ${chk.ok ? 'Matches the full circuit solve' : 'Does not match the full solve'}`
          : ''
        row.mark.title = chk ? chk.label : ''
        row.body.querySelectorAll<HTMLElement>('[data-k]').forEach(span => {
          const k = span.dataset.k!
          const v = Number(span.dataset.v)
          next.set(k, v)
          const old = prev.get(k)
          if (!opts.animate || old === undefined || old === v) return
          const target = span.querySelector<HTMLElement>('.sim02-num') ?? span
          const delay = r.rank * 0.07
          const f = span.dataset.f!
          if (Number.isFinite(old) && Number.isFinite(v)) {
            target.textContent = fmtNum(old, f)
            track(animate(old, v, {
              duration: 0.55, delay, ease: [0.22, 1, 0.36, 1],
              onUpdate: x => { target.textContent = fmtNum(x, f) },
              onComplete: () => { target.textContent = fmtNum(v, f) },
            }))
          }
          track(animate(target, { backgroundColor: ['rgba(255, 209, 92, 0)', 'rgba(255, 209, 92, 0.9)', 'rgba(255, 255, 255, 0.92)'], scale: [1, 1.18, 1] }, { duration: 0.7, delay, ease: 'easeOut' }))
        })
      }
      prev = next
      paintLinked()
    },
    setLinked(id) {
      linked = id
      paintLinked()
    },
    dispose() {
      for (const a of running) a.stop()
      el.removeEventListener('pointerover', onOver)
      el.removeEventListener('pointerout', onOut)
      el.remove()
    },
  }
}
