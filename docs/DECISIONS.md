# Decisions where the PRD is silent

- DEMO_END is 29 Oct 2026, 6:00 AM IST (2026-10-29T00:30Z). The server pauses the clock there.
- Sync: an in-memory session on the Node server, polled by every surface (laptop tabs and a phone on the same network). Works offline on localhost with no Supabase. Supabase (PRD 24.4, 28) is not wired yet; on Vercel serverless it would be required.
- Pre-window charges live in `World.history` (PastExecution) rather than as events.
- F1 (trial jump) applies only to the first charge after a trial, so later KathaKosh and FitGhar cycles stay in the List band.
- F6 and F7 are 0 in the seed (no per-user charge history is generated), which keeps the 271 at exactly 90 and the 47 at 73.
- Retry slot: the next off-peak minute inside the nightly retry batch, which opens at 9:30 PM IST, plus a stable per-cycle offset (Rahul's is fixed at 11 minutes, giving 9:41 PM).
- 76 StadiumPass customers who never top up get a merchant retry on 28 Oct night (attempt 2, MANDATE_SCHEDULE_V1).
- Review Radar runs as a batch at :58 past each hour, so INC-07 opens at 8:58 PM exactly.
- With no model configured, review tags come from the hand-checked seed labels and are recorded as `seed-labels`, not as `l2-v2`. Reminders, case summaries and alerts use templates and are recorded as `template`. The flight recorder shows `l1-v3` only once a real model output is cached.
- Auto refunds are sent at the customer's "Haan" (9:01 to 9:05 PM) and confirmed 2 sim minutes later, not batched at 9:11 PM.
- Anjali's fraud-lane question autoplays at 10:00 AM, 27 Oct, so "cases handed to a person" reaches 2. Priya's call autoplays at 3:52 PM and her decision at 4:00 PM, 27 Oct.
- Callback window: by 4:30 PM next day when assigned after 2 PM, else three hours later.
- Display action IDs are `A-6001` onward; Sunita's skip is fixed to A-5521 via `world.fixtures.actionIds`.
- Rules live in `rules/catalog.ts` (IDs, lanes, titles, order) with the logic in `agent.ts` and `actions.ts`, instead of one file per rule.
- Retryable gateway blocks: KILL_SWITCH_V1 and PIN_REQUIRED. Every other block deduplicates.

## Language model layer
- No `temperature`: the PRD asks for 0.2, but the Messages API now rejects sampling parameters on every model. Determinism comes from the demo cache and the fact-check instead.
- Requests use structured outputs (`output_config.format` from a Zod schema) and `effort: "low"`; the Sonnet route also sends the server-side refusal fallback (`fallbacks: "default"`). A refusal, timeout, bad JSON or failed fact-check always falls back to the template.
- The demo cache is keyed by task, prompt version and input (not by model), so the browser can read it without knowing the server's env; each entry records the model that wrote it.
- Cached model output is applied synchronously through engine hooks (`src/llm/hooks.ts`), so replay stays deterministic. Live calls are only L3 (Pakka se poochho) and L5 (offer lint).
- With no key, review tags come from the hand-checked seed labels and are recorded as `seed-labels`; other text is recorded as `template`.
- Only the `anthropic` provider is built; `openai` from PRD 14.2 is not.
- Voice note: generated with the macOS Hindi voice (Lekha) as AAC .m4a (~20 s), not Sarvam Bulbul as MP3. Replace public/audio/sunita-padhoai-hi.m4a with a Bulbul recording if a key becomes available.

## Shared sessions (Supabase)
- Events are keyed by (session, epoch, seq) with no gaps; seq is the engine's event id. `append_events` appends a batch only if the log still ends where the writer expects (optimistic concurrency), so any server instance can advance a session; the loser re-reads and retries. This replaces the PRD's ticker lease.
- Restart bumps the epoch and deletes the old epoch's events.
- On catch-up a replica re-runs the last 10 seconds of the log, because some events are stamped up to 5 s after the job that made them; every handler is safe to run twice.
- Surfaces poll `GET /events?after=` every 0.5 s (1 s when paused) instead of using Supabase Realtime; the table is in the realtime publication for later.
- Writes use the secret key on the server only; the publishable key can read but not append or restart.

## Cheaper plan
- PadhoAI's cheaper plan is "PadhoAI Lite", ₹149 a month (`p_padhoai_lite`), offered only when the merchant turns on "Move to ₹149 monthly". No generated mandate starts on it, so the seed counts are unchanged.
- Choosing it withdraws the ₹599 notice and sends a fresh ₹149 notice for this cycle. The charge keeps its time when that still gives 24 hours of notice; otherwise it moves to the first off-peak minute 24 hours after the switch. No PIN: the merchant changes the charge.
- The choice breakdown gained a `downgrade` bucket (0 in the scripted story).
