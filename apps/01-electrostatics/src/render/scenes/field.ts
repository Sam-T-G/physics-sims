import * as THREE from 'three'
import { createArrowField, createFieldLines, type ArrowField, type FieldLines } from '@lib/render'
import { SLICE_N } from '../../physics'
import type { Scene, SceneCtx } from './types'

export type FieldHighlight = 'F' | 'q0' | 'E' | null

/** Beat 3: sources, probe with F and E, the slice plane, field lines, and the released particle. */
export function createFieldScene(ctx: SceneCtx): Scene & {
  lines: FieldLines
  slice: ArrowField
  highlight(h: FieldHighlight): void
  setShow(part: 'slice' | 'lines' | 'probe' | 'contrib' | 'particle', on: boolean): void
  /** The field line through the release point, drawn beside the path for comparison. null clears. */
  compare(line: { points: { x: number; y: number; z: number }[] } | null): void
  /** log10 |E| range of the last slice fill, for the legend. */
  sliceRange(): { logMin: number; logMax: number }
} {
  const { physics, markers, arrows, colors } = ctx
  const group = new THREE.Group()
  const m1 = markers.make(1, 0.08)
  const m2 = markers.make(-1, 0.08)
  const probeGeo = new THREE.SphereGeometry(0.035, 16, 12)
  const probeMat = new THREE.MeshStandardMaterial({ color: colors.fg, roughness: 0.4 })
  const probe = new THREE.Mesh(probeGeo, probeMat)
  const fArrow = arrows.make(colors.line, 0.014)
  const eArrow = arrows.make(colors.pos, 0.011)
  const cArrows = [arrows.make(colors.pos, 0.009), arrows.make(colors.neg, 0.009)]
  const slice = createArrowField(SLICE_N * SLICE_N, { length: 0.11, radius: 0.007 })
  const lines = createFieldLines(20000, { color: colors.line, width: 1.2, opacity: 0.6 })
  const pathLines = createFieldLines(6000, { color: colors.fg, width: 2, opacity: 0.9 })
  const compareLines = createFieldLines(6000, { color: colors.pos, width: 1.4, opacity: 0.8 })
  const particle = markers.make(1, 0.045)
  const aArrow = arrows.make(colors.pos, 0.011)
  const vArrow = arrows.make(colors.fg, 0.011)
  group.add(m1.object, m2.object, probe, fArrow.object, eArrow.object, ...cArrows.map(a => a.object), slice.mesh, lines.object, pathLines.object, compareLines.object, particle.object, aArrow.object, vArrow.object)

  const show = { slice: false, lines: false, probe: true, contrib: false, particle: false }
  let hl: FieldHighlight = null
  let t = 0
  let linesVersion = -1
  let m2Sign: 1 | -1 = -1
  const pos = new Float64Array(SLICE_N * SLICE_N * 3)
  const dir = new Float64Array(SLICE_N * SLICE_N * 3)
  const mag = new Float64Array(SLICE_N * SLICE_N)
  // new Color('#hex') lands in linear working space; undo that so the lerp runs in sRGB, the same
  // interpolation the CSS legend gradient uses, then convert once for the instance color buffer.
  const cool = new THREE.Color(colors.neg).convertLinearToSRGB()
  const mid = new THREE.Color(colors.surface).convertLinearToSRGB()
  const warm = new THREE.Color(colors.pos).convertLinearToSRGB()
  const c = new THREE.Color()
  let range = { logMin: 0, logMax: 1 }
  const norm = (v: { x: number; y: number; z: number }) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)

  const fillSlice = () => {
    range = physics.field.slice(pos, dir, mag)
    const span = Math.max(1e-9, range.logMax - range.logMin)
    for (let k = 0; k < SLICE_N * SLICE_N; k++) {
      const m = mag[k]!
      if (Number.isNaN(m)) {
        slice.hideInstance(k)
        continue
      }
      const u = (m - range.logMin) / span
      if (u < 0.5) c.copy(cool).lerp(mid, u * 2)
      else c.copy(mid).lerp(warm, (u - 0.5) * 2)
      // Instance colors are stored linear; the lerp above was in sRGB, so convert exactly once.
      c.convertSRGBToLinear()
      slice.setInstance(k, { x: pos[3 * k]!, y: pos[3 * k + 1]!, z: pos[3 * k + 2]! }, { x: dir[3 * k]!, y: dir[3 * k + 1]!, z: dir[3 * k + 2]! }, c)
    }
    slice.commit(SLICE_N * SLICE_N)
  }
  let sliceKey = ''

  return {
    group,
    lines,
    slice,
    highlight(h) {
      hl = h
    },
    setShow(part, on) {
      show[part] = on
    },
    compare(line) {
      compareLines.set(line ? [{ points: line.points, end: 'steps' }] : [])
    },
    sliceRange: () => range,
    sync() {
      t += 1 / 60
      const f = physics.field
      const cs = f.charges()
      m1.setPosition(cs[0]!.pos.x, cs[0]!.pos.y, cs[0]!.pos.z)
      m2.object.visible = cs.length > 1
      if (cs[1]) {
        m2.setPosition(cs[1].pos.x, cs[1].pos.y, cs[1].pos.z)
        const sign: 1 | -1 = cs[1].q >= 0 ? 1 : -1
        if (sign !== m2Sign) {
          m2.setSign(sign)
          m2Sign = sign
        }
      }
      // Probe with F (scaled to the probe unit) and E (fixed visual scale).
      probe.visible = show.probe
      probe.position.set(f.probe.x, f.probe.y, f.probe.z)
      const F = f.probeForce()
      const E = f.probeField()
      const eLen = Math.min(0.6, 0.35 * Math.log10(1 + norm(E) / 2000))
      const fLen = Math.min(0.9, eLen * Math.abs(f.q0))
      const pulse = 1 + 0.25 * Math.sin(t * 6)
      fArrow.setVisible(show.probe)
      eArrow.setVisible(show.probe)
      if (show.probe) {
        fArrow.setDirection(f.probe, F, fLen * (hl === 'F' ? pulse : 1))
        eArrow.setDirection({ x: f.probe.x, y: f.probe.y + 0.02, z: f.probe.z }, E, eLen * (hl === 'E' ? pulse : 1))
        probe.scale.setScalar(hl === 'q0' ? pulse : 1)
      }
      const contribs = show.contrib ? f.contributions() : []
      cArrows.forEach((a, i) => {
        const v = contribs[i]
        if (!v) {
          a.setVisible(false)
          return
        }
        a.setDirection(f.probe, v, Math.min(0.6, 0.35 * Math.log10(1 + norm(v) / 2000)))
      })
      slice.mesh.visible = show.slice
      if (show.slice) {
        const key = `${f.pair}|${f.sliceZ}`
        if (key !== sliceKey) {
          fillSlice()
          sliceKey = key
        }
      }
      lines.object.visible = show.lines
      if (show.lines && linesVersion !== f.linesVersion) {
        lines.set(f.lines)
        linesVersion = f.linesVersion
      }
      const p = f.particle
      const showP = show.particle && Boolean(p)
      particle.object.visible = showP
      pathLines.object.visible = showP
      compareLines.object.visible = showP
      aArrow.setVisible(showP)
      vArrow.setVisible(showP)
      if (showP && p) {
        const s = p.state
        particle.setPosition(s.pos.x, s.pos.y, s.pos.z)
        pathLines.set([{ points: f.path, end: 'steps' }])
        const acc = p.accel(s.pos)
        aArrow.setDirection(s.pos, acc, Math.min(0.5, 0.3 * Math.log10(1 + norm(acc) / 1e6)))
        vArrow.setDirection(s.pos, s.vel, Math.min(0.5, 0.3 * Math.log10(1 + norm(s.vel) / 20)))
      }
    },
    dispose() {
      probeGeo.dispose()
      probeMat.dispose()
      slice.dispose()
      lines.dispose()
      pathLines.dispose()
      compareLines.dispose()
    },
  }
}

export type FieldSceneApi = ReturnType<typeof createFieldScene>
