import * as THREE from 'three'
import { PEND_G, PEND_LENGTH, PEND_MASS } from '../../physics'
import type { Scene, SceneCtx } from './types'

/** Beat 0: two charged bobs on threads from a bar. */
export function createPendulumScene(ctx: SceneCtx): Scene {
  const { physics, markers, arrows, colors } = ctx
  const group = new THREE.Group()
  const barGeo = new THREE.BoxGeometry(1.6, 0.03, 0.06)
  const barMat = new THREE.MeshStandardMaterial({ color: colors.shell, roughness: 0.7 })
  const bar = new THREE.Mesh(barGeo, barMat)
  bar.position.set(0, 0.015, 0)
  const threadGeo = new THREE.CylinderGeometry(0.004, 0.004, 1, 6, 1)
  threadGeo.translate(0, -0.5, 0)
  const threadMat = new THREE.MeshStandardMaterial({ color: colors.line, roughness: 0.8 })
  const threads = [new THREE.Mesh(threadGeo, threadMat), new THREE.Mesh(threadGeo, threadMat)]
  const bobs = [markers.make(1, 0.07), markers.make(1, 0.07)]
  const forces = [arrows.make(colors.line, 0.014), arrows.make(colors.line, 0.014)]
  group.add(bar, ...threads, ...bobs.map(b => b.object), ...forces.map(a => a.object))
  const up = new THREE.Vector3(0, 1, 0)
  const dir = new THREE.Vector3()
  const q = new THREE.Quaternion()
  return {
    group,
    sync() {
      const p = physics.pendulum
      const { a, b } = p.bobs()
      const piv = p.pivots()
      bar.scale.x = Math.max(1, (p.D + 0.4) / 1.6)
      const place = (i: number, pivot: { x: number; y: number; z: number }, bob: { x: number; y: number; z: number }) => {
        const t = threads[i]!
        t.position.set(pivot.x, pivot.y, pivot.z)
        dir.set(bob.x - pivot.x, bob.y - pivot.y, bob.z - pivot.z)
        const len = dir.length()
        dir.normalize()
        q.setFromUnitVectors(up, dir)
        t.quaternion.copy(q)
        t.scale.set(1, len, 1)
        bobs[i]!.setPosition(bob.x, bob.y, bob.z)
      }
      place(0, piv.a, a)
      place(1, piv.b, b)
      bobs[0]!.setSign(1)
      bobs[1]!.setSign(p.opposite ? -1 : 1)
      // Force arrows: length grows with F/(mg) on a log scale, so a contact-strength pull still fits.
      const ratio = p.force() / (PEND_MASS * PEND_G)
      const len = Math.min(0.5, 0.06 + 0.12 * Math.log10(1 + 10 * ratio))
      const sign = p.opposite ? 1 : -1
      forces[0]!.setDirection(a, { x: sign, y: 0, z: 0 }, len)
      forces[1]!.setDirection(b, { x: -sign, y: 0, z: 0 }, len)
      void PEND_LENGTH
    },
    dispose() {
      barGeo.dispose()
      barMat.dispose()
      threadGeo.dispose()
      threadMat.dispose()
    },
  }
}
