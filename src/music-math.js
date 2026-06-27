// music-math.js — PURE pitch math. No Web Audio, no MIDI, no DOM.
// Shared by the controller, sonicLogic and every sound engine.
//
// Board → note mapping (from "Ajedrez Sonoro", rule 1):
//   files a..h use American letter notation, the rank number is the OCTAVE index.
//     a→A  b→B  c→C  d→D  e→E  f→F  g→G  h→A      (a and h are both A: only 7 pitch classes)
//   Worked examples from the document (used as unit tests below):
//     e1 = "Mi 1" = E1   d8 = "Re 8" = D8   f3 = "Fa 3" = F3
//
// Convention: scientific pitch, C4 = MIDI 60  ⇒  midi = 12*(rank+1) + semitone(pitchClass).
//   e1 → 12*2 + 4 = 28 (E1) ✓   d8 → 12*9 + 2 = 110 (D8) ✓   f3 → 12*4 + 5 = 53 (F3) ✓

export const FILE_TO_PC = { a: 'A', b: 'B', c: 'C', d: 'D', e: 'E', f: 'F', g: 'G', h: 'A' };
export const PC_OFFSET  = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }; // semitones above C

// Pitch-class names for labelling chords (sharps; the default mapping never uses them
// but transposition can).
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Fold any MIDI value into the valid [0,127] range, preserving pitch class.
 *  Load-bearing: a dominant chord stacked on a rank-8 king can exceed 127, and the
 *  MIDI/OSC bridges must never emit a byte > 127. */
export function foldMidi(m) {
  while (m < 0) m += 12;
  while (m > 127) m -= 12;
  return m;
}

/** "e1" + transpose → MIDI note (folded). The rank IS the scientific octave. */
export function squareToMidi(square, transpose = 0) {
  const file = square[0];
  const rank = Number(square[1]);
  return foldMidi(12 * (rank + 1) + PC_OFFSET[FILE_TO_PC[file]] + transpose);
}

export const midiToFreq = (m) => 440 * 2 ** ((m - 69) / 12);

/** "nota sensible" — the leading tone, a semitone below the fundamental. */
export const leadingToneOf = (m) => foldMidi(m - 1);

/** MIDI number → label like "E1" / "C#3" (uses scientific octave = midi/12 - 1). */
export function midiToLabel(m) {
  const pc = PC_NAMES[((m % 12) + 12) % 12];
  const octave = Math.floor(m / 12) - 1;
  return `${pc}${octave}`;
}

/** Rich note descriptor for a square, used in event payloads and the UI. */
export function squareToNote(square, transpose = 0) {
  const file = square[0];
  const rank = Number(square[1]);
  const midi = squareToMidi(square, transpose);
  return {
    square,
    pitchClass: FILE_TO_PC[file],
    octave: rank,
    midi,
    freq: midiToFreq(midi),
    // Label honours the document's convention (file letter + rank) at default tonality,
    // but falls back to the true sounding label when transposed so the badge stays truthful.
    label: transpose === 0 ? `${FILE_TO_PC[file]}${rank}` : midiToLabel(midi),
  };
}

// Chords (rule 7). The dominant is built treating the king's square note as the tonic:
// V7 lives a perfect 5th above. The "reposo" on checkmate is the tonic major triad (I).
const DOMINANT_SEVENTH = [7, 11, 14, 17]; // V root, maj 3rd, 5th, min 7th  (over the tonic)
const TONIC_MAJOR      = [0, 4, 7];       // I — the resolution / "reposo"

export const dominantChord   = (tonicMidi) => DOMINANT_SEVENTH.map((i) => foldMidi(tonicMidi + i));
export const resolutionChord = (tonicMidi) => TONIC_MAJOR.map((i) => foldMidi(tonicMidi + i));

/** Pretty note names for a chord, e.g. [35,39,42,45] → "B1 D#2 F#2 A2". */
export const chordLabels = (midis) => midis.map(midiToLabel);

// Available tonalities (rule 8). A tonality is just a global semitone transposition;
// because every other formula is interval-based, leading tones, dominants and
// resolutions all transpose for free. (Diatonic scale-snapping is a documented
// extension point — see README — and is intentionally NOT shipped in the PoC.)
export const TONALITIES = [
  { name: 'C (sin transposición)', transpose: 0 },
  { name: 'D♭ / C♯', transpose: 1 },
  { name: 'D', transpose: 2 },
  { name: 'E♭', transpose: 3 },
  { name: 'E', transpose: 4 },
  { name: 'F', transpose: 5 },
  { name: 'F♯', transpose: 6 },
  { name: 'G', transpose: 7 },
  { name: 'A♭', transpose: -4 },
  { name: 'A', transpose: -3 },
  { name: 'B♭', transpose: -2 },
  { name: 'B', transpose: -1 },
];
