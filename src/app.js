import {
  makeCell, act, errText, FULL, SENSE, levelsFor, bitsAt, PLACES, techOf, readPath, createClock,
} from './model.js';

const $ = (s) => document.querySelector(s);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const S = {
  view: 'bit',
  tech: 'sram',
  cells: { sram: makeCell('sram'), dram: makeCell('dram'), flash: makeCell('flash') },
  frames: null, fi: 0, before: null, bad: false,
  msg: '',
  place: 'cpu-l1',
  bits: [1, 0, 1, 1, 0, 1, 0, 1], sel: 2,
  vram: 'gddr', pulse: 0,
};

/* ---------- clocks (all cancelled on mode change) ---------- */
const opClock = createClock({
  interval: 750,
  advance: () => { if (S.frames && S.fi < S.frames.length - 1) S.fi++; return S.frames && S.fi < S.frames.length - 1; },
  reset: () => { S.fi = 0; },
  onChange: () => render(),
});
const leakClock = createClock({
  interval: 900,
  advance: () => {
    const prev = S.cells.dram.charge;
    S.cells.dram = act(S.cells.dram, 'leak').cell;
    const c = S.cells.dram.charge;
    if (prev >= SENSE && c < SENSE) S.msg = 'Below threshold: a stored 1 now reads 0';
    else if (prev > 0 && c === 0) S.msg = 'Fully leaked';
    return S.cells.dram.powered && c > 0;
  },
  reset: () => { S.cells.dram = act(makeCell('dram'), 'write', 1).cell; S.msg = 'Reset: charged → 1'; },
  onChange: () => render(),
});
const busClock = createClock({
  interval: 160,
  advance: () => ++S.pulse < 40, // finite run, never endless
  reset: () => { S.pulse = 0; },
  onChange: () => render(),
});
const clocks = [opClock, leakClock, busClock];

function startFrames(frames, before) {
  opClock.cancel();
  S.frames = frames; S.before = before;
  S.fi = reduced() ? frames.length - 1 : 0;
  if (!reduced() && frames.length > 1) opClock.play();
}
function clearFrames() { opClock.cancel(); S.frames = null; S.before = null; }
const frame = () => (S.frames ? S.frames[S.fi] : null);
const has = (tok) => { const f = frame(); return !!f && f.hl.split(' ').includes(tok); };
const shownCell = (tech) => { const f = frame(); return f && !f.after && S.before && S.before.kind === tech ? S.before : S.cells[tech]; };

/* ---------- frames ---------- */
const FRAMES = {
  sram: {
    write: (b) => [
      { t: 'Wordline on', hl: 'wl acc' },
      { t: `BL=${b} · BLB=${1 - b}`, hl: 'wl acc bl in', bl: [b, 1 - b] },
      { t: 'Latch flips', hl: 'wl acc bl in q', bl: [b, 1 - b], after: true },
      { t: 'Wordline off · held', hl: 'q', after: true },
    ],
    read: (v) => [
      { t: 'Precharge BL + BLB', hl: 'bl', bl: [1, 1] },
      { t: 'Wordline on', hl: 'wl acc bl', bl: [1, 1] },
      { t: '0-side pulls its BL low', hl: 'wl acc bl out', bl: [v, 1 - v] },
      { t: `Sense: ${v}`, hl: 'q', bl: [v, 1 - v], after: true },
    ],
  },
  dram: {
    write: (b) => [
      { t: 'Wordline on', hl: 'wl acc' },
      { t: `BL drives ${b}`, hl: 'wl acc in' },
      { t: b ? 'Capacitor charged' : 'Capacitor drained', hl: 'wl acc in cap', after: true },
      { t: 'Wordline off · leaks', hl: 'cap', after: true },
    ],
    read: (v, word) => [
      { t: 'Wordline on', hl: 'wl acc' },
      { t: 'Charge shares onto BL', hl: 'wl acc out' },
      { t: `Sense amp: ${v}`, hl: 'wl acc sa' },
      { t: `${word}: write back ${v}`, hl: 'wl acc in cap', after: true },
    ],
  },
  flash: {
    program: () => [
      { t: 'High voltage on gate', hl: 'gate' },
      { t: 'e⁻ pushed into storage', hl: 'gate up' },
      { t: 'More charge · Vt raised', hl: 'store', after: true },
    ],
    erase: (topo) => [
      { t: `High voltage on well · whole ${topo === 'nand' ? 'block' : 'sector'}`, hl: 'sub' },
      { t: 'e⁻ pulled out', hl: 'sub down' },
      { t: 'Less charge · Vt low → all 1s', hl: 'store', after: true },
    ],
    read: (bits, slc, conduct) => [
      { t: slc ? 'Vread on gate' : 'Step through read levels', hl: 'gate' },
      { t: slc ? (conduct ? 'Vt < Vread: current' : 'Vt > Vread: no current') : 'Find Vt window', hl: conduct ? 'gate ch' : 'gate' },
      { t: `Sense: ${bits}`, hl: conduct ? 'ch' : '', after: true },
    ],
  },
};


/* ---------- actions ---------- */
function cellOp(op, arg) {
  const tech = S.tech; const before = S.cells[tech];
  const r = act(before, op, arg);
  S.bad = !!r.error;
  if (r.error) { clearFrames(); S.msg = errText(r.error, before); return; }
  S.cells[tech] = r.cell;
  const c = r.cell;
  if (op === 'power') {
    clearFrames(); leakClock.cancel();
    S.msg = c.powered
      ? (tech === 'flash' ? 'Power on: data still there' : 'Power on: contents unknown (?)')
      : (tech === 'flash' ? 'Power off: trapped charge kept' : 'Power off: data lost');
    return;
  }
  if (tech === 'sram') {
    if (op === 'write') { startFrames(FRAMES.sram.write(arg), before); S.msg = `Stored ${arg}: Q=${arg}, Q̄=${1 - arg}`; }
    if (op === 'read') {
      if (r.value === null) { clearFrames(); S.msg = 'Unknown: write first'; return; }
      startFrames(FRAMES.sram.read(r.value), before); S.msg = `Read ${r.value} · latch unchanged`;
    }
  }
  if (tech === 'dram') {
    if (op === 'write') { startFrames(FRAMES.dram.write(arg), before); S.msg = arg ? 'Stored 1: capacitor charged' : 'Stored 0: capacitor empty'; }
    if (op === 'read' || op === 'refresh') {
      if (r.value === null) { clearFrames(); S.msg = 'Unknown: write first'; return; }
      const word = op === 'read' ? 'Restore' : 'Refresh';
      startFrames(FRAMES.dram.read(r.value, word), before);
      S.msg = c.lost && !before.lost ? 'Too late: decayed 1 restored as 0'
        : op === 'read' ? `Read ${r.value} · charge restored` : `Refreshed ${r.value} · full again`;
    }
  }
  if (tech === 'flash') {
    if (op === 'program') {
      startFrames(c.level === before.level ? [{ t: 'No change', hl: '', after: true }] : FRAMES.flash.program(), before);
      S.msg = `Programmed → reads ${bitsAt(c.level, c.bits)}`;
    }
    if (op === 'erase') { startFrames(FRAMES.flash.erase(c.topo), before); S.msg = `Erased ${c.topo === 'nand' ? 'block' : 'sector'} → reads ${bitsAt(0, c.bits)}`; }
    if (op === 'read') { startFrames(FRAMES.flash.read(r.value, c.bits === 1, c.level === 0), before); S.msg = `Read ${r.value}`; }
  }
}

function stopAll() { clocks.forEach((c) => c.cancel()); S.frames = null; S.before = null; S.bad = false; }

const ACTIONS = {
  view: (v) => { stopAll(); S.view = v; S.msg = VIEW_MSG[v](); },
  tech: (v) => { stopAll(); S.tech = v; S.msg = techMsg(); },
  op: (v, arg) => { if (v === 'write') leakClock.cancel(); cellOp(v, arg === undefined ? undefined : (S.tech === 'flash' ? arg : Number(arg))); },
  topo: (v) => { stopAll(); S.cells.flash = makeCell('flash', { bits: S.cells.flash.bits, topo: v }); S.msg = v === 'nand' ? 'NAND: erase by block' : 'NOR: erase by sector'; },
  levels: (v) => { stopAll(); S.cells.flash = makeCell('flash', { bits: Number(v), topo: S.cells.flash.topo }); S.msg = `${v} bit${v > 1 ? 's' : ''}/cell → ${levelsFor(v)} Vt windows`; },
  anim: (v) => {
    if (!S.frames) return;
    if (v !== 'pause' && S.fi === S.frames.length - 1) { opClock.reset(); if (v === 'step') return; }
    opClock[v]();
  },
  leak: (v) => { if (S.cells.dram.charge !== null) leakClock[v](); },
  place: (v) => { S.place = v; const p = PLACES[v]; S.msg = `${p.label} → ${techName(p)}`; },
  open: () => { const p = PLACES[S.place]; stopAll(); S.view = 'bit'; S.tech = p.tech;
    if (p.topo) S.cells.flash = makeCell('flash', { bits: 1, topo: p.topo }); S.msg = techMsg(); },
  sel: (v) => { clearFrames(); S.sel = Number(v); S.msg = `Cell ${v} selected · holds ${S.bits[v]}`; },
  arr: (v) => {
    clearFrames(); S.bad = false;
    const i = S.sel;
    if (v === 'read') {
      const r = readPath('nand', S.bits, i);
      startFrames([
        { t: 'Bias wordlines', hl: 'bias' },
        { t: r.current ? 'Current flows' : 'Blocked: no current', hl: 'bias path' },
        { t: `Sense: ${S.bits[i]}`, hl: 'bias path', after: true },
      ], null);
      S.msg = `Cell ${i} reads ${S.bits[i]} in both · different paths`;
    }
    if (v === 'program') { S.bits = S.bits.map((b, j) => (j === i ? 0 : b)); S.msg = `Cell ${i} programmed → 0`; }
    if (v === 'program1') { if (S.bits[i] === 0) { S.bad = true; S.msg = errText('erase-first'); } else S.msg = `Cell ${i} already 1`; }
    if (v === 'erase') { S.bits = S.bits.map(() => 1); S.msg = 'Erased block / sector → all 1'; }
  },
  vram: (v) => { stopAll(); S.vram = v; S.pulse = 0; S.msg = v === 'gddr' ? 'GDDR: flat packages on the board' : 'HBM: stacked DRAM beside the GPU'; },
  bus: (v) => busClock[v](),
};

const techName = (p) => (p.tech === 'flash' ? `${p.topo.toUpperCase()} flash` : p.tech.toUpperCase()) + ' cells';
function techMsg() {
  if (S.tech === 'sram') return 'SRAM: 2 inverters hold each other';
  if (S.tech === 'dram') return 'DRAM: charge in a capacitor (charged = 1)';
  return 'Flash: trapped charge sets threshold Vt';
}
const VIEW_MSG = {
  bit: techMsg,
  where: () => 'Pick a part: same role ≠ same cell',
  topo: () => 'Same cells, different wiring',
  vram: () => 'VRAM is a role · GDDR and HBM are both DRAM',
};

/* ---------- SVG helpers ---------- */
const tx = (x, y, s, cls = 'lbl', a = '') => `<text x="${x}" y="${y}" class="${cls}" ${a}>${s}</text>`;
const ln = (x1, y1, x2, y2, cls = 'wire', a = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}" ${a}/>`;
const rc = (x, y, w, h, cls, a = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}" ${a}/>`;
const arrow = (x1, y1, x2, y2, cls = 'arw') => ln(x1, y1, x2, y2, cls, `marker-end="url(#${cls === 'arw-a' ? 'ma' : 'mc'})"`);
const DEFS = `<defs>
<marker id="mc" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--cyan)"/></marker>
<marker id="ma" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--amber)"/></marker>
<pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="var(--dim)" stroke-width="2"/></pattern>
</defs>`;
// Simplified n-FET: channel between x1..x2 at y, gate bar above, gate stem up to gy.
function fet(x1, x2, y, gy, on) {
  const m = (x1 + x2) / 2;
  return ln(x1, y, m - 16, y, 'wire') + ln(m + 16, y, x2, y, 'wire')
    + ln(m - 16, y, m + 16, y, on ? 'chan on' : 'chan')
    + ln(m - 16, y - 9, m + 16, y - 9, on ? 'wire on' : 'wire') + ln(m, y - 9, m, gy, on ? 'wire on' : 'wire');
}
const bitTxt = (v) => (v === null || v === undefined ? '?' : String(v));

/* ---------- views ---------- */
function svgSram() {
  const c = shownCell('sram'); const f = frame() || {};
  const off = !c.powered; const q = c.q; const qb = q === null ? null : 1 - q;
  const wl = has('wl'); const acc = has('acc'); const bl = has('bl');
  const node = (x, v, name) => `<circle cx="${x}" cy="240" r="28" class="node ${v === 1 ? 'hi' : v === 0 ? 'lo' : 'unk'} ${has('q') ? 'flash' : ''}"/>`
    + tx(x, 252, bitTxt(v), 'big mono', 'text-anchor="middle"') + tx(x + (x < 210 ? 38 : -38), 246, name, 'lbl dim', 'text-anchor="middle"');
  let s = DEFS;
  s += ln(20, 50, 400, 50, wl ? 'wire on thick' : 'wire thick') + tx(22, 40, 'WL');
  s += ln(50, 30, 50, 430, bl ? 'wire on thick' : 'wire thick') + ln(370, 30, 370, 430, bl ? 'wire on thick' : 'wire thick');
  s += tx(50, 452, 'BL', 'lbl', 'text-anchor="middle"') + tx(370, 452, 'BLB', 'lbl', 'text-anchor="middle"');
  if (f.bl) s += tx(62, 110, f.bl[0], 'mono val') + tx(358, 110, f.bl[1], 'mono val', 'text-anchor="end"');
  s += fet(50, 112, 240, 50, acc) + fet(308, 370, 240, 50, acc);
  s += tx(81, 268, 'access', 'lbl dim small', 'text-anchor="middle"') + tx(339, 268, 'access', 'lbl dim small', 'text-anchor="middle"');
  // cross-coupled inverters
  const rail = off ? 'wire' : 'wire rail';
  s += ln(170, 118, 250, 118, rail) + tx(210, 108, 'VDD', 'lbl dim small', 'text-anchor="middle"');
  s += ln(170, 362, 250, 362, rail) + tx(210, 384, 'GND', 'lbl dim small', 'text-anchor="middle"');
  s += ln(210, 118, 210, 150, rail) + ln(210, 330, 210, 362, rail);
  s += `<path d="M250 150 L250 190 L182 170 Z" class="inv"/><circle cx="176" cy="170" r="5" class="inv"/>`;
  s += `<path d="M170 290 L170 330 L238 310 Z" class="inv"/><circle cx="244" cy="310" r="5" class="inv"/>`;
  s += tx(226, 176, 'INV', 'lbl dim small', 'text-anchor="middle"') + tx(194, 316, 'INV', 'lbl dim small', 'text-anchor="middle"');
  s += `<polyline points="280,212 280,170 250,170" class="wire fb"/><polyline points="171,170 140,170 140,212" class="wire fb"/>`;
  s += `<polyline points="140,268 140,310 170,310" class="wire fb"/><polyline points="249,310 280,310 280,268" class="wire fb"/>`;
  s += node(140, q, 'Q') + node(280, qb, 'Q̄');
  if (has('in')) s += arrow(56, 228, 104, 228) + arrow(364, 228, 316, 228);
  if (has('out')) s += q === 0 ? arrow(104, 228, 56, 228) : arrow(316, 228, 364, 228);
  if (off) s += rc(120, 140, 180, 200, 'offmask') + tx(210, 410, 'OFF → state lost', 'lbl warn', 'text-anchor="middle"');
  else s += tx(210, 410, '6 transistors · feedback loop', 'lbl dim', 'text-anchor="middle"');
  return { vb: '0 0 420 460', s, title: 'SRAM 6T cell: cross-coupled inverters' };
}

function svgDram() {
  const c = shownCell('dram'); const off = !c.powered;
  const wl = has('wl'); const acc = has('acc');
  const top = 110; const h = 230; const level = c.charge === null ? 0 : c.charge / FULL;
  const ty = top + h - h * (SENSE / FULL);
  const v = c.charge === null ? null : c.charge >= SENSE ? 1 : 0;
  let s = DEFS;
  s += ln(20, 60, 400, 60, wl ? 'wire on thick' : 'wire thick') + tx(22, 50, 'WL');
  s += ln(70, 30, 70, 368, has('out') || has('in') || has('sa') ? 'wire on thick' : 'wire thick') + tx(80, 40, 'BL');
  s += fet(70, 200, 210, 60, acc) + tx(135, 236, 'access', 'lbl dim small', 'text-anchor="middle"');
  s += ln(200, 210, 240, 210, 'wire');
  s += rc(240, top, 110, h, 'bucket');
  if (off) s += rc(242, top + 2, 106, h - 4, '', 'fill="url(#hatch)"');
  else s += rc(242, top + h - (h - 4) * level - 2, 106, (h - 4) * level, `charge ${has('cap') ? 'flash' : ''}`);
  s += ln(236, ty, 354, ty, 'thresh') + tx(232, ty + 18, 'threshold', 'lbl dim small', 'text-anchor="end"');
  s += tx(295, top - 10, 'capacitor', 'lbl dim', 'text-anchor="middle"');
  s += tx(295, top + 70, bitTxt(v), 'big mono', 'text-anchor="middle"');
  s += ln(295, top + h, 295, 370, 'wire') + ln(275, 370, 315, 370, 'wire') + ln(282, 378, 308, 378, 'wire') + ln(289, 386, 301, 386, 'wire');
  if (!off && c.charge > 0) s += arrow(352, 300, 392, 320, 'arw-a') + tx(398, 344, 'leak', 'lbl amber small', 'text-anchor="end"');
  if (has('out')) s += arrow(236, 196, 82, 196, 'arw-a');
  if (has('in')) s += arrow(82, 196, 236, 196);
  s += `<path d="M40 370 L100 370 L70 410 Z" class="inv ${has('sa') ? 'on' : ''}"/>` + tx(110, 400, 'sense amp', 'lbl dim');
  if (c.lost) s += tx(295, 436, 'decayed 1 → 0', 'lbl warn', 'text-anchor="middle"');
  else if (off) s += tx(295, 436, 'OFF → data lost', 'lbl warn', 'text-anchor="middle"');
  else s += tx(295, 436, 'charged = 1 (convention)', 'lbl dim', 'text-anchor="middle"');
  return { vb: '0 0 420 460', s, title: 'DRAM 1T1C cell: access transistor and capacitor' };
}

function svgFlash() {
  const c = shownCell('flash'); const n = levelsFor(c.bits);
  const electrons = 3 + Math.round((c.level / (n - 1)) * 21); // never zero: erased still holds some charge
  let s = DEFS;
  s += ln(145, 34, 145, 110, has('gate') ? 'wire on thick' : 'wire thick') + tx(152, 50, 'WL (gate)');
  s += rc(60, 110, 170, 40, `gate ${has('gate') ? 'on' : ''}`) + tx(145, 136, 'control gate', 'lbl', 'text-anchor="middle"');
  s += rc(60, 150, 170, 8, 'oxide');
  s += rc(60, 158, 170, 44, `store ${has('store') ? 'flash' : ''}`);
  for (let i = 0; i < electrons; i++) {
    const x = 72 + (i % 12) * 13.5; const y = 172 + Math.floor(i / 12) * 16;
    s += `<circle cx="${x}" cy="${y}" r="5" class="e"/>`;
  }
  s += rc(60, 202, 170, 8, 'oxide');
  s += rc(20, 210, 250, 62, `sub ${has('sub') ? 'on' : ''}`);
  s += rc(20, 210, 50, 30, 'well') + rc(220, 210, 50, 30, 'well');
  s += tx(45, 231, 'S', 'lbl', 'text-anchor="middle"') + tx(245, 231, 'D', 'lbl', 'text-anchor="middle"');
  s += ln(70, 218, 220, 218, has('ch') ? 'chan on thick' : 'chan');
  s += tx(145, 262, 'channel', 'lbl dim small', 'text-anchor="middle"');
  if (has('up')) for (const x of [100, 145, 190]) s += arrow(x, 236, x, 190, 'arw-a');
  if (has('down')) for (const x of [100, 145, 190]) s += arrow(x, 176, x, 244, 'arw-a');
  s += tx(20, 298, 'storage: floating gate', 'lbl dim small') + tx(20, 316, 'or charge trap · e⁻ = amber', 'lbl dim small');
  // Vt ladder
  const y0 = 430; const H = 380; const h = H / n;
  s += arrow(296, y0, 296, 30) + tx(304, 34, 'Vt', 'lbl mono');
  for (let i = 0; i < n; i++) {
    const y = y0 - (i + 1) * h; const cur = i === c.level;
    s += rc(306, y + 1.5, 104, h - 3, `win ${cur ? 'cur' : ''}`);
    const lab = c.bits === 1 ? (i === 0 ? '1 erased' : '0 prog') : bitsAt(i, c.bits);
    s += tx(358, y + h / 2 + 5, lab, `mono ${n > 8 ? 'small' : 'val'} ${cur ? 'ink' : ''}`, 'text-anchor="middle"');
    if (i > 0) s += ln(300, y + h, 414, y + h, 'thresh');
  }
  if (c.bits === 1) s += tx(410, y0 - h - 8, 'Vread', 'lbl dim small', 'text-anchor="end"');
  const val = bitsAt(c.level, c.bits);
  s += tx(20, 366, 'reads', 'lbl dim') + tx(70, 370, val, 'big mono');
  s += tx(20, 404, c.powered ? 'power off → kept' : 'OFF · charge kept', c.powered ? 'lbl dim' : 'lbl amber');
  s += tx(20, 428, `program: Vt ↑ only`, 'lbl dim small');
  s += tx(20, 448, `erase: whole ${c.topo === 'nand' ? 'block' : 'sector'}`, 'lbl dim small');
  return { vb: '0 0 420 460', s, title: `Flash cell, ${c.bits} bit per cell, threshold voltage ladder` };
}

function svgWhere() {
  const sel = S.place; const t = techOf(sel);
  const box = (id, x, y, w, h, lab, cls = '') => {
    const p = PLACES[id];
    const k = id === sel ? 'sel' : p.tech === t ? 'same' : '';
    return `<g class="place ${k}" data-a="place" data-v="${id}">${rc(x, y, w, h, `pbox ${p.optional ? 'opt' : ''} ${cls}`)}${tx(x + w / 2, y + h / 2 + 5, lab, 'lbl', 'text-anchor="middle"')}</g>`;
  };
  let s = DEFS;
  s += rc(10, 10, 400, 160, 'die') + tx(20, 32, 'CPU', 'lbl head');
  for (const x of [20, 215]) {
    s += rc(x, 42, 185, 80, 'core') + tx(x + 8, 60, 'core', 'lbl dim small');
    s += box('cpu-l0', x + 8, 68, 50, 46, 'L0') + box('cpu-l1', x + 66, 68, 52, 46, 'L1') + box('cpu-l2', x + 126, 68, 52, 46, 'L2');
  }
  s += box('cpu-l3', 20, 128, 380, 36, 'L3 · shared');
  s += rc(10, 182, 400, 178, 'die') + tx(20, 204, 'GPU', 'lbl head');
  for (let i = 0; i < 4; i++) {
    const x = 20 + i * 96;
    s += rc(x, 212, 90, 76, 'core') + tx(x + 6, 229, 'SM/CU', 'lbl dim small');
    s += box('gpu-l0', x + 4, 238, 36, 44, 'L0') + box('gpu-l1', x + 44, 238, 42, 44, 'L1');
  }
  s += box('gpu-l2', 20, 294, 380, 28, 'L2 · shared') + box('gpu-llc', 20, 326, 380, 28, 'extra LLC · some');
  s += box('host-dram', 10, 374, 130, 58, 'DDR DRAM') + box('vram', 148, 374, 124, 58, 'VRAM') + box('fw-nor', 280, 374, 130, 58, 'NOR firmware');
  s += rc(10, 442, 400, 108, 'die') + tx(20, 462, 'SSD', 'lbl head');
  s += box('ssd-ctrl', 20, 472, 110, 68, 'controller') + box('ssd-dram', 138, 472, 90, 68, 'DRAM opt.') + box('ssd-nand', 236, 472, 164, 68, 'NAND flash');
  return { vb: '0 0 420 560', s, title: 'System map: CPU, GPU, memory and SSD' };
}

const NAND_X = 110; const NOR_X = 320; const ROW = (i) => 92 + i * 40;
function svgTopo() {
  const sel = S.sel;
  const bias = has('bias'); const lit = has('path');
  const rn = readPath('nand', S.bits, sel); const rr = readPath('nor', S.bits, sel);
  const cell = (x, i, onPath) => {
    const b = S.bits[i];
    return `<g class="place ${i === sel ? 'sel' : ''}" data-a="sel" data-v="${i}">${rc(x - 22, ROW(i) - 14, 44, 28, `pbox ${b === 0 ? 'prog' : ''} ${onPath ? 'lit' : ''}`)}`
      + tx(x, ROW(i) + 6, b, 'mono val', 'text-anchor="middle"') + '</g>';
  };
  let s = DEFS;
  s += tx(NAND_X, 22, 'NAND · series', 'lbl head', 'text-anchor="middle"') + tx(NOR_X, 22, 'NOR · parallel', 'lbl head', 'text-anchor="middle"');
  // NAND string
  const nOn = lit && rn.current;
  s += tx(NAND_X + 8, 44, 'BL', 'lbl') + ln(NAND_X, 30, NAND_X, 410, nOn ? 'wire on thick' : 'wire thick');
  s += tx(NAND_X + 8, 428, 'SL', 'lbl');
  for (let i = 0; i < 8; i++) {
    s += cell(NAND_X, i, nOn);
    if (bias) s += tx(NAND_X - 30, ROW(i) + 5, i === sel ? 'read' : 'pass', i === sel ? 'lbl on small' : 'lbl dim small', 'text-anchor="end"');
  }
  if (lit && !rn.current) s += tx(NAND_X + 28, ROW(sel) + 5, '✕', 'lbl warn');
  if (nOn) s += arrow(NAND_X + 30, 60, NAND_X + 30, 400);
  // NOR column
  const BLX = 400; const SLX = 260; const rOn = lit && rr.current;
  s += tx(BLX - 8, 44, 'BL', 'lbl', 'text-anchor="end"') + ln(BLX, 30, BLX, 410, rOn ? 'wire on thick' : 'wire thick');
  s += tx(SLX + 8, 44, 'SL', 'lbl') + ln(SLX, 30, SLX, 410, 'wire thick');
  for (let i = 0; i < 8; i++) {
    const on = rOn && i === sel;
    s += ln(SLX, ROW(i), NOR_X - 22, ROW(i), on ? 'wire on' : 'wire') + ln(NOR_X + 22, ROW(i), BLX, ROW(i), on ? 'wire on' : 'wire');
    s += cell(NOR_X, i, on);
    if (bias) s += tx(SLX - 6, ROW(i) + 5, i === sel ? 'read' : 'off', i === sel ? 'lbl on small' : 'lbl dim small', 'text-anchor="end"');
  }
  if (lit && !rr.current) s += tx(NOR_X + 28, ROW(sel) - 14, '✕', 'lbl warn');
  if (rOn) s += arrow(BLX - 6, ROW(sel) - 10, NOR_X + 26, ROW(sel) - 10);
  // tradeoff bars (qualitative)
  const bar = (y, label, a, b) => tx(210, y, label, 'lbl dim small', 'text-anchor="middle"')
    + rc(NAND_X - 70 + (140 - a), y + 6, a, 12, 'barn') + rc(NOR_X - 70, y + 6, b, 12, 'barr');
  s += bar(452, 'density', 140, 70) + bar(486, 'random read', 60, 140);
  s += tx(NAND_X, 530, 'reads by page', 'lbl', 'text-anchor="middle"') + tx(NOR_X, 530, 'random bytes · XIP', 'lbl', 'text-anchor="middle"');
  return { vb: '0 0 420 545', s, title: 'NAND series string versus NOR parallel cells' };
}

function svgVram() {
  const g = S.vram === 'gddr'; const p = S.pulse;
  const pulse = (x1, y1, x2, y2, speed, off) => {
    if (!busClock.playing && p === 0) return '';
    const k = (p * speed + off) % 1;
    return `<circle cx="${x1 + (x2 - x1) * k}" cy="${y1 + (y2 - y1) * k}" r="3.5" class="pulse"/>`;
  };
  let s = DEFS + tx(14, 22, 'top view', 'lbl dim small') + tx(14, 286, 'side view', 'lbl dim small');
  if (g) {
    s += rc(10, 30, 400, 230, 'board') + tx(400, 252, 'PCB', 'lbl dim small', 'text-anchor="end"');
    s += rc(160, 95, 100, 100, 'gpu') + tx(210, 150, 'GPU', 'lbl head', 'text-anchor="middle"');
    const pk = [[120, 40], [250, 40], [120, 216], [250, 216], [30, 90], [30, 160], [340, 90], [340, 160]];
    pk.forEach(([x, y], i) => {
      s += rc(x, y, 50, 34, 'pkg') + tx(x + 25, y + 22, 'GDDR', 'lbl small', 'text-anchor="middle"');
      const cx = x + 25; const cy = y + 17; const tx2 = Math.min(Math.max(cx, 165), 255); const ty2 = Math.min(Math.max(cy, 100), 190);
      for (const d of [-5, 5]) {
        const vert = y === 40 || y === 216;
        const a = vert ? [cx + d, y === 40 ? y + 34 : y, tx2 + d, ty2] : [x === 30 ? x + 50 : x, cy + d, tx2, cy + d];
        s += ln(...a, 'trace') + pulse(...a, 0.23, (i * 0.13 + (d > 0 ? 0.5 : 0)) % 1);
      }
    });
    s += rc(10, 430, 400, 22, 'board') + tx(400, 470, 'PCB traces', 'lbl dim small', 'text-anchor="end"');
    s += rc(150, 390, 120, 40, 'pkg') + rc(175, 368, 70, 22, 'gpu') + tx(210, 384, 'GPU', 'lbl small', 'text-anchor="middle"');
    for (const x of [30, 310]) s += rc(x, 400, 80, 30, 'pkg') + tx(x + 40, 420, 'GDDR', 'lbl small', 'text-anchor="middle"');
    s += ln(110, 441, 150, 441, 'trace') + ln(270, 441, 310, 441, 'trace');
    s += tx(210, 330, 'flat DRAM packages', 'lbl', 'text-anchor="middle"') + tx(210, 352, 'narrower bus · fast pins', 'lbl on', 'text-anchor="middle"');
  } else {
    s += rc(10, 30, 400, 230, 'board') + tx(400, 252, 'package', 'lbl dim small', 'text-anchor="end"');
    s += rc(48, 56, 324, 178, 'interp') + tx(56, 72, 'interposer / bridge', 'lbl dim small');
    s += rc(160, 90, 100, 110, 'gpu') + tx(210, 150, 'GPU', 'lbl head', 'text-anchor="middle"');
    [[66, 82], [66, 150], [290, 82], [290, 150]].forEach(([x, y], i) => {
      s += rc(x, y, 66, 58, 'pkg stack') + tx(x + 33, y + 34, 'HBM', 'lbl small', 'text-anchor="middle"');
      const right = x < 160; const xa = right ? x + 66 : x; const xb = right ? 160 : 260;
      for (let k = 0; k < 10; k++) {
        const yy = y + 5 + k * 5;
        s += ln(xa, yy, xb, yy, 'trace thin') + pulse(xa, yy, xb, yy, 0.08, (k * 0.1 + i * 0.25) % 1);
      }
    });
    s += rc(10, 446, 400, 18, 'board') + tx(400, 482, 'package substrate', 'lbl dim small', 'text-anchor="end"');
    s += rc(40, 426, 340, 20, 'interp') + tx(370, 440, 'interposer', 'lbl dim small', 'text-anchor="end"');
    s += rc(230, 378, 120, 48, 'gpu') + tx(290, 407, 'GPU die', 'lbl small', 'text-anchor="middle"');
    s += rc(60, 406, 110, 20, 'pkg') + tx(176, 421, 'base', 'lbl small');
    for (let k = 0; k < 4; k++) s += rc(60, 384 - k * 22, 110, 20, 'pkg stack');
    s += tx(176, 336, 'DRAM dies', 'lbl small');
    for (const x of [78, 100, 130, 152]) s += ln(x, 320, x, 426, 'tsv');
    s += tx(176, 356, 'TSVs', 'lbl on small');
    for (let k = 0; k < 6; k++) s += ln(170, 430 + k * 2.4, 230, 430 + k * 2.4, 'trace thin');
    s += tx(292, 302, 'stacked DRAM · very wide bus', 'lbl', 'text-anchor="middle"');
    s += tx(292, 324, 'slower pins · short wires', 'lbl on', 'text-anchor="middle"');
  }
  s += tx(210, 498, 'both: DRAM 1T1C · refresh · volatile', 'lbl amber small', 'text-anchor="middle"');
  return { vb: '0 0 420 505', s, title: g ? 'GDDR: separate DRAM packages around the GPU' : 'HBM: stacked DRAM dies on an advanced package beside the GPU' };
}

/* ---------- controls ---------- */
const btn = (a, v, label, { on = false, cls = '', arg, dis = false } = {}) =>
  `<button type="button" class="b ${cls}" data-a="${a}" data-v="${v}"${arg !== undefined ? ` data-arg="${arg}"` : ''}${
    on !== null ? ` aria-pressed="${on}"` : ''}${dis ? ' disabled' : ''}>${label}</button>`;
const act1 = (a, v, label, o = {}) => btn(a, v, label, { ...o, on: null });
const row = (label, inner) => `<div class="row" role="group" aria-label="${label}"><span class="rl">${label}</span><div class="btns">${inner}</div></div>`;
const animRow = (a, clk, { reset = true } = {}) => row(a === 'anim' ? 'Steps' : a === 'leak' ? 'Time' : 'Bus',
  act1(a, clk.playing ? 'pause' : 'play', clk.playing ? '❚❚ Pause' : '▶ Play') + act1(a, 'step', 'Step') + (reset ? act1(a, 'reset', 'Reset') : ''));

function controlsBit() {
  const t = S.tech; const c = S.cells[t];
  let h = row('Cell', ['sram', 'dram', 'flash'].map((k) => btn('tech', k, k === 'flash' ? 'Flash' : k.toUpperCase(), { on: t === k })).join(''));
  if (t === 'flash') {
    h += row('Type', btn('topo', 'nand', 'NAND', { on: c.topo === 'nand' }) + btn('topo', 'nor', 'NOR', { on: c.topo === 'nor' }));
    h += c.topo === 'nand'
      ? row('Bits/cell', [['1', 'SLC'], ['2', 'MLC'], ['3', 'TLC'], ['4', 'QLC']].map(([b, l]) => btn('levels', b, l, { on: c.bits === Number(b) })).join(''))
      : row('Bits/cell', '<span class="note">SLC · this NOR view models common SLC</span>');
    const progs = c.bits === 1
      ? act1('op', 'program', 'Program 0', { arg: '0' }) + act1('op', 'program', 'Write 1', { arg: '1' })
      : Array.from({ length: levelsFor(c.bits) }, (_, i) => act1('op', 'program', bitsAt(i, c.bits), { arg: bitsAt(i, c.bits), cls: 'mono sq' })).join('');
    h += row(c.bits === 1 ? 'Write' : 'Program', progs);
    h += row('Do', act1('op', 'erase', c.topo === 'nand' ? 'Erase block' : 'Erase sector') + act1('op', 'read', 'Read')
      + btn('op', 'power', c.powered ? 'Power off' : 'Power on', { on: !c.powered }));
  } else {
    h += row('Write', act1('op', 'write', 'Write 0', { arg: 0 }) + act1('op', 'write', 'Write 1', { arg: 1 }));
    h += row('Do', act1('op', 'read', 'Read') + (t === 'dram' ? act1('op', 'refresh', 'Refresh') : '')
      + btn('op', 'power', c.powered ? 'Power off' : 'Power on', { on: !c.powered }));
    if (t === 'dram') h += animRow('leak', leakClock);
  }
  if (S.frames && S.frames.length > 1) h += animRow('anim', opClock);
  return h;
}

const GROUPS = [['CPU', ['cpu-l0', 'cpu-l1', 'cpu-l2', 'cpu-l3', 'host-dram']],
  ['GPU', ['gpu-l0', 'gpu-l1', 'gpu-l2', 'gpu-llc', 'vram']], ['Storage', ['ssd-ctrl', 'ssd-dram', 'ssd-nand', 'fw-nor']]];
const SHORT = { 'cpu-l0': 'L0', 'cpu-l1': 'L1', 'cpu-l2': 'L2', 'cpu-l3': 'L3', 'host-dram': 'DRAM', 'gpu-l0': 'L0', 'gpu-l1': 'L1', 'gpu-l2': 'L2',
  'gpu-llc': 'LLC', vram: 'VRAM', 'ssd-ctrl': 'Ctrl', 'ssd-dram': 'SSD DRAM', 'ssd-nand': 'NAND', 'fw-nor': 'NOR' };
function controlsWhere() {
  const p = PLACES[S.place];
  let h = GROUPS.map(([g, ids]) => row(g, ids.map((id) => btn('place', id, SHORT[id], { on: S.place === id })).join(''))).join('');
  h += `<div class="card"><svg viewBox="0 0 120 70" class="mini" aria-hidden="true">${mini(p.tech)}</svg><div>
    <p class="k">Role</p><p>${p.role}</p><p class="k">Cell</p><p class="on">${techName(p)}</p></div></div>`;
  h += row('Go', act1('open', 'x', 'Open bit cell →'));
  return h;
}
function mini(t) {
  if (t === 'sram') return '<path d="M70 15 L70 35 L44 25Z" class="inv"/><path d="M50 37 L50 57 L76 47Z" class="inv"/><polyline points="70,25 90,25 90,47 76,47" class="wire"/><polyline points="44,25 30,25 30,47 50,47" class="wire"/>';
  if (t === 'dram') return `${ln(10, 40, 50, 40)}${ln(30, 30, 30, 15, 'wire')}${rc(60, 15, 40, 45, 'bucket')}${rc(62, 32, 36, 26, 'charge')}`;
  return `${rc(25, 8, 70, 16, 'gate')}${rc(25, 28, 70, 16, 'store')}${[35, 50, 65, 80].map((x) => `<circle cx="${x}" cy="36" r="4" class="e"/>`).join('')}${rc(10, 50, 100, 16, 'sub')}`;
}

function controlsTopo() {
  let h = row('Cell', S.bits.map((b, i) => btn('sel', i, String(i), { on: S.sel === i, cls: 'mono sq' })).join(''));
  h += row('Do', act1('arr', 'read', 'Read') + act1('arr', 'program', 'Program 0') + act1('arr', 'program1', 'Write 1') + act1('arr', 'erase', 'Erase all'));
  if (S.frames && S.frames.length > 1) h += animRow('anim', opClock);
  return h;
}
function controlsVram() {
  return row('Type', btn('vram', 'gddr', 'GDDR', { on: S.vram === 'gddr' }) + btn('vram', 'hbm', 'HBM', { on: S.vram === 'hbm' }))
    + animRow('bus', busClock) + row('Go', act1('view', 'bit', 'DRAM cell →', { arg: 'dram' }));
}

const NOTES = {
  bit: () => ({
    sram: ['Typical 6T shown; 8T and other variants exist.', 'Two inverters drive each other: Q and Q̄ stay opposite while powered.', 'No refresh needed. Power loss → contents undefined.'],
    dram: ['Simplified 1T1C. Charged = 1 is this diagram\'s convention; real arrays may invert per bitline.', 'Reading a row shares cell charge with the bitlines (destructive); sense amps resolve it and restore the row. Software data is not lost by reading.', 'Charge leaks; periodic refresh rewrites it. Retention time varies; no numbers implied.'],
    flash: ['Simplified SLC threshold model. Erased = low Vt = 1; programmed = high Vt = 0. Both hold some charge.', 'Storage layer: floating gate (conductor) or charge trap (insulator) — different physics, same Vt idea.', 'Program raises Vt only. Erase works on a whole block (NAND) or sector (NOR) — the single-cell erase here stands in for that.', 'NAND MLC/TLC/QLC: 4/8/16 Vt windows for 2/3/4 bits. Bit labels here are illustrative, not a real code.'],
  })[S.tech],
  where: () => ['Cache levels are positions in a hierarchy, not cell species. Typical caches use SRAM.', 'L0 and extra LLC are architecture-specific (dashed). Not every chip has L0–L3; L0 names different things (e.g. NVIDIA Turing: L0 instruction cache, separate from registers).', 'GPU L1 often shares SRAM with scratchpad ("shared memory"). Generic map, not one product.', 'SSD = NAND + controller (ECC, wear leveling, bad blocks). Onboard DRAM optional: DRAM-less designs exist, some using host memory (HMB).', 'NOR usually holds firmware, not bulk SSD data.', 'Sizes and latencies vary; none implied.'],
  topo: () => ['Same trapped-charge cell, different wiring.', 'NAND: cells in series; unselected ones get a pass voltage, so one read current crosses the whole string. Dense; reads/programs by page, erases by block.', 'NOR: cells in parallel on the bitline; random byte/word reads, execute-in-place. Larger per bit; erases by sector.', 'Cell wiring ≠ external bus: "serial NOR" is an interface. SSDs still serve random reads via the controller.', 'Neither replaces SRAM caches: flash writes slowly and wears out.'],
  vram: () => ['VRAM = GPU memory role (historically also a dual-ported video RAM chip). GDDR and HBM are both DRAM (1T1C cells, refresh, volatile).', 'GDDR: separate packages on the board; fewer, faster-signaling pins per device.', 'HBM: DRAM dies stacked with TSVs on a base die, beside the GPU on an interposer or bridge; very wide, short interface.', 'HBM is also used outside graphics. Near the GPU ≠ cache: it is still DRAM.', 'Lane counts, die counts and pulse speeds here are illustrative; no latency or bandwidth claim.'],
};

/* ---------- render ---------- */
const RENDER = { bit: () => ({ sram: svgSram, dram: svgDram, flash: svgFlash })[S.tech](), where: svgWhere, topo: svgTopo, vram: svgVram };
const CONTROLS = { bit: controlsBit, where: controlsWhere, topo: controlsTopo, vram: controlsVram };

function render() {
  const focus = document.activeElement?.dataset?.a ? `[data-a="${document.activeElement.dataset.a}"][data-v="${document.activeElement.dataset.v}"]` : null;
  const focusArg = document.activeElement?.dataset?.arg;
  const d = RENDER[S.view]();
  const svg = $('#diagram');
  svg.setAttribute('viewBox', d.vb);
  svg.innerHTML = `<title>${d.title}</title>${d.s}`;
  svg.setAttribute('aria-label', d.title);
  svg.classList.toggle('bad', S.bad);
  $('#status').classList.toggle('bad', S.bad);
  document.querySelectorAll('nav [data-a="view"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.view)));
  $('#controls').innerHTML = CONTROLS[S.view]();
  if ($('#status').textContent !== S.msg) $('#status').textContent = S.msg;
  const f = frame();
  $('#phase').textContent = f ? `${S.fi + 1}/${S.frames.length} · ${f.t}` : '';
  $('#notes').innerHTML = NOTES[S.view]().map((n) => `<li>${n}</li>`).join('');
  if (focus) {
    const all = [...document.querySelectorAll(`#controls ${focus}, nav ${focus}`)];
    (all.find((e) => e.dataset.arg === focusArg) || all[0])?.focus();
  }
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el || el.disabled) return;
  const { a, v, arg } = el.dataset;
  if (a === 'view' && arg) { ACTIONS.view(v); ACTIONS.tech(arg); } else ACTIONS[a](v, arg);
  render();
});

S.cells.sram = act(S.cells.sram, 'write', 1).cell;
S.cells.dram = act(S.cells.dram, 'write', 1).cell;
S.msg = techMsg();
render();
