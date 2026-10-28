# Bit Atlas — design

Subject: the hidden physical construction of memory. The page is a quiet precision instrument: one lit specimen plate (the diagram) and a calm control column beside it. Dark, action-first, few words.

## Tokens

| name | hex | role |
|---|---|---|
| Graphite | `#17191c` | page |
| Plate | `#1f2226` | diagram field, control surfaces |
| Pewter | `#4a4f57` | borders, idle wires |
| Ivory | `#ece7dc` | text, focus ring |
| Ash | `#a39f97` | secondary text (6.7:1 on Graphite) |
| Champagne | `#d6bd8c` | the one signal: selected, active wire, current path |
| Mineral violet | `#a898dc` | stored charge: electrons, capacitor, charge-trap, memory packages |

Error is a dusty rose `#e3958b`, used only for failed actions and lost data. No cyan/teal anywhere; no gradients as decoration.

## Type

- **Commissioner** (self-hosted, variable 400–700): everything — interface, diagram labels. Its flared, slightly engraved terminals read like instrument faceplates rather than SaaS UI. Fallback: `"Segoe UI", "Helvetica Neue", sans-serif`.
- **Azeret Mono** (self-hosted 400–600): only bit values, Vt, step counter. Fallback: `ui-monospace, Menlo, Consolas`.
- Scale (px): 13 · 15 · 17 · 20 · 38 (big bit value in SVG). Sentence case labels; no tracked-out caps.

## Layout

```
desktop ≥ 980
┌ Bit Atlas  how memory stores 1 vs 0 ─────── [Bit cell] [Where] [NAND/NOR] [GDDR/HBM] [3D] ┐
│ ┌──────────── specimen plate (dot grid) ───────────┐ ┌ readout ─────────────┐ │
│ │                                                  │ │ ● status (live)      │ │
│ │                 SVG diagram                      │ │ 2/4 · step text      │ │
│ │                                                  │ ├──────────────────────┤ │
│ │                                                  │ │ Cell                 │ │
│ │                                                  │ │ [SRAM] [DRAM] [Flash]│ │
│ └──────────────────────────────────────────────────┘ │ Write  [0]  [1]      │ │
│   caption: SRAM 6T cell: cross-coupled inverters     │ Related  [... →]     │ │
│                                                      ├──────────────────────┤ │
│                                                      │ [Copy link] note     │ │
│                                                      │ ▸ Details ▸ Sources  │ │
└────────────────────────────────────────────────────────────────────────────────┘
phone: header + wrapping nav → plate (≤ 62vh) → caption → readout → controls → share → details
```

Left-aligned throughout; diagram text centred only where the SVG already centres it.

## Interaction rules

- Targets ≥ 46px tall. Gaps: 12px between buttons, 20px between control groups, 10px in nav.
- Two button kinds: **toggles** (aria-pressed; selected = champagne edge + tint + weight 600) and **actions** (solid pewter key). "Related" links get a quieter outlined style.
- Focus: 2px Ivory outline, 3px offset — distinct from selection.
- Motion only answers actions (existing step frames, flash on change, 120ms hover/press). Reduced motion removes all of it.

## Review against the brief

- First draft used champagne for both selection *and* charge — two meanings, one colour. Split: champagne = signal, violet = charge (SVG legends updated to say "violet").
- First draft had an uppercase mono eyebrow over each control group — the exact template tell the brief calls out. Revised to sentence-case Commissioner labels.
- Considered a big hero headline; rejected — diagram stays the hero, wordmark stays small.
- Plate dot grid is the single focal treatment (evokes a die layout grid); everything else flat.
