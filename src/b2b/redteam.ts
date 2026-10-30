// src/b2b/redteam.ts: attacks on the business treasury, each executed for real against a fresh treasury (and,
// where needed, a modified copy of the world). Nothing here is hard-coded as "defended": a case passes only if
// it observes the defence. Receipt-tampering cases first check that the untouched receipt passes, so a pass
// can't come from a broken setup.
import { B2B_END, ist } from "./clock";
import { accountHash, dhash } from "./crypto";
import { verifyReceipt, type GuardVerdict } from "./guard";
import { intentHash } from "./intent";
import { approve, attest } from "./keys";
import { verifyChain } from "./ledger";
import { Treasury } from "./treasury";
import type { BusinessWorld, PaymentIntent, Receipt } from "./types";
import { KAVERI, SAANJH } from "./world";

export interface RedTeamResult { id: string; passed: boolean; observed: string[]; moneyMoved: boolean }
export interface RedTeamCase { id: string; group: "Receipt" | "Agents" | "Email" | "People" | "Policy" | "Bank" | "Ledger"; title: string; attack: string; expected: string; run: (w: BusinessWorld) => RedTeamResult }

const fresh = (w: BusinessWorld, at: string, co = SAANJH, setup?: (t: Treasury) => void) => {
  const t = new Treasury(w, co);
  setup?.(t);
  t.advance(at);
  return t;
};
const inv = (w: BusinessWorld, tag: string) => w.invoices.find((i) => i.tag === tag)!;
const intentOf = (t: Treasury, tag: string) => t.state.intents.get(t.state.invoices.get(inv(t.world, tag)!.id)!.intentHash!)!;
const ctx = (t: Treasury) => ({ world: t.world, state: t.state, companyId: t.companyId });
const failed = (v: GuardVerdict) => v.checks.filter((c) => !c.ok).map((c) => c.code);
const says = (v: GuardVerdict) => `Guard: ${v.outcome}${v.code ? ` (${v.code})` : ""}; failed checks: ${failed(v).join(", ") || "none"}`;
const res = (id: string, passed: boolean, observed: string[], moneyMoved = false): RedTeamResult => ({ id, passed: passed && !moneyMoved, observed, moneyMoved });
const clone = (w: BusinessWorld): BusinessWorld => structuredClone(w);

/** A complete, correctly signed receipt for an intent awaiting the CFO tier, signed by the real people. */
function signedReceipt(t: Treasury, tag: string, at: string): Receipt {
  const it = intentOf(t, tag);
  const approvals = it.needs.map((role) => approve(t.world.seed, t.companyId, role === "checker" ? (t.companyId === SAANJH ? "p_arjun" : "p_lata") : (t.companyId === SAANJH ? "p_meera" : "p_suresh"), role, it.hash, at));
  return { intent: it.intent, attestations: it.attestations, approvals };
}

/** An attacker holding every agent key re-signs a modified intent. */
function resignAll(t: Treasury, intent: PaymentIntent, at: string, co = t.companyId): Receipt {
  const h = intentHash(intent);
  const ids = t.world.agents.filter((a) => a.companyId === co);
  return { intent, attestations: ids.flatMap((a) => (a.role === "erp" ? [] : [attest(t.world.seed, a.id, a.role, h, "approve", ["ok"], at)])), approvals: [] };
}

const T1 = ist("2026-10-26 11:49"); // Godavari (CFO tier) and Ganga (checker) are waiting for people
const T1b = ist("2026-10-26 11:49:30");
const paidToAccount = (t: Treasury, hash: string) => [...t.state.bankBook.values()].some((e) => e.accountHash === hash);

export const RED_TEAM_B2B: RedTeamCase[] = [
  {
    id: "BT-01", group: "Receipt", title: "Forged agent signature", attack: "Replace the compliance agent's signature with random bytes", expected: "SIGNATURES_VALID fails",
    run(w) {
      const t = fresh(w, T1);
      const good = signedReceipt(t, "cfo", T1b);
      const control = verifyReceipt(ctx(t), good, T1b);
      const bad = { ...good, attestations: good.attestations.map((a) => (a.role === "compliance" ? { ...a, sig: "ab".repeat(64) } : a)) };
      const v = verifyReceipt(ctx(t), bad, T1b);
      return res("BT-01", control.outcome === "release" && v.outcome === "block" && failed(v).includes("SIGNATURES_VALID"), [`Untouched receipt: ${control.outcome}`, says(v)]);
    },
  },
  {
    id: "BT-02", group: "Receipt", title: "Amount raised after signing", attack: "Add ₹1 to a fully approved ₹6.8 lakh payout", expected: "Every signature stops matching",
    run(w) {
      const t = fresh(w, T1);
      const good = signedReceipt(t, "cfo", T1b);
      const v = verifyReceipt(ctx(t), { ...good, intent: { ...good.intent, amount: good.intent.amount + 100 } }, T1b);
      const f = failed(v);
      return res("BT-02", v.outcome === "block" && f.includes("SIGNATURES_VALID") && f.includes("PLANNED_IN_LEDGER") && f.includes("AMOUNT_EXACT"), [says(v)]);
    },
  },
  {
    id: "BT-03", group: "Receipt", title: "Payee swapped after signing", attack: "Point an approved payout at the fraudster's account", expected: "ACCOUNT_BOUND and SIGNATURES_VALID fail",
    run(w) {
      const t = fresh(w, T1);
      const good = signedReceipt(t, "cfo", T1b);
      const fraud = accountHash(w.storyAccounts.fraud.ifsc, w.storyAccounts.fraud.accountNo);
      const v = verifyReceipt(ctx(t), { ...good, intent: { ...good.intent, accountHash: fraud } }, T1b);
      return res("BT-03", v.outcome === "block" && failed(v).includes("ACCOUNT_BOUND") && failed(v).includes("SIGNATURES_VALID"), [says(v)]);
    },
  },
  {
    id: "BT-04", group: "Receipt", title: "Replay a paid receipt", attack: "Submit the receipt of a payout that already went out", expected: "NOT_REPLAYED fails, the bank is never called",
    run(w) {
      const t = fresh(w, ist("2026-10-26 10:00"));
      const it = intentOf(t, "dup_original");
      const before = t.state.bankBook.size;
      const v = verifyReceipt(ctx(t), t.receipt(it.hash), ist("2026-10-26 10:00:10"));
      t.release(it.hash, ist("2026-10-26 10:00:10"));
      return res("BT-04", it.status === "settled" && v.outcome === "block" && failed(v).includes("NOT_REPLAYED") && t.state.bankBook.size === before, [`Original: ${it.status}`, says(v), `Bank entries before and after: ${before}, ${t.state.bankBook.size}`]);
    },
  },
  {
    id: "BT-05", group: "Receipt", title: "Made-up nonce, stolen agent keys", attack: "With all three agent keys, sign a new intent with nonce 9999", expected: "NONCE_ISSUED and PLANNED_IN_LEDGER fail",
    run(w) {
      const t = fresh(w, T1);
      const it = intentOf(t, "cfo");
      const r = resignAll(t, { ...it.intent, nonce: 9999, intentId: "pi_9999_x" }, T1b);
      const v = verifyReceipt(ctx(t), r, T1b);
      return res("BT-05", v.outcome === "block" && failed(v).includes("NONCE_ISSUED") && failed(v).includes("PLANNED_IN_LEDGER"), [says(v)]);
    },
  },
  {
    id: "BT-06", group: "Receipt", title: "Expired receipt", attack: "Hold an approved receipt and submit it after its 12 hour life", expected: "NOT_EXPIRED fails",
    run(w) {
      const t = fresh(w, T1);
      const good = signedReceipt(t, "cfo", T1b);
      const late = ist("2026-10-27 00:30");
      const v = verifyReceipt(ctx(t), good, late);
      return res("BT-06", v.outcome === "block" && failed(v).includes("NOT_EXPIRED"), [says(v)]);
    },
  },
  {
    id: "BT-07", group: "Receipt", title: "Cross-company replay", attack: "Submit Kaveri Fresh's valid receipt to Saanjh's treasury, and a Saanjh intent signed with Kaveri's agent keys", expected: "TENANT and SIGNATURES_VALID fail",
    run(w) {
      const k = fresh(w, ist("2026-10-26 10:11"), KAVERI);
      const s = fresh(w, T1);
      const kIt = [...k.state.intents.values()][0] ?? null;
      const kv = kIt ? verifyReceipt(ctx(s), k.receipt(kIt.hash), T1b) : null;
      const sIt = intentOf(s, "cfo");
      const forged = resignAll(s, sIt.intent, T1b, KAVERI);
      const sv = verifyReceipt(ctx(s), forged, T1b);
      return res("BT-07", !!kv && kv.outcome === "block" && failed(kv).includes("TENANT") && failed(sv).includes("SIGNATURES_VALID"), [kv ? `Kaveri receipt at Saanjh: ${says(kv)}` : "No Kaveri receipt", `Kaveri keys on Saanjh intent: ${says(sv)}`]);
    },
  },
  {
    id: "BT-08", group: "Email", title: "Prompt injection fools the payables agent", attack: "The email tells the AI to pay a new account. The payables agent obeys", expected: "Compliance and risk refuse to sign; nothing reaches the bank",
    run(w) {
      const t = fresh(w, ist("2026-10-26 11:21"), SAANJH, (x) => { x.compromised.proposer = true; });
      const it = intentOf(t, "injection");
      const fraud = accountHash(w.storyAccounts.fraud.ifsc, w.storyAccounts.fraud.accountNo);
      const refusals = it.attestations.filter((a) => a.verdict === "reject").map((a) => `${a.role}: ${a.reasons.join(", ")}`);
      return res("BT-08", it.intent.accountHash === fraud && it.status === "refused" && refusals.length >= 1, [`Payables agent planned the fraud account: ${it.intent.accountHash === fraud}`, ...refusals, `Intent: ${it.status}`, `Quarantined: ${t.events.some((e) => e.type === "quarantined")}`], paidToAccount(t, fraud));
    },
  },
  {
    id: "BT-09", group: "Agents", title: "All three agents compromised", attack: "Every agent signs the fraud account from the injected email", expected: "Guard blocks on ACCOUNT_BOUND; the bank never sees it",
    run(w) {
      const t = fresh(w, ist("2026-10-26 18:00"), SAANJH, (x) => { x.compromised = { proposer: true, compliance: true, risk: true }; });
      const it = intentOf(t, "injection");
      const fraud = accountHash(w.storyAccounts.fraud.ifsc, w.storyAccounts.fraud.accountNo);
      const blocks = t.events.filter((e) => e.type === "guard_blocked" && e.payload.intentHash === it.hash).map((e) => e.payload.code);
      return res("BT-09", blocks.includes("ACCOUNT_BOUND") || it.block?.code === "ACCOUNT_BOUND", [`Signatures collected: ${it.attestations.map((a) => `${a.role} ${a.verdict}`).join(", ")}`, `Guard blocks: ${[...new Set(blocks)].join(", ")}`, `Invoice: ${t.state.invoices.get(it.intent.invoiceIds[0])!.status}`], paidToAccount(t, fraud));
    },
  },
  {
    id: "BT-10", group: "Email", title: "Bank change by email", attack: "Ask by email to move a vendor's payments to a new account and discourage calls", expected: "Change request opened, penny drop name mismatch, callback denial opens a fraud case",
    run(w) {
      const t = fresh(w, ist("2026-10-26 12:11"));
      const cr = t.state.changeRequests.get(`cr_${inv(w, "injection").id}`)!;
      const c = [...t.state.cases.values()].find((x) => x.kind === "fraud_attempt");
      const approveTry = t.command(ist("2026-10-26 12:12"), { kind: "decide_change", requestId: cr.id, personId: "p_kabir", decision: "approved", pin: "135790" });
      return res("BT-10", cr.status === "rejected" && (cr.penny?.score ?? 100) < 80 && !!c && !approveTry.ok, [`Penny drop holder: ${cr.penny?.holder}, name match ${cr.penny?.score}%`, `Callback: ${cr.callback?.outcome}`, `Request: ${cr.status}`, `Case: ${c?.id}`, `Approving it anyway: ${approveTry.reason}`]);
    },
  },
  {
    id: "BT-11", group: "Email", title: "Approve a bank change without a callback", attack: "A checker approves new bank details before anyone calls the vendor", expected: "Refused: CALLBACK_REQUIRED",
    run(w) {
      const t = fresh(w, ist("2026-10-26 11:25"));
      const r = t.command(ist("2026-10-26 11:26"), { kind: "decide_change", requestId: `cr_${inv(w, "injection").id}`, personId: "p_kabir", decision: "approved", pin: "135790" });
      return res("BT-11", !r.ok && r.reason === "CALLBACK_REQUIRED", [`Command: ${r.reason}`]);
    },
  },
  {
    id: "BT-12", group: "Policy", title: "Pay a brand new account at once", attack: "Pay a vendor onboarded four hours ago, with a checker's approval", expected: "Deferred until the 24 hour cooling ends",
    run(w) {
      const t = fresh(w, ist("2026-10-26 15:01"));
      const it = intentOf(t, "new_vendor");
      const until = it.deferredUntil ?? "";
      return res("BT-12", it.status === "deferred" && it.checks?.some((c) => c.code === "COOLING" && !c.ok) === true && until >= ist("2026-10-27 10:00"), [`Status: ${it.status}`, `Released from: ${until}`]);
    },
  },
  {
    id: "BT-13", group: "Policy", title: "Split payments to dodge approval", attack: "Three ₹48,000 invoices from one vendor in a day, each under the ₹50,000 checker line", expected: "Second and third need a checker (STRUCTURING_V1)",
    run(w) {
      const t = fresh(w, ist("2026-10-26 16:31"));
      const tiers = ["split_1", "split_2", "split_3"].map((tag) => intentOf(t, tag).tier ?? "agents");
      return res("BT-13", tiers[0] === "agents" && tiers[1] === "checker" && tiers[2] === "checker", [`Tiers: ${tiers.join(", ")}`]);
    },
  },
  {
    id: "BT-14", group: "Agents", title: "Agents' daily cap", attack: "Agents alone keep paying small invoices all day", expected: "Agent-only payouts never pass the daily cap; the rest go to a checker",
    run(w) {
      const t = fresh(w, B2B_END);
      const byDay = [...t.state.agentOnlyByDay.entries()];
      const cap = t.state.policy.agentOnlyDailyCap;
      const escalated = t.events.filter((e) => e.type === "approval_needed" && (e.payload.reasons as string[]).some((r) => r.includes("AGENT_CAP"))).length;
      const v1cap = 3_00_000_00;
      return res("BT-14", byDay.every(([d, v]) => v <= (d === "2026-10-28" ? cap : v1cap)) && escalated > 0, [...byDay.map(([d, v]) => `${d}: ${v / 100} rupees by agents alone`), `Escalated by the cap: ${escalated}`]);
    },
  },
  {
    id: "BT-15", group: "Policy", title: "Duplicate invoices", attack: "Resend a paid invoice as is, then with a changed number", expected: "Both rejected before any payout",
    run(w) {
      const t = fresh(w, ist("2026-10-27 10:16"));
      const a = t.state.invoices.get(inv(w, "dup_exact").id)!, b = t.state.invoices.get(inv(w, "dup_fuzzy").id)!;
      return res("BT-15", a.status === "rejected" && b.status === "rejected", [`Exact copy: ${a.status} (${a.reasons[0]})`, `Changed number: ${b.status} (${b.reasons[0]})`]);
    },
  },
  {
    id: "BT-16", group: "People", title: "Approve your own payout", attack: "The person who prepared a payout signs it as checker", expected: "APPROVALS_VALID fails (SOD_V1)",
    run(w0) {
      const w = clone(w0);
      w.people.find((p) => p.id === "p_neha")!.roles.push("checker");
      const t = fresh(w, T1);
      const it = intentOf(t, "services_tds");
      const r = { ...t.receipt(it.hash), approvals: [approve(w.seed, SAANJH, "p_neha", "checker", it.hash, T1b)] };
      const v = verifyReceipt(ctx(t), r, T1b);
      return res("BT-16", v.outcome === "block" && failed(v).includes("APPROVALS_VALID") && (v.checks.find((c) => c.code === "APPROVALS_VALID")?.detail ?? "").includes("SOD_V1"), [says(v)]);
    },
  },
  {
    id: "BT-17", group: "People", title: "One person fills two seats", attack: "The checker also signs in the CFO's seat", expected: "Refused: not a CFO",
    run(w) {
      const t = fresh(w, T1);
      const it = intentOf(t, "cfo");
      const r = { ...t.receipt(it.hash), approvals: [approve(w.seed, SAANJH, "p_arjun", "checker", it.hash, T1b), approve(w.seed, SAANJH, "p_arjun", "cfo", it.hash, T1b)] };
      const v = verifyReceipt(ctx(t), r, T1b);
      return res("BT-17", v.outcome === "block" && failed(v).includes("APPROVALS_VALID"), [says(v)]);
    },
  },
  {
    id: "BT-18", group: "People", title: "Reuse an approval", attack: "Copy the checker's signature from one payout onto another", expected: "APPROVALS_VALID fails",
    run(w) {
      const t = fresh(w, T1);
      const a = intentOf(t, "services_tds"), b = intentOf(t, "cfo");
      const sig = approve(w.seed, SAANJH, "p_arjun", "checker", a.hash, T1b);
      const v = verifyReceipt(ctx(t), { ...t.receipt(b.hash), approvals: [{ ...sig, intentHash: b.hash }, approve(w.seed, SAANJH, "p_meera", "cfo", b.hash, T1b)] }, T1b);
      return res("BT-18", v.outcome === "block" && failed(v).includes("APPROVALS_VALID"), [says(v)]);
    },
  },
  {
    id: "BT-19", group: "Agents", title: "Double vote by one agent", attack: "Add a second compliance signature to look like a bigger quorum", expected: "SIGNATURES_VALID fails",
    run(w) {
      const t = fresh(w, T1);
      const good = signedReceipt(t, "cfo", T1b);
      const dup = good.attestations.find((a) => a.role === "compliance")!;
      const v = verifyReceipt(ctx(t), { ...good, attestations: [...good.attestations, dup] }, T1b);
      return res("BT-19", v.outcome === "block" && failed(v).includes("SIGNATURES_VALID"), [says(v)]);
    },
  },
  {
    id: "BT-20", group: "Agents", title: "Suspended agent key", attack: "Keep using the risk agent after a governor suspends its key", expected: "Every payout stops on SIGNATURES_VALID until two governors reinstate it",
    run(w) {
      const t = fresh(w, ist("2026-10-26 09:30"));
      t.command(ist("2026-10-26 09:31"), { kind: "suspend_agent", personId: "p_sana", agentId: "a_saanjh_risk", reason: "Unusual signing volume", pin: "246802" });
      t.advance(ist("2026-10-26 09:41"));
      const it = intentOf(t, "split_1");
      const one = t.command(ist("2026-10-26 09:45"), { kind: "propose_reinstate", personId: "p_sana", agentId: "a_saanjh_risk", pin: "246802" });
      const stillOff = t.state.agentStatus.get("a_saanjh_risk");
      t.command(ist("2026-10-26 09:50"), { kind: "sign_proposal", proposalId: String(one.data?.proposalId), personId: "p_vikram", pin: "246802" });
      return res("BT-20", it.status === "blocked" && it.block?.code === "SIGNATURES_VALID" && stillOff === "suspended" && t.state.agentStatus.get("a_saanjh_risk") === "active", [`Payout after suspension: ${it.status} (${it.block?.code})`, `After one governor: ${stillOff}`, `After two: ${t.state.agentStatus.get("a_saanjh_risk")}`]);
    },
  },
  {
    id: "BT-21", group: "Agents", title: "Unapproved model", attack: "Sign an intent produced by a model that is not on the policy's list", expected: "MODEL_ALLOWED fails",
    run(w) {
      const t = fresh(w, T1);
      const it = intentOf(t, "cfo");
      const v = verifyReceipt(ctx(t), resignAll(t, { ...it.intent, modelHash: dhash("model", "shadow-model-v9") }, T1b), T1b);
      return res("BT-21", v.outcome === "block" && failed(v).includes("MODEL_ALLOWED"), [says(v)]);
    },
  },
  {
    id: "BT-22", group: "Receipt", title: "Malformed intent", attack: "Send a fractional amount and an extra field the guard does not know", expected: "WELL_FORMED fails before anything else is read",
    run(w) {
      const t = fresh(w, T1);
      const it = intentOf(t, "cfo");
      const v = verifyReceipt(ctx(t), { ...t.receipt(it.hash), intent: { ...it.intent, amount: 10.5, bypass: true } as unknown as PaymentIntent }, T1b);
      return res("BT-22", v.outcome === "block" && v.code === "WELL_FORMED", [says(v)]);
    },
  },
  {
    id: "BT-23", group: "Receipt", title: "Overpay with stolen keys", attack: "Re-sign an intent that pays ₹10 more than the invoice owes", expected: "AMOUNT_EXACT fails",
    run(w) {
      const t = fresh(w, T1);
      const it = intentOf(t, "cfo");
      const v = verifyReceipt(ctx(t), resignAll(t, { ...it.intent, amount: it.intent.amount + 1000 }, T1b), T1b);
      return res("BT-23", v.outcome === "block" && failed(v).includes("AMOUNT_EXACT"), [says(v)]);
    },
  },
  {
    id: "BT-24", group: "Policy", title: "Old policy, new rules", attack: "Release a receipt signed before the governors tightened the policy", expected: "POLICY_CURRENT fails; the invoice is planned again under the new policy",
    run(w) {
      const t = fresh(w, T1);
      const old = signedReceipt(t, "services_tds", T1b);
      t.command(ist("2026-10-26 11:49:35"), { kind: "propose_policy", personId: "p_meera", changes: { perTxnCap: 9_00_000_00 }, pin: "246802" });
      t.command(ist("2026-10-26 11:49:40"), { kind: "sign_proposal", proposalId: "GOV-101", personId: "p_sana", pin: "246802" });
      const v = verifyReceipt(ctx(t), old, ist("2026-10-26 11:49:45"));
      return res("BT-24", t.state.policy.version === 2 && v.outcome === "block" && failed(v).includes("POLICY_CURRENT"), [`Active policy: v${t.state.policy.version} (a tightening, so no timelock)`, says(v)]);
    },
  },
  {
    id: "BT-25", group: "Policy", title: "Per-payout cap", attack: "Governors cut the per-payout cap to ₹5 lakh; a ₹6.8 lakh invoice arrives", expected: "PER_TXN_CAP blocks it for good",
    run(w) {
      const t = fresh(w, ist("2026-10-26 10:00"));
      const p = t.command(ist("2026-10-26 10:01"), { kind: "propose_policy", personId: "p_vikram", changes: { perTxnCap: 5_00_000_00 }, pin: "246802" });
      t.command(ist("2026-10-26 10:02"), { kind: "sign_proposal", proposalId: String(p.data?.proposalId), personId: "p_sana", pin: "246802" });
      t.advance(ist("2026-10-26 10:21"));
      const it = intentOf(t, "cfo");
      return res("BT-25", it.status === "blocked" && it.block?.code === "PER_TXN_CAP", [`Payout: ${it.status} (${it.block?.code})`], it.status === "sent" || it.status === "settled");
    },
  },
  {
    id: "BT-26", group: "Policy", title: "One governor loosens the rules", attack: "The CFO raises the daily limit alone, then with a second governor, then a third governor vetoes", expected: "Nothing changes with one signature; two start a 24 hour timelock; a veto cancels it",
    run(w) {
      const t = fresh(w, ist("2026-10-27 11:59"), SAANJH, (x) => { x.autoplay = false; });
      const p = t.command(ist("2026-10-27 12:00"), { kind: "propose_policy", personId: "p_meera", changes: { dailyLimit: 90_00_000_00 }, pin: "246802" });
      const id = String(p.data?.proposalId);
      const afterOne = t.state.policy.dailyLimit;
      t.command(ist("2026-10-27 12:05"), { kind: "sign_proposal", proposalId: id, personId: "p_vikram", pin: "246802" });
      const scheduled = t.state.proposals.get(id)!.status;
      const stillOld = t.state.policy.dailyLimit;
      t.command(ist("2026-10-27 18:00"), { kind: "veto_proposal", proposalId: id, personId: "p_sana", pin: "246802" });
      t.advance(B2B_END);
      return res("BT-26", afterOne === 30_00_000_00 && scheduled === "scheduled" && stillOld === 30_00_000_00 && t.state.policy.dailyLimit === 30_00_000_00 && t.state.proposals.get(id)!.status === "vetoed", [`After one signature: limit ${afterOne / 100}`, `After two: ${scheduled}, limit still ${stillOld / 100}`, `After veto and the end of the story: ${t.state.proposals.get(id)!.status}, limit ${t.state.policy.dailyLimit / 100}`]);
    },
  },
  {
    id: "BT-27", group: "People", title: "Freeze and a one-person unfreeze", attack: "Freeze payouts, then try to release them with a single governor", expected: "Payouts stop at once; they resume only after two governors sign",
    run(w) {
      const t = fresh(w, ist("2026-10-26 09:35"));
      t.command(ist("2026-10-26 09:36"), { kind: "freeze", personId: "p_arjun", reason: "Suspicious emails this morning", pin: "246802" });
      t.advance(ist("2026-10-26 09:41"));
      const it = intentOf(t, "split_1");
      const blocked = `${it.status} ${it.block?.code}`;
      const p = t.command(ist("2026-10-26 09:45"), { kind: "propose_unfreeze", personId: "p_meera", pin: "246802" });
      const afterOne = t.state.frozen.on;
      t.command(ist("2026-10-26 09:50"), { kind: "sign_proposal", proposalId: String(p.data?.proposalId), personId: "p_sana", pin: "246802" });
      return res("BT-27", blocked === "blocked NOT_FROZEN" && afterOne && !t.state.frozen.on && intentOf(t, "split_1").status === "settled", [`While frozen: ${blocked}`, `After one governor: frozen ${afterOne}`, `After two: frozen ${t.state.frozen.on}, payout ${intentOf(t, "split_1").status}`]);
    },
  },
  {
    id: "BT-28", group: "People", title: "Guess the PIN", attack: "Three wrong PINs, then the right one", expected: "Locked out for 15 minutes; every try is in the ledger",
    run(w) {
      const t = fresh(w, T1);
      const it = intentOf(t, "services_tds");
      const tries = ["111", "abcdef", "000000"].map((pin, i) => t.command(ist(`2026-10-26 11:49:${40 + i}`), { kind: "approve", intentHash: it.hash, personId: "p_arjun", role: "checker", pin }).reason);
      const right = t.command(ist("2026-10-26 11:49:50"), { kind: "approve", intentHash: it.hash, personId: "p_arjun", role: "checker", pin: "246802" });
      const logged = t.events.filter((e) => e.type === "command_refused").length;
      return res("BT-28", right.reason === "LOCKED_OUT" && logged >= 4 && intentOf(t, "services_tds").approvals.length === 0, [`Tries: ${tries.join(", ")}`, `Right PIN while locked: ${right.reason}`, `Refusals in the ledger: ${logged}`]);
    },
  },
  {
    id: "BT-29", group: "Bank", title: "Bank times out", attack: "The bank never answers a payout; the system is tempted to send it again", expected: "Status is checked, the payout is never resent, it is paid once",
    run(w) {
      const t = fresh(w, B2B_END);
      const id = Object.entries(w.bankScripts).find(([, s]) => s === "timeout_then_success")![0];
      const hashes = [...t.state.intents.values()].filter((x) => x.intent.invoiceIds.includes(id)).map((x) => x.hash);
      const submits = t.events.filter((e) => e.type === "payout_submitted" && hashes.includes(e.payload.intentHash)).length;
      const checks = t.events.filter((e) => e.type === "status_checked" && hashes.includes(e.payload.intentHash)).length;
      return res("BT-29", submits === 1 && t.state.invoices.get(id)!.status === "paid", [`Payouts sent: ${submits}`, `Status checks while pending: ${checks}`, `Invoice: ${t.state.invoices.get(id)!.status}`]);
    },
  },
  {
    id: "BT-30", group: "Bank", title: "Bank rejects a payout", attack: "The beneficiary bank is down at the first try", expected: "Money returned to the balance, planned again with a new nonce, paid once",
    run(w) {
      const t = fresh(w, B2B_END);
      const id = Object.entries(w.bankScripts).find(([, s]) => s === "fail_technical")![0];
      const its = [...t.state.intents.values()].filter((x) => x.intent.invoiceIds.includes(id));
      const settled = its.filter((x) => x.status === "settled").length;
      return res("BT-30", its.some((x) => x.status === "failed") && settled === 1 && new Set(its.map((x) => x.intent.nonce)).size === its.length, [`Intents: ${its.map((x) => `nonce ${x.intent.nonce} ${x.status}`).join(", ")}`]);
    },
  },
  {
    id: "BT-31", group: "Bank", title: "Not enough money", attack: "The account has ₹1 lakh when a ₹2.4 lakh payout is approved", expected: "FUNDS blocks it; nothing is overdrawn",
    run(w0) {
      const w = clone(w0);
      w.companies.find((c) => c.id === SAANJH)!.openingBalance = 1_00_000_00;
      const t = fresh(w, ist("2026-10-26 11:51"));
      const it = intentOf(t, "msme_due");
      return res("BT-31", it.status === "blocked" && it.block?.code === "FUNDS" && t.state.balance >= 0, [`Payout: ${it.status} (${it.block?.code})`, `Balance: ${t.state.balance / 100}`]);
    },
  },
  {
    id: "BT-32", group: "Ledger", title: "Edit the past", attack: "Change one paid amount deep in the ledger", expected: "The hash chain breaks at that event",
    run(w) {
      const t = fresh(w, ist("2026-10-26 18:00"));
      const ok = verifyChain(t.events);
      const copy = structuredClone(t.events);
      const target = copy.find((e) => e.type === "payout_submitted")!;
      target.payload.amount = target.payload.amount * 10;
      const broken = verifyChain(copy);
      return res("BT-32", ok.ok && !broken.ok && broken.brokenAt === target.seq, [`Untouched: ${ok.ok ? "intact" : "broken"}`, `After edit: ${broken.ok ? "intact" : `broken at event ${broken.brokenAt}`}`]);
    },
  },
  {
    id: "BT-33", group: "Email", title: "Tampered GSTIN", attack: "Invoice carries a GSTIN with one character changed", expected: "Held by the compliance agent before any payout",
    run(w) {
      const t = fresh(w, ist("2026-10-26 10:51"));
      const s = t.state.invoices.get(inv(w, "bad_gstin").id)!;
      return res("BT-33", s.status === "held" && s.ruleId === "HOLD_GSTIN_V1", [`Invoice: ${s.status}`, s.reasons[0] ?? ""]);
    },
  },
  {
    id: "BT-34", group: "Email", title: "Billed for goods not received", attack: "Invoice for more cartons than the goods receipt shows", expected: "Held on the three-way match, case opened",
    run(w) {
      const t = fresh(w, ist("2026-10-26 13:41"));
      const s = t.state.invoices.get(inv(w, "short_grn").id)!;
      return res("BT-34", s.status === "held" && s.ruleId === "HOLD_MATCH_V1" && [...t.state.cases.values()].some((c) => c.kind === "mismatch"), [`Invoice: ${s.status}`, s.reasons[0] ?? ""]);
    },
  },
];

export function runRedTeamB2B(w: BusinessWorld) {
  const results = RED_TEAM_B2B.map((c) => {
    try { return { case: c, result: c.run(w) }; } catch (e) { return { case: c, result: { id: c.id, passed: false, observed: [`Error: ${String(e).slice(0, 200)}`], moneyMoved: false } }; }
  });
  const breaches = results.filter((r) => !r.result.passed).length;
  return { results, attacks: results.length, breaches, attackSuccessRate: results.length ? breaches / results.length : 0 };
}
