// engineAdapter.js — the ONLY module that imports chess.js. A thin semantic wrapper that
// exposes exactly the queries the controller + sonic logic need, and nothing else.
import { Chess } from '../vendor/chess.js';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'];
export const opposite = (color) => (color === 'w' ? 'b' : 'w');

export function createAdapter(fen) {
  const g = fen ? new Chess(fen) : new Chess();

  /** All 64 squares 'a1'..'h8'. */
  function allSquares() {
    const out = [];
    for (const f of FILES) for (const r of RANKS) out.push(f + r);
    return out;
  }

  /** The square the given color's king stands on (or null). */
  function kingSquare(color) {
    for (const row of g.board()) for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square;
    }
    return null;
  }

  // En-passant aware: the captured pawn sits on the destination file + the origin rank.
  function capturedSquareOf(move) {
    return move.flags.includes('e') ? move.to[0] + move.from[1] : move.to;
  }

  /** Every square holding a NON-king piece that is attacked by an enemy piece ("en prise").
   *  Defenders are intentionally ignored (rule 6 / decision #2). Kings are excluded — a king
   *  under attack is "check" (rule 7), handled separately. Symmetric: both colors evaluated. */
  function threatenedSquares() {
    const out = new Set();
    for (const row of g.board()) for (const cell of row) {
      if (!cell || cell.type === 'k') continue;
      if (g.isAttacked(cell.square, opposite(cell.color))) out.add(cell.square);
    }
    return out;
  }

  function drawReason() {
    if (g.isInsufficientMaterial()) return 'insufficientMaterial';
    if (g.isThreefoldRepetition()) return 'threefold';
    if (g.isDraw()) return 'fiftyMove'; // remaining draw cause in chess.js
    return 'draw';
  }

  return {
    raw: g,
    turn: () => g.turn(),
    fen: () => g.fen(),
    get: (sq) => g.get(sq) || null,
    board: () => g.board(),
    allSquares,
    /** Legal destination squares for the piece on `sq` (empty unless it's that side's turn). */
    legalMoves: (sq) => g.moves({ square: sq, verbose: true }).map((m) => m.to),
    /** Attempt a move. Returns the verbose move object, or null if illegal. */
    move(from, to, promotion) {
      try {
        return g.move({ from, to, promotion: promotion || undefined });
      } catch {
        return null;
      }
    },
    undo: () => g.undo(),
    isAttacked: (sq, byColor) => g.isAttacked(sq, byColor),
    inCheck: () => g.inCheck(),
    isCheckmate: () => g.isCheckmate(),
    isStalemate: () => g.isStalemate(),
    isDraw: () => g.isDraw(),
    isGameOver: () => g.isGameOver(),
    /** The color of the king currently in check, or null. */
    sideInCheck: () => (g.inCheck() ? g.turn() : null),
    kingSquare,
    threatenedSquares,
    capturedSquareOf,
    drawReason,
  };
}
