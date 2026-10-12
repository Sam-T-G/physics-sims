import type { SimMeta } from '@lib/chrome/types'

export const meta: SimMeta = {
  id: 'sim02',
  title: 'Plug-and-play circuits',
  section: 'Electrodynamics',
  chapters: 'OpenStax University Physics Vol 2, Ch 9–10',
  concept: 'Ohm\'s law and power → real battery → series and parallel → Kirchhoff\'s junction and loop rules → RC charging and discharging',
  test: 'Predict how swapping, adding or removing any resistor changes every current and voltage in a series-parallel circuit, and check the result with Kirchhoff\'s rules.',
  coverage: {
    covers: ['9.4 (V = IR)', '9.5', '10.1', '10.2', '10.3 (junction and loop rules on a series-parallel board)', '10.5 (one capacitor, charging and discharging)'],
    notCovered: ['8.1–8.5', '9.1–9.3', '9.6', '10.3 (multi-loop circuits with two emfs)', '10.4', '10.6'],
  },
}
