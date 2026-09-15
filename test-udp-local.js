/* UDP loopback testi: dis nete cikmadan 127.0.0.1 echo'ya VLESS UDP ile gider. */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const dgram = require('dgram');

const APP_ID = process.env.APP_ID || '8a5fb665-632e-4f9b-8337-e475a79d994c';
const WS_PATH = process.env.WS_PATH || '/notes-sync';
const PORT = 18082;
const ECHO_PORT = 53999;
const PAYLOAD = Buffer.from('roblox-udp-test-123');

console.log('Loopback UDP test, APP_ID:', APP_ID);
const echo = dgram.createSocket('udp4');
echo.on('message', (msg, rinfo) => { echo.send(msg, rinfo.port, rinfo.address); });
echo.bind(ECHO_PORT, '127.0.0.1', () => console.log('echo hazir', ECHO_PORT));

const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), APP_ID, WS_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));

function uuidBytes(s) { return Buffer.from(s.replace(/-/g, ''), 'hex'); }
function buildUdpHeader(uuidStr, host, port, udpPayload) {
  const header = Buffer.concat([Buffer.from([0]), uuidBytes(uuidStr), Buffer.from([0]), Buffer.from([2]),
    (() => { const b = Buffer.allocUnsafe(2); b.writeUInt16BE(port, 0); return b; })(),
    Buffer.from([1, 127, 0, 0, 1])]);
  const lenB = Buffer.allocUnsafe(2); lenB.writeUInt16BE(udpPayload.length, 0);
  return Buffer.concat([header, lenB, udpPayload]);
}

async function run() {
  await new Promise((r) => setTimeout(r, 2000));
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${WS_PATH}`);
    const timer = setTimeout(() => { console.error('LOOPBACK TIMEOUT'); ws.close(); reject(new Error('timeout')); }, 10000);
    ws.on('open', () => { ws.send(buildUdpHeader(APP_ID, '127.0.0.1', ECHO_PORT, PAYLOAD)); console.log('gonderildi'); });
    ws.on('message', (m) => {
      const buf = Buffer.from(m);
      let off = (buf[0] === 0) ? 2 : 0;
      const dlen = buf.readUInt16BE(off); off += 2;
      const data = buf.subarray(off, off + dlen);
      console.log('cevap:', data.toString());
      if (data.equals(PAYLOAD)) { clearTimeout(timer); console.log('UDP LOOPBACK BASARILI'); ws.close(); resolve(); }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
run().then(() => { console.log('TEST GECTI'); srv.kill(); echo.close(); process.exit(0); })
  .catch((e) => { console.error('BASARISIZ:', e.message); srv.kill(); echo.close(); process.exit(1); });
