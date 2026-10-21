# Ders Notlari Sync (Render + VLESS-WS-TLS)

Kisisel not senkron servisi gorunumu altinda calisan, MEB/Fatih gibi sadece `TCP 80/443 + HTTPS`'e izin veren filtreli aglarda sansuru asmak icin tasarlanmis ozel VLESS-over-WebSocket sunucusu.

> Test edildi: `node test-vless.js` ile TCP proxy + UUID auth dogrulandi.

## DURUM (21.10.2026)

| Platform | Durum | Not |
|---|---|---|
| **Render** (`vpnmeb.onrender.com`) | Kod calisiyor, ama servis **"Service Suspended"** -> dashboard'dan **Resume** lazim | `onrender.com` okul filtresinden gecir; Render'da 100GB/ay limiti var |
| Deno Deploy (`vpnmeb.yenihesapp401.deno.net`) | **503** - production routing'i cozulemedi (platform vsock adresini kendisi tutuyor, uygulama `AddrInUse` aliyor) | Ayrica okul (MEB) filtresi `*.deno.net` adreslerini engelliyor; Deno AUP'de "VPN / Forward proxy" yasak |
| Deno Deploy preview | Bir ara calismisti (HTTP 200) | Sadece preview, production degil |

**Hemen kullanmak icin:** Render dashboard > `vpnmeb` servisi > **Resume**.
Sonra bu linki v2rayNG / v2rayN'ye yapistir:

```
vless://8a5fb665-632e-4f9b-8337-e475a79d994c@vpnmeb.onrender.com:443?encryption=none&security=tls&sni=vpnmeb.onrender.com&fp=chrome&type=ws&host=vpnmeb.onrender.com&path=%2Fnotes-sync#Render-MEB
```

> Render free 15 dk bos kalinca uyur (ilk baglanti ~50 sn). Cozum: UptimeRobot ile
> 10 dk'da bir `https://vpnmeb.onrender.com/health` adresine ping.

## VDS/VPS olmadan: Cloudflare Workers (ucretsiz, kart istemez)

`workers/vless-worker.js` = ayni VLESS-over-WS sunucusunun Cloudflare Workers surumu.
Sunucu/VDS yok, Cloudflare'in ucretsiz planinda calisir (100.000 istek/gun).

1. https://dash.cloudflare.com -> **Workers & Pages** -> **Create** -> **Worker**
2. Isim ver (ornek `notes-sync`) -> **Deploy**
3. **Edit code** -> icindeki kodu sil, `workers/vless-worker.js` icerigini yapistir -> **Deploy**
4. Test: `https://notes-sync.<hesap>.workers.dev/health` -> `ok ...` yazmali
5. Link uret:

```bash
node generate-link.js notes-sync.<hesap>.workers.dev 8a5fb665-632e-4f9b-8337-e475a79d994c
```

(UUID'yi degistirmek istersen Worker > Settings > Variables > `APP_ID` ekle; ayni
degeri linke de yaz.)

**Sinirlar:** Workers UDP acmaz -> Roblox/DNS gibi UDP istekleri calismaz, normal
web gezinmesi (TCP 443) calisir. Okul filtresi `workers.dev` adresini engelliyorsa
Worker'a kendi domainini bagla (Domains > Custom Domain) - ucretsiz plan domain
baglamaya izin verir, domain ucretli olabilir.

**Kontrol:** Okul bilgisayarinda `https://notes-sync.<hesap>.workers.dev/` ac.
Not defteri sayfasi geliyorsa filtre gecmemis demektir (link calisir); "MEB Erisim
Engeli" geliyorsa o alan adi kategoriden takiliyor -> hazir istemcilere bak.

## Hic sunucu olmadan: hazir istemciler (en hizli yol)

Kod/deploy istemiyorsan, filtre asmak icin tasarlanmis ucretsiz araclar:

| Arac | Ne yapar | Not |
|---|---|---|
| **Psiphon** (psiphon.ca) | Obfuscated proxy, kendi sunucu agi | Kur, "Connect" bas. MEB'de en yuksek sans. |
| **Cloudflare WARP** (+ warp-plus) | Cloudflare agina MASQUE/WireGuard | 1.1.1.1 DNS'i tikali olabilir; warp-plus obfuscation ile dener |
| **Tor Browser + Snowflake** | Tor koprusu, domain engeli tanimaz | Yavas ama inatci |
| **Hiddify / v2rayNG + ucretsiz config** | Hazir VLESS/VMess abonelikleri | Halka acik nodelar guvensiz ve kararsiz; sadece acil durum |

Siralama onerisi: **Psiphon -> Cloudflare Worker (yukarida) -> Tor+Snowflake**.
Hepsi "sunucu kirala" demeden calisir; tek gereken cihaza uygulamayi kurmak.

## Deno Deploy'a deploy (denendi, production'da 503)

Node surumu (`server.js`) Deno'da calismaz -> Deno icin ayri giris noktasi var: `main.ts`
(`Deno.serve` + `Deno.upgradeWebSocket` + `Deno.connect`). Yerelde testler gecti, ancak
production'da platform routing'i cozulemedigi icin 503 veriyor (detay: `main.ts` icindeki
yorumlar). Deno Deploy AUP'inde VPN/forward proxy yasak oldugu icin kalici cozum olarak
onerilmez; Render ya da kendi VPS'in daha saglam secenek.

## Neden Hotspot Shield artik calismiyor?

Arastirmaya gore MEB agi (FortiGuard + DPI):

1. Sadece TCP 80 ve 443 acik. OpenVPN (1194/UDP), WireGuard (51820/UDP), PPTP/L2TP direkt engelli.
2. Domain kategorisi filtreleniyor. Yeni kayitli / VPN / Proxy kategorili domainler yasakli. Bilinen VPN IP'leri kara listede.
3. DPI ile VPN parmak izi taniniyor. Hotspot Shield, Nord, Express gibi ticari VPN protokolleri 1 sn icinde kesiliyor (2025'te cok rapor var).
4. SSL Inspection (MEB sertifikasi) ile HTTPS cozulebiliyor.

Bu proje sunlari yapar:

- Disaridan bakinca siradan bir `https://senin-uygulaman.onrender.com` sitesi gibi gorunur (sahte not uygulamasi anasayfasi var).
- Gercek trafik: `VLESS + WebSocket + TLS` port 443 uzerinden. DPI icin normal HTTPS-WebSocket trafiginden farki yok.
- `onrender.com` cok sayida masum ogrenci projesi barindirdigi icin kategorisi genelde acik oluyor. Tikaliysa alt taraftaki cozume bak.

## Yasal / Okul kurali uyarisi

- Turkiye'de VPN kullanmak yasak degil. Ama **okul aginda filtreyi delmek disiplin sucu olabilir**, idare loglardan gorebilir.
- Bu projeyi sadece **kisisel gizlilik + engellenen egitim iceriklerine erisim** icin, sorumlulugun sende oldugunu bilerek kullan.
- Okul cihazina kurulu MEB sertifikasi varsa okul trafigini gorebilir. Kisisel cihazinda MEB sertifikasini kaldirman gizliligi artirir (asagida).
- Lutfen banka/ders notu gibi kritik isleri okul aginda yapma, linkini kimseyle herkese acik paylasma (IP'n bayraklanir).

## 1) UUID uret

```bash
npm install
npm run generate-id
# ornek cikti: 3afb889c-bc5d-4936-8c3b-3f3e0eb63a13
```

Bunu bir yere not et. Hem sunucuda hem telefonda ayni olacak.

## 2) GitHub'a yukle

```bash
git init
git add server.js package.json render.yaml .gitignore
git commit -m "notes sync"
# GitHub'da bos repo ac, sonra:
git remote add origin https://github.com/KULLANICIADIN/REPO.git
git push -u origin main
```

> `test-vless.js`, `generate-link.js`'i push'lamak zorunda degilsin ama zararsiz.

## 3) Render'a deploy

1. https://render.com 'da **ev internetinle** hesap ac (okul IP'siyle degil).
2. New > Web Service > Public Git Repository > repo URL'ni yapistir.
3. Ayarlar:
   - Region: Frankfurt (Turkiye'ye en dusuk ping)
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free
4. Environment > Add:
   - `APP_ID` = 1. adimdaki UUID
   - `WS_PATH` = `/notes-sync` (degistirirsen istemcide de ayni olmali)
5. Deploy. 2-3 dk bekle. Adresin: `https://SENIN-ISMIN.onrender.com`
6. Tarayicida ac: sahte not sayfasi gelmeli. `/health` -> `ok` demeli.

Render free notlari:

- 15 dk bos kalinca uyur, ilk baglanti ~50 sn surer. Cozum: UptimeRobot ile 10 dk'da bir `/health`'e ping at.
- Ayda ~100GB limit. Video izlersen cabuk biter, biterse silip yeni isimle redeploy et.
- Proxy kelimesi repo ismi/aciklamasinda gecmesin, Render askıya alabiliyor. Bu repo zaten masum isimli.

## 3b) Deno Deploy'a deploy (alternatif)

Node surumu (`server.js`) Deno'da calismaz -> Deno Deploy **503** verir.
Deno icin ayri bir giris noktasi var: `main.ts` (`Deno.serve` + `Deno.upgradeWebSocket` + `Deno.connect`).

GitHub baglantili app (console'da repo secili ise) icin: repoya `main.ts` + `deno.json`
pushlayin, otomatik deploy olur.

```bash
# deno.json -> {"deploy": {"entrypoint": "main.ts"}}  (zaten ekli)
deno deploy create \
  --org yenihesapp401 \
  --app vpnmeb \
  --source local \
  --runtime-mode dynamic --entrypoint main.ts \
  --build-timeout 5 --build-memory-limit 1024 --region eu
```

Link uretme:

```bash
node generate-link.js vpnmeb.yenihesapp401.deno.net SENIN-UUID /notes-sync
```

### Deno Deploy limitleri (okuman lazim)

| Konu | Durum |
|---|---|
| VLESS + WS + TCP | Calisir (`Deno.upgradeWebSocket` + `Deno.connect`) |
| UDP (DNS-over-UDP, Roblox oyun trafigi) | **Calismaz**: Deno 2.x stable'da UDP API'si yok (`Deno.udp` / `Deno.listenUDP` undefined) |
| 443'e ham TCP baglanti | Deno Deploy "TLS proxying" politikasi 443'e `Deno.connect` ile ham baglantiyi yasakliyor; HTTPS siteler engellenebilir |
| Kullanim politikasi | Deno Deploy AUP'inde **"Forward proxy"** ve **"VPN"** yasakli -> app/hesap kapatilabilir |

Sonuc: Deno Deploy okulda kalici cozum degil. **Render (free)** veya kendi VPS'in
(Contabo/Hetzner) daha saglam secenek; Render'da UDP de calisiyor.

## 4) Baglanti linki uret

```bash
node generate-link.js SENIN-ISMIN.onrender.com SENIN-UUID /notes-sync
```

Cikti ornegi:

```
vless://UUID@SENIN-ISMIN.onrender.com:443?encryption=none&security=tls&sni=SENIN-ISMIN.onrender.com&fp=chrome&type=ws&host=SENIN-ISMIN.onrender.com&path=%2Fnotes-sync#Render-MEB
```

## 5) Telefonda / Bilgisayarda kullan

**Android (onerilen): v2rayNG**

1. Play Store'dan `v2rayNG` kur (ev internetiyle indir, okula USB ile gotur).
2. Sag ust + > Import config from clipboard (linki kopyala).
3. 3 nokta > Update subscription degil, direkt listede cikana dokun > baglan.
4. Ayar: Route > Bypass LAN, Remote DNS: `8.8.8.8`, uTLS fingerprint: chrome, ALPN: http/1.1.
5. Baglaninca once `https://SENIN-ISMIN.onrender.com` aciliyor mu diye bak. Aciliyorsa SNI temiz demektir.

Alternatif Android: `NekoBox`, `Hiddify`, `DarkTunnel` (VLESS WS TLS destekler).

**Windows: v2rayN / NekoRay**

1. GitHub `2dust/v2rayN` son surumu indir.
2. Clipboard'tan import et, Enter'a bas (baglan).
3. Sistem proxy'si otomatik ayarlanir. Tarayicida dene.
4. Calismazsa: Ayar > Core > Xray > uTLS = chrome yap.

**iOS: Streisand / V2Box / Hiddify**

- Ayni linki QR yapip okut (v2rayN'de linke sag tik > QR).

## 6) Okulda test sirasi

1. Okul Wi-Fi'sine baglan, once VPN'siz `https://SENIN-ISMIN.onrender.com` aciliyor mu bak:
   - Aciliyorsa: domain temiz, VLESS calisir.
   - "FortiGuard engelledi" diyorsa: Render ismini degistirip redeploy et (`ders-notlarim-24` gibi), veya ozel domain bagla.
2. MEB sertifikasi yuklu mu kontrol et:
   - Kisisel telefon/laptop'ta **MEB sertifikasini kaldir**. Boylece okul dis TLS'i cozemeyip sadece SNI gorur (`...onrender.com`), icerigi goremez.
   - Sertifika kalirsa da VLESS cogunlukla calisir ama gizlilik azalir.
3. v2rayNG'de baglan, `1.1.1.1` DNS ile dene.
4. Baglanip 1 sn'de kopuyorsa: path/SNI yanlis ya da UUID uyusmuyor demektir. Render Logs'a bak (`APP_ID = ...` gorunuyor mu?).
5. Hic baglanmiyorsa: okul UDP'yi kapali tutuyor olabilir, client'ta `TCP only / mux` ac, WireGuard/OpenVPN deneme (onlar zaten calismaz).

## SNI ipucu (ileri seviye)

Bazi okullarda `*.onrender.com` proxy kategorisine alinmis oluyor. Cozumler:

- Render'a Cloudflare uzerinden ozel domain bagla (ornegin `notlar.ornek.com`), kategorisi temiz bir domain kullan.
- Bazi hazir config'ler `sni=api.whatsapp.net` kullaniyor cunku WhatsApp okulda acik. Render'da SNI domaininle ayni olmak zorunda (Render TLS'i SNI'ye gore yonlendiriyor), o yuzden bu hileyi Render'da yapamazsin. VPS'in olsa yapardin.
- Gerekirse Railway/Koyeb/Fly.io'ya ayni kodu at (hepsi WS destekler), hangisinin domaini aciksa onu kullan.

## Sorun giderme

| Belirti | Cozum |
|---|---|
| Render `suspended` | Repo ismi/aciklamasinda proxy/vpn gecmesin, UUID'yi herkese acik paylasma |
| `404` WS'de | `WS_PATH` sunucu+istemcide ayni mi? (`/notes-sync`) |
| `bad-id` kapanma | `APP_ID` iki tarafta birebir ayni mi? Tireler dahil |
| Uyku sonrası yavas | Normal, 1 dk bekle veya UptimeRobot ekle |
| DNS calismiyor | Client DNS'i `8.8.8.8` TCP yap, UDP'yi kapatma (sunucu UDP destekler) |
| Hizli kota bitmesi | Video/yukleme yapma, 100GB free limit |

## Guvenlik

- UUID'yi gizli tut, baskasi kullanirsa kotan biter + IP'n bayraklanir.
- Ayda bir `npm run generate-id` ile degistir (Render env + client linki guncelle).
- Loglarda hedef siteler tutulmaz, sadece baglanti/acilis logu var.

## Dosyalar

- `server.js` - VLESS+WS sunucu (Node/Render: TCP+UDP, auth, decoy sayfa)
- `main.ts` - ayni protokolun Deno (Deno Deploy) surumu
- `deno.json` - Deno task'lari + deploy entrypoint
- `package.json` - `ws` bagimliligi
- `render.yaml` - tek tik deploy
- `generate-link.js` - istemci link uretici
- `test-vless.js` - lokal test (`node test-vless.js`, `SERVER_CMD` ile sunucu degistirilebilir)
- `test-udp.js` / `test-udp-local.js` - UDP testleri
- `test-remote.js` - canli sunucuya (wss://) uctan uca test
