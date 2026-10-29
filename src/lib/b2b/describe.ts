// Plain-language lines for the business ledger, used by the console's activity feed and ledger page.
import type { Treasury } from "@/b2b/treasury";
import type { LedgerEvent } from "@/b2b/types";
import { dayMonth, inr, timeIST } from "@/lib/format";

const when = (iso: string) => `${dayMonth(iso, "en")}, ${timeIST(iso)}`;

const CHECK_TEXT: Record<string, string> = {
  NOT_FROZEN: "Payouts not frozen", WELL_FORMED: "Intent well formed", TENANT: "For this company", PLANNED_IN_LEDGER: "Planned in this ledger",
  NOT_REPLAYED: "Not paid before", NONCE_ISSUED: "Nonce was issued", NOT_EXPIRED: "Within its lifetime", POLICY_CURRENT: "Signed under the current policy",
  SIGNATURES_VALID: "Agent signatures verify", AGENT_QUORUM: "All three agents signed", NO_AGENT_REJECTED: "No agent refused", MODEL_ALLOWED: "Model on the approved list",
  PAYEE_ON_FILE: "Payee is the approved account", ACCOUNT_BOUND: "Account matches what was signed", INVOICES_OPEN: "Invoice open and unpaid",
  AMOUNT_EXACT: "Amount is exactly what is owed after TDS", NO_OPEN_BANK_CHANGE: "No disputed bank change", PER_TXN_CAP: "Under the per-payout cap", RAIL_FITS: "Rail fits the amount",
  FIRST_PAYMENT_CAP: "First payout cap", APPROVALS_VALID: "People's signatures verify", APPROVALS_COMPLETE: "Everyone required has signed",
  COOLING: "Account out of cooling", DAILY_LIMIT: "Within the daily limit", VELOCITY: "Within payouts per vendor per day", RELEASE_WINDOW: "Inside the release window",
  FUNDS: "Enough money in the account", GUARD_ERROR: "Guard ran without error",
};
export const checkText = (code: string) => CHECK_TEXT[code] ?? code;

const vendorName = (t: Treasury, id?: string) => t.world.vendors.find((v) => v.id === id)?.brand ?? "a vendor";
const invoiceOf = (t: Treasury, hash?: string) => {
  const it = hash ? t.state.intents.get(hash) : undefined;
  return it ? t.world.invoices.find((i) => i.id === it.intent.invoiceIds[0]) : undefined;
};
const personName = (t: Treasury, id?: string) => t.world.people.find((p) => p.id === id)?.name ?? id ?? "";

export function describe(t: Treasury, e: LedgerEvent): string {
  const p = e.payload;
  const inv = invoiceOf(t, p.intentHash) ?? t.world.invoices.find((i) => i.id === p.invoiceId);
  const v = vendorName(t, inv?.vendorId ?? p.vendorId);
  const amt = p.intentHash ? t.state.intents.get(p.intentHash)?.intent.amount : undefined;
  switch (e.type) {
    case "invoice_received": return `Invoice ${p.number} from ${v}, ${inr(p.total)}${p.flags.length ? `. Flags: ${p.flags.join(", ")}` : ""}`;
    case "quarantined": return `Instructions inside ${v}'s email were treated as data and not followed`;
    case "invoice_held": return `Held ${inv?.number ?? ""} from ${v}: ${p.reasons.join("; ")}`;
    case "invoice_rejected": return `Rejected ${inv?.number ?? ""} from ${v}: ${p.reasons.join("; ")}`;
    case "invoice_released": return `${inv?.number ?? "Invoice"} released: ${p.why}`;
    case "intent_proposed": return `Payables agent planned ${inr(p.intent.amount)} to ${v} (nonce ${p.intent.nonce})`;
    case "attested": return `${p.attestation.role === "compliance" ? "Compliance" : p.attestation.role === "risk" ? "Risk" : "Payables"} agent signed: ${p.attestation.verdict}${p.attestation.verdict === "escalate" ? `, ${p.attestation.reasons.join(", ")}` : ""}`;
    case "agent_refused": return `${p.attestation.role === "compliance" ? "Compliance" : "Risk"} agent refused to sign: ${p.attestation.reasons.join(", ")}`;
    case "approval_needed": return `${inr(amt ?? 0)} to ${v} needs ${p.needs.join(" and ")}: ${p.reasons.join("; ")}`;
    case "approved": return `${p.name} signed as ${p.approval.role} for ${inr(amt ?? 0)} to ${v}`;
    case "approval_declined": return `${p.byName} declined ${inr(amt ?? 0)} to ${v}: ${p.reason}`;
    case "guard_blocked": return p.final
      ? `Guard stopped ${amt ? inr(amt) : "a payout"} to ${v}: ${checkText(p.code)} failed${p.detail ? ` (${p.detail})` : ""}`
      : `Guard is holding ${amt ? inr(amt) : "a payout"} to ${v}: ${p.detail || checkText(p.code)}`;
    case "payout_deferred": return `${inr(amt ?? 0)} to ${v} waits until ${when(p.until)}: ${checkText(p.code)}`;
    case "payout_submitted": return `Guard released ${inr(p.amount)} to ${v} by ${p.rail}`;
    case "payout_settled": return `Bank confirmed ${inr(amt ?? 0)} to ${v}, UTR ${p.utr}`;
    case "payout_failed": return `Bank could not pay ${v}: ${p.reason}. Money back in the account; planned again at ${when(p.retryAt)}`;
    case "status_checked": return `Checked the bank for ${v}'s payout: still ${p.status}. Not sent again`;
    case "intent_expired": return `Plan for ${v} withdrawn: ${p.why}`;
    case "change_request_opened": return `Bank change for ${vendorName(t, p.request.vendorId)} opened from ${p.request.source === "email" ? "an email" : "the vendor portal"}, account ending ${p.request.accountNo.slice(-4)}`;
    case "penny_drop": return p.found ? `Penny drop: account holder is ${p.holder}, name match ${p.score}%` : "Penny drop: account not found";
    case "callback_logged": return `${p.byName} called ${p.number}: ${p.outcome === "confirmed" ? "vendor confirmed the change" : "vendor never asked for it"}`;
    case "change_request_decided": return `Bank change ${p.decision}${p.by === "rule" ? " by rule" : ` by ${personName(t, p.by)}`}: ${p.reason}`;
    case "beneficiary_added": return `New account for ${vendorName(t, p.beneficiary.vendorId)} usable from ${when(p.usableFrom)}`;
    case "beneficiary_retired": return "Old account retired";
    case "vendor_onboarded": return `${vendorName(t, p.vendorId)} onboarded; account usable from ${when(p.usableFrom)}`;
    case "case_opened": return `Case ${p.case.id}: ${p.case.summary}`;
    case "stopped": return `Stopped ${inr(p.amount)}: ${p.reason}`;
    case "msme_alert": return `MSME invoice ${inv?.number ?? ""} from ${v} is ${p.age} days old; due by ${when(p.dueBy)}`;
    case "policy_proposed": return `${personName(t, p.proposal.by)} proposed ${p.proposal.kind === "policy" ? `policy v${p.proposal.policy.version}${p.proposal.loosening ? " (looser, needs the timelock)" : " (tighter)"}` : p.proposal.kind === "unfreeze" ? "lifting the freeze" : "reinstating an agent"}`;
    case "policy_signed": return `${personName(t, p.by)} signed ${p.proposalId}`;
    case "policy_scheduled": return `${p.proposalId} has two signatures; it takes effect at ${when(p.effectiveAt)} unless a governor vetoes it`;
    case "policy_activated": return `Policy v${p.version} is now active`;
    case "policy_vetoed": return `${p.byName} vetoed ${p.proposalId}`;
    case "proposal_executed": return `${p.proposalId} carried out`;
    case "freeze": return p.on ? `${p.by} froze all payouts: ${p.reason}` : `Payouts unfrozen by ${p.by}`;
    case "agent_suspended": return `${p.by} suspended ${p.agentId}: ${p.reason}`;
    case "agent_reinstated": return `${p.agentId} reinstated by two governors`;
    case "step_up": return `${personName(t, p.personId)} confirmed with PIN`;
    case "step_up_failed": return `${personName(t, p.personId)} entered a wrong PIN (${p.count} of 3)${p.lockedUntil ? `, locked until ${timeIST(p.lockedUntil)}` : ""}`;
    case "command_refused": return `Refused ${p.kind.replace(/_/g, " ")} by ${personName(t, p.by) || "someone"}: ${p.reason}`;
    case "anchor": return `End of day: ledger head ${p.head.slice(0, 12)} anchored (${p.events} events)`;
    case "grn_received": return `Goods receipt ${p.grnId} recorded`;
    case "takeover_simulated": return `Simulation: agents taken over: ${Object.entries(p).filter(([, on]) => on).map(([k]) => k).join(", ") || "none"}`;
    default: return e.type.replace(/_/g, " ");
  }
}
