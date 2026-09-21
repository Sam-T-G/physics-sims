import type { SimMeta } from '@lib/chrome/types'

export const meta: SimMeta = {
  id: 'sim01',
  title: 'Charge, field, flux',
  section: 'Electrostatics',
  chapters: 'OpenStax University Physics Vol 2, Ch 5–6',
  concept: 'Charge → Coulomb → field → why r² → flux → Gauss → symmetry',
  test: 'Predict the flux through any closed surface from the enclosed charge alone, and say whether Gauss\'s law can also give E there.',
  coverage: {
    covers: ['5.1', '5.3', '5.4', '5.6', '5.7 (field pattern only)', '6.1', '6.2', '6.3 (qualitative)'],
    notCovered: ['5.2', '5.5', '6.3 (quantitative)', '6.4', '7.1–7.6'],
  },
}
