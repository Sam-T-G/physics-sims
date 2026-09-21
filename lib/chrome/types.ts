/** What every sim exports so the study-tools hub can build its own index. */
export type SimMeta = {
  id: string
  title: string
  section: string
  chapters: string
  concept: string
  /** The one-sentence test from the sim's brief. */
  test: string
  coverage: { covers: string[]; notCovered: string[] }
}

/** A camera preset: where the camera sits and what it looks at, in scene units. */
export type CameraPreset = { position: [number, number, number]; target: [number, number, number] }

/** The words on a chapter card. Every field is plain text; the chrome sets it with textContent. */
export type BeatContent = {
  /** Short chapter label shown in the rail and the card, e.g. "3b". */
  label: string
  title: string
  /** Curriculum anchor, e.g. "OpenStax 5.3". */
  anchor: string
  /** The what-do-you-see line. It opens the card, before any label or equation. */
  prompt?: string
  body: string
}

/** A tool-belt item. It appears the moment its beat is entered and jumps back there on tap. */
export type ToolItem = {
  id: string
  name: string
  equation: string
  note?: string
  /** Index of the beat that introduces it. */
  beat: number
}
