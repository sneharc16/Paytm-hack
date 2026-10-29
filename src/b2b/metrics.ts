// src/b2b/metrics.ts: the headline numbers, all computed from the ledger and state.
import type { Treasury } from "./treasury";

export function b2bMetrics(t: Treasury) {
  const st = t.state;
  const inv = [...st.invoices.values()];
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const submitted = t.events.filter((e) => e.type === "payout_submitted");
  const paid = t.events.filter((e) => e.type === "payout_settled").map((e) => st.intents.get(e.payload.intentHash)!.intent.amount);
  // Every payout_submitted must have been preceded by a guard pass on the same intent (it is emitted only by release()).
  const withoutReceipt = submitted.filter((e) => !(e.ruleId && e.payload.checks?.every((c: { ok: boolean }) => c.ok))).length;
  const byTier = (tier: string) => submitted.filter((e) => e.payload.tier === tier).length;
  return {
    invoicesArrived: inv.filter((i) => i.status !== "not_arrived").length,
    paid: inv.filter((i) => i.status === "paid").length,
    paidAmount: sum(paid),
    paidByAgentsOnly: byTier("agents"),
    paidWithChecker: byTier("checker"),
    paidWithCfo: byTier("checker_cfo"),
    awaitingApproval: inv.filter((i) => i.status === "awaiting_approval").length,
    deferred: inv.filter((i) => i.status === "deferred").length,
    held: inv.filter((i) => i.status === "held").length,
    rejected: inv.filter((i) => i.status === "rejected").length,
    stoppedAmount: sum(st.stopped.map((s) => s.amount)),
    stoppedCount: st.stopped.length,
    guardBlocks: t.events.filter((e) => e.type === "guard_blocked").length,
    fraudCases: [...st.cases.values()].filter((c) => c.kind === "fraud_attempt").length,
    quarantinedEmails: t.events.filter((e) => e.type === "quarantined").length,
    msmeAlerts: t.events.filter((e) => e.type === "msme_alert").length,
    payoutsWithoutPassingReceipt: withoutReceipt,
    balance: st.balance,
  };
}
