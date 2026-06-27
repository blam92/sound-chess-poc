// Run: node src/music-math.test.mjs
// Verifies the pitch math against the document's worked examples before anything else is built.
import {
  squareToMidi, leadingToneOf, foldMidi, dominantChord, resolutionChord,
  midiToLabel, squareToNote,
} from './music-math.js';

let failures = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`✗ ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`✓ ${label}`);
};

// Document anchors
eq('e1 → E1 = 28 ("Mi 1")', squareToMidi('e1'), 28);
eq('d8 → D8 = 110 ("Re 8")', squareToMidi('d8'), 110);
eq('f3 → F3 = 53 ("Fa 3")', squareToMidi('f3'), 53);
eq('e8 (real black king) → E8 = 112', squareToMidi('e8'), 112);
eq('leading tone of f3 (F3) → E3 = 52', leadingToneOf(squareToMidi('f3')), 52);

// a and h are the same pitch class (unison)
eq('a1 === h1 (both A1)', squareToMidi('a1'), squareToMidi('h1'));
eq('a1 = 33', squareToMidi('a1'), 33);

// Labels
eq('label(28) = E1', midiToLabel(28), 'E1');
eq('label(53) = F3', midiToLabel(53), 'F3');
eq('squareToNote(e1).label = E1', squareToNote('e1').label, 'E1');

// Range of the 64 squares stays inside MIDI bounds
let min = 999, max = -999;
for (const f of 'abcdefgh') for (let r = 1; r <= 8; r++) {
  const m = squareToMidi(`${f}${r}`); min = Math.min(min, m); max = Math.max(max, m);
}
eq('min square note = c1 = 24', min, 24);
eq('max square note = b8 = 119', max, 119);

// Dominant / resolution on king at e1 (tonic E1=28): V7 = B–D#–F#–A
eq('dominantChord(28) = [35,39,42,45]', dominantChord(28), [35, 39, 42, 45]);
eq('resolutionChord(28) = [28,32,35]', resolutionChord(28), [28, 32, 35]);

// foldMidi keeps the bridge safe: dominant on rank-8 king must stay ≤127
eq('foldMidi(133) → 121', foldMidi(133), 121);
const e8dom = dominantChord(squareToMidi('e8')); // tonic 112
eq('dominant on e8 all ≤127', e8dom.every((m) => m >= 0 && m <= 127), true);

// Transposition shifts everything by a constant
eq('e1 transposed +2 = 30', squareToMidi('e1', 2), 30);
eq('leading tone transposes with it', leadingToneOf(squareToMidi('f3', 2)), 54);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
