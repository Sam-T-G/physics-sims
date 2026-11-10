import type { SimMeta } from '@lib/chrome/types'

export const meta: SimMeta = {
  id: 'sim03',
  title: 'Plug-and-play wires',
  section: 'Magnetism and induction',
  chapters: 'OpenStax University Physics Vol 2, Ch 12',
  concept: 'Field of a long straight wire → adding fields as vectors → force between parallel currents → Ampère\'s law around any loop',
  test: 'Predict the field at a point and the force on each wire for any set of long straight currents, and check Ampère\'s law around a loop that holds some of them.',
  coverage: {
    covers: [
      '12.2 (field of a long straight wire only)',
      '12.3',
      '12.5 (long straight wires, including a thick wire with uniform current)',
    ],
    notCovered: ['12.1', '12.2 (Biot-Savart for other shapes)', '12.4', '12.6', '12.7'],
  },
}
