# Cloudflare Workers surumu (VDS/VPS gerekmez)

`vless-worker.js` = VLESS over WebSocket sunucusunun Cloudflare Workers surumu.
Ucretsiz plan yeterli, **kart istemez**.

## 1) Deploy (dashboard, 2 dakika)

1. https://dash.cloudflare.com -> **Workers & Pages** -> **Create** -> **Worker**
2. Isim: `notes-sync` -> **Deploy**
3. **Edit code** -> icerikteki kodu sil -> `vless-worker.js` dosyasini yapistir -> **Deploy**
4. Test: `https://notes-sync.<hesap>.workers.dev/health` -> `ok ...` yazmali
5. Istersen **Settings -> Variables and Secrets**:
   - `APP_ID` = kendi UUID'n (yoksa dosyadaki varsayilan kullanilir)
   - `WS_PATH` = `/notes-sync`

## 2) Deploy (CLI)

```bash
npx wrangler deploy --config workers/wrangler.toml
```

(Wrangler ilk calismada `wrangler login` ister; kart gerekmez.)

## 3) Baglanti linki

```bash
node generate-link.js notes-sync.<hesap>.workers.dev 8a5fb665-632e-4f9b-8337-e475a79d994c
```

Cikan `vless://...` linkini v2rayNG / v2rayN / Hiddify > "Import from clipboard" ile ekle.

## 4) Lokal test (gercek calisti mi?)

```bash
# Terminal A
npx wrangler dev --config workers/wrangler.toml --port 8787 ^
  --var APP_ID:8a5fb665-632e-4f9b-8337-e475a79d994c

# Terminal B
node workers/test-worker.js
```

Beklenen cikti: `WORKER TESTLERI GECTI`
(health + decoy sayfa + VLESS/TCP proxy + yanlis UUID reddi)

> Not: workerd WebSocket mesajlarini **Blob** olarak teslim eder; bu yuzden
> `messageToBytes()` icinde `await data.arrayBuffer()` var. Bu adim olmadan
> mesajlar 0 byte gorunur ve baglanti sessizce olur (bu surumde cozuldu).

## Sinirlar

| Konu | Durum |
|---|---|
| TCP (HTTP/HTTPS, web gezinme) | Calisir |
| UDP (Roblox, DNS, oyun sesi) | **Calismaz** - Workers UDP acmaz |
| Istek limiti | 100.000 istek/gun (ucretsiz) |
| WebSocket suresi | Uzun sure acik kalabilir, istek basina CPU 10ms |
| Port 25 / Cloudflare IP'leri | Kapali (Cloudflare kurali) |

## Okul filtresi (MEB) notu

`*.workers.dev` bazi aglarda kategoriden engelli olabilir. Kontrol: okul
bilgisayarinda `https://notes-sync.<hesap>.workers.dev/` ac.
- Not defteri sayfasi geliyorsa -> engel yok, link calisir.
- "MEB Erisim Engeli" geliyorsa -> Worker'a kendi domainini bagla
  (**Settings -> Domains & Routes -> Add custom domain**) veya Psiphon gibi
  hazir bir istemci kullan.
