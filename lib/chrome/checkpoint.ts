/**
 * Checkpoints. A predict checkpoint freezes the scene, hides the readout of the predicted quantity, takes a
 * commit (a choice or a slider), and then the reveal shows the truth and the error. An MCQ shows the reason
 * behind every option. No scores, no persistence. The caller gates Next until the promise resolves.
 */
import { plainText, setRichText } from './richText'

export type ChoiceOption = { id: string; label: string; reason?: string }

export type ChoiceSpec = {
  kind: 'choice'
  question: string
  options: readonly ChoiceOption[]
  /** Correct id. When set, wrong picks show their reason and the question stays open (an MCQ). */
  answer?: string
}

export type SliderSpec = {
  kind: 'slider'
  question: string
  min: number
  max: number
  step: number
  initial: number
  format: (v: number) => string
  commitLabel?: string
}

export type MultiOption = { id: string; label: string; correct: boolean; reason: string }

/** Pick all that apply. The reveal marks every option right or wrong with its reason. */
export type MultiSpec = {
  kind: 'multi'
  question: string
  options: readonly MultiOption[]
  commitLabel?: string
}

export type CompassDir = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' | '0'

/** Pick one of eight directions on the screen plane, or "zero" when allowed. */
export type CompassSpec = {
  kind: 'compass'
  question: string
  allowZero?: boolean
}

export type Checkpoint = {
  el: HTMLElement
  ask(spec: ChoiceSpec): Promise<string>
  ask(spec: SliderSpec): Promise<number>
  ask(spec: MultiSpec): Promise<string[]>
  ask(spec: CompassSpec): Promise<CompassDir>
  /** The reveal line under the answered question. */
  reveal(text: string, tone: 'right' | 'wrong' | 'neutral'): void
  clear(): void
}

export function createCheckpoint(o: { doc: Document; prefix: string }): Checkpoint {
  const { doc, prefix: p } = o
  const root = doc.createElement('section')
  root.className = `${p}-check`
  root.hidden = true
  const q = doc.createElement('p')
  q.className = `${p}-check-q`
  const body = doc.createElement('div')
  body.className = `${p}-check-body`
  const out = doc.createElement('p')
  out.className = `${p}-check-reveal`
  out.setAttribute('aria-live', 'polite')
  out.hidden = true
  root.append(q, body, out)

  const reset = () => {
    body.replaceChildren()
    out.hidden = true
    out.textContent = ''
    out.className = `${p}-check-reveal`
  }

  function ask(spec: ChoiceSpec): Promise<string>
  function ask(spec: SliderSpec): Promise<number>
  function ask(spec: MultiSpec): Promise<string[]>
  function ask(spec: CompassSpec): Promise<CompassDir>
  function ask(spec: ChoiceSpec | SliderSpec | MultiSpec | CompassSpec): Promise<string | number | string[] | CompassDir> {
    reset()
    root.hidden = false
    setRichText(q, spec.question)
    if (spec.kind === 'multi') {
      return new Promise<string[]>(resolve => {
        const picked = new Set<string>()
        const buttons = spec.options.map(opt => {
          const b = doc.createElement('button')
          b.type = 'button'
          b.className = `${p}-check-opt`
          setRichText(b, opt.label)
          b.setAttribute('aria-pressed', 'false')
          b.addEventListener('click', () => {
            if (picked.has(opt.id)) picked.delete(opt.id)
            else picked.add(opt.id)
            b.setAttribute('aria-pressed', String(picked.has(opt.id)))
            b.classList.toggle(`${p}-check-opt-picked`, picked.has(opt.id))
          })
          body.appendChild(b)
          return { opt, b }
        })
        const commit = doc.createElement('button')
        commit.type = 'button'
        commit.className = `${p}-check-commit`
        commit.textContent = spec.commitLabel ?? 'Lock it in'
        commit.addEventListener('click', () => {
          commit.disabled = true
          buttons.forEach(({ opt, b }) => {
            b.disabled = true
            const right = picked.has(opt.id) === opt.correct
            b.classList.toggle(`${p}-check-opt-right`, opt.correct)
            b.classList.toggle(`${p}-check-opt-wrong`, !right)
          })
          const list = doc.createElement('ul')
          list.className = `${p}-check-reasons`
          for (const opt of spec.options) {
            const li = doc.createElement('li')
            setRichText(li, `${opt.label}: ${opt.correct ? 'yes' : 'no'}, ${opt.reason}`)
            list.appendChild(li)
          }
          body.appendChild(list)
          resolve([...picked])
        })
        body.appendChild(commit)
      })
    }
    if (spec.kind === 'compass') {
      return new Promise<CompassDir>(resolve => {
        const grid = doc.createElement('div')
        grid.className = `${p}-check-compass`
        const cells: (CompassDir | null)[] = ['NW', 'N', 'NE', 'W', spec.allowZero ? '0' : null, 'E', 'SW', 'S', 'SE']
        const glyph: Record<CompassDir, string> = { N: '↑', NE: '↗', E: '→', SE: '↘', S: '↓', SW: '↙', W: '←', NW: '↖', '0': '0' }
        const name: Record<CompassDir, string> = { N: 'up', NE: 'up and right', E: 'right', SE: 'down and right', S: 'down', SW: 'down and left', W: 'left', NW: 'up and left', '0': 'zero' }
        const buttons: HTMLButtonElement[] = []
        for (const c of cells) {
          if (c === null) {
            const spacer = doc.createElement('span')
            grid.appendChild(spacer)
            continue
          }
          const b = doc.createElement('button')
          b.type = 'button'
          b.className = `${p}-check-dir`
          b.textContent = glyph[c]
          b.setAttribute('aria-label', name[c])
          b.addEventListener('click', () => {
            buttons.forEach(x => (x.disabled = true))
            b.classList.add(`${p}-check-opt-picked`)
            resolve(c)
          })
          buttons.push(b)
          grid.appendChild(b)
        }
        body.appendChild(grid)
      })
    }
    if (spec.kind === 'choice') {
      return new Promise<string>(resolve => {
        const buttons = spec.options.map(opt => {
          const b = doc.createElement('button')
          b.type = 'button'
          b.className = `${p}-check-opt`
          setRichText(b, opt.label)
          b.addEventListener('click', () => {
            if (spec.answer !== undefined && opt.id !== spec.answer) {
              b.classList.add(`${p}-check-opt-wrong`)
              b.disabled = true
              out.hidden = false
              out.className = `${p}-check-reveal ${p}-check-reveal-wrong`
              setRichText(out, opt.reason ?? 'Not that one.')
              return
            }
            buttons.forEach(x => (x.disabled = true))
            b.classList.add(`${p}-check-opt-picked`)
            resolve(opt.id)
          })
          body.appendChild(b)
          return b
        })
      })
    }
    return new Promise<number>(resolve => {
      const input = doc.createElement('input')
      input.type = 'range'
      input.className = `${p}-check-slider`
      input.min = String(spec.min)
      input.max = String(spec.max)
      input.step = String(spec.step)
      input.value = String(spec.initial)
      input.setAttribute('aria-label', plainText(spec.question))
      const val = doc.createElement('output')
      val.className = `${p}-check-value`
      val.textContent = spec.format(spec.initial)
      input.addEventListener('input', () => (val.textContent = spec.format(Number(input.value))))
      const commit = doc.createElement('button')
      commit.type = 'button'
      commit.className = `${p}-check-commit`
      commit.textContent = spec.commitLabel ?? 'Lock it in'
      commit.addEventListener('click', () => {
        input.disabled = true
        commit.disabled = true
        resolve(Number(input.value))
      })
      body.append(val, input, commit)
    })
  }

  return {
    el: root,
    ask,
    reveal(text, tone) {
      root.hidden = false
      out.hidden = false
      out.className = `${p}-check-reveal ${p}-check-reveal-${tone}`
      setRichText(out, text)
      // The pressed option just got disabled, which drops focus to the body; keep it on the answer.
      out.tabIndex = -1
      out.focus({ preventScroll: true })
    },
    clear() {
      reset()
      root.hidden = true
      q.textContent = ''
    },
  }
}
