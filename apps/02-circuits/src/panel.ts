// Layer 3: the notebook. Every equation the board obeys, typeset with KaTeX, with the live numbers plugged in.
// Live numbers are tagged with \htmlData so they can count to their new value and flash, in the order the
// math depends on them.

import katex from 'katex'
import 'katex/dist/katex.min.css'
import { animate } from 'motion'
import { relaxVoltage } from '@lib/physics'
import { LANES, SLOT_IDS, solveBoard, type BoardResult, type Slots, type SlotId, type Check } from './board'
import { sig3, exact, SUB } from './format'
import type { RcClock } from './timeModule'
import { FREE, type Mask } from './freeze'

type Ctx = { b: BoardResult; slots: Slots; selected: SlotId | null; rc?: RcClock }

// Only the two tagging commands are trusted; every string here is written by this file.
const OPTS = {
  throwOnError: false,
  strict: false,
  trust: (c: { command: string }) => c.command === '\\htmlData' || c.command === '\\htmlClass',
} as const

/** KaTeX output by source. Equations and sentences without live numbers repeat on every paint (and on every
 *  point the rows are laid out at ahead of time), so they typeset once. */
const typeset = new Map<string, string>()
const render = (src: string) => {
  // a line with live numbers holds their raw values, so it rarely repeats: typeset it fresh
  if (src.includes('\\htmlData{k=')) return katex.renderToString(src, OPTS)
  let html = typeset.get(src)
  if (html === undefined) {
    html = katex.renderToString(src, OPTS)
    if (typeset.size > 400) typeset.clear()
    typeset.set(src, html)
  }
  return html
}
/** Inline math, sized like display math so fractions stay readable. */
const tex = (src: string) => render(`\\displaystyle ${src}`)
/** Small inline math for use inside a sentence. */
const m = (src: string) => render(src)

const UNIT: Record<string, string> = { 'Ω': '\\Omega', A: '\\text{A}', V: '\\text{V}', W: '\\text{W}', F: '\\text{F}', C: '\\text{C}', s: '\\text{s}' }
const texNum = (s: string) => s.replace('−', '-').replace('∞', '\\infty')

/** How a live number prints: 3 significant figures, as dialed (`exact`), or a fixed number of decimals (`d2`). */
type Fmt = 'sig3' | 'exact' | `d${number}`

/** x with d decimals and a real minus sign; never "−0.00", and an exact 0 (or float dust) prints "0". */
export function fixed(x: number, d: number): string {
  if (!Number.isFinite(x)) return sig3(x)
  if (Math.abs(x) < 1e-12) return '0'
  const s = x.toFixed(d)
  return (/^-0(\.0*)?$/.test(s) ? s.slice(1) : s).replace('-', '−')
}
export const fmtNum = (v: number, f: string) => (f === 'exact' ? exact(v) : f.startsWith('d') ? fixed(v, Number(f.slice(1))) : sig3(v))

/**
 * One shared number of decimals for the terms of a sum, so the printed terms add up the way the row says they do
 * (12.00 − 0.12 − 11.88 = 0, not 12.0 − 0.119 − 11.9). It starts at 3 significant figures on the largest term and
 * adds decimals (two at most) until every printed term keeps 2 figures and the printed sum is exact. `sum(n)` gives
 * the printed sum's error from the rounded terms as integers (n[k] = term k × 10^d, rounded); 0 means it adds up.
 */
export function sharedDecimals(terms: readonly number[], sum: (n: number[]) => number): number {
  const live = terms.filter(v => Number.isFinite(v))
  const big = Math.max(0, ...live.map(Math.abs))
  if (!(big > 0) || live.length !== terms.length) return 0
  const d0 = Math.max(0, 2 - Math.floor(Math.log10(big)))
  for (let d = d0; d < d0 + 2; d++) {
    const n = terms.map(v => Math.round(v * 10 ** d))
    const figures = terms.every(v => Math.abs(v) < 1e-12 || Math.floor(Math.log10(Math.abs(v))) + d + 1 >= 2)
    if (figures && sum(n) === 0) return d
  }
  return d0 + 2
}

/** The loop rule's terms in order (ε, Ir, V₁, V_P, V₅), and the decimals they share. The terminal voltage row
 *  prints ε and V_terminal with the same decimals, so the two rows never show one value two ways (11.9 and 11.88). */
const loopTerms = (b: BoardResult) => {
  const out = b.batteryOut
  return [out ? 0 : b.emf, out ? 0 : b.I * b.r, b.slots.R1?.V ?? 0, b.Vp, b.slots.R5?.V ?? 0]
}
export const loopDecimals = (b: BoardResult) => sharedDecimals(loopTerms(b), n => (b.batteryOut ? 0 : n[0]! - n[1]!) - n[2]! - n[3]! - n[4]!)
const loopFmt = (b: BoardResult) => `d${loopDecimals(b)}` as Fmt

/** A live number: keyed so the panel can tell what changed between two renders. `signed`: it follows a + or −,
 *  so a negative value takes parentheses ("− (−4.42 V)", never "− −4.42 V"). */
const num = (key: string, value: number, unit: string, fmt: Fmt = 'sig3', signed = false) => {
  const core = `\\htmlData{k=${key}, v=${value}, f=${fmt}}{\\htmlClass{sim02-num}{${texNum(fmtNum(value, fmt))}}}${unit ? `\\,${UNIT[unit]}` : ''}`
  return signed && fmtNum(value, fmt).startsWith('−') ? `\\left(${core}\\right)` : core
}
/** A group KaTeX never breaks inside, so a long line can only wrap where the row allows it. */
const grp = (src: string) => `{${src}}`

const sym = (id: SlotId, letter = 'R') => `\\htmlClass{sim02-sym}{\\htmlData{sym=${id}}{${letter}_{${id.slice(1)}}}}`
const RP = 'R_{\\text{P}}'
const REQ = 'R_{\\text{eq}}'
const VT = 'V_{\\text{terminal}}'
const VP = 'V_{\\text{P}}'
const VEND = 'V_{\\text{end}}'
const QEND = 'q_{\\text{end}}'

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

type Row = { id: string; rank: number; title: string; check?: string; mode: 'dc' | 'rc' | 'both'; html: (c: Ctx) => string }

const isCap = (slots: Slots, id: SlotId) => slots[id]?.kind === 'capacitor'
/** Symbol for the voltage or current of a slot: V_C / I_C for the capacitor, V₁ / I₁ for a resistor. */
const vSym = (slots: Slots, id: SlotId) => (isCap(slots, id) ? `\\htmlClass{sim02-sym}{\\htmlData{sym=${id}}{V_{C}}}` : sym(id, 'V'))
const iSym = (slots: Slots, id: SlotId) => (isCap(slots, id) ? `\\htmlClass{sim02-sym}{\\htmlData{sym=${id}}{I_{C}}}` : sym(id, 'I'))
const slotWord = (id: SlotId) => m(`R_${id.slice(1)}`)
/** Names in a sentence: "R₁", "R₁ and R₅", "R₂, R₃ and R₄". */
const listWords = (words: string[]) => (words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`)
/** The empty slots, every one of them named, and whether there is more than one. */
const gapList = (b: BoardResult) => {
  const ids = b.gaps.flatMap(g => (g === 'lanes' ? (['R2', 'R3', 'R4'] as SlotId[]) : [g]))
  return { text: listWords(ids.map(slotWord)), many: ids.length > 1 }
}
const cap1 = (html: string) => html.replace(/^[a-z]/, ch => ch.toUpperCase())

/**
 * The R in τ = RC, built from where the capacitor sits: the resistance the capacitor's charge flows through with
 * ε set to 0 (Section 10.5; paths side by side combine like Eq 10.3, paths in a row add like Eq 10.2). Pure, so a test
 * can hold its value to the solver's `cap.Rth` on every board.
 * - `series`: the capacitor in R₁ or R₅, the battery in: one loop, R = the other series slot + R_P + r.
 * - `branch`: the capacitor in R₂ to R₄, the battery in: the other branches in parallel with R₁ + R₅ + r.
 * - `out`: the battery switched out (a wire where it was, no r): what the capacitor empties through.
 * - `cutoff`: R₁ or R₅ empty, so only the other branches are left: what the capacitor empties through.
 * - `none`: no loop at all (R = ∞).
 * `tex` is the right side of R = …, wires and zero terms left out; `paths` the KaTeX names of each path.
 */
export function capResistance(slots: Slots, capId: SlotId, r: number, batteryOut: boolean): {
  kind: 'series' | 'branch' | 'out' | 'cutoff' | 'none'; tex: string; value: number; paths: string[]; viaBattery: boolean
} {
  const rr = batteryOut ? 0 : r
  const lanes = LANES.filter(id => id !== capId && slots[id])
  const ohm = (id: SlotId) => (slots[id]!.kind === 'resistor' ? (slots[id] as { ohms: number }).ohms : 0)
  const termsOf = (ids: SlotId[]) => ids.filter(id => slots[id]!.kind === 'resistor').map(id => `R_{${id.slice(1)}}`)
  const sum = (ts: string[]) => (ts.length ? ts.join(' + ') : '0')
  const none = { kind: 'none' as const, tex: '\\infty', value: Infinity, paths: [], viaBattery: false }
  if (!LANES.includes(capId)) {
    const other: SlotId = capId === 'R1' ? 'R5' : 'R1'
    if (!slots[other] || !lanes.length) return none
    const laneOhms = lanes.map(ohm)
    const Rp = laneOhms.some(x => x === 0) ? 0 : 1 / laneOhms.reduce((s, x) => s + 1 / x, 0)
    const ts = [...termsOf([other]), ...(Rp > 0 ? [RP] : []), ...(rr > 0 ? ['r'] : [])]
    return { kind: batteryOut ? 'out' : 'series', tex: sum(ts), value: ohm(other) + Rp + rr, paths: [sum(ts)], viaBattery: !batteryOut }
  }
  const outer = !!slots.R1 && !!slots.R5
  const paths: { tex: string; ohms: number }[] = lanes.map(id => ({ tex: termsOf([id])[0] ?? '0', ohms: ohm(id) }))
  if (outer) paths.push({ tex: sum([...termsOf(['R1', 'R5']), ...(rr > 0 ? ['r'] : [])]), ohms: ohm('R1') + ohm('R5') + rr })
  if (!paths.length) return none
  const value = paths.some(p => p.ohms === 0) ? 0 : 1 / paths.reduce((s, p) => s + 1 / p.ohms, 0)
  const tex = paths.length === 1 ? paths[0]!.tex : `\\left(${paths.map(p => `\\frac{1}{${p.tex}}`).join(' + ')}\\right)^{-1}`
  return { kind: batteryOut ? 'out' : outer ? 'branch' : 'cutoff', tex, value, paths: paths.map(p => p.tex), viaBattery: outer && !batteryOut }
}

/** The words under τ = RC: which R this is, here, named part by part. */
function tauWords(c: Ctx): string {
  const k = c.b.cap!
  const R = capResistance(c.slots, k.id, c.b.r, c.b.batteryOut)
  const named = (ids: SlotId[]) => ids.filter(id => id !== k.id && c.slots[id]?.kind === 'resistor').map(slotWord)
  const sideBySide = R.paths.length > 1 ? ' These paths are in parallel.' : ''
  let lead: string
  if (R.kind === 'series') {
    lead = `${m('R')} is the total resistance in the capacitor's loop${c.b.r > 0 ? `, including the battery's ${m('r')}` : ''}.`
  } else if (R.kind === 'branch') {
    const lanes = named(['R2', 'R3', 'R4'])
    const round = [...named(['R1', 'R5']), 'the battery']
    lead = lanes.length
      ? `The capacitor's charge can flow through ${listWords(lanes)}, or around through ${listWords(round)}.${sideBySide}`
      : `The capacitor's charge flows around through ${listWords(round)}.`
  } else if (R.kind === 'out') {
    lead = `${m('R')} is the resistance the capacitor discharges through. With the battery out, ${m('r')} is not in the path.${sideBySide}`
  } else {
    const g = gapList(c.b)
    lead = `${m('R')} is the resistance the capacitor discharges through. With ${g.text} empty, the battery is cut off.${sideBySide}`
  }
  return `${lead} A larger ${m('R')} or ${m('C')} means slower charging and discharging.`
}

/**
 * Which curve the capacitor is on (c.rc: where it started, V0, and where it heads, Voc):
 * `charge`: the book's case, empty up to the battery's full ε (Eq 10.8, 10.10). `fill`: empty, but heading for a
 * V_end below ε (a capacitor in a branch). `discharge`: down to empty (Eq 10.11, 10.12). `between`: a part-charged
 * start. `settled`: already at its end voltage, so nothing moves.
 */
export function rcCase(c: { b: BoardResult; rc?: Pick<RcClock, 'V0' | 'Voc'> }): 'charge' | 'fill' | 'discharge' | 'between' | 'settled' {
  const k = c.rc!
  const scale = Math.max(1e-9, Math.abs(k.Voc), Math.abs(k.V0)) * 1e-6
  if (Math.abs(k.Voc - k.V0) <= scale) return 'settled'
  if (Math.abs(k.V0) <= scale) return Math.abs(k.Voc - c.b.emf) <= 1e-4 * Math.max(1, c.b.emf) ? 'charge' : 'fill'
  if (Math.abs(k.Voc) <= scale) return 'discharge'
  return 'between'
}
/** No curve to follow: no loop (τ = ∞), a jump (τ = 0), or a capacitor already at its end voltage. */
const noCurve = (c: Ctx) => !Number.isFinite(c.b.cap!.tau) || c.b.cap!.tau === 0 || !c.rc || rcCase(c) === 'settled'
/** The clock has landed on the end of the curve (6τ): the board shows the end value, not the exponential's. */
const atEnd = (c: Ctx) => !!c.rc && c.rc.t >= 6 * c.b.cap!.tau * (1 - 1e-9)
/** At the end: "t = 6.00τ, e^(−t/τ) = 0.00248 ≈ 0, so I_C ≈ 0 A". */
const endLine = (c: Ctx, rest: string) => {
  const n = c.rc!.t / c.b.cap!.tau
  // one break point, after the first ≈, so "I_C ≈ 0 A" never ends up alone on a line
  return `${grp(`t = ${num('tn', n, '')}\\,\\tau,\\ e^{-t/\\tau} = ${num('ex', Math.exp(-n), '')}`)} \\approx ${grp(`0,\\ \\text{so}\\ ${rest}`)}`
}

const ROWS: Row[] = [
  {
    id: 'parallel', rank: 0, mode: 'dc', title: 'Parallel branches R₂, R₃, R₄', check: 'parallel',
    html: ({ b, slots }) => {
      const filled = LANES.filter(id => slots[id])
      if (!filled.length) return eq(`\\frac{1}{${RP}} = \\frac{1}{${sym('R2')}} + \\frac{1}{${sym('R3')}} + \\frac{1}{${sym('R4')}}`)
        + say(`All three branch slots are empty, so no current flows from B to C. Place a part in ${slotWord('R2')}, ${slotWord('R3')} or ${slotWord('R4')}.`)
      const top = `\\frac{1}{${RP}} = ${filled.map(id => `\\frac{1}{${sym(id)}}`).join(' + ')}`
      const hasWire = filled.some(id => slots[id]!.kind === 'wire')
      const sub = hasWire
        ? `${RP} = ${num('Rp', b.Rp, 'Ω')}`
        : `${RP} = ${grp(`\\left(${filled.map(id => `\\frac{1}{${ohmNum(slots, id)}}`).join(' + ')}\\right)^{-1} = ${num('Rp', b.Rp, 'Ω')}`)}`
      const resistors = filled.filter(id => slots[id]!.kind === 'resistor')
      const words = hasWire
        ? `A wire in one branch makes ${m(`${RP} = 0\\,\\Omega`)}, so all the current flows through the wire.`
        : resistors.length > 1
          ? `${m(RP)} is smaller than the smallest branch, because each branch adds another path.`
          : `Only ${slotWord(resistors[0]!)} is filled, so ${m(`${RP} = R_{${resistors[0]!.slice(1)}}`)}.`
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'series', rank: 1, mode: 'dc', title: 'Total resistance', check: 'series',
    html: ({ b, slots }) => {
      const top = `${REQ} = ${sym('R1')} + ${RP} + ${sym('R5')}`
      if (b.status === 'open') {
        const g = gapList(b)
        return eq(top) + eq(`${REQ} = ${num('Req', Infinity, 'Ω')}`, ' sim02-sub') + say(`${cap1(g.text)} ${g.many ? 'are' : 'is'} empty, so the circuit is open and no current flows.`)
      }
      const sub = `${REQ} = ${ohmNum(slots, 'R1')} + ${num('Rp', b.Rp, 'Ω')} + ${grp(`${ohmNum(slots, 'R5')} = ${num('Req', b.Req, 'Ω')}`)}`
      return eq(top) + eq(sub, ' sim02-sub') + say('Resistances in series add.')
    },
  },
  {
    id: 'current', rank: 2, mode: 'dc', title: 'Battery current', check: 'current',
    html: ({ b }) => {
      const top = `I = \\frac{\\varepsilon}{${REQ} + r}`
      if (b.idealShort) return eq(top) + eq(`I = \\frac{${num('emf', b.emf, 'V')}}{0\\,\\Omega}`, ' sim02-sub')
        + say(`The denominator is 0, so the current is undefined. Raise ${m('r')} or remove a wire.`)
      if (b.status === 'open') return eq(top) + eq(`I = ${num('I', 0, 'A')}`, ' sim02-sub') + say('The circuit is open, so the battery current is 0.')
      const sub = `I = ${grp(`\\frac{${num('emf', b.emf, 'V')}}{${num('Req', b.Req, 'Ω')} + ${num('r', b.r, 'Ω', 'exact')}} = ${num('I', b.I, 'A')}`)}`
      const words = b.status === 'short' ? `Short circuit: only the internal resistance ${m('r')} limits the current.` : 'A smaller total resistance gives a larger current.'
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'terminal', rank: 3, mode: 'dc', title: 'Battery terminal voltage', check: 'terminal',
    html: ({ b }) => {
      const top = `${VT} = \\varepsilon - I r`
      if (b.idealShort) return eq(top) + say('The current is undefined, so the terminal voltage is undefined too.')
      // ε and V_terminal print with the loop row's decimals (when that row prints its sum), so both show one V_terminal
      const d: Fmt = b.status === 'open' ? 'sig3' : loopFmt(b)
      const sub = `${VT} = ${num('emf', b.emf, 'V', d)} - ${grp(`(${num('I', b.I, 'A')})(${num('r', b.r, 'Ω', 'exact')}) = ${num('Vt', b.Vt, 'V', d)}`)}`
      const words = b.status === 'short'
        ? `All ${m(`${texNum(sig3(b.emf))}\\,\\text{V}`)} drops across ${m('r')} inside the battery, so the terminal voltage is 0 V.`
        : b.r === 0
          ? `With ${m('r = 0')}, the terminal voltage equals ${m('\\varepsilon')}.`
          : b.I === 0 ? `With no current, nothing drops across ${m('r')}, so the terminal voltage equals ${m('\\varepsilon')}.` : `The drop ${m('Ir')} across ${m('r')} makes the terminal voltage less than ${m('\\varepsilon')}.`
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'rc-tau', rank: 0, mode: 'rc', title: 'Time constant τ',
    html: c => {
      const k = c.b.cap!
      if (!Number.isFinite(k.tau)) {
        const g = gapList(c.b)
        return eq('\\tau = RC') + say(g.text
          ? `${cap1(g.text)} ${g.many ? 'are' : 'is'} empty, so the capacitor has no loop to charge or discharge through.`
          : 'The capacitor has no loop to charge or discharge through.')
      }
      if (k.tau === 0) return eq('\\tau = RC') + eq(`\\tau = (${num('Rth', 0, 'Ω')})(${num('C', k.C, 'F', 'exact')}) = ${num('tau', 0, 's')}`, ' sim02-sub')
        + say(`Only wire is in the capacitor's path, so ${m('R = 0\\,\\Omega')} and the capacitor jumps straight to the final voltage.`)
      const R = capResistance(c.slots, k.id, c.b.r, c.b.batteryOut)
      return eq('\\tau = RC')
        + eq(`R = ${grp(`${R.tex} = ${num('Rth', k.Rth, 'Ω')}`)}`, ' sim02-sub')
        + eq(`\\tau = ${grp(`(${num('Rth', k.Rth, 'Ω')})(${num('C', k.C, 'F', 'exact')}) = ${num('tau', k.tau, 's')}`)}`, ' sim02-sub')
        + say(tauWords(c))
    },
  },
  {
    id: 'rc-current', rank: 1, mode: 'rc', title: 'Capacitor current', check: 'rc',
    html: c => {
      const k = c.b.cap!
      const t = c.rc!
      if (!Number.isFinite(k.tau)) return eq('I_C = 0') + say('No loop passes through the capacitor.')
      if (k.tau === 0) return eq('I_C = 0') + say(`With ${m('R = 0\\,\\Omega')} the capacitor reached the final voltage instantly, so no current flows now.`)
      const kind = rcCase(c)
      if (kind === 'settled') return eq('I_C = 0') + say('The capacitor is already at the final voltage, so no current flows.')
      const tt = num('t', t.t, 's')
      const tauN = num('tau', k.tau, 's')
      const end = atEnd(c)
      if (kind === 'discharge') {
        return eq(`I_C(t) = -\\frac{Q}{RC}\\,e^{-t/\\tau}`)
          + eq(end ? endLine(c, `I_C \\approx 0\\,\\text{A}`)
            : `I_C = ${grp(`-\\frac{${num('Q0', k.C * t.V0, 'C')}}{${tauN}}\\,e^{-${tt}/${tauN}}`)} = ${num('Ic', k.Ic, 'A')}`, ' sim02-sub')
          + say(`The minus sign means the current flows opposite to the charging current. After each ${m('\\tau')}, 37% of the current remains.`)
      }
      const I0 = kind === 'charge' ? `I_0 = \\frac{\\varepsilon}{R}` : kind === 'fill' ? `I_0 = \\frac{${VEND}}{R}` : `I_0 = \\frac{${VEND} - V_0}{R}`
      const words = kind === 'charge'
        ? `The current starts at ${m('\\varepsilon/R')}, as if the capacitor were a wire, and falls to 37% of that after one ${m('\\tau')}.`
        : kind === 'fill'
          ? `The capacitor only charges to ${m(`${VEND} = ${texNum(sig3(t.Voc))}\\,\\text{V}`)}${LANES.includes(k.id) ? ', the voltage across the capacitor\'s branch' : ''}, so ${m(`I_0 = ${VEND}/R`)}.`
          : `The capacitor starts at ${m(`V_0 = ${texNum(sig3(t.V0))}\\,\\text{V}`)} and ends at ${m(`${VEND} = ${texNum(sig3(t.Voc))}\\,\\text{V}`)}, so ${m(`I_0 = (${VEND} - V_0)/R`)}.`
      return eq(`I_C(t) = I_0\\,e^{-t/\\tau}, \\quad ${I0}`)
        + eq(end ? endLine(c, `I_C \\approx 0\\,\\text{A}`) : `I_C = ${grp(`(${num('I0', t.I0, 'A')})\\,e^{-${tt}/${tauN}}`)} = ${num('Ic', k.Ic, 'A')}`, ' sim02-sub')
        + say(words)
    },
  },
  {
    id: 'rc-charge', rank: 2, mode: 'rc', title: 'Capacitor charge',
    html: c => {
      const k = c.b.cap!
      const t = c.rc!
      const V = `${m('V_C = q/C')}`
      const qcv = eq(`q = C V_C = ${grp(`(${num('C', k.C, 'F', 'exact')})(${num('Vc', k.Vc, 'V')}) = ${num('q', k.q, 'C')}`)}`)
      if (!Number.isFinite(k.tau)) return qcv + say(`With no loop, charge cannot move on or off the plates, so ${m('q')} stays the same.`)
      if (k.tau === 0) return qcv + say(Math.abs(k.Vc) < 1e-9
        ? `The wire in parallel with the capacitor holds ${m('V_C')} at 0 V, so the capacitor holds no charge.`
        : `With ${m('R = 0\\,\\Omega')} the capacitor jumped straight to the final voltage, so ${m('q')} stays the same.`)
      const kind = rcCase(c)
      if (kind === 'settled') return qcv + say(`The capacitor is already at the final voltage, so ${m('q')} stays the same.`)
      const tt = num('t', t.t, 's')
      const tauN = num('tau', k.tau, 's')
      const end = atEnd(c)
      if (kind === 'discharge') {
        return eq('q(t) = Q\\,e^{-t/\\tau}')
          + eq(end ? endLine(c, `q \\approx 0\\,\\text{C}`) : `q = ${grp(`(${num('Q0', k.C * t.V0, 'C')})\\,e^{-${tt}/${tauN}}`)} = ${num('q', k.q, 'C')}`, ' sim02-sub')
          + say(`The voltage follows the charge (${V}), so ${m(`V_C`)} = ${num0(k.Vc, 'V')}.`)
      }
      if (kind === 'charge') {
        return eq(`q(t) = Q\\left(1 - e^{-t/\\tau}\\right), \\quad Q = C\\varepsilon`)
          + eq(end ? endLine(c, `q \\approx Q = ${num('q', k.q, 'C')}`) : `q = ${grp(`(${num('Q', k.C * t.Voc, 'C')})\\left(1 - e^{-${tt}/${tauN}}\\right)`)} = ${num('q', k.q, 'C')}`, ' sim02-sub')
          + say(`After one ${m('\\tau')} the capacitor holds 63% of ${m('Q')}. With ${V}, ${m('V_C')} = ${num0(k.Vc, 'V')}.`)
      }
      if (kind === 'fill') {
        return eq(`q(t) = ${QEND}\\left(1 - e^{-t/\\tau}\\right), \\quad ${QEND} = C\\,${VEND}`)
          + eq(end ? endLine(c, `q \\approx ${QEND} = ${num('q', k.q, 'C')}`) : `q = ${grp(`(${num('qend', k.C * t.Voc, 'C')})\\left(1 - e^{-${tt}/${tauN}}\\right)`)} = ${num('q', k.q, 'C')}`, ' sim02-sub')
          + say(`The capacitor charges to ${m(`${QEND} = C\\,${VEND}`)}, not ${m('C\\varepsilon')}. With ${V}, ${m('V_C')} = ${num0(k.Vc, 'V')}.`)
      }
      return eq(`q(t) = ${QEND} + (q_0 - ${QEND})\\,e^{-t/\\tau}`)
        + eq(end ? endLine(c, `q \\approx ${QEND} = ${num('q', k.q, 'C')}`)
          : `q = ${num('qend', k.C * t.Voc, 'C')} + ${grp(`(${num('q0', k.C * t.V0, 'C')} - ${num('qend', k.C * t.Voc, 'C', 'sig3', true)})\\,e^{-${tt}/${tauN}}`)} = ${num('q', k.q, 'C')}`, ' sim02-sub')
        + say(`With ${V}, ${m('V_C')} = ${num0(k.Vc, 'V')}.`)
    },
  },
  {
    id: 'junction', rank: 4, mode: 'both', title: 'Junction rule at B and C', check: 'junction',
    html: ({ b, slots }) => {
      const filled = LANES.filter(id => slots[id])
      if (b.idealShort || !filled.length) return eq('\\sum I_{\\text{in}} = \\sum I_{\\text{out}}') + say('Current into a junction equals current out.')
      const top = `I = ${filled.map(id => iSym(slots, id)).join(' + ')}`
      const Is = filled.map(id => b.slots[id]?.I ?? 0)
      const d = `d${sharedDecimals([b.I, ...Is], n => n[0]! - n.slice(1).reduce((s, x) => s + x, 0))}` as Fmt
      const sub = `${num('I', b.I, 'A', d)} = ${filled.map((id, j) => num(`I-${id}`, Is[j]!, 'A', d, j > 0)).join(' + ')}`
      const bypass = b.bypassed.length ? ` The wire branch carries all the current, so ${b.bypassed.map(id => m(`R_${id.slice(1)}`)).join(' and ')} get${b.bypassed.length > 1 ? '' : 's'} 0 A.` : ''
      const words = b.batteryOut
        ? `The branch currents add up to ${m('I')}, the current in the wire that replaced the battery.`
        : b.status === 'open' && b.cap && b.cap.Ic !== 0
          ? `The battery is cut off, so ${m('I = 0')}: the capacitor's current returns through the other branches, and the branch currents sum to 0.`
          : `The branch currents add up to the battery current ${m('I')}.`
      return eq(top) + eq(sub, ' sim02-sub') + say(`${words}${bypass}`)
    },
  },
  {
    id: 'loop', rank: 5, mode: 'both', title: 'Loop rule', check: 'loop',
    html: ({ b, slots }) => {
      const out = b.batteryOut
      const top = `${out ? '' : '\\varepsilon - I r '}- ${vSym(slots, 'R1')} - ${VP} - ${vSym(slots, 'R5')} = 0`
      if (b.idealShort) return eq(top) + say('The current is undefined, so this sum cannot be evaluated.')
      const g = gapList(b)
      if (b.status === 'open' && b.cap && b.cap.Ic !== 0) return eq(top) + say('The battery is cut off, so no current flows around this loop. The capacitor current flows in a smaller loop through the branches.')
      if (b.status === 'open' && b.cap) return eq(top) + say(`${cap1(g.text)} ${g.many ? 'are' : 'is'} empty, so no current flows around this loop.`)
      if (b.status === 'open') {
        const full = `the battery's full ${m(`${texNum(sig3(b.emf))}\\,\\text{V}`)}`
        return eq(top) + say(g.many
          ? `${cap1(g.text)} are empty. With no current, every part drops 0 V, so ${full} appears across the gaps.`
          : `${cap1(g.text)} is empty. With no current, every part drops 0 V, so ${full} appears across the empty slot.`)
      }
      const terms = loopTerms(b)
      const d = loopFmt(b)
      // the last two terms and "= 0" stay together, so a wrapped line never ends on a lone "0 V = 0"
      const parts = `${num('V-R1', terms[2]!, 'V', d, true)} - ${grp(`${num('Vp', terms[3]!, 'V', d, true)} - ${num('V-R5', terms[4]!, 'V', d, true)} = 0`)}`
      const sub = out ? `- ${parts}` : `${num('emf', b.emf, 'V', d)} - ${num('Ir', terms[1]!, 'V', d, true)} - ${parts}`
      const inLane = !!b.cap && LANES.includes(b.cap.id)
      const words = out
        ? `With the battery out, ${m('\\varepsilon = 0')} and ${m('r = 0')}, so the voltages across the parts add to 0.${inLane ? ` Here ${m(VP)} is the capacitor voltage ${m('V_C')}.` : ''}`
        : b.cap
          ? `The voltages around the loop add to 0 at every instant, including the capacitor voltage ${m('V_C')}.${inLane ? ` Here ${m(VP)} is the capacitor voltage ${m('V_C')}.` : ''}`
          : b.status === 'short'
            ? `The battery raises the voltage by ${m('\\varepsilon')}, and all of that drops across ${m('r')} inside the battery.`
            : `The battery raises the voltage by ${m('\\varepsilon')}, and ${b.r > 0 ? `${m('r')} and the resistors drop` : 'the resistors drop'} the same total.`
      return eq(top) + eq(sub, ' sim02-sub') + say(words)
    },
  },
  {
    id: 'part', rank: 6, mode: 'both', title: '',
    html: ({ b, slots, selected }) => {
      const id = partFor(slots, selected)
      if (!id) return say("There's no resistor on the board yet.")
      const part = slots[id]!
      const rd = b.slots[id]
      const n = m(`R_${id.slice(1)}`)
      if (part.kind === 'capacitor') return eq(`q = C V_C = ${grp(`(${num('C', part.farads, 'F', 'exact')})(${num('Vc', rd?.V ?? 0, 'V')}) = ${num('q', b.cap?.q ?? 0, 'C')}`)}`)
        + say('A larger C or V stores more charge.')
      if (part.kind === 'wire') return eq(`${sym(id, 'V')} = ${sym(id, 'I')}\\,${sym(id)} = ${grp(`(${num(`I-${id}`, rd?.I ?? 0, 'A')})(0\\,\\Omega) = 0\\,\\text{V}`)}`)
        + say(`A wire in ${n} has 0 Ω, so the wire drops 0 V and produces no heat.`)
      if (!rd || !Number.isFinite(rd.I)) return eq(`${sym(id, 'V')} = ${sym(id, 'I')}\\,${sym(id)}`)
      return eq(`${sym(id, 'V')} = ${sym(id, 'I')}\\,${sym(id)} = ${grp(`(${num(`I-${id}`, rd.I, 'A')})(${ohmNum(slots, id)}) = ${num(`V-${id}`, rd.V, 'V')}`)}`)
        + eq(`P_{${id.slice(1)}} = ${sym(id, 'I')}^{2}\\,${sym(id)} = ${grp(`(${num(`I-${id}`, rd.I, 'A')})^{2}(${ohmNum(slots, id)}) = ${num(`P-${id}`, rd.P, 'W')}`)}`)
        + say(rd.I === 0 ? `No current flows through ${n}, so ${n} has no voltage and produces no heat.` : `${n} converts this power into heat.`)
    },
  },
  {
    id: 'energy', rank: 7, mode: 'dc', title: 'Power balance', check: 'energy',
    html: ({ b, slots }) => {
      const top = `I\\varepsilon = I^{2} r + \\sum I^{2} R`
      if (b.idealShort) return eq(top) + say('The current is undefined, so this sum cannot be evaluated.')
      const parts = SLOT_IDS.filter(id => slots[id]?.kind === 'resistor')
      const Ps = parts.map(id => b.slots[id]?.P ?? 0)
      const d = `d${sharedDecimals([b.Pemf, b.Pr, ...Ps], n => n[0]! - n.slice(1).reduce((s, x) => s + x, 0))}` as Fmt
      const named = parts.length ? eq(`I\\varepsilon = I^{2} r + ${parts.map(id => sym(id, 'P')).join(' + ')}`, ' sim02-sub') : ''
      const sub = `${num('Pemf', b.Pemf, 'W', d)} = ${num('Pr', b.Pr, 'W', d)} + ${parts.length ? parts.map((id, j) => num(`P-${id}`, Ps[j]!, 'W', d, true)).join(' + ') : '0\\,\\text{W}'}`
      return eq(top) + named + eq(sub, ' sim02-sub') + say(`All of the battery's power, ${m('I\\varepsilon')}, becomes heat: in ${m('r')} and in every resistor.`)
    },
  },
]

/** A live number inside a sentence (not counted or flashed). */
const num0 = (v: number, unit: string) => m(`${texNum(sig3(v))}\\,${UNIT[unit]}`)

/** A live number's key (the \\htmlData k) as a quantity key (freeze.ts), so a prediction can cover it. */
const qKey = (k: string): string | null => {
  if (k === 'I' || k === 'Ic' || k === 'Vc' || k === 'tau' || k === 'Rth') return k
  if (k === 'Vt') return 'V'
  if (k === 'Vp') return 'V@P'
  if (k === 'Ir') return 'V@r'
  if (k === 'Req') return 'R'
  if (k === 'Rp') return 'R@P'
  if (k === 'Pemf') return 'P'
  if (k === 'Pr') return 'P@r'
  if (k === 'q' || k === 'Q' || k === 'Q0' || k === 'q0' || k === 'qend') return 'q'
  const m = /^([IVP])-(R\d)$/.exec(k)
  return m ? `${m[1]}@${m[2]}` : null
}
/** A held sentence's pill. A carried cover (the student already picked on this step) lifts at the next step's pick. */
const held = (next: boolean) => `<span class="sim02-held-pill">${next ? 'Shows up after your next pick' : 'Shows up after you predict'}</span>`

const partFor = (slots: Slots, selected: SlotId | null) =>
  selected && slots[selected] ? selected : SLOT_IDS.find(s => slots[s]?.kind === 'resistor')

/** Everything that decides which lines a row holds, but none of the numbers that move along a capacitor curve. */
/** Points along a capacitor curve (in τ) where the rows are laid out ahead of time; denser early, where the
 *  numbers change fastest. 6 is the end of the curve, where the clock lands on the end value. */
const SAMPLES = [0, 0.01, 0.02, 0.04, 0.07, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6]
/** ms: a shape that changes again sooner than this (a dial drag) waits until it settles to be laid out ahead. */
const PRESAMPLE_CALM = 250

const shapeKey = (c: Ctx, width: number) => JSON.stringify([
  width, c.slots, c.selected, c.b.status, c.b.idealShort, c.b.batteryOut, c.b.emf, c.b.r,
  c.rc && c.b.cap ? [rcCase(c), c.rc.V0, c.rc.Voc, c.rc.tau] : null,
])

export type Panel = {
  el: HTMLElement
  /** `mask`: what an open prediction covers (numbers) and holds back (a row's sentence). */
  update(c: Ctx, opts: { preview: boolean; animate: boolean }, mask?: Mask): void
  setLinked(id: SlotId | null): void
  dispose(): void
}

export function createPanel(onSymbol: (id: SlotId | null) => void, reduce: () => boolean = () => false): Panel {
  const el = document.createElement('section')
  el.className = 'sim02-eqs'
  el.setAttribute('aria-label', 'Live equations')
  const rows = new Map<string, { el: HTMLElement; body: HTMLElement; mark: HTMLElement; head: HTMLElement }>()
  for (const r of ROWS) {
    const row = document.createElement('article')
    row.className = `sim02-row sim02-row-${r.id}`
    row.innerHTML = `<header class="sim02-row-head"><span class="sim02-icon" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[r.id]}</svg></span><h3>${r.title}</h3></header><div class="sim02-row-body"></div><p class="sim02-check"></p>`
    el.appendChild(row)
    rows.set(r.id, {
      el: row,
      head: row.querySelector('h3')!,
      body: row.querySelector('.sim02-row-body')!,
      mark: row.querySelector('.sim02-check')!,
    })
  }
  const running = new Set<{ stop(): void }>()
  let prev = new Map<string, number>()
  /** Numbers covered at the last paint: when their cover lifts they count up from 0. */
  let covered = new Set<string>()
  let linked: SlotId | null = null
  /**
   * While a capacitor curve runs, the numbers change length every frame and a KaTeX line can rewrap, so a row
   * would grow and shrink on every loop and move the lines under it. Each line of a row keeps the tallest
   * height it has had for this circuit as its min-height; a new circuit, part selection, curve or panel width
   * starts over.
   */
  let shape = ''
  let floors = new Map<string, number[]>()
  /** When the shape last changed, and a pending pre-measure (a dial drag reshapes every frame, so that one waits). */
  let reshapedAt = -Infinity
  let presampleTimer = 0
  let last: { c: Ctx; opts: { preview: boolean; animate: boolean }; mask: Mask } | null = null

  /** A row's sentence that would give the answer away keeps its place (and its height) under a pill. */
  const holdSay = (r: Row, body: ParentNode, mask: Mask) => {
    if (mask.say(r.id)) body.querySelectorAll<HTMLElement>('.sim02-say').forEach(p => {
      p.classList.add('is-held')
      p.innerHTML = `${held(mask.next)}<span class="sim02-say-real" aria-hidden="true">${p.innerHTML}</span>`
    })
  }
  /**
   * Learning the floors as the curve runs still lets a line rewrap once, the first time its numbers get longer
   * (often right after a new circuit or a part selection). So when the shape changes, each capacitor row is built
   * at points along the whole curve (t = 0 to 6τ) and every distinct line is measured once, in one layout, so each
   * line starts at the tallest height it will reach. The caller paints the real numbers right after.
   */
  const presample = (c: Ctx, mask: Mask) => {
    const rc = c.rc
    floors = new Map()
    if (!c.b.cap || !rc || noCurve(c) || el.clientWidth === 0) return
    const shownRows = ROWS.filter(r => r.mode !== 'dc')
    // per row, per line: the distinct lines met along the curve. Every digit is the same width (tabular figures),
    // so two lines that differ only in their digits lay out the same and are measured once.
    const lines = new Map<string, Map<string, Element>[]>(shownRows.map(r => [r.id, []]))
    const parse = document.createElement('template')
    for (const f of SAMPLES) {
      const t = f * rc.tau
      const capV = f >= 6 ? rc.Voc : relaxVoltage(rc.V0, rc.Voc, rc.tau, t)
      const b = solveBoard({ emf: c.b.emf, r: c.b.r, slots: c.slots, capV, batteryIn: !c.b.batteryOut })
      if (!b.cap) return
      const at: Ctx = { ...c, b, rc: { ...rc, t } }
      for (const r of shownRows) {
        parse.innerHTML = r.html(at)
        holdSay(r, parse.content, mask)
        const byLine = lines.get(r.id)!
        ;[...parse.content.children].forEach((line, k) => {
          const sig = line.outerHTML.replace(/data-v="[^"]*"|v=[^,}]*/g, '').replace(/\d/g, '0')
          const seen = (byLine[k] ??= new Map())
          if (!seen.has(sig)) seen.set(sig, line)
        })
      }
    }
    // all writes, then all reads: one layout for every line
    const probes: { id: string; k: number; line: Element }[] = []
    for (const r of shownRows) {
      const row = rows.get(r.id)!
      row.el.hidden = false
      row.body.replaceChildren()
      lines.get(r.id)!.forEach((seen, k) => seen.forEach(line => { row.body.append(line); probes.push({ id: r.id, k, line }) }))
    }
    const hs = probes.map(p => p.line.getBoundingClientRect().height)
    probes.forEach((p, j) => {
      const fl = floors.get(p.id) ?? []
      fl[p.k] = Math.max(fl[p.k] ?? 0, hs[j]!)
      floors.set(p.id, fl)
    })
    for (const [id, fl] of floors) if (!fl.some(h => h > 0)) floors.delete(id)
  }

  // the hit pad sits on the outer .sim02-sym, the slot id on the span inside it
  const symOf = (t: EventTarget | null) => {
    const e = t as HTMLElement | null
    return e?.closest?.<HTMLElement>('[data-sym]') ?? e?.closest?.<HTMLElement>('.sim02-sym')?.querySelector<HTMLElement>('[data-sym]') ?? null
  }
  // a mouse points (hover); a finger taps a symbol to light its part, and the next tap anywhere turns it off
  const onOver = (e: PointerEvent) => { if (e.pointerType !== 'mouse') return; const s = symOf(e.target); onSymbol(s ? (s.dataset.sym as SlotId) : null) }
  const onOut = (e: PointerEvent) => { if (e.pointerType === 'mouse' && symOf(e.target)) onSymbol(null) }
  let tapped: SlotId | null = null
  const onTapDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !tapped) return
    if (el.contains(e.target as Node) && symOf(e.target)) return
    tapped = null
    onSymbol(null)
  }
  const onTapUp = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return
    const s = symOf(e.target)
    if (!s) return
    const id = s.dataset.sym as SlotId
    tapped = tapped === id ? null : id
    onSymbol(tapped)
  }
  el.addEventListener('pointerover', onOver)
  el.addEventListener('pointerout', onOut)
  el.addEventListener('pointerup', onTapUp)
  document.addEventListener('pointerdown', onTapDown, { capture: true, passive: true })

  const paintLinked = () => {
    el.querySelectorAll<HTMLElement>('[data-sym]').forEach(s => s.closest('.sim02-sym')?.classList.toggle('is-linked', s.dataset.sym === linked))
  }
  const track = (a: { stop(): void; then(f: () => void): unknown }) => { running.add(a); a.then(() => running.delete(a)) }

  const api: Panel = {
    el,
    update(c, opts, mask = FREE) {
      el.classList.toggle('is-preview', opts.preview)
      const checks = new Map<string, Check>(c.b.checks.map(k => [k.id, k]))
      const next = new Map<string, number>()
      last = { c, opts, mask }
      const key = shapeKey(c, el.clientWidth)
      const reshaped = key !== shape
      shape = key
      if (reshaped) {
        floors.clear()
        clearTimeout(presampleTimer)
        const now = performance.now()
        const calm = now - reshapedAt > PRESAMPLE_CALM
        reshapedAt = now
        if (c.b.cap && c.rc) {
          if (calm) presample(c, mask)
          else presampleTimer = window.setTimeout(() => {
            if (!last || shapeKey(last.c, el.clientWidth) !== shape) return
            presample(last.c, last.mask)
            api.update(last.c, { ...last.opts, animate: false }, last.mask)
          }, PRESAMPLE_CALM)
        }
      }
      const painted: { r: Row; row: { el: HTMLElement; body: HTMLElement } }[] = []
      for (const r of ROWS) {
        const row = rows.get(r.id)!
        const shown = r.mode === 'both' || (r.mode === 'rc') === !!c.b.cap
        row.el.hidden = !shown
        if (!shown || !c.b.cap) floors.delete(r.id)
        if (!shown) continue
        if (r.id === 'part') {
          const id = partFor(c.slots, c.selected)
          const kind = id ? c.slots[id]?.kind : undefined
          row.head.innerHTML = !id ? 'Voltage and power of one resistor' : kind === 'capacitor' ? 'Charge on the capacitor' : kind === 'wire' ? `Wire in ${SUB[id]}` : `Voltage and power of ${SUB[id]}`
        }
        row.body.innerHTML = r.html(c)
        holdSay(r, row.body, mask)
        const chk = r.check ? checks.get(r.check) : undefined
        row.mark.className = `sim02-check${chk ? (chk.ok ? ' is-ok' : ' is-bad') : ''}`
        // the full solve's own number, unless a prediction covers that quantity
        const solved = chk?.solved && Number.isFinite(chk.solved.v) && mask.get([chk.solved.key], 'eq') !== 'hide' ? ` (${sig3(chk.solved.v)} ${chk.solved.unit})` : ''
        row.mark.innerHTML = chk
          ? `<span aria-hidden="true">${chk.ok ? '✓' : '✕'}</span> ${chk.ok ? 'Matches the board' : 'Doesn\'t match the board'}${solved}`
          : ''
        row.mark.title = chk ? (chk.ok ? 'This equation gives the same number as the board.' : 'This equation gives a different number from the board.') : ''
        const fl = floors.get(r.id)
        if (fl) [...row.body.children].forEach((line, k) => { if (fl[k]) (line as HTMLElement).style.minHeight = `${fl[k]}px` })
        painted.push({ r, row })
      }
      // measure with the final numbers (before any count-up rewrites them), all reads after all writes
      if (c.b.cap) {
        const hs = painted.map(p => [...p.row.body.children].map(line => line.getBoundingClientRect().height))
        painted.forEach((p, k) => { if (hs[k]!.some(h => h > 0)) floors.set(p.r.id, hs[k]!) })
      }
      const nowCovered = new Set<string>()
      for (const { r, row } of painted) {
        row.body.querySelectorAll<HTMLElement>('[data-k]').forEach(span => {
          const k = span.dataset.k!
          const v = Number(span.dataset.v)
          const target = span.querySelector<HTMLElement>('.sim02-num') ?? span
          const q = qKey(k)
          if (q && mask.get([q], 'eq') === 'hide') {
            target.textContent = '?'
            target.classList.add('is-q')
            // KaTeX's MathML copy (what screen readers read) still holds the number: say the line is hidden instead
            const ml = span.closest('.katex')?.querySelector('.katex-mathml')
            if (ml) ml.textContent = `This line is hidden until ${mask.next ? 'your next prediction' : 'you pick a prediction'}.`
            nowCovered.add(k)
            return
          }
          next.set(k, v)
          const delay = r.rank * 0.07
          const f = span.dataset.f!
          // a cover lifted: count up from 0 (with reduced motion the number is simply there)
          if (covered.has(k) && f !== 'exact' && Number.isFinite(v) && !reduce()) {
            target.textContent = fmtNum(0, f)
            track(animate(0, v, { duration: 0.65, delay, ease: [0.22, 1, 0.36, 1], onUpdate: x => { target.textContent = fmtNum(x, f) }, onComplete: () => { target.textContent = fmtNum(v, f) } }))
            return
          }
          const old = prev.get(k)
          if (!opts.animate || old === undefined || old === v) return
          // a dialed value (exact) snaps and flashes; only computed values count to their new value
          if (f !== 'exact' && Number.isFinite(old) && Number.isFinite(v)) {
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
      covered = nowCovered
      paintLinked()
    },
    setLinked(id) {
      linked = id
      paintLinked()
    },
    dispose() {
      clearTimeout(presampleTimer)
      last = null
      for (const a of running) a.stop()
      el.removeEventListener('pointerover', onOver)
      el.removeEventListener('pointerout', onOut)
      el.removeEventListener('pointerup', onTapUp)
      document.removeEventListener('pointerdown', onTapDown, { capture: true })
      el.remove()
    },
  }
  return api
}
