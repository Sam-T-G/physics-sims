import * as THREE from 'three'

/**
 * One arrow glyph: a cylinder shaft and a cone head sharing one material, pointing along +y in its own
 * frame, with an optional text label that rides just past the tip. Allocate once; place per frame.
 */
export type Arrow = {
  object: THREE.Group
  set(from: THREE.Vector3 | { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): void
  /** Place by origin, direction (any length) and drawn length. */
  setDirection(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, length: number): void
  setColor(color: string): void
  setVisible(on: boolean): void
  /** Text shown past the tip (e.g. "E", "a", "n̂"); null removes it. Needs the factory's document. */
  setLabel(text: string | null): void
}

export type ArrowFactory = {
  /** labelAt 'middle' puts the label beside the shaft, for arrows that share a tip with another. */
  make(color: string, radius?: number, label?: string, labelAt?: 'tip' | 'middle'): Arrow
  dispose(): void
}

const UP = new THREE.Vector3(0, 1, 0)
const LABEL_HEIGHT = 0.11

/**
 * Shares the shaft and head geometries across every arrow it makes. Labels are drawn on canvases from the
 * document passed in (layer 2 never touches a global document) and cached per text and color.
 */
export function createArrows(doc?: Document): ArrowFactory {
  const shaftGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1)
  shaftGeo.translate(0, 0.5, 0)
  const headGeo = new THREE.ConeGeometry(1, 1, 16, 1)
  headGeo.translate(0, 0.5, 0)
  const materials: THREE.Material[] = []
  const labelCache = new Map<string, { tex: THREE.CanvasTexture; aspect: number }>()
  const tmpDir = new THREE.Vector3()
  const tmpQuat = new THREE.Quaternion()

  const labelTexture = (text: string, color: string) => {
    const key = `${color}|${text}`
    const hit = labelCache.get(key)
    if (hit) return hit
    const canvas = doc!.createElement('canvas')
    const g = canvas.getContext('2d')!
    const px = 96
    // Italic serif, like the symbols in a textbook; it also draws combining marks (the hat on n̂) cleanly.
    const font = `italic 600 ${px}px "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`
    g.font = font
    const w = Math.ceil(g.measureText(text).width + px * 0.5)
    canvas.width = w
    canvas.height = Math.ceil(px * 1.4)
    g.font = font
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    // A dark halo keeps the label readable over lines and surfaces.
    g.lineWidth = px * 0.16
    g.strokeStyle = 'rgba(8, 14, 28, 0.85)'
    g.strokeText(text, w / 2, canvas.height / 2)
    g.fillStyle = color
    g.fillText(text, w / 2, canvas.height / 2)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const entry = { tex, aspect: w / canvas.height }
    labelCache.set(key, entry)
    return entry
  }

  return {
    make(color, radius = 0.02, label, labelAt = 'tip') {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0 })
      materials.push(material)
      const shaft = new THREE.Mesh(shaftGeo, material)
      const head = new THREE.Mesh(headGeo, material)
      const object = new THREE.Group()
      object.add(shaft, head)
      let colorCss = color
      let labelText: string | null = null
      let sprite: THREE.Sprite | null = null
      let spriteMat: THREE.SpriteMaterial | null = null
      let length = 0

      const paintLabel = () => {
        if (!sprite || !spriteMat || !labelText || !doc) return
        const { tex, aspect } = labelTexture(labelText, colorCss)
        spriteMat.map = tex
        spriteMat.needsUpdate = true
        sprite.scale.set(LABEL_HEIGHT * aspect, LABEL_HEIGHT, 1)
      }
      const placeLabel = () => {
        if (!sprite) return
        // Local +y runs along the arrow; for an arrow in the screen plane local +x stays in that plane.
        if (labelAt === 'middle') sprite.position.set(LABEL_HEIGHT * 1.1, length * 0.5, 0)
        else sprite.position.set(0, length + LABEL_HEIGHT * 0.9, 0)
      }
      const setLabel = (text: string | null) => {
        if (text === labelText) return
        labelText = text
        if (!text || !doc) {
          if (sprite) sprite.visible = false
          return
        }
        if (!sprite) {
          spriteMat = new THREE.SpriteMaterial({ transparent: true, depthTest: false, depthWrite: false })
          materials.push(spriteMat)
          sprite = new THREE.Sprite(spriteMat)
          sprite.renderOrder = 30
          object.add(sprite)
        }
        sprite.visible = true
        paintLabel()
        placeLabel()
      }

      const place = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number) => {
        tmpDir.set(dx, dy, dz)
        if (tmpDir.lengthSq() === 0 || !(len > 0)) {
          object.visible = false
          return
        }
        object.visible = true
        tmpDir.normalize()
        object.position.set(ox, oy, oz)
        tmpQuat.setFromUnitVectors(UP, tmpDir)
        object.quaternion.copy(tmpQuat)
        const headLen = Math.min(0.12, len * 0.35)
        const headR = radius * 2.6
        shaft.scale.set(radius, Math.max(0, len - headLen), radius)
        head.position.set(0, Math.max(0, len - headLen), 0)
        head.scale.set(headR, headLen, headR)
        length = len
        placeLabel()
      }
      if (label) setLabel(label)
      return {
        object,
        set(from, to) {
          const dx = to.x - from.x
          const dy = to.y - from.y
          const dz = to.z - from.z
          place(from.x, from.y, from.z, dx, dy, dz, Math.sqrt(dx * dx + dy * dy + dz * dz))
        },
        setDirection(origin, dir, len) {
          place(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, len)
        },
        setColor(c) {
          if (c === colorCss) return
          colorCss = c
          material.color.set(c)
          paintLabel()
        },
        setVisible(on) {
          object.visible = on
        },
        setLabel,
      }
    },
    dispose() {
      shaftGeo.dispose()
      headGeo.dispose()
      for (const m of materials) m.dispose()
      for (const { tex } of labelCache.values()) tex.dispose()
    },
  }
}
