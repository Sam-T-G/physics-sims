import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

/** Renderer, scene, camera, lights and orbit controls for one sim. Layer 2: no gsap, no DOM beyond the canvas. */
export type Stage = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  /** CSS pixel size of the mount. Call from a ResizeObserver on the mount element, never on window. */
  resize(width: number, height: number): void
  render(): void
  dispose(): void
}

export type StageOptions = {
  /** CSS color for the scene background (read from --ps-bg by the app). */
  background: string
  /** Device pixel ratio to render at; the app caps it (2 on phones). Layer 2 never reads window itself. */
  pixelRatio: number
}

/** Returns null when the browser cannot create a WebGL context; the app then says so on the page. */
export function createStage(canvas: HTMLCanvasElement, opts: StageOptions): Stage | null {
  let renderer: THREE.WebGLRenderer
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  } catch {
    return null
  }
  renderer.setPixelRatio(opts.pixelRatio)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(opts.background)

  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100)
  camera.position.set(0, 1.2, 4.5)

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.enablePan = false
  controls.minDistance = 1.2
  controls.maxDistance = 12

  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(3, 4, 5)
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.7)
  fill.position.set(-4, -1, -3)
  const ambient = new THREE.AmbientLight(0xffffff, 0.35)
  scene.add(key, fill, ambient)

  return {
    renderer,
    scene,
    camera,
    controls,
    resize(width, height) {
      if (width === 0 || height === 0) return
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    },
    render() {
      controls.update()
      renderer.render(scene, camera)
    },
    dispose() {
      controls.dispose()
      renderer.dispose()
    },
  }
}
