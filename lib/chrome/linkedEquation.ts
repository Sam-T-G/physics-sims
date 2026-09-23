/**
 * An on-screen equation whose terms are tappable. Every term has an id and maps to a scene highlight
 * through onFocus; hover on desktop, tap on phone. A one-line tip shows under the equation for the
 * active term. Term text can be updated live (numbers).
 */
import { setRichText } from './richText'

export type EqTerm = { id: string; text: string; tip?: string }
/** Terms and operators kept on one line, e.g. the two charges between absolute-value bars. */
export type EqGroup = { group: readonly EqPart[] }
export type EqPart = EqTerm | string | EqGroup

export type LinkedEquation = {
  el: HTMLElement
  setTerm(id: string, text: string): void
  /** Programmatic focus, e.g. from a scene tap. null clears. */
  focus(id: string | null): void
}

export function createLinkedEquation(o: { doc: Document; prefix: string; label?: string; parts: readonly EqPart[]; onFocus: (id: string | null) => void }): LinkedEquation {
  const { doc, prefix: p } = o
  const root = doc.createElement('div')
  root.className = `${p}-eq`
  const line = doc.createElement('div')
  line.className = `${p}-eq-line`
  line.setAttribute('role', 'group')
  if (o.label) line.setAttribute('aria-label', o.label)
  const tip = doc.createElement('p')
  tip.className = `${p}-eq-tip`
  tip.hidden = true
  const terms = new Map<string, { b: HTMLButtonElement; tip?: string; last?: string }>()
  let active: string | null = null
  let pinned: string | null = null

  const setActive = (id: string | null) => {
    active = id
    for (const [k, t] of terms) t.b.setAttribute('aria-pressed', String(k === id))
    const t = id ? terms.get(id) : undefined
    tip.hidden = !t?.tip
    setRichText(tip, t?.tip ?? '')
    o.onFocus(id)
  }

  const add = (parent: HTMLElement, part: EqPart) => {
    if (typeof part === 'string') {
      const span = doc.createElement('span')
      span.className = `${p}-eq-op`
      setRichText(span, part)
      parent.appendChild(span)
      return
    }
    if ('group' in part) {
      const g = doc.createElement('span')
      g.className = `${p}-eq-group`
      for (const inner of part.group) add(g, inner)
      parent.appendChild(g)
      return
    }
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = `${p}-eq-term`
    setRichText(b, part.text)
    b.setAttribute('aria-pressed', 'false')
    // Click (or tap) pins a term and a second click unpins it. On a mouse, hover previews a term while
    // nothing is pinned. Without the pin, a click would toggle off the term the hover had just turned on.
    b.addEventListener('click', () => {
      pinned = pinned === part.id ? null : part.id
      setActive(pinned)
    })
    b.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse' && pinned === null) setActive(part.id)
    })
    b.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && pinned === null && active === part.id) setActive(null)
    })
    terms.set(part.id, { b, tip: part.tip })
    parent.appendChild(b)
  }
  // An operator sticks to the term after it, so a wrapped equation breaks only before an operator
  // ("= 8.99 × 10⁹" / "× |q₁ × q₂|" / "÷ r²"), the way a textbook continues a line.
  const parts = o.parts
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    const following = parts[i + 1]
    if (typeof part === 'string' && following !== undefined && typeof following !== 'string') {
      add(line, { group: [part, following] })
      i++
    } else add(line, part)
  }
  root.append(line, tip)
  return {
    el: root,
    setTerm(id, text) {
      const t = terms.get(id)
      if (t && t.last !== text) {
        setRichText(t.b, text)
        t.last = text
      }
    },
    focus(id) {
      pinned = id
      setActive(id)
    },
  }
}
