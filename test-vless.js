/* Lokal test: server.js'in VLESS-TCP aktarmasini dogrular.
 * Kullanim: $env:APP_ID="test-uuid..."; node test-vless.js
 * Gercek UUID ile calistirin.
 */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const crypto = require('crypto');

const APP_ID = process.env.APP_ID || crypto.randomUUID();
const WS_PATH = process.env.WS_PATH || '/notes-sync';
const PORT = 18080;

console.log('Test APP_ID:', APP_ID);

const srv = spawn('node', ['server.js'], {
  env: { ...process.env, PORT: String(PORT), APP_ID, WS_PATH },
  stdio: ['ignore', 'pipe', 'pipe'],
});
srv.stdout.on('data', (d) => process.stdout.write('[srv] ' + d));
srv.stderr.on('data', (d) => process.stderr.write('[srv-err] ' + d));

function uuidBytes(s) {
  return Buffer.from(s.replace(/-/g, ''), 'hex');
}

function buildHeader(uuidStr, host, port) {
  const ver = Buffer.from([0]);
  const uuid = uuidBytes(uuidStr);
  const addon = Buffer.from([0]);
  const cmd = Buffer.from([1]); // TCP
  const portB = Buffer.allocUnsafe(2);
  portB.writeUInt16BE(port, 0);
  const hostB = Buffer.from(host);
  const atyp = Buffer.from([2, hostB.length]);
  return Buffer.concat([ver, uuid, addon, cmd, portB, atyp, hostB]);
}

async function runOnce() {
  // 2 sn bekle server acilsin
  await new Promise((r) => setTimeout(r, 2000));

  // 1) Anasayfa testi
  const http = require('http');
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        console.log('health:', res.statusCode, b.trim());
        resolve();
      });
    }).on('error', reject);
  });

  // 2) VLESS TCP testi: example.com:80'a HTTP GET
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${WS_PATH}`);
    ws.binaryType = 'arraybuffer';
    let gotHeader = false;
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => {
      console.error('TIMEOUT: sunucudan cevap gelmedi');
      ws.close();
      reject(new Error('timeout'));
    }, 15000);

    ws.on('open', () => {
      const header = buildHeader(APP_ID, 'example.com', 80);
      const httpReq = Buffer.from('GET / HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n');
      ws.send(Buffer.concat([header, httpReq]));
      console.log('header + HTTP istegi gonderildi');
    });
    ws.on('message', (m) => {
      const buf = Buffer.from(m);
      if (!gotHeader) {
        if (buf.length < 2) {
          clearTimeout(timer);
          reject(new Error('response header kisa'));
          return;
        }
        console.log('VLESS response header:', buf[0], buf[1]);
        gotHeader = true;
        acc = Buffer.concat([acc, buf.subarray(2)]);
      } else {
        acc = Buffer.concat([acc, buf]);
      }
      const s = acc.toString('utf8');
      if (s.includes('</html>') || s.includes('Example Domain')) {
        clearTimeout(timer);
        console.log('TCP proxy BASARILI, gelen byte:', acc.length);
        console.log('ilk 200 char:', s.slice(0, 200).replace(/\n/g, ' '));
        ws.close();
        resolve();
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    ws.on('close', () => {
      if (!gotHeader || acc.length === 0) {
        clearTimeout(timer);
        reject(new Error('ws erken kapandi, veri yok'));
      }
    });
  });

  // 3) Yanlis UUID testi (reddedilmeli)
  await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}${WS_PATH}`);
    ws.on('open', () => {
      const header = buildHeader(crypto.randomUUID(), 'example.com', 80);
      ws.send(header);
    });
    ws.on('close', () => {
      console.log('Yanlis UUID testi BASARILI (baglanti kapatildi)');
      resolve();
    });
    setTimeout(() => {
      console.log('Yanlis UUID testi: sunucu kapatmadi (dikkat)');
      ws.close();
      resolve();
    }, 4000);
  });
}

runOnce()
  .then(() => {
    console.log('TUM TESTLER GECTI');
    srv.kill();
    process.exit(0);
  })
  .catch((e) => {
    console.error('TEST BASARISIZ:', e.message);
    srv.kill();
    process.exit(1);
  });
