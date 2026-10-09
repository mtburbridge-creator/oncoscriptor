#!/usr/bin/env node
/*
 * test-deck.js — CI check for tools/build-deck.js.
 *
 *   node tools/test-deck.js
 *
 * Draws three small PNGs in headless Chromium (no binaries committed), builds a
 * deck from them in an order that natural sorting would NOT produce, then opens
 * the deck in a second headless page and checks: five sections (blank + 3 +
 * blank), the three image sections carry class img-slide with a data:image
 * src, the images sit in the requested order, and the deck logs no page
 * errors. Also exercises the project-folder resolution and its error paths.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { buildDeck, resolveProject, DeckError } = require(path.join(__dirname, 'build-deck.js'));

const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const S = fs.mkdtempSync(path.join(os.tmpdir(), 'deck-test-'));
const tmp = (...n) => path.join(S, ...n);

let pass = 0, fail = 0;
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(`PASS ${name}`); pass++; }
  catch (e) { results.push(`FAIL ${name}: ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

async function drawPng(page, file, w, h, hue) {
  const dataURL = await page.evaluate(([w, h, hue]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = `hsl(${hue},60%,45%)`; x.fillRect(0, 0, w, h);
    x.fillStyle = '#fff'; x.font = '40px sans-serif'; x.fillText(String(hue), 20, 60);
    return c.toDataURL('image/png');
  }, [w, h, hue]);
  fs.writeFileSync(file, Buffer.from(dataURL.split(',')[1], 'base64'));
}

(async () => {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const ctx = await browser.newContext();

  // Fixtures. Requested order c, a, b: the Studio sorts uploads a, b, c, so the
  // tool has to reorder the strip for the deck to come out right.
  const boot = await ctx.newPage();
  await boot.goto('about:blank');
  await drawPng(boot, tmp('c.png'), 320, 180, 10);
  await drawPng(boot, tmp('a.png'), 320, 180, 120);
  await drawPng(boot, tmp('b.png'), 320, 180, 230);
  await boot.close();
  const images = ['c.png', 'a.png', 'b.png'].map(n => tmp(n));
  const settingsPath = tmp('settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify({ v: 1, app: 'slide-background-studio', aspect: '16:9', style: 'poly',
    poly: { density: 100, mode: 'hybrid', base: '#112233' }, composite: { opacity: 55 } }));
  const outPath = tmp('out', 'deck.html');

  let built = null;
  await check('build-deck builds a deck from three images', async () => {
    built = await buildDeck({ images, settingsPath, outPath });
    eq(built.slideCount, 5, 'slide count');
    assert(built.bytes > 10000, 'deck suspiciously small: ' + built.bytes);
    assert(fs.existsSync(outPath), 'deck file missing');
  });

  await check('deck has 5 sections, 3 img-slides with data:image src, in requested order', async () => {
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + outPath);
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const secs = Array.from(document.querySelectorAll('#sbsDeck > section'));
      return {
        n: secs.length,
        classes: secs.map(s => s.className),
        imgs: secs.map(s => { const i = s.querySelector('img'); return i ? { src: i.getAttribute('src').slice(0, 10), alt: i.getAttribute('alt') } : null; })
      };
    });
    eq(r.n, 5, 'section count');
    eq(r.classes, ['slide', 'slide img-slide', 'slide img-slide', 'slide img-slide', 'slide'], 'section classes');
    eq(r.imgs.map(i => i && i.src), [null, 'data:image', 'data:image', 'data:image', null], 'image src prefixes');
    eq(r.imgs.filter(Boolean).map(i => i.alt), ['c', 'a', 'b'], 'image order (alt text)');
    assert(errs.length === 0, 'deck page errors: ' + errs.join('; '));
    await page.close();
  });

  await check('settings were applied (poly density baked into the deck background)', async () => {
    const html = fs.readFileSync(outPath, 'utf8');
    assert(/<section class="slide/.test(html), 'not a deck');
    // A different poly density changes the mesh; compare against a default build.
    const other = tmp('out', 'default.html');
    await buildDeck({ images: images.slice(0, 1), settingsPath: tmp('missing.json'), outPath: other, log: () => {} });
    const a = fs.readFileSync(other, 'utf8');
    const polyCount = s => (s.match(/<polygon|<path/g) || []).length;
    assert(polyCount(html) !== polyCount(a), `background unchanged by settings (${polyCount(html)} shapes both ways)`);
  });

  await check('CLI --images mode prints count and size', async () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'build-deck.js'), '--images', images[0], images[1],
      '--settings', settingsPath, '--out', tmp('out', 'cli.html')], { encoding: 'utf8' });
    assert(/4 slides \(2 images \+ 2 blanks\), \d+ bytes/.test(out), 'unexpected output: ' + out);
  });

  await check('missing settings falls back to Studio defaults and says so', async () => {
    const out = execFileSync(process.execPath, [path.join(__dirname, 'build-deck.js'), '--images', images[2],
      '--settings', tmp('nope.json'), '--out', tmp('out', 'nosettings.html')], { encoding: 'utf8' });
    assert(/using the Studio defaults/.test(out), 'no fallback notice: ' + out);
  });

  await check('project resolution: order.json order, png/jpg fallback, clear errors', async () => {
    const proj = tmp('proj');
    fs.mkdirSync(path.join(proj, 'images', 'generated'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'slides'), { recursive: true });
    fs.copyFileSync(images[0], path.join(proj, 'images', 'generated', '05.png'));
    fs.copyFileSync(images[1], path.join(proj, 'images', 'generated', '01.jpg'));
    fs.writeFileSync(path.join(proj, 'slides', 'order.json'), JSON.stringify({ order: ['05', '01'] }));
    eq(resolveProject(proj).map(p => path.basename(p)), ['05.png', '01.jpg'], 'resolved order');
    fs.writeFileSync(path.join(proj, 'slides', 'order.json'), JSON.stringify({ order: ['05', '09'] }));
    let msg = '';
    try { resolveProject(proj); } catch (e) { assert(e instanceof DeckError, 'wrong error type'); msg = e.message; }
    assert(/no image for slide "09"/.test(msg), 'missing image not reported: ' + msg);
    try { resolveProject(tmp('absent')); } catch (e) { msg = e.message; }
    assert(/project folder not found/.test(msg), 'missing project not reported: ' + msg);
  });

  await check('CLI exits non-zero on a missing project', async () => {
    let code = 0, err = '';
    try { execFileSync(process.execPath, [path.join(__dirname, 'build-deck.js'), 'no-such-project-xyz'], { encoding: 'utf8', stdio: 'pipe' }); }
    catch (e) { code = e.status; err = String(e.stderr); }
    assert(code === 1, 'exit code ' + code);
    assert(/project folder not found/.test(err), 'stderr: ' + err);
  });

  await browser.close();
  fs.rmSync(S, { recursive: true, force: true });
  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
