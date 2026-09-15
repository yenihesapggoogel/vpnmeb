/* UDP testi: VLESS command=2 ile 8.8.8.8:53'e DNS sorgusu gonderir.
 * Kullanim: node test-udp.js (APP_ID env yoksa server default ID kullanir)
 */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const crypto = require('crypto');

const APP_ID = process.env.APP_ID || '8a5fb665-632e-4f9b-8337-e475a79d994c';
const WS_PATH = process.env.WS_PATH || '/notes-sync';
const PORT = 18081;

console.log('UDP Test APP_ID:', APP_ID);
const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), APP_ID, WS_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));

function uuidBytes(s) { return Buffer.from(s.replace(/-/g, ''), 'hex'); }
function buildUdpHeader(uuidStr, host, port, udpPayload) {
  const ver = Buffer.from([0]);
  const uuid = uuidBytes(uuidStr);
  const addon = Buffer.from([0]);
  const cmd = Buffer.from([2]); // UDP
  const portB = Buffer.allocUnsafe(2); portB.writeUInt16BE(port, 0);
  const hostB = Buffer.from(host);
  const atyp = Buffer.from([2, hostB.length]);
  const header = Buffer.concat([ver, uuid, addon, cmd, portB, atyp, hostB]);
  const lenB = Buffer.allocUnsafe(2); lenB.writeUInt16BE(udpPayload.length, 0);
  return Buffer.concat([header, lenB, udpPayload]);
}
// DNS query: example.com A
const dnsQuery = Buffer.from('123401000001000000000000076578616d706c6503636f6d0000010001', 'hex');

async function run() {
  await new Promise((r) => setTimeout(r, 2000));
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${WS_PATH}`);
    const timer = setTimeout(() => { console.error('UDP TIMEOUT'); ws.close(); reject(new Error('udp timeout')); }, 15000);
    ws.on('open', () => {
      ws.send(buildUdpHeader(APP_ID, '8.8.8.8', 53, dnsQuery));
      console.log('UDP DNS sorgusu gonderildi');
    });
    ws.on('message', (m) => {
      const buf = Buffer.from(m);
      console.log('UDP cevap geldi, byte:', buf.length, 'ilk baytlar:', buf.subarray(0, 4).toString('hex'));
      if (buf.length < 4) return;
      // ilk 2 bayt version/addon olabilir
      let off = 0;
      if (buf[0] === 0) { off = 2; console.log('VLESS UDP response header:', buf[0], buf[1]); }
      if (buf.length < off + 2) return;
      const dlen = buf.readUInt16BE(off); off += 2;
      console.log('DNS paket len:', dlen, 'kalan:', buf.length - off);
      if (buf.length - off < 12) return;
      const txid = buf.readUInt16BE(off);
      console.log('DNS txid:', txid.toString(16), '(beklenen 1234)');
      if (txid === 0x1234) {
        clearTimeout(timer);
        console.log('UDP proxy BASARILI');
        ws.close(); resolve();
      }
    });
    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
run().then(() => { console.log('UDP TEST GECTI'); srv.kill(); process.exit(0); })
  .catch((e) => { console.error('UDP TEST BASARISIZ:', e.message); srv.kill(); process.exit(1); });
