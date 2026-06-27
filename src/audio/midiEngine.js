// midiEngine.js — Web MIDI backend (notes path → macOS IAC bus → Ableton Live).
// Implements the exact same interface as WebAudioEngine. When a virtual MIDI port is present,
// Live triggers the recorded string/flute samples; with no port it degrades gracefully (the IO
// monitor still shows the byte stream, driven by sonicLogic). Chrome/Edge only — Safari/Firefox
// lack Web MIDI.
import {
  CHANNEL, MASTER_CHANNEL, CC, dynVel, noteOnBytes, noteOffBytes, ccBytes,
} from './protocol.js';

export class MidiEngine {
  constructor({ portName = 'Ajedrez Bus' } = {}) {
    this.name = 'MIDI → Ableton';
    this.portName = portName;
    this.out = null;
    this._status = 'idle';
    this._id = 0;
    this.voices = new Map(); // id → { instrument, midi, timer }
    this._endTimer = null;
    this._masterGain = 0.8;
    this._muted = false;
  }

  async unlock() {
    if (!navigator.requestMIDIAccess) { this._status = 'unavailable'; return; }
    try {
      const midi = await navigator.requestMIDIAccess({ sysex: false });
      const outs = [...midi.outputs.values()];
      this.out = outs.find((o) => o.name.includes(this.portName)) || outs[0] || null;
      this._status = this.out ? 'connected' : 'no-port';
    } catch {
      this._status = 'denied';
    }
  }
  isReady() { return this._status === 'connected' || this._status === 'no-port'; }
  status() { return this._status; }

  _send(bytes) { if (this.out) this.out.send(bytes); }

  noteOn(instrument, midi, dyn = 'mf') {
    this._send(noteOnBytes(instrument, midi, dyn));
    const id = `${instrument}:${midi}:${++this._id}`;
    this.voices.set(id, { instrument, midi });
    return id;
  }
  noteOff(id) {
    const v = this.voices.get(id);
    if (!v) return;
    if (v.timer) clearInterval(v.timer);
    this._send(noteOffBytes(v.instrument, v.midi));
    this.voices.delete(id);
  }

  swellVoice(id, targetDyn = 'f', seconds = 2.5) {
    const v = this.voices.get(id);
    if (!v) return;
    this._rampExpression(v, dynVel('mp'), dynVel(targetDyn), seconds);
  }

  startCrescendo(instrument, leadingMidi, target = 'f', seconds = 4) {
    this._send(noteOnBytes(instrument, leadingMidi, 'pp'));
    const id = `${instrument}:${leadingMidi}:${++this._id}`;
    const v = { instrument, midi: leadingMidi };
    this.voices.set(id, v);
    this._rampExpression(v, dynVel('pp'), dynVel(target), seconds);
    return id;
  }
  _rampExpression(v, from, to, seconds) {
    if (v.timer) clearInterval(v.timer);
    const ch = CHANNEL[v.instrument];
    const steps = 20;
    let i = 0;
    v.timer = setInterval(() => {
      i++;
      const value = Math.round(from + (to - from) * (i / steps));
      this._send(ccBytes(ch, CC.EXPRESSION, value));
      if (i >= steps) { clearInterval(v.timer); v.timer = null; }
    }, (seconds * 1000) / steps);
  }

  resolveToFundamental(id, fundMidi, dyn = 'f') {
    const v = this.voices.get(id);
    if (!v) return id;
    if (v.timer) { clearInterval(v.timer); v.timer = null; }
    this._send(noteOffBytes(v.instrument, v.midi));
    this._send(noteOnBytes(v.instrument, fundMidi, dyn));
    v.midi = fundMidi; // keeps sustaining (a captured pad)
    return id;
  }
  cancelCrescendo(id) { this.noteOff(id); }

  playChord(midis, dyn = 'ff', { instruments } = {}) {
    const pool = (instruments && instruments.length) ? instruments
      : [...new Set([...this.voices.values()].map((v) => v.instrument))];
    const fams = pool.length ? pool : ['flutes'];
    const ids = midis.map((midi, i) => this.noteOn(fams[i % fams.length], midi, dyn));
    return ids.join(',');
  }
  stopChord(id) { if (id) id.split(',').forEach((s) => this.noteOff(s)); }

  finalResolution(midis) {
    const id = this.playChord(midis, 'ff', {});
    if (this._endTimer) clearTimeout(this._endTimer);
    this._endTimer = setTimeout(() => { this._endTimer = null; this.allNotesOff(); }, 1500);
    return id;
  }

  setMasterDynamic(value) {
    this._masterGain = typeof value === 'number' ? value : dynVel(value) / 127;
    if (this._muted) return;
    this._send(ccBytes(MASTER_CHANNEL, CC.VOLUME, Math.round(this._masterGain * 127)));
  }
  setMute(on) {
    this._muted = on;
    this._send(ccBytes(MASTER_CHANNEL, CC.VOLUME, on ? 0 : Math.round(this._masterGain * 127)));
  }

  allNotesOff() {
    for (const v of this.voices.values()) if (v.timer) clearInterval(v.timer);
    this.voices.clear();
    [...Object.values(CHANNEL), MASTER_CHANNEL].forEach((ch) => this._send(ccBytes(ch, CC.ALL_NOTES_OFF, 0)));
  }
  reset() {
    if (this._endTimer) { clearTimeout(this._endTimer); this._endTimer = null; }
    this.allNotesOff();
  }
}
