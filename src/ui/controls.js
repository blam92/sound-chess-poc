// controls.js — the controls rail: tonality, master volume/mute, output mode (the Ableton/Max
// swap), reset, note labels, start preset, and the live "tempo-of-thought" readout.
import { TONALITIES } from '../music-math.js';

const PRESETS = {
  standard: { label: 'estándar (reyes e1 · e8)', fen: undefined },
  'doc-literal': { label: 'literal del documento (reyes e1 · d8)', fen: 'rnbkqbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1' },
};

export function createControls(el, deps) {
  const { controller, sonic, boardView } = deps;

  el.innerHTML = `
    <div class="ctl-row"><label>Tonalidad</label>
      <select id="ctl-tonality">${TONALITIES.map((t, i) => `<option value="${i}">${t.name}</option>`).join('')}</select></div>
    <div class="ctl-row"><label>Salida</label>
      <select id="ctl-output">
        <option value="webaudio">Web Audio (PoC)</option>
        <option value="midi">MIDI → Ableton</option>
        <option value="osc">OSC → Max</option>
        <option value="null">Silencioso</option>
      </select><span id="ctl-status" class="status-dot" title="estado"></span></div>
    <div class="ctl-row"><label>Volumen</label>
      <input id="ctl-volume" type="range" min="0" max="1" step="0.01" value="0.8"></div>
    <div class="ctl-row inline">
      <label><input id="ctl-mute" type="checkbox"> Silenciar</label>
      <label><input id="ctl-labels" type="checkbox" checked> Notas</label></div>
    <div class="ctl-row"><label>Inicio</label>
      <select id="ctl-preset">${Object.entries(PRESETS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
    <div class="ctl-row"><button id="ctl-reset">↺ Nueva partida</button></div>
    <div class="ctl-row tempo">
      <span>Turno: <strong id="ctl-turn">blancas</strong></span>
      <span id="ctl-think" class="muted"></span></div>`;

  const $ = (id) => el.querySelector(id);
  let preset = 'standard';
  const dwells = [];

  $('#ctl-tonality').addEventListener('change', (e) => {
    const t = TONALITIES[Number(e.target.value)];
    controller.setTonality(t.name, t.transpose);
    boardView.render(controller); // note badges follow the new key
  });

  $('#ctl-output').addEventListener('change', async (e) => {
    setStatus('…');
    const name = await sonic.setMode(e.target.value);
    updateStatus();
  });

  $('#ctl-volume').addEventListener('input', (e) => sonic.setMaster(Number(e.target.value)));
  $('#ctl-mute').addEventListener('change', (e) => sonic.setMute(e.target.checked));
  $('#ctl-labels').addEventListener('change', (e) => boardView.setLabels(e.target.checked));
  $('#ctl-preset').addEventListener('change', (e) => { preset = e.target.value; });
  $('#ctl-reset').addEventListener('click', () => deps.onReset(PRESETS[preset].fen));

  function setStatus(txt) { $('#ctl-status').dataset.state = txt; }
  function updateStatus() {
    const s = sonic.engineStatus();
    const dot = $('#ctl-status');
    dot.dataset.state = s;
    dot.title = `${sonic.engineName()} · ${s}`;
  }
  function updateTurn() {
    $('#ctl-turn').textContent = controller.isGameOver() ? '—' : (controller.turn() === 'w' ? 'blancas' : 'negras');
  }
  function updateTempo(info) {
    if (info.state === 'lifted') { $('#ctl-think').textContent = '… en el aire'; return; }
    if (info.dwellMs != null) {
      dwells.push(info.dwellMs);
      const avg = dwells.reduce((a, b) => a + b, 0) / dwells.length;
      $('#ctl-think').textContent = `última: ${(info.dwellMs / 1000).toFixed(1)}s · media: ${(avg / 1000).toFixed(1)}s`;
      return;
    }
    $('#ctl-think').textContent = ''; // idle with no dwell (e.g. cleared on reset)
  }

  updateStatus();
  return { updateStatus, updateTurn, updateTempo };
}
