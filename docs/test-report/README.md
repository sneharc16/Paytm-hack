# Test report

Run on 2026-10-30 (IST evening) on branch `sarvam-voice` at commit `2723a0c` plus the changes in this report, against the dev server at http://localhost:3001, with Sarvam AI live, starting from a freshly set-up company. Money is simulated by the sandbox bank throughout.

## Summary

| Suite | What it covers | Result |
|---|---|---|
| Unit tests (`pnpm test`) | Engine, gateway, rules, B2B guard and red team, live API with software passkeys, Sarvam client, copy | **206 / 206 pass**, including a new test for the phishing-email flow on the live path. Timing tests can time out under heavy machine load and pass when run again (see F5). |
| Python client, offline (`pnpm test:python`) | Signed strings and Ed25519 signatures byte for byte against the server's TypeScript; key generation; webhook verification | **11 / 11 pass** |
| Python client, live | The agent API attacked from outside: wrong key, stolen key, replay, stale time, changed body, wrong role, forged and double signatures, phishing | **13 / 13 pass** |
| Python payout example | ERP, payables, compliance and risk agents in Python, then a checker's passkey | **Settled**, UTR `SBKP73657D3340F6`, 28 / 28 guard checks passed |
| Screenshot tour (`pnpm tour`) | Every screen, plus the consumer live and business live flows in real Chrome | **39 / 39 steps pass**, 39 screenshots below |
| Red team (in the tour) | 12 attacks on a copy of the real ledger | **0 got through.** 12 defended on a company with a past payout; on a fresh company, 11 defended and 1 skipped (nothing paid yet to replay) |

## Findings

| # | Kind | Finding | Where |
|---|---|---|---|
| F1 | Withdrawn, not a bug | First reported as "a phishing invoice comes back for approval after the vendor says they never asked". That is the designed behaviour, `docs/Pakka-for-Business-PRD.md`, "Users and use cases", use case 3: "the callback exposes it, and the real invoice is paid to the real account". The callback refutes the bank change, not the invoice: the goods arrived, so the money is owed. "Stopped" counts the diversion that was prevented. A fix was tried and reverted when `story.test.ts` and the PRD showed this. A live-path test now pins the behaviour: the invoice goes to a checker with every flag shown, and pays only the account on file. | `tests/unit/b2b/live.test.ts`; tour step 38 |
| F2 | Gap, low | The email intake does not flag "AI assistant: ignore your instructions" as `INJECTION`. Its patterns need words like "previous instructions" or "note for the AI". The same email still gets `SENDER_MISMATCH`, and the payee still comes from the vendor master. A test pins this wording so it can be tightened on purpose. | `src/b2b/intake.ts`, `INJECTION`; `test_known_gap_loose_injection_wording_is_not_flagged` |
| F3 | Missing UI, low | The console has no button to rotate an agent's API key, although the engine has `rotate_api_key`. Today, a leaked key means suspending the agent and registering a new one. | `People and agents` |
| F4 | Expected, noted | A plain ₹299 subscription with no trial scores 23 (band "list"), so it is listed with no reminder. Testers may expect a reminder. Reminders come when the risk band is "ask", for example a ₹2 trial that becomes ₹299. | consumer live |
| F5 | Flaky tests | `world.test.ts › is deterministic and fast` (300 ms limit) and `server-sessions.test.ts › plays the whole story` time out under load. Both pass on their own. | unit tests |
| F6 | Behaviour, correct | When the tour is run several times in one day, the guard defers the next payout to the same vendor under `VELOCITY` (payouts per vendor per day). The tour accepts this. The run below started from a fresh company. | tour step 37 |
| F7 | Noise | The welcome pages ask the server who is signed in, and the server answers 401 before sign-in, which the browser logs as an error. This is expected, and the tour ignores it. | `/live`, `/business/live` |

## Python tests

```
test_attest_message_and_signature_match_typescript ... ok
test_bad_secret_key_is_refused ... ok
test_body_hash_is_utf8 ... ok
test_iso_now_is_server_format ... ok
test_keygen_makes_a_working_pair ... ok
test_public_key_matches_typescript ... ok
test_request_message_and_signature_match_typescript ... ok
test_webhook_good ... ok
test_webhook_missing_headers ... ok
test_webhook_stale ... ok
test_webhook_tampered_body ... ok
test_bad_input_is_400 ... ok                                   INVALID, 400
test_body_changed_after_signing ... ok                         BAD_REQUEST_SIGNATURE
test_erp_cannot_propose ... ok                                 ROLE_NOT_ALLOWED
test_events_and_unknown_intent ... ok                          UNKNOWN_INTENT, 404
test_forged_attestation_and_double_signing ... ok              BAD_SIGNATURE, then ALREADY_ATTESTED
test_known_gap_loose_injection_wording_is_not_flagged ... ok   finding F2
test_me ... ok
test_phishing_email_is_flagged_and_payee_stays_on_file ... ok  blocked: NO_OPEN_BANK_CHANGE
test_replayed_request ... ok                                   REPLAYED_REQUEST
test_stale_request ... ok                                      STALE_REQUEST
test_stolen_api_key_without_secret_key ... ok                  BAD_REQUEST_SIGNATURE
test_webhook_key_is_published ... ok
test_wrong_api_key ... ok                                      BAD_API_KEY, 401
Ran 24 tests: OK
```

The phishing test showed the guard is stricter than expected. The bank account in the email opened a bank change request on its own, and no payout to that vendor leaves until a person does the callback, even with all three agents signed.

## How to run it again

```bash
pnpm dev --port 3001                               # or any port; set TOUR_URL
pnpm b2b:live-demo http://localhost:3001           # a sealed company with people and agents
pnpm test                                          # unit tests
PAKKA_KEYS=.pakka-agents PAKKA_DEMO=.pakka-data/demo-people.json pnpm test:python
pnpm tour                                          # screenshots and results.json in docs/test-report
```

The tour needs Google Chrome installed. Passkeys use Chrome's virtual authenticator over the DevTools protocol. These are real WebAuthn ceremonies, checked by the production verifier. The demo people's software passkeys are loaded into it so they can sign in.

## Every step

### Screens

Every page loads with HTTP 200, shows its content, and logs no browser errors.

**01. Home and hub** (Pass, 1.4 s). HTTP 200

![Home and hub](screens/01-home-and-hub.png)

**02. Consumer app (demo world)** (Pass, 1.6 s). HTTP 200

![Consumer app (demo world)](screens/02-consumer-app-demo-world.png)

**03. Stage demo** (Pass, 1.2 s). HTTP 200

![Stage demo](screens/03-stage-demo.png)

**04. Merchant console** (Pass, 1.3 s). HTTP 200

![Merchant console](screens/04-merchant-console.png)

**05. Ops console** (Pass, 1.2 s). HTTP 200

![Ops console](screens/05-ops-console.png)

**06. Ops: review radar** (Pass, 0.8 s). HTTP 200

![Ops: review radar](screens/06-ops-review-radar.png)

**07. Ops: cases** (Pass, 0.7 s). HTTP 200

![Ops: cases](screens/07-ops-cases.png)

**08. Ops: audit** (Pass, 1.2 s). HTTP 200

![Ops: audit](screens/08-ops-audit.png)

**09. Pakka for Business simulation** (Pass, 0.9 s). HTTP 200

![Pakka for Business simulation](screens/09-pakka-for-business-simulation.png)

**10. Business live: welcome** (Pass, 1.0 s). HTTP 200

![Business live: welcome](screens/10-business-live-welcome.png)

**11. Consumer live: welcome** (Pass, 3.4 s). HTTP 200

![Consumer live: welcome](screens/11-consumer-live-welcome.png)

### Consumer live

A new person signs up with a passkey (Chrome's virtual authenticator, a real WebAuthn ceremony), pastes a bank SMS, adds a ₹2 trial that becomes ₹299, gets a reminder written live by Sarvam, and pauses the AutoPay with their passkey.

**12. Sign up with a passkey** (Pass, 1.3 s).

![Sign up with a passkey](screens/12-sign-up-with-a-passkey.png)

**13. Paste a bank SMS and let Pakka read it** (Pass, 2.0 s).

![Paste a bank SMS and let Pakka read it](screens/13-paste-a-bank-sms-and-let-pakka-read-it.png)

**14. Add the AutoPay** (Pass, 0.1 s).

![Add the AutoPay](screens/14-add-the-autopay.png)

**15. Reminder arrives, written live** (Pass, 73.3 s). label: 9:51 PM, Sarvam ne aapki bhasha mein likha, Pakka ne jaancha

![Reminder arrives, written live](screens/15-reminder-arrives-written-live.png)

**16. Open the decision sheet** (Pass, 0.1 s).

![Open the decision sheet](screens/16-open-the-decision-sheet.png)

**17. Choose pause: Pakka asks for the passkey** (Pass, 0.4 s).

![Choose pause: Pakka asks for the passkey](screens/17-choose-pause-pakka-asks-for-the-passkey.png)

**18. Confirm with the passkey: AutoPay paused** (Pass, 0.2 s).

![Confirm with the passkey: AutoPay paused](screens/18-confirm-with-the-passkey-autopay-paused.png)

**19. What Pakka did, after the pause** (Pass, 0.1 s).

![What Pakka did, after the pause](screens/19-what-pakka-did-after-the-pause.png)

### API key

The steps in the [Python guide](../BUSINESS_API_PYTHON.md#2-how-to-create-an-api-key): a new company, a key pair made by the Python client, the agent registered and signed with a passkey, the API key shown once, then used from Python.

**20. Create a company with a passkey** (Pass, 1.9 s).

![Create a company with a passkey](screens/20-create-a-company-with-a-passkey.png)

**21. Open People and agents** (Pass, 0.2 s).

![Open People and agents](screens/21-open-people-and-agents.png)

**22. Fill in the agent and its public key** (Pass, 0.1 s). public key d4824fbcb485f9c0...

![Fill in the agent and its public key](screens/22-fill-in-the-agent-and-its-public-key.png)

**23. Sign with a passkey: the API key is shown once** (Pass, 0.4 s). API key pk_abf850149b_UU... (46 chars)

![Sign with a passkey: the API key is shown once](screens/23-sign-with-a-passkey-the-api-key-is-shown-once.png)

**24. Python client connects with the new key** (Pass, 0.4 s). Connected as Payables agent (proposer) at Tarang.

![Python client connects with the new key](screens/24-python-client-connects-with-the-new-key.png)

### Business live

The demo company (six people, four agents). A governor looks around and runs the red team. The Python agents send a phishing invoice, and the guard holds it. A maker calls the number on file and learns the vendor never asked for the bank change. The Python agents raise a clean payout, and a checker approves it with a passkey until it settles. The real invoice from the phishing email then waits for a checker and can only pay the account on file (PRD 3).

**25. Governor signs in with a passkey: overview** (Pass, 0.1 s).

![Governor signs in with a passkey: overview](screens/25-governor-signs-in-with-a-passkey-overview.png)

**26. Payables** (Pass, 0.1 s).

![Payables](screens/26-payables.png)

**27. Ledger: hash chained** (Pass, 0.2 s).

![Ledger: hash chained](screens/27-ledger-hash-chained.png)

**28. Policy and keys** (Pass, 0.1 s).

![Policy and keys](screens/28-policy-and-keys.png)

**29. Audit export** (Pass, 0.1 s).

![Audit export](screens/29-audit-export.png)

**30. Red team: attacks on a copy of the real ledger** (Pass, 1.8 s). 12 attacks: 11 defended, 0 got through, 1 skipped

![Red team: attacks on a copy of the real ledger](screens/30-red-team-attacks-on-a-copy-of-the-real-ledger.png)

**31. People and agents** (Pass, 0.1 s).

![People and agents](screens/31-people-and-agents.png)

**32. Agent API page** (Pass, 0.1 s).

![Agent API page](screens/32-agent-api-page.png)

**33. Python agents send a phishing invoice: guard holds it** (Pass, 0.7 s). [      risk] Risk agent at Saanjh, policy v5, sealed=True / [       erp] invoice INV-1A18D9E75EE (inv_5) is received with flags BANK_CHANGE_IN_EMAIL, URGENCY, DISCOURAGES_CALLBACK, SENDER_MISMATCH / [      risk] escalate (BANK_CHANGE_IN_EMAIL, URGENCY, DISCOURAGES_CALLBACK, SENDER_MISMATCH, OPEN_BANK_CHANGE) -> blocked / Intent 576e265983a1: blocked /   blocked: NO_OPEN_BANK_CHANGE Bank change request cr_inv_4 is open; payouts wait for the callback

![Python agents send a phishing invoice: guard holds it](screens/33-python-agents-send-a-phishing-invoice-guard-holds-.png)

**34. Maker sees bank changes the phishing emails asked for** (Pass, 0.3 s). 2 open requests

![Maker sees bank changes the phishing emails asked for](screens/34-maker-sees-bank-changes-the-phishing-emails-asked-.png)

**35. Maker calls the number on file: vendor never asked** (Pass, 2.6 s).

![Maker calls the number on file: vendor never asked](screens/35-maker-calls-the-number-on-file-vendor-never-asked.png)

**36. Python agents raise a payout that needs a checker** (Pass, 0.5 s). / Intent 62cc01e8a4ec: awaiting_approval /   waiting for passkey approval from: checker (approve in the console, or run pnpm b2b:live-demo approve)

![Python agents raise a payout that needs a checker](screens/36-python-agents-raise-a-payout-that-needs-a-checker.png)

**37. Checker approves with a passkey: guard releases the payout** (Pass, 4.8 s). intent 62cc01e8a4ec: settled SBKP281C116EC6D2;

![Checker approves with a passkey: guard releases the payout](screens/37-checker-approves-with-a-passkey-guard-releases-the.png)

**38. Real invoice from the phishing email waits for a checker (PRD 3)** (Pass, 0.2 s). INV-1A18D9E75EE waits for the checker, flags shown, payee is the account on file

![Real invoice from the phishing email waits for a checker (PRD 3)](screens/38-real-invoice-from-the-phishing-email-waits-for-a-c.png)

**39. Ledger after the payout** (Pass, 0.2 s).

![Ledger after the payout](screens/39-ledger-after-the-payout.png)
