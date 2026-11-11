// Prüft, dass Aufteilen in Module und Zusammensetzen die Spieldatei byte-genau erhält.
// Aufruf: node tests/module.mjs [pfad/zur/index.html]
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { splitHtml } from '../tools/split.mjs';
import { buildHtml } from '../tools/build.mjs';

const file = process.argv[2] || 'app/src/main/assets/index.html';
const html = readFileSync(file, 'utf8');
const parts = splitHtml(html);
const dir = mkdtempSync(join(tmpdir(), 'orbit-'));
try {
  for (const p of parts) writeFileSync(join(dir, p.name), p.text);
  writeFileSync(join(dir, 'teile.json'), JSON.stringify(parts.map(p => p.name)));
  const back = buildHtml(dir);
  if (back !== html) { console.error('::error::Module ergeben zusammengesetzt nicht dieselbe Datei'); process.exit(1); }
  const js = parts.filter(p => p.name.endsWith('.js'));
  if (js.length < 2) { console.error('::error::Skript wurde nicht in Abschnitte geteilt'); process.exit(1); }
  console.log(`Modul-Test ok: ${parts.length} Teile (${js.length} JS-Abschnitte), zusammengesetzt identisch`);
} finally { rmSync(dir, { recursive: true, force: true }); }
