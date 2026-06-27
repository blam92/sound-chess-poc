// lift.js — TOUCH = LIFT interaction, via Pointer Events (mouse + touch + pen, one code path).
// Picking a piece up = lifting it (rule 5): the held voice starts immediately and swells with
// dwell time; placing it down resolves. Supports both drag-drop and click-click (tap to select,
// tap a target to move) so it works with a mouse, a finger, or the keyboard-free.
const SLOP = 6; // px before a press counts as a drag rather than a tap

export function attachLift(boardView, controller, hooks = {}) {
  const board = boardView.el;
  let sel = null;          // currently lifted/selected square
  let pressOrigin = null;  // square where the active pointer went down
  let dragging = false;
  let freshSelect = false; // did this gesture just create the selection?
  let pointerId = null;
  let startX = 0, startY = 0;
  let dragEl = null;
  let liftedAt = 0;
  let busy = false;        // true while an async commit (promotion picker) is in flight

  const isOwn = (sq) => { const p = controller.get(sq); return p && p.color === controller.turn(); };
  const refresh = () => hooks.refresh && hooks.refresh();

  function selectPiece(sq) {
    const legal = controller.lift(sq);
    if (!legal) return false;          // not liftable (not your piece / game over)
    sel = sq;
    liftedAt = performance.now();
    boardView.clearMarks();
    boardView.markSelected(sq);
    boardView.markLegal(legal, controller);
    hooks.tempo && hooks.tempo({ state: 'lifted', square: sq });
    return true;
  }

  function deselect() {
    if (!sel) return;
    controller.place(null);            // place-back: fade held / resume king
    resetDragVisual();
    sel = null;
    boardView.clearMarks();
    hooks.tempo && hooks.tempo({ state: 'idle', dwellMs: performance.now() - liftedAt });
    refresh();
  }

  async function commitTo(target) {
    const dwell = performance.now() - liftedAt;
    busy = true; // block re-entrant pointer events while the promotion picker is open
    try {
      let promo;
      if (controller.isPromotion(target)) {
        const color = controller.get(sel)?.color || controller.turn();
        promo = await boardView.askPromotion(color);
        if (!promo) { busy = false; deselect(); return; } // cancelled promotion → place back
      }
      const res = controller.place(target, promo);
      resetDragVisual();
      sel = null;
      boardView.clearMarks();
      if (res.rejected) boardView.flashReject(target);
      hooks.tempo && hooks.tempo({ state: 'idle', dwellMs: dwell, gesture: dragging ? 'held' : 'click', moved: !!res.moved });
      refresh();
    } finally {
      busy = false;
    }
  }

  function startDragVisual() {
    dragEl = boardView.pieceEl(sel);
    if (dragEl) dragEl.classList.add('dragging');
  }
  function moveDragVisual(dx, dy) { if (dragEl) dragEl.style.transform = `translate(${dx}px, ${dy}px)`; }
  function resetDragVisual() {
    if (dragEl) { dragEl.style.transform = ''; dragEl.classList.remove('dragging'); }
    dragEl = null;
  }

  board.addEventListener('pointerdown', (e) => {
    if (busy || controller.isGameOver()) return;
    const sq = boardView.squareFromPoint(e.clientX, e.clientY);
    if (!sq) return;
    e.preventDefault();
    board.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    dragging = false;
    pressOrigin = sq;

    if (sel && sq !== sel && isOwn(sq)) {
      // pressing a different own piece while one is selected → switch (so it can be dragged)
      deselect();
      freshSelect = selectPiece(sq);
    } else if (!sel && isOwn(sq)) {
      freshSelect = selectPiece(sq);
    } else {
      freshSelect = false;             // pressing a target square, empty, or enemy piece
    }
    if (freshSelect && pressOrigin === sel) startDragVisual();
  });

  board.addEventListener('pointermove', (e) => {
    if (busy || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX, dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > SLOP && sel === pressOrigin) {
      dragging = true;
      if (!dragEl) startDragVisual();
    }
    if (dragging) moveDragVisual(dx, dy);
  });

  board.addEventListener('pointerup', (e) => {
    if (busy || e.pointerId !== pointerId) return;
    try { board.releasePointerCapture(e.pointerId); } catch {}
    pointerId = null;
    const target = boardView.squareFromPoint(e.clientX, e.clientY);
    const wasDragging = dragging;
    dragging = false;

    if (wasDragging) {
      resetDragVisual();
      if (target && target === sel) { boardView.markSelected(sel); /* dragged home: stay lifted */ }
      else if (target && isOwn(target) && target !== sel) { deselect(); selectPiece(target); }
      else if (target) { commitTo(target); }            // legal → move; illegal → reject+placeback
      else { deselect(); }                              // released off the board
    } else {
      // a tap (no significant drag)
      if (freshSelect) { /* first tap selected the piece: stay lifted */ }
      else if (sel) {
        const t = pressOrigin;
        if (t === sel) deselect();
        else if (isOwn(t)) { deselect(); selectPiece(t); }
        else commitTo(t);
      }
    }
    freshSelect = false;
    pressOrigin = null;
  });

  board.addEventListener('pointercancel', () => {
    if (sel) deselect();
    pointerId = null; dragging = false; freshSelect = false; resetDragVisual();
  });

  // Esc cancels a lift (place-back)
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sel && !busy) deselect(); });

  /** Drop any in-progress selection WITHOUT emitting a place-back. For use on reset, where the
   *  controller has already discarded its lifted piece. */
  function clearSelection() {
    sel = null; pressOrigin = null; dragging = false; freshSelect = false; busy = false;
    resetDragVisual();
    boardView.clearMarks();
    hooks.tempo && hooks.tempo({ state: 'idle' });
  }

  return { deselect, clearSelection, selected: () => sel };
}
