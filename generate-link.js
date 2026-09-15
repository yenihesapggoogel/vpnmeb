/* Baglanti linki uretici
 * Kullanim: node generate-link.js <uygulama-adin>.onrender.com <UUID> [path]
 * Ornek: node generate-link.js benim-notlarim.onrender.com 6be3e1b2-05e1-46a1-ad36-70aaabaa8d12 /notes-sync
 */
const domain = process.argv[2];
const uuid = process.argv[3];
const path = process.argv[4] || '/notes-sync';

if (!domain || !uuid) {
  console.log('Kullanim: node generate-link.js <app>.onrender.com <UUID> [path]');
  process.exit(1);
}

const encPath = encodeURIComponent(path);
const name = encodeURIComponent('Render-MEB');
const link = `vless://${uuid}@${domain}:443?encryption=none&security=tls&sni=${domain}&fp=chrome&type=ws&host=${domain}&path=${encPath}#${name}`;

console.log('\n=== v2rayNG / v2rayN / Hiddify / Streisand icin link ===\n');
console.log(link);
console.log('\n=== Manuel ayar ===');
console.log('Adres      :', domain);
console.log('Port       : 443');
console.log('UUID       :', uuid);
console.log('Sifreleme  : none');
console.log('Ag (network): ws');
console.log('Path       :', path);
console.log('TLS        : tls');
console.log('SNI        :', domain);
console.log('Host       :', domain);
console.log('Fingerprint: chrome');
console.log('ALPN       : http/1.1');
console.log('\nBu linki kopyalayip v2rayNG (Android) > + > Import from clipboard ile ice aktarin.');
console.log('Windows: v2rayN > + > Import from clipboard.');
