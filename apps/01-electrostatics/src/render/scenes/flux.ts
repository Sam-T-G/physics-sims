import * as THREE from 'three'
import { createFieldLines, createSurfaceMesh, type FieldLines, type SurfaceMesh } from '@lib/render'
import { UNIFORM_E } from '../../physics'
import type { Scene, SceneCtx } from './types'

export type FluxHighlight = 'E' | 'A' | 'cos' | 'n' | null

/** Beat 4: the loop in a uniform field, the same-bundle loops, and the hemisphere toy. */
export function createFluxScene(ctx: SceneCtx): Scene & {
  setPart(part: 'loop' | 'bundle' | 'bowl'): void
  highlight(h: FluxHighlight): void
  /** Nudge inputs for the linked terms (the chrome tweens these). */
  visual: { tiltOffset: number; areaScale: number; lineOpacity: number; nFlip: number }
} {
  const { physics, markers, arrows, colors } = ctx
  const group = new THREE.Group()

  // Uniform field: grid lines along x, a square loop, its n̂ and an E arrow.
  const loopGroup = new THREE.Group()
  const uniformLines = createFieldLines(400, { color: colors.line, width: 1.2, opacity: 0.6 })
  uniformLines.set(physics.loop.gridLines())
  const loopGeo = new THREE.PlaneGeometry(1, 1)
  const loopMat = new THREE.MeshStandardMaterial({ color: colors.surface, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
  const loop = new THREE.Mesh(loopGeo, loopMat)
  loop.renderOrder = 8
  const nArrow = arrows.make(colors.pos, 0.012)
  const eArrow = arrows.make(colors.line, 0.012)
  loopGroup.add(uniformLines.object, loop, nArrow.object, eArrow.object)

  // Same bundle: charge, rays, two square loops.
  const bundleGroup = new THREE.Group()
  const bCharge = markers.make(1, 0.06)
  const bRays = createFieldLines(400, { color: colors.line, width: 1.1, opacity: 0.55 })
  bRays.set(physics.bundle.rays)
  const squareMat = new THREE.MeshStandardMaterial({ color: colors.surface, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
  const near = new THREE.Mesh(loopGeo, squareMat)
  const far = new THREE.Mesh(loopGeo, squareMat)
  near.renderOrder = 8
  far.renderOrder = 9
  bundleGroup.add(bCharge.object, bRays.object, near, far)

  // Bowl: one surface mesh refilled per subdivision, colored per face.
  const bowlGroup = new THREE.Group()
  const bowl: SurfaceMesh = createSurfaceMesh(12 * 25, { color: colors.surface, opacity: 0.7 })
  const bowlCharge = markers.make(1, 0.05)
  bowlGroup.add(bowl.mesh, bowlCharge.object)

  group.add(loopGroup, bundleGroup, bowlGroup)
  let part: 'loop' | 'bundle' | 'bowl' = 'loop'
  let hl: FluxHighlight = null
  const visual = { tiltOffset: 0, areaScale: 1, lineOpacity: 0.6, nFlip: 0 }
  const faceFlux = new Float64Array(12 * 25)
  const base = new THREE.Color(colors.surface)
  const warm = new THREE.Color(colors.pos)
  const cool = new THREE.Color(colors.neg)
  let bowlKey = ''
  const xAxis = new THREE.Vector3(1, 0, 0)
  const zAxis = new THREE.Vector3(0, 0, 1)
  // The plane's own normal is +z. Face +x first, then spin about z by θ: the normal becomes (cos θ, sin θ, 0)
  // and one edge stays along z, which is exactly the footprint linesThrough() counts.
  const faceX = new THREE.Quaternion().setFromUnitVectors(zAxis, xAxis)
  const spin = new THREE.Quaternion()
  void hl

  return {
    group,
    visual,
    setPart(p) {
      part = p
    },
    highlight(h) {
      hl = h
    },
    sync() {
      loopGroup.visible = part === 'loop'
      bundleGroup.visible = part === 'bundle'
      bowlGroup.visible = part === 'bowl'
      if (part === 'loop') {
        const l = physics.loop
        const theta = ((l.thetaDeg + visual.tiltOffset) * Math.PI) / 180
        spin.setFromAxisAngle(zAxis, theta)
        loop.quaternion.copy(spin).multiply(faceX)
        loop.scale.setScalar(l.side * visual.areaScale)
        const n = l.normal()
        const flip = visual.nFlip > 0.5 ? -1 : 1
        nArrow.setDirection({ x: 0, y: 0, z: 0 }, { x: n.x * flip, y: n.y * flip, z: 0 }, 0.45)
        eArrow.setDirection({ x: -1.0, y: -0.9, z: 0 }, { x: 1, y: 0, z: 0 }, 0.35 * (UNIFORM_E / 200))
        uniformLines.object.visible = true
        ;(uniformLines.object.material as THREE.Material).opacity = visual.lineOpacity
      }
      if (part === 'bundle') {
        const b = physics.bundle
        near.position.set(b.d1, 0, 0)
        near.scale.setScalar(b.a1)
        near.quaternion.setFromUnitVectors(zAxis, xAxis)
        far.position.set(2 * b.d1, 0, 0)
        far.scale.setScalar(2 * b.a1)
        far.quaternion.setFromUnitVectors(zAxis, xAxis)
      }
      if (part === 'bowl') {
        const bw = physics.bowl
        const key = `${bw.n}|${bw.z}`
        if (key !== bowlKey) {
          const max = bw.faceFlux(faceFlux)
          bowl.refill(bw.current(), (f, out) => {
            const phi = faceFlux[f]!
            const k = max > 0 ? Math.min(1, Math.abs(phi) / max) : 0
            out.copy(base).lerp(phi >= 0 ? warm : cool, 0.3 + 0.7 * k)
          })
          bowlKey = key
        }
        bowlCharge.setPosition(bw.charge.pos.x, bw.charge.pos.y, bw.charge.pos.z)
      }
    },
    dispose() {
      uniformLines.dispose()
      loopGeo.dispose()
      loopMat.dispose()
      bRays.dispose()
      squareMat.dispose()
      bowl.dispose()
    },
  }
}
