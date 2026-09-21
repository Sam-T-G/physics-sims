import { gsap } from 'gsap'
import type { ToolItem } from './types'
import { setRichText } from './richText'

export type ToolBeltOptions = {
  /** Where the strip is placed (the card's belt slot). */
  slot: HTMLElement
  prefix: string
  tools: readonly ToolItem[]
  onJump: (beat: number) => void
  /** Chapter label for a beat index (e.g. 4 → "3b"). Defaults to the index. */
  labelOf?: (beat: number) => string
  reduced: () => boolean
}

export type ToolBelt = {
  earn(id: string): void
  has(id: string): boolean
  /** Close the open detail, if any. */
  collapse(): void
  destroy(): void
}

/**
 * A persistent strip. Items appear the moment they are earned. Tap one to see its equation and jump to
 * the beat that introduced it. Built once in lib/chrome and reused by every later sim.
 */
export function createToolBelt(opts: ToolBeltOptions): ToolBelt {
  const { slot, prefix: p, tools, reduced } = opts
  const doc = slot.ownerDocument
  const strip = doc.createElement('div')
  strip.className = `${p}-belt`
  strip.setAttribute('role', 'group')
  strip.setAttribute('aria-label', 'Tool belt')
  const row = doc.createElement('div')
  row.className = `${p}-belt-row`
  const detail = doc.createElement('div')
  detail.className = `${p}-belt-detail`
  detail.hidden = true
  const detailName = doc.createElement('span')
  detailName.className = `${p}-belt-detail-name`
  const detailEq = doc.createElement('span')
  detailEq.className = `${p}-belt-detail-eq`
  const detailNote = doc.createElement('span')
  detailNote.className = `${p}-belt-detail-note`
  const jump = doc.createElement('button')
  jump.type = 'button'
  jump.className = `${p}-belt-jump`
  detail.append(detailName, detailEq, detailNote, jump)
  strip.append(row, detail)
  slot.appendChild(strip)

  const earned = new Set<string>()
  const chips = new Map<string, HTMLButtonElement>()
  let open: string | null = null

  const collapse = () => {
    open = null
    detail.hidden = true
    for (const c of chips.values()) c.setAttribute('aria-expanded', 'false')
  }
  const show = (tool: ToolItem) => {
    open = tool.id
    detailName.textContent = tool.name
    setRichText(detailEq, tool.equation)
    setRichText(detailNote, tool.note ?? '')
    detailNote.hidden = !tool.note
    jump.textContent = `Go to chapter ${opts.labelOf ? opts.labelOf(tool.beat) : String(tool.beat)}`
    jump.onclick = () => {
      collapse()
      opts.onJump(tool.beat)
    }
    detail.hidden = false
    for (const [id, c] of chips) c.setAttribute('aria-expanded', String(id === tool.id))
  }

  for (const tool of tools) {
    const chip = doc.createElement('button')
    chip.type = 'button'
    chip.className = `${p}-chip`
    chip.textContent = tool.name
    chip.hidden = true
    chip.setAttribute('aria-expanded', 'false')
    chip.addEventListener('click', () => (open === tool.id ? collapse() : show(tool)))
    row.appendChild(chip)
    chips.set(tool.id, chip)
  }

  return {
    earn(id) {
      if (earned.has(id)) return
      const chip = chips.get(id)
      if (!chip) return
      earned.add(id)
      chip.hidden = false
      if (!reduced()) gsap.from(chip, { scale: 0.6, opacity: 0, duration: 0.35, ease: 'back.out(2)' })
    },
    has: id => earned.has(id),
    collapse,
    destroy() {
      gsap.killTweensOf([...chips.values()])
      strip.remove()
    },
  }
}
