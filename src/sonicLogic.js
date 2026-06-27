// sonicLogic.js — the single source of truth for "what is currently sounding".
// It subscribes to the semantic event bus, owns the active voice set, and drives the selected
// SoundEngine plus the IO monitor. UI panels read from it; nothing else mutates voices.
import { EVENT } from './events.js';
import { squareToMidi, leadingToneOf, midiToLabel, dominantChord } from './music-math.js';
import { makeEngine } from './audio/soundEngine.js';

const HELD_RAMP_S = 2.5;   // a held piece swells with dwell time ("play with time")
const CRESC_S     = 4.0;   // en-prise leading-tone crescendo length
const CAPTURABLE  = 30;    // non-king pieces that can be captured (for the density meter)

export function createSonicLogic(bus, { monitor, mode = 'webaudio' } = {}) {
  let engine = makeEngine(mode);
  let transpose = 0;
  const log = (action) => { if (monitor) monitor(action); };

  // voice records, keyed by a stable internal id (independent of any engine's voiceId)
  const voices = new Map(); // id → { id, source, instrument, square, midi, label, dynamic, sustaining, detail, engVid }
  const king = { w: null, b: null };
  const threats = new Map(); // square → voice id
  const captured = new Set();
  let held = null;
  let dominant = null;
  let nextId = 0;
  let ended = false;
  let endTimer = null; // pending end-of-piece cleanup; cancelled on reset

  function notify() {
    bus.emit(EVENT.VOICES_CHANGED, {
      voices: [...voices.values()],
      density: captured.size / CAPTURABLE,
      capturedCount: captured.size,
      voiceCount: voices.size,
    });
  }
  function add(rec) { rec.id = 'sv' + (++nextId); voices.set(rec.id, rec); return rec; }
  function drop(id, releaseSec) {
    const rec = voices.get(id);
    if (!rec) return;
    engine.noteOff(rec.engVid, releaseSec != null ? { releaseSec } : undefined);
    voices.delete(id);
  }
  function presentFamilies() {
    return [...new Set([...voices.values()].map((v) => v.instrument))];
  }

  // --- engine lifecycle ----------------------------------------------------
  async function unlock() { await engine.unlock(); }
  function isReady() { return engine.isReady(); }
  function engineName() { return engine.name; }
  function engineStatus() { return engine.status ? engine.status() : 'ok'; }

  /** Swap the audible backend mid-game, re-issuing every sustaining voice so nothing drops. */
  async function setMode(newMode) {
    const carry = [...voices.values()].filter((v) => v.source === 'king' || v.source === 'capture' || v.source === 'threat');
    const dom = dominant ? voices.get(dominant) : null;
    // the held voice is transient — drop it cleanly rather than orphan a dead engVid
    if (held) { voices.delete(held); held = null; }
    engine.reset();
    engine = makeEngine(newMode);
    await engine.unlock();
    for (const rec of carry) {
      rec.engVid = rec.source === 'threat'
        ? engine.startCrescendo(rec.instrument, rec.midi, 'f', CRESC_S)
        : engine.noteOn(rec.instrument, rec.midi, rec.dynamic);
    }
    // a live check chord (edge-triggered, so it never re-fires) must survive the swap
    if (dom) dom.engVid = engine.playChord(dom.chordMidis, 'ff', { instruments: presentFamilies() });
    notify();
    return engine.name;
  }

  function setMaster(v) { engine.setMasterDynamic(v); log({ kind: 'master', value: v }); }
  function setMute(on) { engine.setMute(on); }
  function getEngine() { return engine; }

  // --- event handlers ------------------------------------------------------
  bus.on(EVENT.GAME_RESET, () => {
    if (endTimer) { clearTimeout(endTimer); endTimer = null; } // don't let a stale end-timer wipe the new game
    engine.reset();
    voices.clear(); threats.clear(); captured.clear();
    king.w = king.b = null; held = null; dominant = null; ended = false;
    notify();
  });

  bus.on(EVENT.SET_TONALITY, ({ transpose: t }) => {
    transpose = t;
    log({ kind: 'tonality', semitones: t });
    // retune sustaining voices to the new key (kings, captured pads, active threats, live dominant)
    for (const rec of voices.values()) {
      if (rec.source === 'held') continue; // transient — leave it
      if (rec.source === 'dominant') {
        const chord = dominantChord(squareToMidi(rec.square, transpose));
        engine.stopChord(rec.engVid, { releaseSec: 0.1 });
        rec.chordMidis = chord;
        rec.midi = chord[0];
        rec.label = chord.map(midiToLabel).join(' ');
        rec.engVid = engine.playChord(chord, 'ff', { instruments: presentFamilies() });
        continue;
      }
      const base = squareToMidi(rec.square, transpose);
      const newMidi = rec.source === 'threat' ? leadingToneOf(base) : base;
      engine.noteOff(rec.engVid, { releaseSec: 0.1 });
      rec.midi = newMidi;
      rec.label = midiToLabel(newMidi);
      rec.engVid = rec.source === 'threat'
        ? engine.startCrescendo(rec.instrument, newMidi, 'f', CRESC_S)
        : engine.noteOn(rec.instrument, newMidi, rec.dynamic);
    }
    notify();
  });

  bus.on(EVENT.KING_SUSTAIN_ON, ({ color, square, note }) => {
    if (king[color]) drop(king[color]);
    const rec = add({ source: 'king', instrument: 'flutes', square, midi: note.midi,
      label: note.label, dynamic: 'mp', sustaining: true, detail: `rey ${color === 'w' ? 'blanco' : 'negro'}` });
    rec.engVid = engine.noteOn('flutes', note.midi, 'mp');
    king[color] = rec.id;
    log({ kind: 'noteOn', instrument: 'flutes', midi: note.midi, dyn: 'mp' });
    notify();
  });

  bus.on(EVENT.KING_SUSTAIN_OFF, ({ color }) => {
    const id = king[color];
    if (!id) return; // idempotent
    const rec = voices.get(id);
    drop(id, 0.4);
    king[color] = null;
    if (rec) log({ kind: 'noteOff', instrument: 'flutes', midi: rec.midi });
    notify();
  });

  bus.on(EVENT.PIECE_LIFT, ({ instrument, note, square }) => {
    if (held) drop(held, 0.2);
    const rec = add({ source: 'held', instrument, square, midi: note.midi, label: note.label,
      dynamic: 'mp', sustaining: false, detail: 'en el aire' });
    rec.engVid = engine.noteOn(instrument, note.midi, 'mp');
    engine.swellVoice(rec.engVid, 'f', HELD_RAMP_S); // tension rises the longer it's held
    held = rec.id;
    log({ kind: 'noteOn', instrument, midi: note.midi, dyn: 'mp' });
    notify();
  });

  bus.on(EVENT.PIECE_PLACE, () => {
    if (!held) return;
    const rec = voices.get(held);
    drop(held, 0.4);
    held = null;
    if (rec) log({ kind: 'noteOff', instrument: rec.instrument, midi: rec.midi });
    notify();
  });

  bus.on(EVENT.PIECE_THREATENED, ({ square, instrument, note, leadingTone }) => {
    if (threats.has(square)) return; // already crescendoing
    const rec = add({ source: 'threat', instrument, square, midi: leadingTone.midi,
      label: midiToLabel(leadingTone.midi), dynamic: 'f', sustaining: false,
      detail: `sensible → ${note.label}`, fundamental: note.midi, fundamentalLabel: note.label });
    rec.engVid = engine.startCrescendo(instrument, leadingTone.midi, 'f', CRESC_S);
    threats.set(square, rec.id);
    log({ kind: 'crescendo', instrument, lead: leadingTone.midi, target: 'f', secs: CRESC_S });
    notify();
  });

  bus.on(EVENT.PIECE_SAFE, ({ square }) => {
    const id = threats.get(square);
    if (!id) return;
    const rec = voices.get(id);
    engine.cancelCrescendo(rec.engVid);
    voices.delete(id);
    threats.delete(square);
    log({ kind: 'noteOff', instrument: rec.instrument, midi: rec.midi });
    notify();
  });

  bus.on(EVENT.PIECE_CAPTURED, ({ square, instrument, note }) => {
    const threatId = threats.get(square);
    if (threatId) {
      // resolve the leading-tone crescendo down to the fundamental, which now sustains to game end
      const rec = voices.get(threatId);
      const leadMidi = rec.midi;
      engine.resolveToFundamental(rec.engVid, note.midi, 'f');
      rec.source = 'capture'; rec.sustaining = true; rec.dynamic = 'f';
      rec.detail = `capturada (${note.label})`; rec.midi = note.midi; rec.label = note.label;
      threats.delete(square);
      captured.add(rec.id);
      log({ kind: 'resolve', instrument: rec.instrument, lead: leadMidi, midi: note.midi, dyn: 'f' });
    } else {
      const rec = add({ source: 'capture', instrument, square, midi: note.midi, label: note.label,
        dynamic: 'mf', sustaining: true, detail: `capturada (${note.label})` });
      rec.engVid = engine.noteOn(instrument, note.midi, 'mf');
      captured.add(rec.id);
      log({ kind: 'noteOn', instrument, midi: note.midi, dyn: 'mf' });
    }
    notify();
  });

  bus.on(EVENT.CHECK, ({ dominantChord: chord, note }) => {
    if (dominant) { const r = voices.get(dominant); if (r) engine.stopChord(r.engVid); voices.delete(dominant); }
    const rec = add({ source: 'dominant', instrument: 'flutes', square: note.square,
      midi: chord[0], chordMidis: chord, label: chord.map(midiToLabel).join(' '),
      dynamic: 'ff', sustaining: false, detail: 'acorde dominante (jaque)' });
    rec.engVid = engine.playChord(chord, 'ff', { instruments: presentFamilies() });
    dominant = rec.id;
    log({ kind: 'chord', quality: 'dominant', root: chord[0], dyn: 'ff' });
    notify();
  });

  bus.on(EVENT.CHECK_END, () => {
    if (!dominant) return;
    const rec = voices.get(dominant);
    if (rec) engine.stopChord(rec.engVid);
    voices.delete(dominant);
    dominant = null;
    notify();
  });

  bus.on(EVENT.CHECKMATE, ({ resolutionChord }) => {
    ended = true;
    if (dominant) { const r = voices.get(dominant); if (r) engine.stopChord(r.engVid, { releaseSec: 0.2 }); voices.delete(dominant); dominant = null; }
    engine.finalResolution(resolutionChord);
    log({ kind: 'cadence', root: resolutionChord[0], tailSec: 3 });
    // let the cadence ring, then clear the soundscape — but only if a new game hasn't started
    endTimer = setTimeout(() => {
      endTimer = null;
      if (!ended) return; // a GAME_RESET happened in the meantime — leave the fresh game alone
      voices.clear(); threats.clear(); king.w = king.b = null; held = null; dominant = null; notify();
    }, 1500);
    notify();
  });

  const gentleEnd = () => {
    ended = true;
    engine.allNotesOff({ releaseSec: 1.5 });
    endTimer = setTimeout(() => {
      endTimer = null;
      if (!ended) return;
      voices.clear(); threats.clear(); king.w = king.b = null; held = null; dominant = null; notify();
    }, 1200);
    notify();
  };
  bus.on(EVENT.STALEMATE, gentleEnd);
  bus.on(EVENT.DRAW, gentleEnd);

  return {
    unlock, isReady, engineName, engineStatus, setMode, setMaster, setMute, getEngine,
    getVoices: () => [...voices.values()],
    density: () => captured.size / CAPTURABLE,
    capturedCount: () => captured.size,
    presentFamilies,
    hasEnded: () => ended,
  };
}
