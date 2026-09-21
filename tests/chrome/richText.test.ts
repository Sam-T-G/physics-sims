// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { plainText, setRichText } from '@lib/chrome/richText'

describe('setRichText', () => {
  it('turns _{…} into <sub> and ^{…} into <sup>, leaving the rest as text', () => {
    const el = document.createElement('p')
    setRichText(el, 'Φ_{closed} = Q_{enc} / ε₀ and 10^{9}')
    expect(el.querySelectorAll('sub').length).toBe(2)
    expect(el.querySelector('sup')?.textContent).toBe('9')
    expect(el.textContent).toBe('Φclosed = Qenc / ε₀ and 109')
  })
  it('never injects markup: angle brackets stay text', () => {
    const el = document.createElement('p')
    setRichText(el, '<img src=x onerror=alert(1)> F_{<b>net</b>}')
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('sub')?.textContent).toBe('<b>net</b>')
  })
  it('renders unbalanced braces literally and replaces old content', () => {
    const el = document.createElement('p')
    el.textContent = 'old'
    setRichText(el, 'x_{1 and y^2')
    expect(el.textContent).toBe('x_{1 and y^2')
    expect(el.children.length).toBe(0)
  })
  it('plainText strips the markup for aria labels', () => {
    expect(plainText('Q_{enc} / ε₀')).toBe('Qenc / ε₀')
  })
})
