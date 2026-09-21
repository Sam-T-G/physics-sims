/** Labeled controls with prefixed classes. Every control is a thing that can be wrong and a thing that needs a label. */

export type Slider = { el: HTMLElement; set(value: number): void; value(): number; disable(on: boolean): void }

let sliderSeq = 0

export function createSlider(o: {
  doc: Document
  prefix: string
  label: string
  min: number
  max: number
  step: number
  value: number
  /** Readout text for a value, with units. */
  format: (v: number) => string
  onInput: (v: number) => void
}): Slider {
  const { doc, prefix: p } = o
  const wrap = doc.createElement('label')
  wrap.className = `${p}-slider`
  const name = doc.createElement('span')
  name.className = `${p}-slider-label`
  name.textContent = o.label
  const out = doc.createElement('output')
  out.className = `${p}-slider-value`
  const input = doc.createElement('input')
  input.type = 'range'
  input.className = `${p}-slider-input`
  input.id = `${p}-slider-${++sliderSeq}`
  input.setAttribute('aria-label', o.label)
  wrap.htmlFor = input.id
  input.min = String(o.min)
  input.max = String(o.max)
  input.step = String(o.step)
  input.value = String(o.value)
  out.textContent = o.format(o.value)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    out.textContent = o.format(v)
    o.onInput(v)
  })
  const head = doc.createElement('span')
  head.className = `${p}-slider-head`
  head.append(name, out)
  wrap.append(head, input)
  return {
    el: wrap,
    set(v) {
      input.value = String(v)
      out.textContent = o.format(v)
    },
    value: () => Number(input.value),
    disable(on) {
      input.disabled = on
    },
  }
}

export type Segmented = { el: HTMLElement; set(id: string): void; value(): string; disable(on: boolean): void }

export function createSegmented(o: {
  doc: Document
  prefix: string
  label: string
  options: readonly { id: string; label: string; hint?: string }[]
  value: string
  onChange: (id: string) => void
}): Segmented {
  const { doc, prefix: p } = o
  const wrap = doc.createElement('div')
  wrap.className = `${p}-seg`
  wrap.setAttribute('role', 'group')
  wrap.setAttribute('aria-label', o.label)
  const name = doc.createElement('span')
  name.className = `${p}-seg-label`
  name.textContent = o.label
  const row = doc.createElement('div')
  row.className = `${p}-seg-row`
  let current = o.value
  const buttons = o.options.map(opt => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = `${p}-seg-btn`
    b.textContent = opt.label
    if (opt.hint) b.title = opt.hint
    b.setAttribute('aria-pressed', String(opt.id === current))
    b.addEventListener('click', () => {
      if (current === opt.id) return
      current = opt.id
      paint()
      o.onChange(opt.id)
    })
    row.appendChild(b)
    return { id: opt.id, b }
  })
  const paint = () => buttons.forEach(({ id, b }) => b.setAttribute('aria-pressed', String(id === current)))
  wrap.append(name, row)
  return {
    el: wrap,
    set(id) {
      current = id
      paint()
    },
    value: () => current,
    disable(on) {
      buttons.forEach(({ b }) => (b.disabled = on))
    },
  }
}

export function createButton(o: { doc: Document; prefix: string; label: string; kind?: 'primary' | 'quiet'; onClick: () => void }): HTMLButtonElement {
  const b = o.doc.createElement('button')
  b.type = 'button'
  b.className = `${o.prefix}-btn ${o.prefix}-btn-${o.kind ?? 'primary'}`
  b.textContent = o.label
  b.addEventListener('click', o.onClick)
  return b
}
