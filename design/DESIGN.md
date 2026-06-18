# Design system

Synthesis to follow: Morpho (palette + restraint), Jupiter (type + spacing), a
thread of Hyperliquid mint. The two HTML files here are the reference — match them.
Mint is never decoration; it marks only favorable variance, live/now status, and
the active view. Over-budget / blocked uses a muted clay, not red.

| token        | value     | use                                   |
|--------------|-----------|---------------------------------------|
| --bg         | #0C0D0F   | page (warm-neutral near-black)        |
| --surface    | #141619   | cards, panels                         |
| --surface-2  | #1A1D22   | raised / hover                        |
| --hairline   | #24272C   | borders, dividers                     |
| --text       | #E7E9EC   | primary text                          |
| --text-dim   | #969CA4   | secondary                             |
| --text-faint | #5F646B   | captions, headers                     |
| --mint       | #4FE3A1   | favorable / live / active / primary   |
| --clay       | #DB9A63   | unfavorable / blocked                 |

Type: General Sans (UI) + JetBrains Mono (all figures, `tabular-nums`).
Radius 10px cards / 6px chips. Section padding 28px. Generous rows (~52px).
Minimal motion; respect `prefers-reduced-motion`; always show `:focus-visible`.
