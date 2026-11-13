// Update-Hinweis: GitHub-Antwort wird simuliert. Prüft neuere/gleiche/ältere Version, Ignorieren,
// „nicht mehr anzeigen“ (nur für genau diese Version), ohne Netz, Fehlerantwort und Hinweis während einer Runde.
// Aufruf: node tests/update.mjs [pfad/zur/index.html]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const file = resolve(process.argv[2] || 'app/src/main/assets/index.html');
const url = pathToFileURL(file).href;
const APP = (readFileSync(file, 'utf8').match(/const\s+APP_VERSION\s*=\s*'([^']*)'/) || [])[1];
if (!APP) { console.error('APP_VERSION fehlt'); process.exit(1); }
// Zweistellige Versionen (z. B. 1.6) auf drei Stellen auffüllen, sonst wäre die „nächste“ Version 1.6 selbst
const bump = (v, i) => { const p = v.split('.').map(Number); while (p.length < 3) p.push(0); return p.map((x, k) => k === i ? x + 1 : k > i ? 0 : x).join('.'); };
const NEXT = bump(APP, 2), NEXT2 = bump(APP, 1);
const problems = [];
const step = msg => console.log('  · ' + msg);
const check = (ok, msg) => { if (!ok) problems.push(msg); };

// mode: 'tag' (Antwort mit Tag), 'offline' (Verbindung bricht ab), 'err' (HTTP 403), 'slow' (Antwort nach ms)
async function open(browser, ctx, answer, { viewport } = {}) {
  ctx = ctx || await browser.newContext({ viewport: viewport || { width: 412, height: 860 }, hasTouch: true });
  await ctx.unroute(/^https?:/).catch(() => {});
  let calls = 0;
  await ctx.route(/^https?:/, async r => {
    if (!r.request().url().startsWith('https://api.github.com/')) return r.abort();
    calls++;
    if (answer.mode === 'offline') return r.abort('internetdisconnected');
    if (answer.mode === 'err') return r.fulfill({ status: 403, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"rate limit"}' });
    if (answer.delay) await new Promise(res => setTimeout(res, answer.delay));
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ tag_name: answer.tag, html_url: 'https://github.com/Erdmeni/OrbitSprung/releases/tag/' + answer.tag, body: '## Neu\n- **Update-Hinweis** beim Start\n- Pause-Knopf mittig', draft: false, prerelease: !!answer.pre }) });
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', e => problems.push(`JS-Fehler: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|403/.test(m.text())) problems.push(`Konsole: ${m.text()}`); });
  await page.goto(url);
  await page.waitForSelector('#menu:not([hidden])', { timeout: 5000 });
  return { ctx, page, calls: () => calls };
}
const updVisible = async (page, wait = 1800) => { await page.waitForTimeout(wait); return page.locator('#upd').isVisible(); };

const browser = await chromium.launch();
try {
  console.log(`Spielversion ${APP}, simuliert: ${NEXT}, ${NEXT2}`);
  // 1) Gleiche und ältere Version, Vorabversion, kaputter Tag: kein Hinweis
  for (const [tag, pre] of [['v' + APP, false], ['v1.4', false], ['v' + NEXT, true], ['nightly', false]]) {
    const { ctx, page, calls } = await open(browser, null, { tag, pre });
    check(!(await updVisible(page)), `Hinweis erscheint fälschlich bei ${tag}${pre ? ' (Vorabversion)' : ''}`);
    check(calls() === 1, `Update-Prüfung lief ${calls()}× statt 1× (${tag})`);
    step(`${tag}${pre ? ' (Vorabversion)' : ''}: kein Hinweis`);
    await ctx.close();
  }
  // 2) Ohne Netz und bei Fehlerantwort: kein Hinweis, Spiel startet normal
  for (const mode of ['offline', 'err']) {
    const { ctx, page } = await open(browser, null, { mode });
    check(!(await updVisible(page)), `Hinweis erscheint ${mode}`);
    await page.click('#start'); await page.waitForTimeout(300);
    check(!(await page.locator('#menu').isVisible()), `Spiel startet ${mode} nicht`);
    step(`${mode === 'offline' ? 'Ohne Netz' : 'HTTP 403'}: kein Hinweis, Spiel startet`);
    await ctx.close();
  }
  // 3) Neuere Version: Hinweis, Inhalt, Antippen dahinter startet nichts, Ignorieren, beim nächsten Start wieder da
  {
    const { ctx, page } = await open(browser, null, { tag: 'v' + NEXT });
    check(await updVisible(page), `Kein Hinweis bei neuerer Version ${NEXT}`);
    const txt = await page.locator('#upd').innerText();
    check(txt.includes(NEXT) && txt.includes(APP), 'Hinweis nennt nicht beide Versionen');
    check(txt.includes('Update-Hinweis beim Start') && !txt.includes('**'), 'Release-Text fehlt oder Markdown nicht bereinigt');
    check(await page.locator('#updGo').getAttribute('href') === 'https://github.com/Erdmeni/OrbitSprung/releases/tag/v' + NEXT, 'Download-Link falsch');
    check(await page.locator('#updSkip').getAttribute('aria-checked') === 'false', 'Haken ist vorab gesetzt');
    await page.mouse.click(20, 20); await page.keyboard.press('Space'); await page.waitForTimeout(300);
    check(await page.locator('#menu').isVisible() && await page.locator('#upd').isVisible(), 'Tippen/Leertaste neben dem Hinweis startet das Spiel');
    await page.click('#updNo');
    check(!(await page.locator('#upd').isVisible()), 'Ignorieren schließt den Hinweis nicht');
    await page.click('#start'); await page.waitForTimeout(300);
    check(!(await page.locator('#menu').isVisible()), 'Nach Ignorieren startet das Spiel nicht');
    step('Neuere Version: Hinweis mit beiden Versionen und Release-Text, Ignorieren, Spiel startet');
    await page.reload(); await page.waitForSelector('#menu:not([hidden])');
    check(await updVisible(page), 'Nach Ignorieren ohne Haken fehlt der Hinweis beim nächsten Start');
    // Escape schließt ebenfalls
    await page.keyboard.press('Escape');
    check(!(await page.locator('#upd').isVisible()), 'Escape schließt den Hinweis nicht');
    step('Ohne Haken: beim nächsten Start wieder da, Escape schließt');
    // 4) Haken setzen → bei derselben Version nicht mehr, bei der nächsten wieder (Haken leer)
    await page.reload(); await page.waitForSelector('#menu:not([hidden])');
    check(await updVisible(page), 'Hinweis fehlt vor dem Haken-Test');
    await page.click('#updSkip');
    check(await page.locator('#updSkip').getAttribute('aria-checked') === 'true', 'Haken lässt sich nicht setzen');
    await page.click('#updNo');
    await page.reload(); await page.waitForSelector('#menu:not([hidden])');
    check(!(await updVisible(page)), 'Hinweis erscheint trotz „nicht mehr anzeigen“');
    step(`Haken bei ${NEXT}: Hinweis bleibt weg`);
    const { page: p2 } = await open(browser, ctx, { tag: 'v' + NEXT2 });
    check(await updVisible(p2), `Hinweis fehlt bei der nächsten Version ${NEXT2} trotz Haken bei ${NEXT}`);
    check(await p2.locator('#updSkip').getAttribute('aria-checked') === 'false', 'Haken ist bei der nächsten Version noch gesetzt');
    step(`Nächste Version ${NEXT2}: Hinweis wieder da, Haken leer`);
    await ctx.close();
  }
  // 5) Antwort kommt erst während einer Runde: nicht mitten im Spiel, erst auf der Endkarte
  {
    const { ctx, page } = await open(browser, null, { tag: 'v' + NEXT, delay: 1500 });
    await page.click('#start');
    for (let i = 0; i < 3; i++) { await page.mouse.click(206, 420); await page.waitForTimeout(400); }
    const playing = await page.evaluate(() => !document.getElementById('dock').hidden && document.getElementById('over').hidden);
    if (playing) check(!(await updVisible(page, 600)), 'Hinweis erscheint mitten in der Runde');
    if (await page.locator('#pauseBtn').isVisible()) { await page.click('#pauseBtn'); await page.click('#quit'); }
    await page.locator('#over').waitFor({ state: 'visible' });
    check(await updVisible(page, 1800), 'Hinweis erscheint nach der Runde nicht');
    await page.click('#updNo');
    step('Antwort während der Runde: Hinweis erst auf der Endkarte');
    await ctx.close();
  }
  // 6) Handy-Format klein und PC: Hinweis passt ins Bild, Knöpfe erreichbar
  for (const [name, vp] of [['Handy 360×640', { width: 360, height: 640 }], ['PC 1366×768', { width: 1366, height: 768 }]]) {
    const { ctx, page } = await open(browser, null, { tag: 'v' + NEXT }, { viewport: vp });
    check(await updVisible(page), `Kein Hinweis (${name})`);
    const b = await page.locator('#upd .card').boundingBox();
    check(b && b.x >= 0 && b.y >= 0 && b.x + b.width <= vp.width && b.y + b.height <= vp.height, `Hinweis ragt aus dem Bild (${name})`);
    for (const id of ['#updNo', '#updGo', '#updSkip']) {
      const bb = await page.locator(id).boundingBox();
      check(bb && bb.height >= 40 && bb.y + bb.height <= vp.height, `${id} zu klein oder außerhalb (${name})`);
    }
    await page.screenshot({ path: `/tmp/upd-${vp.width}.png` }).catch(() => {});
    step(`${name}: Hinweis passt ins Bild`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (problems.length) { for (const p of problems) console.error('::error::' + p); process.exit(1); }
console.log('Update-Test ok');
