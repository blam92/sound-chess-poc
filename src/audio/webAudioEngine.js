// webAudioEngine.js — the PoC default backend. Placeholder synth voices, just distinct enough
// that the five instrument families are tellable apart. The REAL recorded strings/flutes arrive
// later in Ableton (select the 'midi'/'osc' engine). Captured-square pads are simply never
// stopped, so the inverse-density growth of rule 3 falls out for free.
import { midiToFreq } from '../music-math.js';
import { dynGain } from './protocol.js';

// Per-family timbre (waveforms + filter), purely for legibility.
const TIMBRE = {
  violins:      { type: 'sawtooth', detune: 6, cutoff: 4000, sub: false },
  violas:       { type: 'sawtooth', detune: 0, cutoff: 2500, sub: false },
  cellos:       { type: 'sawtooth', detune: 0, cutoff: 1800, sub: true },
  doublebasses: { type: 'triangle', detune: 0, cutoff: 900,  sub: true },
  flutes:       { type: 'sine',     detune: 0, cutoff: 6000, sub: false },
};

export class WebAudioEngine {
  constructor() {
    this.name = 'Web Audio';
    this.ctx = null;
    this.master = null;
    this.voices = new Map();
    this._id = 0;
    this._muted = false;
    this._masterGain = 0.8;
    this._endTimer = null;
  }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._masterGain;
      const comp = this.ctx.createDynamicsCompressor(); // tame stacked pads
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }
  isReady() { return !!this.ctx && this.ctx.state === 'running'; }

  _now() { return this.ctx.currentTime; }

  _mkVoice(family, midi, gainVal) {
    const t = TIMBRE[family] || TIMBRE.flutes;
    const now = this._now();
    const out = this.ctx.createGain();
    out.gain.value = 0;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = t.cutoff;
    lp.connect(out);
    out.connect(this.master);

    const oscs = [];
    const freq = midiToFreq(midi);
    const mk = (f, detune, type) => {
      const o = this.ctx.createOscillator();
      o.type = type; o.frequency.value = f; o.detune.value = detune;
      o.connect(lp); o.start();
      return o;
    };
    oscs.push(mk(freq, 0, t.type));
    if (t.detune) { oscs.push(mk(freq, t.detune, t.type), mk(freq, -t.detune, t.type)); }
    if (t.sub) oscs.push(mk(freq / 2, 0, 'sine'));

    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(gainVal, now + 0.04);        // attack
    out.gain.linearRampToValueAtTime(gainVal * 0.85, now + 0.25); // decay → sustain
    return { oscs, out, lp, family, midi, level: gainVal };
  }

  noteOn(family, midi, dyn = 'mf') {
    const id = 'v' + (++this._id);
    this.voices.set(id, this._mkVoice(family, midi, dynGain(dyn)));
    return id;
  }
  noteOff(id, { releaseSec = 0.6 } = {}) {
    const v = this.voices.get(id);
    if (!v) return;
    const now = this._now();
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(0, now + releaseSec);
    v.oscs.forEach((o) => o.stop(now + releaseSec + 0.02));
    this.voices.delete(id);
  }

  swellVoice(id, targetDyn = 'f', seconds = 2.5) {
    const v = this.voices.get(id);
    if (!v) return;
    const now = this._now();
    const g = dynGain(targetDyn);
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(v.out.gain.value, now);
    v.out.gain.linearRampToValueAtTime(g, now + seconds);
    v.level = g;
  }

  startCrescendo(family, leadingMidi, target = 'f', seconds = 4) {
    const id = 'v' + (++this._id);
    const v = this._mkVoice(family, leadingMidi, dynGain('pp'));
    const now = this._now();
    v.out.gain.cancelScheduledValues(now);
    v.out.gain.setValueAtTime(dynGain('pp'), now + 0.05);
    v.out.gain.linearRampToValueAtTime(dynGain(target), now + seconds);
    this.voices.set(id, v);
    return id;
  }
  resolveToFundamental(id, fundMidi, dyn = 'f', { glideSec = 0.3 } = {}) {
    const v = this.voices.get(id);
    if (!v) return id;
    const now = this._now();
    const f = midiToFreq(fundMidi);
    v.oscs.forEach((o) => {
      const target = o.type === 'sine' && o.frequency.value < f / 1.5 ? f / 2 : f;
      o.frequency.cancelScheduledValues(now);
      o.frequency.setValueAtTime(o.frequency.value, now);
      o.frequency.exponentialRampToValueAtTime(Math.max(8, target), now + glideSec);
    });
    v.out.gain.linearRampToValueAtTime(dynGain(dyn), now + glideSec); // and keeps sustaining
    v.midi = fundMidi;
    return id; // same handle — now a captured pad
  }
  cancelCrescendo(id, opts) { this.noteOff(id, { releaseSec: opts?.releaseSec ?? 0.8 }); }

  playChord(midis, dyn = 'ff', { instruments } = {}) {
    const fams = (instruments && instruments.length) ? instruments
      : [...new Set([...this.voices.values()].map((v) => v.family))];
    const pool = fams.length ? fams : ['flutes'];
    const ids = midis.map((midi, i) => {
      const id = 'v' + (++this._id);
      this.voices.set(id, this._mkVoice(pool[i % pool.length], midi, dynGain(dyn)));
      return id;
    });
    return ids.join(',');
  }
  stopChord(id, opts) {
    if (!id) return;
    id.split(',').forEach((sub) => this.noteOff(sub, { releaseSec: opts?.releaseSec ?? 0.5 }));
  }

  finalResolution(midis, { tailSec = 3 } = {}) {
    const id = this.playChord(midis, 'ff', {});
    // ring the cadence, then let everything go (the piece ends)
    if (this._endTimer) clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => { this._endTimer = null; this.allNotesOff({ releaseSec: tailSec }); }, 1400);
    return id;
  }

  setMasterDynamic(value) {
    this._masterGain = typeof value === 'number' ? value : dynGain(value);
    if (!this.master || this._muted) return;
    this.master.gain.linearRampToValueAtTime(this._masterGain, this._now() + 0.2);
  }
  setMute(on) {
    this._muted = on;
    if (!this.master) return;
    this.master.gain.linearRampToValueAtTime(on ? 0 : this._masterGain, this._now() + 0.15);
  }

  allNotesOff({ releaseSec = 0.6 } = {}) {
    [...this.voices.keys()].forEach((id) => this.noteOff(id, { releaseSec }));
  }
  reset() {
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
    this.allNotesOff({ releaseSec: 0.2 });
  }
}
