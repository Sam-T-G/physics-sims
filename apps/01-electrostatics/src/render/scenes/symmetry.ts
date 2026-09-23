import * as THREE from 'three'
import { createSurfaceMesh, type SurfaceMesh } from '@lib/render'
import type { Scene, SceneCtx } from './types'

/** Beat 6: a sphere colored by |E|, one or two charges inside, and the three qualitative reveal shapes. */
export function createSymmetryScene(ctx: SceneCtx): Scene & { setReveal(on: boolean): void; pulseShell(on: boolean): void; setColored(on: boolean): void } {
  const { physics, markers, colors } = ctx
  const group = new THREE.Group()
  const surface: SurfaceMesh = createSurfaceMesh(12 * 64, { color: colors.surface, opacity: 0.55 })
  const m1 = markers.make(1, 0.07)
  const m2 = markers.make(-1, 0.07)
  const main = new THREE.Group()
  main.add(surface.mesh, m1.object, m2.object)

  // Reveal: line + cylinder, sheet + pillbox, ball + sphere. Counting faces bright, others dim.
  const reveal = new THREE.Group()
  // The faces that count glow cream (the "strong" end of the E ramp); the ones that get no flux stay dim.
  const bright = new THREE.MeshStandardMaterial({ color: colors.magHi, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
  const dim = new THREE.MeshStandardMaterial({ color: colors.surface, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false })
  const solid = new THREE.MeshStandardMaterial({ color: colors.line, roughness: 0.7 })
  const rodGeo = new THREE.CylinderGeometry(0.02, 0.02, 1.6, 12, 1)
  const cylSideGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.7, 32, 1, true)
  const cylCapGeo = new THREE.CircleGeometry(0.3, 32)
  const sheetGeo = new THREE.PlaneGeometry(1.0, 1.0)
  const pillSideGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.5, 32, 1, true)
  const pillCapGeo = new THREE.CircleGeometry(0.2, 32)
  const ballGeo = new THREE.SphereGeometry(0.22, 32, 24)
  const gaussSphereGeo = new THREE.SphereGeometry(0.45, 32, 24)
  const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rot?: THREE.Euler) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(x, y, z)
    if (rot) m.rotation.copy(rot)
    m.renderOrder = 8
    reveal.add(m)
    return m
  }
  // Line charge along y at x = −1.3: cylinder side counts, caps do not.
  mk(rodGeo, solid, -1.3, 0, 0)
  mk(cylSideGeo, bright, -1.3, 0, 0)
  mk(cylCapGeo, dim, -1.3, 0.35, 0, new THREE.Euler(-Math.PI / 2, 0, 0))
  mk(cylCapGeo, dim, -1.3, -0.35, 0, new THREE.Euler(Math.PI / 2, 0, 0))
  // Sheet facing the camera (the x-y plane) with the pillbox poking through it along z:
  // the flat ends count, the side does not.
  mk(sheetGeo, solid, 0, 0, 0)
  mk(pillSideGeo, dim, 0, 0, 0, new THREE.Euler(Math.PI / 2, 0, 0))
  mk(pillCapGeo, bright, 0, 0, 0.25)
  mk(pillCapGeo, bright, 0, 0, -0.25, new THREE.Euler(Math.PI, 0, 0))
  // Uniform ball at x = +1.3 with a Gaussian sphere outside it.
  mk(ballGeo, solid, 1.3, 0, 0)
  mk(gaussSphereGeo, bright, 1.3, 0, 0)
  reveal.visible = false
  group.add(main, reveal)

  const mags = new Float64Array(physics.symmetry.mesh.faceCount)
  // Same "how strong" ramp as the chapter 3 arrows (lerped in sRGB, converted once).
  const lo = new THREE.Color(colors.magLo).convertLinearToSRGB()
  const mid = new THREE.Color(colors.magMid).convertLinearToSRGB()
  const hi = new THREE.Color(colors.magHi).convertLinearToSRGB()
  let key = ''
  let pulse = false
  let colored = true
  let t = 0
  return {
    group,
    setColored(on) {
      colored = on
      key = ''
    },
    setReveal(on) {
      reveal.visible = on
      main.visible = !on
    },
    pulseShell(on) {
      pulse = on
      if (!on) surface.mesh.scale.setScalar(1)
    },
    sync() {
      t += 1 / 60
      const sy = physics.symmetry
      const k = `${sy.x}|${sy.dipole}|${colored}`
      if (k !== key) {
        if (!colored) surface.refill(sy.mesh)
        else {
          sy.faceMagnitudes(mags)
          // One fixed log scale for every position (see colorRange), clamped at both ends.
          const [refLo, refHi] = sy.colorRange()
          const l0 = Math.log(refLo)
          const span = Math.log(refHi) - l0
          surface.refill(sy.mesh, (f, out) => {
            const m = mags[f]!
            const u = m > 0 ? Math.min(1, Math.max(0, (Math.log(m) - l0) / span)) : 0
            if (u < 0.5) out.copy(lo).lerp(mid, u * 2)
            else out.copy(mid).lerp(hi, (u - 0.5) * 2)
            out.convertSRGBToLinear()
          })
        }
        key = k
      }
      const cs = sy.charges()
      m1.setPosition(cs[0]!.pos.x, cs[0]!.pos.y, cs[0]!.pos.z)
      m2.object.visible = cs.length > 1
      if (cs[1]) m2.setPosition(cs[1].pos.x, cs[1].pos.y, cs[1].pos.z)
      surface.mesh.scale.setScalar(pulse && !ctx.motion.reduced ? 1 + 0.03 * Math.sin(t * 5) : 1)
    },
    dispose() {
      surface.dispose()
      for (const g of [rodGeo, cylSideGeo, cylCapGeo, sheetGeo, pillSideGeo, pillCapGeo, ballGeo, gaussSphereGeo]) g.dispose()
      bright.dispose()
      dim.dispose()
      solid.dispose()
    },
  }
}
