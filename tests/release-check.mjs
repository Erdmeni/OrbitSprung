// Prüft die Spieldatei, bevor eine APK gebaut wird. Bricht mit Fehlercode ab, wenn eine Testversion
// (TEST_BUILD=true, „alles freigeschaltet“, Test-Titel) im Repo gelandet ist.
// Aufruf: node tests/release-check.mjs [pfad/zur/index.html]
import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'app/src/main/assets/index.html';
const html = readFileSync(file, 'utf8');
const errors = [];
const fail = msg => errors.push(msg);

// Kommentare entfernen, damit ein erklärender Kommentar keinen Fehlalarm auslöst
const code = html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

if (/TEST_BUILD\s*=\s*(true|!0|1)\b/.test(code)) fail('TEST_BUILD ist eingeschaltet. Für die App muss es `const TEST_BUILD=false;` sein.');
if (/TEST_BUILD/.test(code) && !/const\s+TEST_BUILD\s*=\s*false\s*;/.test(code)) fail('`const TEST_BUILD=false;` fehlt, obwohl TEST_BUILD im Code vorkommt.');
if (/alles freigeschaltet/i.test(code)) fail('Menütext enthält noch „alles freigeschaltet“ (Testversion).');
const title = (code.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
if (!title) fail('Kein <title> gefunden.');
if (/test/i.test(title)) fail(`Titel „${title}“ sieht nach Testversion aus.`);
if (!/^<!doctype html>/i.test(html.trimStart())) fail('Datei beginnt nicht mit <!doctype html> (Skeleton-Zeile fehlt).');
if (!/<\/html>\s*$/i.test(html)) fail('Datei endet nicht mit </html>.');
// Versionsnummer: APP_VERSION (Update-Prüfung, Release-Tag) und Menütext müssen übereinstimmen
const appVer = (code.match(/const\s+APP_VERSION\s*=\s*'([^']*)'/) || [])[1];
const menuVer = ((code.match(/<div class="ver" id="ver">([^<]*)<\/div>/) || [])[1] || '').match(/\d+(?:\.\d+)+/);
if (!appVer) fail("`const APP_VERSION='x.y.z';` fehlt.");
else if (!/^\d+(\.\d+)+$/.test(appVer)) fail(`APP_VERSION „${appVer}“ ist keine Versionsnummer wie 1.5.1.`);
else if (!menuVer || menuVer[0] !== appVer) fail(`Menütext #ver (${menuVer ? menuVer[0] : 'ohne Nummer'}) passt nicht zu APP_VERSION ${appVer}.`);
if ((code.match(/<script>/g) || []).length !== (code.match(/<\/script>/g) || []).length) fail('<script>-Tags sind nicht ausgeglichen.');

if (errors.length) {
  for (const e of errors) console.error('::error file=' + file + '::' + e);
  console.error(`\n${errors.length} Problem(e) in ${file}. Keine APK bauen.`);
  process.exit(1);
}
console.log(`Release-Prüfung ok: ${file} (Titel „${title}“, Version ${appVer})`);
