// Run: node src/logic.test.mjs
// Headless integration test of the controller move-pipeline + sonicLogic reducer, using the
// silent NullEngine. Exercises the document's worked examples end-to-end.
import { EventBus, EVENT } from './events.js';
import { createController } from './controller.js';
import { createSonicLogic } from './sonicLogic.js';

let failures = 0;
const ok = (label, cond) => { if (cond) console.log(`✓ ${label}`); else { failures++; console.error(`✗ ${label}`); } };

function harness(fen) {
  const bus = new EventBus();
  const events = [];
  // record every semantic event
  for (const t of Object.values(EVENT)) bus.on(t, (d) => events.push({ t, d }));
  const sonic = createSonicLogic(bus, { mode: 'null' });
  const controller = createController(bus);
  controller.reset(fen);
  const play = (from, to, promo) => { controller.lift(from); return controller.place(to, promo); };
  const find = (t) => events.filter((e) => e.t === t).map((e) => e.d);
  return { controller, sonic, events, play, find };
}

// --- 1. opening: only the two kings sound (rule 4) ---
{
  const { find, sonic } = harness();
  const kings = find(EVENT.KING_SUSTAIN_ON);
  ok('opening: two king sustains', kings.length === 2);
  ok('white king sounds E1', kings.some((k) => k.color === 'w' && k.note.label === 'E1'));
  ok('black king sounds E8 (not d8)', kings.some((k) => k.color === 'b' && k.note.label === 'E8'));
  ok('opening: no captures', find(EVENT.PIECE_CAPTURED).length === 0);
  ok('opening: voices = 2 (kings only)', sonic.getVoices().length === 2);
}

// --- 2. the f3 example: pawn under attack → leading tone E3; captured → F3 sustains (rule 6/3) ---
{
  // black to move; black bishop c6 attacks white pawn f3
  const { find, play, sonic } = harness('4k3/8/2b5/8/8/5P2/8/4K3 b - - 0 1');
  const threat = find(EVENT.PIECE_THREATENED).find((d) => d.square === 'f3');
  ok('f3 pawn announced as threatened', !!threat);
  ok('threat note is F3 (53)', threat && threat.note.midi === 53);
  ok('leading tone is E3 (52)', threat && threat.leadingTone.midi === 52);
  ok('leading tone label is "E3" (not the fundamental)', threat && threat.leadingTone.label === 'E3');
  const res = play('c6', 'f3'); // bishop takes the pawn
  ok('capture committed', res.moved === true);
  const cap = find(EVENT.PIECE_CAPTURED).find((d) => d.square === 'f3');
  ok('f3 capture fires', !!cap);
  ok('captured note F3 sustains, instrument violins', cap && cap.note.midi === 53 && cap.instrument === 'violins');
  ok('density grew: 1 captured pad sustaining', sonic.capturedCount() === 1);
}

// --- 3. fool's mate: CHECK then CHECKMATE → cadence (rule 7) ---
{
  const { find, play } = harness();
  play('f2', 'f3');
  play('e7', 'e5');
  play('g2', 'g4');
  const res = play('d8', 'h4'); // Qh4#
  ok('mating move committed', res.moved === true);
  const check = find(EVENT.CHECK);
  ok('CHECK fired on the mating move', check.length === 1 && check[0].kingColor === 'w');
  ok('dominant chord computed (V7, 4 notes)', check[0] && check[0].dominantChord.length === 4);
  const mate = find(EVENT.CHECKMATE);
  ok('CHECKMATE fired for white king', mate.length === 1 && mate[0].kingColor === 'w');
  ok('resolution chord computed (I triad, 3 notes)', mate[0] && mate[0].resolutionChord.length === 3);
  ok('GAME_OVER fired', find(EVENT.GAME_OVER).some((d) => d.reason === 'checkmate'));
}

// --- 4. king move relocates its sustain (rule 4) ---
{
  const { find, play } = harness('4k3/8/8/8/8/8/8/4K3 w - - 0 1'); // bare kings
  play('e1', 'e2'); // white king steps up
  const offs = find(EVENT.KING_SUSTAIN_OFF).filter((d) => d.color === 'w');
  const ons = find(EVENT.KING_SUSTAIN_ON).filter((d) => d.color === 'w');
  ok('king move silenced old square', offs.length >= 1);
  ok('king move re-sounded new square e2 (E2)', ons.some((d) => d.square === 'e2' && d.note.label === 'E2'));
}

// --- 5. en passant capture fires PIECE_CAPTURED on the victim square (rule 6 EP) ---
{
  const { find, play } = harness('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1'); // white e5 can take d-pawn EP on d6
  const res = play('e5', 'd6');
  ok('en passant move committed', res.moved === true);
  const cap = find(EVENT.PIECE_CAPTURED)[0];
  ok('EP capture is on d5 (the pawn), not d6', cap && cap.square === 'd5' && cap.viaEnPassant === true);
}

// --- 6. lift the king → it goes silent (KING_SUSTAIN_OFF), place back → resumes (rule 4/5) ---
{
  const { controller, find } = harness('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  controller.lift('e1');
  ok('lifting king emits KING_SUSTAIN_OFF', find(EVENT.KING_SUSTAIN_OFF).some((d) => d.color === 'w'));
  controller.place(null); // set it back down on the same square
  ok('placing king back resumes its sustain', find(EVENT.KING_SUSTAIN_ON).filter((d) => d.color === 'w').length === 2);
}

// --- 6b. recapture onto a still-attacked square announces the recapturing piece (regression) ---
{
  // white pawn d4, black knight e5 (attacked by pawn), black rook a5 (re-attacks e5). White to move.
  const { find, play } = harness('4k3/8/8/r3n3/3P4/8/8/4K3 w - - 0 1');
  const res = play('d4', 'e5'); // dxe5 — pawn recaptures onto a square the rook still attacks
  ok('recapture committed', res.moved === true);
  const cap = find(EVENT.PIECE_CAPTURED).find((d) => d.square === 'e5');
  ok('captured knight on e5 announced', cap && cap.piece === 'n');
  const reThreat = find(EVENT.PIECE_THREATENED).filter((d) => d.square === 'e5');
  ok('recapturing pawn on e5 announced as en prise', reThreat.some((d) => d.piece === 'p'));
}

// --- 7. lifting a normal piece is heard (rule 5), illegal placement is rejected ---
{
  const { controller, find } = harness();
  controller.lift('e2');
  ok('lifting a pawn emits PIECE_LIFT', find(EVENT.PIECE_LIFT).some((d) => d.square === 'e2'));
  const res = controller.place('e5'); // illegal (pawn can't jump that far)
  ok('illegal move rejected', res.rejected === true && res.moved === false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
