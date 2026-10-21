/* Cloudflare Workers (workerd) icin uctan uca test.
 *
 * 1) Terminal A:  npx wrangler dev --config workers/wrangler.toml --port 8787 \
 *                   --var APP_ID:8a5fb665-632e-4f9b-8337-e475a79d994c
 * 2) Terminal B:  node workers/test-worker.js
 *
 * Test edilenler:
 *   - /health  -> 200 "ok ..."
 *   - anasayfa -> 200 (decoy sayfa)
 *   - VLESS+WS -> example.com:80 uzerinden HTTP 200 icerik aktarimi
 *   - yanlis UUID -> baglanti reddedilir
 */
const WebSocket = require('ws');
const crypto = require('crypto');

const BASE = process.env.WORKER_URL || 'http://127.0.0.1:8787';
const WS_PATH = process.env.WS_PATH || '/notes-sync';
const APP_ID = process.env.APP_ID || '8a5fb665-632e-4f9b-8337-e475a79d994c';
// Test hedefi: port 80'de HTML donen, Cloudflare arkasinda OLMAYAN bir site.
// (Cloudflare Workers, Cloudflare IP'lerine TCP baglanti acamaz.)
const TARGET_HOST = process.env.TARGET_HOST || 'neverssl.com';
const TARGET_PORT = Number(process.env.TARGET_PORT || 80);

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

async function checkHealth() {
  const res = await fetch(`${BASE}/health`);
  const text = await res.text();
  if (res.status !== 200 || !text.startsWith('ok')) {
    throw new Error(`health basarisiz: ${res.status} ${text.slice(0, 80)}`);
  }
  console.log('1) health BASARILI:', res.status, text.trim());
}

async function checkHomepage() {
  const res = await fetch(`${BASE}/`);
  const html = await res.text();
  if (res.status !== 200 || !html.includes('Ders Notlarim')) {
    throw new Error(`anasayfa basarisiz: ${res.status}`);
  }
  console.log('2) decoy anasayfa BASARILI:', res.status, html.length, 'byte');
}

function vlessTcpTest() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}${WS_PATH}`);
    ws.binaryType = 'arraybuffer';
    let gotHeader = false;
    let acc = Buffer.alloc(0);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('VLESS testi TIMEOUT (sunucudan cevap gelmedi)'));
    }, 20000);

    ws.on('open', () => {
      const header = buildHeader(APP_ID, TARGET_HOST, TARGET_PORT);
      const httpReq = Buffer.from(
        `GET / HTTP/1.1\r\nHost: ${TARGET_HOST}\r\nConnection: close\r\n\r\n`
      );
      ws.send(Buffer.concat([header, httpReq]));
    });

    ws.on('message', (m) => {
      const buf = Buffer.from(m);
      if (!gotHeader) {
        if (buf.length < 2) {
          clearTimeout(timer);
          reject(new Error('VLESS cevap basligi kisa'));
          return;
        }
        console.log('3) VLESS cevap basligi:', buf[0], buf[1]);
        gotHeader = true;
        acc = Buffer.concat([acc, buf.subarray(2)]);
      } else {
        acc = Buffer.concat([acc, buf]);
      }
      // herhangi bir veri geldiyse tunel calisiyor
      if (gotHeader && acc.length > 0) {
        clearTimeout(timer);
        console.log(
          `3) VLESS/TCP proxy BASARILI (${TARGET_HOST}:${TARGET_PORT}), gelen byte:`,
          acc.length
        );
        console.log('   ilk 120 char:', acc.toString('latin1').slice(0, 120).replace(/\r?\n/g, ' '));
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
        reject(new Error('VLESS: ws erken kapandi, veri yok'));
      }
    });
  });
}

function wrongUuidTest() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace('http', 'ws')}${WS_PATH}`);
    let settled = false;
    const done = (ok, msg) => {
      if (settled) return;
      settled = true;
      if (ok) {
        console.log('4) yanlis UUID testi BASARILI (baglanti kapatildi)');
        resolve();
      } else {
        reject(new Error(msg));
      }
    };
    ws.on('open', () => {
      ws.send(buildHeader(crypto.randomUUID(), 'example.com', 80));
    });
    ws.on('close', () => done(true));
    ws.on('error', () => done(true));
    setTimeout(() => {
      try {
        ws.close();
      } catch (_) {
        /* yoksay */
      }
      done(false, 'yanlis UUID kabul edildi (kapatilmadi)');
    }, 5000);
  });
}

(async () => {
  console.log('Worker:', BASE, '| path:', WS_PATH, '| UUID:', APP_ID);
  await checkHealth();
  await checkHomepage();
  await vlessTcpTest();
  await wrongUuidTest();
  console.log('\nWORKER TESTLERI GECTI');
})().catch((e) => {
  console.error('\nWORKER TESTI BASARISIZ:', e.message);
  process.exit(1);
});
