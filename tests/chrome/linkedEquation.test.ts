// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createLinkedEquation } from '@lib/chrome/linkedEquation'

function make() {
  const calls: (string | null)[] = []
  const eq = createLinkedEquation({
    doc: document,
    prefix: 't',
    parts: [{ id: 'a', text: 'A', tip: 'tip a' }, ' + ', { id: 'b', text: 'B' }],
    onFocus: id => calls.push(id),
  })
  document.body.appendChild(eq.el)
  const [a, b] = [...eq.el.querySelectorAll('button')] as HTMLButtonElement[]
  const hover = (el: Element, type: 'pointerenter' | 'pointerleave') => el.dispatchEvent(new PointerEvent(type, { pointerType: 'mouse' }))
  return { eq, a: a!, b: b!, calls, hover }
}

describe('linked equation terms', () => {
  it('a mouse hover then a click pins the term instead of toggling it back off', () => {
    const { a, calls, hover } = make()
    hover(a, 'pointerenter')
    a.click()
    hover(a, 'pointerleave')
    expect(calls.at(-1)).toBe('a')
    expect(a.getAttribute('aria-pressed')).toBe('true')
  })
  it('a second click unpins, and hover previews only while nothing is pinned', () => {
    const { a, b, calls, hover } = make()
    a.click()
    hover(b, 'pointerenter')
    expect(calls.at(-1)).toBe('a') // b's hover is ignored while a is pinned
    a.click()
    expect(calls.at(-1)).toBeNull()
    hover(b, 'pointerenter')
    expect(calls.at(-1)).toBe('b')
    hover(b, 'pointerleave')
    expect(calls.at(-1)).toBeNull()
  })
  it('a tap (no hover) pins, and focus(null) from code clears the pin', () => {
    const { eq, b, calls } = make()
    b.click()
    expect(calls.at(-1)).toBe('b')
    eq.focus(null)
    expect(calls.at(-1)).toBeNull()
    expect(b.getAttribute('aria-pressed')).toBe('false')
  })
})

describe('linked equation wrapping', () => {
  it('glues each operator to the term after it, and keeps explicit groups whole', () => {
    const eq = createLinkedEquation({
      doc: document,
      prefix: 't',
      parts: [{ id: 'F', text: 'F' }, ' = ', { id: 'k', text: 'k' }, ' × ', { group: ['|', { id: 'a', text: 'a' }, ' × ', { id: 'b', text: 'b' }, '|'] }, ' ÷ ', { id: 'r', text: 'r²' }],
      onFocus: () => {},
    })
    const line = eq.el.querySelector('.t-eq-line')!
    expect(line.getAttribute('role')).toBe('group')
    // Top level: F, (= k), (× |a × b|), (÷ r²)
    const top = [...line.children]
    expect(top.map(c => c.className)).toEqual(['t-eq-term', 't-eq-group', 't-eq-group', 't-eq-group'])
    expect(top[1]!.textContent).toBe(' = k')
    expect(top[2]!.querySelectorAll('.t-eq-group').length).toBe(1) // the explicit |a × b| group, nested
    expect(top[2]!.textContent).toBe(' × |a × b|')
    expect(top[3]!.textContent).toBe(' ÷ r²')
  })
})
