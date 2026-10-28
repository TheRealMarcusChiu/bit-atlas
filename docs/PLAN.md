# Bit Atlas — plan

Goal: one dark, diagram-first page that shows **how each memory cell stores 1 vs 0** and **where each cell type lives**.

## Views (top selector)
1. **Bit cell** — SRAM 6T latch · DRAM 1T1C · Flash (SLC→QLC Vt ladder). Write / read / power / refresh / erase.
2. **Where it lives** — CPU caches, GPU caches, host DRAM, VRAM, SSD (controller, NAND, optional DRAM), firmware NOR. Role ≠ cell technology.
3. **NAND vs NOR** — series string vs parallel cells, read current path, granularity.
4. **GDDR vs HBM** — both DRAM as VRAM; flat packages vs stacked dies on an advanced package (TSV, wide bus).
5. **3D stacking** — 3D NAND layers in one die · HBM dies + base die · bonded SRAM cache die · dies in a package / PoP. Linked from the other views where applicable.

Share links: `src/share.js` validates a versioned snapshot (+ last whitelisted action, replayed locally) and readable params; see README.

## Architecture
- `src/model.js` — pure, deterministic state model (cells, flash levels, place→tech map, NAND/NOR read path, clock with cancel tokens). No DOM.
- `src/app.js` — renders SVG + controls from state; event delegation; one live status line (state changes only).
- `test/model.test.js` — `node --test`, written before the transitions.
- `scripts/check.mjs` — static checks (syntax, local refs, no external runtime assets, no tiny text).

## Rules held by tests
- SRAM/DRAM lose data on power off; flash keeps it.
- Flash program only raises Vt (1→0 in SLC); 0→1 needs block/sector erase.
- DRAM read = sense + restore; refresh restores a decaying charge, too late = lost.
- 2/3/4 bits per cell ⇒ 4/8/16 Vt windows.
- Place map: caches→SRAM, DRAM/VRAM→DRAM, SSD→NAND (+optional DRAM), firmware→NOR.
- Clock: pause/reset/cancel drop stale timer callbacks.
