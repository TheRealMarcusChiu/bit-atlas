# Bit Atlas

Interactive schematics of **how memory cells store 1 vs 0** — and where each lives.

- **Bit cell** — SRAM 6T latch · DRAM 1T1C (leak, sense + restore, refresh) · Flash threshold-voltage model (SLC → QLC ladder, program/erase rules)
- **Where it lives** — CPU/GPU caches, host DRAM, VRAM, SSD (controller, NAND, optional DRAM), firmware NOR
- **NAND vs NOR** — series string vs parallel cells, read current path
- **GDDR vs HBM** — both DRAM as GPU memory; flat packages vs stacked dies with TSVs

Plain HTML/CSS/ES modules. No build, no dependencies. Teaching schematics, not a circuit simulator; no universal timing, size or voltage numbers.

## Run

Open via any static server (ES modules need http), e.g. `python3 -m http.server`, then visit `http://localhost:8000/`.

## Test

```
npm test       # model: power loss, flash erase rule, DRAM refresh, MLC counts, place map, clock cancel
npm run check  # syntax, local refs, no external runtime assets, min text size
```

Sources are listed in the page's **Sources** disclosure. MIT licensed.
