/**
 * study-notes-sync - Deno Deploy entrypoint
 *
 * Node surumundeki server.js ile ayni protokol (VLESS over WebSocket), ama
 * Deno API'leriyle yazildi:
 *   - HTTP  : Deno.serve
 *   - WS    : Deno.upgradeWebSocket
 *   - TCP   : Deno.connect
 *   - UDP   : Deno.listenUDP (platform desteklemiyorsa UDP komutu reddedilir)
 *
 * ENV:
 *   APP_ID  - UUID (istemciyle ayni olmali), varsayilan: kod icindeki deger
 *   WS_PATH - websocket yolu, varsayilan /notes-sync
 *   PORT    - platform verir (varsayilan 8000)
 */

const WS_PATH = Deno.env.get("WS_PATH") || "/notes-sync";
const DEFAULT_APP_ID = "8a5fb665-632e-4f9b-8337-e475a79d994c";

// Deno Deploy, uygulamanin hangi adreste dinlenecegini DENO_SERVE_ADDRESS
// ile bildirir ("duplicate,vsock:-1" gibi ozel bir deger). Deno bu degeri
// kendisi cozer, o yuzden hicbir sey elle ayarlanmaz - sadece Deno.serve'a
// hostname/port VERMEYIZ, aksi halde Deno vsock adresine baglanamaz.
// Lokal calistirmada (DENO_SERVE_ADDRESS yok) 0.0.0.0:PORT dinlenir.
const SERVE_ADDRESS = Deno.env.get("DENO_SERVE_ADDRESS");
const LISTEN = (() => {
  if (SERVE_ADDRESS) return null; // Deno kendi adresini cozer
  const port = Number(Deno.env.get("PORT") || "8000");
  return { hostname: "0.0.0.0", port };
})();

const decoder = new TextDecoder();
// ---------- UUID -> 16 byte ----------
function getAppIdBytes(): { id: string; bytes: Uint8Array } {
  const id = (Deno.env.get("APP_ID") || DEFAULT_APP_ID).trim();
  const hex = id.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    console.error("[error] APP_ID gecersiz UUID olmali. Ornek: npm run generate-id");
    Deno.exit(1);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return { id, bytes };
}
const { id: APP_ID_STR, bytes: APP_ID_BYTES } = getAppIdBytes();

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ---------- decoy homepage (okul filtresi icin masum gorunum) ----------
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

// ---------- VLESS parsing ----------
// Deno 2.x stable'da UDP API'si yok; platformda varsa ayni sekilde kullanilir
interface UdpLike {
  send(payload: Uint8Array, ...args: unknown[]): void;
  receive(cb: (...args: unknown[]) => void): void;
  close(): void;
}

type Parsed =
  | { error: string }
  | {
    version: number;
    command: number;
    port: number;
    address: string;
    payload: Uint8Array;
  };

function parseHeader(buf: Uint8Array): Parsed | null {
  if (buf.length < 24) return null;
  const version = buf[0];
  const uuid = buf.subarray(1, 17);
  if (!sameBytes(uuid, APP_ID_BYTES)) return { error: "bad-id" };
  const addonLen = buf[17];
  let pos = 18 + addonLen;
  if (buf.length < pos + 4) return null;
  const command = buf[pos];
  pos += 1; // 1 TCP, 2 UDP, 3 MUX
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
    const len = buf[pos];
    pos += 1;
    if (buf.length < pos + len) return null;
    address = decoder.decode(buf.subarray(pos, pos + len));
    pos += len;
  } else if (atyp === 3) {
    if (buf.length < pos + 16) return null;
    const parts: string[] = [];
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

function splitUdpPackets(buf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let p = 0;
  while (p + 2 <= buf.length) {
    const len = (buf[p] << 8) | buf[p + 1];
    p += 2;
    if (p + len > buf.length) break;
    out.push(buf.subarray(p, p + len));
    p += len;
  }
  return out;
}

function withLen(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 2);
  out[0] = (payload.length >> 8) & 0xff;
  out[1] = payload.length & 0xff;
  out.set(payload, 2);
  return out;
}

async function writeAll(
  conn: Deno.Conn,
  data: Uint8Array,
): Promise<void> {
  let off = 0;
  while (off < data.length) {
    const n = await conn.write(data.subarray(off));
    if (n === null) return;
    off += n;
  }
}

// ---------- WebSocket baglantisi (VLESS) ----------
function handleVless(ws: WebSocket) {
  ws.binaryType = "arraybuffer";
  let stage: "header" | "forward" | "forward-udp" = "header";
  let tcpConn: Deno.Conn | null = null;
  let udp: UdpLike | null = null;
  let udpTarget: { host: string; port: number } | null = null;
  let ver = 0;
  let headerSent = false;
  let closed = false;

  const IDLE_MS = 300000;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const refreshIdle = () => {
    if (closed) return;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => cleanup(), IDLE_MS);
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    try {
      ws.close();
    } catch { /* yoksay */ }
    try {
      tcpConn?.close();
    } catch { /* yoksay */ }
    try {
      udp?.close();
    } catch { /* yoksay */ }
  };

  const sendWs = (buf: Uint8Array) => {
    if (closed || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(buf);
    } catch {
      cleanup();
      return;
    }
    refreshIdle();
  };

  ws.onclose = cleanup;
  ws.onerror = cleanup;

  // TCP: sunucu hedefe baglanir, istemciye VLESS response header doner
  const startTcp = async (h: {
    version: number;
    port: number;
    address: string;
    payload: Uint8Array;
  }) => {
    stage = "forward";
    let conn: Deno.Conn;
    try {
      conn = await Deno.connect({ hostname: h.address, port: h.port });
    } catch (err) {
      console.error("[tcp] baglanti hatasi:", h.address + ":" + h.port, String(err));
      cleanup();
      return;
    }
    if (closed) {
      try {
        conn.close();
      } catch { /* yoksay */ }
      return;
    }
    tcpConn = conn;
    ver = h.version;
    sendWs(new Uint8Array([ver, 0]));
    headerSent = true;

    // hedef -> istemci
    (async () => {
      const buf = new Uint8Array(32 * 1024);
      try {
        while (!closed) {
          const n = await conn.read(buf);
          if (n === null) break;
          sendWs(buf.slice(0, n));
        }
      } catch { /* yoksay */ }
      cleanup();
    })();

    // ilk payload
    if (h.payload.length > 0) {
      try {
        await writeAll(conn, h.payload);
      } catch {
        cleanup();
        return;
      }
    }
    refreshIdle();
  };

  // UDP: paketleri hedefe gonder, cevaplari istemciye don
  const startUdp = (h: {
    version: number;
    port: number;
    address: string;
    payload: Uint8Array;
  }) => {
    stage = "forward-udp";
    ver = h.version;
    udpTarget = { host: h.address, port: h.port };

    // Deno 2.x stable'da UDP API'si yok (Deno.udp / Deno.listenUDP undefined).
    // Platformda UDP varsa kullanilir, yoksa istek reddedilir.
    const udpFactory = (Deno as unknown as {
      udp?: (opts: unknown) => UdpLike;
    }).udp;
    if (typeof udpFactory !== "function") {
      console.error(
        "[udp] bu runtime UDP desteklemiyor (Deno.udp yok). UDP istegi reddedildi.",
      );
      cleanup();
      return;
    }

    let sock: UdpLike;
    try {
      sock = udpFactory({
        localAddr: { transport: "ip", hostname: "0.0.0.0", port: 0 },
      });
    } catch (err) {
      console.error("[udp] desteklenmiyor:", String(err));
      cleanup();
      return;
    }
    udp = sock;

    sock.receive((...args: unknown[]) => {
      if (closed) return;
      // Deno.udp: { payload, addr, port } | eski API: (addr, port, data)
      const first = args[0] as { payload?: Uint8Array } | undefined;
      const data = first && typeof first === "object" && "payload" in first
        ? first.payload!
        : (args[2] as Uint8Array);
      if (!data) return;
      const framed = withLen(data);
      if (!headerSent) {
        headerSent = true;
        const out = new Uint8Array(framed.length + 2);
        out[0] = ver;
        out[1] = 0;
        out.set(framed, 2);
        sendWs(out);
      } else {
        sendWs(framed);
      }
    });

    const sendUdp = (packet: Uint8Array) => {
      if (closed || !udp || !udpTarget) return;
      try {
        // eski API: send(data, port, host) | yeni API: send(data, {hostname, port})
        udp.send(packet, udpTarget.port, udpTarget.host);
      } catch {
        try {
          udp.send(packet, {
            hostname: udpTarget.host,
            port: udpTarget.port,
          });
        } catch { /* gecici hata: oyun devam etsin */ }
      }
      refreshIdle();
    };
    for (const p of splitUdpPackets(h.payload)) sendUdp(p);
    refreshIdle();
    udpSend = sendUdp;
  };

  // UDP gonderici stage'e gore degisiyor
  let udpSend: ((packet: Uint8Array) => void) | null = null;

  ws.onmessage = async (event) => {
    if (closed) return;
    const data = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : typeof event.data === "string"
      ? new TextEncoder().encode(event.data)
      : new Uint8Array(event.data as Uint8Array);
    if (data.length === 0) return;

    if (stage === "header") {
      const h = parseHeader(data);
      if (!h || "error" in h) {
        try {
          ws.close(1008, "x");
        } catch { /* yoksay */ }
        return;
      }
      if (h.command === 1) {
        await startTcp(h);
      } else if (h.command === 2) {
        startUdp(h);
      } else {
        try {
          ws.close(1003, "x");
        } catch { /* yoksay */ }
      }
      return;
    }

    if (stage === "forward") {
      if (!tcpConn) {
        cleanup();
        return;
      }
      refreshIdle();
      try {
        await writeAll(tcpConn, data);
      } catch {
        cleanup();
      }
      return;
    }

    if (stage === "forward-udp") {
      if (!udpSend) {
        refreshIdle();
        return;
      }
      for (const p of splitUdpPackets(data)) udpSend(p);
    }
  };

  refreshIdle();
}

// ---------- HTTP + WebSocket ----------
function handler(req: Request): Response {
  const url = new URL(req.url);
  console.log("[req]", req.method, url.pathname);

  if (url.pathname === "/health") {
    return new Response("ok " + new Date().toISOString(), {
      headers: { "content-type": "text/plain" },
    });
  }

  if (url.pathname === WS_PATH) {
    const upgrade = req.headers.get("upgrade");
    if (upgrade && upgrade.toLowerCase() === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      handleVless(socket);
      return response;
    }
    return new Response("Bad Request", { status: 400 });
  }

  return new Response(HOME_HTML, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

if (LISTEN) {
  Deno.serve({ hostname: LISTEN.hostname, port: LISTEN.port }, handler);
} else {
  // Deno Deploy auto-serve modu: platform HTTP'yi kendisi sunar (vsock),
  // sadece default export (fetch) gerekir.
  console.log("[info] auto-serve modu: default export kullanilacak");
}

// Deno Deploy / deno serve: modulun varsayilan export'unu fetch handler olarak
// sunar. (Yerelde Deno.serve ile calisir.)
export default { fetch: handler };

console.log(
  "[info] listening on",
  LISTEN ? LISTEN.hostname + ":" + LISTEN.port : SERVE_ADDRESS,
);
console.log("[info] WS_PATH =", WS_PATH);
console.log("[info] APP_ID =", APP_ID_STR);
console.log(
  "[info] DENO_SERVE_ADDRESS =",
  Deno.env.get("DENO_SERVE_ADDRESS"),
  "| DENO_AUTO_SERVE =",
  Deno.env.get("DENO_AUTO_SERVE"),
  "| DENO_REGION =",
  Deno.env.get("DENO_REGION"),
  "| EGRESS_POLICY =",
  Deno.env.get("DENO_EGRESS_HEADER_POLICY"),
);
