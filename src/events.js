// events.js — a tiny dependency-free event bus over the platform EventTarget,
// plus the canonical semantic-event vocabulary (the chess ↔ sound seam).
//
// The controller (the only module that knows chess) emits these; sonicLogic is the
// sole consumer that turns them into sound; UI panels are read-only subscribers.
// Every payload is self-contained — notes carry {square,pitchClass,octave,midi,freq,label},
// chords carry explicit MIDI arrays, instruments are pre-resolved — so consumers stay dumb.

export const EVENT = {
  GAME_RESET:       'game:reset',        // { fen }
  SET_TONALITY:     'tonality:set',      // { name, transpose }

  KING_SUSTAIN_ON:  'king:sustainOn',    // { color, square, note }
  KING_SUSTAIN_OFF: 'king:sustainOff',   // { color, square }

  PIECE_LIFT:       'piece:lift',        // { square, color, piece, instrument, note }
  PIECE_PLACE:      'piece:place',       // { from, to, color, piece, instrument, note, sameSquare, moved }
  MOVE_REJECT:      'move:reject',       // { from, to, reason }
  MOVE_COMMIT:      'move:commit',       // { san, from, to, color, captured, flags }

  PIECE_THREATENED: 'piece:threatened',  // { square, color, piece, instrument, note, leadingTone }
  PIECE_SAFE:       'piece:safe',        // { square }
  PIECE_CAPTURED:   'piece:captured',    // { square, color, piece, instrument, note, viaEnPassant }

  CHECK:            'king:check',         // { kingColor, kingSquare, note, dominantChord, dominantLabels }
  CHECK_END:        'king:checkEnd',      // { kingColor }
  CHECKMATE:        'king:checkmate',     // { kingColor, kingSquare, note, resolutionChord, resolutionLabels }
  STALEMATE:        'game:stalemate',     // { }
  DRAW:             'game:draw',          // { reason }
  GAME_OVER:        'game:over',          // { reason }

  // UI-only signals (sonicLogic → panels)
  VOICES_CHANGED:   'ui:voices',          // { voices, density }
};

export class EventBus extends EventTarget {
  emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  on(type, handler) {
    const wrapped = (e) => handler(e.detail, type);
    this.addEventListener(type, wrapped);
    return () => this.removeEventListener(type, wrapped);
  }
  /** Subscribe to many event types with one handler (handler receives (detail, type)). */
  onAny(types, handler) {
    const offs = types.map((t) => this.on(t, handler));
    return () => offs.forEach((off) => off());
  }
}
