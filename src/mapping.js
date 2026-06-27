// mapping.js — domain constants shared across the app.
// Piece → instrument family (rule 2 of "Ajedrez Sonoro"):
//   Pawn→violins  Bishop→violas  Knight→cellos  Rook→double basses  King&Queen→flutes
// chess.js piece letters: p,n,b,r,q,k.

export const INSTRUMENT = {
  p: 'violins',
  b: 'violas',
  n: 'cellos',
  r: 'doublebasses',
  q: 'flutes',
  k: 'flutes',
};

export const INSTRUMENT_ES = {
  violins: 'violines',
  violas: 'violas',
  cellos: 'chelos',
  doublebasses: 'contrabajos',
  flutes: 'flautas',
};

export const PIECE_NAME = {
  p: 'peón', n: 'caballo', b: 'alfil', r: 'torre', q: 'dama', k: 'rey',
};

// Unicode chess glyphs (no image assets). Solid forms for both colors — CSS colors them
// (white fill + dark outline vs dark fill + light outline) for high contrast on the wood board.
const SOLID = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
export const GLYPH = { w: SOLID, b: SOLID };

export const instrumentOf = (pieceType) => INSTRUMENT[pieceType];
