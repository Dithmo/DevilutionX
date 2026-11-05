/**
 * Zero-asset WebAudio synthesiser. Sounds are described by small
 * descriptors (from the theme) and rendered with oscillators / filtered
 * noise plus a simple envelope.
 *
 * Descriptor: { type:'sine'|'square'|'saw'|'triangle'|'noise', freq, slide?,
 *               dur?, decay?, volume?, delay?, q? }  or an array of them
 *   freq   start frequency in Hz (noise: band-pass centre)
 *   slide  target frequency reached at the end of `dur`
 *   dur    sustain seconds, then an exponential tail of `decay` seconds
 *   delay  start offset in seconds (for layered sounds)
 *
 * The AudioContext is created lazily on the first user gesture; nothing
 * here throws when WebAudio is unavailable.
 */

const DEFAULT_DUR = 0.1;
const DEFAULT_DECAY = 0.05;
const DEFAULT_VOLUME = 0.3;
const DEFAULT_FREQ = 440;
const MASTER_GAIN = 0.5;
const ATTACK = 0.005;
const MIN_GAIN = 0.0001;
const STOP_PAD = 0.02;
const NOISE_SECONDS = 1;
const NOISE_Q = 1;
const MIN_FREQ = 1;
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'];
const OSC_TYPES = { sine: 'sine', square: 'square', saw: 'sawtooth', triangle: 'triangle' };

/**
 * Create the audio system.
 * @returns {{
 *   muted:boolean, ready:boolean,
 *   resume():void, play(name:string):void, playDescriptor(d:object):void,
 *   setDescriptors(map:Object<string,object>):void, setVolume(v:number):void
 * }}
 */
export function createAudio() {
  let ctx = null;
  let master = null;
  let noiseBuffer = null;
  let failed = false;
  let descriptors = {};

  const audio = {
    muted: false,
    get ready() { return !!ctx; },

    /** Create/resume the AudioContext. Call from a user gesture. */
    resume() {
      ensureContext();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },

    /** Replace the name -> descriptor map (usually theme.sfx). */
    setDescriptors(map) {
      descriptors = map || {};
    },

    /** Master volume 0..1. */
    setVolume(v) {
      if (master) master.gain.value = Math.max(0, Math.min(1, v)) * MASTER_GAIN;
    },

    /** Play a named sound; silently ignores unknown names and missing audio. */
    play(name) {
      if (audio.muted || !ctx) return;
      const d = descriptors[name];
      if (!d) return;
      audio.playDescriptor(d);
    },

    /** Play a descriptor (or array of descriptors) directly. */
    playDescriptor(d) {
      if (audio.muted || !ctx || !d) return;
      if (Array.isArray(d)) {
        for (const part of d) audio.playDescriptor(part);
        return;
      }
      try {
        voice(d);
      } catch (err) {
        // Never let a sound effect crash the game.
      }
    },
  };

  function ensureContext() {
    if (ctx || failed) return ctx;
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { failed = true; return null; }
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      master.connect(ctx.destination);
    } catch (err) {
      failed = true;
      ctx = null;
    }
    return ctx;
  }

  function getNoise() {
    if (noiseBuffer) return noiseBuffer;
    const len = Math.floor(ctx.sampleRate * NOISE_SECONDS);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1; // cosmetic only
    return noiseBuffer;
  }

  function voice(d) {
    const t0 = ctx.currentTime + (d.delay || 0);
    const dur = d.dur ?? DEFAULT_DUR;
    const decay = d.decay ?? DEFAULT_DECAY;
    const vol = d.volume ?? DEFAULT_VOLUME;
    const freq = Math.max(MIN_FREQ, d.freq || DEFAULT_FREQ);
    const slide = d.slide ? Math.max(MIN_FREQ, d.slide) : 0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(MIN_GAIN, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + ATTACK);
    gain.gain.setValueAtTime(vol, t0 + dur);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, t0 + dur + decay);
    gain.connect(master);

    let src;
    if (d.type === 'noise') {
      src = ctx.createBufferSource();
      src.buffer = getNoise();
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = d.q ?? NOISE_Q;
      filter.frequency.setValueAtTime(freq, t0);
      if (slide) filter.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
    } else {
      src = ctx.createOscillator();
      src.type = OSC_TYPES[d.type] || OSC_TYPES.sine;
      src.frequency.setValueAtTime(freq, t0);
      if (slide) src.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      src.connect(gain);
    }
    src.start(t0);
    src.stop(t0 + dur + decay + STOP_PAD);
  }

  if (typeof globalThis.addEventListener === 'function') {
    const onGesture = () => audio.resume();
    for (const name of GESTURE_EVENTS) {
      globalThis.addEventListener(name, onGesture, { once: true, passive: true });
    }
  }

  return audio;
}
