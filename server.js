/**
 * study-notes-sync - personal sync service
 * Render free web service compatible (plain HTTP inside, TLS terminated by Render).
 * Protocol: VLESS over WebSocket (compatible with v2rayNG / v2rayN / Hiddify / Streisand / V2Box)
 *
 * ENV:
 *   PORT     - Render injects automatically (default 10000)
 *   APP_ID   - your UUID, e.g. 6be3e1b2-05e1-46a1-ad36-70aaabaa8d12
 *              generate: npm run generate-id
 *   WS_PATH  - websocket path, default /notes-sync
 */

const http = require('http');
const net = require('net');
const dgram = require('dgram');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = parseInt(process.env.PORT || '10000', 10);
const WS_PATH = process.env.WS_PATH || '/notes-sync';

// UUID normalize -> 16 bytes
// APP_ID'yi Render'da elle girmene gerek yok, asagidaki sabit kod otomatik kullanilir.
const DEFAULT_APP_ID = '8a5fb665-632e-4f9b-8337-e475a79d994c';
function getAppIdBytes() {
  let id = (process.env.APP_ID || DEFAULT_APP_ID).trim();
  const hex = id.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    console.error('[error] APP_ID gecersiz UUID olmali. Ornek: npm run generate-id');
    process.exit(1);
  }
  return { id, bytes: Buffer.from(hex, 'hex') };
}
const { id: APP_ID_STR, bytes: APP_ID_BYTES } = getAppIdBytes();
console.log('[info] WS_PATH =', WS_PATH);

// ---------- decoy homepage (Render taramasi + okul filtresi icin masum gorunum) ----------
const HOME_HTML = `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Ders Notlarim - Senkron</title>
<style>body{font-family:system-ui,Arial;margin:0;background:#f6f7fb;color:#222}
header{background:#1a73e8;color:#fff;padding:28px 20px}main{max-width:720px;margin:24px auto;padding:0 16px}
.card{background:#fff;border-radius:12px;padding:18px;box-shadow:0 2px 10px rgba(0,0,0,.06);margin-bottom:14px}
button{background:#1a73e8;color:#fff;border:0;border-radius:8px;padding:10px 16px;cursor:pointer}
input,textarea{width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;margin:6px 0;box-sizing:border-box}
small{color:#666}</style></head>
<body><header><h1>Ders Notlarim</h1><p>Kisisel calisma notlari senkron servisi</p></header>
<main><div class="card"><h3>Hizli Not</h3>
<input id="t" placeholder="Baslik"/><textarea id="c" rows="4" placeholder="Not yaz..."></textarea>
<button onclick="save()">Kaydet (yerel)</button> <small id="s"></small></div>
<div class="card"><h3>Notlarim</h3><div id="l"></div></div>
<div class="card"><small>Durum: <span id="h">kontrol...</span></small></div></main>
<script>
function save(){const t=document.getElementById('t').value||'Basliksiz';
const c=document.getElementById('c').value||'';const k=JSON.parse(localStorage.getItem('notes')||'[]');
k.unshift({t,c,d:new Date().toLocaleString()});localStorage.setItem('notes',JSON.stringify(k));render();
document.getElementById('s').textContent='Kaydedildi';}
function render(){const k=JSON.parse(localStorage.getItem('notes')||'[]');
document.getElementById('l').innerHTML=k.map(n=>'<div style="border-bottom:1px solid #eee;padding:8px 0"><b>'+n.t+'</b><br/>'+n.c+'<br/><small>'+n.d+'</small></div>').join('')||'<small>Henuz not yok</small>';}
fetch('/health').then(r=>r.text()).then(t=>document.getElementById('h').textContent=t).catch(()=>document.getElementById('h').textContent='cevrimdisi');
render();</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok ' + new Date().toISOString());
    return;
  }
  // Sadece anasayfa goster, path listeleme yapma
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(HOME_HTML);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 10 * 1024 * 1024 });

server.on('upgrade', (req, socket, head) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname !== WS_PATH) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
  } catch {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// ---------- VLESS parsing ----------
function parseHeader(buf) {
  // min: 1 + 16 + 1 + 1 + 2 + 1 = 22 + addr
  if (buf.length < 24) return null;
  const version = buf[0];
  const uuid = buf.subarray(1, 17);
  if (!uuid.equals(APP_ID_BYTES)) return { error: 'bad-id' };
  const addonLen = buf[17];
  let pos = 18 + addonLen;
  if (buf.length < pos + 1 + 2 + 1) return null;
  const command = buf[pos]; pos += 1; // 1 TCP, 2 UDP, 3 MUX
  const port = buf.readUInt16BE(pos); pos += 2;
  const atyp = buf[pos]; pos += 1;
  let address = '';
  if (atyp === 1) {
    if (buf.length < pos + 4) return null;
    address = `${buf[pos]}.${buf[pos + 1]}.${buf[pos + 2]}.${buf[pos + 3]}`;
    pos += 4;
  } else if (atyp === 2) {
    const len = buf[pos]; pos += 1;
    if (buf.length < pos + len) return null;
    address = buf.subarray(pos, pos + len).toString('utf8');
    pos += len;
  } else if (atyp === 3) {
    if (buf.length < pos + 16) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(pos + i).toString(16));
    address = parts.join(':');
    pos += 16;
  } else {
    return { error: 'bad-atyp' };
  }
  const payload = buf.subarray(pos);
  return { version, command, port, address, payload };
}

function splitUdpPackets(buf) {
  // [len(2B BE) + data]...
  const out = [];
  let p = 0;
  while (p + 2 <= buf.length) {
    const len = buf.readUInt16BE(p);
    p += 2;
    if (p + len > buf.length) break;
    out.push(buf.subarray(p, p + len));
    p += len;
  }
  return out;
}

wss.on('connection', (ws) => {
  let stage = 'header'; // header -> forward
  let tcpSock = null;
  let udpSock = null;
  let udpTarget = null;
  let ver = 0;
  let headerSent = false;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch {}
    try { tcpSock && tcpSock.destroy(); } catch {}
    try { udpSock && udpSock.close(); } catch {}
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  // UDP hedefe gonder + cevabi geri yaz
  const sendUdp = (packet) => {
    if (!udpSock || !udpTarget) return;
    udpSock.send(packet, udpTarget.port, udpTarget.host, (err) => {
      if (err) cleanup();
    });
  };

  ws.on('message', (msg) => {
    if (closed) return;
    const data = Buffer.isBuffer(msg) ? msg : Buffer.from(msg);

    // --- ilk mesaj: header ---
    if (stage === 'header') {
      const h = parseHeader(data);
      if (!h || h.error) {
        // ID yanlissa sessiz kapat (tarama/probe korumasi)
        try { ws.close(1008, 'x'); } catch {}
        return;
      }
      ver = h.version;

      if (h.command === 1) {
        // ===== TCP =====
        // Node net.Socket connect oncesi yazilan veriyi buffer'lar, o yuzden
        // stage'i hemen forward yapip ilk payload'u direkt yaziyoruz.
        stage = 'forward';
        tcpSock = net.connect({ host: h.address, port: h.port }, () => {
          if (closed) return;
          // VLESS response header (istemci bunu bekler)
          try { ws.send(Buffer.from([ver, 0])); } catch { cleanup(); return; }
          headerSent = true;
        });
        tcpSock.setTimeout(30000);
        tcpSock.on('data', (chunk) => {
          if (closed) return;
          try { ws.send(chunk); } catch { cleanup(); }
        });
        tcpSock.on('error', cleanup);
        tcpSock.on('close', cleanup);
        tcpSock.on('timeout', cleanup);
        if (h.payload && h.payload.length > 0) {
          try { tcpSock.write(Buffer.from(h.payload)); } catch { cleanup(); return; }
        }
      } else if (h.command === 2) {
        // ===== UDP (DNS vb.) =====
        udpTarget = { host: h.address, port: h.port };
        try {
          udpSock = dgram.createSocket('udp4');
        } catch { cleanup(); return; }
        udpSock.on('message', (rmsg) => {
          if (closed) return;
          try {
            const lenBuf = Buffer.allocUnsafe(2);
            lenBuf.writeUInt16BE(rmsg.length, 0);
            if (!headerSent) {
              headerSent = true;
              ws.send(Buffer.concat([Buffer.from([ver, 0]), lenBuf, Buffer.from(rmsg)]));
            } else {
              ws.send(Buffer.concat([lenBuf, Buffer.from(rmsg)]));
            }
          } catch { cleanup(); }
        });
        udpSock.on('error', cleanup);
        // ilk payload icindeki UDP paketlerini coz
        const packets = splitUdpPackets(Buffer.from(h.payload));
        for (const p of packets) sendUdp(Buffer.from(p));
        stage = 'forward-udp';
        // Eger hic paket yoksa (sadece header) bekle, sonraki mesajlar paket icerir
      } else {
        // MUX desteklenmiyor
        try { ws.close(1003, 'x'); } catch {}
        return;
      }
      return;
    }

    // --- forward TCP ---
    if (stage === 'forward') {
      if (!tcpSock || tcpSock.destroyed) { cleanup(); return; }
      try {
        const ok = tcpSock.write(data);
        if (!ok) {
          // backpressure: kisa duraklat
          ws.pause && ws.pause();
          tcpSock.once('drain', () => { try { ws.resume && ws.resume(); } catch {} });
        }
      } catch { cleanup(); }
      return;
    }

    // --- forward UDP ---
    if (stage === 'forward-udp') {
      const packets = splitUdpPackets(data);
      for (const p of packets) sendUdp(Buffer.from(p));
      return;
    }
  });

  // genel guvenlik timeout'u (Render free'de asili baglanti kalmasin)
  ws._idle = setTimeout(() => cleanup(), 120000);
  ws.on('message', () => {
    clearTimeout(ws._idle);
    ws._idle = setTimeout(() => cleanup(), 120000);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[info] listening on 0.0.0.0:' + PORT);
  console.log('[info] APP_ID =', APP_ID_STR);
});
