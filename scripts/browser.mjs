// Browser regression: shareable links, paused snapshots, history, keyboard, 3D view, mobile overflow.
// Not part of `npm test` (needs a Playwright install). Run: PLAYWRIGHT=/path/to/node_modules/playwright node scripts/browser.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize } from 'node:path';
import assert from 'node:assert/strict';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const pwPath = process.env.PLAYWRIGHT || '/root/projects/bandwidth-compare/node_modules/playwright/index.js';
const pw = await import(pwPath.endsWith('.js') ? pwPath : join(pwPath, 'index.js'));
const { chromium } = pw.default ?? pw;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!path.startsWith('/bit-atlas/')) { res.writeHead(404).end(); return; }
  const rel = normalize(path.slice('/bit-atlas/'.length) || 'index.html');
  if (rel.startsWith('..')) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(join(root, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/bit-atlas/`;

const browser = await chromium.launch();
const errors = [];
let passed = 0;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1365, height: 900 }, ...opts });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${m.text()}`); });
  page.on('dialog', (d) => { errors.push(`dialog ${d.message()}`); d.dismiss(); });
  await page.goto(url);
  await page.waitForSelector('#diagram title', { state: 'attached' });
  return page;
}
const shot = (page, controls = true) => page.evaluate((controls) => ({
  svg: document.querySelector('#diagram').innerHTML,
  status: document.querySelector('#status').textContent,
  phase: document.querySelector('#phase').textContent,
  bad: document.querySelector('#status').className,
  nav: [...document.querySelectorAll('nav [aria-pressed="true"]')].map((b) => b.dataset.v).join(),
  ...(controls && { controls: document.querySelector('#controls').innerHTML }),
}), controls);
// Copy link and capture the DOM in the same tick, so a running animation cannot move in between.
const copy = (page, controls = true) => page.evaluate((controls) => {
  document.querySelector('#copy').click();
  return {
    href: document.querySelector('#share').value,
    svg: document.querySelector('#diagram').innerHTML,
    status: document.querySelector('#status').textContent,
    phase: document.querySelector('#phase').textContent,
    bad: document.querySelector('#status').className,
    nav: [...document.querySelectorAll('nav [aria-pressed="true"]')].map((b) => b.dataset.v).join(),
    ...(controls && { controls: document.querySelector('#controls').innerHTML }),
  };
}, controls);
const click = (page, sel) => page.click(sel);
const B = (a, v, arg) => `[data-a="${a}"][data-v="${v}"]${arg !== undefined ? `[data-arg="${arg}"]` : ''}`;

async function check(name, fn) {
  try { await fn(); passed++; console.log(`ok   ${name}`); } catch (e) { console.log(`FAIL ${name}\n${e.stack}`); process.exitCode = 1; }
}
// Reload a copied link in a NEW context, compare, then wait to prove it stays paused.
async function reopen(snap, { controls = true } = {}) {
  const { href, ...want } = snap;
  assert.ok(new URL(href).pathname.startsWith('/bit-atlas/'), 'base path kept');
  const p = await open(href);
  assert.deepEqual(await shot(p, controls), want);
  await wait(1700);
  assert.deepEqual(await shot(p, controls), want, 'still paused');
  await p.context().close();
}

await check('fresh load: defaults, URL untouched', async () => {
  const p = await open(BASE);
  assert.equal(await p.evaluate(() => location.search), '');
  assert.match((await shot(p)).status, /SRAM/);
  await p.context().close();
});

await check('mid-animation copy (playing) opens paused on that exact frame', async () => {
  const p = await open(BASE);
  await click(p, B('op', 'write', '0'));
  await wait(900);
  const snap = await copy(p, false);
  assert.match(snap.phase, /^[23]\/4/);
  await reopen(snap, { controls: false });
  await p.context().close();
});

await check('paused mid-animation copy: identical diagram, status, phase and controls', async () => {
  const p = await open(BASE);
  await click(p, B('tech', 'dram'));
  await click(p, B('op', 'read'));
  await click(p, B('anim', 'pause'));
  await click(p, B('anim', 'step'));
  const snap = await copy(p);
  assert.match(snap.phase, /^2\/4/);
  await reopen(snap);
  await p.context().close();
});

const families = {
  'DRAM leak steps': [B('tech', 'dram'), B('leak', 'step'), B('leak', 'step'), B('leak', 'step')],
  'DRAM power off': [B('tech', 'dram'), B('op', 'power')],
  'flash TLC program': [B('tech', 'flash'), B('levels', '3'), B('op', 'program', '010'), B('anim', 'pause')],
  'flash blocked write (error state)': [B('tech', 'flash'), B('op', 'program', '0'), B('op', 'program', '1')],
  'flash NOR erase': [B('tech', 'flash'), B('topo', 'nor'), B('op', 'program', '0'), B('op', 'erase'), B('anim', 'pause')],
  'where: SSD NAND': [B('view', 'where'), B('place', 'ssd-nand')],
  'topo: select + read mid-frame': [B('view', 'topo'), B('sel', '5'), B('arr', 'read'), B('anim', 'pause')],
  'topo: program': [B('view', 'topo'), B('sel', '0'), B('arr', 'program')],
  'vram: HBM': [B('view', 'vram'), B('vram', 'hbm'), B('bus', 'step'), B('bus', 'step')],
  'stack: HBM 8 dies, die 3, exploded': [B('view', 'stack'), B('stk', 'hbm'), B('stkn', '8'), B('stks', '3'), B('stkx', '1')],
  'stack: NAND 16 layers, layer 12': [B('view', 'stack'), B('stkn', '16'), B('stks', '11')],
  'stack: PoP': [B('view', 'stack'), B('stk', 'pkg'), B('stkk', 'pop'), B('stks', '1'), B('stkx', '1')],
  'stack: 3D cache 2 dies': [B('view', 'stack'), B('stk', 'cache'), B('stkn', '2'), B('stks', '2')],
  'entry link: where → 3D cache': [B('view', 'where'), B('place', 'cpu-l3'), B('go3d', 'cache')],
  'entry link: HBM → explorer': [B('view', 'vram'), B('vram', 'hbm'), B('go3d', 'hbm')],
  'entry link: flash → 3D NAND → flash cell': [B('tech', 'flash'), B('go3d', 'nand'), B('jump', 'nand')],
};
for (const [name, steps] of Object.entries(families)) {
  await check(`roundtrip ${name}`, async () => {
    const p = await open(BASE);
    for (const s of steps) await click(p, s);
    await reopen(await copy(p));
    await p.context().close();
  });
}

await check('entry links land on the right 3D example', async () => {
  const p = await open(BASE);
  for (const [setup, go, re] of [
    [[B('view', 'bit'), B('tech', 'sram')], B('go3d', 'cache'), /SRAM cache/],
    [[B('view', 'bit'), B('tech', 'dram')], B('go3d', 'hbm'), /HBM/],
    [[B('view', 'topo')], B('go3d', 'nand'), /3D NAND/],
    [[B('view', 'where'), B('place', 'host-dram')], B('go3d', 'pkg', 'dram'), /stacked DRAM dies/],
    [[B('view', 'where'), B('place', 'ssd-nand')], B('go3d', 'nand'), /3D NAND/],
  ]) {
    for (const s of setup) await click(p, s);
    await click(p, go);
    assert.match(await p.textContent('#diagram title'), re);
  }
  await click(p, B('view', 'where'));
  await click(p, B('place', 'cpu-l1'));
  assert.equal(await p.$(B('go3d', 'cache')), null, 'no 3D link for L1');
  await click(p, B('view', 'bit')); await click(p, B('tech', 'flash')); await click(p, B('topo', 'nor'));
  assert.equal(await p.$('[data-a="go3d"]'), null, 'no 3D link for NOR');
  await p.context().close();
});

await check('stack: diagram click selects; layer highlight moves', async () => {
  const p = await open(`${BASE}?view=stack&stack=nand&n=4`);
  await p.click('#diagram g[data-a="stks"][data-v="2"]');
  assert.match((await shot(p)).status, /Word line 3/);
  assert.equal(await p.getAttribute(`#controls ${B('stks', '2')}`, 'aria-pressed'), 'true');
  assert.ok(await p.$('#diagram g.sel[data-v="2"]'));
  await p.context().close();
});

await check('readable preset link: action applied once, opens paused on frame', async () => {
  const p = await open(`${BASE}?view=bit&tech=flash&action=program&value=0&frame=2`);
  const a = await shot(p);
  assert.match(a.phase, /^2\/3/);
  assert.match(a.status, /Programmed/);
  await wait(1700);
  assert.deepEqual(await shot(p), a);
  const t = await open(`${BASE}?view=topo&cell=4&action=read&frame=3`);
  assert.match((await shot(t)).phase, /^3\/3/);
  await p.context().close(); await t.context().close();
});

await check('invalid / injection-like links → defaults + notice, no crash', async () => {
  for (const q of ['?state=garbage', '?state=eyJ2IjoyfQ', '?view=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E', '?view=where&action=erase',
    `?state=${'A'.repeat(5000)}`, '?view=bit&tech=flash&action=program&value=%3Cb%3E']) {
    const p = await open(BASE + q);
    assert.equal(await p.isVisible('#notice'), true, q);
    assert.equal(await p.$('#diagram img, #controls img'), null);
    await p.context().close();
  }
});

await check('unrelated params and hash preserved; URL synced on change', async () => {
  const p = await open(`${BASE}?utm=x#sources`);
  await click(p, B('view', 'vram'));
  const u = new URL(p.url());
  assert.equal(u.hash, '#sources');
  assert.equal(u.searchParams.get('utm'), 'x');
  assert.equal(u.searchParams.get('view'), 'vram');
  assert.ok(u.searchParams.get('state'));
  await p.context().close();
});

await check('back/forward restore without autoplay or history growth', async () => {
  const p = await open(`${BASE}?view=stack&stack=hbm`);
  const len = await p.evaluate(() => history.length);
  await click(p, B('stks', '2'));
  assert.equal(await p.evaluate(() => history.length), len, 'replaceState only');
  const a = await shot(p);
  const other = new URL(p.url()); other.search = '?view=bit&tech=sram&action=write&value=0';
  await p.evaluate((h) => history.pushState(null, '', h), other.href);
  await p.goBack(); await p.waitForTimeout(100);
  assert.deepEqual(await shot(p), a, 'back restores A');
  await p.goForward(); await p.waitForTimeout(100);
  const b = await shot(p);
  assert.match(b.phase, /^1\/4/, 'opens paused at frame 1');
  await wait(1700);
  assert.deepEqual(await shot(p), b, 'no autoplay after popstate');
  await p.context().close();
});

await check('restore / mode switch cancels running clocks', async () => {
  const p = await open(BASE);
  await click(p, B('op', 'write', '0'));
  await click(p, B('view', 'where'));
  const a = await shot(p);
  await wait(1700);
  assert.deepEqual(await shot(p), a);
  await click(p, B('view', 'bit')); await click(p, B('tech', 'dram')); await click(p, B('leak', 'play'));
  await p.evaluate(() => { history.pushState(null, '', '?view=topo'); dispatchEvent(new PopStateEvent('popstate')); });
  const b = await shot(p);
  await wait(2000);
  assert.deepEqual(await shot(p), b, 'leak clock stopped by restore');
  await p.context().close();
});

await check('keyboard: Enter/Space drive controls, focus kept', async () => {
  const p = await open(BASE);
  await p.focus(B('view', 'stack'));
  await p.keyboard.press('Enter');
  assert.match((await shot(p)).status, /3D NAND/);
  await p.focus(`#controls ${B('stks', '3')}`);
  await p.keyboard.press('Space');
  assert.equal(await p.evaluate(() => document.activeElement.dataset.v), '3');
  await p.keyboard.press('Tab');
  await p.keyboard.press('Enter');
  assert.match((await shot(p)).status, /Word line 5/);
  await p.context().close();
});

await check('clipboard failure → selected read-only link field', async () => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) } }); });
  const p = await ctx.newPage();
  await p.goto(`${BASE}?view=where`);
  await p.click('#copy');
  await p.waitForSelector('#share:not([hidden])');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'share');
  assert.match(await p.inputValue('#share'), /state=/);
  await ctx.close();
});

await check('mobile 390px: no horizontal overflow, 44px touch targets', async () => {
  const links = ['', '?view=where', '?view=topo', '?view=vram', '?view=stack&stack=nand&n=16&exploded=1', '?view=stack&stack=hbm&n=8',
    '?view=stack&stack=pkg&pkg=pop', '?view=stack&stack=cache&n=2', '?view=bit&tech=flash&bits=4'];
  for (const q of links) {
    const p = await open(BASE + q, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await p.click('#copy').catch(() => {});
    const r = await p.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      small: [...document.querySelectorAll('button')].filter((b) => { const x = b.getBoundingClientRect(); return x.height < 44 || x.width < 44; }).length,
    }));
    assert.equal(r.over, 0, `overflow ${q}`);
    assert.equal(r.small, 0, `small buttons ${q}`);
    await p.context().close();
  }
});

await check('reduced motion: preset still opens on requested frame', async () => {
  const p = await open(`${BASE}?view=bit&tech=dram&action=write&value=1&frame=2`, { reducedMotion: 'reduce' });
  assert.match((await shot(p)).phase, /^2\/4/);
  await p.context().close();
});

await check('no console errors', async () => { assert.deepEqual(errors, []); });

await browser.close();
server.close();
console.log(`${passed} browser checks passed${process.exitCode ? ', some FAILED' : ''}`);
