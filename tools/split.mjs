// Teilt die Spieldatei zum Bearbeiten in Module auf: Kopf, Stil (CSS), Oberfläche (HTML) und je Abschnitt
// des Skripts eine JS-Datei (Grenzen sind die Kommentare „// ---------- Name ----------“).
// tools/build.mjs setzt die Teile wieder zu genau einer Datei zusammen (byte-genau, siehe tests/module.mjs).
// Aufruf: node tools/split.mjs [index.html] [zielordner]
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export function splitHtml(html) {
  const parts = [];
  const cut = (name, from, to) => parts.push({ name, text: html.slice(from, to) });
  // Haupt-Stilblock: der erste <style>, der am Zeilenanfang steht (der im Skeleton steht mitten in Zeile 1)
  const styleOpen = html.search(/^<style>/m);
  const sStart = html.indexOf('\n', styleOpen) + 1;
  const sEnd = html.indexOf('</style>', sStart);
  const jOpen = html.lastIndexOf('<script>');
  const jStart = html.indexOf('\n', jOpen) + 1;
  const jEnd = html.indexOf('</script>', jOpen); // danach können noch <script type="text/plain"> mit Bibliotheken kommen
  if (styleOpen < 0 || sEnd < 0 || jOpen < sEnd || jEnd < jStart) throw new Error('Aufbau nicht erkannt (<style> / <script> fehlen)');
  cut('00-kopf.html', 0, sStart);
  cut('10-stil.css', sStart, sEnd);
  cut('20-oberflaeche.html', sEnd, jStart);
  const js = html.slice(jStart, jEnd);
  const re = /^\/\/ -{6,} (.+?) -{6,}$/gm;
  const marks = [0];
  const names = ['start'];
  for (let m; (m = re.exec(js));) { if (m.index > 0) { marks.push(m.index); names.push(m[1]); } }
  marks.push(js.length);
  const slug = t => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').slice(0, 3).join('-') || 'teil';
  for (let i = 0; i < marks.length - 1; i++) {
    const nr = String(30 + i).padStart(2, '0');
    cut(`${nr}-${slug(names[i])}.js`, jStart + marks[i], jStart + marks[i + 1]);
  }
  cut('99-ende.html', jEnd, html.length);
  return parts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [src = 'app/src/main/assets/index.html', dir = 'src'] = process.argv.slice(2);
  const parts = splitHtml(readFileSync(src, 'utf8'));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const p of parts) writeFileSync(join(dir, p.name), p.text);
  writeFileSync(join(dir, 'teile.json'), JSON.stringify(parts.map(p => p.name), null, 1) + '\n');
  console.log(`${parts.length} Teile in ${dir}/ geschrieben. Nach dem Bearbeiten: node tools/build.mjs`);
}
