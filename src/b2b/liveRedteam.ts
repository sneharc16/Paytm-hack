// src/b2b/liveRedteam.ts: attacks against a live company's real ledger, run on a private copy (nothing is sent
// anywhere). The attacker has what a real attacker would have: the public ledger, their own keys, and anything
// they can tamper with in transit. They never have an agent's or a person's private key. Pure: the caller passes
// the time and the attacker's key material.
import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { accountHash, actionMessage, approveMessage, attestMessage, b64uEncode, challengeFor, toHex } from "./crypto";
import { verifyReceipt, type GuardVerdict } from "./guard";
import { intentHash } from "./intent";
import { verifyChain } from "./ledger";
import { loadOrg, personCommand } from "./live";
import type { IntentState } from "./state";
import type { LedgerEvent, Receipt } from "./types";

export interface LiveAttackResult { id: string; title: string; attack: string; outcome: "defended" | "skipped" | "breach"; observed: string }

const enc = new TextEncoder();
const failed = (v: GuardVerdict) => v.checks.filter((c) => !c.ok).map((c) => c.code);

/** Run every attack on a fresh copy of the ledger. `seed` is the attacker's own randomness (32 bytes). */
export function runLiveAttacks(events: LedgerEvent[], at: string, seed: Uint8Array): LiveAttackResult[] {
  const fork = () => loadOrg(structuredClone(events));
  const base = fork();
  const ctx = (t = base) => ({ world: t.world, state: t.state, companyId: t.companyId });
  const intents = [...base.state.intents.values()];
  const live = intents.find((i) => ["awaiting_approval", "attesting", "deferred", "blocked"].includes(i.status)) ?? intents.find((i) => i.status === "settled");
  const paid = intents.find((i) => i.status === "settled");
  const attackerSk = sha256(new Uint8Array([...seed, 1]));
  const attackerPk = toHex(ed25519.getPublicKey(attackerSk));
  const attackerP256 = sha256(new Uint8Array([...seed, 2]));
  const out: LiveAttackResult[] = [];
  const push = (id: string, title: string, attack: string, outcome: LiveAttackResult["outcome"], observed: string) => out.push({ id, title, attack, outcome, observed });
  const needIntent = (id: string, title: string, attack: string, it: IntentState | undefined, run: (it: IntentState) => [boolean, string]) => {
    if (!it) return push(id, title, attack, "skipped", "No payout in this ledger to attack yet");
    try { const [ok, obs] = run(it); push(id, title, attack, ok ? "defended" : "breach", obs); } catch (e) { push(id, title, attack, "breach", `Error: ${String(e).slice(0, 120)}`); }
  };
  const receiptOf = (it: IntentState): Receipt => ({ intent: it.intent, attestations: it.attestations, approvals: it.approvals });
  const says = (v: GuardVerdict) => `Guard: ${v.outcome}; failed: ${failed(v).join(", ") || "none"}`;

  needIntent("LT-01", "Forge an agent's signature", "Replace the compliance agent's signature on a real intent with random bytes", live, (it) => {
    const r = receiptOf(it);
    const v = verifyReceipt(ctx(), { ...r, attestations: r.attestations.map((a) => (a.role === "compliance" ? { ...a, sig: toHex(sha256(seed)).repeat(2) } : a)) }, at);
    return [v.outcome === "block" || failed(v).includes("SIGNATURES_VALID") || failed(v).includes("AGENT_QUORUM"), says(v)];
  });
  needIntent("LT-02", "Raise the amount in transit", "Add ₹1 to a real intent after it was signed", live, (it) => {
    const v = verifyReceipt(ctx(), { ...receiptOf(it), intent: { ...it.intent, amount: it.intent.amount + 100 } }, at);
    return [v.outcome === "block" && failed(v).includes("SIGNATURES_VALID"), says(v)];
  });
  needIntent("LT-03", "Swap the payee in transit", "Point a real intent at an account the attacker controls", live, (it) => {
    const v = verifyReceipt(ctx(), { ...receiptOf(it), intent: { ...it.intent, accountHash: accountHash("DCUB0004417", "50200077341190") } }, at);
    return [v.outcome === "block" && failed(v).includes("ACCOUNT_BOUND"), says(v)];
  });
  needIntent("LT-04", "Replay a paid receipt", "Submit the receipt of a payout that already went out", paid, (it) => {
    const v = verifyReceipt(ctx(), receiptOf(it), at);
    return [v.outcome === "block" && failed(v).includes("NOT_REPLAYED"), says(v)];
  });
  needIntent("LT-05", "Rogue agent key", "Sign a real intent as the risk agent with a key the attacker made", live, (it) => {
    const risk = base.world.agents.find((a) => a.role === "risk");
    const a = { signerId: risk?.id ?? "a_risk", role: "risk" as const, verdict: "approve" as const, reasons: ["ok"], intentHash: it.hash, signedAt: at };
    const forged = { ...a, sig: toHex(ed25519.sign(enc.encode(attestMessage(a)), attackerSk)) };
    const r = receiptOf(it);
    const v = verifyReceipt(ctx(), { ...r, attestations: [...r.attestations.filter((x) => x.role !== "risk"), forged] }, at);
    return [v.outcome === "block" && failed(v).includes("SIGNATURES_VALID"), `${says(v)} (attacker key ${attackerPk.slice(0, 10)})`];
  });
  needIntent("LT-06", "Fake a checker's passkey approval", "Approve a real intent with a passkey the attacker made, claiming to be the checker", live, (it) => {
    const checker = base.world.people.find((p) => p.roles.includes("checker"));
    if (!checker) return [true, "No checker yet"];
    const ap = { personId: checker.id, role: "checker" as const, intentHash: it.hash, companyId: base.companyId, at };
    const v = verifyReceipt(ctx(), { ...receiptOf(it), approvals: [{ ...ap, sig: "", webauthn: fakeAssertion(attackerP256, checker.credentials?.[0]?.id ?? "x", approveMessage(ap), base.state.rp?.rpId ?? "localhost", base.state.rp?.origins[0] ?? "") }] }, at);
    return [v.outcome === "block" && failed(v).includes("APPROVALS_VALID"), says(v)];
  });
  needIntent("LT-07", "Cross-company replay", "Present a real intent to a different company's treasury", live, (it) => {
    const v = verifyReceipt({ ...ctx(), companyId: "co_othercompany" }, receiptOf(it), at);
    return [v.outcome === "block" && failed(v).includes("TENANT"), says(v)];
  });
  needIntent("LT-08", "Stretch an intent's life", "Change a real intent's expiry to next year", live, (it) => {
    const v = verifyReceipt(ctx(), { ...receiptOf(it), intent: { ...it.intent, expiresAt: "2099-01-01T00:00:00.000Z" } }, at);
    return [v.outcome === "block" && (failed(v).includes("SIGNATURES_VALID") || failed(v).includes("NOT_EXPIRED")), says(v)];
  });

  // People's commands without their passkey.
  const victim = base.world.people.find((p) => p.roles.includes("governor"));
  if (victim) {
    const t = fork();
    const cmd = { kind: "freeze", reason: "attacker" };
    const r1 = personCommand(t, at, victim.id, { ...cmd, auth: { at, webauthn: fakeAssertion(attackerP256, victim.credentials?.[0]?.id ?? "x", actionMessage({ companyId: t.companyId, personId: victim.id, kind: "freeze", params: cmd, at }), t.state.rp?.rpId ?? "localhost", t.state.rp?.origins[0] ?? "") } });
    push("LT-09", "Act as a governor without their passkey", `Freeze payouts as ${victim.name} with a passkey the attacker made`, !r1.ok && !t.state.frozen.on ? "defended" : "breach", `Server: ${r1.reason ?? "accepted"}`);
    const t2 = fork();
    const real = victim.credentials?.[0];
    const r2 = personCommand(t2, at, victim.id, { ...cmd, auth: { at, webauthn: fakeAssertion(attackerP256, real?.id ?? "x", actionMessage({ companyId: t2.companyId, personId: victim.id, kind: "freeze", params: cmd, at }), t2.state.rp?.rpId ?? "localhost", "https://pakka-login.example") } });
    push("LT-10", "Phishing site", "Get a passkey signature on a look-alike site and send it here", !r2.ok ? "defended" : "breach", `Server: ${r2.reason ?? "accepted"}`);
  } else {
    push("LT-09", "Act as a governor without their passkey", "Freeze payouts as a governor", "skipped", "No governor yet");
  }

  // Rewrite history.
  {
    const copy = structuredClone(events);
    const target = copy.find((e) => e.type === "payout_submitted") ?? copy[Math.min(1, copy.length - 1)];
    if (target) target.payload.amount = (target.payload.amount ?? 0) + 1_000_00;
    const r = verifyChain(copy);
    push("LT-11", "Edit the ledger", `Change event ${target?.seq} in a copy of the ledger`, !r.ok ? "defended" : "breach", r.ok ? "Chain still verifies" : `Chain breaks at event ${r.brokenAt}`);
  }
  // A brand new intent signed by the attacker for their own account.
  {
    const it = live;
    if (!it) push("LT-12", "Invent a payout", "Build a payout to the attacker's account and sign it with the attacker's keys", "skipped", "No payout in this ledger to copy yet");
    else {
      const intent = { ...it.intent, nonce: base.state.nonceCounter + 50, intentId: "pi_9999_attack", accountHash: accountHash("DCUB0004417", "50200077341190") };
      const h = intentHash(intent);
      const atts = base.world.agents.filter((a) => a.role !== "erp").map((a) => { const x = { signerId: a.id, role: a.role as "proposer", verdict: "approve" as const, reasons: ["ok"], intentHash: h, signedAt: at }; return { ...x, sig: toHex(ed25519.sign(enc.encode(attestMessage(x)), attackerSk)) }; });
      const v = verifyReceipt(ctx(), { intent, attestations: atts, approvals: [] }, at);
      push("LT-12", "Invent a payout", "Build a payout to the attacker's account and sign it with the attacker's keys", v.outcome === "block" ? "defended" : "breach", says(v));
    }
  }
  return out;
}

/** A well-formed passkey assertion from a key the attacker owns. */
function fakeAssertion(sk: Uint8Array, credentialId: string, message: string, rpId: string, origin: string) {
  const ad = new Uint8Array(37);
  ad.set(sha256(enc.encode(rpId)));
  ad[32] = 0x05;
  const cd = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: challengeFor(message), origin, crossOrigin: false }));
  const signed = new Uint8Array([...ad, ...sha256(cd)]);
  return { credentialId, authenticatorData: b64uEncode(ad), clientDataJSON: b64uEncode(cd), signature: b64uEncode(p256.sign(signed, sk, { prehash: true, format: "der" })) };
}
