// Shareable URL state. Pure: no DOM. Everything read from a URL is checked against fixed enums and
// bounded integers; nothing from the URL ever reaches the renderer as text, markup or a selector.
import { FULL, levelsFor, PLACES, STACK_TYPES, PKG_KINDS, STACK_COUNTS, makeStack, stackParts } from './model.js';

export const VIEWS = ['bit', 'where', 'topo', 'vram', 'stack'];
const TECHS = ['sram', 'dram', 'flash'];
const PLACE_IDS = Object.keys(PLACES);
export const MAX_STATE = 1200;
// Every query key this app owns; anything else in the URL is left alone.
const OURS = ['state', 'view', 'tech', 'topo', 'bits', 'place', 'vram', 'stack', 'pkg', 'n', 'layer', 'exploded', 'cell', 'action', 'value', 'frame'];

// Snapshot = minimal deterministic state. Booleans as 0/1. Matches the app's initial state.
export const defaultSnap = () => ({
  w: 'bit', t: 'sram',
  s: [1, 1], // SRAM [powered, q]
  d: [1, FULL, 0], // DRAM [powered, charge, lost]
  f: ['nand', 1, 0, 1], // flash [topo, bits, level, powered]
  p: 'cpu-l1', a: '10110101', c: 2, g: 'gddr',
  k: ['nand', makeStack('nand').n, 0, 0, 'nand'], // stack [type, n, sel, exploded, pkg]
  b: 0, // error highlight
});
const SNAP_KEYS = Object.keys(defaultSnap());

const bit = (x) => (x ? 1 : 0);
export function snapOf(S) {
  const { sram, dram, flash } = S.cells; const k = S.stack;
  return {
    w: S.view, t: S.tech, s: [bit(sram.powered), sram.q], d: [bit(dram.powered), dram.charge, bit(dram.lost)],
    f: [flash.topo, flash.bits, flash.level, bit(flash.powered)], p: S.place, a: S.bits.join(''), c: S.sel, g: S.vram,
    k: [k.type, k.n, k.sel, bit(k.x), k.pkg], b: bit(S.bad),
  };
}
export function applySnap(S, n) {
  S.view = n.w; S.tech = n.t;
  S.cells = {
    sram: { kind: 'sram', powered: !!n.s[0], q: n.s[1] },
    dram: { kind: 'dram', powered: !!n.d[0], charge: n.d[1], lost: !!n.d[2] },
    flash: { kind: 'flash', topo: n.f[0], bits: n.f[1], level: n.f[2], powered: !!n.f[3] },
  };
  S.place = n.p; S.bits = [...n.a].map(Number); S.sel = n.c; S.vram = n.g;
  S.stack = { type: n.k[0], n: n.k[1], sel: n.k[2], x: !!n.k[3], pkg: n.k[4] };
  S.bad = !!n.b;
  return S;
}

/* ---------- validation ---------- */
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
const b01 = (x) => x === 0 || x === 1;
const oneOf = (x, list) => typeof x === 'string' && list.includes(x);
const tuple = (a, n) => Array.isArray(a) && a.length === n;
const partsOf = (k) => stackParts({ type: k[0], n: k[1], pkg: k[4] });

function snapError(n) {
  if (!isObj(n) || Object.keys(n).length !== SNAP_KEYS.length || !SNAP_KEYS.every((k) => own(n, k))) return 'shape';
  if (!oneOf(n.w, VIEWS)) return 'view';
  if (!oneOf(n.t, TECHS)) return 'tech';
  if (!tuple(n.s, 2) || !b01(n.s[0]) || !(n.s[1] === null || (n.s[0] && b01(n.s[1])))) return 'sram';
  if (!tuple(n.d, 3) || !b01(n.d[0]) || !b01(n.d[2]) || !(n.d[1] === null || (n.d[0] && int(n.d[1], 0, FULL)))) return 'dram';
  if (!tuple(n.f, 4)) return 'flash';
  const [topo, bits, level, fp] = n.f;
  if (!oneOf(topo, ['nand', 'nor']) || !int(bits, 1, topo === 'nor' ? 1 : 4) || !int(level, 0, levelsFor(bits) - 1) || !b01(fp)) return 'flash';
  if (!oneOf(n.p, PLACE_IDS)) return 'place';
  if (typeof n.a !== 'string' || !/^[01]{8}$/.test(n.a) || !int(n.c, 0, 7)) return 'array';
  if (!oneOf(n.g, ['gddr', 'hbm'])) return 'vram';
  if (!tuple(n.k, 5)) return 'stack';
  const [type, cnt, sel, x, pkg] = n.k;
  if (!oneOf(type, STACK_TYPES) || !oneOf(pkg, PKG_KINDS) || !STACK_COUNTS[type].includes(cnt) || !b01(x)
    || !int(sel, 0, partsOf(n.k).length - 1)) return 'stack';
  if (!b01(n.b)) return 'flag';
  return '';
}

function opOk(v, arg, n) {
  if (v === 'read' || v === 'power') return arg === undefined;
  if (v === 'refresh') return n.t === 'dram' && arg === undefined;
  if (v === 'write') return n.t !== 'flash' && oneOf(arg, ['0', '1']);
  if (v === 'erase') return n.t === 'flash' && arg === undefined;
  if (v === 'program') return n.t === 'flash' && typeof arg === 'string' && arg.length === n.f[1] && /^[01]+$/.test(arg);
  return false;
}
// Whitelisted simulation actions (the app's data-a/data-v/data-arg), valid only in the view that offers them.
const ACTS = {
  view: (v, arg) => oneOf(v, VIEWS) && (arg === undefined || (v === 'bit' && oneOf(arg, TECHS))),
  tech: (v, arg, n) => n.w === 'bit' && oneOf(v, TECHS),
  op: (v, arg, n) => n.w === 'bit' && opOk(v, arg, n),
  topo: (v, arg, n) => n.w === 'bit' && n.t === 'flash' && oneOf(v, ['nand', 'nor']),
  levels: (v, arg, n) => n.w === 'bit' && n.t === 'flash' && n.f[0] === 'nand' && oneOf(v, ['1', '2', '3', '4']),
  leak: (v, arg, n) => n.w === 'bit' && n.t === 'dram' && oneOf(v, ['step', 'reset']),
  place: (v, arg, n) => n.w === 'where' && oneOf(v, PLACE_IDS),
  open: (v, arg, n) => n.w === 'where' && v === 'x',
  sel: (v, arg, n) => n.w === 'topo' && oneOf(v, ['0', '1', '2', '3', '4', '5', '6', '7']),
  arr: (v, arg, n) => n.w === 'topo' && oneOf(v, ['read', 'program', 'program1', 'erase']),
  vram: (v, arg, n) => n.w === 'vram' && oneOf(v, ['gddr', 'hbm']),
  stk: (v, arg, n) => n.w === 'stack' && oneOf(v, STACK_TYPES),
  stkk: (v, arg, n) => n.w === 'stack' && n.k[0] === 'pkg' && oneOf(v, PKG_KINDS),
  stkn: (v, arg, n) => n.w === 'stack' && oneOf(v, STACK_COUNTS[n.k[0]].map(String)),
  stks: (v, arg, n) => n.w === 'stack' && oneOf(v, partsOf(n.k).map((_, i) => String(i))),
  stkx: (v, arg, n) => n.w === 'stack' && oneOf(v, ['0', '1']),
  jump: (v, arg, n) => n.w === 'stack' && oneOf(v, ['sram', 'dram', 'nand', 'hbm', 'l3']),
  go3d: (v, arg, n) => n.w !== 'stack' && oneOf(v, STACK_TYPES) && (arg === undefined || oneOf(arg, PKG_KINDS)),
};
const WITH_ARG = ['view', 'op', 'go3d'];
function lastOk(l, n) {
  if (!Array.isArray(l) || l.length < 2 || l.length > 3) return false;
  const [a, v, arg] = l;
  if (!oneOf(a, Object.keys(ACTS)) || typeof v !== 'string') return false;
  if (l.length === 3 && (!WITH_ARG.includes(a) || typeof arg !== 'string')) return false;
  return ACTS[a](v, arg, n);
}

/* ---------- encode / decode ---------- */
const toB64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

// Payload: { snap, last: [a, v, arg?] | null, fi: frame index, pulse: bus step }. All ASCII, so btoa is safe.
export function encodeState({ snap, last, fi, pulse }) {
  return toB64u(JSON.stringify({ v: 1, snap, ...(last && { last }), ...(fi && { fi }), ...(pulse && { pulse }) }));
}

const fail = (error) => ({ ok: false, error });
export function decodeState(str) {
  if (typeof str !== 'string' || !str || str.length > MAX_STATE || !/^[A-Za-z0-9_-]+$/.test(str)) return fail('format');
  let o;
  try { o = JSON.parse(fromB64u(str)); } catch { return fail('format'); }
  if (!isObj(o) || !Object.keys(o).every((k) => ['v', 'snap', 'last', 'fi', 'pulse'].includes(k))) return fail('shape');
  if (o.v !== 1) return fail('version');
  const e = snapError(o.snap);
  if (e) return fail(e);
  const last = o.last ?? null; const fi = o.fi ?? 0; const pulse = o.pulse ?? 0;
  if (last !== null && !lastOk(last, o.snap)) return fail('action');
  if (!int(fi, 0, 9) || !int(pulse, 0, 40)) return fail('step');
  return { ok: true, snap: o.snap, last, fi, pulse };
}

/* ---------- URL ---------- */
// Readable direct-link action → whitelisted simulation action for that view.
function preset(n, action, value) {
  if (n.w === 'bit') return action === 'leak' ? ['leak', 'step'] : value === undefined ? ['op', action] : ['op', action, value];
  if (n.w === 'topo') return ['arr', action];
  return null;
}
const nums = (k) => k.map(String);

// Precedence: a valid `state` wins over every readable param. Invalid `state` → defaults + notice.
export function readURL(search) {
  const q = new URLSearchParams(search);
  const out = { snap: defaultSnap(), last: null, fi: 0, pulse: 0, notice: '', given: OURS.some((k) => q.has(k)) };
  if (q.has('state')) {
    const r = decodeState(q.get('state'));
    if (r.ok) return { snap: r.snap, last: r.last, fi: r.fi, pulse: r.pulse, notice: '', given: true };
    return { ...out, notice: `This link's saved state could not be read (${r.error}), so defaults are shown.` };
  }
  const n = out.snap; const bad = [];
  const get = (key, list, set) => {
    if (!q.has(key)) return;
    const v = q.get(key);
    if (list.includes(v)) set(v); else bad.push(key);
  };
  get('view', VIEWS, (v) => { n.w = v; });
  get('tech', TECHS, (v) => { n.t = v; });
  get('topo', ['nand', 'nor'], (v) => { n.f = [v, 1, 0, 1]; });
  get('bits', n.f[0] === 'nand' ? nums([1, 2, 3, 4]) : ['1'], (v) => { n.f = [n.f[0], Number(v), 0, 1]; });
  get('place', PLACE_IDS, (v) => { n.p = v; });
  get('vram', ['gddr', 'hbm'], (v) => { n.g = v; });
  get('stack', STACK_TYPES, (v) => { n.k = [v, makeStack(v).n, 0, n.k[3], n.k[4]]; });
  get('pkg', PKG_KINDS, (v) => { n.k[4] = v; });
  get('n', nums(STACK_COUNTS[n.k[0]]), (v) => { n.k[1] = Number(v); });
  get('layer', partsOf(n.k).map((_, i) => String(i + 1)), (v) => { n.k[2] = Number(v) - 1; });
  get('exploded', ['0', '1'], (v) => { n.k[3] = Number(v); });
  get('cell', nums([0, 1, 2, 3, 4, 5, 6, 7]), (v) => { n.c = Number(v); });
  get('frame', nums([1, 2, 3, 4, 5, 6, 7, 8, 9]), (v) => { out.fi = Number(v) - 1; });
  const notes = bad.length ? [`Ignored link setting: ${bad.join(', ')}.`] : [];
  if (q.has('action')) {
    const v = q.get('action'); const val = q.get('value') ?? undefined;
    const last = v.length <= 16 && (val === undefined || val.length <= 4) ? preset(n, v, val) : null;
    if (last && lastOk(last, n)) out.last = last;
    else notes.push('That link action is not available in this view.');
  }
  out.notice = notes.join(' ');
  if (snapError(n)) return { ...out, snap: defaultSnap(), last: null, notice: 'Link not understood, so defaults are shown.' };
  return out;
}

// `view` is informational (the current view); payload.snap may be the pre-action state.
export function shareURL(href, payload, view = payload.snap.w) {
  const u = new URL(href);
  OURS.forEach((k) => u.searchParams.delete(k));
  u.searchParams.set('view', view);
  u.searchParams.set('state', encodeState(payload));
  return u.href;
}
