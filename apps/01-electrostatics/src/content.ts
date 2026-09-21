import type { BeatContent, CameraPreset, ToolItem } from '@lib/chrome'

/** Beat order: 0 hook, 1 charge, 2 Coulomb, 3 field, 3b why squared, 4 flux, 5 Gauss, 6 symmetry. */
export const BEAT_INDEX = { hook: 0, charge: 1, coulomb: 2, field: 3, whySquared: 4, flux: 5, gauss: 6, symmetry: 7 } as const

export type BeatCopy = BeatContent & { id: string; scene?: 'spheres' | 'gauss'; tools?: readonly string[] }

/**
 * Card copy from the beat sheet (sims/01-charge-field-flux.md), written the way a student explains it to a
 * friend: plain words, short sentences, no lecture voice. Beats without a scene are text cards until stage 6.
 */
export const BEATS: readonly BeatCopy[] = [
  {
    id: 'hook',
    label: '0',
    title: 'Nothing touched it',
    anchor: 'OpenStax 5.1',
    body: 'Two little charged balls hanging on strings. Push one toward the other and it swings away before they ever touch. Flip one charge and it swings toward instead. Nothing touched it. Something is reaching across the gap, and by the end of this you will know why one number about it refuses to change.',
  },
  {
    id: 'charge',
    label: '1',
    title: 'Charge',
    anchor: 'OpenStax 5.1',
    prompt: 'What does the total say?',
    body: 'Charge comes in two flavors, plus and minus, and the sign is always drawn on so you are never guessing from color. Same sign push apart, opposite signs pull together. Pull a neutral pair apart and you get a + and a − at the same time, so the total never changes. And it only comes in whole chunks of e.',
    tools: ['charge'],
  },
  {
    id: 'coulomb',
    label: '2',
    title: 'Coulomb’s law',
    anchor: 'OpenStax 5.3',
    prompt: 'Drag q₂. Keep an eye on the arrow on q₁.',
    body: 'Two charges push or pull on each other with the exact same force, always, even when one is huge and the other is tiny. That is F = k q₁q₂ / r². Throw in a third charge and the force on any one of them is just the two pair forces added tip to tail.',
    tools: ['coulomb', 'superposition'],
  },
  {
    id: 'field',
    label: '3',
    title: 'The field',
    anchor: 'OpenStax 5.4, 5.6, 5.7',
    prompt: 'The probe is gone. What is still there?',
    body: 'Take q₂ away and drop a tiny test charge q₀ anywhere: it still feels a push. Swap it for +2 or −1 and the push changes, but push ÷ q₀ does not. That ratio is the field, E, and it is sitting there whether or not anything is around to feel it. Field lines start on + (or way out at infinity), end on − (or infinity), never cross, and bunch up where the field is strong.',
    tools: ['field', 'lines'],
  },
  {
    id: 'whySquared',
    label: '3b',
    title: 'Why squared?',
    anchor: 'OpenStax 5.6, with a sneak peek at 6.2',
    prompt: 'Count the lines crossing each sphere.',
    body: 'One charge, N lines shooting out of it, and three spheres at r, 2r and 3r. Every sphere gets crossed by the same N lines. But their areas are 4πr², 16πr² and 36πr², so the lines get spread thinner: the density drops to 1, then ¼, then ⅑. Same lines, bigger surface, and the surface grows as r². That is where the squared comes from.',
    scene: 'spheres',
  },
  {
    id: 'flux',
    label: '4',
    title: 'Flux',
    anchor: 'OpenStax 6.1',
    prompt: 'Tilt the loop. What happens to the count?',
    body: 'Picture a flat loop sitting in a field that is the same everywhere. Lines poke through it. Tilt the loop and fewer lines make it through, until it is edge-on and none do. That count is flux: Φ = EA cos θ. It is about lines going through, not lines brushing past.',
    tools: ['flux'],
  },
  {
    id: 'gauss',
    label: '5',
    title: 'Gauss’s law',
    anchor: 'OpenStax 6.2',
    prompt: 'Watch the number as the cap closes.',
    body: 'Wrap a closed surface around the charge and the flux locks in at q/ε₀. Make the sphere twice as big, drag the charge anywhere inside, squash it into a cube or a blob: still the same number. Drag the charge outside and it drops to zero the instant it crosses. Toss a second charge inside and the number just adds it in.',
    scene: 'gauss',
    tools: ['gauss'],
  },
  {
    id: 'symmetry',
    label: '6',
    title: 'Always true, not always useful',
    anchor: 'OpenStax 6.3',
    prompt: 'Is the color the same everywhere?',
    body: 'Put a charge off-center inside a sphere. Gauss’s law tells you the total flux, but nothing about how strong E is at any one spot. Put a + and − pair inside: Φ = 0, but E is definitely not zero. Now slide the charge to the center. Suddenly |E| is the same everywhere on the surface, so you can pull it out of the integral: E · 4πr² = q/ε₀, and Coulomb’s law pops right back out.',
    tools: ['symmetry'],
  },
]

export const TOOLS: readonly ToolItem[] = [
  { id: 'charge', name: 'Charge', equation: 'Two kinds. Never made or destroyed. Comes in chunks of e.', beat: BEAT_INDEX.charge },
  { id: 'coulomb', name: 'Coulomb’s law', equation: 'F = k q₁q₂ / r²', note: 'Same size push on both charges, always. k = 8.99 × 10⁹ N·m²/C².', beat: BEAT_INDEX.coulomb },
  { id: 'superposition', name: 'Superposition', equation: 'F_net = F₁ + F₂ + …', note: 'Add the arrows tip to tail. Works for fields too.', beat: BEAT_INDEX.coulomb },
  { id: 'field', name: 'Field', equation: 'E = F / q₀', note: 'It is there whether or not anything is around to feel it.', beat: BEAT_INDEX.field },
  { id: 'lines', name: 'Field-line rules', equation: 'Start on +, end on −, or head off to infinity.', note: 'Never cross. Bunch up where the field is strong.', beat: BEAT_INDEX.field },
  { id: 'flux', name: 'Flux', equation: 'Φ = ∫ E · dA', note: 'Lines going through, not lines brushing past.', beat: BEAT_INDEX.flux },
  { id: 'gauss', name: 'Gauss’s law', equation: 'Φ_closed = Q_enc / ε₀', note: 'Any closed surface. Any shape. Charge anywhere inside.', beat: BEAT_INDEX.gauss },
  { id: 'symmetry', name: 'Symmetry', equation: 'When Gauss actually hands you E', note: 'Only when |E| is the same size everywhere on the surface and points straight through it.', beat: BEAT_INDEX.symmetry },
]

/** Presets sit far enough back that the whole scene fits a phone's width with the card open. */
export const CAMERA: Record<'default' | 'spheres' | 'gauss', CameraPreset> = {
  default: { position: [0, 1.4, 6.0], target: [0, 0, 0] },
  spheres: { position: [1.2, 2.4, 8.4], target: [0, 0, 0] },
  gauss: { position: [4.4, 2.9, 6.4], target: [0, 0, 0] },
}

/** The four ways Φ can go, offered before every move in beat 5. */
export const PHI_CHOICES = [
  { id: 'up', label: 'Go up' },
  { id: 'down', label: 'Go down' },
  { id: 'stay', label: 'Stay the same' },
  { id: 'zero', label: 'Drop to zero' },
] as const

export type PhiChoice = (typeof PHI_CHOICES)[number]['id']

export type Prediction = { id: 'scale' | 'inside' | 'morph' | 'outside' | 'second'; question: string; truth: PhiChoice; reveal: string }

/** Beat 5's five predictions. Each is answered by a move, and the move is the reveal. */
export const PREDICTIONS: readonly Prediction[] = [
  {
    id: 'scale',
    question: 'Double the sphere’s radius. What happens to Φ?',
    truth: 'stay',
    reveal: 'It stays at 113, big or small. Twice the radius means each patch of surface gets ¼ the field, but there are 4× as many patches. Those cancel exactly, every time.',
  },
  {
    id: 'inside',
    question: 'Drag the charge somewhere else inside. Φ will…',
    truth: 'stay',
    reveal: 'Still 113. The faces near the charge get more field and the far ones get less, and the total doesn’t budge.',
  },
  {
    id: 'morph',
    question: 'Squash the sphere into a cube, then a blob. Φ will…',
    truth: 'stay',
    reveal: 'Still 113. The shape never mattered. What’s inside is all that counts.',
  },
  {
    id: 'outside',
    question: 'Drag the charge out through the surface. Φ will…',
    truth: 'zero',
    reveal: 'Zero, the instant it crosses. Now every line that goes in comes back out: the blue faces cancel the orange ones.',
  },
  {
    id: 'second',
    question: 'Bring it back inside and toss in a second +q. Φ will…',
    truth: 'up',
    reveal: 'It doubles to 226. Make that second charge −q instead and the two cancel to zero. Φ only cares about the total charge inside.',
  },
]

export const GAUSS_COPY = {
  open: 'Right now the surface is a bowl with a hole in the top, so some lines get out without crossing it. The number is only part of q/ε₀.',
  closeCap: 'Close the cap',
  closed: 'It locked in at q/ε₀ = 113 the moment the cap closed. Every line that starts on the charge has to leave through the surface somewhere.',
  flipped: 'Now every line comes in instead of going out, so Φ is −q/ε₀.',
  start: 'Try the predictions',
  nextPrediction: 'Next one',
  toCallback: 'So why can’t it move?',
  callback: 'E drops as 1/r². Area grows as r². Multiply them and r cancels out. Try a universe where E drops as 1/r or 1/r³ instead: the three spheres stop agreeing.',
  notOurs: 'not our universe',
  backToSurface: 'Back to the surface',
  play: 'Play with it',
  mcq: {
    question: 'A charge sits at some random spot inside this blob. Which tool gets you the flux?',
    answer: 'gauss',
    options: [
      { id: 'gauss', label: 'Gauss’s law', reason: 'Closed surface, charge inside: Φ = Q_enc/ε₀. Where the charge sits inside doesn’t matter.' },
      { id: 'coulomb', label: 'Coulomb’s law', reason: 'That gives you E at one point. To get the total flux from it you’d have to integrate over every face.' },
      { id: 'superposition', label: 'Superposition', reason: 'That’s for adding fields from several charges. There’s only one here, and you’d still be stuck integrating.' },
      { id: 'lines', label: 'Field-line rules', reason: 'Close, and it’s the picture behind the answer, but the tool that hands you the number is Gauss’s law.' },
    ],
  },
  mcqDone: 'Yep. Any closed surface, any shape, charge anywhere inside: Φ = Q_enc/ε₀.',
} as const

export const SPHERES_COPY = {
  count: 'Count them for me',
  afterCount: 'Same N through every sphere. The only thing that changes is how much surface those lines are spread over.',
  fourth: {
    question: 'Add a fourth sphere at 4r. How dense are the lines there, compared to the first sphere?',
    right: 'Yep, 1/16. Four times the radius means 16 times the area, so the same lines are spread 16× thinner.',
    wrong: (said: string) => `It’s 1/16, and you said ${said}. Four times the radius means 16 times the area (that’s the 4²), so the same N lines are spread 16× thinner.`,
  },
  table: { sphere: 'Sphere', lines: 'Lines through it', area: 'Area', density: 'Density' },
  labels: ['r', '2r', '3r', '4r'],
} as const

export const CAMERA_SCENES: Record<'pendulum' | 'pair' | 'coulomb' | 'field' | 'flux' | 'bundle' | 'bowl' | 'symmetry' | 'reveal', CameraPreset> = {
  pendulum: { position: [0, 0.1, 3.6], target: [0, -0.3, 0] },
  pair: { position: [0, 0.8, 4.6], target: [0, 0, 0] },
  coulomb: { position: [0.3, 1.2, 5.0], target: [0.1, 0.2, 0] },
  field: { position: [0, 0.9, 4.6], target: [0, -0.1, 0] },
  flux: { position: [1.3, 1.1, 3.6], target: [0, 0, 0] },
  bundle: { position: [3.6, 1.5, 2.6], target: [0.7, 0, 0] },
  bowl: { position: [2.6, 2.4, 5.0], target: [0, 0, -0.2] },
  symmetry: { position: [2.6, 2.0, 5.6], target: [0, 0, 0] },
  reveal: { position: [0, 2.0, 8.8], target: [0, 0, 0] },
}

export const HOOK_COPY = {
  note: 'Nothing touched it.',
  apart: 'How far apart the strings hang',
  signs: 'The two charges',
  same: 'same sign',
  opposite: 'opposite signs',
} as const

export const CHARGE_COPY = {
  pull: 'Pull them apart',
  amount: 'Charge on each',
  other: 'The other one',
  opposite: 'opposite',
  same: 'same',
  totalNothing: 'Two neutral blobs, stuck together.',
  totalPair: 'A + and a −, made together, so the total never moved.',
  totalSame: 'Two of the same sign: that second charge had to come from somewhere else.',
  conserved: 'Zero. Always zero for this pair: pull them apart, change how much, it never budges. That is conservation. And the counter only ever moves in whole steps of e: that is quantization.',
  mcq: {
    question: 'You rub a neutral rubber rod with fur and the rod ends up at −3e. What happened to the fur?',
    answer: 'plus3',
    options: [
      { id: 'plus3', label: '+3e, it lost three electrons', reason: 'Charge does not appear from nowhere. The rod’s three extra electrons came off the fur.' },
      { id: 'protons', label: 'It gained three protons', reason: 'Protons are stuck inside nuclei. Rubbing moves electrons, never protons.' },
      { id: 'neutral', label: 'Nothing, it stays neutral', reason: 'Then the total would have gone from 0 to −3e. The total never changes.' },
      { id: 'minus3', label: '−3e as well', reason: 'That would make the total −6e. It started at zero and it stays at zero.' },
    ],
  },
  mcqDone: 'Right. The tool that settles it is Charge: conserved.',
} as const

export const COULOMB_COPY = {
  r: 'Distance r',
  q1: 'q₁',
  q2: 'q₂',
  third: 'Third charge',
  off: 'off',
  on: 'on',
  thirdNote: 'Now q₂ feels two pushes. Lay them tip to tail and the net arrow is where you end up. That is superposition.',
  tips: {
    k: 'Just a constant. It sets the units: 8.99 × 10⁹ N·m²/C².',
    q1: 'Scrub this and the arrows on BOTH charges scale with it.',
    q2: 'Same deal. Either charge, both arrows.',
    r: 'Center to center. The line between them.',
    r2: 'Double r and the force drops to a quarter. That is the curve.',
  },
  predict: {
    question: 'Double r. The force becomes ___× as big.',
    right: 'A quarter. r² sits in the bottom of the fraction, so doubling r divides the force by four.',
    wrong: (said: string) => `It is a quarter, and you said ${said}. r² sits in the bottom of the fraction, so doubling r divides the force by four.`,
  },
  mcq: {
    question: 'Triple q₁. What happens to the two arrows?',
    answer: 'both',
    options: [
      { id: 'both', label: 'Both triple', reason: 'F = k q₁q₂/r² is the same force on both, always. Equal and opposite, no exceptions.' },
      { id: 'onq2', label: 'Only the arrow on q₂ triples', reason: 'q₂ feels q₁ more, sure, but q₁ feels q₂ exactly as hard. Same formula, same size.' },
      { id: 'onq1', label: 'Only the arrow on q₁ triples', reason: 'Same formula for both. If one triples, the other does too.' },
      { id: 'none', label: 'Nothing changes', reason: 'q₁ is right there in the formula. Triple it and the force triples.' },
    ],
  },
  mcqDone: 'Both tripled, and they are still equal and opposite. That is the third law, and you just watched it.',
} as const

export const FIELD_COPY = {
  probeX: 'Probe left/right',
  probeY: 'Probe up/down',
  q0: 'Probe charge q₀',
  takeAway: 'Take the probe away',
  stayed: 'The arrows stay. That is the field: an arrow at every point, there whether or not anything is around to feel it. Color is how strong, on a log scale.',
  sliceZ: 'Slice height',
  showLines: 'Show the field lines',
  rules: 'Lines start on + (or way out at infinity) and end on − (or infinity). They never cross. And they bunch up where the field is strong: in 3D, density tracks strength in proportion, not to the pixel.',
  sources: 'Sources',
  single: 'one +',
  dipole: '+ and −',
  like: '+ and +',
  tips: {
    F: 'The push on the probe. Changes when you swap the probe.',
    q0: 'Swap it for +2 or −1: F changes, F ÷ q₀ does not.',
    E: 'Force per unit charge. It belongs to the point, not the probe.',
  },
  compass1: 'A + on the left, a − on the right. At the point right between them, which way does E point?',
  compass2: 'Now both are +. At a point straight above the middle, which way does E point?',
  compassRight: 'Yep. Both pieces are drawn at the probe: add them tip to tail and you get the sum.',
  compassWrong: (truth: string) => `It points ${truth}. Both pieces are drawn at the probe: add them tip to tail and you get the sum.`,
  releaseMcq: {
    question: 'A + charge is let go from rest at this spot. Which path does it take?',
    answer: 'peel',
    options: [
      { id: 'line', label: 'Along the field line', reason: 'The line says which way it is pushed (a), not which way it is going (v). Once it has some speed it keeps part of its old direction.' },
      { id: 'peel', label: 'Starts along the line, then peels off', reason: 'a follows the line; v does not.' },
      { id: 'straight', label: 'Straight to the − charge', reason: 'It is pushed along the local field, and the field curves.' },
      { id: 'still', label: 'It does not move', reason: 'There is a field there, so there is a force.' },
    ],
  },
  release: 'Let it go',
  released: 'a follows the line; v does not. Watch the two arrows split apart.',
  onAxis: 'Try it on the axis',
  onAxisNote: 'On the axis the line is straight, so the path and the line sit on top of each other. That is the only time they agree.',
} as const

export const FLUX_COPY = {
  tilt: 'Tilt θ',
  side: 'Loop size',
  tips: {
    E: 'How strong the field is. Denser lines, more flux.',
    A: 'Bigger loop, more lines through it.',
    cos: 'Tilt it and fewer lines make it through.',
    n: 'n̂ is your call on an open loop. Flip it and Φ flips sign.',
  },
  predict: {
    question: 'Tilt the loop until the flux is half its max.',
    right: '60°: cos 60° = ½. Half the lines get through.',
    flipped: 'Half in size, but flipped: cos 120° = −½. That counts too.',
    wrong: (said: string) => `Half is at 60° (cos 60° = ½). You landed on ${said}.`,
  },
  mcq: {
    question: 'Turn the loop edge-on to the field. What is the flux?',
    answer: 'zero',
    options: [
      { id: 'zero', label: 'Zero', reason: 'Edge-on, the lines brush past and none go through. cos 90° = 0.' },
      { id: 'max', label: 'The max', reason: 'Max is face-on, when n̂ lines up with E.' },
      { id: 'half', label: 'Half', reason: 'Half is at 60°.' },
      { id: 'neg', label: 'Negative', reason: 'Negative needs n̂ pointing against E, past 90°.' },
    ],
  },
  mcqDone: 'Zero. Flux counts lines going through, not lines brushing past.',
  toBundle: 'Two loops, one bundle',
  bundleQ: 'Two loops cut by the same bundle of lines: a small one close in and a big one twice as far out. Which one has more flux?',
  bundleOptions: [
    { id: 'near', label: 'The small close one' },
    { id: 'far', label: 'The big far one' },
    { id: 'same', label: 'Same' },
  ],
  bundleRight: 'Same. Between them E fell as 1/r² and the area grew as r². Same lines, same flux. Hold that thought for the next chapter.',
  bundleWrong: 'Same, actually. Between them E fell as 1/r² and the area grew as r². Same lines, same flux. Hold that thought for the next chapter.',
  toBowl: 'Now a curved surface',
  n: 'Patches',
  z: 'Charge height',
  bowlNote: 'Each patch lights up with its own E·n̂ dA, brighter where more field leaves through it (the charge is inside the bowl, so it all leaves). Add them up and you get close. The exact answer is the flat line, and the sum walks toward it as the patches get smaller.',
} as const

export const SYMMETRY_COPY = {
  commit: {
    question: 'A charge sits off-center inside this sphere. Does knowing Φ tell you E at a point on the surface?',
    answer: 'no',
    options: [
      { id: 'yes', label: 'Yes, E = Φ/A', reason: 'That only works if E is the same size everywhere on the surface, and here it is not.' },
      { id: 'no', label: 'No, |E| changes from face to face', reason: 'Gauss gives you the total. It cannot hand back what each face got.' },
      { id: 'ifr', label: 'Yes, if you know r', reason: 'Knowing r does not fix it. The charge is off-center, so faces are at different distances.' },
    ],
  },
  commitDone: 'Look at the colors: not uniform. Gauss gave the integral; it cannot give the integrand back.',
  inside: 'Inside',
  one: 'one charge',
  dipole: 'a + and a −',
  dipoleNote: 'Φ = 0 and E is not zero on a single face. Gauss is true here and gives you nothing.',
  position: 'Charge position',
  tips: {
    area: 'The whole sphere, 4πr². It only comes out front when E is the same everywhere on it.',
    E: 'Slide the charge to the center. When the color snaps uniform, E can come out of the integral and E·4πr² = q/ε₀. Coulomb’s law pops right back out.',
  },
  centered: 'Centered. Every face reads the same |E|, straight through. Now E comes out of the integral: E·4πr² = q/ε₀, so E = q/(4πε₀r²). Coulomb’s law, back out of Gauss.',
  final: {
    question: 'Which of these can Gauss’s law alone hand you E for?',
    options: [
      { id: 'center', label: 'A charge at the center of a sphere', correct: true, reason: 'same |E| everywhere on the sphere, straight through it.' },
      { id: 'off', label: 'A charge off-center in a sphere', correct: false, reason: 'you get the flux, but |E| differs face to face.' },
      { id: 'dip', label: 'A + and − pair inside a sphere', correct: false, reason: 'Φ = 0 while E is nonzero everywhere. No.' },
      { id: 'line', label: 'An endless straight line of charge', correct: true, reason: 'wrap a cylinder around it; the side has one |E|, the end caps get nothing.' },
      { id: 'plane', label: 'An endless flat sheet of charge', correct: true, reason: 'a pillbox through it; the two flat ends share one |E|, the side gets nothing.' },
      { id: 'ball', label: 'A uniformly charged ball, from outside', correct: true, reason: 'a sphere around it looks just like the centered point charge.' },
    ],
  },
  finalDone: 'The three drawn ones are the classics: line, sheet, ball. Same trick each time: pick a surface where |E| is the same on the faces that count, and it pops out.',
  endCard: {
    title: 'Two questions to check yourself',
    q1: 'Any closed surface, any charge somewhere inside: can you say the flux without integrating anything?',
    q2: 'You have the flux. When can you turn it into E, and when can you not?',
  },
} as const

export const APPROX_COPY = {
  title: 'What this sim is approximating',
  items: [
    { id: 'rc', label: 'Capture radius r_c', value: '0.05 m on the Gauss surface, 0.06 m in the field chapter, 0.04 m elsewhere', note: 'inside it the field is a uniformly charged ball, so nothing blows up' },
    { id: 'lines', label: 'Lines drawn', value: '48 per nC, 24 per μC', note: 'density tracks strength in proportion, not to the pixel' },
    { id: 'emin', label: 'Line stops when |E| <', value: '1e-4 V/m', note: '1e-2 V/m in the field chapter' },
    { id: 'steps', label: 'Line step cap', value: '3000 steps', note: '4000 in the field chapter' },
    { id: 'mesh', label: 'Surface patches', value: '8 × 8 per cube face, 768 triangles', note: 'flux is exact per patch, so this only changes the drawing' },
    { id: 'dt', label: 'Released charge step', value: '0.4 μs, played at ×0.0025', note: 'velocity Verlet with ω·dt ≤ 0.1; the flight across a metre takes a few seconds on screen' },
    { id: 'particle', label: 'Released charge', value: '1 nC on 1 ng', note: 'a speck, so it moves' },
  ],
} as const
