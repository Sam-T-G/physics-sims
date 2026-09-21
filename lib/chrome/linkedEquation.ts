/**
 * An on-screen equation whose terms are tappable. Every term has an id and maps to a scene highlight
 * through onFocus; hover on desktop, tap on phone. A one-line tip shows under the equation for the
 * active term. Term text can be updated live (numbers).
 */
import { setRichText } from './richText'

export type EqTerm = { id: string; text: string; tip?: string }

export type LinkedEquation = {
  el: HTMLElement
  setTerm(id: string, text: string): void
  /** Programmatic focus, e.g. from a scene tap. null clears. */
  focus(id: string | null): void
}

export function createLinkedEquation(o: { doc: Document; prefix: string; label?: string; parts: readonly (EqTerm | string)[]; onFocus: (id: string | null) => void }): LinkedEquation {
  const { doc, prefix: p } = o
  const root = doc.createElement('div')
  root.className = `${p}-eq`
  const line = doc.createElement('p')
  line.className = `${p}-eq-line`
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

  for (const part of o.parts) {
    if (typeof part === 'string') {
      const span = doc.createElement('span')
      span.className = `${p}-eq-op`
      setRichText(span, part)
      line.appendChild(span)
      continue
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
    line.appendChild(b)
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
