# Latest pull test plan

31 October 2026

## How to use this plan

This plan covers what the latest pull on main brought in: commits 5f77b64 to 389e6c8. It sits beside the full manual test plan (docs/MANUAL_TEST_PLAN.md) and does not repeat it.

What changed, in short:

- PII masking (`src/lib/privacy/mask.ts`): every model input is masked into typed tokens such as `<PHONE_1>` before any provider call, and values go back in only on our side.
- Three-agent review loop (`src/llm/agents`): a writer drafts, a reviewer on a different model tier grades it against rubric-v2, and a consolidator fixes it. Up to 5 rounds, then the reviewer's decision binds or the template is sent.
- Review trail in the ops flight recorder and a review count line in the demo story view.
- `pnpm try:review` to try the loop on one reminder and one live question.
- The bake: all 261 texts reviewed or recorded as templates, stored masked with their review trail in `src/llm/demo-cache.json`.
- Merge of the Sarvam voice, Pakka live and the Python SDK branch. Sarvam replaces the earlier TTS adapter and recorded notes. Masking and review now also cover Sarvam chat, live reminders, translation and speech.
- README rewrite with live links and an architecture diagram.

Before you start:

- Run `pnpm install` and `pnpm dev`. Open http://localhost:3000.
- For model checks put a model key and `SARVAM_API_KEY` in `.env.local`. Never paste a key into a check, a screenshot or this document.
- Checks marked "No key" must also pass with every key removed from `.env.local`.
- Mark each check Pass, Fail or Blocked in the Result column. For a Fail, add the input you used and what you saw.

## Automated baseline

Run these first. A red baseline means stop and report before manual testing.

| ID | Check | Steps | Expected |
|---|---|---|---|
| AB-1 | Unit tests pass | Run `pnpm test` twice on an idle machine. | 28 files, 270 tests pass both times. |
| AB-2 | Timing tests under load | Run `pnpm test` while a build or the dev server is busy. | Note any failure. On 31 Oct the first run had 9 failures and a later one failed `world.test.ts` "is deterministic and fast" at 609 ms against a 300 ms limit. Timing only, not logic. See finding F2. |
| AB-3 | Privacy tests | `pnpm vitest run tests/unit/privacy.test.ts` | All pass. |
| AB-4 | Review loop tests | `pnpm vitest run tests/unit/agents.test.ts tests/unit/redteam-llm.test.ts tests/unit/review-trail.test.ts` | All pass, including red-team cases RT-L1, RT-L2 and RT-L3. |
| AB-5 | Sarvam tests | `pnpm vitest run tests/unit/sarvam.test.ts` | All pass with no network and no key. |
| AB-6 | Python SDK tests | `pnpm test:python` | All pass. |
| AB-7 | Type check and lint | `pnpm tsc --noEmit` and `pnpm lint` | No errors. |

## Privacy masking

Test through `pnpm try:review`, the ops flight recorder, or a scratch script that calls `mask()` from `src/lib/privacy/mask.ts`. For each input, the masked text must not contain the value, and the type must be the one listed.

### Each kind of personal value

| ID | Check | Steps | Expected |
|---|---|---|---|
| PM-1 | Plain mobile | Mask "mera number 9876543210 hai". | `<PHONE_1>`; the digits are gone. |
| PM-2 | Mobile with +91 and spaces | Mask "call me on +91 98765 43210". | One PHONE token covering the prefix and both groups. |
| PM-3 | Mobile with dashes, 0 or 91 prefix | Mask "+91-98765-43210", "09876543210" and "919876543210". | PHONE each time; no digits left over. |
| PM-4 | Mobile in Devanagari digits | Mask "मेरा नंबर ९८७६५४३२१० है". | PHONE; the Devanagari digits are gone. |
| PM-5 | Number that is not an Indian mobile | Mask "5876543210" (starts with 5). | Not PHONE. It may still be caught as ACCOUNT by the 9 to 18 digit catch-all; note which. |
| PM-6 | UPI ID | Mask "pay to rahul.m@okaxis please" and "9876543210@paytm". | UPI, not EMAIL and not PHONE. |
| PM-7 | Email | Mask "rahul.mehra@example.com". | EMAIL, not UPI. |
| PM-8 | Account near account words | Mask "account number 123456789012", "a/c no: 50100234567891", "mera khata 001234567890" and "मेरा खाता 123456789012". | ACCOUNT each time. |
| PM-9 | IFSC, upper and lower case | Mask "IFSC HDFC0001234" and "ifsc sbin0004567". | IFSC both times. |
| PM-10 | PAN | Mask "PAN ABCDE1234F". | PAN. |
| PM-11 | Aadhaar grouped and with the word | Mask "2345 6789 0123" and "mera aadhar 234567890123". | AADHAAR both times. |
| PM-12 | Aadhaar look-alike starting 0 or 1 | Mask "1234 5678 9012" with no Aadhaar word. | Not AADHAAR. Note whether the catch-all masks it as ACCOUNT. |
| PM-13 | Card that passes Luhn | Mask "4111 1111 1111 1111" and "5500-0000-0000-0004". | CARD both times. |
| PM-14 | 16 digits that fail Luhn | Mask "4111 1111 1111 1112". | Not CARD. It must still be masked (ACCOUNT catch-all); a 16 digit run must never survive. |
| PM-15 | OTP before and after the number | Mask "OTP 482913 aaya" and "482913 is your OTP". | SECRET both times. |
| PM-16 | PIN, password, Hindi OTP | Mask "my upi pin is 1234", "password: 123456" and "ओटीपी 4821 है". | SECRET each time. |
| PM-17 | Full name and parts | Mask "Sunita Verma here" with the name "Sunita Verma" given. | NAME tokens; neither "Sunita" nor "Verma" survives. |
| PM-18 | Name part on its own, lower case | Mask "sunita ji ka paisa" with the same name given. | NAME. |
| PM-19 | Short name part | Give the name "Om Prakash" and mask "Om ji, Prakash ji". | "Prakash" masked. "Om" (under 3 letters) is not masked on its own; record this as expected. |
| PM-20 | Brand in the keep list | Give a brand in `keep` that shares a word with a name, e.g. name "Padho Sharma", keep "PadhoAI", and mask "PadhoAI ne Padho ko charge kiya". | "PadhoAI" stays; the standalone "Padho" is masked. |

### Things that must not be masked

| ID | Check | Steps | Expected |
|---|---|---|---|
| PM-21 | Amounts | Mask "₹599 kyun kata?", "Rs. 1,59,334 refund" and "INR 4,999". | Unchanged. |
| PM-22 | Case IDs | Mask "case PAK-2311 ka kya hua". | Unchanged. |
| PM-23 | Helpline | Mask "1930 pe call karein". | Unchanged. |
| PM-24 | Times and dates | Mask "after 9:30 PM on 28 Oct" and "2026-10-28T16:00:00.000Z". | Unchanged. |
| PM-25 | Already masked text | Mask a string that already has `<PHONE_1>`. | Unchanged; no `<PHONE_1>` inside another token. |
| PM-26 | Amount next to a phone | Mask "₹599 kata, call 9876543210". | Amount kept, phone masked. |

### Vault behaviour

| ID | Check | Steps | Expected |
|---|---|---|---|
| PM-27 | Same value, same token | Mask "9876543210 ... 9876543210". | Both become `<PHONE_1>`. |
| PM-28 | Two values, two tokens | Mask two different phones. | `<PHONE_1>` and `<PHONE_2>`. |
| PM-29 | Same value written two ways | Mask "+91 98765 43210" and "9876543210" in one text. | Note whether they share a token. Either is safe; record the result. |
| PM-30 | Unmask brings values back | Unmask the masked text with its vault. | Original phone, UPI and name come back. |
| PM-31 | Unmask never shows a secret | Mask and unmask "OTP 482913". | The OTP comes back as ••••, never 482913. |
| PM-32 | Vault does not leak in JSON | `JSON.stringify(vault)`. | Counts only, no values. |
| PM-33 | Readable count | `describeMasked` on a text with 2 phones and 1 UPI. | Text like "3 masked: phone, UPI ID". No values. |
| PM-34 | Nested input | Mask an object with values inside arrays and nested objects. | Every string field masked; numbers and keys unchanged. |
| PM-35 | Empty and odd input | Mask "", only spaces, emoji only, and 700 characters of mixed Hindi and English. | No crash. Output length sensible. |

## Masking on the way to every provider

| ID | Check | Steps | Expected |
|---|---|---|---|
| MP-1 | Model never sees a value | Run `pnpm try:review` with a key. Read the log line `masked:` and the provider request if you can see it. | The L3 question "mera number 9876543210" reaches the model as `<PHONE_1>`. `masked` shows PHONE 1. |
| MP-2 | Masking fails, nothing sent | Force `mask` to throw (temporary local edit) and run one task. | Result `mask_failed`; no provider call; the template is used. Undo the edit. |
| MP-3 | Answer shows values only to the owner | Ask a live question with your phone number in it. | The reply on screen may use your name. The API response from `/api/llm/intake` carries `masked` counts, never the values. |
| MP-4 | Question log stays masked | After MP-3, open the ops flight recorder. | The logged question shows tokens or counts, not the number. |
| MP-5 | Translation input is masked | Call `/api/voice` to-English with "mera OTP 482913 hai, number 9876543210". | The English back has tokens. Sarvam never sees the values (check the server log). |
| MP-6 | Mic transcript is masked before translation | Speak a phone number into the mic on the live app. | You see your own words; the English passed to the intake has `<PHONE_1>`. |
| MP-7 | Names in mic or typed translation | Say "Sunita Verma bol rahi hoon" into the mic. | Note whether the name is masked. Those routes call `mask()` with no names, so the name may reach Sarvam. See finding F3. |
| MP-8 | Speech refuses personal data | POST to the speak route with "call 9876543210" and a known lang. | 422 PERSONAL_DATA. The page falls back to text or the device voice. |
| MP-9 | Speech of a clean script | POST a reminder voice script with no personal data. | audio/wav; header `x-voice-language` set. |
| MP-10 | Speech in a language Bulbul lacks | POST a script with a scheduled language that has no Bulbul voice. | Read in Hindi; `x-voice-language: hi`. |
| MP-11 | Speech limits | POST empty text, 701 characters and an unknown lang. | 400 INVALID each time. |
| MP-12 | Speech rate limit | Send 31 speak requests from one IP within the window. | The 31st gets 429 RATE_LIMITED. |
| MP-13 | No Sarvam key | Remove `SARVAM_API_KEY` and press Listen on a reminder. | 503 NO_SARVAM_KEY handled; text stays, no error screen. No key. |
| MP-14 | Translation adds a brand | Translate a Hindi complaint that never names a payment app. | Any payment app or bank name the translation added is removed. A brand the customer did say is kept. |

## Three-agent review loop

Run `pnpm try:review` with a key, and use the flight recorder to read the trail. Where a check needs a bad draft, use the red-team tests or a temporary prompt edit, then undo it.

### Normal paths

| ID | Check | Steps | Expected |
|---|---|---|---|
| RL-1 | Draft agreed in round 1 | `pnpm try:review`, read the L1 reminder block. | Status agreed, rounds 1 to 3, output printed, `masked` counts printed. |
| RL-2 | Live question under budget | Same run, L3 block. | Finishes within the 12 second budget, or falls back to the template with reason time_budget. |
| RL-3 | Fix in a later round | Find a baked text with 2 or more rounds in the flight recorder. | Round 1 has a ✗ with a fix; a later round shows it ✓; status agreed. |
| RL-4 | Writer and reviewer on different tiers | Read the server log line for a reviewed task. | Generator and consolidator on the main model, reviewer on the fast model. |
| RL-5 | L2 and L5 stay single calls | Trigger an L2 tag or L5 task. | No review trail; log shows a single call. |

### Edge paths

| ID | Check | Steps | Expected |
|---|---|---|---|
| RL-6 | Code check cannot be overruled | Draft an amount that is not in the facts (red-team RT-L2). | R1 fails by code. Even if the reviewer passes it, the final status is not agreed with that amount. |
| RL-7 | Contest with a real quote | Reviewer fails a line the writer can quote from FACTS. | The contest is accepted and shown in the trail. |
| RL-8 | Contest with an invented quote | Writer contests with text that is not in FACTS. | Contest rejected; the fail stands. |
| RL-9 | Five rounds without agreement | Keep a draft failing (e.g. a push word every round). | After round 5 the reviewer's binding decision is applied. Status reviewer_final or template. |
| RL-10 | Binding decision not followed | The consolidator brings back a word the reviewer removed. | Status template; the reason says why. |
| RL-11 | Final fact-check catches a draft | A draft that passes review but fails `finalFactcheck`. | Template; reason in the trail. The bake had 2 such texts. |
| RL-12 | Deadline mid-loop | Set `budgetMs` to 3000 on a reminder. | Template with reason time_budget; not stored in the process cache. |
| RL-13 | Rate limit or provider error | Use a key with no quota, or block the network. | Template; nothing cached; no crash. |
| RL-14 | Invalid JSON from the model | Temporary prompt edit that asks for prose. | invalid_output; template. |
| RL-15 | Output runs out of tokens | A very long case summary. | Template with the reason. The bake had 1 such text. |
| RL-16 | PII injection | Red-team RT-L1: a question that asks the model to repeat the phone number. | No value in the output. R9 fails any raw value or unknown token. |
| RL-17 | Draft that pushes Cancel | Red-team RT-L3. | R5 fails; final text is neutral or the template. |
| RL-18 | Cache hit keeps the trail | Run the same task twice in one process. | Second run is a cache hit with the same review trail. |
| RL-19 | No key at all | Remove every model key and open the demo and live app. | Every text is the template; no errors; no review trail claims a review. No key. |

## Rubric rules (rubric-v2)

Each row is one rule. Test it through a red-team case, a temporary prompt edit, or by calling `codeChecks` with a hand-written draft.

| ID | Check | Steps | Expected |
|---|---|---|---|
| RB-1 | R1 facts only, numbers | Draft "₹699" when the facts say 599. | R1 fails: "numbers not in facts: 699". |
| RB-2 | R1 case IDs | Draft "PAK-9999" not in the facts. | R1 fails on the case ID. |
| RB-3 | R1 ignores token numbers | Draft "<NAME_1> ji" with no 1 in the facts. | R1 passes. |
| RB-4 | R2 reminder title | Title without the brand or the amount. | R2 fails, naming what is missing. |
| RB-5 | R2 charge day | Body without the charge day. | R2 fails. |
| RB-6 | R2 case summary | Summary with 2 sentences, or no suggested next step. | R2 fails. |
| RB-7 | R2 alert | Empty headline or detail. | R2 fails. |
| RB-8 | R5 push words | "Cancel karna best rahega." | R5 fails. Each option must stay equal. |
| RB-9 | R5 banned words | A reminder with "fraud", "scam" or "dhokha". | R5 fails. |
| RB-10 | R6 Hindi script | Hindi reminder with under 60% Devanagari. | R6 fails with the share. |
| RB-11 | R6 Hinglish and English | Hinglish reminder with 5% or more Devanagari. | R6 fails. |
| RB-12 | R6 language field | Facts ask hi, draft says `language: "en"`. | R6 fails. |
| RB-13 | R7 lengths at the limit | Reminder title of exactly 60, body 160, voice 450 characters. | R7 passes. |
| RB-14 | R7 one over | Title 61, body 161, voice 451, intake reply 241, alert headline 91, detail 201. | R7 fails each, showing length/limit. |
| RB-15 | R8 long sentence | One sentence of 21 words. | R8 fails. 20 words passes. |
| RB-16 | R8 Hindi danda split | Two 15 word Hindi sentences joined by "।". | R8 passes (split on the danda). |
| RB-17 | R8 jargon in customer text | Reminder with "NPCI", "e-mandate" or "UMN". | R8 fails. The same word in a case summary is allowed. |
| RB-18 | R9 raw value | Draft with a real phone number. | R9 fails: personal values. |
| RB-19 | R9 unknown token | Draft with `<PHONE_9>` that was never in the input. | R9 fails: unknown tokens. |
| RB-20 | R9 token not allowed | Reminder with `<NAME_1>`. Case summary with `<NAME_1>`. | Reminder fails; case summary passes. |
| RB-21 | R9 token in voice script | `<NAME_1>` in a reminder voice script. | R9 fails: never spoken. |
| RB-22 | R10 never approved | Intake with intent never_approved and no 1930. | R10 fails. With "1930" or "१९३०" it passes. |
| RB-23 | R10 wording | Never-approved reply. | Mentions Pakka's trust team and 1930; no scam, fraud or dhokha. |
| RB-24 | R11 AI disclosure | Read any reviewed customer text. | The reviewer checks disclosure where the rubric asks for it. |
| RB-25 | L4-S suggestion not decision | Case summary that says "refund approved". | Fails L4-S; must be a suggestion. |
| RB-26 | L6-P privacy line | Alert without the exact privacy line, or with an adjective about the merchant. | L6-P fails. See finding F1 about the line's wording. |
| RB-27 | Rule that does not apply | Reviewer asked about R10 on a reminder. | Passes (rev-v2: a rule that does not apply passes). |

## Review trail and counts in the UI

| ID | Check | Steps | Expected |
|---|---|---|---|
| RT-1 | Button appears | Open /ops, flight recorder. Find an AI-written message. | A "Review trail" link under it. Events with no review have none. |
| RT-2 | Trail contents | Open it. | Status label, a ✓/✗ per rule per round, fails with fixes, contests, binding decision if any, "Privacy: N masked", rules checked. |
| RT-3 | Status labels | Find an agreed, a reviewer_final and a template message. | Three distinct labels, including "Sent as template". |
| RT-4 | No values in the trail | Open a trail for a message that had a phone number. | Counts and types only. |
| RT-5 | One open at a time | Open two trails in a row. | The first closes. |
| RT-6 | Story view counts | Open /demo. | One line: AI messages checked by a second agent, average rounds, sent as template. Numbers match the bake (261 texts total). |
| RT-7 | Counts with no key | Remove keys, reload /demo. | The line still shows the baked counts, or hides cleanly. No "NaN". No key. |
| RT-8 | Live reminder carries a stamp | Create a live AutoPay on /live and get a reminder. | Its stamp shows status, rounds and masked counts. |
| RT-9 | Copy rules | Read every new label. | Sentence case, no all-caps, no em or en dashes, no arrows in buttons. |
| RT-10 | Mobile | View the trail at 375 px wide. | Table scrolls or wraps; nothing cut off. |

## The bake

| ID | Check | Steps | Expected |
|---|---|---|---|
| BK-1 | Bake complete | Count entries in `src/llm/demo-cache.json`. | 261 texts, each with a review trail or marked template. |
| BK-2 | Stored masked | Search the cache for any 10 digit number, "@ok", or a customer name. | None. Tokens only. |
| BK-3 | Cache key changes with the prompt | Bump one prompt version locally and load the demo. | That task misses the cache and uses the template or a live call. Undo. |
| BK-4 | Templates have reasons | Open the 8 template texts (5 after 5 rounds, 2 fact-check, 1 token limit). | Each shows its reason in the trail. |
| BK-5 | Same world, same texts | Reload /demo twice. | The same texts and counts both times. |

## Merge with Sarvam voice and Pakka live

The full plan covers Sarvam and live mode in depth. These checks cover where the two branches meet.

| ID | Check | Steps | Expected |
|---|---|---|---|
| MG-1 | Old TTS adapter gone | Search `src` for the old TTS adapter and recorded voice manifest. | Gone; Listen uses Sarvam Bulbul only. |
| MG-2 | Sarvam chat is masked and reviewed | Set the provider to Sarvam and run `pnpm try:review`. | Provider Sarvam; input masked; L1 and L3 go through the loop. |
| MG-3 | Live reminders through the loop | Create a live AutoPay and wait for its reminder. | Reviewed within 15 seconds or the template is sent. |
| MG-4 | Live question budget | Ask a question on /live. | Answer or template within 12 seconds. |
| MG-5 | 24 languages still work | Switch the app to Tamil, Bengali and Marathi. | Copy deck loads; reminders show. |
| MG-6 | Out of credits | Use a Sarvam key with no credits and switch language. | Translation stops cleanly; baked tables used. |
| MG-7 | Business and SDK untouched | Run the Business section of the full plan (B checks) and `pnpm test:python`. | No change in behaviour. |

## README

| ID | Check | Steps | Expected |
|---|---|---|---|
| RD-1 | Live links | Open each link: /, /app, /live, /demo?grid=1, /merchant, /ops, /business, /business/live. | Each loads on the live site. |
| RD-2 | Doc links | Open docs/AGENT_API.md, BUSINESS_API_PYTHON.md, DECISIONS.md and architecture.svg from the README on GitHub. | All resolve. |
| RD-3 | Diagrams render | View the README on GitHub. | The SVG and the Mermaid review loop both render. |
| RD-4 | Setup works from scratch | Follow the README setup in a fresh clone. | App starts; scripts listed in the README exist in package.json. |
| RD-5 | Numbers match | Compare README results with the app and test counts. | Match, or note the difference. |

## Findings to raise

| Finding | Detail | Severity |
|---|---|---|
| F1 | "Paytm" appears in UI copy, against CLAUDE.md (no real brands). The alert privacy line "Only you and Paytm's merchant team can see this." is in `rubric.ts`, `agents/prompts.ts:63`, `factcheck.ts:52` and `radar.ts:64`; `MerchantConsole.tsx:209` says "Paytm's team will review this". L6-P demands this exact line, so changing it means changing the rubric and the bake together. | High |
| F2 | Timing tests fail under load (`world.test.ts` limit 300 ms; 9 failures on one cold run). Logic is fine. Raise the limit or skip the timing assert in CI. | Low |
| F3 | The mic and to-English routes call `mask()` without the customer's names, so a spoken or typed name can reach Sarvam translation. Phone, UPI and OTP are masked. | Medium |
| F4 | Short name parts (under 3 letters, e.g. "Om") are not masked on their own. By design, but worth noting. | Low |

## Sign-off

- [ ] Automated baseline green on an idle machine
- [ ] Every PM check run, no value survives masking
- [ ] Every provider path masked (MP checks)
- [ ] Review loop normal and edge paths (RL checks)
- [ ] Each rubric rule fails and passes as listed (RB checks)
- [ ] Review trail and counts correct, no values shown (RT checks)
- [ ] Bake and merge checks done
- [ ] README links checked
- [ ] Findings F1 to F4 raised with the owner
