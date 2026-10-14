// Layer 2: draws the board. Three.js only: no Motion, no DOM beyond the canvas.
// The app moves pieces by writing plain numbers into PieceView fields; this file never animates on its own
// except the current dots, which are data (their speed is the solved current).

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { NODES, WIRES, SLOTS, SLOT_IDS, SLOT_LENGTH, BATTERY_CENTER, type SlotId, type Part, type Pt } from './board'
import { colorBands, BAND_HEX } from './colorCode'

export const PALETTE = {
  board: 0xcfebdb,
  boardRim: 0xb3dcc6,
  wire: 0x7467c2,
  joint: 0x8f83d6,
  cup: 0xf4f1ff,
  pad: 0xffffff,
  glow: 0xffd15c,
  dot: 0xffd15c,
  dotIdle: 0xd9d3f2,
  body: 0xffe6c9,
  hot: 0xff8fa3,
  lead: 0xb9b3d6,
  jumper: 0x9b8fe6,
  plate: 0xf4f1ff,
  plus: 0xffd15c,
  minus: 0x8f83d6,
  battery: 0x8fb2ff,
  batteryCap: 0xffd15c,
  ink: '#3a3358',
}

const WIRE_Y = 0.16
const WIRE_RADIUS = 0.075
export const REST_Y = 0.36

export type PieceView = {
  group: THREE.Group
  /** Inner group: squash, tilt and spin live here so the outer group's position stays clean. */
  inner: THREE.Group
  hit: THREE.Mesh
  part: Part
  setOhms(ohms: number): void
  /** 0 = cool, 1 = very hot. */
  setHeat(t: number): void
  setHighlight(on: boolean): void
  /** Capacitors only: −1..1, the stored charge as a share of the most it can hold here. */
  setCharge(f: number): void
  dispose(): void
}

export type SocketView = {
  id: SlotId
  pad: THREE.Mesh
  glow: THREE.Mesh
  ring: THREE.Mesh
}

export type BatteryMood = 'happy' | 'sleepy' | 'yikes'

/** Where the camera looks from: the point it looks at, and a sphere around that point (three.js Spherical). */
export type CameraPose = { tx: number; ty: number; tz: number; radius: number; theta: number; phi: number }
/** A framed view of part of the board, in board-local units. az: swing around the board (rad, + toward R₅); el: height above the board (rad). */
export type CameraShot = { x: number; z: number; span: number; az: number; el: number }

export type Scene = {
  renderer: THREE.WebGLRenderer
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  board: THREE.Group
  sockets: Record<SlotId, SocketView>
  battery: THREE.Group
  resize(w: number, h: number): void
  resetView(): void
  /** Screen space (CSS px) kept clear above the board, e.g. under a HUD. The board fits in what is left. */
  setInsetTop(px: number): void
  /**
   * The board point that appears directly under a board-local point from the camera: the spot on the plane
   * at height `ground` that the line from the camera through (x, y, z) hits. A part lifted above the board
   * looks like it is over this spot, not over the spot straight below the part.
   */
  groundUnder(x: number, y: number, z: number, ground?: number): Pt | null
  /** Board-local point under a pointer (NDC), on the plane pieces slide in. */
  boardPoint(ndc: THREE.Vector2, y?: number): Pt | null
  pickPiece(ndc: THREE.Vector2, pieces: readonly PieceView[]): PieceView | null
  pickBattery(ndc: THREE.Vector2): boolean
  makePiece(part: Part): PieceView
  /** Screen position (CSS px within the canvas) of a board-local point. */
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean }
  /** Per-path currents (A): WIRES order, then SLOT_IDS order. dt in seconds. */
  updateDots(wireI: ArrayLike<number>, slotI: Partial<Record<SlotId, number>>, arches: Partial<Record<SlotId, boolean>>, dt: number, reduced: boolean): void
  setBatteryMood(mood: BatteryMood, blink: boolean): void
  setPortrait(portrait: boolean): void
  /** The camera's pose right now. */
  cameraPose(): CameraPose
  /** The pose that frames a shot, or the whole board for null. */
  shotPose(shot: CameraShot | null): CameraPose
  /** Put the camera at a pose (used every frame while the app flies the camera). */
  applyPose(p: CameraPose): void
  render(): void
  dispose(): void
}

export function createScene(canvas: HTMLCanvasElement, pixelRatio: number): Scene | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setPixelRatio(pixelRatio)
  renderer.setClearColor(0x000000, 0)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(x: T): T => { disposables.push(x); return x }

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.rotateSpeed = 0.5
  controls.minPolarAngle = 0.2
  controls.maxPolarAngle = 1.0

  // Soft, warm studio light: a sky/ground fill and one key that throws soft shadows.
  scene.add(new THREE.HemisphereLight(0xfaf6ff, 0xd8ccef, 1.6))
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1)
  key.position.set(-3.5, 9, 6)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0005
  const sc = key.shadow.camera
  sc.left = -8; sc.right = 8; sc.top = 8; sc.bottom = -8; sc.near = 1; sc.far = 30
  scene.add(key)

  const board = new THREE.Group()
  scene.add(board)

  // The board: a thick rounded slab, like a mochi tray.
  const slab = new THREE.Mesh(
    track(new RoundedBoxGeometry(11.0, 0.5, 5.9, 5, 0.32)),
    track(new THREE.MeshStandardMaterial({ color: PALETTE.board, roughness: 0.92 })),
  )
  slab.position.y = -0.25
  slab.receiveShadow = true
  board.add(slab)
  const rim = new THREE.Mesh(
    track(new RoundedBoxGeometry(11.3, 0.4, 6.2, 5, 0.3)),
    track(new THREE.MeshStandardMaterial({ color: PALETTE.boardRim, roughness: 0.95 })),
  )
  rim.position.y = -0.36
  board.add(rim)

  // Wires and their round joints.
  const wireMat = track(new THREE.MeshStandardMaterial({ color: PALETTE.wire, roughness: 0.55 }))
  const jointMat = track(new THREE.MeshStandardMaterial({ color: PALETTE.joint, roughness: 0.5 }))
  const unitCyl = track(new THREE.CylinderGeometry(WIRE_RADIUS, WIRE_RADIUS, 1, 16))
  const jointGeo = track(new THREE.SphereGeometry(0.12, 20, 14))
  const segment = (p: Pt, q: Pt) => {
    const m = new THREE.Mesh(unitCyl, wireMat)
    const dx = q.x - p.x, dz = q.z - p.z
    const len = Math.hypot(dx, dz)
    m.scale.y = len
    m.position.set((p.x + q.x) / 2, WIRE_Y, (p.z + q.z) / 2)
    // a cylinder is built along y; lay it down along the segment
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, 0, dz).normalize())
    m.castShadow = true
    board.add(m)
  }
  for (const [a, b] of WIRES) segment(NODES[a]!, NODES[b]!)
  const jointNodes = new Set<number>()
  for (const [a, b] of WIRES) { jointNodes.add(a); jointNodes.add(b) }
  for (const id of SLOT_IDS) { jointNodes.delete(SLOTS[id].a); jointNodes.delete(SLOTS[id].b) }
  jointNodes.delete(0); jointNodes.delete(2)
  for (const n of jointNodes) {
    const p = NODES[n]!
    const j = new THREE.Mesh(jointGeo, jointMat)
    j.position.set(p.x, WIRE_Y, p.z)
    j.castShadow = true
    board.add(j)
  }

  // Sockets: a soft pad, two terminal cups, a glow that the app turns up as a part comes near.
  const padGeo = track(new RoundedBoxGeometry(SLOT_LENGTH + 0.3, 0.04, 0.78, 3, 0.02))
  const glowGeo = track(new RoundedBoxGeometry(SLOT_LENGTH + 0.5, 0.02, 0.98, 3, 0.01))
  const ringGeo = track(new THREE.RingGeometry(0.62, 0.7, 48))
  const cupGeo = track(new THREE.CylinderGeometry(0.17, 0.2, 0.2, 24))
  const cupMat = track(new THREE.MeshStandardMaterial({ color: PALETTE.cup, roughness: 0.4 }))
  const sockets = {} as Record<SlotId, SocketView>
  for (const id of SLOT_IDS) {
    const s = SLOTS[id]
    const g = new THREE.Group()
    g.position.set(s.center.x, 0, s.center.z)
    if (s.vertical) g.rotation.y = Math.PI / 2
    const pad = new THREE.Mesh(padGeo, track(new THREE.MeshStandardMaterial({ color: PALETTE.pad, roughness: 0.8, transparent: true, opacity: 0.55 })))
    pad.position.y = 0.02
    pad.receiveShadow = true
    const glow = new THREE.Mesh(glowGeo, track(new THREE.MeshBasicMaterial({ color: PALETTE.glow, transparent: true, opacity: 0, depthWrite: false })))
    glow.position.y = 0.01
    const ring = new THREE.Mesh(ringGeo, track(new THREE.MeshBasicMaterial({ color: PALETTE.glow, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide })))
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.06
    g.add(glow, pad, ring)
    for (const sx of [-SLOT_LENGTH / 2, SLOT_LENGTH / 2]) {
      const cup = new THREE.Mesh(cupGeo, cupMat)
      cup.position.set(sx, 0.1, 0)
      cup.castShadow = true
      g.add(cup)
    }
    board.add(g)
    sockets[id] = { id, pad, glow, ring }
  }

  // The battery: a round blueberry cell lying along the left edge, + end toward the top wire, with a face.
  const battery = new THREE.Group()
  battery.position.set(BATTERY_CENTER.x, 0.42, BATTERY_CENTER.z)
  const cellGeo = track(new THREE.CapsuleGeometry(0.42, 1.0, 10, 24))
  const cell = new THREE.Mesh(cellGeo, track(new THREE.MeshStandardMaterial({ color: PALETTE.battery, roughness: 0.45 })))
  cell.rotation.x = Math.PI / 2
  cell.castShadow = true
  const cap = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.2, 0.2, 0.22, 24)),
    track(new THREE.MeshStandardMaterial({ color: PALETTE.batteryCap, roughness: 0.35 })),
  )
  cap.rotation.x = Math.PI / 2
  cap.position.z = -0.92
  cap.castShadow = true
  const band = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.43, 0.43, 0.32, 32, 1, true)),
    track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })),
  )
  band.rotation.x = Math.PI / 2
  band.position.z = -0.5
  const faceCanvas = document.createElement('canvas')
  faceCanvas.width = 256; faceCanvas.height = 160
  const faceTex = track(new THREE.CanvasTexture(faceCanvas))
  faceTex.colorSpace = THREE.SRGBColorSpace
  const face = new THREE.Mesh(
    track(new THREE.PlaneGeometry(0.72, 0.45)),
    track(new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false })),
  )
  face.rotation.x = -Math.PI / 2
  face.position.set(0, 0.425, 0.12)
  battery.add(cell, cap, band, face)
  battery.traverse(o => { o.userData.battery = true })
  board.add(battery)

  let mood: BatteryMood | null = null
  let blinking = false
  const drawFace = () => {
    const c = faceCanvas.getContext('2d')!
    c.clearRect(0, 0, 256, 160)
    c.strokeStyle = PALETTE.ink
    c.fillStyle = PALETTE.ink
    c.lineCap = 'round'
    c.lineWidth = 11
    const eye = (x: number) => {
      if (blinking || mood === 'sleepy') { c.beginPath(); c.moveTo(x - 16, 62); c.lineTo(x + 16, 62); c.stroke() }
      else if (mood === 'yikes') { c.beginPath(); c.moveTo(x - 14, 48); c.lineTo(x + 10, 62); c.lineTo(x - 14, 76); c.stroke() }
      else { c.beginPath(); c.arc(x, 60, 13, 0, Math.PI * 2); c.fill() }
    }
    eye(84)
    c.save(); c.translate(256, 0); c.scale(-1, 1); eye(84); c.restore()
    // cheeks
    c.fillStyle = 'rgba(255,143,163,0.55)'
    c.beginPath(); c.ellipse(50, 98, 18, 11, 0, 0, Math.PI * 2); c.fill()
    c.beginPath(); c.ellipse(206, 98, 18, 11, 0, 0, Math.PI * 2); c.fill()
    c.lineWidth = 9
    c.beginPath()
    if (mood === 'happy') c.arc(128, 88, 22, 0.15 * Math.PI, 0.85 * Math.PI)
    else if (mood === 'sleepy') c.arc(128, 104, 8, 0, Math.PI * 2)
    else { c.moveTo(100, 108); c.quadraticCurveTo(114, 94, 128, 108); c.quadraticCurveTo(142, 122, 156, 108) }
    c.stroke()
    faceTex.needsUpdate = true
  }

  // Current dots: one instanced mesh, a fixed number of dots per path, phase advanced by the solved current.
  type Path = { a: Pt; b: Pt; len: number; n: number; start: number; phase: number; speed: number; slot?: SlotId }
  const paths: Path[] = []
  const SPACING = 0.34
  let total = 0
  const addPath = (a: Pt, b: Pt, slot?: SlotId) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const n = Math.max(1, Math.round(len / SPACING))
    paths.push({ a, b, len, n, start: total, phase: Math.random(), speed: 0, slot })
    total += n
  }
  for (const [a, b] of WIRES) addPath(NODES[a]!, NODES[b]!)
  for (const id of SLOT_IDS) addPath(NODES[SLOTS[id].a]!, NODES[SLOTS[id].b]!, id)
  const dotGeo = track(new THREE.SphereGeometry(0.068, 12, 8))
  const dotMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }))
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, total)
  dots.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  board.add(dots)
  const tmpM = new THREE.Matrix4()
  const tmpC = new THREE.Color()
  const hotC = new THREE.Color(PALETTE.dot)
  const idleC = new THREE.Color(PALETTE.dotIdle)
  const zeroScale = new THREE.Matrix4().makeScale(0, 0, 0)

  const raycaster = new THREE.Raycaster()
  const plane = new THREE.Plane()
  const hitPoint = new THREE.Vector3()
  const sightRay = new THREE.Ray()
  let fitDistance = 18
  let portrait = false
  let width = 1, height = 1
  let insetTop = 0

  const fit = () => {
    const avail = Math.max(120, height - insetTop)
    const aspect = width / avail
    camera.aspect = aspect
    // board footprint in world space after the portrait turn
    const W = portrait ? 6.6 : 11.8
    const D = portrait ? 11.8 : 6.6
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const elev = 0.95 // radians above the horizon
    const dVert = (D * Math.sin(elev) + 1.2) / (2 * t)
    const dHorz = W / (2 * t * aspect)
    fitDistance = Math.max(dVert, dHorz) * 1.1
    controls.minDistance = fitDistance * 0.28
    controls.maxDistance = fitDistance * 1.5
    // Fit to the area below the inset, then widen the view upward to the full canvas: the board sits lower
    // on screen at the same size, and projection, picking and labels all stay consistent.
    if (insetTop > 0) camera.setViewOffset(width, avail, 0, -insetTop, width, height)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  }
  const resetView = () => {
    const elev = 0.95
    camera.position.set(0, Math.sin(elev) * fitDistance, Math.cos(elev) * fitDistance)
    controls.target.set(0, 0, 0.15)
    camera.lookAt(controls.target)
    controls.update()
  }


  const toNDCRay = (ndc: THREE.Vector2) => raycaster.setFromCamera(ndc, camera)

  const OVERVIEW_EL = 0.95
  const sph = new THREE.Spherical()
  const tmpV = new THREE.Vector3()
  const cameraPose = (): CameraPose => {
    tmpV.copy(camera.position).sub(controls.target)
    sph.setFromVector3(tmpV)
    return { tx: controls.target.x, ty: controls.target.y, tz: controls.target.z, radius: sph.radius, theta: sph.theta, phi: sph.phi }
  }
  const shotPose = (shot: CameraShot | null): CameraPose => {
    if (!shot) return { tx: 0, ty: 0, tz: 0.15, radius: fitDistance, theta: 0, phi: Math.PI / 2 - OVERVIEW_EL }
    board.updateMatrixWorld()
    const t = board.localToWorld(new THREE.Vector3(shot.x, 0.25, shot.z))
    // fit a circle of diameter span inside the narrower of the two view angles
    const v = THREE.MathUtils.degToRad(camera.fov) / 2
    const h = Math.atan(Math.tan(v) * camera.aspect)
    const radius = THREE.MathUtils.clamp((shot.span / 2) / Math.tan(Math.min(v, h)) * 1.08 + 0.8, controls.minDistance, controls.maxDistance)
    // stay inside the orbit limits so the controls never snap the camera on the next update
    const phi = THREE.MathUtils.clamp(Math.PI / 2 - shot.el, controls.minPolarAngle, controls.maxPolarAngle)
    return { tx: t.x, ty: t.y, tz: t.z, radius, theta: shot.az, phi }
  }
  const applyPose = (p: CameraPose) => {
    controls.target.set(p.tx, p.ty, p.tz)
    sph.set(p.radius, p.phi, p.theta)
    camera.position.setFromSpherical(sph).add(controls.target)
    camera.lookAt(controls.target)
  }

  return {
    renderer,
    camera,
    controls,
    board,
    sockets,
    battery,
    resize(w, h) {
      if (w === 0 || h === 0) return
      width = w; height = h
      renderer.setSize(w, h, false)
      fit()
      resetView()
    },
    resetView,
    setInsetTop(px) {
      if (Math.abs(px - insetTop) < 1) return
      insetTop = px
      fit()
      resetView()
    },
    groundUnder(x, y, z, ground = REST_Y) {
      board.updateMatrixWorld()
      const w = board.localToWorld(new THREE.Vector3(x, y, z))
      sightRay.set(camera.position, w.sub(camera.position).normalize())
      plane.set(new THREE.Vector3(0, 1, 0), -ground)
      if (!sightRay.intersectPlane(plane, hitPoint)) return null
      const local = board.worldToLocal(hitPoint.clone())
      return { x: local.x, z: local.z }
    },
    boardPoint(ndc, y = REST_Y) {
      toNDCRay(ndc)
      board.updateMatrixWorld()
      plane.set(new THREE.Vector3(0, 1, 0), -y)
      if (!raycaster.ray.intersectPlane(plane, hitPoint)) return null
      const local = board.worldToLocal(hitPoint.clone())
      return { x: local.x, z: local.z }
    },
    pickPiece(ndc, pieces) {
      toNDCRay(ndc)
      const hits = raycaster.intersectObjects(pieces.map(p => p.hit), false)
      const h = hits[0]
      return h ? pieces.find(p => p.hit === h.object) ?? null : null
    },
    pickBattery(ndc) {
      toNDCRay(ndc)
      return raycaster.intersectObject(battery, true).length > 0
    },
    makePiece(part) {
      return makePieceView(part)
    },
    project(x, y, z) {
      const v = board.localToWorld(new THREE.Vector3(x, y, z)).project(camera)
      return { x: (v.x * 0.5 + 0.5) * width, y: (-v.y * 0.5 + 0.5) * height, visible: v.z < 1 }
    },
    updateDots(wireI, slotI, arches, dt, reduced) {
      paths.forEach((p, k) => {
        const I = p.slot ? slotI[p.slot] : wireI[k]
        const present = p.slot ? I !== undefined : true
        const cur = I ?? 0
        // Speed ∝ I, capped so a huge current still reads as motion. Eased toward the target so a
        // change reads as the current picking up or slowing down.
        const target = Math.max(-4.5, Math.min(4.5, cur * 0.85))
        p.speed += (target - p.speed) * (1 - Math.exp(-dt * (reduced ? 30 : 5)))
        p.phase = (p.phase + (p.speed * dt) / p.len) % 1
        if (p.phase < 0) p.phase += 1
        const lit = Math.min(1, Math.abs(cur) / 0.5)
        tmpC.copy(idleC).lerp(hotC, lit)
        const arch = p.slot && arches[p.slot] ? 0.42 : 0
        for (let i = 0; i < p.n; i++) {
          const idx = p.start + i
          if (!present) { dots.setMatrixAt(idx, zeroScale); continue }
          const t = (i / p.n + p.phase) % 1
          const x = p.a.x + (p.b.x - p.a.x) * t
          const z = p.a.z + (p.b.z - p.a.z) * t
          const y = WIRE_Y + 0.02 + arch * 4 * t * (1 - t)
          const s = 0.75 + 0.35 * lit
          tmpM.makeScale(s, s, s).setPosition(x, y, z)
          dots.setMatrixAt(idx, tmpM)
          dots.setColorAt(idx, tmpC)
        }
      })
      dots.instanceMatrix.needsUpdate = true
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true
    },
    setBatteryMood(m, blink) {
      if (m === mood && blink === blinking) return
      mood = m; blinking = blink
      drawFace()
    },
    setPortrait(p) {
      portrait = p
      board.rotation.y = p ? -Math.PI / 2 : 0
      // keep the battery's face upright on screen
      face.rotation.z = p ? -Math.PI / 2 : 0
      fit()
      resetView()
    },
    cameraPose: () => cameraPose(),
    shotPose: shot => shotPose(shot),
    applyPose: p => applyPose(p),
    render() {
      controls.update()
      renderer.render(scene, camera)
    },
    dispose() {
      controls.dispose()
      dots.dispose()
      for (const d of disposables) d.dispose()
      renderer.dispose()
    },
  }

  function makePieceView(part: Part): PieceView {
    const group = new THREE.Group()
    const inner = new THREE.Group()
    group.add(inner)
    const own: { dispose(): void }[] = []
    const mk = <T extends { dispose(): void }>(x: T): T => { own.push(x); return x }
    const half = SLOT_LENGTH / 2
    const leadMat = mk(new THREE.MeshStandardMaterial({ color: PALETTE.lead, roughness: 0.4, metalness: 0.1 }))
    const footMat = mk(new THREE.MeshStandardMaterial({ color: PALETTE.cup, roughness: 0.4 }))
    let bodyMat: THREE.MeshStandardMaterial | null = null
    const bandMats: THREE.MeshStandardMaterial[] = []
    const plateMats: THREE.MeshStandardMaterial[] = []

    // feet that sit in the socket cups
    const foot = mk(new THREE.SphereGeometry(0.13, 16, 12))
    for (const sx of [-half, half]) {
      const f = new THREE.Mesh(foot, footMat)
      f.position.set(sx, WIRE_Y - REST_Y + 0.02, 0)
      f.castShadow = true
      inner.add(f)
    }

    if (part.kind === 'resistor') {
      // leads: from each foot up into the body
      const leadGeo = mk(new THREE.CylinderGeometry(0.045, 0.045, 1, 10))
      for (const sx of [-1, 1]) {
        const lead = new THREE.Mesh(leadGeo, leadMat)
        const from = new THREE.Vector3(sx * half, WIRE_Y - REST_Y + 0.02, 0)
        const to = new THREE.Vector3(sx * 0.5, 0, 0)
        lead.position.copy(from).add(to).multiplyScalar(0.5)
        lead.scale.y = from.distanceTo(to)
        lead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
        lead.castShadow = true
        inner.add(lead)
      }
      // a plump capsule body
      bodyMat = mk(new THREE.MeshStandardMaterial({ color: PALETTE.body, roughness: 0.55, emissive: new THREE.Color(PALETTE.hot), emissiveIntensity: 0 }))
      const body = new THREE.Mesh(mk(new THREE.CapsuleGeometry(0.27, 0.62, 10, 24)), bodyMat)
      body.rotation.z = Math.PI / 2
      body.castShadow = true
      inner.add(body)
      // three code bands + a gold tolerance band
      const bandGeo = mk(new THREE.CylinderGeometry(0.282, 0.282, 0.075, 28))
      const xs = [-0.26, -0.11, 0.04, 0.27]
      xs.forEach((x, i) => {
        const m = mk(new THREE.MeshStandardMaterial({ color: i === 3 ? BAND_HEX.gold : 0xffffff, roughness: 0.5 }))
        if (i < 3) bandMats.push(m)
        const b = new THREE.Mesh(bandGeo, m)
        b.rotation.z = Math.PI / 2
        b.position.x = x
        inner.add(b)
      })
    } else if (part.kind === 'capacitor') {
      // two round plates facing each other across a small gap, on short leads
      const leadGeo = mk(new THREE.CylinderGeometry(0.045, 0.045, 1, 10))
      for (const sx of [-1, 1]) {
        const lead = new THREE.Mesh(leadGeo, leadMat)
        const from = new THREE.Vector3(sx * half, WIRE_Y - REST_Y + 0.02, 0)
        const to = new THREE.Vector3(sx * 0.16, 0, 0)
        lead.position.copy(from).add(to).multiplyScalar(0.5)
        lead.scale.y = from.distanceTo(to)
        lead.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize())
        lead.castShadow = true
        inner.add(lead)
      }
      const plateGeo = mk(new THREE.CylinderGeometry(0.36, 0.36, 0.09, 36))
      for (const sx of [-1, 1]) {
        const m = mk(new THREE.MeshStandardMaterial({ color: PALETTE.plate, roughness: 0.4, emissive: new THREE.Color(sx < 0 ? PALETTE.plus : PALETTE.minus), emissiveIntensity: 0 }))
        plateMats.push(m)
        const plate = new THREE.Mesh(plateGeo, m)
        plate.rotation.z = Math.PI / 2
        plate.position.x = sx * 0.13
        plate.castShadow = true
        inner.add(plate)
      }
      bodyMat = plateMats[0]!
    } else {
      // the jumper: a chunky grape arch from foot to foot
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-half, WIRE_Y - REST_Y + 0.02, 0),
        new THREE.Vector3(0, 0.55, 0),
        new THREE.Vector3(half, WIRE_Y - REST_Y + 0.02, 0),
      )
      bodyMat = mk(new THREE.MeshStandardMaterial({ color: PALETTE.jumper, roughness: 0.5, emissive: new THREE.Color(PALETTE.glow), emissiveIntensity: 0 }))
      const arch = new THREE.Mesh(mk(new THREE.TubeGeometry(curve, 40, 0.11, 14, false)), bodyMat)
      arch.castShadow = true
      inner.add(arch)
    }

    // A generous invisible grab box, so a fingertip finds the part easily.
    const hit = new THREE.Mesh(
      mk(new THREE.BoxGeometry(SLOT_LENGTH + 0.2, 1.0, 1.0)),
      mk(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false })),
    )
    hit.position.y = -0.05
    group.add(hit)
    board.add(group)

    const coolBody = new THREE.Color(PALETTE.body)
    const hotBody = new THREE.Color(PALETTE.hot)
    let heat = 0
    let highlighted = false
    const paint = () => {
      if (!bodyMat) return
      if (part.kind === 'resistor') {
        bodyMat.color.copy(coolBody).lerp(hotBody, heat * 0.8)
        bodyMat.emissiveIntensity = heat * 0.35 + (highlighted ? 0.25 : 0)
        bodyMat.emissive.set(highlighted && heat < 0.2 ? PALETTE.glow : PALETTE.hot)
      } else if (part.kind === 'wire') {
        bodyMat.emissiveIntensity = highlighted ? 0.35 : 0
      }
    }

    return {
      group,
      inner,
      hit,
      part,
      setOhms(ohms) {
        if (part.kind !== 'resistor') return
        const bands = colorBands(ohms)
        bands.forEach((b, i) => bandMats[i]!.color.set(BAND_HEX[b]))
        part.ohms = ohms
      },
      setHeat(t) { heat = Math.max(0, Math.min(1, t)); paint() },
      setCharge(f) {
        if (part.kind !== 'capacitor') return
        // the a-end plate (left in the piece) holds +q when f > 0; colors swap when the charge flips
        const k = Math.min(1, Math.abs(f))
        const [left, right] = plateMats as [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial]
        left.emissive.set(f >= 0 ? PALETTE.plus : PALETTE.minus)
        right.emissive.set(f >= 0 ? PALETTE.minus : PALETTE.plus)
        const glow = 0.15 + 0.85 * k
        left.emissiveIntensity = k * glow + (highlighted ? 0.2 : 0)
        right.emissiveIntensity = k * glow + (highlighted ? 0.2 : 0)
      },
      setHighlight(on) { highlighted = on; paint() },
      dispose() {
        board.remove(group)
        for (const d of own) d.dispose()
      },
    }
  }
}
