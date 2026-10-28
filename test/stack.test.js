import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STACK_TYPES, STACK_COUNTS, PKG_KINDS, makeStack, stackParts, stackLayout, makeCell, act } from '../src/model.js';

const all = () => STACK_TYPES.flatMap((type) => (type === 'pkg' ? PKG_KINDS : [undefined]).flatMap((pkg) =>
  STACK_COUNTS[type].map((n) => ({ ...makeStack(type, pkg), n }))));

test('3D NAND: layers are word lines inside ONE die, one cell per layer on the channel', () => {
  for (const n of STACK_COUNTS.nand) {
    const parts = stackParts({ ...makeStack('nand'), n });
    assert.equal(parts.length, n, 'one selectable part per word-line layer');
    assert.ok(parts.every((p) => p.unit === 'layer' && p.kind === 'wl' && p.tech === 'flash'));
  }
});

test('HBM: separate DRAM dies plus one distinct base die', () => {
  for (const n of STACK_COUNTS.hbm) {
    const parts = stackParts({ ...makeStack('hbm'), n });
    assert.equal(parts.length, n + 1);
    assert.equal(parts[0].kind, 'base');
    assert.notEqual(parts[0].tech, 'dram', 'base die is logic, not a DRAM layer');
    assert.ok(parts.slice(1).every((p) => p.kind === 'dram' && p.tech === 'dram' && p.unit === 'die'));
  }
});

test('3D SRAM cache: SRAM die(s) on a compute die, never DRAM or NAND layers; still volatile, no refresh', () => {
  for (const n of STACK_COUNTS.cache) {
    const parts = stackParts({ ...makeStack('cache'), n });
    assert.equal(parts.filter((p) => p.kind === 'compute').length, 1);
    const cache = parts.filter((p) => p.kind === 'sram');
    assert.equal(cache.length, n);
    assert.ok(parts.every((p) => p.unit === 'die' && p.tech !== 'dram' && p.tech !== 'flash'));
    for (const p of cache) {
      const c = act(act(makeCell(p.tech), 'write', 1).cell, 'power').cell;
      assert.equal(c.q, null, 'stacked SRAM still loses data without power');
      assert.equal(act(makeCell(p.tech), 'refresh').error, 'n/a', 'no refresh');
    }
  }
});

test('Package stacking: NAND or DRAM dies in one package; PoP is two packages', () => {
  for (const pkg of ['nand', 'dram']) {
    const parts = stackParts({ ...makeStack('pkg', pkg), n: 4 });
    assert.equal(parts.length, 4);
    assert.ok(parts.every((p) => p.unit === 'die' && p.tech === (pkg === 'nand' ? 'flash' : 'dram')));
  }
  const pop = stackParts({ ...makeStack('pkg', 'pop'), n: 8 });
  assert.deepEqual(pop.map((p) => p.unit), ['package', 'package'], 'PoP ignores die count');
  assert.deepEqual(pop.map((p) => p.tech), [null, 'dram']);
});

test('Every part has a short label and a function line', () => {
  for (const st of all()) for (const p of stackParts(st)) assert.ok(p.label.length <= 22 && p.fn.length > 10, p.label);
});

test('Layout: bottom-up, inside bounds, no overlap, exploded spreads apart', () => {
  for (const st of all()) {
    const n = stackParts(st).length;
    for (const x of [false, true]) {
      const L = stackLayout(n, x);
      assert.equal(L.length, n);
      assert.equal(L[0].y + L[0].h, 380, 'sits on the base line');
      for (let i = 0; i < n; i++) {
        assert.ok(L[i].y >= 80 && L[i].h >= 10, `in bounds n=${n}`);
        if (i) assert.ok(L[i].y + L[i].h <= L[i - 1].y, 'above, not overlapping');
      }
    }
    if (n > 1) {
      const gap = (L) => L[0].y - (L[1].y + L[1].h);
      assert.ok(gap(stackLayout(n, true)) > gap(stackLayout(n, false)));
    }
  }
});

test('makeStack defaults are valid counts', () => {
  for (const t of STACK_TYPES) assert.ok(STACK_COUNTS[t].includes(makeStack(t).n));
});
