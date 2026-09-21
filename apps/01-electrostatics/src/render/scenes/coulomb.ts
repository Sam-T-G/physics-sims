import * as THREE from 'three'
import { COULOMB_F_REF } from '../../physics'
import type { Scene, SceneCtx } from './types'

export type CoulombHighlight = 'q1' | 'q2' | 'r' | 'r2' | null

/** Beat 2: two charges on a line with equal and opposite force arrows, a third charge, tip-to-tail sum. */
export function createCoulombScene(ctx: SceneCtx): Scene & { highlight(h: CoulombHighlight): void } {
  const { physics, markers, arrows, colors } = ctx
  const group = new THREE.Group()
  const m1 = markers.make(1, 0.08)
  const m2 = markers.make(1, 0.08)
  const m3 = markers.make(-1, 0.08)
  const lineGeo = new THREE.CylinderGeometry(0.006, 0.006, 1, 6, 1)
  lineGeo.translate(0, 0.5, 0)
  const lineMat = new THREE.MeshStandardMaterial({ color: colors.line, roughness: 0.8, transparent: true, opacity: 0.55 })
  const sep = new THREE.Mesh(lineGeo, lineMat)
  sep.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0))
  const f1 = arrows.make(colors.line, 0.016)
  const f2 = arrows.make(colors.line, 0.016)
  const f3 = arrows.make(colors.line, 0.016)
  const c1 = arrows.make(colors.pos, 0.011)
  const c3 = arrows.make(colors.neg, 0.011)
  group.add(m1.object, m2.object, m3.object, sep, f1.object, f2.object, f3.object, c1.object, c3.object)
  let hl: CoulombHighlight = null
  let t = 0
  // One linear scale per frame: the reference length at F_REF, reduced only if the largest arrow would exceed 1.4,
  // so the tip-to-tail chain on q2 ends exactly at the net arrow's tip.
  let scaleF = 0.55 / COULOMB_F_REF
  const lenOf = (F: number) => F * scaleF
  const mag = (v: { x: number; y: number; z: number }) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  return {
    group,
    highlight(h) {
      hl = h
      lineMat.opacity = h === 'r' ? 1 : 0.55
    },
    sync() {
      t += 1 / 60
      const c = physics.coulomb
      const cs = c.charges()
      const [p1, p2, p3] = [cs[0]!.pos, cs[1]!.pos, cs[2]?.pos]
      m1.setPosition(p1.x, p1.y, p1.z)
      m2.setPosition(p2.x, p2.y, p2.z)
      m1.setSign(c.q1 >= 0 ? 1 : -1)
      m2.setSign(c.q2 >= 0 ? 1 : -1)
      const pulse = 1 + 0.18 * Math.sin(t * 6)
      m1.object.scale.setScalar(hl === 'q1' ? pulse : 1)
      m2.object.scale.setScalar(hl === 'q2' ? pulse : 1)
      m3.object.visible = Boolean(p3)
      if (p3) {
        m3.setPosition(p3.x, p3.y, p3.z)
        m3.setSign(c.q3 >= 0 ? 1 : -1)
      }
      sep.position.set(p1.x, p1.y, p1.z)
      sep.scale.set(1, c.r, 1)
      const { f1: F1, f2: F2, f3: F3 } = c.forces()
      const pair = p3 ? c.pairForcesOnQ2() : null
      const biggest = Math.max(mag(F1), mag(F2), mag(F3), pair ? mag(pair.fromQ1) + mag(pair.fromQ3) : 0)
      scaleF = Math.min(0.55 / COULOMB_F_REF, biggest > 0 ? 1.4 / biggest : Infinity)
      f1.setDirection(p1, F1, lenOf(mag(F1)))
      f2.setDirection(p2, F2, lenOf(mag(F2)))
      if (p3) f3.setDirection(p3, F3, lenOf(mag(F3)))
      else f3.setVisible(false)
      // Tip to tail on q2: the q1 contribution first, then the q3 one from its tip, then the sum.
      if (p3 && pair) {
        const { fromQ1, fromQ3 } = pair
        const l1 = lenOf(mag(fromQ1))
        const l3 = lenOf(mag(fromQ3))
        c1.setDirection(p2, fromQ1, l1)
        const n1 = mag(fromQ1) || 1
        const tip = { x: p2.x + (fromQ1.x / n1) * l1, y: p2.y + (fromQ1.y / n1) * l1, z: p2.z + (fromQ1.z / n1) * l1 }
        c3.setDirection(tip, fromQ3, l3)
      } else {
        c1.setVisible(false)
        c3.setVisible(false)
      }
    },
    dispose() {
      lineGeo.dispose()
      lineMat.dispose()
    },
  }
}
