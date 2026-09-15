# Ders Notlari Sync (Render + VLESS-WS-TLS)

Kisisel not senkron servisi gorunumu altinda calisan, MEB/Fatih gibi sadece `TCP 80/443 + HTTPS`'e izin veren filtreli aglarda sansuru asmak icin tasarlanmis ozel VLESS-over-WebSocket sunucusu.

> Test edildi: `node test-vless.js` ile TCP proxy + UUID auth dogrulandi.

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

- `server.js` - VLESS+WS sunucu (TCP+UDP, auth, decoy sayfa)
- `package.json` - `ws` bagimliligi
- `render.yaml` - tek tik deploy
- `generate-link.js` - istemci link uretici
- `test-vless.js` - lokal test (`node test-vless.js`)
