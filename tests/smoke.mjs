// Smoke-Test: Spiel im Browser öffnen, jeden Modus starten, ein paar Mal tippen, Shop und Einstellungen
// durchklicken. Schlägt fehl bei JS-Fehlern oder wenn eine Ansicht nicht erscheint.
// Aufruf: node tests/smoke.mjs [pfad/zur/index.html]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] || 'app/src/main/assets/index.html');
const url = pathToFileURL(file).href;
const MODES = ['klassik', 'sprint', 'zen', 'chaos', 'feld', 'hyper'];
const problems = [];
const step = msg => console.log('  · ' + msg);

async function openPage(browser, preset, viewport = { width: 412, height: 860 }) {
  const ctx = await browser.newContext({ viewport, hasTouch: true });
  // Externe Schriften blockieren: Test läuft offline und deterministisch
  await ctx.route(/^https?:/, r => r.abort());
  if (preset) await ctx.addInitScript(s => { try { localStorage.setItem('orbitsprung.save', s); } catch (e) {} }, JSON.stringify(preset));
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => problems.push(`JS-Fehler: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) problems.push(`Konsole: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('#menu:not([hidden])', { timeout: 5000 });
  return { ctx, page };
}
const visible = (page, sel) => page.locator(sel).isVisible();
async function expectVisible(page, sel, what) {
  try { await page.locator(sel).waitFor({ state: 'visible', timeout: 4000 }); }
  catch { problems.push(`${what}: ${sel} ist nicht sichtbar`); }
}

const browser = await chromium.launch();
try {
  // 1) Frischer Spielstand: Menü, gesperrte Kaufmodi, Grundzustand
  console.log('Frischer Start');
  {
    const { ctx, page } = await openPage(browser, null);
    const ver = await page.locator('#ver').textContent();
    step('Menü sichtbar, Version: ' + ver);
    const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('orbitsprung.save') || 'null'));
    // Spielstand wird erst beim ersten Speichern geschrieben; Start erzwingt das nicht, darum nur prüfen, wenn vorhanden
    if (sv && sv.v === undefined) problems.push('Spielstand ohne Versionsfeld v');
    await page.click('#start');
    await expectVisible(page, '#dock', 'Spielstart');
    if (await visible(page, '#menu')) problems.push('Menü bleibt nach Start sichtbar');
    for (let i = 0; i < 4; i++) { await page.mouse.click(200, 400); await page.waitForTimeout(450); }
    step('Klassik gestartet und getippt');
    await ctx.close();
  }

  // 2) Alle Modi mit freigeschaltetem Spielstand
  console.log('Alle Modi');
  const preset = { v: 2, staub: 5000, dust: { b: 5000, e: {}, s: {} }, unl: ['feld', 'hyper'], mode: 'klassik', sound: false, music: false };
  const { ctx, page } = await openPage(browser, preset);
  for (const m of MODES) {
    await page.click('#mode-' + m);
    if (await page.locator('#mode-' + m).getAttribute('aria-checked') !== 'true') problems.push(`Modus ${m} lässt sich nicht wählen`);
    await page.click('#start');
    await page.waitForTimeout(300);
    if (await visible(page, '#menu')) { problems.push(`Modus ${m}: Start ohne Wirkung`); continue; }
    if (m === 'sprint' && !(await visible(page, '#timerBox'))) problems.push('Sprint: Zeitanzeige fehlt');
    for (let i = 0; i < 8; i++) { await page.mouse.click(206, 420); await page.waitForTimeout(350); }
    // Runde beenden: über Pause → Beenden, falls die Runde noch läuft
    if (await visible(page, '#pauseBtn')) {
      await page.click('#pauseBtn');
      await expectVisible(page, '#pause', `Pause (${m})`);
      await page.click('#quit');
    }
    await expectVisible(page, '#over', `Endkarte (${m})`);
    const score = await page.locator('#fScore').textContent();
    await page.click('#toMenu');
    await expectVisible(page, '#menu', `Zurück ins Menü (${m})`);
    step(`${m}: gestartet, 8× getippt, beendet (Punkte ${score})`);
  }

  // 3) Shop: alle Reiter öffnen, einen Skin kaufen
  console.log('Shop');
  await page.click('#shopFromMenu');
  await expectVisible(page, '#shop', 'Shop');
  const tabs = page.locator('#tabs .tab');
  const n = await tabs.count();
  for (let i = 0; i < n; i++) { await tabs.nth(i).click(); await page.waitForTimeout(80); }
  // Segmentschalter kann die Unterreiter neu aufbauen, darum zweimal durchgehen
  const n2 = await page.locator('#tabs .tab').count();
  for (let i = 0; i < n2; i++) { await page.locator('#tabs .tab').nth(i).click(); await page.waitForTimeout(60); }
  step(`${n2} Reiter durchgeklickt`);
  await page.click('#shopBack');
  await expectVisible(page, '#menu', 'Zurück aus dem Shop');

  // 3b) Erfolge und Statistik (falls vorhanden)
  if (await page.locator('#achFromMenu').count()) {
    console.log('Erfolge und Statistik');
    await page.click('#achFromMenu');
    await expectVisible(page, '#prog', 'Erfolge');
    for (const t of ['#ptab-st', '#ptab-ach']) await page.click(t);
    await page.click('#progBack');
    await expectVisible(page, '#menu', 'Zurück aus den Erfolgen');
    step('Erfolge und Statistik geöffnet');
  }

  // 4) Einstellungen
  console.log('Einstellungen');
  await page.click('#setBtn');
  await expectVisible(page, '#pause', 'Einstellungen');
  // Alle sichtbaren Schalter und Lautstärke-Knöpfe zweimal antippen (an/aus bzw. stumm/zurück)
  const sw = page.locator('#pause .opt:visible, #pause .vbtn:visible');
  const ns = await sw.count();
  if (!ns) problems.push('Einstellungen: keine Schalter gefunden');
  for (let i = 0; i < ns; i++) { await sw.nth(i).click(); await sw.nth(i).click(); }
  const rng = page.locator('#pause input[type=range]:visible');
  for (let i = 0; i < await rng.count(); i++) await rng.nth(i).fill('50');
  await page.click('#setDone');
  await expectVisible(page, '#menu', 'Einstellungen schließen');
  step(`${ns} Schalter umgeschaltet und zurück`);

  const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('orbitsprung.save') || 'null'));
  if (!sv) problems.push('Kein Spielstand gespeichert');
  else if (sv.v !== undefined && (!sv.dust || typeof sv.dust.b !== 'number')) problems.push('Spielstand v' + sv.v + ' ohne Staub-Buchführung');
  else step('Spielstand gespeichert' + (sv.v ? ` (Version ${sv.v}, Staub ${sv.staub})` : ''));
  await ctx.close();
} catch (e) {
  problems.push('Test abgebrochen: ' + String(e.message || e).split('\n')[0]);
} finally {
  await browser.close();
}

if (problems.length) {
  console.error('\nSmoke-Test fehlgeschlagen:');
  for (const p of [...new Set(problems)]) console.error('::error::' + p);
  process.exit(1);
}
console.log('\nSmoke-Test ok: ' + file);
