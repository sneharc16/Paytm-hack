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

## Pakka for Business (`/business`)

The same idea for B2B payouts in INR. Three AI agents (payables, compliance, risk) read invoices and plan vendor payouts, but none of them can move money. A treasury guard releases a payout only for a receipt it checks on its own: Ed25519 signatures from each agent and from the people the amount demands, the account on file, the exact amount after TDS, a fresh nonce, the current policy and model, cooling periods, caps, the release window and the balance. It fails closed.

- `src/b2b`: pure TypeScript, separate from the consumer engine. Hash-chained ledger, two-of-three governance with a 24 hour timelock on looser rules, PIN step-up with lockout, freeze.
- Story: Saanjh Distributors and Kaveri Fresh, 26 to 28 Oct 2026. A phishing email with a prompt injection asks to pay ₹4,19,905 to a new account; it is quarantined, the callback to the number on file exposes it, and the real invoice is paid to the real account.
- Red team: 34 attacks run for real in the browser and in `pnpm test` (forged and replayed receipts, stolen agent keys, all agents compromised, split payments, self-approval, a single governor loosening policy, bank timeouts, ledger edits).
- `pnpm b2b:story` prints what happened to every invoice.

### Live mode (`/business/live`): real people, real agents, simulated money

- People sign in and sign every approval with passkeys. Agents run outside the app and use the API with their own Ed25519 keys (`docs/AGENT_API.md`). Ledgers persist to Supabase (`supabase/migrations/0002_b2b.sql`) or `.pakka-data/`. Only money is simulated, by a sandbox bank.
- Try it in five commands against `pnpm dev`:

```bash
pnpm b2b:live-demo
pnpm agents run
pnpm agents erp-demo erp v_1 --gstin=<printed GSTIN>
pnpm agents erp-demo erp v_1 --gstin=<printed GSTIN> --phish
pnpm b2b:live-demo approve
```

- Or create your own company at `/business/live` with your own passkey, invite people by link, and register agents made with `pnpm agents keygen <name>`.
- Production: set `PAKKA_SESSION_SECRET`, `PAKKA_ORIGINS` (and `PAKKA_RP_ID` if different from the origin's host), the Supabase keys, and `CRON_SECRET` for `/api/v1/live/cron`.
