// Layer 3 for this app. Imports gsap (with sim.ts, the only files that do). See sim.ts for the mount contract.
import { gsap } from 'gsap'
import { createApproxPanel, createCameraRig, createChapters, createToolBelt, type BeatSpec, type CameraPreset, type Chapters } from '@lib/chrome'
import { APPROX_COPY, BEATS, CAMERA, CAMERA_SCENES, TOOLS } from './content'
import type { Sim1Physics } from './physics'
import type { Sim1Render } from './render/index'
import { createBeat0 } from './beats/beat0'
import { createBeat1 } from './beats/beat1'
import { createBeat2 } from './beats/beat2'
import { createBeat3 } from './beats/beat3'
import { createBeat3b } from './beats/beat3b'
import { createBeat4 } from './beats/beat4'
import { createBeat5, type Readout } from './beats/beat5'
import { createBeat6 } from './beats/beat6'
import { formatFlux, type Run } from './flow'

export type Sim1Chrome = {
  chapters: Chapters
  /** Per frame: live readouts and the released charge. deltaSeconds comes from the one clock. */
  update(deltaSeconds: number): void
  destroy(): void
}

const P = 'sim01'
const FLASH_CAPTION = 'By the end you’ll know why this number can’t move.'

/** Must be called inside the sim's gsap.context so every tween and matchMedia is reverted at unmount. */
export function createSim1Chrome(o: { el: HTMLElement; render: Sim1Render; physics: Sim1Physics; reduced: () => boolean; run: Run }): Sim1Chrome {
  const { el, render, physics, reduced, run } = o
  const doc = el.ownerDocument
  const rig = createCameraRig(render.stage.camera, render.stage.controls)
  const camera = (preset: CameraPreset) => rig.goToPreset(preset, { cut: reduced() })

  // Live readout over the scene.
  const readoutEl = doc.createElement('div')
  readoutEl.className = `${P}-readout`
  readoutEl.id = `${P}-readout`
  readoutEl.hidden = true
  readoutEl.setAttribute('aria-live', 'off')
  const readoutMain = doc.createElement('span')
  readoutMain.className = `${P}-readout-main`
  const readoutSub = doc.createElement('span')
  readoutSub.className = `${P}-readout-sub`
  const readoutCaption = doc.createElement('span')
  readoutCaption.className = `${P}-readout-caption`
  readoutCaption.hidden = true
  readoutEl.append(readoutMain, readoutSub, readoutCaption)
  el.appendChild(readoutEl)
  const readout: Readout = {
    show: () => (readoutEl.hidden = false),
    hide: () => (readoutEl.hidden = true),
    isHidden: () => readoutEl.hidden !== false,
    caption(text) {
      readoutCaption.hidden = text === null
      readoutCaption.textContent = text ?? ''
    },
    set(main, sub) {
      readoutMain.textContent = main
      readoutSub.textContent = sub
    },
  }

  const flash = { x: 0.3, t: 0 }
  const presetFor: Record<string, CameraPreset> = {
    hook: CAMERA_SCENES.pendulum,
    charge: CAMERA_SCENES.pair,
    coulomb: CAMERA_SCENES.coulomb,
    field: CAMERA_SCENES.field,
    whySquared: CAMERA.spheres,
    flux: CAMERA_SCENES.flux,
    gauss: CAMERA.gauss,
    symmetry: CAMERA_SCENES.symmetry,
  }

  // Beat modules are created after chapters exist (they need lockNext); the specs reach them through these.
  const mods: {
    b0?: ReturnType<typeof createBeat0>
    b1?: ReturnType<typeof createBeat1>
    b2?: ReturnType<typeof createBeat2>
    b3?: ReturnType<typeof createBeat3>
    b3b?: ReturnType<typeof createBeat3b>
    b4?: ReturnType<typeof createBeat4>
    b5?: ReturnType<typeof createBeat5>
    b6?: ReturnType<typeof createBeat6>
  } = {}

  const beats: BeatSpec[] = BEATS.map(b => ({
    id: b.id,
    content: b,
    tools: b.tools,
    snapshot: () => rig.snapshot(),
    restore: s => rig.goToPreset(s as ReturnType<typeof rig.snapshot>, { cut: true }),
    enter(tl, cut) {
      switch (b.id) {
        case 'hook': {
          mods.b0?.enter()
          if (cut) break
          // Three-second flash-forward to the beat-5 scene: the readout holds still while the charge drags
          // and the surface morphs. Same scene object, camera preset only; ends back on the pendulum.
          tl.add(() => {
            physics.resetGauss()
            physics.setCap(true)
            render.cap.setOpacity(0.5)
            render.show('gauss')
            flash.x = 0.3
            flash.t = 0
            rig.goToPreset(CAMERA.gauss, { cut: true })
            readout.set(formatFlux(physics.flux()), '')
            readout.caption(FLASH_CAPTION)
            readout.show()
          }, 2.2)
          tl.to(
            flash,
            {
              x: -0.5,
              t: 2,
              duration: 3,
              ease: 'sine.inOut',
              onUpdate: () => {
                physics.setChargeX(flash.x)
                physics.setMorph(flash.t)
                readout.set(formatFlux(physics.flux()), '')
              },
            },
            2.4,
          )
          tl.add(() => {
            readout.caption(null)
            physics.resetGauss()
            mods.b0?.enter()
            rig.goToPreset(CAMERA_SCENES.pendulum, { cut: false })
          }, 5.8)
          break
        }
        case 'charge':
          mods.b1?.enter()
          break
        case 'coulomb':
          mods.b2?.enter()
          break
        case 'field':
          mods.b3?.enter()
          break
        case 'whySquared': {
          mods.b3b?.enter()
          if (!cut) {
            render.shells.meshes.forEach((m, i) => {
              if (i === 3) return
              const r = physics.spheres.radii[i]!
              tl.fromTo(m.scale, { x: 0.02, y: 0.02, z: 0.02 }, { x: r, y: r, z: r, duration: 0.55, ease: 'power2.out' }, 0.25 + 0.22 * i)
            })
          } else {
            render.shells.meshes.forEach((m, i) => m.scale.setScalar(physics.spheres.radii[i]!))
          }
          break
        }
        case 'flux':
          mods.b4?.enter()
          break
        case 'gauss':
          mods.b5?.enter(cut)
          break
        case 'symmetry':
          mods.b6?.enter()
          break
      }
    },
    leave() {
      switch (b.id) {
        case 'hook':
          mods.b0?.leave()
          readout.caption(null)
          physics.resetGauss()
          break
        case 'charge':
          mods.b1?.leave()
          break
        case 'coulomb':
          mods.b2?.leave()
          break
        case 'field':
          mods.b3?.leave()
          break
        case 'whySquared':
          mods.b3b?.leave()
          // A killed entry timeline must not leave the shells half-grown for the beat-5 callback.
          render.shells.meshes.forEach((m, i) => m.scale.setScalar(physics.spheres.radii[i]!))
          break
        case 'flux':
          mods.b4?.leave()
          break
        case 'gauss':
          mods.b5?.leave()
          break
        case 'symmetry':
          mods.b6?.leave()
          break
      }
    },
  }))

  let belt: ReturnType<typeof createToolBelt> | null = null
  const chapters = createChapters({
    root: el,
    prefix: P,
    beats,
    reduced,
    onChange(index, beat, mode) {
      for (const id of beat.tools ?? []) belt?.earn(id)
      belt?.collapse()
      // Camera moves never live inside chapter timelines; a return restores the saved explore camera instead.
      if (mode === 'enter') rig.goToPreset(presetFor[beat.id] ?? CAMERA.default, { cut: reduced() })
      void index
    },
  })
  belt = createToolBelt({
    slot: chapters.el.beltSlot,
    prefix: P,
    tools: TOOLS,
    reduced,
    labelOf: i => BEATS[i]?.label ?? String(i),
    onJump: i => chapters.goTo(i, { cut: i < chapters.index() }),
  })
  const common = { doc, prefix: P, physics, render, chapters, readout, reduced, run, camera }
  mods.b0 = createBeat0(common)
  mods.b1 = createBeat1(common)
  mods.b2 = createBeat2(common)
  mods.b3 = createBeat3(common)
  mods.b3b = createBeat3b(common)
  mods.b4 = createBeat4(common)
  mods.b5 = createBeat5(common)
  mods.b6 = createBeat6(common)
  chapters.el.panelSlot.append(mods.b0.panel, mods.b1.panel, mods.b2.panel, mods.b3.panel, mods.b3b.panel, mods.b4.panel, mods.b5.panel, mods.b6.panel)
  const approx = createApproxPanel({ doc, prefix: P, title: APPROX_COPY.title, items: APPROX_COPY.items })
  chapters.el.card.insertBefore(approx.el, chapters.el.nav)

  rig.goToPreset(CAMERA_SCENES.pendulum, { cut: true })
  chapters.goTo(0)

  return {
    chapters,
    update(deltaSeconds) {
      mods.b0?.update()
      mods.b1?.update()
      mods.b2?.update()
      mods.b3?.update(deltaSeconds)
      mods.b3b?.update()
      mods.b4?.update()
      mods.b5?.update()
      mods.b6?.update()
    },
    destroy() {
      rig.kill()
      belt?.destroy()
      chapters.destroy()
      readoutEl.remove()
      approx.el.remove()
      gsap.killTweensOf(flash)
    },
  }
}
