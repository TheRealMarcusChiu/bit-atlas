import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCell, act, FULL, SENSE, levelsFor, bitsAt, levelOf,
  PLACES, techOf, readPath, createClock, makeArray, arrayAct,
} from '../src/model.js';

const run = (cell, ...ops) => ops.reduce((c, [op, arg]) => act(c, op, arg).cell, cell);

test('SRAM holds while powered, no refresh, lost on power off', () => {
  let c = run(makeCell('sram'), ['write', 1]);
  assert.equal(act(c, 'read').value, 1);
  c = run(c, ['leak'], ['leak'], ['leak']); // no leak/refresh concept
  assert.equal(act(c, 'read').value, 1);
  c = run(c, ['power']);
  assert.equal(c.powered, false);
  assert.equal(c.q, null);
  c = run(c, ['power']);
  assert.equal(act(c, 'read').value, null, 'unknown after power-up');
  assert.equal(act(c, 'refresh').error, 'n/a');
});

test('SRAM write flips complementary latch', () => {
  const c = run(makeCell('sram'), ['write', 0]);
  assert.equal(c.q, 0);
  assert.equal(run(c, ['write', 1]).q, 1);
});

test('DRAM: charged = 1, leaks, read senses and restores', () => {
  let c = run(makeCell('dram'), ['write', 1]);
  assert.equal(c.charge, FULL);
  c = run(c, ['leak']);
  assert.ok(c.charge < FULL && c.charge >= SENSE);
  const r = act(c, 'read');
  assert.equal(r.value, 1);
  assert.equal(r.cell.charge, FULL, 'read restores');
});

test('DRAM refresh restores before threshold, too late = lost', () => {
  let c = run(makeCell('dram'), ['write', 1], ['leak']);
  c = run(c, ['refresh']);
  assert.equal(c.charge, FULL);
  while (c.charge >= SENSE) c = run(c, ['leak']);
  const r = act(c, 'refresh');
  assert.equal(r.cell.charge, 0, 'refresh restores the wrong value');
  assert.equal(act(r.cell, 'read').value, 0);
  assert.equal(r.cell.lost, true);
});

test('DRAM 0 stays 0; power off loses data', () => {
  let c = run(makeCell('dram'), ['write', 0], ['leak']);
  assert.equal(c.charge, 0);
  c = run(makeCell('dram'), ['write', 1], ['power']);
  assert.equal(c.charge, null);
  c = run(c, ['power']);
  assert.equal(act(c, 'read').value, null);
});

test('Flash SLC: erased = 1 (low Vt), program = 0, power off retains', () => {
  let c = makeCell('flash');
  assert.equal(act(c, 'read').value, '1');
  c = run(c, ['program', '0']);
  assert.equal(c.level, 1);
  c = run(c, ['power'], ['power']);
  assert.equal(act(c, 'read').value, '0', 'retained through power cycle');
  c = run(c, ['power']);
  assert.equal(c.level, 1, 'retained while off');
});

test('Flash: no 0→1 without erase', () => {
  const c = run(makeCell('flash'), ['program', '0']);
  const r = act(c, 'program', '1');
  assert.equal(r.error, 'erase-first');
  assert.equal(r.cell.level, 1);
  const e = act(c, 'erase');
  assert.equal(e.cell.level, 0);
  assert.equal(act(e.cell, 'read').value, '1');
});

test('Flash refuses ops while unpowered', () => {
  const c = run(makeCell('flash'), ['power']);
  assert.equal(act(c, 'program', '0').error, 'off');
  assert.equal(act(c, 'erase').error, 'off');
});

test('Multi-level: 2/3/4 bits ⇒ 4/8/16 windows, unique labels, Vt only rises', () => {
  assert.deepEqual([1, 2, 3, 4].map(levelsFor), [2, 4, 8, 16]);
  for (const b of [1, 2, 3, 4]) {
    const labels = Array.from({ length: levelsFor(b) }, (_, i) => bitsAt(i, b));
    assert.equal(new Set(labels).size, levelsFor(b));
    assert.ok(labels.every((l) => l.length === b));
    assert.equal(labels[0], '1'.repeat(b), 'erased reads all ones');
    labels.forEach((l, i) => assert.equal(levelOf(l, b), i));
  }
  let c = makeCell('flash', { bits: 3 });
  c = run(c, ['program', bitsAt(5, 3)]);
  assert.equal(c.level, 5);
  assert.equal(act(c, 'program', bitsAt(2, 3)).error, 'erase-first');
  assert.equal(act(c, 'program', bitsAt(7, 3)).cell.level, 7);
});

test('Place map: role vs cell technology', () => {
  for (const id of ['cpu-l1', 'cpu-l2', 'cpu-l3', 'gpu-l1', 'gpu-l2']) assert.equal(techOf(id), 'sram');
  assert.equal(techOf('host-dram'), 'dram');
  assert.equal(techOf('vram'), 'dram');
  assert.equal(techOf('ssd-nand'), 'flash');
  assert.equal(PLACES['ssd-nand'].topo, 'nand');
  assert.equal(techOf('ssd-dram'), 'dram');
  assert.equal(PLACES['ssd-dram'].optional, true, 'DRAM-less SSDs exist');
  assert.equal(PLACES['fw-nor'].topo, 'nor');
  assert.ok(PLACES['cpu-l0'].optional && PLACES['gpu-l0'].optional && PLACES['gpu-llc'].optional);
  assert.ok(!Object.values(PLACES).some((p) => p.device === 'ssd' && p.topo === 'nor'), 'SSD is not NOR');
  for (const p of Object.values(PLACES)) assert.ok(p.role && p.label.split(' ').length <= 4);
});

test('NAND series path vs NOR parallel path', () => {
  const bits = [1, 0, 1, 1, 0, 1, 1, 1];
  const n = readPath('nand', bits, 2);
  assert.equal(n.current, true);
  assert.deepEqual(n.path, [0, 1, 2, 3, 4, 5, 6, 7], 'current crosses whole string');
  assert.equal(readPath('nand', bits, 1).current, false);
  const r = readPath('nor', bits, 2);
  assert.equal(r.current, true);
  assert.deepEqual(r.path, [2]);
  assert.equal(readPath('nor', bits, 4).current, false);
});

test('Array: program 0 per cell, erase whole block/sector only', () => {
  let a = makeArray('nand');
  a = arrayAct(a, 'program', 3).arr;
  assert.equal(a.bits[3], 0);
  assert.equal(arrayAct(a, 'program1', 3).error, 'erase-first');
  a = arrayAct(a, 'erase').arr;
  assert.ok(a.bits.every((b) => b === 1));
});

function fakeTimers() {
  const q = new Map(); let id = 0;
  return {
    schedule: (fn) => { q.set(++id, fn); return id; },
    clear: (i) => q.delete(i),
    fire: () => { const [[k, fn]] = q; q.delete(k); fn(); },
    pending: () => q.size,
    leak: () => [...q.values()], // grab callbacks to fire them stale
  };
}

test('Clock: play advances, stops when done', () => {
  const t = fakeTimers(); let n = 0;
  const clk = createClock({ ...t, advance: () => ++n < 3 });
  clk.play();
  assert.ok(clk.playing);
  t.fire(); t.fire();
  assert.equal(n, 2);
  t.fire();
  assert.equal(n, 3);
  assert.equal(clk.playing, false);
  assert.equal(t.pending(), 0);
});

test('Clock: pause, step, reset and cancel drop stale callbacks', () => {
  const t = fakeTimers(); let n = 0; let resets = 0;
  const clk = createClock({ ...t, advance: () => { n++; return true; }, reset: () => { n = 0; resets++; } });
  clk.play();
  const [stale] = t.leak();
  clk.pause();
  stale();
  assert.equal(n, 0, 'stale tick ignored after pause');
  clk.step();
  assert.equal(n, 1);
  assert.equal(clk.playing, false);
  clk.play();
  const [stale2] = t.leak();
  clk.reset();
  stale2();
  assert.equal(n, 0);
  assert.equal(resets, 1);
  clk.play();
  const [stale3] = t.leak();
  clk.cancel();
  stale3();
  assert.equal(n, 0);
  assert.equal(t.pending(), 0);
});
