// Thunder: a quiet, low, rolling rumble a moment after a flash that is near enough to hear, made with
// Web Audio from noise (no sound files). It stands alone (no three, nothing of the page), so the game
// can take it as it is:
//
//   const thunder = new Thunder();       // makes nothing yet
//   thunder.setEnabled(true);            // starts its AudioContext: call it from a click or a key
//   thunder.setVolume(0.5);              // 0..1, the master level (quiet by design at 1)
//   thunder.strike({ distanceKm: 2.4 }); // a flash 2.4 km away: a rumble in about 7 seconds
//   thunder.strike({ inSpace: true });   // in orbit: faint and muffled, a second or two later
//   thunder.strike({ distanceKm: 1, pan: 0.5 }); // `pan` (-1 left .. 1 right): the side it comes from
//
// From the ground the delay is the distance over the speed of sound (0.343 km a second), and the
// farther the flash the quieter, lower, slower to swell and longer the roll; past HEAR_KM nothing is
// heard. In orbit there is no air to carry it: the owner asked for it faintly all the same, so a flash
// there gives a far softer, darker rumble a second or two later. At most a few rumbles sound at once,
// and in orbit one every couple of seconds at most, so a busy storm never piles up into a roar.
// Each rumble is a few nodes made when it starts (Web Audio's sources play once); nothing is made
// while nothing strikes, and the noise it is cut from is made once.

export const SPEED_OF_SOUND_KM_S = 0.343;
export const HEAR_KM = 6;
const MAX_VOICES = 4;
const SPACE_GAP_S = 2;

export class Thunder {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.enabled = false;
    this.volume = 0.5;
    this.voices = 0;
    this.lastSpace = -1e9;
    this.seed = 0x9e3779b9;
    // what was scheduled, for the checks: [{ at, delay, distanceKm, gain, length, inSpace }]
    this.log = [];
  }

  rand() {
    this.seed = (this.seed + 0x6D2B79F5) | 0;
    let t = Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** On or off. The first time on, it makes its context (a page needs a click or key before sound). */
  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled && !this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) { this.enabled = false; return false; }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.level();
      this.master.connect(this.ctx.destination);
      this.noise = this.brownNoise(6);
    }
    if (this.ctx) {
      if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this.master.gain.setTargetAtTime(this.enabled ? this.level() : 0, this.ctx.currentTime, 0.05);
    }
    return this.enabled;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    if (this.ctx && this.enabled) this.master.gain.setTargetAtTime(this.level(), this.ctx.currentTime, 0.05);
  }

  // quiet by design: the dial's top is a gentle level, not a loud one. (The look tuner's pass: rendered
  // offline at 0.55 a near rumble's loudest twentieth of a second sat at -37 dBFS at the dial's start and
  // an orbital one at -50, below what most desk speakers give at a hundred hertz; twice that (and the
  // orbital one's filter opened a little) measured -34 and -47, still well under speech, and the dial's
  // top is 12 dB above its start.)
  level() { return 1.1 * this.volume * this.volume; }

  /** Brown (red) noise: deep and soft, the stuff of a distant rumble. */
  brownNoise(seconds) {
    const rate = this.ctx.sampleRate, n = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, n, rate);
    const d = buf.getChannelData(0);
    let last = 0, peak = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.02 * (this.rand() * 2 - 1)) / 1.02;
      d[i] = last;
      peak = Math.max(peak, Math.abs(last));
    }
    for (let i = 0; i < n; i++) d[i] /= peak || 1;
    return buf;
  }

  /**
   * A flash: schedule its rumble. `distanceKm` from the ground (ignored in space), `strength` 0..1+
   * (how bright the flash was), `inSpace` for orbit. Returns the delay in seconds, or -1 when nothing
   * will sound (off, too far, too many at once).
   */
  strike({ distanceKm = 3, strength = 1, inSpace = false, pan = null } = {}) {
    if (!this.enabled || !this.ctx || this.ctx.state === 'closed') return -1;
    const now = this.ctx.currentTime;
    let delay, gain, length, cutoff, swell;
    if (inSpace) {
      if (now - this.lastSpace < SPACE_GAP_S) return -1;
      this.lastSpace = now;
      delay = 0.6 + this.rand() * 1.8;
      gain = 0.12 * Math.min(1.2, strength);
      length = 2.5 + this.rand() * 2;
      // (the look tuner's pass) a little above where most speakers stop, so faint still means heard
      cutoff = 120;
      swell = 0.45;
    } else {
      const d = Math.max(0.2, distanceKm);
      if (d > HEAR_KM) return -1;
      delay = d / SPEED_OF_SOUND_KM_S;
      gain = Math.min(1, strength) / (1 + Math.pow(d / 1.6, 1.3));
      length = 1.6 + d * 0.7 + this.rand() * 1.5;
      cutoff = 340 / (1 + d * 0.45);
      swell = 0.05 + d * 0.07;
    }
    if (this.voices >= MAX_VOICES || gain < 0.004) return -1;
    this.voices++;
    const t0 = now + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lp1 = this.ctx.createBiquadFilter(), lp2 = this.ctx.createBiquadFilter();
    lp1.type = lp2.type = 'lowpass';
    lp1.Q.value = 0.6; lp2.Q.value = 0.5;
    // the roll darkens as it goes
    lp1.frequency.setValueAtTime(cutoff, t0);
    lp1.frequency.exponentialRampToValueAtTime(Math.max(40, cutoff * 0.45), t0 + length);
    lp2.frequency.value = cutoff * 1.4;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    // a swell, then rolls: a few softer peaks at irregular times, dying away
    env.gain.exponentialRampToValueAtTime(gain, t0 + swell);
    let t = t0 + swell, g = gain;
    const rolls = 2 + Math.floor(this.rand() * 3);
    // (the reviewer's pass) the rolls end before the fade does: drawn freely their gaps could run past the
    // rumble's end, leaving the fade scheduled before a roll and the sound cut off mid-roll with a click
    const lastRoll = t0 + length * 0.85;
    for (let i = 0; i < rolls; i++) {
      const gap = Math.min((length - swell) / (rolls + 1) * (0.6 + this.rand() * 0.8), lastRoll - t);
      if (!(gap > 0.08)) break;
      g *= 0.55 + this.rand() * 0.3;
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, g * 0.35), t + gap * 0.55);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), t + gap);
      t += gap;
    }
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
    // (the look tuner's pass) where it comes from: the caller's side (-1 left .. 1 right), else a little to
    // one side or the other
    const pn = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pn) pn.pan.value = Math.max(-1, Math.min(1, pan ?? (inSpace ? 0 : (this.rand() * 2 - 1) * 0.3)));
    src.connect(lp1).connect(lp2).connect(env);
    (pn ? env.connect(pn) : env).connect(this.master);
    const offset = this.rand() * Math.max(0, this.noise.duration - length - 0.1);
    src.start(t0, offset, length + 0.05);
    src.onended = () => { this.voices--; src.disconnect(); env.disconnect(); if (pn) pn.disconnect(); };
    this.log.push({ at: performance.now() / 1000, delay, distanceKm: inSpace ? null : distanceKm, gain, length, inSpace });
    if (this.log.length > 64) this.log.shift();
    return delay;
  }
}
