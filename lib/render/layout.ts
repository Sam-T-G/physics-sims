/**
 * Column layout (card on the right) versus sheet layout (card at the bottom). One predicate, measured on the
 * mount element, used by the render (camera view offset) and by the chrome (a class the CSS keys off), so the
 * two can never disagree, even when the sim is mounted in a column of a larger page.
 */
export function isWideLayout(width: number, height: number): boolean {
  return width >= 900 || (width >= 600 && height <= 520)
}
