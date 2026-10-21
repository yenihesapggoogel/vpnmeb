# Cloudflare Workers surumu (VDS/VPS gerekmez)

`workers/vless-worker.js` = VLESS over WebSocket sunucusunun Cloudflare Workers surumu.
Kok dizindeki `wrangler.toml` bu dosyayi gosterir (`main = "workers/vless-worker.js"`).
Ucretsiz plan yeterli, **kart istemez**.

## 1) Dashboard'dan deploy (en kolay)

1. https://dash.cloudflare.com -> **Workers & Pages** -> **Create** -> **Worker**
2. Isim: `notes-sync` -> **Deploy**
3. **Edit code** -> icerikteki kodu sil -> `vless-worker.js` dosyasini yapistir -> **Deploy**
4. Test: `https://notes-sync.<hesap>.workers.dev/health` -> `ok ...` yazmali
5. Istersen **Settings -> Variables and Secrets**:
   - `APP_ID` = kendi UUID'n (yoksa koddaki varsayilan kullanilir)
   - `WS_PATH` = `/notes-sync`

## 2) Git'e bagla (Workers Builds) ile otomatik deploy

Dashboard: **Workers & Pages -> Create -> Connect to Git** -> repo sec.

| Ayar | Deger |
|---|---|
| Root directory | `/` (kok) |
| Build command | (bos birak) |
| Deploy command | `npx wrangler deploy` |

Kok dizindeki `wrangler.toml` sayesinde `npx wrangler deploy` dogru dosyayi bulur.
> **Onemli:** Repo kokunde `wrangler.toml` yoksa build su hatayi verir / takilir:
> `Missing entry-point to Worker script or to assets directory`. Bu dosya eklendikten
> sonra **Retry deployment** yap.

## 3) Terminalden deploy (CLI)

```bash
npx wrangler login      # bir kere, tarayicidan onay
npx wrangler deploy
```

## 4) Baglanti linki

```bash
node generate-link.js notes-sync.<hesap>.workers.dev 8a5fb665-632e-4f9b-8337-e475a79d994c
```

Cikan `vless://...` linkini v2rayNG / v2rayN / Hiddify > "Import from clipboard" ile ekle.

## 5) Lokal test (gercekten calisiyor mu?)

```bash
# Terminal A
npx wrangler dev --port 8787 --var APP_ID:8a5fb665-632e-4f9b-8337-e475a79d994c

# Terminal B
node workers/test-worker.js
```

Beklenen cikti: `WORKER TESTLERI GECTI`
(health + decoy sayfa + VLESS/TCP proxy + yanlis UUID reddi)

> Not: workerd WebSocket mesajlarini **Blob** olarak teslim eder; bu yuzden
> `messageToBytes()` icinde `await data.arrayBuffer()` var. Bu adim olmadan
> mesajlar 0 byte gorunur ve baglanti sessizce olu kalir (bu surumde cozuldu).

## Sinirlar

| Konu | Durum |
|---|---|
| TCP (HTTP/HTTPS, web gezinme) | Calisir |
| UDP (Roblox, DNS, oyun sesi) | **Calismaz** - Workers UDP acmaz |
| Istek limiti | 100.000 istek/gun (ucretsiz) |
| WebSocket | Uzun sure acik kalabilir; istek basina CPU 10 ms |
| Port 25 / Cloudflare IP'leri | Kapali (Cloudflare kurali) |

## Okul filtresi (MEB) notu

`*.workers.dev` bazi aglarda kategoriden engelli olabilir. Kontrol: okul
bilgisayarinda `https://notes-sync.<hesap>.workers.dev/` ac.
- Not defteri sayfasi geliyorsa -> engel yok, link calisir.
- "MEB Erisim Engeli" geliyorsa -> Worker'a kendi domainini bagla
  (**Settings -> Domains & Routes -> Add custom domain**) veya Psiphon gibi
  hazir bir istemci kullan.
