/**
 * Sets el's text, turning `_{…}` into a subscript and `^{…}` into a superscript. Built from DOM nodes,
 * never innerHTML, so content strings can never inject markup. Plain strings render unchanged.
 */
export function setRichText(el: Element, text: string): void {
  const doc = el.ownerDocument
  el.replaceChildren()
  const re = /([_^])\{([^}]*)\}/g
  let last = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) el.appendChild(doc.createTextNode(text.slice(last, m.index)))
    const tag = doc.createElement(m[1] === '_' ? 'sub' : 'sup')
    tag.textContent = m[2] ?? ''
    el.appendChild(tag)
    last = m.index + m[0].length
  }
  if (last < text.length) el.appendChild(doc.createTextNode(text.slice(last)))
}

/** The same text with the markup stripped, for aria-labels and anywhere only plain text fits. */
export const plainText = (text: string): string => text.replace(/[_^]\{([^}]*)\}/g, '$1')
