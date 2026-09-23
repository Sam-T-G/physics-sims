// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createCheckpoint } from '@lib/chrome/checkpoint'

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')] as HTMLButtonElement[]

describe('checkpoint states', () => {
  it('multi-select marks right, missed and wrong separately, never right and wrong together', async () => {
    const cp = createCheckpoint({ doc: document, prefix: 't' })
    document.body.appendChild(cp.el)
    const done = cp.ask({
      kind: 'multi',
      question: 'Which count?',
      options: [
        { id: 'a', label: 'A', correct: true, reason: 'yes' },
        { id: 'b', label: 'B', correct: true, reason: 'yes' },
        { id: 'c', label: 'C', correct: false, reason: 'no' },
      ],
    })
    const [a, , c, commit] = buttons(cp.el)
    a!.click() // right
    c!.click() // wrong
    commit!.click()
    expect(await done).toEqual(['a', 'c'])
    const cls = (b: HTMLButtonElement) => [...b.classList].filter(k => k.includes('opt-')).sort()
    const [ra, rb, rc] = buttons(cp.el)
    expect(cls(ra!)).toEqual(['t-check-opt-picked', 't-check-opt-right'])
    expect(cls(rb!)).toEqual(['t-check-opt-missed'])
    expect(cls(rc!)).toEqual(['t-check-opt-picked', 't-check-opt-wrong'])
  })
  it('the question labels its options as a group, and the reveal is not a live region', () => {
    const cp = createCheckpoint({ doc: document, prefix: 't' })
    void cp.ask({ kind: 'choice', question: 'Pick', options: [{ id: 'x', label: 'X' }] })
    const q = cp.el.querySelector('.t-check-q')!
    const body = cp.el.querySelector('.t-check-body')!
    expect(body.getAttribute('role')).toBe('group')
    expect(body.getAttribute('aria-labelledby')).toBe(q.id)
    expect(cp.el.querySelector('.t-check-reveal')!.hasAttribute('aria-live')).toBe(false)
  })
  it('the slider reports its formatted value to assistive tech', () => {
    const cp = createCheckpoint({ doc: document, prefix: 't' })
    void cp.ask({ kind: 'slider', question: 'How much?', min: 0, max: 1, step: 0.1, initial: 0.5, format: v => `${Math.round(v * 100)}%` })
    const input = cp.el.querySelector('input')!
    expect(input.getAttribute('aria-valuetext')).toBe('50%')
    input.value = '0.8'
    input.dispatchEvent(new Event('input'))
    expect(input.getAttribute('aria-valuetext')).toBe('80%')
  })
})
