// Layer 2 for this app. Imports from @lib/render and three. Never from gsap.
import * as THREE from 'three'
import {
  createArrows,
  createChargeMarkers,
  createFieldLines,
  createShells,
  createStage,
  createSurfaceMesh,
  type ChargeMarker,
  type FieldLines,
  type Shells,
  type Stage,
  type SurfaceMesh,
 isWideLayout } from '@lib/render'
import { MAX_SUBDIVISION, type Sim1Physics } from '../physics'
import { createPendulumScene } from './scenes/pendulum'
import { createPairScene } from './scenes/pair'
import { createCoulombScene } from './scenes/coulomb'
import { createFieldScene } from './scenes/field'
import { createFluxScene } from './scenes/flux'
import { createSymmetryScene } from './scenes/symmetry'
import type { Scene, SceneCtx } from './scenes/types'

export type SceneName = 'pendulum' | 'pair' | 'coulomb' | 'field' | 'spheres' | 'flux' | 'gauss' | 'symmetry'

export type SceneColors = { bg: string; pos: string; neg: string; shell: string; surface: string; line: string; fg: string; magLo: string; magMid: string; magHi: string }
export type SceneEnv = { pixelRatio: number; document: Document }

const MAX_FACES = 12 * MAX_SUBDIVISION * MAX_SUBDIVISION
const MAX_SEGMENTS = 12000

export type Sim1Render = {
  stage: Stage
  /** One persistent group per scene, toggled with .visible. Nothing is rebuilt between chapters. */
  groups: { spheres: THREE.Group; gauss: THREE.Group }
  shells: Shells
  bowl: SurfaceMesh
  cap: SurfaceMesh
  scenes: {
    pendulum: ReturnType<typeof createPendulumScene>
    pair: ReturnType<typeof createPairScene>
    coulomb: ReturnType<typeof createCoulombScene>
    field: ReturnType<typeof createFieldScene>
    flux: ReturnType<typeof createFluxScene>
    symmetry: ReturnType<typeof createSymmetryScene>
  }
  show(scene: SceneName | null): void
  /** Color every face by the sign and size of its flux (entry cool, exit warm). */
  setColoring(on: boolean): void
  layout(width: number, height: number): void
  /** Decorative pulses stop while the student prefers reduced motion. */
  setReducedMotion(on: boolean): void
  frame(): void
  dispose(): void
}

/** Allocates every scene object once. Returns null when WebGL is unavailable. */
export function createSim1Render(canvas: HTMLCanvasElement, physics: Sim1Physics, colors: SceneColors, env: SceneEnv): Sim1Render | null {
  const stage = createStage(canvas, { background: colors.bg, pixelRatio: env.pixelRatio })
  if (!stage) return null
  const markers = createChargeMarkers({ pos: colors.pos, neg: colors.neg }, env.document)
  const arrows = createArrows(env.document)
  const motion = { reduced: false }
  const sceneCtx: SceneCtx = { physics, markers, arrows, colors, doc: env.document, motion }
  const scenes = {
    pendulum: createPendulumScene(sceneCtx),
    pair: createPairScene(sceneCtx),
    coulomb: createCoulombScene(sceneCtx),
    field: createFieldScene(sceneCtx),
    flux: createFluxScene(sceneCtx),
    symmetry: createSymmetryScene(sceneCtx),
  }
  const sceneList: [SceneName, Scene][] = [
    ['pendulum', scenes.pendulum],
    ['pair', scenes.pair],
    ['coulomb', scenes.coulomb],
    ['field', scenes.field],
    ['flux', scenes.flux],
    ['symmetry', scenes.symmetry],
  ]
  for (const [, sc] of sceneList) sc.group.visible = false

  // Beat 3b: charge at the origin, shells (the fourth hidden until predicted), analytic rays.
  const spheres = new THREE.Group()
  const shells = createShells(physics.spheres.radii, { color: colors.shell, opacity: 0.16 })
  const centerMarker = markers.make(1)
  const sphereLines = createFieldLines(MAX_SEGMENTS, { color: colors.line, width: 1.4, opacity: 0.7 })
  spheres.add(centerMarker.object, shells.group, sphereLines.object)
  spheres.visible = false

  // Beat 5: bowl and cap surfaces over one position buffer, up to two charges, lines.
  const gauss = new THREE.Group()
  const bowl = createSurfaceMesh(MAX_FACES, { color: colors.surface, opacity: 0.5 })
  const cap = createSurfaceMesh(MAX_FACES, { color: colors.surface, opacity: 0.5 })
  const gaussMarkers: ChargeMarker[] = [markers.make(1), markers.make(1)]
  const gaussLines: FieldLines = createFieldLines(MAX_SEGMENTS, { color: colors.line, width: 1.2, opacity: 0.55 })
  gauss.add(bowl.mesh, cap.mesh, gaussLines.object, ...gaussMarkers.map(m => m.object))
  gauss.visible = false

  stage.scene.add(spheres, gauss, ...sceneList.map(([, sc]) => sc.group))

  const surfaceBase = new THREE.Color(colors.surface)
  const warm = new THREE.Color(colors.pos)
  const cool = new THREE.Color(colors.neg)
  const faceFlux = new Float64Array(MAX_FACES)
  let coloring = false
  let filled = -1
  let filledColoring = false
  let filledLines = -1
  let sphereLinesSet = false
  let sphereExponent = 0
  const markerSign: (1 | -1 | 0)[] = [0, 0]

  const refillSurfaces = () => {
    const tri = physics.gauss.mesh
    if (coloring) {
      physics.faceFlux(faceFlux)
      let max = 0
      for (let f = 0; f < tri.faceCount; f++) max = Math.max(max, Math.abs(faceFlux[f]!))
      const colorOf = (globalFace: number, out: THREE.Color) => {
        const phi = faceFlux[globalFace]!
        const k = max > 0 ? Math.min(1, Math.abs(phi) / max) : 0
        out.copy(surfaceBase).lerp(phi >= 0 ? warm : cool, 0.35 + 0.65 * k)
      }
      // The halves index into the full mesh; map each half-face back to its global face for the color.
      bowl.refill(physics.gauss.bowl, (f, out) => colorOf(bowlFaceMap[f]!, out))
      cap.refill(physics.gauss.cap, (f, out) => colorOf(capFaceMap[f]!, out))
    } else {
      bowl.refill(physics.gauss.bowl)
      cap.refill(physics.gauss.cap)
    }
  }
  // Global face ids for each half, recovered once by matching index triples.
  const faceKey = (I: Uint32Array, f: number) => `${I[3 * f]},${I[3 * f + 1]},${I[3 * f + 2]}`
  const globalByKey = new Map<string, number>()
  for (let f = 0; f < physics.gauss.mesh.faceCount; f++) globalByKey.set(faceKey(physics.gauss.mesh.index, f), f)
  const mapHalf = (half: { index: Uint32Array; faceCount: number }) => {
    const m = new Uint32Array(half.faceCount)
    for (let f = 0; f < half.faceCount; f++) m[f] = globalByKey.get(faceKey(half.index, f)) ?? 0
    return m
  }
  const bowlFaceMap = mapHalf(physics.gauss.bowl)
  const capFaceMap = mapHalf(physics.gauss.cap)

  const sync = () => {
    if (gauss.visible) {
      const g = physics.gauss
      if (filled !== g.version || filledColoring !== coloring || (coloring && g.charges.length > 0)) {
        refillSurfaces()
        filled = g.version
        filledColoring = coloring
      }
      cap.mesh.visible = true
      g.charges.forEach((c, i) => {
        const m = gaussMarkers[i]!
        m.object.visible = true
        const sign: 1 | -1 = c.q >= 0 ? 1 : -1
        if (markerSign[i] !== sign) {
          m.setSign(sign)
          markerSign[i] = sign
        }
        m.setPosition(c.pos.x, c.pos.y, c.pos.z)
      })
      for (let i = g.charges.length; i < gaussMarkers.length; i++) gaussMarkers[i]!.object.visible = false
      if (filledLines !== g.linesVersion) {
        gaussLines.set(g.lines)
        filledLines = g.linesVersion
      }
    }
    if (spheres.visible) {
      const s = physics.spheres
      if (!sphereLinesSet) {
        sphereLines.set(s.rays)
        sphereLinesSet = true
      }
      // Lines are hidden in toggle mode: density equals strength only at n = 2.
      if (sphereExponent !== s.exponent) {
        sphereLines.object.visible = s.exponent === 2
        sphereExponent = s.exponent
      }
      shells.meshes[3]!.visible = s.fourth
    }
  }

  return {
    stage,
    groups: { spheres, gauss },
    shells,
    bowl,
    cap,
    scenes,
    show(scene) {
      spheres.visible = scene === 'spheres'
      gauss.visible = scene === 'gauss'
      for (const [name, sc] of sceneList) sc.group.visible = scene === name
    },
    setColoring(on) {
      coloring = on
      bowl.setOpacity(on ? 0.68 : 0.5)
      cap.setOpacity(on ? 0.68 : 0.5)
    },
    layout(width, height) {
      if (width === 0 || height === 0) return
      stage.resize(width, height)
      sphereLines.setPixelRatio(env.pixelRatio)
      gaussLines.setPixelRatio(env.pixelRatio)
      // Column layout (card on the right) on wide screens and on landscape phones; sheet layout otherwise.
      // The chrome toggles the matching class from the same predicate.
      const wide = isWideLayout(width, height)
      const x = wide ? 220 : 0
      const y = wide ? 0 : Math.round(height * 0.24)
      stage.camera.setViewOffset(width, height, x, y, width, height)
    },
    setReducedMotion(on) {
      motion.reduced = on
    },
    frame() {
      sync()
      for (const [, sc] of sceneList) if (sc.group.visible) sc.sync()
      stage.render()
    },
    dispose() {
      for (const [, sc] of sceneList) sc.dispose()
      bowl.dispose()
      cap.dispose()
      shells.dispose()
      sphereLines.dispose()
      gaussLines.dispose()
      arrows.dispose()
      markers.dispose()
      stage.dispose()
    },
  }
}
