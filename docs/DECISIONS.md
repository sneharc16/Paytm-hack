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

## Gemini demo cache (free tier)
- The free key had real capacity only on `gemini-3.5-flash-lite`; the stronger models answered 503 or 429 throughout. Every baked text was written by the lite model.
- The model gets the amounts pre-formatted (`amount_text`, `trial_amount_text`) beside the raw numbers; the PRD's L1 prompt is unchanged.
- Only upcoming-charge messages (ask, tell, follow-up, collect, remind) are model-written, because the L1 prompt is about an upcoming charge. Refund offers and failed-charge notices keep their templates: the model described past charges as future ones.
- Result: all Hinglish and English reminders pass the fact-check; all 22 Hindi reminders came back in Latin script and fail, so Hindi uses the hand-written templates. Review tags (205, all agreeing with the hand labels), the merchant alert and both case summaries are model-written.

## Regional languages and voice (Sarvam AI)
- 24 languages: Hindi, Hinglish and English stay hand-written in strings.ts. The other 21 scheduled languages are translated by Sarvam from the English line: Mayura (modern colloquial) for Bengali, Marathi, Telugu, Tamil, Gujarati, Kannada, Malayalam, Odia and Punjabi; Sarvam Translate (formal) for Assamese, Urdu, Nepali, Konkani, Maithili, Dogri, Bodo, Sanskrit, Kashmiri, Sindhi, Manipuri and Santali.
- Every machine line is checked before it can be shown (src/copy/regional.ts): placeholders and numbers must survive exactly, the text must be in the target script, no markup, and dashes are replaced with commas. A line that fails stays in the base language: Hindi for Devanagari languages, English for the rest. The engine and its event log stay in hi, hinglish or en; only the screen changes.
- Copy for a regional language comes from src/copy/regional.json (`pnpm bake:sarvam`, committed) first, then from /api/voice/copy, which translates the deck on the server on first use and caches it in memory and .pakka-data/regional-cache.json; the browser keeps it in localStorage. Dates use the base language's months with translated "today, tomorrow, day after".
- Voice: "Listen" reads the sheet title, the first line and the bank SMS name in the chosen language with Bulbul v3 (11 languages; a voice per language). Languages Bulbul cannot speak are translated to Hindi and read in Hindi. Sunita's recorded Hindi note is kept for her PadhoAI reminder in Hindi. With no key, the browser's voice for the language is used, else Hindi.
- Listening: the mic in Pakka se poochho records up to 15 seconds and sends it to Saaras v4 with automatic language detection. The transcript stays on screen; the intake and the event log get an English translation, since the intake reads Hinglish and English. Typed questions in a non-Latin script are translated the same way. If the detected language differs from the screen, the app offers to switch.
- The Sarvam key is server only (SARVAM_API_KEY). The voice routes are rate limited per IP (copy 6, speak 30, listen 20, translate 30 per minute), speak takes up to 700 characters and listen up to 2 MB.
- The key lives in `.env` (git-ignored by `.env*`); Next.js and the scripts read it from the environment, never from code. `pnpm sarvam:first-call` is the one-call smoke test with the official `sarvamai` SDK (Bulbul v3, saves `.pakka-data/sarvam-first-call.wav`).
- Placeholders: Sarvam translates `{amount}`, so slots are sent as `#1#`, `#2#` markers (which it keeps) and put back after; a marker that is lost, invented or doubled rejects the line. A suffix that swallows a marker's closing hash ("#1-க்கு") is still accepted. When a translated slot carries a case suffix the inserted word already ends with ("நாளைக்கு-க்கு"), the repeat is dropped.
- Each line is tried with Mayura (conversational) first; if it keeps English or loses a slot, Sarvam Translate (formal) gets one try. Rate limits are waited out (Retry-After, up to five times) and the bake runs two requests at a time.
- Chat: Sarvam is the third model provider (after Anthropic and Gemini; `LLM_PROVIDER=sarvam` to force it). It uses `sarvam-105b-conversations` with JSON-schema output from the same Zod schemas and low reasoning effort: about 0.3 s per intake against 14 to 17 s for `sarvam-105b` (set `SARVAM_MODEL` to change). Output that fails the schema falls back to the template as before; the model never decides money.
- Listening: browsers label recordings `audio/webm;codecs=opus` (Chrome) or `audio/mp4` (Safari), and Sarvam rejects a type with parameters, so the server sends the bare container type and a matching file name. A spoken question fills the box and waits for the customer to send it, so a misheard name can be fixed first.
- A customer's own words are translated to English with Mayura for the intake. Mayura once added a payment app the customer never said ("from my Paytm account"), which would have reached the flight recorder, so a real payment app or bank name that is not in what they said is removed from the English.

## Pakka for Business (src/b2b, /business)
- A separate engine and route. Nothing in src/engine, src/sim, src/copy or the consumer surfaces changes; the business engine only reads helpers from src/engine/clock. Its world is `generateBusinessWorld("2711")`, its store and localStorage key are its own.
- Receipts use Ed25519 signatures (`@noble/curves`), not zero-knowledge proofs. They show that each agent and person signed this exact intent; they do not prove how a model reached its answer. Keys are derived from the world seed as stand-ins for a KMS key (agents) and a phone's secure element (people). The guard holds public keys only and never imports keys.ts (checked by a test).
- Hashes are SHA-256 with a domain tag per kind (intent, attestation, approval, policy, governance, account, ledger), over canonical JSON that rejects floats.
- Nonces are unique per company and consumed on payout, not a single "next nonce", so a payout waiting for the CFO does not block others. The intent's 12 hour life bounds how long a nonce stays live.
- Approval lines: checker from ₹50,000 and CFO from ₹5,00,000, on the vendor's total for the last 24 hours (so splitting does not help). Agents alone may release ₹3,00,000 a day. First payout to a new account: checker, capped at ₹1,00,000.
- Cooling: 24 hours for a newly onboarded account, 72 hours for a changed one. While a bank change request is open for a vendor, nothing is paid to that vendor.
- Release window 9 AM to 7 PM IST. Outside it a payout waits; caps and approvals are worked out when the window opens.
- TDS rates (goods 0, logistics 2%, services 10%, rent 10%) and GST rates (goods 12%, others 18%) are illustrative policy values, not tax advice.
- Policy changes need two of three governors. A change is classed as looser by comparing each field, never by the proposer's label; looser changes wait 24 hours and any governor can veto. Freezing needs one person; lifting it needs two governors.
- The demo PIN rule is any six digits except 000000; three misses lock the person out for 15 minutes. Scripted team actions use a fixed PIN and are marked autoplayed.
- Bank codes in IFSCs (NRMB, DCUB, KSHB, VTRB, MLWB) and all companies, vendors and people are fictional.
- Business console copy is English only, like the merchant console; it is not customer copy.
- The email reader is a rule-based scanner (`rules-v1`). No language model is called in the business engine yet; if one is added it may only add evidence, never set an amount or payee.

## Pakka for Business, live mode (/business/live, /api/v1)
- Real: people's identities and approvals (passkeys), agents and their keys (external, over the API), the ledger (stored on the server), the clock (wall time), every rule and check. Simulated: money only, through a sandbox bank that holds test balances, answers the ₹1 name check from accounts opened in the sandbox, and settles payouts with a reference number.
- The simulation at /business is unchanged and separate: its own seeded world, store and storage key.
- One engine, two modes. A live company starts empty and is built only from its ledger (`org_created`, `person_registered`, `agent_registered`, `vendor_registered`, `po_created`, ...). Engine code stays pure: ids, invite tokens and API keys are generated by the server and only their hashes reach the ledger.
- Passkeys: registration is verified with @simplewebauthn/server (P-256 or Ed25519 only, user verification required, attestation "none"); the raw public key goes into the ledger. Assertions are verified by the engine's own synchronous verifier (noble curves): exact challenge (SHA-256 of the signed message), allowed origin, RP ID hash, user present and verified flags, signature. The guard re-verifies people's approvals itself. Signature counters are not enforced, since synced passkeys usually report 0.
- Every person's write is passkey-signed over `PAKKA_B2B_ACTION_V1|company|person|kind|canonical params|time` (approvals use the approval message, governance signatures the governance message) and must be within 5 minutes of server time. There is no separate PIN in live mode.
- Agents authenticate with an API key (stored as a SHA-256 hash, company named in the key so the right ledger loads) plus an Ed25519 signature over method, path, time, nonce and body hash. Nonces are single-use (stored until twice the 5 minute window passes). 240 requests per minute per agent, per server instance.
- Intents are built by the server from the ledger (payee from the vendor master, amount after TDS, next nonce), never by the agent; the proposer signs what the server built.
- Setup: the founder is the first governor and, until sealing, invites people, registers agents and may set the starting policy directly (no money can move before sealing). Sealing needs exactly three governors, a maker, a checker, a CFO (no maker may also approve) and active payables, compliance and risk agents. After sealing governors are fixed, and a new agent is a two-governor proposal.
- Sessions are 8 hour HttpOnly, SameSite=Strict cookies signed with PAKKA_SESSION_SECRET (on a laptop a random secret is created under .pakka-data). Cookie-authenticated writes also check the Origin header. Invite links carry the token after `#` so it never reaches server logs.
- Storage: Supabase when NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (run supabase/migrations/0002_b2b.sql: append-only events table with a trigger that forbids updates and deletes, and an append function that checks the sequence and the hash link), otherwise JSON files under PAKKA_DATA_DIR (default .pakka-data, one process only). Appends are optimistic; a writer that loses re-runs on the fresh ledger.
- Timers (deferred releases, bank status checks, timelocks, intent expiry, the nightly anchor) run whenever the company is read or written, and on GET /api/v1/live/cron (protected by CRON_SECRET when set).
- `pnpm b2b:live-demo` sets up a working company over HTTP with software passkeys (saved under .pakka-data/demo-people.json) so it can run unattended; real people use real passkeys in the browser.
- Hardening: a person's passkey signature is accepted once (its client data hash is recorded for 15 minutes), so a captured request cannot be replayed inside the freshness window. Sign-out revokes the session on the server (the session id is recorded until the cookie would have expired). Removed people and people with no passkey cannot use a session.
- Offboarding: before sealing the founder removes people directly; after sealing removing someone is a two-governor proposal, and governors cannot be removed (the three-governor quorum is fixed at sealing). Removed people's approvals stop counting at the guard. Anyone can revoke their own passkey except their last one; a governor can revoke anyone's at once (a lost device), which may leave that person unable to sign until they are invited again.
- Security headers on /business and /api/v1 only: a content security policy with frame-ancestors 'none' (and X-Frame-Options DENY) so the approval screen cannot be framed, nosniff, no referrer, same-origin opener, HSTS, and a permissions policy allowing passkeys only on this origin. 'unsafe-inline' scripts are allowed because the app is statically rendered without nonces.
- Audit export: the browser builds the file from the ledger it already has and the exporter signs PAKKA_B2B_EXPORT_V1|company|head|count|exporter|time with a passkey. `pnpm b2b:verify` and the Audit page check the chain, agent, approval and governance signatures, the exporter's signature, and a full replay with invariants. Signatures on other person actions are kept in the ledger but not re-derived by the verifier.
- Live red team: 12 attacks run in the browser on a copy of the company's real ledger with attacker-made keys; attacks that need a payout are reported as skipped until one exists.
- Webhooks are signed with an Ed25519 key derived from the server secret, sent after the response (Next `after`), best effort; the notice lists only event types and sequence numbers.
