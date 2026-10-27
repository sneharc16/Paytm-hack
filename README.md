# Pakka

An AI teammate for UPI AutoPay that asks before the money moves. Prototype for the Paytm Build for India AI Hackathon, Problem Statement 3. All merchants and people are fictional. No real money moves.

## Run it

```bash
pnpm install
pnpm build && pnpm start      # or: pnpm dev
```

Open http://localhost:3000. Pick a surface or use the one-laptop grid (`/demo?grid=1`). To put Sunita's app on a phone, connect the phone to the same Wi-Fi and scan the QR on the hub.

| Route | Surface |
|---|---|
| `/app` | Customer app (Sunita, Rahul, Farhan, Anjali) |
| `/merchant` | PadhoAI's merchant console |
| `/ops` | Control room with the flight recorder |
| `/demo` | Demo clock, story steps and counters |

## One live demo across phone and laptop (optional, free)

1. Create a free Supabase project and run `supabase/migrations/0001_init.sql` in its SQL Editor.
2. In `.env.local` (and in Vercel's Environment Variables) set `NEXT_PUBLIC_SYNC=server`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`.
3. `pnpm check:supabase` plays the whole story against the database and checks the numbers.

Without these, the demo runs in each browser on its own.

## Demo in three minutes

1. Open `/demo?grid=1` and press play (or use **Jump to next moment**).
2. 8:58 PM: Review Radar opens INC-07. 9:06 PM: PadhoAI turns on "Charge only after the customer says yes".
3. 9:10 PM: Sunita's phone gets the Doosri Haan sheet. Choose "Is mahine skip karo". No PIN needed.
4. Jump to 28 Oct, 6:05 PM. Rahul taps "Paisa daal diya"; the retry is booked after 9:30 PM.
5. Open PAK-2311 in the control room to see Farhan's case and verified callback.
6. Jump to 29 Oct, 6:00 AM: ₹1,59,334 stopped, ₹55,016 collected, 0 money moved without a rule.

## How it works

- `src/engine`: pure TypeScript. The world comes from `generateWorld("2711")`, and state is a replay of the event log. Every money action goes through `gateway.ts` with a rule ID and an idempotency key.
- `src/sim`: bank, merchant and NPCI simulators that follow the real rules (off-peak windows, 4 attempts, PIN for opt-out).
- `src/app/api`: in-memory sessions on the server. Every surface polls the same log.
- `pnpm test`: 48 tests, including the full scenario that reproduces every counter in the PRD and checks every invariant.

Decisions where the PRD is silent are in `docs/DECISIONS.md`.

## Not built yet

Live model text needs a paid Anthropic key (`LLM_API_KEY`, then `pnpm bake:llm`); until then templates and the hand-checked review labels are used and labelled as such. The cheaper-plan offer is not built.
