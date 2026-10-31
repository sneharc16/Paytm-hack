# Pakka: rules for Claude Code

Read docs/PRD.md before writing code. It is the source of truth. Mockups are in docs/mockups.

Non-negotiables
- Every action that changes money goes through src/engine/gateway.ts and carries a ruleId.
- The engine (src/engine, src/sim) is pure TypeScript: no React, no Next imports, no Math.random, no Date.now inside logic (pass time in).
- World comes from generateWorld("2711"). Counts in PRD section 10 must match exactly.
- Money is integer paise. Display with inr() from src/lib/format.ts. Times stored UTC, shown IST.
- No charge or retry in 10:00-13:00 or 17:00-21:30 IST. Max 4 attempts per cycle.
- Pause and cancel need a PIN token. Skip via merchant does not.
- The LLM never decides money. All LLM output is Zod-validated and fact-checked; templates are the fallback.
- No real brands, no Paytm logo, no real people or reviews with names.
- Copy comes from src/copy/strings.ts in hi, hinglish and en. No string literals for customer copy in components.
- No em dash or en dash characters anywhere in UI copy.

Design
- Tokens in src/styles/tokens.css (PRD section 18). Font Mukta. Cyan is never text on white.
- Hairline borders, not shadows, except sheet, callback banner and toasts.
- Decision sheet options: equal weight, nothing pre-selected, fixed order.
- Sentence case. No all-caps labels. No arrows in button text.

Workflow
- Small commits. Run pnpm test before each commit.
- When the PRD is silent, choose the simplest deterministic option and note it in docs/DECISIONS.md.

@AGENTS.md

<!-- videowright:start -->
*Auto-managed by Videowright installer. Edits inside this block will be overwritten on re-install. Add your own context outside the markers.*

The folder `videos/` in this project is a [Videowright](https://github.com/scosman/videowright) project -- a library for composing animated explainer videos in HTML/CSS/JS.

For any video-related work, use the `videowright` skill (loaded automatically from `.claude/skills/videowright` or `.agents/skills/videowright`). It has full guidance on segments, voiceovers, styles, and the dev server.

Key paths:
- `videos/videowright.config.ts` -- project config and default style.
- `videos/videos/` -- one folder per video.
- `videos/styles/` -- design tokens and shared styling.
- `videos/segments/`, `videos/components/`, `videos/transitions/` -- shared building blocks.
<!-- videowright:end -->
