import { describe, expect, it } from "vitest";
import { B2B_END, ist } from "@/b2b/clock";
import { accountHash } from "@/b2b/crypto";
import { checkB2BInvariants } from "@/b2b/invariants";
import { b2bMetrics } from "@/b2b/metrics";
import { Treasury } from "@/b2b/treasury";
import { generateBusinessWorld, KAVERI, SAANJH } from "@/b2b/world";

const w = generateBusinessWorld("2711");
const run = (co: string, to = B2B_END) => { const t = new Treasury(w, co); t.advance(to); return t; };
const saanjh = run(SAANJH);

describe("Saanjh's three days", () => {
  it("reproduces the headline numbers", () => {
    expect(b2bMetrics(saanjh)).toMatchObject({
      invoicesArrived: 41, paid: 37, held: 2, rejected: 2, awaitingApproval: 0,
      paidByAgentsOnly: 24, paidWithChecker: 13, paidWithCfo: 1,
      stoppedCount: 3, fraudCases: 1, quarantinedEmails: 1, msmeAlerts: 1, payoutsWithoutPassingReceipt: 0,
    });
  });
  it("keeps every invariant", () => expect(checkB2BInvariants(saanjh)).toEqual([]));
  it("never sends a rupee to the fraudster's account", () => {
    const fraud = accountHash(w.storyAccounts.fraud.ifsc, w.storyAccounts.fraud.accountNo);
    expect([...saanjh.state.bankBook.values()].filter((e) => e.accountHash === fraud)).toEqual([]);
  });
  it("pays Meghdoot's real invoice to the account on file, after the callback", () => {
    const inv = w.invoices.find((i) => i.tag === "injection")!;
    const s = saanjh.state.invoices.get(inv.id)!;
    expect(s.status).toBe("paid");
    expect(s.paidAt! > ist("2026-10-26 12:10")).toBe(true);
    expect(saanjh.state.intents.get(s.intentHash!)!.intent.beneficiaryId).toBe("b_meghdoot_1");
  });
  it("pays the MSME vendor inside 45 days", () => {
    const inv = w.invoices.find((i) => i.tag === "msme_due")!;
    const s = saanjh.state.invoices.get(inv.id)!;
    expect(s.status).toBe("paid");
    expect(new Date(s.paidAt!).getTime() - new Date(inv.date).getTime()).toBeLessThan(45 * 86_400_000);
  });
  it("holds the night invoice to the release window", () => {
    const inv = w.invoices.find((i) => i.tag === "night")!;
    expect(saanjh.state.invoices.get(inv.id)!.paidAt).toBe(ist("2026-10-27 09:00"));
  });
  it("turns the governors' limit increase on only after the 24 hour timelock", () => {
    expect(run(SAANJH, ist("2026-10-28 12:19")).state.policy.version).toBe(1);
    expect(saanjh.state.policy.version).toBe(2);
    expect(saanjh.state.policy.dailyLimit).toBe(40_00_000_00);
  });
  it("is the same ledger every time, and replays to the same state", () => {
    expect(run(SAANJH).head).toBe(saanjh.head);
    const stepped = new Treasury(w, SAANJH);
    for (let h = 0; h < 61; h++) stepped.advance(new Date(new Date(ist("2026-10-26 08:30")).getTime() + h * 3_600_000).toISOString());
    stepped.advance(B2B_END);
    expect(stepped.head).toBe(saanjh.head);
  });
});

describe("Kaveri Fresh", () => {
  const k = run(KAVERI);
  it("runs its own ledger, keys and nonces", () => {
    expect(b2bMetrics(k)).toMatchObject({ invoicesArrived: 8, paid: 8, held: 0 });
    expect(checkB2BInvariants(k)).toEqual([]);
    expect(k.events.every((e) => e.companyId === KAVERI)).toBe(true);
  });
});
