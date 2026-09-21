/**
 * An on-screen equation whose terms are tappable. Every term has an id and maps to a scene highlight
 * through onFocus; hover on desktop, tap on phone. A one-line tip shows under the equation for the
 * active term. Term text can be updated live (numbers).
 */
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
  const terms = new Map<string, { b: HTMLButtonElement; tip?: string }>()
  let active: string | null = null

  const setActive = (id: string | null) => {
    active = id
    for (const [k, t] of terms) t.b.setAttribute('aria-pressed', String(k === id))
    const t = id ? terms.get(id) : undefined
    tip.hidden = !t?.tip
    tip.textContent = t?.tip ?? ''
    o.onFocus(id)
  }

  for (const part of o.parts) {
    if (typeof part === 'string') {
      const span = doc.createElement('span')
      span.className = `${p}-eq-op`
      span.textContent = part
      line.appendChild(span)
      continue
    }
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = `${p}-eq-term`
    b.textContent = part.text
    b.setAttribute('aria-pressed', 'false')
    b.addEventListener('click', () => setActive(active === part.id ? null : part.id))
    b.addEventListener('pointerenter', e => {
      if (e.pointerType === 'mouse') setActive(part.id)
    })
    b.addEventListener('pointerleave', e => {
      if (e.pointerType === 'mouse' && active === part.id) setActive(null)
    })
    terms.set(part.id, { b, tip: part.tip })
    line.appendChild(b)
  }
  root.append(line, tip)
  return {
    el: root,
    setTerm(id, text) {
      const t = terms.get(id)
      if (t && t.b.textContent !== text) t.b.textContent = text
    },
    focus: setActive,
  }
}
