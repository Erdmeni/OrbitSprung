// Setzt die Module aus src/ (Reihenfolge in src/teile.json) wieder zu einer Spieldatei zusammen.
// Aufruf: node tools/build.mjs [quellordner] [ziel]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function buildHtml(dir) {
  const names = JSON.parse(readFileSync(join(dir, 'teile.json'), 'utf8'));
  return names.map(n => readFileSync(join(dir, n), 'utf8')).join('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir = 'src', out = 'app/src/main/assets/index.html'] = process.argv.slice(2);
  const html = buildHtml(dir);
  writeFileSync(out, html);
  console.log(`Geschrieben: ${out} (${html.length} Zeichen aus ${dir}/)`);
}
