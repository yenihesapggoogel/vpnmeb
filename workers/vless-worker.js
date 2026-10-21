/**
 * vless-worker - VLESS over WebSocket, Cloudflare Workers surumu
 *
 * VDS/VPS GEREKMEZ: Cloudflare'in ucretsiz planinda calisir (kart istemez).
 * Kurulum: https://dash.cloudflare.com -> Workers & Pages -> Create -> Worker
 *          -> kodu yapistir -> Deploy.
 * Adres:   https://<worker-adi>.<hesap>.workers.dev
 *
 * Desteklenen: VLESS + WS + TLS (v2rayN, v2rayNG, Hiddify, NekoBox, Streisand...)
 * Desteklenmeyen: UDP (Roblox/DNS gibi UDP istekleri) - Workers UDP acmaz.
 *
 * Degiskenler (opsiyonel, Dashboard -> Settings -> Variables and Secrets):
 *   APP_ID  : istemcideki UUID ile ayni olmali (varsayilan asagidaki)
 *   WS_PATH : websocket yolu (varsayilan /notes-sync)
 */

import { connect } from "cloudflare:sockets";

const DEFAULT_APP_ID = "8a5fb665-632e-4f9b-8337-e475a79d994c";
const DEFAULT_WS_PATH = "/notes-sync";

// ---------- decoy ana sayfa (filtreye masum gorunum) ----------
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

// ---------- yardimcilar ----------
function uuidToBytes(uuid) {
  const hex = String(uuid).replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function concat(a, b) {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** VLESS header: ver(1) uuid(16) addonLen(1) addons cmd(1) port(2) atyp(1) addr */
function parseHeader(buf, idBytes) {
  if (buf.length < 24) return null; // daha fazla veri gerek
  const version = buf[0];
  for (let i = 0; i < 16; i++) {
    if (buf[1 + i] !== idBytes[i]) return { error: "bad-id" };
  }
  const addonLen = buf[17];
  let pos = 18 + addonLen;
  if (buf.length < pos + 4) return null;
  const command = buf[pos];
  pos += 1;
  const port = (buf[pos] << 8) | buf[pos + 1];
  pos += 2;
  const atyp = buf[pos];
  pos += 1;
  let address = "";
  if (atyp === 1) {
    if (buf.length < pos + 4) return null;
    address = `${buf[pos]}.${buf[pos + 1]}.${buf[pos + 2]}.${buf[pos + 3]}`;
    pos += 4;
  } else if (atyp === 2) {
    if (buf.length < pos + 1) return null;
    const len = buf[pos];
    pos += 1;
    if (buf.length < pos + len) return null;
    address = new TextDecoder().decode(buf.subarray(pos, pos + len));
    pos += len;
  } else if (atyp === 3) {
    if (buf.length < pos + 16) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(((buf[pos + i] << 8) | buf[pos + i + 1]).toString(16));
    }
    address = parts.join(":");
    pos += 16;
  } else {
    return { error: "bad-atyp" };
  }
  return { version, command, port, address, payload: buf.subarray(pos) };
}

function toBytes(data) {
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data?.byteLength === "number") return new Uint8Array(data);
  return new Uint8Array(0);
}

/** WebSocket mesaji workerd'de Blob, ArrayBuffer veya string olabilir. */
async function messageToBytes(data) {
  if (data && typeof data.arrayBuffer === "function") {
    return new Uint8Array(await data.arrayBuffer());
  }
  return toBytes(data);
}

/** hedef -> istemci yonunde tek seferde gonderilecek maksimum parca */
const MAX_CHUNK = 32 * 1024;
const MAX_HEADER = 8 * 1024;

// ---------- VLESS oturumu ----------
function handleVless(ws, appId) {
  const idBytes = uuidToBytes(appId);
  if (!idBytes) {
    try { ws.close(1011, "bad config"); } catch { /* yoksay */ }
    return;
  }

  let stage = "header"; // header | connecting | forward
  let closed = false;
  let pending = new Uint8Array(0);
  let socket = null;
  let writer = null;
  const queue = []; // yazici hazir olmadan gelen parcalar (sira korunur)
  const pre = []; // TCP baglantisi kurulurken gelen parcalar
  let chain = Promise.resolve();

  const close = () => {
    if (closed) return;
    closed = true;
    try { ws.close(); } catch { /* yoksay */ }
    try { writer?.close(); } catch { /* yoksay */ }
    try { socket?.close(); } catch { /* yoksay */ }
  };

  const send = (buf) => {
    if (closed || !buf || buf.length === 0) return;
    try { ws.send(buf); } catch { close(); }
  };

  const drain = async () => {
    if (!writer) return;
    while (!closed && queue.length > 0) {
      const chunk = queue.shift();
      try {
        await writer.write(chunk);
      } catch {
        close();
        return;
      }
    }
  };

  // Tum yazmalar ayni zincirden gecer -> parcalar sirayla hedefe gider.
  const enqueue = (chunk) => {
    if (closed || !chunk || chunk.length === 0) return;
    queue.push(chunk);
    chain = chain.then(drain).catch(() => close());
  };

  const openTcp = async (h) => {
    stage = "connecting";
    try {
      socket = connect({ hostname: h.address, port: h.port });
    } catch {
      close();
      return;
    }
    socket.closed.catch(() => close());

    try {
      writer = socket.writable.getWriter();
      await socket.opened; // baglanti gercekten kuruldu mu?
    } catch {
      close();
      return;
    }
    if (closed) return;

    // istemciye VLESS cevap basligi: ver + 0
    send(new Uint8Array([h.version, 0]));
    stage = "forward";

    // header ile birlikte gelen ilk veri + baglanti kurulurken birikenler
    enqueue(h.payload);
    while (pre.length > 0) enqueue(pre.shift());

    // hedef -> istemci
    (async () => {
      try {
        const reader = socket.readable.getReader();
        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length) {
            for (let off = 0; off < value.length; off += MAX_CHUNK) {
              send(value.subarray(off, Math.min(off + MAX_CHUNK, value.length)));
            }
          }
        }
      } catch { /* yoksay */ }
      close();
    })();
  };

  const onMessage = async (data) => {
    if (closed) return;
    const chunk = await messageToBytes(data);
    if (chunk.length === 0) return;

    if (stage === "header") {
      pending = concat(pending, chunk);
      if (pending.length > MAX_HEADER) {
        close();
        return;
      }
      const h = parseHeader(pending, idBytes);
      if (!h) return; // header henuz tamamlanmadi
      pending = new Uint8Array(0);
      if (h.error) {
        close();
        return;
      }
      if (h.command !== 1) { // 2 = UDP (Workers desteklemez)
        close();
        return;
      }
      openTcp(h);
      return;
    }

    if (stage === "connecting") {
      pre.push(chunk);
      return;
    }

    enqueue(chunk);
  };

  // Mesajlar sirayla islenir (Blob -> ArrayBuffer donusumu async).
  let rchain = Promise.resolve();
  ws.addEventListener("message", (event) => {
    const data = event.data;
    rchain = rchain
      .then(() => onMessage(data))
      .catch(() => close());
  });

  ws.addEventListener("close", close);
  ws.addEventListener("error", close);
}

// ---------- HTTP ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const wsPath = env.WS_PATH || DEFAULT_WS_PATH;
    const appId = (env.APP_ID || DEFAULT_APP_ID).trim();

    if (url.pathname === "/health") {
      return new Response("ok " + new Date().toISOString(), {
        headers: { "content-type": "text/plain" },
      });
    }

    if (url.pathname === wsPath) {
      const upgrade = (request.headers.get("Upgrade") || "").toLowerCase();
      if (upgrade !== "websocket") {
        return new Response("Bad Request", { status: 400 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      handleVless(server, appId);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response(HOME_HTML, {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
};
