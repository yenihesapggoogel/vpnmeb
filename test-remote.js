/* Canli sunucu testi (wss://) - VLESS over WebSocket uzerinden hedefe gider.
 *
 * Kullanim:
 *   node test-remote.js <domain> <uuid> [path] [hedefHost] [hedefPort]
 *
 * Ornek:
 *   node test-remote.js vpnmeb.yenihesapp401.deno.net 8a5fb665-632e-4f9b-8337-e475a79d994c /notes-sync example.com 80
 *   node test-remote.js vpnmeb.yenihesapp401.deno.net 8a5fb665-632e-4f9b-8337-e475a79d994c /notes-sync example.com 443
 *
 * 443 testi: hedefe HTTP istegi atip "TLS alert" dondugunu bekleriz; donerse
 * platform 443'e ham TCP baglantisina izin vermiyor demektir.
 */
const WebSocket = require('ws');

const domain = process.argv[2];
const uuid = process.argv[3];
const path = process.argv[4] || '/notes-sync';
const targetHost = process.argv[5] || 'example.com';
const targetPort = parseInt(process.argv[6] || '80', 10);

if (!domain || !uuid) {
  console.log('Kullanim: node test-remote.js <domain> <uuid> [path] [host] [port]');
  process.exit(1);
}

function uuidBytes(s) {
  return Buffer.from(s.replace(/-/g, ''), 'hex');
}

function buildHeader(uuidStr, host, port) {
  const portB = Buffer.allocUnsafe(2);
  portB.writeUInt16BE(port, 0);
  const hostB = Buffer.from(host);
  return Buffer.concat([
    Buffer.from([0]),
    uuidBytes(uuidStr),
    Buffer.from([0]),
    Buffer.from([1]), // TCP
    portB,
    Buffer.from([2, hostB.length]),
    hostB,
  ]);
}

const url = `wss://${domain}${path}`;
console.log(`Baglaniyor: ${url}`);
console.log(`Hedef: ${targetHost}:${targetPort}`);

const ws = new WebSocket(url, { handshakeTimeout: 20000 });
let gotHeader = false;
let acc = Buffer.alloc(0);
const timer = setTimeout(() => {
  console.error('TIMEOUT: 20 sn icinde veri gelmedi');
  ws.close();
  process.exit(1);
}, 25000);

ws.on('open', () => {
  const header = buildHeader(uuid, targetHost, targetPort);
  const probe = Buffer.from(
    `GET / HTTP/1.1\r\nHost: ${targetHost}\r\nConnection: close\r\n\r\n`,
  );
  ws.send(Buffer.concat([header, probe]));
  console.log('VLESS header + istek gonderildi');
});

ws.on('message', (m) => {
  const buf = Buffer.from(m);
  if (!gotHeader) {
    if (buf.length < 2) return;
    console.log('VLESS response header:', buf[0], buf[1]);
    gotHeader = true;
    acc = Buffer.concat([acc, buf.subarray(2)]);
  } else {
    acc = Buffer.concat([acc, buf]);
  }
  console.log('gelen byte:', acc.length, '| ilk 60:', JSON.stringify(acc.subarray(0, 60).toString('latin1')));
  if (acc.length > 40) {
    clearTimeout(timer);
    console.log(acc.toString('utf8').includes('Example Domain')
      ? 'SONUC: HTTP BASARILI (hedefe TCP ulasti)'
      : 'SONUC: veri alindi (hedefe TCP ulasti)');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => {
  clearTimeout(timer);
  console.error('HATA:', e.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  if (!gotHeader) {
    console.error(`WS kapandi (code=${code}) veri yok:`, reason.toString());
    process.exit(1);
  }
});
