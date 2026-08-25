/**
 * Critically damped vertical follow camera in CSS pixels.
 *
 * World space: y grows downward (canvas convention). The world is a tall
 * column — roughly 3.2 screens per plan 3.1 — with the ground at the bottom
 * (`y = worldHeight`) and the zenith at the top (`y = 0`).
 *
 * `camera.y` is the world y that maps to the TOP edge of the viewport. At rest
 * it sits at `worldHeight - viewHeight`, showing the ground; climbing means y
 * decreases toward 0.
 */

/**
 * Damping frequency, in radians per second.
 *
 * The follow is a critically damped spring (damping ratio zeta = 1): the
 * fastest approach that never oscillates, so there is no visible spring and no
 * overshoot past the rocket.
 *
 * omega = 12 rad/s gives:
 *   - a time constant of 1/12 = 83 ms, so the camera reads as *following*
 *     rather than welded to the rocket;
 *   - 2% settling in about 5.8/omega = 0.48 s, comfortably inside the 2.7 s
 *     climb, so the framing is composed well before the burst;
 *   - a residual lag against a constant-velocity climb of 2v/omega — about
 *     110 px at the ~660 px/s the climb runs at on a 375x812 phone. `follow()`
 *     cancels that exactly when the caller passes the target's velocity (see
 *     the feed-forward note there), so the 62% framing is actually held.
 *
 * Lower and the rocket outruns the frame during the transient; higher and the
 * camera locks rigidly to it and the climb stops reading as movement at all.
 */
export const CAMERA_OMEGA = 12;

/** Where the followed target sits vertically in the viewport: 62% down. */
export const FOLLOW_RATIO = 0.62;

/**
 * @param {{ followRatio?: number, omega?: number }} [options]
 */
export function createCamera(options = {}) {
  const followRatio = options.followRatio ?? FOLLOW_RATIO;
  let omega = options.omega ?? CAMERA_OMEGA;

  let y = 0;
  let zoom = 1;
  let vy = 0; // world px/s, the spring's velocity state

  let viewWidth = 0;
  let viewHeight = 0;
  let worldHeight = 0;

  /**
   * Lowest the camera may go. Any further and the frame would show empty
   * space below the ground, which is the one artefact that would give away
   * that this is a canvas and not a sky.
   */
  function maxY() {
    return Math.max(0, worldHeight - viewHeight / zoom);
  }

  /** Highest the camera may go: the top of the world. */
  function minY() {
    return 0;
  }

  function clampY(value) {
    const lo = minY();
    const hi = maxY();
    return value < lo ? lo : value > hi ? hi : value;
  }

  const camera = {
    get y() {
      return y;
    },
    get zoom() {
      return zoom;
    },
    get velocity() {
      return vy;
    },

    /** Viewport size in CSS pixels. Call from the canvas resize callback. */
    setViewport(width, height) {
      viewWidth = width;
      viewHeight = height;
      y = clampY(y);
      return camera;
    },

    /** Total world height in CSS pixels. */
    setWorldHeight(height) {
      worldHeight = height;
      y = clampY(y);
      return camera;
    },

    setZoom(next) {
      zoom = next;
      y = clampY(y);
      return camera;
    },

    setOmega(next) {
      omega = next;
      return camera;
    },

    /** Jump instantly, killing velocity. Used on reset and on re-layout. */
    snapTo(nextY) {
      y = clampY(nextY);
      vy = 0;
      return camera;
    },

    /** Back to the resting ground view with no residual momentum. */
    reset() {
      zoom = 1;
      vy = 0;
      y = maxY();
      return camera;
    },

    /**
     * Advance one frame toward keeping `targetY` at `followRatio` down the
     * viewport.
     *
     * The step is the exact analytic solution of the critically damped
     * oscillator  e'' + 2*omega*e' + omega^2*e = 0  over `dt`:
     *
     *   e(dt) = (e0 + (v0 + omega*e0) * dt) * exp(-omega*dt)
     *   v(dt) = (v0 - omega * (v0 + omega*e0) * dt) * exp(-omega*dt)
     *
     * Exact rather than an Euler step, which means it is unconditionally
     * stable: a 120 Hz display and a stuttering 30 fps frame produce the same
     * trajectory, and a large dt can never make it explode.
     *
     * Feed-forward: any second-order follow lags a constant-velocity target by
     * exactly 2v/omega, so a rocket climbing at 660 px/s would sit ~110 px
     * above its 62% mark for the whole climb. Passing `targetVelY` (which the
     * launch code already integrates, so it is exact and noise-free — no
     * finite differencing) shifts the goal by that same 2v/omega and cancels
     * the lag outright. It moves the goal, not the state, so it cannot
     * introduce overshoot. Omit it and this degrades to the plain damped
     * follow, lag and all.
     *
     * @param {number} targetY world y to keep framed
     * @param {number} dt seconds
     * @param {number} [targetVelY] target's world velocity in px/s
     */
    follow(targetY, dt, targetVelY = 0) {
      const desired =
        targetY - (followRatio * viewHeight) / zoom + (2 * targetVelY) / omega;
      const goal = clampY(desired);

      if (dt <= 0) return camera;

      const e0 = y - goal; // current error
      const c = vy + omega * e0; // the (v0 + omega*e0) term, used twice
      const decay = Math.exp(-omega * dt);

      y = goal + (e0 + c * dt) * decay;
      vy = (vy - omega * c * dt) * decay;

      const clamped = clampY(y);
      if (clamped !== y) {
        // Hit a bound. Drop the velocity so the spring does not wind up
        // against the clamp and then lurch when it is released.
        y = clamped;
        vy = 0;
      }
      return camera;
    },

    /** World y -> screen y, in CSS pixels. */
    worldToScreenY(wy) {
      return (wy - y) * zoom;
    },

    /** Screen y -> world y, in CSS pixels. */
    screenToWorldY(sy) {
      return y + sy / zoom;
    },

    /** True when the camera is resting at the bottom of the world. */
    get atRest() {
      return y >= maxY() - 0.01;
    },

    /**
     * Wrap scene drawing. Zoom pivots on the horizontal centre and the top
     * edge, so `worldToScreenY` stays a plain `(wy - y) * zoom`.
     *
     *   camera.apply(ctx);
     *   ...draw in world coordinates...
     *   camera.restore(ctx);
     */
    apply(ctx) {
      ctx.save();
      if (zoom !== 1) {
        ctx.translate(viewWidth / 2, 0);
        ctx.scale(zoom, zoom);
        ctx.translate(-viewWidth / 2, -y);
      } else {
        ctx.translate(0, -y);
      }
      return camera;
    },

    restore(ctx) {
      ctx.restore();
      return camera;
    },
  };

  return camera;
}
