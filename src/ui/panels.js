// panels.js — read-only subscribers that make the sonic logic visible (the PoC "earns its keep"
// here, since the real timbres are out of scope). Voices, inverse-density meter, event log,
// MIDI/OSC monitor, and the check banner.
import { EVENT } from '../events.js';
import { INSTRUMENT_ES, PIECE_NAME } from '../mapping.js';
import { describe } from '../audio/protocol.js';

const SOURCE_LABEL = {
  king: 'rey sostenido', held: 'en el aire', threat: 'sensible · crescendo',
  capture: 'capturada · sostenida', dominant: 'acorde dominante',
};

export function createVoicesPanel(el, bus) {
  function render(voices) {
    if (!voices.length) { el.innerHTML = '<p class="empty">— silencio —</p>'; return; }
    const rows = voices
      .sort((a, b) => a.source.localeCompare(b.source))
      .map((v) => `<tr class="src-${v.source}">
        <td>${INSTRUMENT_ES[v.instrument] || v.instrument}</td>
        <td class="mono">${v.label}</td>
        <td class="mono">${v.dynamic}</td>
        <td>${SOURCE_LABEL[v.source]}</td>
        <td class="mono">${v.square || ''}</td></tr>`).join('');
    el.innerHTML = `<table class="voices">
      <thead><tr><th>instrumento</th><th>nota</th><th>din</th><th>fuente</th><th>casilla</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }
  bus.on(EVENT.VOICES_CHANGED, ({ voices }) => render(voices));
  render([]);
}

export function createDensityMeter(el, bus) {
  el.innerHTML = `
    <div class="density-wrap"><div class="density-fill"></div></div>
    <p class="density-caption">más capturas → más densidad sonora</p>
    <p class="density-stats"><span class="d-captured">0</span> capturadas · <span class="d-voices">0</span> voces sonando</p>`;
  const fill = el.querySelector('.density-fill');
  bus.on(EVENT.VOICES_CHANGED, ({ density, capturedCount, voiceCount }) => {
    fill.style.height = `${Math.min(100, density * 100).toFixed(1)}%`;
    el.querySelector('.d-captured').textContent = capturedCount;
    el.querySelector('.d-voices').textContent = voiceCount;
  });
}

export function createEventLog(el, bus) {
  const time = () => new Date().toLocaleTimeString('es', { hour12: false }) + '.' + String(Math.floor(performance.now() % 1000)).padStart(3, '0');
  function line(text, cls) {
    const row = document.createElement('div');
    row.className = `log-row ${cls || ''}`;
    row.textContent = `${time()}  ${text}`;
    el.appendChild(row);
    while (el.childElementCount > 200) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
  }
  const F = {
    [EVENT.GAME_RESET]: () => line('— nueva partida —', 'src-king'),
    [EVENT.SET_TONALITY]: (d) => line(`tonalidad: ${d.name} (transponer ${d.transpose >= 0 ? '+' : ''}${d.transpose})`),
    [EVENT.KING_SUSTAIN_ON]: (d) => line(`REY ${d.color === 'w' ? 'blanco' : 'negro'} suena ${d.note.label} (${d.square})`, 'src-king'),
    [EVENT.KING_SUSTAIN_OFF]: (d) => line(`rey ${d.color === 'w' ? 'blanco' : 'negro'} en el aire → silencio`, 'src-king'),
    [EVENT.PIECE_LIFT]: (d) => line(`LEVANTA ${PIECE_NAME[d.piece]} ${d.square} (${INSTRUMENT_ES[d.instrument]}, ${d.note.label}) → tensión`, 'src-held'),
    [EVENT.PIECE_PLACE]: (d) => line(d.moved ? `apoya en ${d.to}` : `apoya de nuevo en ${d.from} → reposo`, 'src-held'),
    [EVENT.MOVE_COMMIT]: (d) => line(`jugada ${d.san}${d.captured ? ' (captura)' : ''}`),
    [EVENT.MOVE_REJECT]: (d) => line(`jugada ilegal ${d.from}→${d.to}`, 'reject-log'),
    [EVENT.PIECE_THREATENED]: (d) => line(`AMENAZA ${PIECE_NAME[d.piece]} ${d.square} → sensible ${d.leadingTone.label}↗ (resuelve a ${d.note.label})`, 'src-threat'),
    [EVENT.PIECE_SAFE]: (d) => line(`${d.square} a salvo → cesa crescendo`, 'src-threat'),
    [EVENT.PIECE_CAPTURED]: (d) => line(`CAPTURA ${PIECE_NAME[d.piece]} ${d.square} → ${d.note.label} sostenida${d.viaEnPassant ? ' (al paso)' : ''}`, 'src-capture'),
    [EVENT.CHECK]: (d) => line(`JAQUE al rey ${d.kingColor === 'w' ? 'blanco' : 'negro'} (${d.kingSquare}) → acorde dominante [${d.dominantLabels.join(' ')}] FORTE`, 'src-dominant'),
    [EVENT.CHECK_END]: () => line('jaque resuelto → cesa el dominante', 'src-dominant'),
    [EVENT.CHECKMATE]: (d) => line(`JAQUE MATE → reposo en [${d.resolutionLabels.join(' ')}] · fin de la obra`, 'src-dominant'),
    [EVENT.STALEMATE]: () => line('rey ahogado → tablas · fin', 'src-king'),
    [EVENT.DRAW]: (d) => line(`tablas (${d.reason}) · fin`, 'src-king'),
  };
  for (const [type, fn] of Object.entries(F)) bus.on(type, fn);
}

export function createIoMonitor(el) {
  // returned function is handed to sonicLogic as its `monitor` tap
  return function log(action) {
    const { midi, osc } = describe(action);
    const wrap = document.createElement('div');
    wrap.className = 'io-row';
    wrap.innerHTML = `<span class="io-midi">MIDI</span> <span class="mono">${midi}</span>` +
      (osc ? `<br><span class="io-osc">OSC</span> <span class="mono">${osc}</span>` : '');
    el.prepend(wrap);
    while (el.childElementCount > 120) el.lastChild.remove();
  };
}

export function createCheckBanner(el, bus) {
  const show = (html, cls) => { el.hidden = false; el.className = `banner ${cls}`; el.innerHTML = html; };
  const hide = () => { el.hidden = true; el.innerHTML = ''; };
  bus.on(EVENT.CHECK, (d) => show(`<strong>JAQUE</strong> · acorde dominante <span class="mono">${d.dominantLabels.join(' ')}</span> <em>forte</em>`, 'check'));
  bus.on(EVENT.CHECK_END, hide);
  bus.on(EVENT.CHECKMATE, (d) => show(`<strong>JAQUE MATE</strong> · reposo <span class="mono">${d.resolutionLabels.join(' ')}</span> — fin de la obra`, 'mate'));
  bus.on(EVENT.STALEMATE, () => show('<strong>REY AHOGADO</strong> · tablas — fin de la obra', 'mate'));
  bus.on(EVENT.DRAW, (d) => show(`<strong>TABLAS</strong> (${d.reason}) — fin de la obra`, 'mate'));
  bus.on(EVENT.GAME_RESET, hide);
}
