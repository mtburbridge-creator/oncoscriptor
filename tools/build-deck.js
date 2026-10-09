#!/usr/bin/env node
/*
 * build-deck.js — drive Slide Background Studio headlessly to produce deck.html.
 *
 *   node tools/build-deck.js <slug> [--settings guidelines/slideshow.settings.json]
 *                                   [--out projects/<slug>/slides/deck.html]
 *   node tools/build-deck.js --images a.png b.png ... [--settings ...] [--out deck.html]
 *
 * Project mode reads projects/<slug>/slides/order.json ({"order":["01","05",...]})
 * and projects/<slug>/images/generated/<id>.png (.jpg/.jpeg/.webp accepted when
 * the .png is absent). The Studio is never forked: Chromium opens
 * slides/studio/index.html over file://, the settings JSON is applied through
 * the Studio's own "Load settings…" prompt, the images go in through the
 * Collate tab's file input, the strip is reordered with the card buttons until
 * it reads blank, images in order, blank, and the deck is captured from the
 * same download the Collate tab produces.
 *
 * Chromium: /opt/pw-browsers/chromium by default, overridable with CHROMIUM_PATH.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const STUDIO = path.join(REPO, 'slides', 'studio', 'index.html');
const DEFAULT_SETTINGS = path.join(REPO, 'guidelines', 'slideshow.settings.json');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp'];

class DeckError extends Error {}

function fail(msg) { throw new DeckError(msg); }

/* ---------- inputs ---------- */

// Resolve a project folder to the ordered list of image files it names.
function resolveProject(projectDir) {
  const orderPath = path.join(projectDir, 'slides', 'order.json');
  if (!fs.existsSync(projectDir)) fail(`project folder not found: ${projectDir}`);
  if (!fs.existsSync(orderPath)) fail(`missing ${orderPath}`);
  let order;
  try { order = JSON.parse(fs.readFileSync(orderPath, 'utf8')); }
  catch (e) { fail(`${orderPath} is not valid JSON: ${e.message}`); }
  if (!order || !Array.isArray(order.order)) fail(`${orderPath} must look like {"order":["01","05"]}`);
  if (!order.order.length) fail(`${orderPath} lists no slides`);
  const genDir = path.join(projectDir, 'images', 'generated');
  const seen = new Set();
  return order.order.map(id => {
    id = String(id);
    if (seen.has(id)) fail(`order.json lists "${id}" twice`);
    seen.add(id);
    for (const ext of IMAGE_EXTS) {
      const p = path.join(genDir, `${id}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
    fail(`no image for slide "${id}": looked for ${path.join(genDir, id)}.{${IMAGE_EXTS.join(',')}}`);
  });
}

function loadSettings(settingsPath, log) {
  if (!settingsPath || !fs.existsSync(settingsPath)) {
    log(`settings file ${settingsPath || '(none)'} not found — using the Studio defaults`);
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
  catch (e) { fail(`${settingsPath} is not valid JSON: ${e.message}`); }
  if (!parsed || typeof parsed !== 'object') fail(`${settingsPath} must hold a settings object`);
  return JSON.stringify(parsed);
}

/* ---------- browser driving ---------- */

async function waitFor(page, fn, arg, { timeout = 60000, interval = 150, what = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - t0 > timeout) fail(`timed out waiting for ${what}`);
    await page.waitForTimeout(interval);
  }
}

const stripNames = page => page.evaluate(() =>
  Array.from(document.querySelectorAll('#slideStrip .slideCard')).map(c => ({
    id: Number(c.getAttribute('data-id')),
    name: c.querySelector('.cardName').textContent,
    blank: c.classList.contains('blank')
  })));

// Reorder the strip with the Studio's own move-left buttons until the image
// cards sit in `wantNames` order between the two blanks. Selection sort: for
// each target slot, walk the right card leftwards one click at a time.
async function reorderStrip(page, wantNames) {
  let cards = await stripNames(page);
  const ids = new Map();
  for (const c of cards) {
    if (c.blank) continue;
    if (ids.has(c.name)) fail(`two slides share the filename "${c.name}" — the deck tool needs unique basenames`);
    ids.set(c.name, c.id);
  }
  for (const n of wantNames) if (!ids.has(n)) fail(`the Studio did not accept "${n}" (see its upload errors)`);

  for (let slot = 0; slot < wantNames.length; slot++) {
    const target = 1 + slot;                       // index 0 is the leading blank
    const id = ids.get(wantNames[slot]);
    for (;;) {
      cards = await stripNames(page);
      const cur = cards.findIndex(c => c.id === id);
      if (cur < 0) fail(`slide "${wantNames[slot]}" vanished from the strip`);
      if (cur === target) break;
      if (cur < target) fail(`internal error: "${wantNames[slot]}" drifted left of its slot`);
      await page.click(`#slideStrip .slideCard[data-id="${id}"] .cardLeft`);
    }
  }
  cards = await stripNames(page);
  const got = cards.map(c => c.blank ? '' : c.name);
  const want = [''].concat(wantNames, ['']);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    fail(`strip order mismatch\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
  }
}

async function buildDeck({ images, settingsPath, outPath, log = () => {} }) {
  if (!images || !images.length) fail('no images to build from');
  for (const img of images) if (!fs.existsSync(img)) fail(`image not found: ${img}`);
  if (!fs.existsSync(STUDIO)) fail(`Studio not found at ${STUDIO}`);
  if (!fs.existsSync(CHROMIUM)) fail(`Chromium not found at ${CHROMIUM} (set CHROMIUM_PATH)`);
  const settingsJSON = loadSettings(settingsPath, log);
  const wantNames = images.map(p => path.basename(p));

  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  const pageErrors = [];
  try {
    const ctx = await browser.newContext({ acceptDownloads: true });
    // Belt and braces: the Studio hands its deck to a Blob before the download,
    // so keep a handle on it in case the download event never arrives.
    await ctx.addInitScript(() => {
      window.__decks = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (o) {
        if (o instanceof Blob && o.type === 'text/html') window.__decks.push(o);
        return orig(o);
      };
    });
    const page = await ctx.newPage();
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('dialog', d => {
      if (d.type() === 'prompt' && settingsJSON) return d.accept(settingsJSON);
      return d.type() === 'prompt' ? d.dismiss() : d.accept();
    });

    await page.goto('file://' + STUDIO);
    await waitFor(page, () => !!document.getElementById('polySvg') && document.getElementById('polySvg').innerHTML.length > 100,
      null, { what: 'Studio boot', timeout: 20000 });

    if (settingsJSON) {
      await page.click('#loadSettingsBtn');
      await page.waitForTimeout(300);
      const parsed = JSON.parse(settingsJSON);
      // Sliders snap to their step, so only exact-valued controls are probed.
      const check = await page.evaluate(s => {
        const r = { err: document.getElementById('errBox').classList.contains('show'), mismatches: [] };
        const val = id => { const el = document.getElementById(id); return el ? String(el.value).toLowerCase() : null; };
        if (s.poly && typeof s.poly.base === 'string' && val('polyBase') !== null && val('polyBase') !== s.poly.base.toLowerCase())
          r.mismatches.push('polyBase=' + val('polyBase') + ' want ' + s.poly.base);
        if (s.aspect) {
          const on = document.querySelector('#aspectPills .pill.active');
          if (on && on.getAttribute('data-aspect') !== s.aspect) r.mismatches.push('aspect=' + on.getAttribute('data-aspect') + ' want ' + s.aspect);
        }
        return r;
      }, parsed);
      if (check.err) fail('the Studio reported an error while applying the settings (see its error box)');
      if (check.mismatches.length) fail('settings did not take: ' + check.mismatches.join(', '));
      log(`applied settings from ${settingsPath}`);
    }

    await page.click('#tabCollateBtn');
    await waitFor(page, () => !document.getElementById('viewCollate').classList.contains('hidden'), null, { what: 'Collate tab' });

    await page.setInputFiles('#fileInput', images);
    await waitFor(page, n =>
      document.querySelectorAll('#slideStrip .slideCard.loading').length === 0 &&
      document.querySelectorAll('#slideStrip .slideCard:not(.blank)').length === n &&
      !document.getElementById('collateDownloadBtn').disabled,
      images.length, { what: 'image decoding', timeout: 10 * 60 * 1000 });
    const uploadErrs = await page.evaluate(() => document.getElementById('uploadErrs').textContent.trim());
    if (uploadErrs) fail('the Studio rejected some images: ' + uploadErrs);

    await reorderStrip(page, wantNames);
    const slideCount = (await stripNames(page)).length;

    // Export: the same button a person clicks.
    const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await page.click('#collateDownloadBtn');
    const download = await dl;
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (download) {
      await download.saveAs(outPath);
    } else {
      log('download event did not fire; reading the deck Blob instead');
      const html = await page.evaluate(async () => {
        const b = window.__decks[window.__decks.length - 1];
        return b ? await b.text() : null;
      });
      if (!html) fail('the Studio produced no deck');
      fs.writeFileSync(outPath, html);
    }
    if (pageErrors.length) fail('page errors while building: ' + pageErrors.join('; '));
    const bytes = fs.statSync(outPath).size;
    if (!bytes) fail('deck file is empty');
    return { outPath, slideCount, bytes, images: wantNames };
  } finally {
    await browser.close();
  }
}

/* ---------- CLI ---------- */

function parseArgs(argv) {
  const a = { images: null, slug: null, settings: DEFAULT_SETTINGS, out: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--settings') a.settings = path.resolve(argv[++i] || '');
    else if (t === '--out') a.out = path.resolve(argv[++i] || '');
    else if (t === '--images') {
      a.images = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) a.images.push(path.resolve(argv[++i]));
    } else if (t.startsWith('--')) fail(`unknown option ${t}`);
    else if (a.slug === null) a.slug = t;
    else fail(`unexpected argument ${t}`);
  }
  return a;
}

function usage() {
  return [
    'usage: node tools/build-deck.js <slug> [--settings guidelines/slideshow.settings.json] [--out projects/<slug>/slides/deck.html]',
    '       node tools/build-deck.js --images a.png b.png ... [--settings ...] [--out deck.html]'
  ].join('\n');
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  let images, outPath;
  if (a.images) {
    if (a.slug) fail('give either a slug or --images, not both\n' + usage());
    if (!a.images.length) fail('--images needs at least one file\n' + usage());
    images = a.images;
    outPath = a.out || path.resolve('deck.html');
  } else {
    if (!a.slug) fail(usage());
    const projectDir = path.join(REPO, 'projects', a.slug);
    images = resolveProject(projectDir);
    outPath = a.out || path.join(projectDir, 'slides', 'deck.html');
  }
  const r = await buildDeck({ images, settingsPath: a.settings, outPath, log: m => console.log(m) });
  console.log(`wrote ${path.relative(process.cwd(), r.outPath) || r.outPath}: ${r.slideCount} slides (${r.images.length} images + 2 blanks), ${r.bytes} bytes`);
}

if (require.main === module) {
  main().catch(e => {
    console.error(e instanceof DeckError ? `build-deck: ${e.message}` : e);
    process.exit(1);
  });
}

module.exports = { buildDeck, resolveProject, loadSettings, DeckError, STUDIO, DEFAULT_SETTINGS, IMAGE_EXTS };
