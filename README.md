# Bit Atlas

Interactive schematics of **how memory cells store 1 vs 0** — and where each lives.

- **Bit cell** — SRAM 6T latch · DRAM 1T1C (leak, sense + restore, refresh) · Flash threshold-voltage model (SLC → QLC ladder, program/erase rules)
- **Where it lives** — CPU/GPU caches, host DRAM, VRAM, SSD (controller, NAND, optional DRAM), firmware NOR
- **NAND vs NOR** — series string vs parallel cells, read current path
- **GDDR vs HBM** — both DRAM as GPU memory; flat packages vs stacked dies with TSVs
- **3D stacking** — 3D NAND (word-line layers inside one die) · HBM (separate DRAM dies + base die, TSVs, interposer) · 3D SRAM cache (cache die bonded to a compute die) · package stacking (NAND or DRAM dies in one package, PoP). Pick layer/die count, select a layer/die, compact vs exploded.

Plain HTML/CSS/ES modules. No build, no dependencies. Fonts: Commissioner and Azeret Mono (SIL OFL 1.1), self-hosted in `fonts/` so the page makes no third-party requests. Design tokens and rules: `docs/design.md`. Teaching schematics, not a circuit simulator; no universal timing, size or voltage numbers. Layer and die counts are illustrative choices, not product counts; no bandwidth/density formula is implied.

## Share links

**Copy link** (below the controls) copies a URL that reopens exactly the current simulation state — view, cell contents, selected part, NAND/NOR, SLC…QLC, power, array bits, GDDR/HBM, stack type/count/selection/exploded, and the current animation frame. Links always open **paused** on that frame. The address bar is kept in sync (`history.replaceState`) after each change; back/forward restore the entry without autoplay.

`state` is a versioned (`v:1`) base64url JSON snapshot. It stores the state *before* the last action plus that action, then replays it locally to rebuild the same frames and status. A valid `state` wins over every readable param.

Readable direct links (all optional, unknown values ignored with a notice):

| param | values |
|---|---|
| `view` | `bit` `where` `topo` `vram` `stack` |
| `tech` | `sram` `dram` `flash` |
| `topo`, `bits` | `nand`/`nor`; `1`–`4` (NAND only) |
| `place` | e.g. `cpu-l3`, `vram`, `ssd-nand`, `fw-nor` |
| `vram` | `gddr` `hbm` |
| `stack`, `pkg`, `n`, `layer`, `exploded` | `nand`/`hbm`/`cache`/`pkg`; `nand`/`dram`/`pop`; count; 1-based part (bottom = 1); `0`/`1` |
| `cell` | `0`–`7` (NAND vs NOR) |
| `action`, `value` | bit view: `write`(0/1) `read` `refresh` `power` `program`(bits, e.g. `010`) `erase` `leak`; topo view: `read` `program` `program1` `erase` |
| `frame` | 1-based animation step |

Examples: `?view=bit&tech=flash&action=program&value=0&frame=2` · `?view=stack&stack=hbm&n=8&layer=3&exploded=1` · `?view=topo&cell=4&action=read&frame=3`

Limits: every value is checked against fixed enums/bounded integers; nothing from the URL is rendered as text or markup, and an action is only a whitelisted simulation control for the current view. Invalid, oversized or unknown-version links fall back to defaults with a notice. Other query params, the path (e.g. `/bit-atlas/`) and `#hash` are kept. Diagram size and layout follow each screen; only the simulation state is guaranteed identical. No visitor data goes into the URL.

## Run

Open via any static server (ES modules need http), e.g. `python3 -m http.server`, then visit `http://localhost:8000/`.

## Test

```
npm test       # model + stacking invariants + URL codec (roundtrips, malformed/injection, presets, precedence)
npm run check  # syntax, local refs, no external runtime assets, min text size, nav per view
PLAYWRIGHT=/path/to/node_modules/playwright node scripts/browser.mjs
               # real-browser: copy → reopen in new context → identical & still paused, history, keyboard, 390px overflow,
               # tap targets + spacing at 1365/768/390/320, focus rings, no cyan. Add --shots=/tmp/dir for screenshots.
```

Sources are listed in the page's **Sources** disclosure. MIT licensed.
