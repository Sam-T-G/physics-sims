/**
 * DC circuits (OpenStax University Physics Vol 2, Ch 9–10). Pure TypeScript, layer 1.
 *
 * The solver is nodal analysis: Kirchhoff's junction rule (Eq 10.4) written at every node, each
 * resistor's current from Ohm's law (Eq 9.11), ideal emf sources added as extra unknowns (modified
 * nodal analysis). The loop rule (Eq 10.5) and the series/parallel results (Eq 10.2, 10.3) are not
 * put in; they come out of the solve, which is what the sim's book check shows.
 */

/** A resistor between nodes a and b. Current is positive from a to b: I = (V_a − V_b)/R. */
export type ResistorElement = { kind: 'resistor'; a: number; b: number; R: number }
/** An ideal emf from a (−) to b (+): V_b − V_a = emf. Current is positive leaving at b. */
export type SourceElement = { kind: 'source'; a: number; b: number; emf: number }
export type CircuitElement = ResistorElement | SourceElement

export type CircuitSolution =
  | { ok: true; V: Float64Array; I: Float64Array }
  | { ok: false; reason: 'singular' }

/**
 * A piece of the circuit with no connection to ground (a part cut off by two empty slots, a node with
 * nothing attached) has a floating potential, which makes the system singular. One node of each such
 * piece is tied to ground through this conductance. No current can flow through the tie, because
 * nothing closes a loop through it, so it fixes the island's potential and changes no current.
 */
export const ISLAND_TIE = 1

/** Solve for every node potential (V) and every element current (I, same order as elements). */
export function solveCircuit(nodeCount: number, elements: readonly CircuitElement[], ground = 0): CircuitSolution {
  // Unknowns: the potential of every node except ground, then one current per ideal source.
  const nodeIndex = (n: number): number => (n === ground ? -1 : n < ground ? n : n - 1)
  const nv = nodeCount - 1
  const sources: number[] = []
  elements.forEach((el, k) => { if (el.kind === 'source') sources.push(k) })
  const size = nv + sources.length
  const A = new Float64Array(size * size)
  const z = new Float64Array(size)
  const add = (r: number, c: number, v: number) => { if (r >= 0 && c >= 0) A[r * size + c]! += v }

  for (const n of islandRoots(nodeCount, elements, ground)) add(nodeIndex(n), nodeIndex(n), ISLAND_TIE)
  for (const el of elements) {
    if (el.kind !== 'resistor') continue
    const g = 1 / el.R
    const a = nodeIndex(el.a)
    const b = nodeIndex(el.b)
    // Junction rule at a and b with I = (V_a − V_b)/R leaving a and entering b.
    add(a, a, g); add(b, b, g); add(a, b, -g); add(b, a, -g)
  }
  sources.forEach((k, j) => {
    const el = elements[k] as SourceElement
    const row = nv + j
    const a = nodeIndex(el.a)
    const b = nodeIndex(el.b)
    // The source current leaves node a and enters node b.
    add(a, row, 1); add(b, row, -1)
    // V_b − V_a = emf
    add(row, b, 1); add(row, a, -1)
    z[row] = el.emf
  })

  // With every island tied down, the only way left to be singular is a closed loop made of ideal emfs
  // alone (their currents are then undetermined). Checked by structure, not by pivot size: wires modeled
  // as 1 µΩ put 10⁶ S in the same matrix as 1 S ties, so a pivot threshold would misjudge.
  if (hasSourceLoop(nodeCount, elements)) return { ok: false, reason: 'singular' }
  const x = gaussSolve(A, z, size)
  if (!x) return { ok: false, reason: 'singular' }

  const V = new Float64Array(nodeCount)
  for (let n = 0; n < nodeCount; n++) { const i = nodeIndex(n); V[n] = i < 0 ? 0 : x[i]! }
  const I = new Float64Array(elements.length)
  let j = 0
  elements.forEach((el, k) => {
    I[k] = el.kind === 'resistor' ? (V[el.a]! - V[el.b]!) / el.R : x[nv + j++]!
  })
  return { ok: true, V, I }
}

/** One node from every connected piece that does not contain ground. */
function islandRoots(nodeCount: number, elements: readonly CircuitElement[], ground: number): number[] {
  const parent = Array.from({ length: nodeCount }, (_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!; return i }
  for (const el of elements) parent[find(el.a)] = find(el.b)
  const g = find(ground)
  const roots = new Set<number>()
  for (let n = 0; n < nodeCount; n++) { const r = find(n); if (r !== g) roots.add(r) }
  return [...roots]
}

function hasSourceLoop(nodeCount: number, elements: readonly CircuitElement[]): boolean {
  const parent = Array.from({ length: nodeCount }, (_, i) => i)
  const find = (i: number): number => { while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!; return i }
  for (const el of elements) {
    if (el.kind !== 'source') continue
    const a = find(el.a)
    const b = find(el.b)
    if (a === b) return true
    parent[a] = b
  }
  return false
}

/** Gaussian elimination with partial pivoting. Returns null only on a zero or non-finite pivot. */
function gaussSolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = Float64Array.from(A)
  const x = Float64Array.from(b)
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r * n + c]!) > Math.abs(M[p * n + c]!)) p = r
    const pv = M[p * n + c]!
    if (pv === 0 || !Number.isFinite(pv)) return null
    if (p !== c) {
      for (let k = 0; k < n; k++) { const t = M[c * n + k]!; M[c * n + k] = M[p * n + k]!; M[p * n + k] = t }
      const t = x[c]!; x[c] = x[p]!; x[p] = t
    }
    const piv = M[c * n + c]!
    for (let r = c + 1; r < n; r++) {
      const f = M[r * n + c]! / piv
      if (f === 0) continue
      for (let k = c; k < n; k++) M[r * n + k]! -= f * M[c * n + k]!
      x[r]! -= f * x[c]!
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r]!
    for (let k = r + 1; k < n; k++) s -= M[r * n + k]! * x[k]!
    x[r] = s / M[r * n + r]!
  }
  return x
}

/** Eq 10.2: R_S = R₁ + R₂ + … An empty list is a broken path, so it returns Infinity. */
export function seriesResistance(rs: readonly number[]): number {
  if (rs.length === 0) return Infinity
  return rs.reduce((s, r) => s + r, 0)
}

/** Eq 10.3: R_P = (1/R₁ + 1/R₂ + …)⁻¹. No branches is Infinity; a 0 Ω branch makes it 0. */
export function parallelResistance(rs: readonly number[]): number {
  if (rs.length === 0) return Infinity
  if (rs.some(r => r === 0)) return 0
  return 1 / rs.reduce((s, r) => s + 1 / r, 0)
}

/** 10.1: I = ε/(R + r). Infinity for a dead short on an ideal battery (R + r = 0). */
export function batteryCurrent(emf: number, load: number, r: number): number {
  const total = load + r
  if (total === Infinity) return 0
  if (total === 0) return Infinity
  return emf / total
}

/** Eq 10.1: V_terminal = ε − Ir. */
export function terminalVoltage(emf: number, current: number, r: number): number {
  return emf - current * r
}
