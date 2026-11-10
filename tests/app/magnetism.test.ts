import { describe, it, expect } from 'vitest'
import { PRESETS, STOPS, measure, pairSum, wireRadius, type Board } from '../../apps/03-magnetism/src/board'
import { si, amps, texSci, direction } from '../../apps/03-magnetism/src/format'
import { MU_0 } from '@lib/physics'

const preset = (id: string) => PRESETS.find(p => p.id === id)!
const rows = (id: string) => { const p = preset(id); const m = measure(p.board); return p.book!.map(r => [r.label, r.book, r.sim(p.board, m)]) }

describe('formatting', () => {
  it('si picks the prefix that prints 1 to 999', () => {
    expect(si(8.4853e-5, 'T')).toBe('84.9 μT')
    expect(si(1e-10, 'N/m')).toBe('100 pN/m')
    expect(si(2e-4, 'N/m')).toBe('200 μN/m')
    expect(si(9.9996e-4, 'T')).toBe('1.00 mT')
    expect(si(-1.2566e-5, 'T·m')).toBe('−12.6 μT·m')
    expect(si(0, 'T')).toBe('0 T')
  })
  it('amps prints dialed currents exactly', () => {
    expect(STOPS.map(amps)).toEqual(['0 A', '1 mA', '2 mA', '5 mA', '10 mA', '20 mA', '50 mA', '0.1 A', '0.2 A', '0.5 A', '1 A', '2 A', '5 A', '10 A', '20 A'])
    expect(amps(-2)).toBe('2 A')
  })
  it('texSci writes book-style scientific notation', () => {
    expect(texSci(8.4853e-5)).toBe('8.49 \\times 10^{-5}')
    expect(texSci(9.9996e-5)).toBe('1.00 \\times 10^{-4}')
    expect(texSci(0.0141)).toBe('0.0141')
    expect(texSci(-6e-5)).toBe('-6.00 \\times 10^{-5}')
  })
  it('direction prints like the book', () => expect(direction(-0.8, 0.6)).toBe('−0.80 î + 0.60 ĵ'))
})

describe('book examples on the board', () => {
  it('Example 12.3: 40.0 μT, 28.3 μT, 84.9 μT against the printed 4, 3, 8 × 10⁻⁵ T', () => {
    expect(rows('ex12.3').map(r => r[2])).toEqual(['40.0 μT', '28.3 μT', '84.9 μT'])
  })
  it('Example 12.4: 5 cm, 100 pN/m, −0.8 î + 0.6 ĵ', () => {
    expect(rows('ex12.4').map(r => r[2])).toEqual(['5 cm', '100 pN/m', '−0.80 î + 0.60 ĵ'])
  })
  it('every preset keeps its wires, probe and loop on the board, the probe outside every wire and no wire cut by the loop', () => {
    for (const p of PRESETS) {
      const { view, wires, probe, loop } = p.board, a = wireRadius(view)
      const inView = (x: number, y: number) => Math.abs(x - view.cx) < view.w / 2 && Math.abs(y - view.cy) < view.w * 0.35
      for (const w of wires) expect(inView(w.x, w.y), `${p.id} wire`).toBe(true)
      expect(inView(probe.x, probe.y), `${p.id} probe`).toBe(true)
      expect(inView(loop.x, loop.y), `${p.id} loop`).toBe(true)
      const m = measure(p.board)
      expect(m.cut, `${p.id} cut`).toEqual([])
      expect(m.ampereOk, `${p.id} ampere`).toBe(true)
      for (const w of wires) expect(Math.hypot(w.x - probe.x, w.y - probe.y), `${p.id} probe in a wire`).toBeGreaterThan(a)
    }
  })
})

describe('board checks', () => {
  it('the pair-by-pair force sum equals I × B on random boards, and the field-line slope equals B', () => {
    let seed = 3
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let t = 0; t < 200; t++) {
      const board: Board = {
        view: { cx: 0, cy: 0, w: 0.4 },
        wires: Array.from({ length: 2 + Math.floor(rnd() * 5) }, () => ({ x: rnd() * 0.36 - 0.18, y: rnd() * 0.24 - 0.12, I: STOPS[Math.floor(rnd() * STOPS.length)]! * (rnd() < 0.5 ? -1 : 1) })),
        probe: { x: rnd() * 0.36 - 0.18, y: rnd() * 0.24 - 0.12 },
        loop: { x: 0, y: 0, r: 0.05 },
      }
      const m = measure(board)
      // wires closer than two radii overlap, and inside a wire the pair formula no longer holds
      const a = wireRadius(board.view)
      board.wires.forEach((w, i) => {
        if (board.wires.some((o, j) => j !== i && Math.hypot(o.x - w.x, o.y - w.y) < a)) return
        const [sx, sy] = pairSum(board, i), [fx, fy] = m.forces[i]!
        const scale = Math.max(Math.hypot(fx, fy), 1e-18)
        expect(Math.abs(sx - fx) / scale).toBeLessThan(1e-9)
        expect(Math.abs(sy - fy) / scale).toBeLessThan(1e-9)
      })
      const scale = Math.max(m.Bmag, 1e-15)
      expect(Math.abs(m.Bslope[0] - m.B[0]) / scale).toBeLessThan(1e-6)
      expect(Math.abs(m.Bslope[1] - m.B[1]) / scale).toBeLessThan(1e-6)
      if (!m.cut.length) expect(m.ampereOk).toBe(true)
    }
  })
  it('μ₀ × 10 A inside reads 12.6 μT·m', () => expect(si(MU_0 * 10, 'T·m')).toBe('12.6 μT·m'))
})

describe('scale bar', () => {
  it('prints trimmed lengths', async () => {
    const { scaleLabel } = await import('../../apps/03-magnetism/src/format')
    expect([0.05, 0.01, 0.0025, 0.005].map(scaleLabel)).toEqual(['5 cm', '1 cm', '2.5 mm', '5 mm'])
  })
})
