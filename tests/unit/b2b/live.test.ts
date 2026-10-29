import { describe, expect, it } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { attestMessage, toHex, type RelyingParty } from "@/b2b/crypto";
import { verifyChain } from "@/b2b/ledger";
import { acceptInvite, agentCommand, createOrg, loadOrg, messageFor, personCommand, proposeQueue, workFor } from "@/b2b/live";
import { makeGstin } from "@/b2b/gstin";
import { SoftPasskey } from "@/b2b/testing/softPasskey";
import type { Treasury } from "@/b2b/treasury";
import { checkB2BInvariants } from "@/b2b/invariants";
import { sha256 } from "@/lib/hash";

const rp: RelyingParty = { rpId: "localhost", origins: ["http://localhost:3000"] };
const T0 = "2026-11-02T04:00:00.000Z"; // Mon 2 Nov, 9:30 AM IST
const at = (min: number) => new Date(new Date(T0).getTime() + min * 60_000).toISOString();

const keys = (seed: string) => { const sk = new Uint8Array(32).map((_, i) => (seed.charCodeAt(i % seed.length) * (i + 7)) & 255); return { sk, pk: toHex(ed25519.getPublicKey(sk)) }; };
const hex64 = (s: string) => sha256(`test|${s}`);

function person(t: Treasury, id: string, key: SoftPasskey) {
  return (cmd: Record<string, unknown> & { kind: string }, when: string) => {
    const message = messageFor(t, id, cmd, when);
    return personCommand(t, when, id, { ...cmd, auth: { at: when, webauthn: key.sign(message) } });
  };
}

function agentSign(t: Treasury, agentId: string, sk: Uint8Array, intentHash: string, verdict: "approve" | "escalate" | "reject", reasons: string[], when: string) {
  const role = t.world.agents.find((a) => a.id === agentId)!.role;
  const sig = toHex(ed25519.sign(new TextEncoder().encode(attestMessage({ intentHash, signerId: agentId, role, verdict, reasons, signedAt: when })), sk));
  return agentCommand(t, when, agentId, { kind: "attest", intentHash, verdict, reasons, signedAt: when, sig });
}

/** A whole company set up for real: founder, five people, three agents and an ERP client, sealed and funded. */
function setup() {
  const pk = { founder: new SoftPasskey("meera", rp), vikram: new SoftPasskey("vikram", rp), sana: new SoftPasskey("sana", rp), neha: new SoftPasskey("neha", rp), arjun: new SoftPasskey("arjun", rp) };
  const t = createOrg("co_acme", { legalName: "Acme Traders Pvt Ltd", brand: "Acme", gstin: makeGstin("27", "AAACA1234Q"), city: "Pune", founder: { name: "Meera Iyer", title: "CFO", email: "meera@acme.example" } }, "p_meera", pk.founder.credential, rp, at(0));
  const meera = person(t, "p_meera", pk.founder);
  // Founder makes herself CFO too by inviting... she is a governor; invite the rest.
  const invite = (name: string, roles: string[], n: number) => {
    const r = meera({ kind: "invite_person", name, title: "Staff", email: `${name.toLowerCase()}@acme.example`, roles, inviteId: `inv_${name.toLowerCase()}0000`, tokenHash: hex64(String(n)) }, at(1));
    expect(r.ok, r.reason).toBe(true);
  };
  invite("Vikram", ["governor"], 1); invite("Sana", ["governor"], 2); invite("Neha", ["maker"], 3); invite("Arjun", ["checker"], 4); invite("Kiran", ["cfo"], 5);
  expect(acceptInvite(t, at(2), "inv_vikram0000", hex64("1"), "p_vikram", pk.vikram.credential).ok).toBe(true);
  expect(acceptInvite(t, at(2), "inv_sana0000", hex64("2"), "p_sana", pk.sana.credential).ok).toBe(true);
  expect(acceptInvite(t, at(2), "inv_neha0000", hex64("3"), "p_neha", pk.neha.credential).ok).toBe(true);
  expect(acceptInvite(t, at(2), "inv_arjun0000", hex64("4"), "p_arjun", pk.arjun.credential).ok).toBe(true);
  const kiranKey = new SoftPasskey("kiran", rp);
  expect(acceptInvite(t, at(2), "inv_kiran0000", hex64("5"), "p_kiran", kiranKey.credential).ok).toBe(true);
  const ak = { proposer: keys("prop"), compliance: keys("comp"), risk: keys("risk"), erp: keys("erp") };
  for (const role of ["proposer", "compliance", "risk", "erp"] as const) {
    const r = meera({ kind: "register_agent", agentId: `a_acme_${role}`, name: `${role} agent`, role, modelLabel: `acme-${role}-v1`, publicKey: ak[role].pk, apiKeyHash: hex64(role.slice(0, 1)), apiKeyPrefix: `pk_${role}` }, at(3));
    expect(r.ok, r.reason).toBe(true);
  }
  const sealed = meera({ kind: "seal_org" }, at(4));
  expect(sealed.ok, JSON.stringify(sealed)).toBe(true);
  expect(meera({ kind: "fund_sandbox", amount: 50_00_000_00 }, at(5)).ok).toBe(true);
  return { t, pk, ak, kiranKey, meera, neha: person(t, "p_neha", pk.neha), arjun: person(t, "p_arjun", pk.arjun), kiran: person(t, "p_kiran", kiranKey), sana: person(t, "p_sana", pk.sana), vikram: person(t, "p_vikram", pk.vikram) };
}

function vendorWithAccount(s: ReturnType<typeof setup>, when: number) {
  const { t, neha, arjun, meera } = s;
  const gstin = makeGstin("27", "AABCK5678L");
  const v = neha({ kind: "add_vendor", vendor: { legalName: "Konkan Packaging Pvt Ltd", brand: "Konkan", gstin, pan: "AABCK5678L", category: "goods", msme: true, phoneOnFile: "+919800001234", email: "ap@konkan.example", termsDays: 30 } }, at(when));
  expect(v.ok, v.reason).toBe(true);
  const vendorId = String(v.data!.vendorId);
  expect(meera({ kind: "sandbox_account", accountNo: "123456789012", ifsc: "NRMB0001234", holder: "Konkan Packaging Pvt Ltd" }, at(when)).ok).toBe(true);
  const cr = neha({ kind: "change_request", vendorId, accountNo: "123456789012", ifsc: "NRMB0001234" }, at(when + 1));
  expect(cr.ok, cr.reason).toBe(true);
  const requestId = String(cr.data!.requestId);
  expect(neha({ kind: "callback", requestId, outcome: "confirmed" }, at(when + 2)).ok).toBe(true);
  const d = arjun({ kind: "decide_change", requestId, decision: "approved" }, at(when + 3));
  expect(d.ok, d.reason).toBe(true);
  return { vendorId, t };
}

describe("live company", () => {
  it("sets up from nothing with passkeys and seals", () => {
    const { t } = setup();
    expect(t.state.sealed).toBe(true);
    expect(t.world.people).toHaveLength(6);
    expect(t.state.policy.allowedModels).toHaveLength(3);
    expect(verifyChain(t.events).ok).toBe(true);
  });

  it("pays a real invoice end to end: ERP, three external agents, a checker's passkey, the guard", () => {
    const s = setup();
    const { t, ak } = s;
    const { vendorId } = vendorWithAccount(s, 10);
    const erp = (cmd: unknown, m: number) => agentCommand(t, at(m), "a_acme_erp", cmd);
    expect(erp({ kind: "submit_po", po: { id: "PO-1", vendorId, lines: [{ sku: "BOX", qty: 50, rate: 1_200_00 }] } }, 20).ok).toBe(true);
    expect(erp({ kind: "submit_grn", grn: { id: "GRN-1", poId: "PO-1", lines: [{ sku: "BOX", qty: 50 }] } }, 21).ok).toBe(true);
    // 24 hours later (cooling for a new account), the invoice arrives.
    const day = 24 * 60 + 30;
    const inv = erp({ kind: "submit_invoice", invoice: { number: "KP/1", vendorId, poId: "PO-1", date: at(day - 60), gstin: makeGstin("27", "AABCK5678L"), lines: [{ sku: "BOX", qty: 50, rate: 1_200_00 }], gst: 7_200_00 } }, day);
    expect(inv.ok, inv.reason).toBe(true);
    const invoiceId = String(inv.data!.invoiceId);
    expect(proposeQueue(t).map((w) => w.invoiceId)).toContain(invoiceId);
    const p = agentCommand(t, at(day + 1), "a_acme_proposer", { kind: "propose", invoiceId });
    expect(p.ok, p.reason).toBe(true);
    const h = String(p.data!.intentHash);
    expect(agentSign(t, "a_acme_proposer", ak.proposer.sk, h, "approve", ["matched"], at(day + 1)).ok).toBe(true);
    expect(workFor(t, "compliance").map((w) => w.intentHash)).toEqual([h]);
    expect(agentSign(t, "a_acme_compliance", ak.compliance.sk, h, "approve", ["checked"], at(day + 2)).ok).toBe(true);
    const r = agentSign(t, "a_acme_risk", ak.risk.sk, h, "approve", ["no signals"], at(day + 2));
    expect(r.data?.status).toBe("awaiting_approval"); // ₹67,200 needs a checker; it is also the first payout to this account
    // Neha (maker) cannot approve; Arjun can, with his passkey.
    expect(s.neha({ kind: "approve", intentHash: h, role: "checker" }, at(day + 3)).ok).toBe(false);
    const ap = s.arjun({ kind: "approve", intentHash: h, role: "checker" }, at(day + 3));
    expect(ap.ok, ap.reason).toBe(true);
    expect(t.state.invoices.get(invoiceId)!.status).toBe("paid");
    expect(checkB2BInvariants(t)).toEqual([]);
    // The ledger alone rebuilds the same company.
    const again = loadOrg(t.events);
    expect(again.state.invoices.get(invoiceId)!.status).toBe("paid");
    expect(again.state.balance).toBe(t.state.balance);
    expect(again.head).toBe(t.head);
  });

  it("refuses forged, replayed and stale signatures from agents and people", () => {
    const s = setup();
    const { t, ak } = s;
    const { vendorId } = vendorWithAccount(s, 10);
    agentCommand(t, at(20), "a_acme_erp", { kind: "submit_po", po: { id: "PO-1", vendorId, lines: [{ sku: "BOX", qty: 10, rate: 1_000_00 }] } });
    agentCommand(t, at(21), "a_acme_erp", { kind: "submit_grn", grn: { id: "GRN-1", poId: "PO-1", lines: [{ sku: "BOX", qty: 10 }] } });
    const inv = agentCommand(t, at(1500), "a_acme_erp", { kind: "submit_invoice", invoice: { number: "KP/2", vendorId, poId: "PO-1", date: at(1400), gstin: makeGstin("27", "AABCK5678L"), lines: [{ sku: "BOX", qty: 10, rate: 1_000_00 }], gst: 1_200_00 } });
    const h = String(agentCommand(t, at(1501), "a_acme_proposer", { kind: "propose", invoiceId: String(inv.data!.invoiceId) }).data!.intentHash);
    // The compliance agent's key signing as the risk agent: refused.
    expect(agentSign(t, "a_acme_risk", ak.compliance.sk, h, "approve", ["x"], at(1501)).reason).toBe("BAD_SIGNATURE");
    // An ERP client cannot attest.
    expect(agentCommand(t, at(1501), "a_acme_erp", { kind: "attest", intentHash: h, verdict: "approve", reasons: ["x"], signedAt: at(1501), sig: "0".repeat(128) }).reason).toBe("ROLE_NOT_ALLOWED");
    // A signature from 10 minutes ago: stale.
    expect(agentSign(t, "a_acme_proposer", ak.proposer.sk, h, "approve", ["x"], at(1491)).reason).toBe("STALE_SIGNATURE");
    // A person's passkey signature for one action replayed as another.
    const msg = messageFor(t, "p_arjun", { kind: "freeze", reason: "test freeze" }, at(1502));
    const sig = s.pk.arjun.sign(msg);
    expect(personCommand(t, at(1502), "p_arjun", { kind: "freeze", reason: "different reason", auth: { at: at(1502), webauthn: sig } }).reason).toBe("BAD_PASSKEY_SIGNATURE");
    // Someone else's passkey.
    expect(personCommand(t, at(1502), "p_arjun", { kind: "freeze", reason: "test freeze", auth: { at: at(1502), webauthn: s.pk.neha.sign(msg) } }).reason).toBe("BAD_PASSKEY_SIGNATURE");
    // Wrong origin (phishing site) and missing user verification.
    expect(personCommand(t, at(1502), "p_arjun", { kind: "freeze", reason: "test freeze", auth: { at: at(1502), webauthn: s.pk.arjun.sign(msg, { origin: "https://pakka-login.example" }) } }).reason).toBe("BAD_PASSKEY_SIGNATURE");
    expect(personCommand(t, at(1502), "p_arjun", { kind: "freeze", reason: "test freeze", auth: { at: at(1502), webauthn: s.pk.arjun.sign(msg, { flags: 0x01 }) } }).reason).toBe("BAD_PASSKEY_SIGNATURE");
    // Stale person signature.
    expect(personCommand(t, at(1512), "p_arjun", { kind: "freeze", reason: "test freeze", auth: { at: at(1502), webauthn: sig } }).reason).toBe("STALE_SIGNATURE");
    expect(t.state.frozen.on).toBe(false);
  });

  it("blocks payouts until setup is sealed", () => {
    const pk = new SoftPasskey("solo", rp);
    const t = createOrg("co_solo", { legalName: "Solo Pvt Ltd", brand: "Solo", gstin: makeGstin("27", "AAACS1111A"), city: "Pune", founder: { name: "Solo", title: "Founder", email: "solo@x.example" } }, "p_solo", pk.credential, rp, at(0));
    const r = person(t, "p_solo", pk)({ kind: "seal_org" }, at(1));
    expect(r.ok).toBe(false);
    expect((r.data?.missing as string[]).length).toBeGreaterThan(3);
    expect(person(t, "p_solo", pk)({ kind: "propose_policy", changes: { dailyLimit: 1 } }, at(1)).reason).toBe("SEAL_FIRST");
  });

  it("needs two governors' passkeys to register a new agent after sealing", () => {
    const s = setup();
    const { t } = s;
    s.vikram({ kind: "suspend_agent", agentId: "a_acme_risk", reason: "rotate the key" }, at(10));
    const k = keys("risk2");
    const p = s.meera({ kind: "register_agent", agentId: "a_acme_risk2", name: "risk agent v2", role: "risk", modelLabel: "acme-risk-v2", publicKey: k.pk, apiKeyHash: hex64("r2"), apiKeyPrefix: "pk_r2" }, at(11));
    expect(p.ok, p.reason).toBe(true);
    expect(t.world.agents.some((a) => a.id === "a_acme_risk2")).toBe(false);
    const sgn = s.sana({ kind: "sign_proposal", proposalId: String(p.data!.proposalId) }, at(12));
    expect(sgn.ok, sgn.reason).toBe(true);
    expect(t.world.agents.some((a) => a.id === "a_acme_risk2")).toBe(true);
    expect(t.state.policy.allowedModels).toHaveLength(4);
  });
});

describe("starting rules", () => {
  it("can be set by the founder only before sealing", () => {
    const pk = new SoftPasskey("rules", rp);
    const t = createOrg("co_rules", { legalName: "Rules Pvt Ltd", brand: "Rules", gstin: makeGstin("27", "AAACR1111R"), city: "Pune", founder: { name: "R", title: "Founder", email: "r@x.example" } }, "p_r", pk.credential, rp, at(0));
    const r = person(t, "p_r", pk)({ kind: "set_initial_policy", changes: { coolingHoursNew: 0, releaseStartMin: 0, releaseEndMin: 1440 } }, at(1));
    expect(r.ok, r.reason).toBe(true);
    expect(t.state.policy.coolingHoursNew).toBe(0);
    expect(loadOrg(t.events).state.policyHashActive).toBe(t.state.policyHashActive);
  });
  it("is refused after sealing", () => {
    const s = setup();
    expect(s.meera({ kind: "set_initial_policy", changes: { coolingHoursNew: 0 } }, at(10)).reason).toBe("ALREADY_SEALED");
  });
});
