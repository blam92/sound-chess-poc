// protocol.js — THE Ableton + Max/MSP integration contract, in one place.
//
// This is the seam. The MidiEngine and OscEngine send exactly these messages; the on-screen
// IO Monitor renders exactly these messages. So the byte/address stream is identical whether or
// not Ableton/Max is connected — you can verify the contract with the monitor alone, then flip
// the output mode and the same traffic flows to the real instruments. Nothing else changes.

// Instrument family → MIDI channel (0-based for the wire; +1 for the human label / Live track).
export const CHANNEL = {
  violins: 0,       // pawns
  violas: 1,        // bishops
  cellos: 2,        // knights
  doublebasses: 3,  // rooks
  flutes: 4,        // king & queen
};
export const MASTER_CHANNEL = 15; // ch 16, reserved for global CCs

// Dynamic → MIDI velocity (0..127) and Web Audio gain (0..1). Identical across engines.
export const DYN = {
  pp:  { vel: 24,  gain: 0.19 },
  p:   { vel: 40,  gain: 0.31 },
  mp:  { vel: 56,  gain: 0.44 },
  mf:  { vel: 72,  gain: 0.56 },
  f:   { vel: 92,  gain: 0.72 },
  ff:  { vel: 110, gain: 0.87 },
  fff: { vel: 124, gain: 0.98 },
};
export const dynVel  = (d) => (DYN[d] ?? DYN.mf).vel;
export const dynGain = (d) => (DYN[d] ?? DYN.mf).gain;

// Control Change numbers used by the contract.
export const CC = {
  MOD: 1,
  VOLUME: 7,        // master volume (ch 16)
  EXPRESSION: 11,   // per-channel crescendo / dynamics ramp
  TONALITY: 20,     // custom: semitone offset, value = n + 64 (ch 16)
  DENSITY: 21,      // custom: inverse-density scalar (ch 16)
  ALL_NOTES_OFF: 123,
};

// --- MIDI byte builders ---------------------------------------------------
export const noteOnBytes  = (instrument, midi, dyn) => [0x90 | CHANNEL[instrument], midi & 0x7f, dynVel(dyn)];
export const noteOffBytes = (instrument, midi)      => [0x80 | CHANNEL[instrument], midi & 0x7f, 0];
export const ccBytes      = (channel, cc, value)    => [0xb0 | channel, cc & 0x7f, value & 0x7f];

// --- OSC address scheme (→ Max [udpreceive 7400]) -------------------------
// Carried browser→bridge as JSON {address, args}; the Node bridge re-types & sends UDP/OSC.
export const osc = {
  noteOn:    (instrument, midi, dyn) => ({ address: '/ajedrez/note/on',  args: [CHANNEL[instrument], midi, dynGain(dyn)] }),
  noteOff:   (instrument, midi)      => ({ address: '/ajedrez/note/off', args: [CHANNEL[instrument], midi] }),
  crescendo: (instrument, lead, tgt, secs) => ({ address: '/ajedrez/crescendo', args: [CHANNEL[instrument], lead, dynGain(tgt), secs] }),
  resolve:   (instrument, fund, dyn) => ({ address: '/ajedrez/resolve', args: [CHANNEL[instrument], fund, dynGain(dyn)] }),
  chord:     (quality, root, dyn)    => ({ address: '/ajedrez/chord',   args: [quality, root, dynGain(dyn)] }),
  dynamic:   (channel, value01)      => ({ address: '/ajedrez/dynamic', args: [channel, value01] }),
  tonality:  (semitones)             => ({ address: '/ajedrez/tonality', args: [semitones] }),
  cadence:   (tonicMidi, tailSec)    => ({ address: '/ajedrez/cadence', args: [tonicMidi, tailSec] }),
  reset:     ()                      => ({ address: '/ajedrez/reset',   args: [] }),
};

const hex = (b) => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/** Render a semantic action as the MIDI + OSC the bridges would emit (for the IO monitor).
 *  `a` = { kind, instrument?, midi?, dyn?, lead?, target?, secs?, quality?, root?, channel?, value?, semitones? } */
export function describe(a) {
  switch (a.kind) {
    case 'noteOn':
      return { midi: `${hex(noteOnBytes(a.instrument, a.midi, a.dyn))}  NoteOn ch${CHANNEL[a.instrument] + 1} ${a.midi} v${dynVel(a.dyn)}`,
               osc: oscStr(osc.noteOn(a.instrument, a.midi, a.dyn)) };
    case 'noteOff':
      return { midi: `${hex(noteOffBytes(a.instrument, a.midi))}  NoteOff ch${CHANNEL[a.instrument] + 1} ${a.midi}`,
               osc: oscStr(osc.noteOff(a.instrument, a.midi)) };
    case 'crescendo':
      return { midi: `${hex(noteOnBytes(a.instrument, a.lead, 'pp'))}  NoteOn(lead) ${a.lead} + CC11 ramp pp→${a.target} ${a.secs}s ch${CHANNEL[a.instrument] + 1}`,
               osc: oscStr(osc.crescendo(a.instrument, a.lead, a.target, a.secs)) };
    case 'resolve':
      return { midi: `${hex(noteOffBytes(a.instrument, a.lead))} → ${hex(noteOnBytes(a.instrument, a.midi, a.dyn))}  resolve→${a.midi} (sustains)`,
               osc: oscStr(osc.resolve(a.instrument, a.midi, a.dyn)) };
    case 'chord':
      return { midi: `chord ${a.quality} root ${a.root} v${dynVel(a.dyn)} across active channels`,
               osc: oscStr(osc.chord(a.quality, a.root, a.dyn)) };
    case 'cadence':
      return { midi: `cadence on ${a.root}, then CC123 all-notes-off`,
               osc: oscStr(osc.cadence(a.root, a.tailSec ?? 3)) };
    case 'master':
      return { midi: `${hex(ccBytes(MASTER_CHANNEL, CC.VOLUME, Math.round(a.value * 127)))}  CC7 master ${Math.round(a.value * 127)}`,
               osc: oscStr(osc.dynamic(MASTER_CHANNEL, a.value)) };
    case 'tonality':
      return { midi: `${hex(ccBytes(MASTER_CHANNEL, CC.TONALITY, a.semitones + 64))}  CC20 tonality ${a.semitones}`,
               osc: oscStr(osc.tonality(a.semitones)) };
    case 'density':
      return { midi: `${hex(ccBytes(MASTER_CHANNEL, CC.DENSITY, Math.round(a.value * 127)))}  CC21 density ${Math.round(a.value * 127)}`,
               osc: oscStr(osc.dynamic(MASTER_CHANNEL, a.value)) };
    case 'allOff':
      return { midi: `CC123 all-notes-off (all channels)`, osc: oscStr(osc.reset()) };
    default:
      return { midi: a.kind, osc: '' };
  }
}

function oscStr(m) {
  return `${m.address} ${m.args.map((x) => (typeof x === 'number' && !Number.isInteger(x) ? x.toFixed(2) : x)).join(' ')}`.trim();
}
