// src/b2b/scenario.ts: what the finance team does on its own during the story, when autoplay is on. Anything
// here can also be done by hand in the console before its time; scripted steps then find nothing left to do.
import { ist } from "./clock";
import type { B2BCommand } from "./commands";
import type { BusinessWorld } from "./types";
import { KAVERI, SAANJH } from "./world";

export interface ScriptedCommand { at: string; companyId: string; label: string; cmd: B2BCommand }

const round = (at: string, companyId = SAANJH): ScriptedCommand => ({
  at: ist(at), companyId, label: "Approval round",
  cmd: companyId === SAANJH ? { kind: "approval_round", checker: "p_arjun", cfo: "p_meera" } : { kind: "approval_round", checker: "p_lata", cfo: "p_suresh" },
});

const cache = new WeakMap<BusinessWorld, ScriptedCommand[]>();

export function scenarioFor(w: BusinessWorld): ScriptedCommand[] {
  const hit = cache.get(w);
  if (hit) return hit;
  const shivam = w.storyAccounts.shivamNew;
  const injected = w.invoices.find((i) => i.tag === "injection")!;
  const list = build(shivam.accountNo, shivam.ifsc, `cr_${injected.id}`);
  cache.set(w, list);
  return list;
}

const build = (shivamAccount: string, shivamIfsc: string, meghdootRequest: string): ScriptedCommand[] => [
  { at: ist("2026-10-26 10:40"), companyId: SAANJH, label: "Shivam Traders asks to change its bank account on the vendor portal", cmd: { kind: "change_request", vendorId: "v_shivam", accountNo: shivamAccount, ifsc: shivamIfsc, by: "vendor" } },
  { at: ist("2026-10-26 11:05"), companyId: SAANJH, label: "Neha calls Shivam on the number on file: confirmed", cmd: { kind: "callback", requestId: "cr_shivam_1", personId: "p_neha", outcome: "confirmed" } },
  { at: ist("2026-10-26 11:35"), companyId: SAANJH, label: "Arjun approves Shivam's new account", cmd: { kind: "decide_change", requestId: "cr_shivam_1", personId: "p_arjun", decision: "approved", pin: "" } },
  round("2026-10-26 11:50"),
  { at: ist("2026-10-26 12:10"), companyId: SAANJH, label: "Neha calls Meghdoot on the number on file: they never changed banks", cmd: { kind: "callback", requestId: meghdootRequest, personId: "p_neha", outcome: "denied" } },
  round("2026-10-26 15:00"),
  round("2026-10-26 17:45"),
  round("2026-10-26 15:30", KAVERI),
  round("2026-10-27 10:30"),
  round("2026-10-27 14:30"),
  round("2026-10-27 17:30"),
  round("2026-10-27 16:00", KAVERI),
  { at: ist("2026-10-27 12:00"), companyId: SAANJH, label: "Meera proposes a higher daily limit for the festive season", cmd: { kind: "propose_policy", personId: "p_meera", changes: { dailyLimit: 40_00_000_00, agentOnlyDailyCap: 4_00_000_00 }, pin: "" } },
  { at: ist("2026-10-27 12:20"), companyId: SAANJH, label: "Vikram signs: two of three, the 24 hour timelock starts", cmd: { kind: "sign_proposal", proposalId: "GOV-101", personId: "p_vikram", pin: "" } },
  round("2026-10-28 10:30"),
  round("2026-10-28 14:30"),
  round("2026-10-28 17:30"),
];
