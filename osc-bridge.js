// osc-bridge.js — browser WebSocket → OSC/UDP bridge for the Max/MSP integration path.
// The browser can't emit UDP, so the OscEngine sends JSON {address,args} over a WebSocket; this
// bridge re-types each arg and forwards it as OSC/UDP to Max's [udpreceive 7400].
//
//   1. npm install            (installs the optional `ws` + `osc` packages)
//   2. node osc-bridge.js
//   3. In the app, set "Salida" → "OSC → Max".
//   4. In Max:  [udpreceive 7400] → [route /ajedrez/note/on /ajedrez/chord ...] → makenote/noteout
//
// Defaults: WebSocket ws://localhost:8081, OSC out 127.0.0.1:7400.

let WebSocketServer, osc;
try {
  ({ WebSocketServer } = await import('ws'));
  osc = (await import('osc')).default;
} catch {
  console.error('Missing deps. Run `npm install` first (installs ws + osc).');
  process.exit(1);
}

const WS_PORT = Number(process.env.WS_PORT) || 8081;
const OSC_HOST = process.env.OSC_HOST || '127.0.0.1';
const OSC_PORT = Number(process.env.OSC_PORT) || 7400;

const udp = new osc.UDPPort({ localAddress: '0.0.0.0', localPort: 7401, remoteAddress: OSC_HOST, remotePort: OSC_PORT });
udp.open();

const typed = (a) => (typeof a === 'number'
  ? (Number.isInteger(a) ? { type: 'i', value: a } : { type: 'f', value: a })
  : { type: 's', value: String(a) });

const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', (ws) => {
  console.log('browser connected');
  ws.on('message', (buf) => {
    try {
      const m = JSON.parse(buf.toString());
      udp.send({ address: m.address, args: (m.args || []).map(typed) });
    } catch (e) { console.error('bad message', e.message); }
  });
});

console.log(`OSC bridge: ws://localhost:${WS_PORT}  →  OSC ${OSC_HOST}:${OSC_PORT} (Max [udpreceive ${OSC_PORT}])`);
