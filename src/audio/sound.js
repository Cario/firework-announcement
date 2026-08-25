/**
 * Runtime-synthesized Web Audio sound layer. No asset files.
 *
 * Public surface: initAudio(), play(name, opts), setMuted(bool), isMuted(),
 * stopAll(). `voiceCount()` is a read-only diagnostic used by verification.
 *
 * Contract (Phase 4.1):
 * - The AudioContext is created lazily inside initAudio(), which is called from
 *   the tap handler, then resumed. Nothing is constructed at module load.
 * - A single master GainNode feeds destination and is never disconnected.
 *   Muting ramps that gain over 80 ms so there is no click.
 * - One reusable 2 s white-noise AudioBuffer; every noise sound is a fresh
 *   AudioBufferSourceNode reading it from a random offset.
 * - exponentialRampToValueAtTime(0, t) throws, so every decay ramps to 0.0001
 *   and is then pinned to 0 with setValueAtTime.
 * - Oscillator and BufferSource nodes are one-shot: a new node per sound, with
 *   an explicit stop() so the graph is collectable.
 * - Global cap of 24 concurrent voices; the oldest is faded out and dropped.
 * - If AudioContext is missing or its construction throws, every function here
 *   becomes a silent no-op and never throws. The visual sequence must not care.
 */

/** Length of the shared white-noise buffer, in seconds. */
const NOISE_SECONDS = 2;

/** Headroom on the master bus. Individual recipe gains are used verbatim. */
const MASTER_GAIN = 0.85;

/** Mute / unmute ramp length, in seconds. */
const MUTE_RAMP = 0.08;

/** Global polyphony cap. One play() call is one voice, whatever it contains. */
const MAX_VOICES = 24;

/** Scheduling lookahead so nothing is ever scheduled in the past. */
const LOOKAHEAD = 0.005;

/** Fade applied when a voice is evicted by the polyphony cap. */
const EVICT_FADE = 0.03;

/** Fade applied by stopAll(). */
const STOP_ALL_FADE = 0.06;

/**
 * Upper bound, in ms, on how long initAudio() waits for ctx.resume().
 *
 * Chrome does not reject resume() when the autoplay policy blocks it — the
 * promise simply stays pending until the page gets user activation, possibly
 * forever. An awaited initAudio() would then never return and could stall the
 * caller, so the wait is bounded. Inside a real tap handler resume() settles in
 * a few milliseconds and this never fires.
 */
const RESUME_TIMEOUT_MS = 1000;

let ctx = null;
let master = null;
let noiseBuffer = null;

/** Set once we know audio can never work in this page. */
let unavailable = false;

/** Mute state is tracked independently of the context so it survives init. */
let muted = false;

/**
 * Live and fading-out voices. Each entry is
 * `{ out: GainNode, sources: AudioScheduledSourceNode[], endsAt: number,
 *    retired: boolean }`.
 */
const voices = [];

/** Returned by play() when there is no audio, so callers can always call stop. */
const SILENT_HANDLE = Object.freeze({ stop() {} });

/* ---------------------------------------------------------------
   Small helpers
   --------------------------------------------------------------- */

function num(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

/**
 * Resolved lazily rather than at module load so that a page which removes the
 * constructor (or a browser that never had one) is detected at init time.
 */
function audioContextCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

/* ---------------------------------------------------------------
   Noise
   --------------------------------------------------------------- */

function buildNoiseBuffer() {
  const length = Math.floor(ctx.sampleRate * NOISE_SECONDS);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * A random read position in the shared buffer. For one-shot reads the offset is
 * clamped so the requested duration still fits inside the buffer.
 */
function noiseOffset(duration) {
  const room = NOISE_SECONDS - num(duration, 0) - 0.05;
  return room > 0 ? Math.random() * room : 0;
}

function noiseSource(loop) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  if (loop) source.loop = true;
  return source;
}

/* ---------------------------------------------------------------
   Envelopes. Never exponential-ramp to zero.
   --------------------------------------------------------------- */

/**
 * Silence -> peak over `attack`, then an exponential fall to 0.0001 at `endAt`
 * and a hard pin to 0 so the parameter is genuinely silent afterwards.
 */
function attackDecay(param, startAt, peak, attack, endAt) {
  const peaked = Math.max(0.00011, peak);
  const peakAt = startAt + attack;
  const stopAt = Math.max(endAt, peakAt + 0.001);
  param.setValueAtTime(0, startAt);
  param.linearRampToValueAtTime(peaked, peakAt);
  param.exponentialRampToValueAtTime(0.0001, stopAt);
  param.setValueAtTime(0, stopAt);
}

/**
 * Silence -> peak over `attack`, held until `releaseAt`, then an exponential
 * fall to 0.0001 at `endAt` and a pin to 0. Used by the sustained beds.
 */
function attackHoldRelease(param, startAt, peak, attack, releaseAt, endAt) {
  const peaked = Math.max(0.00011, peak);
  const peakAt = startAt + attack;
  const holdUntil = Math.max(releaseAt, peakAt + 0.001);
  const stopAt = Math.max(endAt, holdUntil + 0.001);
  param.setValueAtTime(0, startAt);
  param.linearRampToValueAtTime(peaked, peakAt);
  param.setValueAtTime(peaked, holdUntil);
  param.exponentialRampToValueAtTime(0.0001, stopAt);
  param.setValueAtTime(0, stopAt);
}

/* ---------------------------------------------------------------
   Voice bookkeeping
   --------------------------------------------------------------- */

function newVoice(endsAt) {
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(master);
  return { out, sources: [], endsAt, retired: false };
}

/** Drop every voice whose scheduled tail has already passed. */
function prune(now) {
  for (let i = voices.length - 1; i >= 0; i -= 1) {
    if (voices[i].endsAt <= now) {
      try {
        voices[i].out.disconnect();
      } catch (err) {
        /* already detached */
      }
      voices.splice(i, 1);
    }
  }
}

function activeCount() {
  let n = 0;
  for (let i = 0; i < voices.length; i += 1) {
    if (!voices[i].retired) n += 1;
  }
  return n;
}

/** Fade a voice out and schedule its sources to stop. It is pruned later. */
function retire(voice, now, fade) {
  if (voice.retired) return;
  voice.retired = true;
  const endAt = now + fade;
  try {
    voice.out.gain.setValueAtTime(voice.out.gain.value, now);
    voice.out.gain.linearRampToValueAtTime(0, endAt);
  } catch (err) {
    /* the ramp is cosmetic; the stop below is what matters */
  }
  for (let i = 0; i < voice.sources.length; i += 1) {
    try {
      voice.sources[i].stop(endAt);
    } catch (err) {
      /* already stopped */
    }
  }
  voice.endsAt = Math.min(voice.endsAt, endAt + 0.01);
}

/** Enforce the polyphony cap by retiring the oldest still-sounding voices. */
function enforceCap(now) {
  let guard = 0;
  while (activeCount() >= MAX_VOICES && guard < voices.length + 1) {
    guard += 1;
    let oldest = null;
    for (let i = 0; i < voices.length; i += 1) {
      if (!voices[i].retired) {
        oldest = voices[i];
        break;
      }
    }
    if (!oldest) break;
    retire(oldest, now, EVICT_FADE);
  }
}

/* ---------------------------------------------------------------
   Sound recipes — Phase 4.1 table
   --------------------------------------------------------------- */

/**
 * fuse — looping noise through a bandpass at 2.8 kHz, Q 1.4, at gain 0.05,
 * held for the burn then ramped to silence at ignition.
 */
function makeFuse(startAt, gain, opts) {
  const duration = Math.max(0.12, num(opts.duration, 1.4));
  const endAt = startAt + duration;
  const voice = newVoice(endAt + 0.04);

  const source = noiseSource(true);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 2800;
  band.Q.value = 1.4;

  const level = ctx.createGain();
  attackHoldRelease(level.gain, startAt, 0.30 * gain, 0.06, endAt - 0.12, endAt);

  source.connect(band);
  band.connect(level);
  level.connect(voice.out);

  source.start(startAt, noiseOffset(0));
  source.stop(endAt + 0.03);
  voice.sources.push(source);
  return voice;
}

/**
 * launch — noise through a bandpass sweeping 900 -> 260 Hz over 1.1 s at Q 2.2,
 * gain 0.28 with a 40 ms attack decaying by 1.2 s, plus a sine falling
 * 180 -> 70 Hz at gain 0.10.
 */
function makeLaunch(startAt, gain) {
  const endAt = startAt + 1.2;
  const voice = newVoice(endAt + 0.08);

  const source = noiseSource(false);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 2.2;
  band.frequency.setValueAtTime(900, startAt);
  band.frequency.exponentialRampToValueAtTime(260, startAt + 1.1);

  const air = ctx.createGain();
  attackDecay(air.gain, startAt, 0.85 * gain, 0.04, endAt);

  source.connect(band);
  band.connect(air);
  air.connect(voice.out);
  source.start(startAt, noiseOffset(1.26));
  source.stop(endAt + 0.06);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(180, startAt);
  osc.frequency.exponentialRampToValueAtTime(70, startAt + 1.1);

  const body = ctx.createGain();
  attackDecay(body.gain, startAt, 0.34 * gain, 0.05, endAt);

  osc.connect(body);
  body.connect(voice.out);
  osc.start(startAt);
  osc.stop(endAt + 0.06);

  voice.sources.push(source, osc);
  return voice;
}

/**
 * boom — sine 92 -> 34 Hz over 0.5 s at gain 0.55 with a 12 ms attack decaying
 * over 0.9 s, layered with noise through a 420 Hz lowpass at gain 0.35 decaying
 * over 0.55 s.
 */
function makeBoom(startAt, gain) {
  const endAt = startAt + 0.9;
  const voice = newVoice(endAt + 0.08);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(92, startAt);
  osc.frequency.exponentialRampToValueAtTime(34, startAt + 0.5);

  const low = ctx.createGain();
  attackDecay(low.gain, startAt, 0.78 * gain, 0.012, endAt);

  osc.connect(low);
  low.connect(voice.out);
  osc.start(startAt);
  osc.stop(endAt + 0.06);

  const source = noiseSource(false);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;

  const rumble = ctx.createGain();
  attackDecay(rumble.gain, startAt, 0.52 * gain, 0.01, startAt + 0.55);

  source.connect(lp);
  lp.connect(rumble);
  rumble.connect(voice.out);
  source.start(startAt, noiseOffset(0.62));
  source.stop(startAt + 0.6);

  voice.sources.push(osc, source);
  return voice;
}

/**
 * crackle — 18 to 26 short noise grains scattered over 1.1 s, each 25-45 ms
 * through a 3.2 kHz highpass at gain 0.03-0.09. One shared filter: for a linear
 * filter, per-grain gain before a common highpass is identical to a highpass
 * per grain, and it keeps the node count down.
 */
function makeCrackle(startAt, gain) {
  const spread = 1.1;
  const grains = 18 + Math.floor(Math.random() * 9);
  const endAt = startAt + spread + 0.06;
  const voice = newVoice(endAt + 0.06);

  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3200;
  hp.connect(voice.out);

  for (let i = 0; i < grains; i += 1) {
    const at = startAt + Math.random() * spread;
    const length = 0.025 + Math.random() * 0.02;
    const peak = (0.10 + Math.random() * 0.16) * gain;

    const source = noiseSource(false);
    const level = ctx.createGain();
    attackDecay(level.gain, at, peak, 0.004, at + length);

    source.connect(level);
    level.connect(hp);
    source.start(at, noiseOffset(length + 0.02));
    source.stop(at + length + 0.02);
    voice.sources.push(source);
  }
  return voice;
}

/**
 * smallPop — sine 200 -> 90 Hz over 0.2 s at gain 0.22, plus a 60 ms noise
 * burst through a 2 kHz highpass at gain 0.12. Pitch is scattered by +/-12 %
 * per call so repeated words do not sound cloned.
 */
function makeSmallPop(startAt, gain) {
  const detune = 1 + (Math.random() * 0.24 - 0.12);
  const endAt = startAt + 0.22;
  const voice = newVoice(endAt + 0.06);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(200 * detune, startAt);
  osc.frequency.exponentialRampToValueAtTime(90 * detune, startAt + 0.2);

  const level = ctx.createGain();
  attackDecay(level.gain, startAt, 0.46 * gain, 0.006, endAt);

  osc.connect(level);
  level.connect(voice.out);
  osc.start(startAt);
  osc.stop(endAt + 0.04);

  const source = noiseSource(false);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2000;

  const click = ctx.createGain();
  attackDecay(click.gain, startAt, 0.26 * gain, 0.004, startAt + 0.06);

  source.connect(hp);
  hp.connect(click);
  click.connect(voice.out);
  source.start(startAt, noiseOffset(0.08));
  source.stop(startAt + 0.08);

  voice.sources.push(osc, source);
  return voice;
}

/**
 * shimmer — three lightly detuned sines at 1046 / 1318 / 1568 Hz, gain 0.05
 * each, decaying over 0.9 s. Played as each word resolves.
 */
function makeShimmer(startAt, gain) {
  const endAt = startAt + 0.9;
  const voice = newVoice(endAt + 0.06);
  const partials = [1046, 1318, 1568];

  for (let i = 0; i < partials.length; i += 1) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = partials[i] * (1 + (Math.random() - 0.5) * 0.006);

    const level = ctx.createGain();
    attackDecay(level.gain, startAt, 0.14 * gain, 0.012, endAt);

    osc.connect(level);
    level.connect(voice.out);
    osc.start(startAt);
    osc.stop(endAt + 0.04);
    voice.sources.push(osc);
  }
  return voice;
}

/**
 * ambient — a very low noise bed at gain 0.012 through a 300 Hz bandpass,
 * started at launch and faded out with the card.
 */
function makeAmbient(startAt, gain, opts) {
  const duration = Math.max(1, num(opts.duration, 28));
  const endAt = startAt + duration;
  const voice = newVoice(endAt + 0.06);

  const source = noiseSource(true);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 300;
  band.Q.value = 0.8;

  const level = ctx.createGain();
  attackHoldRelease(level.gain, startAt, 0.055 * gain, 1.5, endAt - 1.2, endAt);

  source.connect(band);
  band.connect(level);
  level.connect(voice.out);
  source.start(startAt, noiseOffset(0));
  source.stop(endAt + 0.04);
  voice.sources.push(source);
  return voice;
}

/**
 * travel — the shell in the air, after the launch thump has died away.
 *
 * A rising whistle (sawtooth through a tight bandpass that tracks it, so it
 * reads as air rather than as a tone) over a thin noise hiss. The pitch climbs
 * as it goes, which is what makes it sound like it is getting further away and
 * still accelerating.
 */
function makeTravel(startAt, gain, opts) {
  const duration = Math.max(0.4, num(opts.duration, 2.4));
  const endAt = startAt + duration;
  const voice = newVoice(endAt + 0.1);

  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(420, startAt);
  osc.frequency.exponentialRampToValueAtTime(1150, endAt);

  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 6;
  band.frequency.setValueAtTime(460, startAt);
  band.frequency.exponentialRampToValueAtTime(1250, endAt);

  const whistle = ctx.createGain();
  attackHoldRelease(whistle.gain, startAt, 0.16 * gain, 0.18, endAt - 0.35, endAt);

  osc.connect(band);
  band.connect(whistle);
  whistle.connect(voice.out);
  osc.start(startAt);
  osc.stop(endAt + 0.06);

  const source = noiseSource(true);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1800;

  const hiss = ctx.createGain();
  attackHoldRelease(hiss.gain, startAt, 0.10 * gain, 0.12, endAt - 0.3, endAt);

  source.connect(hp);
  hp.connect(hiss);
  hiss.connect(voice.out);
  source.start(startAt, noiseOffset(0));
  source.stop(endAt + 0.06);

  voice.sources.push(osc, source);
  return voice;
}

/**
 * wind — the airy bed under the climb. Deliberately subtle: two lowpassed
 * noise layers at slightly different cutoffs, one of them slowly swept, so it
 * breathes instead of sitting there as flat hiss.
 */
function makeWind(startAt, gain, opts) {
  const duration = Math.max(0.6, num(opts.duration, 3));
  const endAt = startAt + duration;
  const voice = newVoice(endAt + 0.12);

  const body = noiseSource(true);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(320, startAt);
  lp.frequency.linearRampToValueAtTime(760, startAt + duration * 0.6);
  lp.frequency.linearRampToValueAtTime(420, endAt);

  const bed = ctx.createGain();
  attackHoldRelease(bed.gain, startAt, 0.22 * gain, 0.5, endAt - 0.6, endAt);

  body.connect(lp);
  lp.connect(bed);
  bed.connect(voice.out);
  body.start(startAt, noiseOffset(0));
  body.stop(endAt + 0.08);

  const gust = noiseSource(true);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.7;

  const gustLevel = ctx.createGain();
  attackHoldRelease(gustLevel.gain, startAt, 0.11 * gain, 0.9, endAt - 0.8, endAt);

  gust.connect(bp);
  bp.connect(gustLevel);
  gustLevel.connect(voice.out);
  gust.start(startAt, noiseOffset(0));
  gust.stop(endAt + 0.08);

  voice.sources.push(body, gust);
  return voice;
}

const RECIPES = {
  fuse: makeFuse,
  launch: makeLaunch,
  travel: makeTravel,
  wind: makeWind,
  boom: makeBoom,
  crackle: makeCrackle,
  smallPop: makeSmallPop,
  shimmer: makeShimmer,
  ambient: makeAmbient,
};

/* ---------------------------------------------------------------
   Public surface
   --------------------------------------------------------------- */

/**
 * Create and resume the AudioContext. Must be called from inside a user gesture
 * handler (tap / click / key) — that is the whole reason it is lazy.
 *
 * @returns {Promise<boolean>} true when the context is running.
 */
export async function initAudio() {
  if (unavailable) return false;

  if (!ctx) {
    const Ctor = audioContextCtor();
    if (!Ctor) {
      unavailable = true;
      return false;
    }
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_GAIN;

      // A limiter between the master bus and the output. The loudest moment of
      // the piece fires boom, crackle and the tail of the travel whistle within
      // a few milliseconds of each other; measured at the master those sum
      // close enough to full scale to distort on a phone speaker. This catches
      // the peaks without having to make every individual sound timid.
      // BaseAudioContext.createDynamicsCompressor is standard Web Audio.
      let output = ctx.destination;
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.15;
        limiter.connect(ctx.destination);
        output = limiter;
      }
      master.connect(output);
      noiseBuffer = buildNoiseBuffer();
    } catch (err) {
      unavailable = true;
      ctx = null;
      master = null;
      noiseBuffer = null;
      return false;
    }
  }

  try {
    if (ctx.state !== 'running') {
      await Promise.race([
        ctx.resume(),
        new Promise((resolve) => {
          window.setTimeout(resolve, RESUME_TIMEOUT_MS);
        }),
      ]);
    }
  } catch (err) {
    /* autoplay policy said no; the visuals carry on regardless */
  }

  return ctx.state === 'running';
}

/**
 * Play one named sound.
 *
 * @param {'fuse'|'launch'|'boom'|'crackle'|'smallPop'|'shimmer'|'ambient'} name
 * @param {{ delay?: number, gain?: number, duration?: number }} [opts]
 *        delay    seconds from now before the sound starts
 *        gain     multiplier on the recipe's own level (default 1)
 *        duration length of the sustained sounds (fuse, ambient)
 * @returns {{ stop: (fade?: number) => void }} handle for the sustained sounds.
 */
export function play(name, opts) {
  if (unavailable || !ctx || !master || !noiseBuffer) return SILENT_HANDLE;

  const recipe = RECIPES[name];
  if (!recipe) return SILENT_HANDLE;

  const options = opts || {};

  try {
    // A tab-switch can suspend the context mid-sequence. Nudge it, but only one
    // attempt at a time: a resume() blocked by the autoplay policy never
    // settles, so firing one per play() would pile up pending promises.
    if (ctx.state === 'suspended' && !resumePending) {
      resumePending = true;
      const resumed = ctx.resume();
      if (resumed && typeof resumed.then === 'function') {
        resumed.then(
          () => {
            resumePending = false;
          },
          () => {
            resumePending = false;
          }
        );
      } else {
        resumePending = false;
      }
    }

    const now = ctx.currentTime;
    prune(now);
    enforceCap(now);

    const startAt = now + LOOKAHEAD + Math.max(0, num(options.delay, 0));
    const gain = Math.max(0, num(options.gain, 1));
    const voice = recipe(startAt, gain, options);
    voices.push(voice);

    return {
      stop(fade) {
        try {
          if (!ctx) return;
          retire(voice, ctx.currentTime, Math.max(0.01, num(fade, 0.12)));
        } catch (err) {
          /* nothing left to stop */
        }
      },
    };
  } catch (err) {
    return SILENT_HANDLE;
  }
}

/**
 * Mute or unmute. Ramps the master gain over 80 ms so there is never a click.
 * The master is never disconnected. Safe to call before initAudio().
 */
export function setMuted(next) {
  const value = Boolean(next);
  muted = value;

  if (unavailable || !ctx || !master) return;

  try {
    const now = ctx.currentTime;
    const target = value ? 0 : MASTER_GAIN;
    // Anchor at the level the ramp has actually reached, then ramp from there.
    // Every call schedules its ramp later than the previous one, so the last
    // call always wins and the parameter cannot get stuck part-way.
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(target, now + MUTE_RAMP);
  } catch (err) {
    /* leave the gain wherever it is rather than throwing at the caller */
  }
}

/** @returns {boolean} current mute state, valid before and after init. */
export function isMuted() {
  return muted;
}

/** Fade out and release every sounding voice. The master stays connected. */
export function stopAll() {
  if (unavailable || !ctx) return;

  try {
    const now = ctx.currentTime;
    for (let i = 0; i < voices.length; i += 1) {
      retire(voices[i], now, STOP_ALL_FADE);
    }
    prune(now);
  } catch (err) {
    /* nothing to stop */
  }
}

/**
 * Diagnostic only, used by the polyphony verification — not part of the
 * sequence's contract.
 *
 * @param {boolean} [activeOnly] true for the sounding voices the cap governs,
 *        false / omitted for every voice still tracked including those fading
 *        out after eviction.
 * @returns {number}
 */
export function voiceCount(activeOnly) {
  if (ctx) {
    try {
      prune(ctx.currentTime);
    } catch (err) {
      /* fall through to the raw length */
    }
  }
  return activeOnly ? activeCount() : voices.length;
}

/**
 * Diagnostics. Returns the live context and master bus so a caller can attach
 * an AnalyserNode and confirm signal is actually reaching the output — the
 * only way to tell "silent because it is broken" from "silent because nobody
 * pressed anything yet".
 *
 * @returns {{ ctx: AudioContext|null, master: GainNode|null,
 *             unavailable: boolean, state: string }}
 */
export function audioDebug() {
  return {
    ctx,
    master,
    unavailable,
    state: ctx ? ctx.state : 'uncreated',
  };
}
