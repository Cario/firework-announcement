/**
 * Pure easing functions over t in [0, 1].
 *
 * Every function here is pure: same input, same output, no state, no clock.
 * Inputs are clamped to [0, 1] so a caller that overshoots its own progress
 * math gets a sane endpoint instead of a wild extrapolation. Outputs are NOT
 * clamped — `easeOutBack` is supposed to exceed 1 on its way back down, and
 * clamping that would remove the only reason to use it.
 */

/** Clamp to the unit interval. */
export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** No easing. */
export function linear(t) {
  return clamp01(t);
}

/** Fast out of the gate, settling gently. Good for entrances. */
export function easeOutCubic(t) {
  const x = clamp01(t);
  const inv = 1 - x;
  return 1 - inv * inv * inv;
}

/** Slow start, accelerating away. Used for the rocket's first 0.35 s. */
export function easeInCubic(t) {
  const x = clamp01(t);
  return x * x * x;
}

/** Symmetric ease in and out. */
export function easeInOutCubic(t) {
  const x = clamp01(t);
  if (x < 0.5) return 4 * x * x * x;
  const inv = -2 * x + 2;
  return 1 - (inv * inv * inv) / 2;
}

/**
 * Overshoots past 1 and settles back — a small anticipatory "pop".
 *
 * c1 = 1.70158 is the standard back constant (it makes the curve overshoot by
 * roughly 10%); c3 = c1 + 1 is the coefficient that keeps f(1) === 1.
 */
const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;

export function easeOutBack(t) {
  const x = clamp01(t) - 1;
  return 1 + BACK_C3 * x * x * x + BACK_C1 * x * x;
}

/**
 * A harder version of easeOutCubic: almost all of the distance is covered
 * immediately, then it creeps in. This is the curve the text resolve uses, so
 * sparks appear to fly out fast and settle precisely into the letterform.
 */
export function easeOutQuint(t) {
  const x = clamp01(t);
  const inv = 1 - x;
  return 1 - inv * inv * inv * inv * inv;
}
