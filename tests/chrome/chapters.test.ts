// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createChapters } from '@lib/chrome/chapters'

const beats = [
  { id: 'a', content: { label: '0', title: 'One', anchor: 'A 1', body: 'First body.' } },
  { id: 'b', content: { label: '1', title: 'Two', anchor: 'A 2', prompt: 'Look.', body: 'Second body.' } },
]

function make() {
  const root = document.createElement('main')
  document.body.appendChild(root)
  const ch = createChapters({ root, prefix: 't', beats, reduced: () => true })
  ch.goTo(0, { cut: true })
  const grab = root.querySelector('.t-grab') as HTMLButtonElement
  const card = root.querySelector('.t-card') as HTMLElement
  const pointer = (type: string, y: number) => grab.dispatchEvent(new PointerEvent(type, { pointerId: 1, clientY: y, bubbles: true }))
  return { root, ch, grab, card, pointer }
}

describe('the sheet handle', () => {
  it('a tap toggles the tall state and the accessible label follows', () => {
    const { grab, card } = make()
    grab.click()
    expect(card.classList.contains('t-card-tall')).toBe(true)
    expect(grab.getAttribute('aria-expanded')).toBe('true')
    grab.click()
    expect(card.classList.contains('t-card-tall')).toBe(false)
  })
  it('a drag up snaps tall, swallows only the click of that same gesture, and the next tap still works', async () => {
    const { grab, card, pointer } = make()
    pointer('pointerdown', 300)
    pointer('pointermove', 280)
    pointer('pointermove', 200)
    pointer('pointerup', 200)
    expect(card.classList.contains('t-card-tall')).toBe(true)
    grab.click() // the click browsers send after a mouse drag: swallowed
    expect(card.classList.contains('t-card-tall')).toBe(true)
    await new Promise(r => setTimeout(r, 0)) // touch drags send no click; the flag must not linger
    grab.click()
    expect(card.classList.contains('t-card-tall')).toBe(false)
  })
  it('a cancelled drag decides nothing and clears its inline height', () => {
    const { card, pointer } = make()
    pointer('pointerdown', 300)
    pointer('pointermove', 100)
    expect(card.style.maxHeight).not.toBe('')
    pointer('pointercancel', 0)
    expect(card.style.maxHeight).toBe('')
    expect(card.classList.contains('t-card-tall')).toBe(false)
  })
})

describe('chapter text and the locked Next', () => {
  it('writes the anchor inline after the body and keeps it across chapters', () => {
    const { root, ch } = make()
    const body = root.querySelector('.t-body')!
    expect(body.textContent).toBe('First body. A 1')
    ch.goTo(1, { cut: true })
    expect(body.textContent).toBe('Second body. A 2')
    expect(root.querySelector('.t-prompt')!.textContent).toBe('Look.')
  })
  it('a locked Next stays focusable, says why in a live region, and unlocking clears the hint', () => {
    const { root, ch } = make()
    const next = root.querySelector('.t-next') as HTMLButtonElement
    const hint = root.querySelector('.t-nav-hint')!
    ch.lockNext(true)
    expect(next.disabled).toBe(false)
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect(hint.getAttribute('role')).toBe('status')
    expect(hint.textContent).toBe('')
    next.click()
    expect(ch.index()).toBe(0)
    expect(hint.textContent).toBe('Answer the question first.')
    ch.lockNext(false)
    expect(hint.textContent).toBe('')
    next.click()
    expect(ch.index()).toBe(1)
  })
})
