// src/b2b/audit.ts: the signed ledger export and its offline verifier. An auditor needs only the file: the chain,
// every agent and passkey signature, the governance signatures and the replayed state are all checked from it,
// with no call to Pakka or the company. Pure.
import { approveMessage, attestMessage, governMessage, actionMessage, verifyPersonSig, verifySig, type WebAuthnSig } from "./crypto";
import { checkB2BInvariants } from "./invariants";
import { verifyChain } from "./ledger";
import { loadOrg } from "./live";
import { b2bMetrics } from "./metrics";
import type { LedgerEvent } from "./types";

export const EXPORT_FORMAT = "pakka-business-ledger-v1";
export interface LedgerExport {
  format: typeof EXPORT_FORMAT;
  companyId: string;
  head: string;
  count: number;
  exportedAt: string;
  exportedBy: string;
  events: LedgerEvent[];
  /** The exporter's passkey signature over exportMessage(). */
  signature: { at: string; webauthn: WebAuthnSig };
}

export const exportMessage = (e: Pick<LedgerExport, "companyId" | "head" | "count" | "exportedBy">, at: string) =>
  `PAKKA_B2B_EXPORT_V1|${e.companyId}|${e.head}|${e.count}|${e.exportedBy}|${at}`;

export interface AuditCheck { name: string; ok: boolean; detail: string }
export interface AuditReport { ok: boolean; checks: AuditCheck[]; summary: Record<string, unknown> }

export function verifyExport(x: LedgerExport): AuditReport {
  const checks: AuditCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
  try {
    add("Format", x?.format === EXPORT_FORMAT && Array.isArray(x.events), x?.format ?? "missing");
    const chain = verifyChain(x.events);
    add("Hash chain", chain.ok && chain.head === x.head && x.events.length === x.count, chain.ok ? `${x.events.length} events, head ${chain.head.slice(0, 16)} ${chain.head === x.head ? "matches" : "does not match"} the stated head` : `broken at event ${chain.brokenAt}: ${chain.reason}`);
    if (!chain.ok) return { ok: false, checks, summary: {} };
    const t = loadOrg(x.events);
    add("Company", t.companyId === x.companyId, `${t.world.companies[0].legalName} (${t.companyId})`);
    const exporter = t.world.people.find((p) => p.id === x.exportedBy);
    add("Exporter's passkey signature", !!exporter && verifyPersonSig(exporter, exportMessage(x, x.signature?.at ?? ""), { webauthn: x.signature?.webauthn }, t.state.rp, true), exporter ? `${exporter.name}, signed ${x.signature?.at}` : "exporter not in the ledger");

    let att = 0, attBad = 0, appr = 0, apprBad = 0;
    for (const it of t.state.intents.values()) {
      for (const a of it.attestations) {
        const ag = t.world.agents.find((g) => g.id === a.signerId);
        att++;
        if (!ag || !verifySig(ag.publicKey, attestMessage(a), a.sig)) attBad++;
      }
      for (const a of it.approvals) {
        const p = t.world.people.find((q) => q.id === a.personId);
        appr++;
        if (!p || !verifyPersonSig(p, approveMessage(a), a, t.state.rp, t.state.requirePasskey)) apprBad++;
      }
    }
    add("Agent signatures", attBad === 0, `${att - attBad} of ${att} verify`);
    add("Approval signatures", apprBad === 0, `${appr - apprBad} of ${appr} verify (passkeys)`);

    let gov = 0, govBad = 0;
    for (const pr of t.state.proposals.values()) {
      for (const [pid, raw] of Object.entries(pr.sigs)) {
        gov++;
        const g = t.world.people.find((p) => p.id === pid);
        try {
          const s = JSON.parse(raw) as { kind: "action" | "govern"; at: string; webauthn: WebAuthnSig };
          const kindName = pr.kind === "policy" ? "propose_policy" : pr.kind === "unfreeze" ? "propose_unfreeze" : pr.kind === "reinstate" ? "propose_reinstate" : pr.kind;
          const msg = s.kind === "govern" ? governMessage({ companyId: t.companyId, proposalHash: pr.hash, personId: pid }) : actionMessage({ companyId: t.companyId, personId: pid, kind: kindName, params: pr.signedParams, at: s.at });
          if (!g || !verifyPersonSig(g, msg, { webauthn: s.webauthn }, t.state.rp, true)) govBad++;
        } catch { govBad++; }
      }
    }
    add("Governance signatures", govBad === 0, `${gov - govBad} of ${gov} verify`);

    const inv = checkB2BInvariants(t);
    add("Replayed state and invariants", inv.length === 0, inv.length ? inv.slice(0, 3).join("; ") : "every payout had a passing receipt, no invoice paid twice, no nonce reused, balance reconciles");
    const anchors = x.events.filter((e) => e.type === "anchor").length;
    const m = b2bMetrics(t);
    return {
      ok: checks.every((c) => c.ok), checks,
      summary: { company: t.world.companies[0].legalName, events: x.events.length, anchors, paid: m.paid, paidAmount: m.paidAmount, stopped: m.stoppedAmount, held: m.held, people: t.world.people.length, agents: t.world.agents.length, policyVersion: t.state.policy.version },
    };
  } catch (e) {
    add("Readable", false, String(e).slice(0, 200));
    return { ok: false, checks, summary: {} };
  }
}
