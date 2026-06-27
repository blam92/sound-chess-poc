// boardView.js — renders the 8×8 board and all its visual state. Pure DOM; it reads the
// controller for piece positions and note labels but never mutates game state.
import { FILES } from './engineAdapter.js';
import { GLYPH } from './mapping.js';

const RANKS_TOP_DOWN = [8, 7, 6, 5, 4, 3, 2, 1];

export function createBoardView(boardEl, promoEl) {
  const squares = new Map(); // 'e4' → cell element

  // build grid once
  boardEl.innerHTML = '';
  for (const rank of RANKS_TOP_DOWN) {
    for (let f = 0; f < 8; f++) {
      const square = FILES[f] + rank;
      const light = (f + rank) % 2 === 0;
      const cell = document.createElement('div');
      cell.className = `sq ${light ? 'light' : 'dark'}`;
      cell.dataset.square = square;
      cell.setAttribute('role', 'gridcell');
      const badge = document.createElement('span');
      badge.className = 'note-badge';
      cell.appendChild(badge);
      const dot = document.createElement('span');
      dot.className = 'legal-dot';
      cell.appendChild(dot);
      boardEl.appendChild(cell);
      squares.set(square, cell);
    }
  }
  // file/rank coordinate labels (a–h, 1–8) along the edges
  for (let f = 0; f < 8; f++) squares.get(FILES[f] + '1').dataset.file = FILES[f];
  for (const rank of RANKS_TOP_DOWN) squares.get('a' + rank).dataset.rank = rank;

  let labelsOn = true;

  function render(controller) {
    for (const [square, cell] of squares) {
      const piece = controller.get(square);
      let pe = cell.querySelector('.piece');
      if (piece) {
        if (!pe) { pe = document.createElement('span'); pe.className = 'piece'; cell.appendChild(pe); }
        pe.textContent = GLYPH[piece.color][piece.type];
        pe.classList.toggle('white', piece.color === 'w');
        pe.classList.toggle('black', piece.color === 'b');
        pe.style.transform = '';
        pe.classList.remove('dragging');
      } else if (pe) {
        pe.remove();
      }
      cell.querySelector('.note-badge').textContent = controller.noteFor(square).label;
    }
    boardEl.classList.toggle('show-labels', labelsOn);
  }

  function setLabels(on) { labelsOn = on; boardEl.classList.toggle('show-labels', on); }

  function clearMarks() {
    for (const cell of squares.values()) {
      cell.classList.remove('legal', 'selected', 'capture-target');
    }
  }
  function markLegal(targetSquares, controller) {
    for (const sq of targetSquares) {
      const cell = squares.get(sq);
      if (!cell) continue;
      cell.classList.add('legal');
      if (controller.get(sq)) cell.classList.add('capture-target');
    }
  }
  function markSelected(square) {
    const cell = squares.get(square);
    if (cell) cell.classList.add('selected');
  }
  function markThreatened(set) {
    for (const [sq, cell] of squares) cell.classList.toggle('threatened', set.has(sq));
  }
  function markCheck(square) {
    for (const [sq, cell] of squares) cell.classList.toggle('in-check', sq === square);
  }
  function flashReject(square) {
    const cell = squares.get(square);
    if (!cell) return;
    cell.classList.remove('reject');
    void cell.offsetWidth; // restart animation
    cell.classList.add('reject');
  }

  function pieceEl(square) { return squares.get(square)?.querySelector('.piece'); }
  function cellRect() { return boardEl.getBoundingClientRect(); }

  /** Which square is under client point (x,y), or null if outside the board. */
  function squareFromPoint(x, y) {
    const r = cellRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const col = Math.min(7, Math.max(0, Math.floor(((x - r.left) / r.width) * 8)));
    const row = Math.min(7, Math.max(0, Math.floor(((y - r.top) / r.height) * 8)));
    return FILES[col] + (8 - row);
  }

  // promotion picker → resolves to 'q'|'r'|'b'|'n' or null
  function askPromotion(color) {
    return new Promise((resolve) => {
      promoEl.innerHTML = '';
      promoEl.hidden = false;
      const done = (v) => { promoEl.hidden = true; promoEl.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(v); };
      for (const t of ['q', 'r', 'b', 'n']) {
        const btn = document.createElement('button');
        btn.className = `promo-btn ${color === 'w' ? 'white' : 'black'}`;
        btn.textContent = GLYPH[color][t];
        btn.title = t;
        btn.onclick = () => done(t);
        promoEl.appendChild(btn);
      }
      const onKey = (e) => { if (e.key === 'Escape') done(null); };
      document.addEventListener('keydown', onKey);
    });
  }

  return {
    el: boardEl, render, setLabels, clearMarks, markLegal, markSelected,
    markThreatened, markCheck, flashReject, pieceEl, squareFromPoint, askPromotion,
  };
}
