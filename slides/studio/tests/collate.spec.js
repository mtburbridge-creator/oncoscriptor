/*
 * Collate tab — headless test suite.
 *
 * Covers the checks in docs/COLLATE_TAB_PLAN.md §6 and §9.5 that can run
 * without a human: slide ordering, image ingestion, the dynamic-N deck build,
 * retroactive bake quality, and the memory meter. Fixtures are generated at
 * runtime (tests/fixtures.js), so nothing binary is committed.
 *
 *   node tests/collate.spec.js
 *
 * Requires Playwright. Set CHROMIUM_PATH if your Chromium is not in the
 * default location for this environment.
 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { makeFixtures } = require(path.join(__dirname, 'fixtures.js'));

const ROOT = path.resolve(__dirname, '..');
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'collate-test-'));
const FX = path.join(S, 'fx');
const APP = 'file://' + path.join(ROOT, 'index.html');
const LAUNCH = { executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' };
const fx = n => path.join(FX, n);

let pass = 0, fail = 0;
const results = [];
async function check(n, name, fn) {
  try { await fn(); results.push(`PASS ${n} — ${name}`); pass++; }
  catch (e) { results.push(`FAIL ${n} — ${name}: ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

(async () => {
  const b = await chromium.launch(LAUNCH);
  const ctx = await b.newContext();
  await ctx.addInitScript(() => {
    window.__blobs = [];
    const orig = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (o) { if (o instanceof Blob && o.type === 'text/html') window.__blobs.push(o); return orig(o); };
  });
  const boot = await ctx.newPage();
  await boot.goto('about:blank');
  await makeFixtures(boot, FX);
  await boot.close();

  const p = await ctx.newPage();
  const pageErrs = [];
  p.on('pageerror', e => pageErrs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto(APP);
  await p.waitForTimeout(500);

  const strip = async () => p.evaluate(() =>
    Array.from(document.querySelectorAll('.slideCard')).map(c => c.querySelector('.cardName').textContent));
  const settle = async (ms = 1500) => { await p.waitForTimeout(ms); };
  const addFiles = async (names) => {
    await p.setInputFiles('#fileInput', names.map(fx));
    await settle();
  };
  const goCollate = async () => { await p.click('#tabCollateBtn'); await p.waitForTimeout(600); };

  await check(1, 'boot clean, both views exist, Design active', async () => {
    const r = await p.evaluate(() => ({
      err: document.getElementById('errBox').classList.contains('show'),
      d: !!document.getElementById('viewDesign'), c: !!document.getElementById('viewCollate'),
      active: document.getElementById('tabDesignBtn').classList.contains('active'),
      poly: document.getElementById('polySvg').innerHTML.length }));
    assert(!r.err, 'errBox shown'); assert(r.d && r.c, 'views missing');
    assert(r.active, 'Design not active'); assert(r.poly > 1000, 'poly not rendered');
    assert(pageErrs.length === 0, 'pageerrors: ' + pageErrs.join('; '));
  });

  await goCollate();

  await check(2, 'default order = blank, natural-sorted images, blank', async () => {
    await addFiles(['10.png', '2.png', '1.png', '3a.png', '3.png', '9.png']);
    eq(await strip(), ['blank','1.png','2.png','3.png','3a.png','9.png','10.png','blank'], 'order');
  });

  await check(3, 'thumbnails decoded and sizes shown', async () => {
    const r = await p.evaluate(() => ({
      thumbs: document.querySelectorAll('.thumbImg').length,
      loading: document.querySelectorAll('.slideCard.loading').length,
      sizes: Array.from(document.querySelectorAll('.cardSize')).map(s => s.textContent).filter(Boolean) }));
    eq(r.thumbs, 6, 'thumb count'); eq(r.loading, 0, 'still loading');
    assert(r.sizes.every(s => /KB|MB|B/.test(s)), 'sizes: ' + r.sizes.join(','));
  });

  await check(4, 'batch appends before trailing blank once user has reordered', async () => {
    await p.evaluate(() => document.querySelector('.slideCard[data-id]:nth-of-type(1)'));
    await p.click('.slideCard:nth-child(4) .cardRight');   // manual move -> userOrdered
    await p.waitForTimeout(300);
    const before = await strip();
    await addFiles(['0.png', '5.png']);
    const after = await strip();
    assert(after[after.length - 1] === 'blank', 'trailing blank lost');
    assert(after.indexOf('0.png') > 0 && after.indexOf('5.png') > after.indexOf('0.png'), 'batch not sorted block');
    assert(after.indexOf('0.png') === after.length - 3, 'batch not before trailing blank: ' + after.join(','));
    eq(after.slice(0, before.length - 1), before.slice(0, before.length - 1), 'existing order changed');
  });

  await check(5, 'reset order restores canonical layout', async () => {
    await p.click('#resetOrderBtn'); await p.waitForTimeout(300);
    eq(await strip(), ['blank','0.png','1.png','2.png','3.png','3a.png','5.png','9.png','10.png','blank'], 'reset');
  });

  await check(6, 'insert blank via gap, remove a slide', async () => {
    const n0 = (await strip()).length;
    await p.evaluate(() => document.querySelector('.insertGap').click());
    await p.waitForTimeout(250);
    eq((await strip()).length, n0 + 1, 'insert');
    await p.evaluate(() => document.querySelector('.slideCard .cardRemove').click());
    await p.waitForTimeout(250);
    eq((await strip()).length, n0, 'remove');
  });

  await check(7, 'unsupported files rejected with per-file errors, good ones still added', async () => {
    await p.evaluate(() => { const b = document.getElementById('uploadErrs'); b.innerHTML=''; b.classList.remove('show'); });
    const before = (await strip()).length;
    await addFiles(['fake.heic', 'notes.txt', 'vec.svg', '1.png']);
    const r = await p.evaluate(() => ({
      shown: document.getElementById('uploadErrs').classList.contains('show'),
      txt: document.getElementById('uploadErrs').textContent }));
    assert(r.shown, 'error list not shown');
    assert(/HEIC not supported/.test(r.txt), 'no HEIC message: ' + r.txt);
    assert(/SVG isn't supported/.test(r.txt), 'no SVG message');
    eq((await strip()).length, before + 1, 'good file not added');
  });

  await check(8, 'EXIF orientation honored (portrait after decode)', async () => {
    await addFiles(['exif6.jpg']);
    const r = await p.evaluate(() => {
      const it = window.__collate ? null : null;
      const cards = Array.from(document.querySelectorAll('.slideCard'));
      const c = cards.find(x => x.querySelector('.cardName').textContent === 'exif6.jpg');
      if (!c) return null;
      const img = c.querySelector('.thumbImg');
      return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
    });
    assert(r, 'exif6 card missing');
    assert(r.h > r.w, `expected portrait, got ${r.w}x${r.h}`);
  });

  // ---- deck generation ----
  await check(9, 'deck downloads with dynamic N (=7) and correct structure', async () => {
    // Build a deliberately non-10 deck on a clean page: 4 images + 3 blanks.
    const q = await ctx.newPage();
    await q.addInitScript(() => { window.__blobs = []; const o = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (x) { if (x instanceof Blob && x.type === 'text/html') window.__blobs.push(x); return o(x); }; });
    q.on('dialog', d => d.accept());
    await q.goto(APP); await q.waitForTimeout(400);
    await q.click('#tabCollateBtn'); await q.waitForTimeout(500);
    await q.setInputFiles('#fileInput', ['1.png','2.png','3.png','9.png'].map(fx));
    await q.waitForTimeout(2000);
    await q.evaluate(() => document.querySelector('.insertGap').click());   // -> 7 slides
    await q.waitForTimeout(300);
    const n = await q.evaluate(() => document.querySelectorAll('.slideCard').length);
    eq(n, 7, 'slide count');
    await q.click('#collateDownloadBtn'); await q.waitForTimeout(1500);
    const html = await q.evaluate(async () => {
      const b = window.__blobs[window.__blobs.length - 1]; return b ? await b.text() : null; });
    assert(html, 'no deck blob captured');
    fs.writeFileSync(path.join(S, 'out-deck.html'), html);
    eq((html.match(/<section class="slide/g) || []).length, 7, 'section count');
    eq((html.match(/<section class="slide img-slide"/g) || []).length, 4, 'image section count');
    assert(/N=7[,;]/.test(html), 'controller N=7 missing');
    assert(/\{N:7,/.test(html), 'cfg N:7 missing');
    assert(html.includes('height="' + (7 * 1080 + 400) + '"'), 'bgRect height wrong (want 7960)');
    assert(!/11200|10800/.test(html), 'stale N=10 world literal present');
    assert(html.includes('.img-frame img{max-width:80vw;max-height:80vh'), 'img-frame CSS missing');
    assert(html.includes('border-radius:14px'), 'border-radius missing');
    assert(html.includes('box-shadow:0 30px 80px rgba(0,0,0,.5)'), 'shadow missing');
    assert(!html.includes('.ticker{'), 'ticker rule re-added');
    const tiles = (html.match(/translate\(0 \d+\)/g) || []).length;
    eq(tiles, 7, 'blob tile count');
    // every baked payload decodes as base64
    const srcs = html.match(/src="data:image\/[^;]+;base64,([^"]{40})/g) || [];
    eq(srcs.length, 4, 'baked image count');
    await q.evaluate(s => s.forEach(x => atob(x.split('base64,')[1])), srcs);
    await q.close();
  });

  await check(10, 'generated deck runs and scrolls', async () => {
    const p2 = await ctx.newPage();
    const errs2 = [];
    p2.on('pageerror', e => errs2.push(e.message));
    await p2.goto('file://' + path.join(S, 'out-deck.html'));
    await p2.waitForTimeout(900);
    const r = await p2.evaluate(() => new Promise(res => {
      window.__sbsGoTo(2);
      setTimeout(() => res({ cur: window.__sbsCur(),
        top: document.getElementById('sbsDeck').scrollTop,
        vh: document.getElementById('sbsDeck').clientHeight,
        world: document.getElementById('sbsWorld').getAttribute('transform') || '' }), 1200); }));
    assert(errs2.length === 0, 'deck pageerrors: ' + errs2.join('; '));
    eq(r.cur, 2, 'current slide');
    assert(Math.abs(r.top - 2 * r.vh) < 4, `scrollTop ${r.top} vs ${2*r.vh}`);
    assert(/translate/.test(r.world), 'world not transformed');
    await p2.close();
  });

  await check(11, 'hostile filename is entity-escaped in alt', async () => {
    await addFiles(['pic "one" & <two>.png']);
    await p.click('#collateDownloadBtn'); await p.waitForTimeout(1200);
    const html = await p.evaluate(async () => await window.__blobs[window.__blobs.length-1].text());
    assert(html.includes('&quot;one&quot;'), 'quotes not escaped');
    assert(html.includes('&lt;two&gt;'), 'angle brackets not escaped');
    assert(!/alt="[^"]*"[^>]*"one"/.test(html), 'raw quote leaked into attribute');
  });

  // ---- quality / memory (plan §9) ----
  await check(12, 'quality change re-encodes existing images (retroactive)', async () => {
    await p.click('#resetOrderBtn'); await p.waitForTimeout(200);
    await addFiles(['big1.jpg', 'big2.jpg']);
    await settle(2500);
    const sizeOf = async () => p.evaluate(() => document.getElementById('deckSizeVal').textContent);
    const highTxt = await sizeOf();
    const highBytes = await p.evaluate(() => Array.from(document.querySelectorAll('.cardSize')).map(s=>s.textContent).join(','));
    await p.click('#qualityPills [data-q="med"]');
    await settle(3500);
    const medTxt = await sizeOf();
    const parse = t => parseFloat(String(t).replace(/[^\d.]/g, ''));
    assert(parse(medTxt) < parse(highTxt), `medium (${medTxt}) not smaller than high (${highTxt})`);
    const order = await strip();
    assert(order.includes('big1.jpg') && order.includes('big2.jpg'), 'images lost on re-encode');
    assert(order[0] === 'blank' && order[order.length-1] === 'blank', 'order changed on re-encode');
    assert(!(await p.evaluate(() => document.getElementById('errBox').classList.contains('show'))), 'errors during re-encode');
  });

  await check(13, 'no generation loss: High -> Medium -> High recovers size', async () => {
    const sizeOf = async () => parseFloat((await p.evaluate(() => document.getElementById('deckSizeVal').textContent)).replace(/[^\d.]/g,''));
    await p.click('#qualityPills [data-q="high"]'); await settle(3500);
    const back = await sizeOf();
    await p.click('#qualityPills [data-q="med"]'); await settle(3500);
    const med = await sizeOf();
    await p.click('#qualityPills [data-q="high"]'); await settle(3500);
    const again = await sizeOf();
    assert(Math.abs(again - back) / back < 0.05, `high not recovered: ${back} then ${again}`);
    assert(med < back, 'medium not smaller');
  });

  await check(14, 'animated GIF is exempt from re-encode', async () => {
    await addFiles(['anim.gif']);
    await settle(1500);
    const sizeOfGif = async () => p.evaluate(() => {
      const c = Array.from(document.querySelectorAll('.slideCard')).find(x => x.querySelector('.cardName').textContent === 'anim.gif');
      return c ? c.querySelector('.cardSize').textContent : null; });
    const a = await sizeOfGif();
    await p.click('#qualityPills [data-q="med"]'); await settle(3500);
    const c2 = await sizeOfGif();
    assert(a && c2, 'gif card missing');
    eq(c2, a, 'gif size changed on re-encode');
  });

  await check(15, 'rapid quality clicks do not interleave (re-entrancy)', async () => {
    await p.click('#qualityPills [data-q="med"]');
    await p.click('#qualityPills [data-q="orig"]');
    await p.click('#qualityPills [data-q="high"]');
    await settle(4000);
    const r = await p.evaluate(() => ({
      active: Array.from(document.querySelectorAll('#qualityPills .pill')).filter(x=>x.classList.contains('active')).map(x=>x.dataset.q),
      loading: document.querySelectorAll('.slideCard.loading').length,
      btn: document.getElementById('collateDownloadBtn').disabled,
      err: document.getElementById('errBox').classList.contains('show'),
      dupes: (() => { const ids = Array.from(document.querySelectorAll('.slideCard')).map(c=>c.dataset.id); return ids.length !== new Set(ids).size; })() }));
    eq(r.active, ['high'], 'active pill');
    eq(r.loading, 0, 'cards stuck loading');
    assert(!r.btn, 'download still disabled');
    assert(!r.err, 'errors logged');
    assert(!r.dupes, 'duplicate cards');
  });

  await check(16, 'memory meter reflects payload and survives missing performance.memory', async () => {
    const txt = await p.evaluate(() => document.getElementById('memText').textContent);
    assert(/^Images /.test(txt), 'meter text: ' + txt);
    assert(!/Images 0 B/.test(txt), 'meter still zero with images loaded');
    const r = await p.evaluate(() => {
      const saved = performance.memory;
      try { Object.defineProperty(performance, 'memory', { value: undefined, configurable: true }); } catch (e) {}
      let threw = false;
      try { window.dispatchEvent(new Event('resize')); } catch (e) { threw = true; }
      return { threw, text: document.getElementById('memText').textContent };
    });
    assert(!r.threw, 'meter threw without performance.memory');
  });

  await check(17, 'blank-only deck still builds and runs', async () => {
    const p3 = await ctx.newPage();
    await p3.addInitScript(() => { window.__blobs = []; const o = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (x) { if (x instanceof Blob && x.type === 'text/html') window.__blobs.push(x); return o(x); }; });
    await p3.goto(APP); await p3.waitForTimeout(400);
    await p3.click('#tabCollateBtn'); await p3.waitForTimeout(500);
    await p3.click('#collateDownloadBtn'); await p3.waitForTimeout(1500);
    const html = await p3.evaluate(async () => window.__blobs.length ? await window.__blobs[0].text() : null);
    assert(html, 'no blank deck blob');
    eq((html.match(/<section class="slide/g)||[]).length, 2, 'blank deck sections');
    assert(/\{N:2,/.test(html), 'blank deck N');
    assert(!html.includes('data:image'), 'blank deck has image data');
    await p3.close();
  });

  await check(18, 'Design tab regression: snippet works, no deckDownloadBtn, no image data in settings', async () => {
    await p.click('#tabDesignBtn'); await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({
      gone: !document.getElementById('deckDownloadBtn'),
      goto: !!document.getElementById('gotoCollateBtn'),
      snippet: !!document.getElementById('deckSnippetBtn'),
      err: document.getElementById('errBox').classList.contains('show') }));
    assert(r.gone, 'old deck download button still present');
    assert(r.goto && r.snippet, 'buttons missing');
    assert(!r.err, 'errors after returning to Design');
    await p.click('#gotoCollateBtn'); await p.waitForTimeout(400);
    assert(await p.evaluate(() => !document.getElementById('viewCollate').classList.contains('hidden')), 'goto did not switch');
  });

  await check(19, 'document-level drop is prevented (would otherwise navigate away)', async () => {
    const prevented = await p.evaluate(() => {
      const ev = new Event('drop', { cancelable: true, bubbles: true });
      document.body.dispatchEvent(ev);
      const ev2 = new Event('dragover', { cancelable: true, bubbles: true });
      document.body.dispatchEvent(ev2);
      return ev.defaultPrevented && ev2.defaultPrevented; });
    assert(prevented, 'document drop/dragover not prevented');
  });

  await check(20, 'no page errors across the whole run', async () => {
    assert(pageErrs.length === 0, pageErrs.join('; '));
    assert(!(await p.evaluate(() => document.getElementById('errBox').classList.contains('show'))),
      'errBox: ' + await p.evaluate(() => document.getElementById('errContent').textContent.slice(0,300)));
  });

  await b.close();
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
