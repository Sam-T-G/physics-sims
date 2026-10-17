import type { SimMeta } from '@lib/chrome/types'

export const meta: SimMeta = {
  id: 'sim02',
  title: 'Plug-and-play circuits',
  section: 'Electrodynamics',
  chapters: 'OpenStax University Physics Vol 2, Ch 8–10',
  concept: 'Charge and current → Ohm\'s law and power → real battery → series and parallel → Kirchhoff\'s junction and loop rules → RC charging and discharging',
  test: 'Predict how swapping, adding or removing any resistor changes every current and voltage in a series-parallel circuit, and check the result with Kirchhoff\'s rules.',
  coverage: {
    covers: [
      '8.1 (C = Q/V only)',
      '9.1 (I = ΔQ/Δt, the ampere)',
      '9.3 (R = V/I, R = ρL/A, the ohm, color bands)',
      '9.4 (V = IR)',
      '9.5',
      '10.1',
      '10.2',
      '10.3 (junction and loop rules on a series-parallel board)',
      '10.5 (one capacitor, charging and discharging)',
    ],
    notCovered: [
      '8.1 (parallel-plate and other geometries)',
      '8.2–8.5',
      '9.2',
      '9.3 (resistivity and temperature)',
      '9.6',
      '10.3 (multi-loop circuits with two emfs)',
      '10.4',
      '10.6',
    ],
  },
}
