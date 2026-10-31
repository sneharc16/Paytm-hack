---
title: Pakka
slug: pakka
picker_description: 'Pakka product look. Navy on a pale canvas, Mukta, hairline borders, calm motion.'
font_sources:
  - ./fonts (Mukta, self-hosted woff2 copied from @fontsource/mukta)
mood: [calm, trustworthy, clear, warm]
tags: [product, fintech, light-mode, hindi]
---

# Pakka style

Mirrors the app's own tokens (src/styles/tokens.css, PRD section 18).

- Canvas `--canvas`, text `--ink`, headings `--navy`. Cyan is a shape colour only, never text on white.
- Hairline borders (`--line`, `--line-strong`), no shadows except the floating callout.
- Sentence case, no all-caps labels, no arrows in button-like chips, no em or en dashes.
- Sizing: headings 72px+, body 36px+, screenshots inside a framed window around half the width.
- Motion: short rises (600ms, `--ease-out`), crossfades between screenshots, count-ups for money.
- Money shown in rupees with Indian grouping (1,59,334).
