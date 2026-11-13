// Selbst-Update in der Android-App: window.OrbitUpdate (AppUpdater.java) wird im Browser nachgebildet,
// die GitHub-Antwort simuliert. Prüft Knöpfe und Texte in jedem Schritt (Erlaubnis, Laden, Prüfen,
// Android-Bestätigung, Fehler, Abbruch), dass nur APKs aus dem eigenen Release angeboten werden,
// den Knopf „Nach Updates suchen“ in den Einstellungen und dass alles aufs Handy passt.
// Aufruf: node tests/selbstupdate.mjs [pfad/zur/index.html]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';

const file = resolve(process.argv[2] || 'app/src/main/assets/index.html');
const url = pathToFileURL(file).href;
const APP = (readFileSync(file, 'utf8').match(/const\s+APP_VERSION\s*=\s*'([^']*)'/) || [])[1];
if (!APP) { console.error('APP_VERSION fehlt'); process.exit(1); }
const p = APP.split('.').map(Number); while (p.length < 3) p.push(0); p[2]++;
const NEXT = p.join('.');
const DL = `https://github.com/Erdmeni/OrbitSprung/releases/download/v${NEXT}/Orbitsprung.apk`;
const SHOTS = process.env.SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const problems = [];
const step = msg => console.log('  · ' + msg);
const check = (ok, msg) => { if (!ok) problems.push(msg); };

// Nachbildung der App-Schnittstelle: merkt sich Aufrufe, Antworten schickt der Test über updNative
const BRIDGE = () => {
  window.__calls = [];
  window.OrbitUpdate = {
    verfuegbar: () => true,
    erlaubt: () => !!window.__erlaubt,
    version: () => '',
    starten(u, v) { window.__calls.push(['starten', u, v]); },
    erlaubnisOeffnen() { window.__calls.push(['erlaubnis']); },
    abbrechen() { window.__calls.push(['abbrechen']); }
  };
};

// assets: Liste der Release-Dateien; tag: Release-Tag; mode 'offline' = Verbindung bricht ab
async function open(browser, { tag = 'v' + NEXT, assets, bridge = true, mode, viewport, ctx } = {}) {
  ctx = ctx || await browser.newContext({ viewport: viewport || { width: 412, height: 860 }, hasTouch: true });
  if (bridge) await ctx.addInitScript(BRIDGE);
  const answer = { tag, assets: assets || [{ name: 'Orbitsprung.apk', browser_download_url: DL }], mode };
  await ctx.unroute(/^https?:/).catch(() => {});
  await ctx.route(/^https?:/, async r => {
    if (!r.request().url().startsWith('https://api.github.com/')) return r.abort();
    if (answer.mode === 'offline') return r.abort('internetdisconnected');
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ tag_name: answer.tag, html_url: 'https://github.com/Erdmeni/OrbitSprung/releases/tag/' + answer.tag,
        body: '## Neu\n- Selbst-Update', draft: false, prerelease: false, assets: answer.assets }) });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => problems.push(`JS-Fehler: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) problems.push(`Konsole: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('#menu:not([hidden])', { timeout: 5000 });
  return { ctx, page, answer };
}
const vis = (page, sel) => page.locator(sel).isVisible();
const txt = (page, sel) => page.locator(sel).innerText();
const calls = page => page.evaluate(() => window.__calls);
const nat = (page, ph, pct = 0, msg = '') => page.evaluate(a => window.updNative(...a), [ph, pct, msg]);
const waitUpd = async page => { await page.locator('#upd').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); return vis(page, '#upd'); };
async function fits(page, name, vp) {
  await page.waitForTimeout(300);   // Einblend-Animation abwarten
  const b = await page.locator('#upd .card').boundingBox();
  check(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width + 1 && b.y + b.height <= vp.height + 1, `Hinweis ragt aus dem Bild (${name})`);
  for (const id of ['#updNo', '#updNow', '#updGo']) {
    if (!(await vis(page, id))) continue;
    const bb = await page.locator(id).boundingBox();
    check(bb && bb.height >= 40 && bb.y + bb.height <= vp.height + 1, `${id} zu klein oder außerhalb (${name})`);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const browser = await chromium.launch();
try {
  console.log(`Spielversion ${APP}, simuliertes Update ${NEXT}`);
  // 1) In der App mit APK im Release: „Jetzt aktualisieren“ statt Download-Link
  {
    const vp = { width: 360, height: 640 };
    const { ctx, page } = await open(browser, { viewport: vp });
    check(await waitUpd(page), 'Kein Hinweis in der App');
    check(await vis(page, '#updNow') && !(await vis(page, '#updGo')), 'App: „Jetzt aktualisieren“ fehlt oder Download-Link sichtbar');
    check((await txt(page, '#updNow')) === 'Jetzt aktualisieren', 'Knopftext falsch');
    check(!(await txt(page, '#updTxt')).includes('Obtainium'), 'App-Text erwähnt Obtainium');
    check(!(await vis(page, '#updProg')), 'Fortschritt vorab sichtbar');
    await fits(page, '1-hinweis', vp);
    step('App: Hinweis mit „Jetzt aktualisieren“');

    // Erlaubnis fehlt → „Erlaubnis geben“ öffnet die Android-Einstellung
    await page.click('#updNow');
    let c = await calls(page);
    check(c.length === 1 && c[0][0] === 'starten' && c[0][1] === DL && c[0][2] === NEXT, `starten falsch aufgerufen: ${JSON.stringify(c)}`);
    await nat(page, 'erlaubnis');
    check((await txt(page, '#updNow')) === 'Erlaubnis geben', 'Erlaubnis: Knopftext falsch');
    check((await txt(page, '#updStat')).includes('Aus dieser Quelle zulassen'), 'Erlaubnis: Erklärung fehlt');
    check(!(await vis(page, '#updSkip')), 'Erlaubnis: Haken noch sichtbar');
    check(!(await vis(page, '#updBarW')), 'Erlaubnis: Fortschrittsbalken sichtbar');
    await fits(page, '2-erlaubnis', vp);
    await page.click('#updNow');
    c = await calls(page);
    check(c.length === 2 && c[1][0] === 'erlaubnis', 'Erlaubnis geben ruft erlaubnisOeffnen nicht auf');
    await nat(page, 'erlaubnis', 0, 'fehlt');
    check((await txt(page, '#updStat')).startsWith('Die Erlaubnis fehlt noch'), 'Erlaubnis abgelehnt: kein Hinweis');
    step('Erlaubnis: Erklärung, „Erlaubnis geben“ öffnet Einstellung, Hinweis wenn sie fehlt');

    // Laden mit Fortschritt
    await nat(page, 'laden', -1);
    check(await page.locator('#updBarW').evaluate(e => e.classList.contains('wait')), 'Laden ohne Größe: kein Warte-Balken');
    for (const pct of [0, 42, 100]) {
      await nat(page, 'laden', pct);
      check((await txt(page, '#updStat')).includes(pct + ' %'), `Laden: ${pct} % fehlt`);
      const w = await page.locator('#updBar').evaluate(e => e.style.width);
      check(w === pct + '%', `Balken ${w} statt ${pct}%`);
    }
    check(!(await vis(page, '#updNow')) && (await txt(page, '#updNo')) === 'Abbrechen', 'Laden: Knöpfe falsch');
    await nat(page, 'laden', 42);
    await fits(page, '3-laden', vp);
    await nat(page, 'pruefen', 100);
    check((await txt(page, '#updStat')).includes('geprüft'), 'Prüfen: Text fehlt');
    await nat(page, 'installieren', 100);
    await nat(page, 'bestaetigen', 100);
    check((await txt(page, '#updStat')).includes('Aktualisieren') && (await txt(page, '#updNo')) === 'Schließen', 'Bestätigen: Text/Knopf falsch');
    check(!(await vis(page, '#updNow')) && !(await vis(page, '#updGo')), 'Bestätigen: unnötige Knöpfe sichtbar');
    await fits(page, '4-bestaetigen', vp);
    await nat(page, 'fertig', 100);
    check((await txt(page, '#updStat')).includes('installiert'), 'Fertig: Text fehlt');
    step('Laden 0 → 42 → 100 %, Prüfen, Android-Bestätigung, fertig');

    // Fehler → „Noch einmal“ und „Im Browser“
    await nat(page, 'fehler', 0, 'Keine Verbindung zu GitHub.');
    check((await txt(page, '#updStat')).startsWith('Keine Verbindung zu GitHub.'), 'Fehler: Text fehlt');
    check(await page.locator('#updStat').evaluate(e => e.classList.contains('bad')), 'Fehler: nicht hervorgehoben');
    check((await txt(page, '#updNow')) === 'Noch einmal' && await vis(page, '#updGo') && (await txt(page, '#updGo')) === 'Im Browser', 'Fehler: Knöpfe falsch');
    check(await page.locator('#updGo').getAttribute('href') === 'https://github.com/Erdmeni/OrbitSprung/releases/tag/v' + NEXT, 'Fehler: Browser-Link falsch');
    await fits(page, '5-fehler', vp);
    await page.click('#updNow');
    c = await calls(page);
    check(c[c.length - 1][0] === 'starten', '„Noch einmal“ startet nicht neu');
    step('Fehler: Text, „Noch einmal“ startet neu, „Im Browser“ als Ausweg');

    // Abbrechen während des Ladens
    await nat(page, 'laden', 10);
    await page.click('#updNo');
    c = await calls(page);
    check(c[c.length - 1][0] === 'abbrechen', 'Abbrechen ruft abbrechen() nicht auf');
    check(!(await vis(page, '#upd')), 'Abbrechen schließt den Hinweis nicht');
    await nat(page, 'abgebrochen');   // spätere Meldung der App darf nichts mehr anzeigen
    check(!(await vis(page, '#upd')), 'Späte Meldung öffnet den Hinweis wieder');
    await page.click('#start'); await page.waitForTimeout(300);
    check(!(await vis(page, '#menu')), 'Nach Abbrechen startet das Spiel nicht');
    step('Abbrechen beim Laden: App wird informiert, Spiel startet normal');
    await ctx.close();
  }
  // 2) Abbruch im Android-Fenster → zurück zur Ausgangslage mit Hinweis
  {
    const { ctx, page } = await open(browser);
    await waitUpd(page);
    await page.click('#updNow'); await nat(page, 'laden', 50); await nat(page, 'bestaetigen', 100); await nat(page, 'abgebrochen');
    check((await txt(page, '#updStat')).includes('abgebrochen') && (await txt(page, '#updNow')) === 'Noch einmal', 'Android-Abbruch: Text/Knopf falsch');
    check(await vis(page, '#updSkip') && (await txt(page, '#updNo')) === 'Später', 'Android-Abbruch: Haken oder „Später“ fehlt');
    await page.keyboard.press('Escape');
    check(!(await vis(page, '#upd')), 'Escape schließt nicht');
    step('Abbruch im Android-Fenster: „Noch einmal“ oder „Später“');
    await ctx.close();
  }
  // 3) Nur eigene APKs: fremde Adresse, kein APK oder keine App → normaler Download-Hinweis
  for (const [name, opt] of [
    ['ohne APK im Release', { assets: [{ name: 'quellcode.zip', browser_download_url: DL.replace('.apk', '.zip') }] }],
    ['APK von fremder Adresse', { assets: [{ name: 'Orbitsprung.apk', browser_download_url: 'https://example.com/Orbitsprung.apk' }] }],
    ['APK aus fremdem Repo', { assets: [{ name: 'Orbitsprung.apk', browser_download_url: 'https://github.com/Fremd/OrbitSprung/releases/download/v9/Orbitsprung.apk' }] }],
    ['Browser ohne App', { bridge: false }]
  ]) {
    const { ctx, page } = await open(browser, opt);
    check(await waitUpd(page), `Kein Hinweis (${name})`);
    check(!(await vis(page, '#updNow')) && await vis(page, '#updGo') && (await txt(page, '#updGo')) === 'Zum Download', `${name}: falsche Knöpfe`);
    check((await txt(page, '#updTxt')).includes('Obtainium'), `${name}: alter Hinweistext fehlt`);
    step(`${name}: nur Download-Link`);
    await ctx.close();
  }
  // 4) Einstellungen: „Nach Updates suchen“
  {
    const vp = { width: 360, height: 640 };
    // gleiche Version → „neueste Version“
    let { ctx, page, answer } = await open(browser, { tag: 'v' + APP, viewport: vp });
    await page.waitForTimeout(1200);
    await page.click('#setBtn');
    check(await vis(page, '#optUpd'), 'Knopf „Nach Updates suchen“ fehlt in den Einstellungen');
    check((await txt(page, '#optUpdTxt')) === 'Version ' + APP, `Versionsanzeige falsch: ${await txt(page, '#optUpdTxt')}`);
    await page.click('#optUpd'); await page.waitForTimeout(600);
    check((await txt(page, '#optUpdTxt')).includes('neueste Version'), `Gleiche Version: ${await txt(page, '#optUpdTxt')}`);
    // ohne Netz
    answer.mode = 'offline';
    await page.click('#optUpd'); await page.waitForTimeout(600);
    check((await txt(page, '#optUpdTxt')).includes('Keine Verbindung'), `Ohne Netz: ${await txt(page, '#optUpdTxt')}`);
    // neue Version, obwohl „nicht mehr anzeigen“ gesetzt ist → Hinweis über den Einstellungen
    answer.mode = undefined; answer.tag = 'v' + NEXT;
    await page.evaluate(t => localStorage.setItem('orbitsprung.updSkip', t), 'v' + NEXT);
    await page.click('#optUpd');
    check(await waitUpd(page), 'Manuelle Suche zeigt neue Version trotz „nicht mehr anzeigen“ nicht');
    check((await txt(page, '#optUpdTxt')).includes(NEXT), 'Knopf nennt neue Version nicht');
    await fits(page, '6-einstellungen', vp);
    const top = await page.evaluate(() => { const r = document.getElementById('updNow').getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e && e.id; });
    check(top === 'updNow', `Hinweis liegt nicht über den Einstellungen (oben: ${top})`);
    await page.click('#updNo');
    check(await vis(page, '#pause'), 'Nach Schließen sind die Einstellungen weg');
    step('Einstellungen: Version, „neueste Version“, ohne Netz, neue Version trotz Haken');
    // Pausenmenü: Knopf nicht sichtbar
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.click('#start'); await page.waitForTimeout(400);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    if (await vis(page, '#pause')) check(!(await vis(page, '#optUpd')), 'Knopf im Pausenmenü sichtbar');
    step('Pausenmenü: kein Update-Knopf');
    await ctx.close();
  }
  // 5) Querformat: Hinweis mit Fortschritt passt
  {
    const vp = { width: 1366, height: 768 };
    const { ctx, page } = await open(browser, { viewport: vp });
    await waitUpd(page); await page.click('#updNow'); await nat(page, 'fehler', 0, 'Nicht genug Speicherplatz für das Update.');
    await fits(page, '7-querformat', vp);
    step('Querformat: passt ins Bild');
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (problems.length) { for (const p of problems) console.error('::error::' + p); process.exit(1); }
console.log('Selbst-Update-Test ok');
