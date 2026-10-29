// src/b2b/agents.ts: the three AI agents. Each runs on its own key and checks independently, so fooling one is
// not enough. None of them can move money: the most they can do is sign (or refuse to sign) an intent.
//   Payables agent (proposer): turns a matched invoice into a payment intent for the account on file.
//   Compliance agent: GSTIN, three-way match, duplicates, TDS, exact amount, payee on file.
//   Risk agent: email flags, open bank changes, new accounts, unusual amounts. Escalates to people.
// Agents read structured data only (e-invoice, purchase order, receipt, vendor master). The email body reaches
// them as intake flags, never as instructions.
import { addMin } from "./clock";
import { isGstin } from "./gstin";
import { intentHash } from "./intent";
import { attest } from "./keys";
import { findDuplicate, threeWayMatch } from "./match";
import { policyHash, railFor, tdsOn } from "./policy";
import { accountHash } from "./crypto";
import type { Treasury } from "./treasury";
import type { AgentRole, ISO, PaymentIntent, Verdict } from "./types";

const agentId = (t: Treasury, role: AgentRole) => t.world.agents.find((a) => a.companyId === t.companyId && a.role === role)!;

/** Who owns the payables queue: the company's maker. */
const makerOf = (t: Treasury) => t.world.people.find((p) => p.companyId === t.companyId && p.roles.includes("maker"))!.id;

export function propose(t: Treasury, invoiceId: string, at: ISO, attempt = 1): string | null {
  const st = t.state, w = t.world;
  const inv = w.invoices.find((i) => i.id === invoiceId)!;
  const vendor = w.vendors.find((v) => v.id === inv.vendorId)!;
  const ben = st.activeBeneficiary(vendor.id, at);
  if (!ben) {
    t.emit({ at, type: "invoice_held", actor: "agent", ruleId: "BANK_CHANGE_VERIFY_V1", payload: { invoiceId, reasons: ["No approved bank account on file for this vendor yet"] } });
    return null;
  }
  // A compromised proposer (red-team and the "fooled agent" demo) follows the bank details in the email.
  const email = t.compromised.proposer ? st.changeRequests.get(`cr_${invoiceId}`) : undefined;
  const tds = tdsOn(st.policy, vendor.category, inv.taxable);
  const amount = inv.total - tds;
  const nonce = st.nonceCounter + 1;
  const proposer = agentId(t, "proposer");
  const intent: PaymentIntent = {
    v: 1, domain: "PAKKA_B2B_INTENT_V1", intentId: `pi_${nonce}_${invoiceId.slice(4)}`, companyId: t.companyId, vendorId: vendor.id,
    beneficiaryId: ben.id, accountHash: email ? accountHash(email.ifsc, email.accountNo) : ben.accountHash,
    amount, tds, invoiceIds: [invoiceId], rail: railFor(st.policy, amount), nonce,
    policyVersion: st.policy.version, policyHash: policyHash(st.policy), modelHash: proposer.modelHash,
    preparedFor: makerOf(t), createdAt: at, expiresAt: addMin(at, st.policy.intentTtlMinutes),
  };
  const hash = intentHash(intent);
  t.emit({ at, type: "intent_proposed", actor: "agent", ruleId: "RECEIPT_V1", payload: { intentHash: hash, intent, attempt } });
  sign(t, "proposer", hash, "approve", [email ? "Bank details from the email" : "Matched invoice, account on file"], at);
  return hash;
}

function sign(t: Treasury, role: AgentRole, hash: string, verdict: Verdict, reasons: string[], at: ISO) {
  const a = attest(t.world.seed, agentId(t, role).id, role, hash, verdict, reasons, at);
  t.emit({ at, type: verdict === "reject" ? "agent_refused" : "attested", actor: "agent", ruleId: "RECEIPT_V1", payload: { intentHash: hash, attestation: a } });
}

export interface ComplianceFinding { code: "GSTIN_INVALID" | "GSTIN_NOT_VENDOR" | "MATCH" | "DUPLICATE" | "AMOUNT" | "PAYEE"; detail: string; dupKind?: "exact" | "likely" }

export function complianceFindings(t: Treasury, intent: PaymentIntent, at: ISO): ComplianceFinding[] {
  const st = t.state, w = t.world, out: ComplianceFinding[] = [];
  const inv = w.invoices.find((i) => i.id === intent.invoiceIds[0])!;
  const vendor = w.vendors.find((v) => v.id === inv.vendorId)!;
  if (!isGstin(inv.gstin)) out.push({ code: "GSTIN_INVALID", detail: `GSTIN ${inv.gstin} fails the check character` });
  else if (inv.gstin !== vendor.gstin) out.push({ code: "GSTIN_NOT_VENDOR", detail: "GSTIN is not the vendor's" });
  const po = w.pos.find((p) => p.id === inv.poId);
  const grn = w.grns.find((g) => g.poId === inv.poId && st.grns.has(g.id));
  const m = threeWayMatch(inv, po, grn, st.policy.matchToleranceBps);
  if (!m.ok) out.push({ code: "MATCH", detail: m.issues.join(", ") });
  const accepted = w.invoices.filter((i) => ["paid", "paying", "proposed", "awaiting_approval", "deferred"].includes(st.invoices.get(i.id)?.status ?? "") && !intent.invoiceIds.includes(i.id));
  const dup = findDuplicate(inv, accepted);
  if (dup) out.push({ code: "DUPLICATE", detail: `${dup.kind === "exact" ? "Same number as" : "Looks like"} ${w.invoices.find((i) => i.id === dup.of)!.number}`, dupKind: dup.kind });
  const tds = tdsOn(st.policy, vendor.category, inv.taxable);
  if (intent.tds !== tds || intent.amount !== inv.total - tds) out.push({ code: "AMOUNT", detail: `Owed ${inv.total - tds} after TDS ${tds}` });
  const ben = st.activeBeneficiary(vendor.id, at);
  if (!ben || ben.id !== intent.beneficiaryId || ben.accountHash !== intent.accountHash) out.push({ code: "PAYEE", detail: "Account is not the approved account on file" });
  return out;
}

export function runCompliance(t: Treasury, hash: string, at: ISO): ComplianceFinding[] {
  const it = t.state.intents.get(hash)!;
  const f = t.compromised.compliance ? [] : complianceFindings(t, it.intent, at);
  sign(t, "compliance", hash, f.length ? "reject" : "approve", f.length ? f.map((x) => x.code) : ["GSTIN, match, duplicates, TDS and payee checked"], at);
  return f;
}

export function riskSignals(t: Treasury, intent: PaymentIntent, at: ISO): { score: number; reasons: string[]; reject: boolean } {
  const st = t.state, w = t.world;
  const vendor = w.vendors.find((v) => v.id === intent.vendorId)!;
  const reasons: string[] = [];
  let score = 0;
  const ben = st.activeBeneficiary(vendor.id, at);
  if (!ben || ben.accountHash !== intent.accountHash) return { score: 100, reasons: ["ACCOUNT_NOT_ON_FILE"], reject: true };
  const flags = new Set(intent.invoiceIds.flatMap((id) => st.invoices.get(id)?.flags ?? []));
  for (const f of flags) { score += f === "INJECTION" || f === "BANK_CHANGE_IN_EMAIL" ? 50 : 20; reasons.push(f); }
  if ([...st.changeRequests.values()].some((c) => c.vendorId === vendor.id && c.status === "open")) { score += 40; reasons.push("OPEN_BANK_CHANGE"); }
  if (new Date(at).getTime() - new Date(ben.addedAt).getTime() < 7 * 86_400_000) { score += 30; reasons.push("NEW_ACCOUNT"); }
  const hist = [...vendor.history].sort((a, b) => a - b);
  const median = hist.length ? hist[Math.floor(hist.length / 2)] : 0;
  if (median && intent.amount > 3 * median) { score += 40; reasons.push("AMOUNT_SPIKE"); }
  if (intent.amount >= 1_00_000_00 && intent.amount % 10_000_00 === 0) { score += 10; reasons.push("ROUND_AMOUNT"); }
  return { score, reasons, reject: false };
}

export function runRisk(t: Treasury, hash: string, at: ISO): Verdict {
  const it = t.state.intents.get(hash)!;
  const r = t.compromised.risk ? { score: 0, reasons: [], reject: false } : riskSignals(t, it.intent, at);
  const verdict: Verdict = r.reject ? "reject" : r.score >= 40 ? "escalate" : "approve";
  sign(t, "risk", hash, verdict, r.reasons.length ? r.reasons : ["No risk signals"], at);
  return verdict;
}
