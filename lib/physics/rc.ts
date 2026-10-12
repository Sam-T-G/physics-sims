/**
 * RC circuits (OpenStax University Physics Vol 2, Section 10.5). Pure, layer 1.
 *
 * A circuit with one capacitor relaxes as a single exponential: the capacitor voltage heads from where it
 * is toward the voltage it would have with no current, with time constant τ = RC (Eq 10.9), where R is the
 * resistance the capacitor sees. The book's charging (Eq 10.8, 10.10) and discharging (Eq 10.11, 10.12)
 * curves are the two special cases that start empty or end empty.
 */

/** Eq 10.9. */
export function timeConstant(R: number, C: number): number {
  return R * C
}

/** Capacitor voltage t seconds after it started at v0, heading for vEnd with time constant tau. */
export function relaxVoltage(v0: number, vEnd: number, tau: number, t: number): number {
  if (tau === Infinity) return v0
  if (tau <= 0) return vEnd
  return vEnd + (v0 - vEnd) * Math.exp(-t / tau)
}

/** Eq 10.8: charge on a capacitor charging from empty, q(t) = Cε(1 − e^(−t/RC)). */
export function chargingCharge(C: number, emf: number, R: number, t: number): number {
  return C * emf * (1 - Math.exp(-t / (R * C)))
}

/** Eq 10.10: current while charging from empty, I(t) = I₀ e^(−t/τ), I₀ = ε/R. */
export function chargingCurrent(emf: number, R: number, C: number, t: number): number {
  return (emf / R) * Math.exp(-t / (R * C))
}

/** Eq 10.11: charge while discharging from Q, q(t) = Q e^(−t/τ). */
export function dischargingCharge(Q: number, R: number, C: number, t: number): number {
  return Q * Math.exp(-t / (R * C))
}

/** Eq 10.12: current while discharging, I(t) = −(Q/RC) e^(−t/τ). Negative: it flows the other way. */
export function dischargingCurrent(Q: number, R: number, C: number, t: number): number {
  return -(Q / (R * C)) * Math.exp(-t / (R * C))
}
