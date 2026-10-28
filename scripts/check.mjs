// Static checks: JS syntax, local references, no external runtime assets, no tiny text.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const root = join(dirname(new URL(import.meta.url).pathname), '..');
const fail = [];
const read = (p) => readFileSync(join(root, p), 'utf8');
const js = ['src', 'scripts', 'test'].flatMap((d) => readdirSync(join(root, d)).filter((f) => /\.m?js$/.test(f)).map((f) => `${d}/${f}`));

for (const f of js) {
  const r = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8' });
  if (r.status) fail.push(`syntax: ${f}\n${r.stderr}`);
  for (const [, spec] of read(f).matchAll(/from\s+'(\.[^']+)'/g)) {
    if (!existsSync(join(root, dirname(f), spec))) fail.push(`import missing: ${f} -> ${spec}`);
  }
}

const html = read('index.html');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^https?:/.test(ref)) continue; // source links in <details> are plain anchors
  if (!existsSync(join(root, ref))) fail.push(`missing local ref: ${ref}`);
}
if (/<(script|link)[^>]+(src|href)="https?:/.test(html)) fail.push('external runtime asset in index.html');

for (const f of ['css/style.css', ...js.filter((f) => f.startsWith('src/'))]) {
  const s = read(f);
  if (/https?:\/\/|@import|url\(\s*['"]?http/.test(s)) fail.push(`external URL in ${f}`);
}
for (const [, px] of read('css/style.css').matchAll(/font(?:-size)?:\s*(\d+)px/g)) {
  if (Number(px) < 13) fail.push(`font too small: ${px}px`);
}
for (const f of ['.nojekyll', 'LICENSE', 'README.md', '.gitignore']) if (!existsSync(join(root, f))) fail.push(`missing ${f}`);

if (fail.length) { console.error(fail.join('\n')); process.exit(1); }
console.log(`check ok: ${js.length} js files, refs, assets, text sizes`);
