// soundEngine.js — the swap-in seam.
//
// The whole app talks to ONE interface, in musical semantics (instrument family + MIDI +
// dynamic + opaque voiceId) — never raw Hz. WebAudio converts MIDI→Hz internally; the MIDI/OSC
// bridges pass MIDI through untouched. To wire the real Ableton+Max sounds later you implement
// this same interface (or just select 'midi' / 'osc' / 'bridge' here) — nothing else changes.
//
//   unlock(): Promise<void>            // call from a user gesture; resolves once audio is live
//   isReady(): boolean
//   name: string                       // for the output-mode UI
//
//   noteOn(instrument, midi, dyn, opts?): VoiceId           // a sustained voice
//   noteOff(voiceId, opts?)                                  // release it
//   swellVoice(voiceId, targetDyn, seconds)                  // ramp a held voice's dynamic
//   startCrescendo(instrument, leadingMidi, targetDyn, seconds, opts?): VoiceId   // en-prise swell
//   resolveToFundamental(voiceId, fundamentalMidi, dyn, opts?): VoiceId  // capture → sustains to end
//   cancelCrescendo(voiceId, opts?)                          // threat lifted without capture
//   playChord(midis[], dyn, opts?): VoiceId                  // dominant chord across present families
//   stopChord(voiceId, opts?)
//   finalResolution(midis[], opts?)                          // cadence, then all-notes-off
//   setMasterDynamic(value0to1)
//   setMute(boolean)
//   allNotesOff(opts?)
//   reset()
//
// Every backend implements these identically; voiceIds are opaque and engine-private.

import { WebAudioEngine } from './webAudioEngine.js';
import { MidiEngine } from './midiEngine.js';
import { OscEngine } from './oscEngine.js';
import { NullEngine } from './nullEngine.js';

export function makeEngine(mode = 'webaudio', opts = {}) {
  switch (mode) {
    case 'webaudio': return new WebAudioEngine(opts);
    case 'midi':     return new MidiEngine(opts);
    case 'osc':      return new OscEngine(opts);
    case 'null':     return new NullEngine(opts);
    default:         return new WebAudioEngine(opts);
  }
}
