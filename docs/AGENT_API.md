# Pakka for Business: agent API

Your AI agents plan and check vendor payouts through this API. They can never move money themselves: a payout leaves only when the treasury guard has verified a receipt carrying three agent signatures, the passkey signatures of the people the amount requires, and every policy check. Money is simulated through a sandbox bank; everything else is real.

## Roles

| Role | Can | Cannot |
|---|---|---|
| `erp` | submit purchase orders, goods receipts and invoices | propose or sign payouts |
| `proposer` (payables) | everything `erp` can, propose a payout for a matched invoice, sign it | choose the payee: it always comes from the vendor master |
| `compliance` | sign or refuse an intent | propose |
| `risk` | sign, escalate to a person, or refuse | propose |

Agents are registered by a governor in the console. Before setup is sealed the founder registers them; after that, a new agent needs two governors. Each agent's model label is added to the policy's list of allowed models.

## Keys

Each agent makes its own Ed25519 key pair and keeps the secret key. The governor pastes the public key into the console and receives an API key once (`pk_<company>_<secret>`). The server stores only a hash of the API key.

```bash
pnpm agents keygen payables
pnpm agents set-key payables pk_xxx http://localhost:3000
```

## Signing every request

Headers on every call:

- `authorization: Bearer <apiKey>`
- `x-pakka-timestamp`: ISO time; refused if more than 5 minutes off
- `x-pakka-nonce`: 16 to 64 characters of `[A-Za-z0-9_-]`, never reused
- `x-pakka-signature`: hex Ed25519 signature over

```
PAKKA_B2B_REQUEST_V1|<METHOD>|<path with query>|<timestamp>|<nonce>|<sha256 hex of the raw body>
```

GET requests sign an empty body. A stolen API key without the secret key is useless, and a captured request cannot be replayed or altered.

## Endpoints

| Method and path | Who | What |
|---|---|---|
| `GET /api/v1/agent/me` | any | the agent, company, policy version and whether setup is sealed |
| `GET /api/v1/agent/work` | proposer, compliance, risk | what this agent should do next, with the context it needs (invoice, order, receipt, vendor, account on file, email flags, accepted invoices for duplicate checks, TDS rates) |
| `POST /api/v1/agent/commands` | see below | one command |
| `GET /api/v1/agent/intent?hash=` | any | an intent's status, signatures, approvals, block reason, UTR and the guard's checks |
| `GET /api/v1/agent/events?after=` | any | the company's ledger from a sequence number |

## Commands

```jsonc
{ "kind": "submit_po", "po": { "id": "PO-77", "vendorId": "v_1", "lines": [{ "sku": "PEPPER", "qty": 20, "rate": 200000 }] } }
{ "kind": "submit_grn", "grn": { "id": "GRN-77", "poId": "PO-77", "lines": [{ "sku": "PEPPER", "qty": 20 }] } }
{ "kind": "submit_invoice", "invoice": { "number": "MS/77", "vendorId": "v_1", "poId": "PO-77", "date": "2026-11-02T05:30:00.000Z",
    "gstin": "<vendor GSTIN>", "lines": [{ "sku": "PEPPER", "qty": 20, "rate": 200000 }], "gst": 480000,
    "email": { "from": "...", "subject": "...", "body": "..." } } }   // email optional; it is scanned, never obeyed
{ "kind": "propose", "invoiceId": "inv_1" }                          // returns { intentHash, intent }
{ "kind": "attest", "intentHash": "...", "verdict": "approve" | "escalate" | "reject", "reasons": ["..."], "signedAt": "<ISO>", "sig": "<hex>" }
```

Money is integer paise. `sig` is Ed25519 over:

```
PAKKA_B2B_ATTEST_V1|<intentHash>|<agentId>|<role>|<verdict>|<reasons joined by ",">|<signedAt>
```

`signedAt` must be within 5 minutes of the server's clock. Each role signs an intent once. A `reject` holds the invoice (a reason containing `DUPLICATE` rejects it). When all three roles have signed, the guard runs; if the amount or the risk agent's escalation needs people, the intent waits for their passkey approvals.

## What the guard checks before money moves

Frozen or not, setup sealed, intent well formed, for this company, planned in this ledger, not paid before, nonce issued, within its lifetime, signed under the current policy, three valid agent signatures from three roles with no refusal, model allowed, payee is the approved account on file and matches what was signed, invoices open and unpaid, amount exactly what is owed after TDS, no disputed bank change for the vendor, per-payout cap, rail, first-payout cap, people's passkey signatures valid with segregation of duties, everyone required has signed, account out of cooling, daily limit, payouts per vendor per day, release window, funds.

## Webhooks

A governor can set a webhook URL for each agent (https, or http on localhost for development). When the ledger changes in a way that agent cares about, Pakka POSTs a small notice: `{ companyId, agentId, role, head, total, events: [{ seq, type, at }] }`. It carries no secrets; fetch the work with `GET /api/v1/agent/work`.

Each notice is signed by the server's Ed25519 webhook key, published at `GET /api/v1/live/webhook-key`:

- `x-pakka-webhook-timestamp`: ISO time
- `x-pakka-webhook-signature`: hex Ed25519 over `PAKKA_B2B_WEBHOOK_V1|<timestamp>|<sha256 hex of body>`

Check it with `verifyWebhook(rawBody, { timestamp, signature }, serverPublicKey)` from the SDK, and refuse anything older than 5 minutes. Delivery is best effort with a 5 second timeout and no redirects; keep a slow poll as a backstop. In production, webhooks to private or local addresses are not sent. `pnpm agents run --listen 4100` runs the reference agents on webhooks.

## SDK

```ts
import { PakkaAgent } from "@/sdk/pakka-agent";
const a = new PakkaAgent({ baseUrl, apiKey, secretKey });
const work = await a.work();
const p = await a.propose(invoiceId);
await a.attest(p.data.intentHash, "approve", ["Matched invoice, account on file"]);
```

`scripts/agents/pakka-agents.ts` has working payables, compliance and risk agents built on it. With `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` set, the risk agent also asks a model to read each invoice email; the model can only add reasons to escalate.

## Errors

`{ ok: false, error: { code, message } }` with a stable code: `BAD_API_KEY`, `STALE_REQUEST`, `BAD_NONCE`, `BAD_REQUEST_SIGNATURE`, `REPLAYED_REQUEST`, `RATE_LIMITED`, `AGENT_SUSPENDED`, `ROLE_NOT_ALLOWED`, `BAD_SIGNATURE`, `STALE_SIGNATURE`, `ALREADY_ATTESTED`, `UNKNOWN_INVOICE`, `INVOICE_<STATUS>`, `INVALID: ...`.
