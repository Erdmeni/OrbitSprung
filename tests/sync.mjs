// Sync-Test: zwei „Geräte“ (getrennte Browser-Kontexte) teilen sich eine nachgebaute Konto-Datenbank.
// Prüft Spielstand-Migration, Staub-Buchführung beim Offline-Spielen auf zwei Geräten und alte Spielstände ohne Buchführung.
// Läuft nur mit Spielversionen, die window.claude-Sync haben; sonst wird er übersprungen.
// Aufruf: node tests/sync.mjs [pfad/zur/index.html]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const file = resolve(process.argv[2] || 'app/src/main/assets/index.html');
const html = readFileSync(file, 'utf8');
if (!/window\.claude/.test(html) || !/SAVE_V/.test(html)) { console.log('Sync-Test übersprungen: Datei hat keinen Konto-Sync mit Spielstand-Version.'); process.exit(0); }
const testBuild = /const\s+TEST_BUILD\s*=\s*true/.test(html);
const SAVE_V = +((html.match(/const\s+SAVE_V\s*=\s*(\d+)/) || [])[1] || 2);

const problems = [];
const check = (ok, msg) => { console.log(`  ${ok ? '✓' : '✗'} ${msg}`); if (!ok) problems.push(msg); };
let cloud = null;            // der eine Dokument-Stand in der „Cloud“
const writes = [];

async function device(browser, name, preset) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
  await ctx.route(/^https?:/, r => r.abort());
  await ctx.exposeBinding('__dbGet', () => cloud);
  await ctx.exposeBinding('__dbSet', (_s, data) => { cloud = data; writes.push(name); });
  await ctx.addInitScript(([s]) => {
    if (s) try { localStorage.setItem('orbitsprung.save', s); } catch (e) {}
    let cb = null;
    window.__push = d => cb && cb({ exists: !!d, data: () => d });
    const ref = {
      get: async () => { const d = await window.__dbGet(); return { exists: !!d, data: () => d }; },
      set: async d => { await window.__dbSet(JSON.parse(JSON.stringify(d))); },
      onSnapshot: f => { cb = f; }
    };
    window.claude = { use: async n => n === 'user' ? { id: async () => 'nutzer1' } : { collection: () => ({ doc: () => ref }) } };
  }, [preset ? JSON.stringify(preset) : null]);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => problems.push(`${name}: JS-Fehler ${e.message}`));
  await page.goto(pathToFileURL(file).href);
  await page.waitForSelector('#menu:not([hidden])');
  await page.waitForTimeout(300);
  return { ctx, page, name };
}
const staub = d => d.page.locator('#staub').textContent().then(Number);
const saveOf = d => d.page.evaluate(() => JSON.parse(localStorage.getItem('orbitsprung.save')));
const push = (d, data = cloud) => d.page.evaluate(x => window.__push(x), data);
const settle = d => d.page.waitForTimeout(1500); // Sync schreibt gebündelt nach 1,2 s
// Kauft im Shop einen Kometen-Skin über die Oberfläche
async function buySkin(d, skinName) {
  await d.page.click('#shopFromMenu');
  await d.page.locator('#tabs .seg .tab', { hasText: 'Skins' }).click();
  await d.page.locator('#tabs .sub .tab').first().click();
  const before = await staub(d);
  const item = d.page.locator('#grid .item', { hasText: skinName });
  await item.click();
  // Kaufbestätigung: entweder Blatt mit „Kaufen“ (#confYes) oder zweiter Tipp auf den Eintrag
  if (await d.page.locator('#confYes').isVisible().catch(() => false)) await d.page.click('#confYes');
  else if (await staub(d) === before) await item.click();
  if (await staub(d) === before) throw new Error(`Kauf von ${skinName} auf Gerät ${d.name} hat nicht geklappt`);
  await d.page.click('#shopBack');
}

const browser = await chromium.launch();
try {
  console.log('1) Alter Spielstand (ohne Version) wird migriert');
  const A = await device(browser, 'A', { staub: 500, best: 42, bests: { klassik: 42 }, ownC: ['glut'], ownT: ['pastell'] });
  let sa = await saveOf(A);
  check(sa.v === SAVE_V, `Spielstand-Version ${SAVE_V} (ist ${sa.v})`);
  if (!testBuild) check(sa.dust && sa.dust.b === 500 && Object.keys(sa.dust.e).length === 0, 'Bisheriger Staub (500) liegt im Sockel der Buchführung');
  else check(sa.dust && sa.dust.b === 99999 && Object.keys(sa.dust.e).length === 0, 'Testversion füllt über den Sockel auf 99.999 auf');
  if (!testBuild) check(await staub(A) === 500, 'Anzeige zeigt 500 ✦');
  check(cloud && cloud.v === SAVE_V && cloud.dust, 'Gerät A hat den neuen Stand in die Cloud geschrieben');

  console.log('2) Zweites Gerät übernimmt den Stand');
  const B = await device(browser, 'B', null);
  const base = await staub(A);
  check(await staub(B) === base, `Gerät B zeigt denselben Staub (${await staub(B)} = ${base})`);

  if (!testBuild) {
    console.log('3) Beide Geräte kaufen offline, dann Abgleich');
    const cloudBefore = cloud;
    await buySkin(A, 'Eisschweif');          // 60 ✦
    await buySkin(B, 'Plasma');              // 120 ✦
    await settle(A); await settle(B);
    check(await staub(A) === base - 60 && await staub(B) === base - 120, `Offline: A ${await staub(A)}, B ${await staub(B)}`);
    // B hat zuletzt geschrieben und damit das Cloud-Dokument von A überschrieben (wie in echt bei set())
    check(cloud !== cloudBefore, 'Cloud wurde überschrieben');
    await push(A); await settle(A);          // A sieht B's Stand und muss seine eigene Ausgabe zurückschreiben
    await push(B); await settle(B);
    await push(A);
    const want = base - 180;
    check(await staub(A) === want, `Gerät A nach Abgleich: ${await staub(A)} (erwartet ${want})`);
    check(await staub(B) === want, `Gerät B nach Abgleich: ${await staub(B)} (erwartet ${want})`);
    const sb = await saveOf(B);
    check(sb.ownC.includes('eis') && sb.ownC.includes('plasma'), 'Beide gekauften Skins sind auf Gerät B');

    console.log('4) Alte App-Version schreibt Stand ohne Buchführung');
    const legacy = { staub: 1234, ts: Date.now() + 10000, bests: {}, ownC: ['glut'], ownT: ['pastell'] };
    await push(A, legacy);
    check(await staub(A) === 1234, `Gerät A übernimmt den neueren alten Stand: ${await staub(A)}`);
    const sa2 = await saveOf(A);
    check(sa2.dust && sa2.v === SAVE_V, 'Buchführung bleibt erhalten');
    await settle(A);
    await push(B, cloud);
    check(await staub(B) === 1234 || !cloud.dust, `Gerät B nach erneutem Abgleich: ${await staub(B)}`);

    console.log('5) Kein endloses Hin- und Herschreiben');
    const n = writes.length;
    await push(A); await push(B); await settle(A); await settle(B);
    check(writes.length - n <= 0, `Keine zusätzlichen Schreibvorgänge bei gleichem Stand (${writes.length - n})`);
  } else {
    console.log('(Testversion: Kauf-Szenarien übersprungen, weil TEST_BUILD alles freischaltet)');
  }
  await A.ctx.close(); await B.ctx.close();

  if (!testBuild && /checkAch/.test(html)) {
    console.log('6) Derselbe Erfolg auf zwei Geräten wird nur einmal belohnt');
    cloud = null;
    const legacy2 = { staub: 300, st: { planets: 1, runs: 1 }, bests: { klassik: 5 }, ownC: ['glut'], ownT: ['pastell'] };
    const C = await device(browser, 'C', legacy2);
    const D = await device(browser, 'D', legacy2);   // erreicht den Erfolg ebenfalls lokal, bevor es synchronisiert
    // Seit 1.6.1 werden Erfolge per Antippen eingelöst: auf beiden Geräten einlösen
    const claim = async d => {
      if (!/function claimAch/.test(html)) return;
      await d.page.click('#achFromMenu');
      for (let i = 0; i < 20 && await d.page.locator('#progBody button.claim').count(); i++) { await d.page.locator('#progBody button.claim').first().click(); await d.page.waitForTimeout(150); }
      await d.page.click('#progBack');
    };
    await claim(C); await claim(D);
    const reward = (await staub(C)) - 300;
    check(reward > 0, `Erfolg „Erster Fang“ gibt Belohnung (+${reward})`);
    await settle(C); await settle(D); await push(C); await settle(C); await push(D); await settle(D); await push(C);
    check(await staub(C) === 300 + reward && await staub(D) === 300 + reward, `Nach Abgleich: C ${await staub(C)}, D ${await staub(D)} (erwartet ${300 + reward})`);
    await C.ctx.close(); await D.ctx.close();
  }
} catch (e) {
  problems.push('Test abgebrochen: ' + String(e.message || e).split('\n')[0]);
} finally {
  await browser.close();
}
if (problems.length) { console.error('\nSync-Test fehlgeschlagen:'); for (const p of problems) console.error('::error::' + p); process.exit(1); }
console.log('\nSync-Test ok');
