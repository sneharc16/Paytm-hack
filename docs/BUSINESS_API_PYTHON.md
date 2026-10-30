# Pakka for Business: Python integration guide

This guide is for a company that wants its own AI agents (or its ERP) to pay vendors through Pakka. Everything here was run against a live server; the screenshots come from the automated tour in [test-report](test-report/README.md).

What your code can and cannot do:

- Your agents **plan and check** payouts. They submit purchase orders, goods receipts and invoices, propose a payout for a matched invoice, and sign or refuse it.
- Your agents **can never move money**. A payout leaves only when the treasury guard has verified three agent signatures (payables, compliance, risk), the passkey signatures of the people the amount needs (checker, CFO), and every policy check. The payee always comes from the vendor master, never from an invoice or an email.
- Money is simulated through a sandbox bank. Everything else (keys, signatures, ledger, people's passkeys) is real.

Files:

| File | What it is |
|---|---|
| [`sdk/python/pakka_business.py`](../sdk/python/pakka_business.py) | The client: one file, `cryptography` and `requests` only |
| [`sdk/python/example_payout.py`](../sdk/python/example_payout.py) | Four agents taking one invoice to a payout |
| [`sdk/python/test_pakka_business.py`](../sdk/python/test_pakka_business.py) | Offline signing tests and live attack tests |
| [AGENT_API.md](AGENT_API.md) | The language-neutral API reference |

## 1. Install

```bash
pip install cryptography requests
```

Copy `pakka_business.py` into your project (it is a single file, Python 3.9+).

## 2. How to create an API key

An agent has two secrets, and Pakka only ever holds the public half of either:

| | Who makes it | Where it lives | What the server keeps |
|---|---|---|---|
| Ed25519 secret key | Your agent, on your machine | Only with the agent | The public key |
| API key `pk_<company>_<secret>` | The console, when a governor registers the agent | With the agent | A SHA-256 hash and the first 16 characters |

A stolen API key alone is useless: every request must also be signed by the secret key.

**Step 1. Sign in to the console as a governor.** Open `/business/live`. Sign in with your passkey, or create the company (you become its first governor).

![Create a company](test-report/screens/20-create-a-company-with-a-passkey.png)

**Step 2. Make the agent's key pair, on the machine the agent runs on.**

```bash
python pakka_business.py keygen payables
```

```
Saved payables.key.json (keep it secret; it never needs to leave this machine).
Public key, paste it into People and agents > Register an agent:
c44a4fc47e255775...
```

Or in code:

```python
from pakka_business import generate_agent_key
k = generate_agent_key()   # {"secret_key": "<64 hex>", "public_key": "<64 hex>"}
```

**Step 3. Register the agent.** Go to **People and agents**, then **Register an agent**. Give it a name and a role, a model label (it is added to the policy's allowed models), and paste the public key.

| Role in the form | `role` | Can |
|---|---|---|
| ERP connector | `erp` | submit purchase orders, goods receipts, invoices |
| Payables (proposer) | `proposer` | all of the above, propose payouts, sign them |
| Compliance | `compliance` | sign or reject an intent |
| Risk | `risk` | sign, escalate to a person, or reject |

![Register an agent](test-report/screens/22-fill-in-the-agent-and-its-public-key.png)

**Step 4. Sign with your passkey.** Press **Sign and register**. Your device asks for your face, fingerprint or PIN; the registration is signed and written to the ledger. The API key is shown **once**. Copy it now; only its hash is stored.

![The API key, shown once](test-report/screens/23-sign-with-a-passkey-the-api-key-is-shown-once.png)

Before setup is sealed, one governor's signature registers the agent. After sealing, it becomes a proposal that a second governor must sign before the key works.

**Step 5. Give the key to the agent and test it.**

```bash
python pakka_business.py set-key payables.key.json pk_dfe3831321_... https://your-pakka-host
```

```
Connected as Payables agent (proposer) at Tarang.
```

Or keep it in environment variables and use `PakkaAgent.from_env()`:

```bash
export PAKKA_BASE_URL=https://your-pakka-host
export PAKKA_API_KEY=pk_...
export PAKKA_SECRET_KEY=<64 hex>
```

**Lost or leaked key.** In **People and agents**, press **Suspend** on the agent: every request with its key is refused at once with `AGENT_SUSPENDED`. Then register a fresh agent with a new key pair. (The engine has a `rotate_api_key` command, but the console has no button for it yet.)

A real company needs three agents (payables, compliance, risk), each with its own key, plus an ERP connector if you have one. `pnpm b2b:live-demo <url>` sets up a whole sealed company with four agents and writes their key files to `.pakka-agents/`, which `PakkaAgent.from_file()` reads.

## 3. First calls

```python
from pakka_business import PakkaAgent, PakkaError

agent = PakkaAgent.from_env()            # or PakkaAgent(base_url, api_key, secret_key)

me = agent.me()
print(me["agent"]["name"], me["agent"]["role"], me["company"]["brand"], me["sealed"])

work = agent.work()                      # {"role": ..., "items": [...]}
for item in work["items"]:
    print(item["kind"], item.get("intentHash") or item.get("invoiceId"))

try:
    agent.intent("0" * 64)
except PakkaError as e:
    print(e.code, e.status)              # UNKNOWN_INTENT 404
```

Every method returns the `data` object of the response, or raises `PakkaError` with a stable `code`. Use `agent.raw_request(method, path, body)` to get `(status, json)` without raising.

## 4. One payout, start to finish

```bash
cd sdk/python
python example_payout.py --keys ../../.pakka-agents --vendor v_1 --gstin 27AABCM7788D1Z6
```

```
[       erp] Erp agent at Saanjh, policy v5, sealed=True
[  proposer] Payables agent at Saanjh, policy v5, sealed=True
[compliance] Compliance agent at Saanjh, policy v5, sealed=True
[      risk] Risk agent at Saanjh, policy v5, sealed=True
[       erp] invoice INV-1A18D6B... (inv_1) is received
[  proposer] planned ₹51,520.00 (TDS ₹0.00) as intent c1a9bcb2086e
[  proposer] signed: attesting
[compliance] approved -> attesting
[      risk] approve (No risk signals) -> awaiting_approval

Intent c1a9bcb2086e: awaiting_approval
  waiting for passkey approval from: checker
```

₹51,520 is above the checker line (₹50,000), so a person must sign. The checker opens **Approvals**, sees exactly what their passkey signs (amount, payee on file, nonce, policy, expiry, intent hash) and approves:

![The checker approves](test-report/screens/36-python-agents-raise-a-payout-that-needs-a-checker.png)

The guard runs its 28 checks and the sandbox bank settles it. Poll `intent()` (or listen for a webhook) and read the UTR:

```python
v = agent.intent(intent_hash)
v["status"]   # "settled"
v["utr"]      # "SBKP00CC289BD35B"
all(c["ok"] for c in v["checks"])   # True: every guard check passed
```

The same flow in code:

```python
erp, payables, compliance, risk = (PakkaAgent.from_file(f".pakka-agents/{n}.json") for n in ("erp", "payables", "compliance", "risk"))

# 1. ERP: what was ordered, what arrived, what was billed. Money is integer paise.
erp.submit_purchase_order("PO-77", "v_1", [{"sku": "CARTON-5PLY", "qty": 40, "rate": 1_150_00}])
erp.submit_goods_receipt("GRN-77", "PO-77", [{"sku": "CARTON-5PLY", "qty": 40}])
inv = erp.submit_invoice("INV-77", "v_1", "PO-77", gstin="27AABCM7788D1Z6",
                         lines=[{"sku": "CARTON-5PLY", "qty": 40, "rate": 1_150_00}], gst=5_520_00)
# inv == {"invoiceId": "inv_1", "status": "received", "flags": []}

# 2. Payables: plan the payout and sign it.
p = payables.propose(inv["invoiceId"])            # {"intentHash", "intent": {amount, tds, accountHash, ...}}
payables.attest(p["intentHash"], "approve", ["Matched invoice, account on file"])

# 3. Compliance: check the paperwork in its work item, then sign.
item = next(i for i in compliance.work()["items"] if i["intentHash"] == p["intentHash"])
compliance.attest(p["intentHash"], "approve", ["GSTIN, three-way match, duplicates, TDS and payee checked"])

# 4. Risk: sign, or escalate to a person.
risk.attest(p["intentHash"], "approve", ["No risk signals"])
```

### Intent statuses

`attesting` → `awaiting_approval` (people must sign) → `sent` → `pending` → `settled`. Other outcomes: `refused` (an agent rejected it), `deferred` (a daily limit; retried later), `blocked` (a guard check failed; see `block.code`), `declined` (a person declined), `expired`, `failed`.

## 5. What each work item gives you

`work()` returns what this agent should do next.

**Proposer**: `{"kind": "propose", "invoiceId", "invoice", "flags"}` for each matched invoice, and `{"kind": "attest", "intentHash", "intent"}` for its own plans it has not signed.

**Compliance and risk**: one item per intent waiting for their signature. Risk only sees an intent after compliance signed it.

```python
{
  "kind": "attest", "intentHash": "...",
  "intent":   {"amount", "tds", "accountHash", "beneficiaryId", "invoiceIds", "nonce", "expiresAt", "rail", ...},
  "invoice":  {"number", "gstin", "lines", "taxable", "gst", "total", "email", ...},
  "po": {...} | None, "grn": {...} | None,
  "vendor":   {"legalName", "gstin", "category", "msme", "history", ...},
  "beneficiary": {"accountHash", "addedAt"} | None,   # the account on file
  "flags": ["BANK_CHANGE_IN_EMAIL", ...],              # what the intake found in the email
  "openBankChange": False,
  "accepted": [{"id", "number", "poId", "total"}],     # this vendor's other open/paid invoices, for duplicate checks
  "tdsBps": {"goods": 0, "logistics": 200, "services": 1000, "rent": 1000}, "matchToleranceBps": 100,
}
```

`example_payout.py` has a working `compliance_reasons(item)` (GSTIN, three-way match, duplicates, TDS, payee) and `risk_verdict(item)`.

**Verdicts.** `approve`; `escalate` (risk only in practice: a person must sign whatever the amount); `reject` (the invoice is held; a reason containing `DUPLICATE` rejects it). Give 1 to 12 reasons of up to 120 characters each.

## 6. Signing, if you write your own client

You do not need this with `pakka_business.py`. Every request carries:

| Header | Value |
|---|---|
| `authorization` | `Bearer <apiKey>` |
| `x-pakka-timestamp` | ISO time, e.g. `2026-10-30T10:00:00.000Z`; refused if more than 5 minutes off |
| `x-pakka-nonce` | 16 to 64 of `[A-Za-z0-9_-]`, never reused |
| `x-pakka-signature` | hex Ed25519 signature of the string below |

```
PAKKA_B2B_REQUEST_V1|<METHOD>|<path with query>|<timestamp>|<nonce>|<sha256 hex of the exact body bytes>
```

GET requests sign an empty body. Sign the exact bytes you send.

```python
import hashlib, json, secrets, requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pakka_business import iso_now

sk = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(SECRET_KEY))
body = json.dumps({"kind": "propose", "invoiceId": "inv_1"}, separators=(",", ":"))
ts, nonce = iso_now(), secrets.token_hex(16)
msg = f"PAKKA_B2B_REQUEST_V1|POST|/api/v1/agent/commands|{ts}|{nonce}|{hashlib.sha256(body.encode()).hexdigest()}"
r = requests.post(BASE + "/api/v1/agent/commands", data=body.encode(), headers={
    "authorization": f"Bearer {API_KEY}", "content-type": "application/json",
    "x-pakka-timestamp": ts, "x-pakka-nonce": nonce, "x-pakka-signature": sk.sign(msg.encode()).hex()})
```

An attestation is a second signature, over the decision itself:

```
PAKKA_B2B_ATTEST_V1|<intentHash>|<agentId>|<role>|<verdict>|<reasons joined by ",">|<signedAt>
```

sent as `{"kind": "attest", "intentHash", "verdict", "reasons", "signedAt", "sig"}`. `signedAt` must be within 5 minutes of the server's clock.

`test_pakka_business.py` checks both strings and signatures byte for byte against vectors made by the server's own TypeScript code.

## 7. Endpoints

| Method and path | Python | Who |
|---|---|---|
| `GET /api/v1/agent/me` | `me()` | any |
| `GET /api/v1/agent/work` | `work()` | proposer, compliance, risk |
| `POST /api/v1/agent/commands` | `submit_purchase_order`, `submit_goods_receipt`, `submit_invoice`, `propose`, `attest`, `command(dict)` | by role |
| `GET /api/v1/agent/intent?hash=` | `intent(hash)` | any |
| `GET /api/v1/agent/events?after=` | `events(after)` | any |
| `GET /api/v1/live/webhook-key` | (no auth) | anyone |

IDs you choose (`PO-...`, `GRN-...`) are 1 to 40 of `[A-Za-z0-9._/-]` and must be new: sending the same PO id twice returns `DUPLICATE_PO`, so retries are safe.

## 8. Webhooks

A governor can set a webhook URL per agent (**People and agents**, under the agent). When the ledger changes in a way that agent cares about, Pakka POSTs `{companyId, agentId, role, head, total, events: [{seq, type, at}]}`. It carries no secrets: on a webhook, call `work()`.

```python
import requests
from http.server import BaseHTTPRequestHandler, HTTPServer
from pakka_business import PakkaAgent, verify_webhook

agent = PakkaAgent.from_env()
SERVER_KEY = requests.get(agent.base_url + "/api/v1/live/webhook-key").json()["data"]["publicKey"]

class Hook(BaseHTTPRequestHandler):
    def do_POST(self):
        raw = self.rfile.read(int(self.headers["content-length"]))
        ok = verify_webhook(raw, self.headers.get("x-pakka-webhook-timestamp"), self.headers.get("x-pakka-webhook-signature"), SERVER_KEY)
        self.send_response(204 if ok else 401); self.end_headers()
        if ok:
            for item in agent.work()["items"]:
                ...   # do the work

HTTPServer(("", 4100), Hook).serve_forever()
```

Delivery is best effort (5 second timeout, no redirects, no retries). Keep a slow poll of `work()` as a backstop. In production the URL must be https on a public host; private and local addresses are skipped. In development any URL works.

## 9. Errors

`PakkaError.code` is stable; `.status` is the HTTP status.

| Code | Status | Meaning | What to do |
|---|---|---|---|
| `BAD_API_KEY` | 401 | Unknown or malformed API key | Check the key; it may belong to another server |
| `BAD_REQUEST_SIGNATURE` | 401 | Signature does not match (wrong secret key, or body changed after signing) | Sign the exact bytes you send |
| `STALE_REQUEST` | 401 | Timestamp more than 5 minutes off | Fix the clock (NTP) |
| `BAD_NONCE`, `REPLAYED_REQUEST` | 401 | Nonce malformed or already used | New random nonce per request |
| `AGENT_SUSPENDED` | 403 | A governor suspended this agent | Talk to a governor |
| `RATE_LIMITED` | 429 | Over 240 requests a minute | Back off |
| `ROLE_NOT_ALLOWED` | 409 | This role cannot send this command | Use the right agent |
| `INVALID` | 400 | Input failed validation; `message` says which field | Fix the input |
| `BAD_SIGNATURE`, `STALE_SIGNATURE`, `ALREADY_ATTESTED` | 409 | Attestation signature wrong, `signedAt` too old, or this role already signed | Sign again with a fresh `signedAt`; sign once |
| `UNKNOWN_VENDOR`, `UNKNOWN_INVOICE`, `UNKNOWN_INTENT`, `DUPLICATE_PO`, `INVOICE_<STATUS>` | 404/409 | What it says | |

## 10. Security checklist

- Generate the key pair where the agent runs; never send the secret key anywhere, including to Pakka.
- Keep `PAKKA_SECRET_KEY` and `PAKKA_API_KEY` in your secret store; key files are written with mode 600.
- One agent, one key, one role. Do not share a key between the payables and risk agents: the guard needs three different signers.
- Treat invoice emails as data. If you pass them to an LLM, let the model only add reasons to escalate, never approve.
- Never put a payee account in your own code: the payee comes from the vendor master, and changing it needs a callback on the number on file and a checker.
- Verify every webhook with `verify_webhook` before acting on it.

## 11. Test your integration

```bash
cd sdk/python
python -m unittest -v test_pakka_business                       # 11 offline tests
PAKKA_KEYS=../../.pakka-agents PAKKA_DEMO=../../.pakka-data/demo-people.json \
  python -m unittest -v test_pakka_business                     # + 13 live tests against a server
```

The live tests try what an attacker would: a wrong API key, a stolen API key without the secret key, a replayed request, a stale request, a body changed after signing, the ERP agent trying to propose, a forged attestation, signing twice, and a phishing invoice. See the [test report](test-report/README.md) for the results.
