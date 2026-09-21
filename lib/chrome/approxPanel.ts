/**
 * The explain-the-approximation panel: always reachable, lists what the sim approximates and the numbers it
 * uses. The sim says what it is approximating instead of hiding it.
 */
import { setRichText } from './richText'

export type ApproxItem = { id: string; label: string; value: string; note?: string }

export type ApproxPanel = { el: HTMLElement; set(id: string, value: string): void }

export function createApproxPanel(o: { doc: Document; prefix: string; title: string; items: readonly ApproxItem[] }): ApproxPanel {
  const { doc, prefix: p } = o
  const details = doc.createElement('details')
  details.className = `${p}-approx`
  const summary = doc.createElement('summary')
  summary.className = `${p}-approx-summary`
  summary.textContent = o.title
  const list = doc.createElement('dl')
  list.className = `${p}-approx-list`
  const values = new Map<string, HTMLElement>()
  for (const item of o.items) {
    const dt = doc.createElement('dt')
    setRichText(dt, item.label)
    const dd = doc.createElement('dd')
    const v = doc.createElement('span')
    v.className = `${p}-approx-value`
    v.textContent = item.value
    dd.appendChild(v)
    if (item.note) {
      const n = doc.createElement('span')
      n.className = `${p}-approx-note`
      setRichText(n, ` ${item.note}`)
      dd.appendChild(n)
    }
    list.append(dt, dd)
    values.set(item.id, v)
  }
  details.append(summary, list)
  return {
    el: details,
    set(id, value) {
      const v = values.get(id)
      if (v && v.textContent !== value) v.textContent = value
    },
  }
}
