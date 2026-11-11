// Macht aus der HTML-Datei des Test-Artefakts die Spieldatei der App:
// Skeleton-Zeile der App davor, TEST_BUILD=false, Titel „Orbitsprung“, Menütext ohne „Tests“ und „alles freigeschaltet“.
// Aufruf: node tools/release.mjs <artefakt.html> [versionstext] [ziel]
//   z. B. node tools/release.mjs ~/Downloads/orbitsprung-tests.html 1.5
import { readFileSync, writeFileSync } from 'node:fs';

const [src, version = '', out = 'app/src/main/assets/index.html'] = process.argv.slice(2);
if (!src) { console.error('Aufruf: node tools/release.mjs <artefakt.html> [versionstext] [ziel]'); process.exit(2); }
const SKELETON = '<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,"Segoe UI",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style></head><body>';

let s = readFileSync(src, 'utf8').replace(/\r\n/g, '\n');
// Skeleton des Artefakts (erste Zeile bis einschließlich <body>) entfernen, falls vorhanden
s = s.replace(/^\s*<!doctype html>[\s\S]*?<body[^>]*>\s*/i, '');
s = s.replace(/\s*<\/body>\s*<\/html>\s*$/i, '');
const n = (re, to, what) => { if (!re.test(s)) { console.error('Nicht gefunden: ' + what); process.exit(1); } s = s.replace(re, to); };
n(/const\s+TEST_BUILD\s*=\s*(true|false)\s*;/, 'const TEST_BUILD=false;', 'const TEST_BUILD=…;');
n(/<title>[^<]*<\/title>/, '<title>Orbitsprung</title>', '<title>');
n(/(<div class="ver" id="ver">)[^<]*(<\/div>)/, `$1Orbitsprung${version ? ' ' + version : ''}$2`, 'Menütext #ver');
writeFileSync(out, SKELETON + s.replace(/^\n+/, '') + '\n</body></html>');
console.log(`Geschrieben: ${out}${version ? ' (Version ' + version + ')' : ''}`);
