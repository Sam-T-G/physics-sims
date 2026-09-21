import { expect } from 'vitest'
import type { Vec3 } from '@lib/physics'

/** |actual − expected| ≤ rel·|expected|. Every "relative" tolerance in the table goes through this. */
export function expectRel(actual: number, expected: number, rel: number, label = ''): void {
  const err = Math.abs(actual - expected)
  const bound = rel * Math.abs(expected)
  expect(err, `${label} |${actual} − ${expected}| = ${err} exceeds ${bound} (rel ${rel})`).toBeLessThanOrEqual(bound)
}

/** |actual − expected| ≤ abs. For "1e-12 × scale" style tolerances, pass the scaled bound as abs. */
export function expectAbs(actual: number, expected: number, abs: number, label = ''): void {
  const err = Math.abs(actual - expected)
  expect(err, `${label} |${actual} − ${expected}| = ${err} exceeds ${abs}`).toBeLessThanOrEqual(abs)
}

const norm = (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
const diff = (a: Vec3, b: Vec3): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)

/** |actual − expected| ≤ rel·|expected| on the vector norms. */
export function expectVec3Rel(actual: Vec3, expected: Vec3, rel: number, label = ''): void {
  const err = diff(actual, expected)
  const bound = rel * norm(expected)
  expect(err, `${label} |${fmt(actual)} − ${fmt(expected)}| = ${err} exceeds ${bound} (rel ${rel})`).toBeLessThanOrEqual(bound)
}

/** |actual − expected| ≤ abs on the vector norm. */
export function expectVec3Abs(actual: Vec3, expected: Vec3, abs: number, label = ''): void {
  const err = diff(actual, expected)
  expect(err, `${label} |${fmt(actual)} − ${fmt(expected)}| = ${err} exceeds ${abs}`).toBeLessThanOrEqual(abs)
}

const fmt = (v: Vec3): string => `(${v.x}, ${v.y}, ${v.z})`
