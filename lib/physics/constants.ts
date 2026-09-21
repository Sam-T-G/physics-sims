/** Coulomb constant k = 1/(4πε₀), N·m²/C², CODATA 2018. */
export const K_E = 8.9875517923e9
/** Vacuum permittivity ε₀, F/m, CODATA 2018. */
export const EPSILON_0 = 8.8541878128e-12
/** Elementary charge, C, exact since the 2019 SI. */
export const E_CHARGE = 1.602176634e-19
// K_E and 1/(4π·EPSILON_0) agree to about 6e-11 relative, not bit-for-bit.
// Field and force use K_E; flux uses EPSILON_0 (Φ = qΩ/(4πε₀)).
