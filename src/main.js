// main.js — bootstrap. Builds the bus, controller, sonic logic and UI, then wires them together.
// Data flows ONE way: pointer → lift → controller → bus → sonicLogic → engine, with the UI
// panels as read-only subscribers.
import { EventBus } from './events.js';
import { createController } from './controller.js';
import { createSonicLogic } from './sonicLogic.js';
import { createBoardView } from './boardView.js';
import { attachLift } from './lift.js';
import { createControls } from './ui/controls.js';
import {
  createVoicesPanel, createDensityMeter, createEventLog, createIoMonitor, createCheckBanner,
} from './ui/panels.js';

const $ = (id) => document.getElementById(id);

const bus = new EventBus();

// IO monitor first — its log fn is the tap sonicLogic feeds (shows the Ableton/Max byte stream).
const monitorLog = createIoMonitor($('io-monitor'));
const sonic = createSonicLogic(bus, { monitor: monitorLog, mode: 'webaudio' });

// read-only panels subscribe to the bus before any events fire
createVoicesPanel($('voices'), bus);
createDensityMeter($('density'), bus);
createEventLog($('event-log'), bus);
createCheckBanner($('check-banner'), bus);

const controller = createController(bus);
const boardView = createBoardView($('board'), $('promo-picker'));
boardView.render(controller); // show the starting position behind the Start overlay

const lift = attachLift(boardView, controller, {
  refresh,
  tempo: (info) => controls.updateTempo(info),
});

const controls = createControls($('controls'), {
  controller, sonic, boardView,
  onReset: (fen) => { lift.clearSelection(); controller.reset(fen); refresh(); },
});

function refresh() {
  boardView.render(controller);
  boardView.markThreatened(controller.threatenedSquares());
  const checkColor = controller.sideInCheck();
  boardView.markCheck(checkColor ? controller.kingSquare(checkColor) : null);
  controls.updateTurn();
  document.body.classList.toggle('game-over', controller.isGameOver());
}

// --- Start overlay: a single user gesture unlocks Web Audio / MIDI, then the game begins ---
const overlay = $('start-overlay');
$('start-btn').addEventListener('click', async () => {
  await sonic.unlock();
  controls.updateStatus();
  overlay.classList.add('hidden');
  controller.reset();   // emits the initial king sustains into a live audio context
  refresh();
});

// if the tab was backgrounded and the context auto-suspended, re-unlock on the next interaction
document.addEventListener('pointerdown', () => { if (!sonic.isReady()) sonic.unlock(); }, true);

refresh();
