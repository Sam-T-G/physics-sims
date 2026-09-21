// Layer 1 for this app. Imports only from @lib/physics. Never from render, chrome, three, or gsap.
import {
  EPSILON_0,
  K_E,
  countSphereCrossings,
  cubeSphere,
  fluxCenteredSphere,
  fluxExact,
  halfMesh,
  makeMorphTargets,
  meshSolidAngle,
  morph,
  radialRays,
  seedLines,
  triangleSolidAngle,
  type FieldLine,
  type MorphTargets,
  type PointCharge,
  type TriMesh,
} from '@lib/physics'
import { createChargePair, type ChargePair } from './charge'
import { createCoulomb, type Coulomb } from './coulomb'
import { createBowl, createBundleLoops, createFluxLoop, type Bowl, type BundleLoops, type FluxLoop } from './flux'
import { createSymmetry, type Symmetry } from './symmetry'
import { createField, type Field } from './field'
import { createPendulum, type Pendulum } from './pendulum'

export * from './charge'
export * from './coulomb'
export * from './flux'
export * from './symmetry'
export * from './field'
export * from './pendulum'

/** Subdivision of the live Gauss surface, and the bound the renderer preallocates for. */
export const GAUSS_SUBDIVISION = 8
export const MAX_SUBDIVISION = 12
export const GAUSS_RADIUS = 1
/** Nested spheres at r, 2r, 3r, and the fourth at 4r the student predicts before it appears. */
export const BASE_R = 0.35
export const SPHERE_RADII: readonly number[] = [BASE_R, 2 * BASE_R, 3 * BASE_R, 4 * BASE_R]
/** Lines per nanocoulomb. Density tracks |E| in proportion, not to the pixel. */
export const RAYS_PER_NC = 48
export const Q = 1e-9
export const RC = 0.05
export const RAY_LENGTH = 3.2
export const CHARGE_START = { x: 0.3, y: 0.1, z: -0.2 }
export const SECOND_POS = { x: -0.35, y: -0.2, z: 0.15 }

export type Exponent = 1 | 2 | 3
export type SecondCharge = 'off' | 'plus' | 'minus'

export type Sim1Physics = {
  pendulum: Pendulum
  pair: ChargePair
  coulomb: Coulomb
  field: Field
  loop: FluxLoop
  bundle: BundleLoops
  bowl: Bowl
  symmetry: Symmetry
  /** Beat 3b (and the beat-5 callback): one charge at the origin, nested spheres, analytic radial rays. */
  spheres: {
    charge: PointCharge
    radii: readonly number[]
    fourth: boolean
    exponent: Exponent
    rays: FieldLine[]
  }
  /** Beat 5: the live surface as a bowl plus a cap that share one position buffer, the charges near it, the lines. */
  gauss: {
    mesh: TriMesh
    targets: MorphTargets
    bowl: TriMesh
    cap: TriMesh
    capOn: boolean
    charges: PointCharge[]
    morphT: number
    scale: number
    sign: 1 | -1
    second: SecondCharge
    /** Bumps whenever mesh.positions change, so the renderer refills only then. */
    version: number
    lines: FieldLine[]
    linesVersion: number
  }
  // 3b
  /** Signed crossings of every ray through each sphere, counted live. Same N on every sphere. */
  crossings(): number[]
  sphereArea(i: number): number
  /** Line density on sphere i relative to sphere 0: N_i/A_i over N_0/A_0. */
  density(i: number): number
  /** Analytic flux through sphere i for the current exponent (E ∝ 1/rⁿ): equals q/ε₀ only at n = 2. */
  sphereFlux(i: number): number
  fieldAtR(r: number): number
  setExponent(n: Exponent): void
  setFourth(on: boolean): void
  // 5
  resetGauss(): void
  setMorph(t: number): void
  setScale(s: number): void
  setChargeX(x: number): void
  setSign(sign: 1 | -1): void
  setSecond(kind: SecondCharge): void
  setCap(on: boolean): void
  /** Exact flux through the live surface (bowl, plus the cap when it is on), summed per face by solid angle. */
  flux(): number
  /** Σ q over charges the closed mesh encloses, decided by each charge's solid angle (4π inside, 0 outside). */
  enclosedCharge(): number
  /** Per-face flux over the full mesh, for the entry/exit coloring. Writes into out (length faceCount). */
  faceFlux(out: Float64Array): void
  /** Recompute the lines for the current charges: analytic rays for one charge, RK4 seeding for two. */
  retrace(): void
}

export function createSim1Physics(): Sim1Physics {
  const mesh = cubeSphere(GAUSS_SUBDIVISION, GAUSS_RADIUS)
  const targets = makeMorphTargets(mesh, 0.3)
  // The halves keep their own index but point at the live position buffer, so a morph moves them too.
  const cap = { ...halfMesh(mesh, true), positions: mesh.positions }
  const bowl = { ...halfMesh(mesh, false), positions: mesh.positions }
  const primary: PointCharge = { q: Q, pos: { ...CHARGE_START }, rc: RC }
  const gauss: Sim1Physics['gauss'] = {
    mesh,
    targets,
    bowl,
    cap,
    capOn: false,
    charges: [primary],
    morphT: 0,
    scale: 1,
    sign: 1,
    second: 'off',
    version: 0,
    lines: [],
    linesVersion: 0,
  }
  const origin = { x: 0, y: 0, z: 0 }
  const spheres: Sim1Physics['spheres'] = {
    charge: { q: Q, pos: origin, rc: RC },
    radii: SPHERE_RADII,
    fourth: false,
    exponent: 2,
    rays: radialRays({ q: Q, pos: origin, rc: RC }, RAYS_PER_NC, RAY_LENGTH),
  }

  const rebuild = () => {
    morph(mesh.positions, targets, gauss.morphT)
    const P = mesh.positions
    const s = gauss.scale
    if (s !== 1) for (let i = 0; i < P.length; i++) P[i] = P[i]! * s
    gauss.version++
  }
  const retrace = () => {
    const cs = gauss.charges
    if (cs.length === 1) gauss.lines = radialRays(cs[0]!, Math.round((RAYS_PER_NC * Math.abs(cs[0]!.q)) / Q), RAY_LENGTH)
    else
      gauss.lines = seedLines(cs, RAYS_PER_NC / Q, {
        hMin: 2e-3,
        hMax: 0.06,
        eMin: 1e-4,
        maxSteps: 3000,
        box: { min: { x: -RAY_LENGTH, y: -RAY_LENGTH, z: -RAY_LENGTH }, max: { x: RAY_LENGTH, y: RAY_LENGTH, z: RAY_LENGTH } },
      })
    gauss.linesVersion++
  }
  const syncCharges = () => {
    primary.q = gauss.sign * Q
    gauss.charges = gauss.second === 'off' ? [primary] : [primary, { q: gauss.second === 'plus' ? Q : -Q, pos: { ...SECOND_POS }, rc: RC }]
    retrace()
  }

  const physics: Sim1Physics = {
    pendulum: createPendulum(),
    pair: createChargePair(),
    coulomb: createCoulomb(),
    field: createField(),
    loop: createFluxLoop(),
    bundle: createBundleLoops(),
    bowl: createBowl(),
    symmetry: createSymmetry(),
    spheres,
    gauss,
    crossings() {
      const n = spheres.fourth ? 4 : 3
      const out: number[] = []
      for (let i = 0; i < n; i++) {
        let c = 0
        for (const ray of spheres.rays) c += countSphereCrossings(ray, origin, spheres.radii[i]!)
        out.push(c)
      }
      return out
    },
    sphereArea: i => 4 * Math.PI * spheres.radii[i]! ** 2,
    density(i) {
      const c = physics.crossings()
      const d0 = c[0]! / physics.sphereArea(0)
      return d0 === 0 ? 0 : c[i]! / physics.sphereArea(i) / d0
    },
    sphereFlux: i => fluxCenteredSphere(Q, spheres.radii[i]!, spheres.exponent),
    fieldAtR: r => (K_E * Q) / Math.pow(r, spheres.exponent),
    setExponent(n) {
      spheres.exponent = n
    },
    setFourth(on) {
      spheres.fourth = on
    },
    resetGauss() {
      gauss.morphT = 0
      gauss.scale = 1
      gauss.sign = 1
      gauss.second = 'off'
      gauss.capOn = false
      primary.pos = { ...CHARGE_START }
      rebuild()
      syncCharges()
    },
    setMorph(t) {
      gauss.morphT = t
      rebuild()
    },
    setScale(s) {
      gauss.scale = s
      rebuild()
    },
    setChargeX(x) {
      primary.pos = { x, y: CHARGE_START.y, z: CHARGE_START.z }
      retrace()
    },
    setSign(sign) {
      gauss.sign = sign
      syncCharges()
    },
    setSecond(kind) {
      gauss.second = kind
      syncCharges()
    },
    setCap(on) {
      gauss.capOn = on
    },
    flux: () => fluxExact(bowl, gauss.charges) + (gauss.capOn ? fluxExact(cap, gauss.charges) : 0),
    enclosedCharge() {
      let q = 0
      for (const c of gauss.charges) q += c.q * Math.round(meshSolidAngle(mesh, c.pos) / (4 * Math.PI))
      return q
    },
    faceFlux(out) {
      const P = mesh.positions
      const I = mesh.index
      for (let f = 0; f < mesh.faceCount; f++) {
        const ia = 3 * I[3 * f]!
        const ib = 3 * I[3 * f + 1]!
        const ic = 3 * I[3 * f + 2]!
        let phi = 0
        for (const c of gauss.charges) {
          const a = { x: P[ia]! - c.pos.x, y: P[ia + 1]! - c.pos.y, z: P[ia + 2]! - c.pos.z }
          const b = { x: P[ib]! - c.pos.x, y: P[ib + 1]! - c.pos.y, z: P[ib + 2]! - c.pos.z }
          const d = { x: P[ic]! - c.pos.x, y: P[ic + 1]! - c.pos.y, z: P[ic + 2]! - c.pos.z }
          phi += (c.q * triangleSolidAngle(a, b, d)) / (4 * Math.PI * EPSILON_0)
        }
        out[f] = phi
      }
    },
    retrace,
  }
  physics.resetGauss()
  return physics
}
