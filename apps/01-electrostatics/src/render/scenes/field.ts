import * as THREE from 'three'
import { createArrowField, createFieldLines, type ArrowField, type FieldLines } from '@lib/render'
import { FIELD_RC, SLICE_N } from '../../physics'
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
  // Drawn at their real size (the capture radius), so the released charge visibly hits the ball it stops on.
  const m1 = markers.make(1, FIELD_RC)
  const m2 = markers.make(-1, FIELD_RC)
  const probeGeo = new THREE.SphereGeometry(0.035, 16, 12)
  const probeMat = new THREE.MeshStandardMaterial({ color: colors.fg, roughness: 0.4 })
  const probe = new THREE.Mesh(probeGeo, probeMat)
  const fArrow = arrows.make(colors.line, 0.014, 'F')
  const eArrow = arrows.make(colors.fg, 0.011, 'E')
  // Each charge's piece of E at the probe, colored by the sign of the charge it comes from.
  const cArrows = [arrows.make(colors.pos, 0.009), arrows.make(colors.neg, 0.009)]
  const slice = createArrowField(SLICE_N * SLICE_N, { length: 0.11, radius: 0.007 })
  const lines = createFieldLines(20000, { color: colors.line, width: 1.2, opacity: 0.6 })
  const pathLines = createFieldLines(6000, { color: colors.fg, width: 2, opacity: 0.9 })
  // The field line through the release point: the same yellow as a, drawn brighter than the others.
  const compareLines = createFieldLines(6000, { color: colors.line, width: 2.8, opacity: 1 })
  const particle = markers.make(1, 0.03)
  const aArrow = arrows.make(colors.line, 0.012, 'a')
  const vArrow = arrows.make(colors.fg, 0.012, 'v')
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
  const lo = new THREE.Color(colors.magLo).convertLinearToSRGB()
  const hi = new THREE.Color(colors.magHi).convertLinearToSRGB()
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
      c.copy(lo).lerp(hi, u)
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
      const pulse = 1 + 0.25 * Math.sin(t * 6)
      if (show.contrib) {
        // Tip to tail on one linear scale: each charge's piece in turn, then the white sum from the probe.
        // Linear, so the chain really does end on the tip of the sum.
        const contribs = f.contributions()
        const total = contribs.reduce((acc, v) => acc + norm(v), 0)
        const k = 0.6 / Math.max(total, norm(E), 1e-30)
        let tail = { ...f.probe }
        cArrows.forEach((a, i) => {
          const v = contribs[i]
          const src = cs[i]
          if (!v || !src) {
            a.setVisible(false)
            return
          }
          a.setColor(src.q >= 0 ? colors.pos : colors.neg)
          a.setDirection(tail, v, norm(v) * k)
          tail = { x: tail.x + v.x * k, y: tail.y + v.y * k, z: tail.z + v.z * k }
        })
        fArrow.setVisible(false)
        // Nudge the sum a hair sideways (perpendicular to E) so it stays visible when the chain lines up with it.
        const eN = norm(E) || 1
        eArrow.setDirection({ x: f.probe.x + (E.y / eN) * 0.035, y: f.probe.y - (E.x / eN) * 0.035, z: f.probe.z }, E, norm(E) * k)
        probe.scale.setScalar(1)
      } else {
        cArrows.forEach(a => a.setVisible(false))
        const eLen = Math.min(0.6, 0.35 * Math.log10(1 + norm(E) / 2000))
        // F = q₀E: same direction as E for + probes, opposite for −, and |q₀| times as long.
        const fLen = Math.min(0.9, eLen * Math.abs(f.q0))
        fArrow.setVisible(show.probe)
        eArrow.setVisible(show.probe)
        if (show.probe) {
          // E from the probe; F beside it, shifted sideways in the screen plane so the two never sit on
          // top of each other (for q₀ = +1 they point the same way).
          const eN = norm(E) || 1
          const side = { x: f.probe.x - (E.y / eN) * 0.07, y: f.probe.y + (E.x / eN) * 0.07, z: f.probe.z }
          fArrow.setDirection(side, F, fLen * (hl === 'F' ? pulse : 1))
          eArrow.setDirection(f.probe, E, eLen * (hl === 'E' ? pulse : 1))
          probe.scale.setScalar(hl === 'q0' ? pulse : 1)
        }
      }
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
