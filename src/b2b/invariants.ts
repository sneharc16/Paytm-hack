// src/b2b/invariants.ts: properties that must hold after any run, checked from the ledger alone.
import { istDay } from "@/engine/clock";
import { approveMessage, attestMessage, verifyPersonSig, verifySig } from "./crypto";
import { verifyChain } from "./ledger";
import { rolesFor } from "./policy";
import type { Treasury } from "./treasury";

export function checkB2BInvariants(t: Treasury): string[] {
  const out: string[] = [];
  const w = t.world, st = t.state;
  const chain = verifyChain(t.events);
  if (!chain.ok) out.push(`Ledger chain broken at ${chain.brokenAt}`);
  const submitted = t.events.filter((e) => e.type === "payout_submitted");
  const paidInvoices = new Map<string, number>();
  for (const e of submitted) {
    const it = st.intents.get(e.payload.intentHash);
    if (!it) { out.push(`Payout ${e.seq} has no planned intent`); continue; }
    if (!e.ruleId) out.push(`Payout ${e.seq} has no rule`);
    if (!e.payload.checks?.every((c: { ok: boolean }) => c.ok)) out.push(`Payout ${e.seq} released with a failing check`);
    // Three valid agent signatures from three different roles.
    const roles = new Set<string>();
    for (const a of it.attestations) {
      const ag = w.agents.find((x) => x.id === a.signerId);
      if (ag && a.verdict !== "reject" && a.intentHash === it.hash && verifySig(ag.publicKey, attestMessage(a), a.sig)) roles.add(ag.role);
    }
    if (roles.size !== 3) out.push(`Payout ${e.seq} without three agent signatures`);
    // The people the tier demanded, each signature valid, no person twice, never the preparer.
    const people = it.approvals.filter((a) => a.at <= e.at);
    for (const need of rolesFor(e.payload.tier)) {
      const ap = people.find((a) => a.role === need);
      const p = ap && w.people.find((x) => x.id === ap.personId);
      if (!ap || !p || !verifyPersonSig(p, approveMessage(ap), ap, st.rp, st.requirePasskey)) out.push(`Payout ${e.seq} missing a valid ${need}`);
    }
    if (new Set(people.map((a) => a.personId)).size !== people.length) out.push(`Payout ${e.seq} has one person in two seats`);
    if (people.some((a) => a.personId === it.intent.preparedFor)) out.push(`Payout ${e.seq} approved by its preparer`);
    const ben = st.beneficiaries.get(it.intent.beneficiaryId);
    if (!ben || ben.accountHash !== it.intent.accountHash || e.payload.bankEntry.accountHash !== ben.accountHash) out.push(`Payout ${e.seq} not to the account on file`);
    for (const id of it.intent.invoiceIds) paidInvoices.set(id, (paidInvoices.get(id) ?? 0) + (it.status === "failed" ? 0 : 1));
  }
  for (const [id, n] of paidInvoices) if (n > 1) out.push(`Invoice ${id} paid ${n} times`);
  const nonces = submitted.map((e) => e.payload.nonce);
  if (new Set(nonces).size !== nonces.length) out.push("A nonce was used twice");
  const settled = [...st.intents.values()].filter((x) => ["settled", "sent", "pending"].includes(x.status)).reduce((s, x) => s + x.intent.amount, 0);
  const funded = t.events.filter((e) => e.type === "sandbox_funded").reduce((x, e) => x + e.payload.amount, 0);
  const opening = w.companies.find((c) => c.id === t.companyId)!.openingBalance + funded;
  if (opening - settled !== st.balance) out.push(`Balance ${st.balance} is not opening minus payouts ${opening - settled}`);
  if (st.balance < 0) out.push("Balance went negative");
  // Caps, from the ledger: payouts on each IST day against the policy active when each was released.
  const byDay = new Map<string, number>();
  for (const e of submitted) {
    const it = st.intents.get(e.payload.intentHash)!;
    if (it.status === "failed") continue;
    const d = istDay(e.at);
    byDay.set(d, (byDay.get(d) ?? 0) + it.intent.amount);
  }
  const maxLimit = Math.max(st.policy.dailyLimit, ...[...st.proposals.values()].filter((p) => p.status === "active" || p.status === "superseded").map((p) => p.policy.dailyLimit));
  for (const [d, v] of byDay) if (v > maxLimit) out.push(`Daily limit passed on ${d}`);
  return out;
}
