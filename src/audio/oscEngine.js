// oscEngine.js — OSC backend (continuous-control path → Node bridge → Max/MSP).
// Browsers can't emit UDP, so we send JSON {address,args} over a WebSocket to osc-bridge.js,
// which re-types it and forwards as OSC/UDP to Max's [udpreceive 7400]. Same interface as the
// other engines; messages follow protocol.osc exactly.
import { osc } from './protocol.js';

export class OscEngine {
  constructor({ url = 'ws://localhost:8081' } = {}) {
    this.name = 'OSC → Max';
    this.url = url;
    this.ws = null;
    this._status = 'idle';
    this._id = 0;
    this.voices = new Map(); // id → { instrument, midi }
    this._endTimer = null;
    this._masterGain = 0.8;
    this._muted = false;
  }

  async unlock() {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.url);
        this.ws.onopen = () => { this._status = 'connected'; resolve(); };
        this.ws.onerror = () => { this._status = 'no-bridge'; resolve(); };
        this.ws.onclose = () => { this._status = 'no-bridge'; };
        setTimeout(() => { if (this._status === 'idle') { this._status = 'no-bridge'; resolve(); } }, 1200);
      } catch {
        this._status = 'no-bridge'; resolve();
      }
    });
  }
  isReady() { return true; } // always "ready" — sound just needs the bridge+Max running
  status() { return this._status; }

  _send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  noteOn(instrument, midi, dyn = 'mf') {
    this._send(osc.noteOn(instrument, midi, dyn));
    const id = `${instrument}:${midi}:${++this._id}`;
    this.voices.set(id, { instrument, midi });
    return id;
  }
  noteOff(id) {
    const v = this.voices.get(id);
    if (!v) return;
    this._send(osc.noteOff(v.instrument, v.midi));
    this.voices.delete(id);
  }
  swellVoice(id, targetDyn = 'f', seconds = 2.5) {
    const v = this.voices.get(id);
    if (v) this._send(osc.crescendo(v.instrument, v.midi, targetDyn, seconds));
  }
  startCrescendo(instrument, leadingMidi, target = 'f', seconds = 4) {
    this._send(osc.crescendo(instrument, leadingMidi, target, seconds));
    const id = `${instrument}:${leadingMidi}:${++this._id}`;
    this.voices.set(id, { instrument, midi: leadingMidi });
    return id;
  }
  resolveToFundamental(id, fundMidi, dyn = 'f') {
    const v = this.voices.get(id);
    if (!v) return id;
    this._send(osc.resolve(v.instrument, fundMidi, dyn));
    v.midi = fundMidi;
    return id;
  }
  cancelCrescendo(id) { this.noteOff(id); }

  playChord(midis, dyn = 'ff', { instruments, quality = 'dominant' } = {}) {
    const pool = (instruments && instruments.length) ? instruments
      : [...new Set([...this.voices.values()].map((v) => v.instrument))];
    const fams = pool.length ? pool : ['flutes'];
    this._send(osc.chord(quality, midis[0], dyn));
    const ids = midis.map((midi, i) => this.noteOn(fams[i % fams.length], midi, dyn));
    return ids.join(',');
  }
  stopChord(id) { if (id) id.split(',').forEach((s) => this.noteOff(s)); }

  finalResolution(midis) {
    this._send(osc.cadence(midis[0], 3));
    const id = this.playChord(midis, 'ff', { quality: 'major' }); // a cadence is the tonic, not a dominant
    if (this._endTimer) clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => { this._endTimer = null; this.allNotesOff(); }, 1500);
    return id;
  }

  setMasterDynamic(value) {
    this._masterGain = typeof value === 'number' ? value : 0.8;
    if (this._muted) return;
    this._send(osc.dynamic(15, this._masterGain));
  }
  setMute(on) { this._muted = on; this._send(osc.dynamic(15, on ? 0 : this._masterGain)); }
  allNotesOff() { this.voices.clear(); this._send(osc.reset()); }
  reset() {
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
    this.voices.clear(); this._send(osc.reset());
  }
}
