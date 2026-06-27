// controller.js — the game brain. Owns chess state and translates board interactions into the
// semantic event stream (the chess↔sound seam). It is the ONLY place chess facts become events;
// sonicLogic and the UI never touch the rules engine.
import { createAdapter, opposite } from './engineAdapter.js';
import { INSTRUMENT } from './mapping.js';
import {
  squareToNote, leadingToneOf, dominantChord, resolutionChord, chordLabels, midiToLabel,
} from './music-math.js';
import { EVENT } from './events.js';

export function createController(bus) {
  let adapter = createAdapter();
  let transpose = 0;
  let tonalityName = 'C (sin transposición)';
  let prevThreat = new Set();
  let inCheckColor = null;
  let gameOver = false;
  let lifted = null; // { square, piece, color, isKing }

  const emit = (type, detail) => bus.emit(type, detail);
  const noteFor = (sq) => squareToNote(sq, transpose);

  /** Fresh game (or load a FEN, e.g. the 'doc-literal' preset with the black king on d8). */
  function reset(fen) {
    adapter = createAdapter(fen);
    prevThreat = adapter.threatenedSquares();
    inCheckColor = adapter.sideInCheck();
    gameOver = false;
    lifted = null;

    emit(EVENT.GAME_RESET, { fen: adapter.fen() });
    emit(EVENT.SET_TONALITY, { name: tonalityName, transpose });
    // Inverse mechanism (rule 4): the kings are the only things sounding at the start.
    for (const color of ['w', 'b']) {
      const sq = adapter.kingSquare(color);
      if (sq) emit(EVENT.KING_SUSTAIN_ON, { color, square: sq, note: noteFor(sq) });
    }
    // Any pieces already en prise in a custom FEN announce themselves.
    announceThreats(prevThreat, new Set(), null);
  }

  function setTonality(name, semitones) {
    tonalityName = name;
    transpose = semitones;
    emit(EVENT.SET_TONALITY, { name, transpose });
  }

  // --- interaction entry points -------------------------------------------

  /** Pick a piece up. Returns the legal destinations (for highlighting) or null if not liftable. */
  function lift(square) {
    if (gameOver) return null;
    const piece = adapter.get(square);
    if (!piece || piece.color !== adapter.turn()) return null; // only your own piece, on your turn
    const isKing = piece.type === 'k';
    lifted = { square, piece: piece.type, color: piece.color, isKing };

    if (isKing) {
      emit(EVENT.KING_SUSTAIN_OFF, { color: piece.color, square }); // king goes silent in the air
    } else {
      emit(EVENT.PIECE_LIFT, {
        square, color: piece.color, piece: piece.type,
        instrument: INSTRUMENT[piece.type], note: noteFor(square),
      });
    }
    return adapter.legalMoves(square);
  }

  /** True if placing the lifted pawn on `to` would be a promotion (UI must choose a piece). */
  function isPromotion(to) {
    if (!lifted || lifted.piece !== 'p') return false;
    const rank = to[1];
    return (lifted.color === 'w' && rank === '8') || (lifted.color === 'b' && rank === '1');
  }

  /** Set a lifted piece down on `to` (null/origin = place-back). `promotion` ∈ q,r,b,n.
   *  Returns { moved, rejected?, needPromotion?, from?, to? }. */
  function place(to, promotion) {
    if (!lifted) return { moved: false };
    const from = lifted.square;
    const wasKing = lifted.isKing;
    const color = lifted.color;

    // place-back (same square or nowhere)
    if (!to || to === from) {
      placeBack();
      return { moved: false };
    }
    // promotion needs a choice first — don't mutate state yet
    if (isPromotion(to) && !promotion) {
      return { needPromotion: true, from, to };
    }

    const move = adapter.move(from, to, promotion);
    if (!move) {
      emit(EVENT.MOVE_REJECT, { from, to, reason: 'illegal' });
      placeBack();
      return { moved: false, rejected: true };
    }

    // The lifted piece lands: a normal held voice fades; the king's sustain is handled in the pipeline.
    if (!wasKing) {
      emit(EVENT.PIECE_PLACE, {
        from, to, color, piece: lifted.piece, instrument: INSTRUMENT[lifted.piece],
        note: noteFor(to), sameSquare: false, moved: true,
      });
    }
    emit(EVENT.MOVE_COMMIT, {
      san: move.san, from, to, color, captured: move.captured || null, flags: move.flags,
    });
    lifted = null;
    runPipeline(move);
    return { moved: true, move };
  }

  function placeBack() {
    if (!lifted) return;
    if (lifted.isKing) {
      emit(EVENT.KING_SUSTAIN_ON, { color: lifted.color, square: lifted.square, note: noteFor(lifted.square) });
    } else {
      emit(EVENT.PIECE_PLACE, {
        from: lifted.square, to: null, color: lifted.color, piece: lifted.piece,
        instrument: INSTRUMENT[lifted.piece], note: noteFor(lifted.square), sameSquare: true, moved: false,
      });
    }
    lifted = null;
  }

  // --- the per-move pipeline (rules 3–7) ----------------------------------

  function runPipeline(move) {
    const color = move.color;

    // (a) king relocation — silence the old square's sustain, sound the new one (rule 4)
    if (move.piece === 'k') {
      emit(EVENT.KING_SUSTAIN_OFF, { color, square: move.from }); // idempotent (already off if lifted)
      emit(EVENT.KING_SUSTAIN_ON, { color, square: move.to, note: noteFor(move.to) });
    }

    // (b) capture concretized — the captured piece's square-note resolves & sustains to game end
    let capSq = null;
    if (move.captured) {
      capSq = adapter.capturedSquareOf(move);
      emit(EVENT.PIECE_CAPTURED, {
        square: capSq, color: opposite(color), piece: move.captured,
        instrument: INSTRUMENT[move.captured], note: noteFor(capSq),
        viaEnPassant: move.flags.includes('e'),
      });
    }

    // (c)+(d) recompute en-prise set and diff it against the previous one.
    // Drop the captured square from the "previous" set first: the occupant changed (a recapture
    // onto a still-attacked square), so the new piece there must be announced as freshly en prise.
    const curr = adapter.threatenedSquares();
    const prevForDiff = capSq ? new Set([...prevThreat].filter((s) => s !== capSq)) : prevThreat;
    announceThreats(curr, prevForDiff, capSq);
    prevThreat = curr;

    // (e) check — edge-triggered so the dominant chord fires once per check (rule 7)
    const now = adapter.sideInCheck();
    if (now && now !== inCheckColor) {
      const ks = adapter.kingSquare(now);
      const note = noteFor(ks);
      const chord = dominantChord(note.midi);
      emit(EVENT.CHECK, { kingColor: now, kingSquare: ks, note, dominantChord: chord, dominantLabels: chordLabels(chord) });
    } else if (!now && inCheckColor) {
      emit(EVENT.CHECK_END, { kingColor: inCheckColor });
    }
    inCheckColor = now;

    // (f) terminal states
    if (adapter.isCheckmate()) {
      const mated = adapter.turn(); // the side to move is the one with no escape
      const ks = adapter.kingSquare(mated);
      const note = noteFor(ks);
      const chord = resolutionChord(note.midi);
      emit(EVENT.CHECKMATE, { kingColor: mated, kingSquare: ks, note, resolutionChord: chord, resolutionLabels: chordLabels(chord) });
      endGame('checkmate');
    } else if (adapter.isStalemate()) {
      emit(EVENT.STALEMATE, {});
      endGame('stalemate');
    } else if (adapter.isDraw()) {
      emit(EVENT.DRAW, { reason: adapter.drawReason() });
      endGame('draw');
    }
  }

  /** Emit THREATENED for squares new to `curr`, SAFE for squares that left `prev` without capture. */
  function announceThreats(curr, prev, capSq) {
    for (const sq of curr) {
      if (prev.has(sq)) continue;
      const p = adapter.get(sq);
      if (!p) continue;
      const note = noteFor(sq);
      const leadMidi = leadingToneOf(note.midi);
      emit(EVENT.PIECE_THREATENED, {
        square: sq, color: p.color, piece: p.type, instrument: INSTRUMENT[p.type],
        note, leadingTone: { square: sq, midi: leadMidi, label: midiToLabel(leadMidi) },
      });
    }
    for (const sq of prev) {
      if (!curr.has(sq) && sq !== capSq) emit(EVENT.PIECE_SAFE, { square: sq });
    }
  }

  function endGame(reason) {
    gameOver = true;
    emit(EVENT.GAME_OVER, { reason });
  }

  // --- read-only accessors for the UI -------------------------------------
  return {
    reset, setTonality, lift, place, placeBack, isPromotion,
    legalMoves: (sq) => adapter.legalMoves(sq),
    get: (sq) => adapter.get(sq),
    board: () => adapter.board(),
    turn: () => adapter.turn(),
    kingSquare: (c) => adapter.kingSquare(c),
    threatenedSquares: () => new Set(prevThreat),
    sideInCheck: () => inCheckColor,
    isGameOver: () => gameOver,
    transpose: () => transpose,
    noteFor,
    lifted: () => lifted,
  };
}
