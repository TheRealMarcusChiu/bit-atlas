import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSnap, snapOf, applySnap, encodeState, decodeState, readURL, shareURL, MAX_STATE,
} from '../src/share.js';

const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const base = (patch = {}) => ({ ...defaultSnap(), ...patch });
const rt = (p) => assert.deepEqual(decodeState(encodeState(p)), { ok: true, ...p });

test('Roundtrip: every state family', () => {
  rt({ snap: base(), last: null, fi: 0, pulse: 0 });
  rt({ snap: base({ t: 'sram', s: [0, null] }), last: ['op', 'power'], fi: 0, pulse: 0 });
  rt({ snap: base({ t: 'dram', d: [1, 1, 1] }), last: ['leak', 'step'], fi: 0, pulse: 0 });
  rt({ snap: base({ t: 'flash', f: ['nand', 3, 5, 1] }), last: ['op', 'program', '000'], fi: 2, pulse: 0 });
  rt({ snap: base({ t: 'flash', f: ['nor', 1, 1, 0] }), last: ['op', 'power'], fi: 0, pulse: 0 });
  rt({ snap: base({ w: 'where', p: 'ssd-nand' }), last: ['place', 'fw-nor'], fi: 0, pulse: 0 });
  rt({ snap: base({ w: 'topo', a: '00110101', c: 7, b: 1 }), last: ['arr', 'read'], fi: 1, pulse: 0 });
  rt({ snap: base({ w: 'vram', g: 'hbm' }), last: null, fi: 0, pulse: 17 });
  rt({ snap: base({ w: 'stack', k: ['hbm', 8, 8, 1, 'nand'] }), last: ['stks', '3'], fi: 0, pulse: 0 });
  rt({ snap: base({ w: 'stack', k: ['pkg', 2, 1, 0, 'pop'] }), last: ['stkk', 'pop'], fi: 0, pulse: 0 });
  rt({ snap: base({ w: 'vram' }), last: ['go3d', 'pkg', 'dram'], fi: 0, pulse: 0 });
  rt({ snap: base({ w: 'stack', k: ['cache', 2, 2, 0, 'nand'] }), last: ['jump', 'l3'], fi: 0, pulse: 0 });
  rt({ snap: base({ w: 'vram' }), last: ['view', 'bit', 'dram'], fi: 0, pulse: 0 });
});

test('snapOf / applySnap: app state roundtrip', () => {
  const snap = base({ w: 'stack', t: 'dram', d: [1, 3, 1], f: ['nand', 4, 15, 1], k: ['nand', 16, 15, 1, 'dram'], a: '11111111', c: 0 });
  const S = {};
  applySnap(S, snap);
  assert.equal(S.cells.flash.bits, 4);
  assert.equal(S.stack.x, true);
  assert.deepEqual(S.bits, [1, 1, 1, 1, 1, 1, 1, 1]);
  assert.deepEqual(snapOf(S), snap);
});

test('Malformed / injection-like / unbounded state is rejected', () => {
  const bad = [
    '', '!!!', 'e30', enc([]), enc(null), 'a'.repeat(MAX_STATE + 1),
    enc({ v: 2, snap: base() }),
    enc({ v: 1, snap: { ...base(), extra: 1 } }),
    enc({ v: 1, snap: base({ w: '<img src=x onerror=alert(1)>' }) }),
    enc({ v: 1, snap: base({ p: '__proto__' }) }),
    enc({ v: 1, snap: base({ p: 'toString' }) }),
    enc({ v: 1, snap: base({ d: [1, 99, 0] }) }),
    enc({ v: 1, snap: base({ d: [1, 1.5, 0] }) }),
    enc({ v: 1, snap: base({ d: [0, 4, 0] }) }), // unpowered DRAM cannot hold charge
    enc({ v: 1, snap: base({ f: ['nand', 1, 2, 1] }) }), // SLC has 2 levels
    enc({ v: 1, snap: base({ f: ['nor', 3, 0, 1] }) }), // NOR modeled SLC only
    enc({ v: 1, snap: base({ a: '1011010' }) }),
    enc({ v: 1, snap: base({ a: '1011010x' }) }),
    enc({ v: 1, snap: base({ c: 8 }) }),
    enc({ v: 1, snap: base({ k: ['nand', 5, 0, 0, 'nand'] }) }),
    enc({ v: 1, snap: base({ k: ['hbm', 4, 5, 0, 'nand'] }) }), // only base + 4 dies
    enc({ v: 1, snap: base({ k: ['dram', 4, 0, 0, 'nand'] }) }),
    enc({ v: 1, snap: base(), last: ['constructor', 'x'] }),
    enc({ v: 1, snap: base({ w: 'where' }), last: ['op', 'read'] }), // wrong view
    enc({ v: 1, snap: base({ t: 'flash' }), last: ['op', 'program', '01'] }), // wrong width for SLC
    enc({ v: 1, snap: base(), last: ['op', 'write', '<b>'] }),
    enc({ v: 1, snap: base({ w: 'stack' }), last: ['stks', '9'] }),
    enc({ v: 1, snap: base(), fi: 99 }),
    enc({ v: 1, snap: base(), pulse: -1 }),
  ];
  for (const s of bad) {
    const r = decodeState(s);
    assert.equal(r.ok, false, `should reject ${s.slice(0, 60)}`);
    assert.equal(typeof r.error, 'string');
  }
  assert.equal(decodeState(enc({ v: 1, snap: base(), last: ['op', 'write', '1'] })).ok, true);
});

test('readURL: no params = defaults, no notice', () => {
  const r = readURL('');
  assert.deepEqual(r.snap, defaultSnap());
  assert.equal(r.last, null);
  assert.equal(r.notice, '');
  assert.equal(r.given, false);
});

test('readURL: readable preset action applied to known state', () => {
  const r = readURL('?view=bit&tech=flash&action=program&value=0&frame=2');
  assert.equal(r.snap.w, 'bit');
  assert.equal(r.snap.t, 'flash');
  assert.deepEqual(r.last, ['op', 'program', '0']);
  assert.equal(r.fi, 1, 'frame is 1-based in the URL');
  assert.equal(r.notice, '');
  const t = readURL('?view=topo&cell=4&action=read&frame=3');
  assert.deepEqual([t.snap.w, t.snap.c, t.last, t.fi], ['topo', 4, ['arr', 'read'], 2]);
  const s = readURL('?view=stack&stack=pkg&pkg=dram&n=8&layer=3&exploded=1');
  assert.deepEqual(s.snap.k, ['pkg', 8, 2, 1, 'dram']);
  const f = readURL('?view=bit&tech=flash&topo=nand&bits=3&action=program&value=010');
  assert.deepEqual([f.snap.f, f.last], [['nand', 3, 0, 1], ['op', 'program', '010']]);
});

test('readURL: unsupported / invalid readable params fail gracefully with a notice', () => {
  const a = readURL('?view=where&action=erase');
  assert.equal(a.last, null);
  assert.match(a.notice, /not available/);
  const b = readURL('?view=nope&tech=flash');
  assert.equal(b.snap.w, 'bit');
  assert.match(b.notice, /view/);
  const c = readURL('?view=bit&tech=flash&action=program&value=0101');
  assert.equal(c.last, null);
  const d = readURL('?view=stack&stack=nand&n=3');
  assert.equal(d.snap.k[1], 8, 'invalid count ignored');
  assert.notEqual(d.notice, '');
  const e = readURL(`?view=bit&action=${'x'.repeat(5000)}`);
  assert.equal(e.last, null);
});

test('readURL: valid state wins over readable params; invalid state → defaults + notice', () => {
  const p = { snap: base({ w: 'topo', c: 5 }), last: null, fi: 0, pulse: 0 };
  const r = readURL(`?view=where&state=${encodeState(p)}`);
  assert.equal(r.snap.w, 'topo');
  assert.equal(r.snap.c, 5);
  const bad = readURL('?view=topo&state=%3Cscript%3E');
  assert.deepEqual(bad.snap, defaultSnap());
  assert.match(bad.notice, /link/i);
});

test('shareURL: keeps path, hash and unrelated params; replaces our own', () => {
  const p = { snap: base({ w: 'vram' }), last: null, fi: 0, pulse: 3 };
  const u = new URL(shareURL('https://x.test/bit-atlas/?utm=1&view=bit&frame=9&action=read#sources', p));
  assert.equal(u.pathname, '/bit-atlas/');
  assert.equal(u.hash, '#sources');
  assert.equal(u.searchParams.get('utm'), '1');
  assert.equal(u.searchParams.get('view'), 'vram', 'readable view kept in sync');
  assert.equal(u.searchParams.get('frame'), null);
  assert.equal(u.searchParams.get('action'), null);
  assert.ok(u.href.length < 600, 'bounded URL');
  assert.equal(new URL(shareURL('https://x.test/', p, 'stack')).searchParams.get('view'), 'stack', 'current view, not pre-action view');
  assert.deepEqual(readURL(u.search).snap, p.snap);
  assert.equal(readURL(u.search).pulse, 3);
});
