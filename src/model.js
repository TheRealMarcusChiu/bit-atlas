// Deterministic teaching model. Abstract charge steps, not volts or nanoseconds.

export const FULL = 4;  // DRAM capacitor "full" in abstract steps
export const SENSE = 2; // charge >= SENSE senses as 1 (site convention: charged = 1)

export const levelsFor = (bits) => 2 ** bits;
// Illustrative mapping: level 0 (erased, lowest Vt) = all ones, counting down. Real parts use other (Gray-like) codes.
export const bitsAt = (level, bits) => (levelsFor(bits) - 1 - level).toString(2).padStart(bits, '0');
export const levelOf = (label, bits) => levelsFor(bits) - 1 - parseInt(label, 2);

export function makeCell(kind, { bits = 1, topo = 'nand' } = {}) {
  if (kind === 'sram') return { kind, powered: true, q: 0 };
  if (kind === 'dram') return { kind, powered: true, charge: 0, lost: false };
  // The NOR view models common SLC NOR only; multi-level ladder is NAND-only.
  return { kind: 'flash', topo, bits: topo === 'nor' ? 1 : bits, level: 0, powered: true };
}

export function errText(error, cell) {
  if (error === 'erase-first') return cell && cell.bits > 1 ? 'Blocked: lower Vt needs erase first' : 'Blocked: 0→1 needs erase first';
  return { off: 'Power is off', 'n/a': 'Not needed here' }[error];
}

const ok = (cell, extra) => ({ cell, ...extra });
const no = (cell, error) => ({ cell, error });

export function act(c, op, arg) {
  if (op === 'power') {
    if (c.powered) {
      if (c.kind === 'sram') return ok({ ...c, powered: false, q: null });
      if (c.kind === 'dram') return ok({ ...c, powered: false, charge: null });
      return ok({ ...c, powered: false }); // flash: trapped charge stays
    }
    return ok({ ...c, powered: true }); // volatile cells come back unknown (null)
  }
  if (!c.powered) return no(c, 'off');

  if (c.kind === 'sram') {
    if (op === 'write') return ok({ ...c, q: arg });
    if (op === 'read') return ok(c, { value: c.q });
    return no(c, 'n/a'); // leak / refresh don't apply to a powered latch
  }

  if (c.kind === 'dram') {
    if (op === 'write') return ok({ ...c, charge: arg ? FULL : 0, lost: false });
    if (op === 'leak') return ok({ ...c, charge: c.charge === null ? null : Math.max(0, c.charge - 1) });
    if (op === 'read' || op === 'refresh') {
      if (c.charge === null) return ok(c, { value: null });
      const value = c.charge >= SENSE ? 1 : 0;
      // A charged cell that already decayed below the threshold gets "restored" as 0.
      const lost = c.lost || (c.charge > 0 && value === 0);
      return ok({ ...c, charge: value ? FULL : 0, lost }, { value });
    }
    return no(c, 'n/a');
  }

  // flash
  if (op === 'read') return ok(c, { value: bitsAt(c.level, c.bits) });
  if (op === 'erase') return ok({ ...c, level: 0 });
  if (op === 'program') {
    const target = levelOf(String(arg), c.bits);
    if (target < c.level) return no(c, 'erase-first'); // programming only adds charge / raises Vt
    return ok({ ...c, level: target });
  }
  return no(c, 'n/a');
}

// Where it lives: role (what the system uses it for) vs cell technology.
export const PLACES = {
  'cpu-l0':   { device: 'cpu', label: 'L0 / µop cache', role: 'Small front-end cache (some CPUs)', tech: 'sram', optional: true },
  'cpu-l1':   { device: 'cpu', label: 'L1 cache', role: 'Per-core cache', tech: 'sram' },
  'cpu-l2':   { device: 'cpu', label: 'L2 cache', role: 'Per-core or cluster cache', tech: 'sram' },
  'cpu-l3':   { device: 'cpu', label: 'L3 cache', role: 'Shared last-level cache (common)', tech: 'sram' },
  'host-dram':{ device: 'host', label: 'Main memory', role: 'System RAM (DDR DIMM)', tech: 'dram' },
  'gpu-l0':   { device: 'gpu', label: 'L0 cache', role: 'e.g. L0 instruction cache (NVIDIA Turing)', tech: 'sram', optional: true },
  'gpu-l1':   { device: 'gpu', label: 'L1 / shared', role: 'Per-SM/CU cache + scratchpad', tech: 'sram' },
  'gpu-l2':   { device: 'gpu', label: 'L2 cache', role: 'Shared by all SMs/CUs', tech: 'sram' },
  'gpu-llc':  { device: 'gpu', label: 'Extra LLC', role: 'Large last-level cache (some GPUs)', tech: 'sram', optional: true },
  'vram':     { device: 'gpu', label: 'VRAM', role: 'GPU memory (GDDR or HBM)', tech: 'dram' },
  'ssd-ctrl': { device: 'ssd', label: 'SSD controller', role: 'ECC, wear leveling, mapping · on-chip SRAM', tech: 'sram' },
  'ssd-nand': { device: 'ssd', label: 'NAND flash', role: 'Persistent storage', tech: 'flash', topo: 'nand' },
  'ssd-dram': { device: 'ssd', label: 'SSD DRAM', role: 'Mapping/buffer cache · optional (DRAM-less, e.g. HMB)', tech: 'dram', optional: true },
  'fw-nor':   { device: 'host', label: 'Firmware chip', role: 'Boot code, often SPI NOR', tech: 'flash', topo: 'nor' },
};
export const techOf = (id) => PLACES[id].tech;

// Read one cell in an 8-cell NAND string or NOR column. bits[i] = 1 erased (low Vt), 0 programmed.
export function readPath(topo, bits, sel) {
  const current = bits[sel] === 1; // selected cell conducts at Vread only if low Vt
  // NAND: unselected cells get a pass voltage (on regardless), so current must cross the whole series string.
  const path = topo === 'nand' ? bits.map((_, i) => i) : [sel];
  return { current, path };
}

export const makeArray = (topo) => ({ topo, bits: [1, 0, 1, 1, 0, 1, 0, 1] });
export function arrayAct(a, op, i) {
  if (op === 'program') return { arr: { ...a, bits: a.bits.map((b, j) => (j === i ? 0 : b)) } };
  if (op === 'program1') return a.bits[i] === 0 ? { arr: a, error: 'erase-first' } : { arr: a };
  if (op === 'erase') return { arr: { ...a, bits: a.bits.map(() => 1) } };
  return { arr: a };
}

// 3D stacking. Counts are illustrative choices, not product layer/die counts.
// unit: 'layer' = word-line layer inside one die · 'die' = separate chip · 'package' = separate package.
export const STACK_TYPES = ['nand', 'hbm', 'cache', 'pkg'];
export const PKG_KINDS = ['nand', 'dram', 'pop'];
export const STACK_COUNTS = { nand: [4, 8, 16], hbm: [2, 4, 8], cache: [1, 2], pkg: [2, 4, 8] };
const STACK_N = { nand: 8, hbm: 4, cache: 1, pkg: 4 };
export const makeStack = (type = 'nand', pkg = 'nand') => ({ type, n: STACK_N[type], sel: 0, x: false, pkg });

const times = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));
export function stackParts({ type, n, pkg }) {
  if (type === 'nand') return times(n, (i) => ({ unit: 'layer', kind: 'wl', tech: 'flash', label: `Word line ${i}`, fn: `Gate plate: cell ${i} of ${n} on every vertical channel` }));
  if (type === 'hbm') return [{ unit: 'die', kind: 'base', tech: null, label: 'Base die', fn: 'Logic / interface die under the DRAM (optional in some stacks)' },
    ...times(n, (i) => ({ unit: 'die', kind: 'dram', tech: 'dram', label: `DRAM die ${i}`, fn: 'A whole DRAM chip: 1T1C cells, refresh, volatile; TSVs pass through' }))];
  if (type === 'cache') return [{ unit: 'die', kind: 'compute', tech: null, label: 'Compute die', fn: 'Cores plus their on-die caches' },
    ...times(n, (i) => ({ unit: 'die', kind: 'sram', tech: 'sram', label: n > 1 ? `Cache die ${i}` : 'Cache die', fn: 'Extra SRAM cache (6T latches): still volatile, no refresh' }))];
  if (pkg === 'pop') return [{ unit: 'package', kind: 'soc', tech: null, label: 'Processor package', fn: 'SoC die on its own substrate' },
    { unit: 'package', kind: 'dram-pkg', tech: 'dram', label: 'DRAM package', fn: 'A separate DRAM package soldered on top (package-on-package)' }];
  const nand = pkg === 'nand';
  return times(n, (i) => ({ unit: 'die', kind: nand ? 'nand-die' : 'dram-die', tech: nand ? 'flash' : 'dram', label: `${nand ? 'NAND' : 'DRAM'} die ${i}`,
    fn: nand ? 'Separate NAND die; each has its own 3D layers inside' : 'Separate DRAM die sharing one package' }));
}

// Bottom-up boxes between top..bottom (SVG y grows down). Exploded = wider gaps.
export function stackLayout(n, exploded, top = 80, bottom = 380) {
  const gap = exploded ? (n > 8 ? 6 : 14) : 2;
  const h = Math.min(44, (bottom - top - gap * (n - 1)) / n);
  return Array.from({ length: n }, (_, i) => ({ y: bottom - (i + 1) * h - i * gap, h }));
}

// Timer-driven stepper. Every pause/reset/cancel bumps a token so already-queued callbacks become no-ops.
export function createClock({ advance, reset = () => {}, onChange = () => {}, interval = 700,
  schedule = (fn, ms) => setTimeout(fn, ms), clear = (id) => clearTimeout(id) }) {
  let timer = null; let token = 0;
  const clk = { playing: false };
  const halt = () => { token++; if (timer !== null) clear(timer); timer = null; clk.playing = false; };
  const arm = () => {
    const t = token;
    timer = schedule(() => {
      timer = null;
      if (t !== token) return;
      if (advance()) arm(); else clk.playing = false;
      onChange();
    }, interval);
  };
  clk.play = () => { if (clk.playing) return; halt(); clk.playing = true; arm(); onChange(); };
  clk.pause = () => { halt(); onChange(); };
  clk.step = () => { halt(); advance(); onChange(); };
  clk.reset = () => { halt(); reset(); onChange(); };
  clk.cancel = halt;
  return clk;
}
