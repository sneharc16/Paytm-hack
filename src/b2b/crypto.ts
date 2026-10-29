// src/b2b/crypto.ts: canonical encoding, domain-separated hashes and Ed25519 verification.
// Signing lives in keys.ts. The guard imports only this file, so it can check a signature but can never make one.
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@/lib/hash";

/** JSON with sorted keys and no whitespace, so the same object always hashes the same. Rejects non-integers
 *  and non-finite numbers: money and nonces are integers, and a float in a signed payload is a bug. */
export function canonical(v: unknown): string {
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v)) throw new Error(`canonical: ${v} is not a safe integer`);
    return String(v);
  }
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  throw new Error(`canonical: unsupported ${typeof v}`);
}

/** Every hash names what it is for, so a hash of one kind can never be passed off as another. */
export const DOMAINS = {
  intent: "PAKKA_B2B_INTENT_V1",
  attest: "PAKKA_B2B_ATTEST_V1",
  approve: "PAKKA_B2B_APPROVE_V1",
  policy: "PAKKA_B2B_POLICY_V1",
  govern: "PAKKA_B2B_GOVERN_V1",
  account: "PAKKA_B2B_ACCOUNT_V1",
  ledger: "PAKKA_B2B_LEDGER_V1",
  model: "PAKKA_B2B_MODEL_V1",
  key: "PAKKA_B2B_KEY_V1",
} as const;

export const dhash = (domain: keyof typeof DOMAINS, body: string) => sha256(`${DOMAINS[domain]}|${body}`);

export const accountHash = (ifsc: string, accountNo: string) => dhash("account", `${ifsc.toUpperCase()}|${accountNo}`);

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h: string): Uint8Array | null {
  if (typeof h !== "string" || h.length % 2 || !/^[0-9a-f]*$/i.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const enc = new TextEncoder();

/** Fails closed: a malformed key, a malformed signature or any library error is a "no". */
export function verifySig(publicKeyHex: string, message: string, sigHex: string): boolean {
  try {
    const pk = fromHex(publicKeyHex), sig = fromHex(sigHex);
    if (!pk || !sig || pk.length !== 32 || sig.length !== 64) return false;
    return ed25519.verify(sig, enc.encode(message), pk) === true;
  } catch {
    return false;
  }
}

// The exact bytes each party signs. Kept here so signer and verifier can never drift apart.
export const attestMessage = (a: { intentHash: string; signerId: string; role: string; verdict: string; reasons: string[]; signedAt: string }) =>
  `${DOMAINS.attest}|${a.intentHash}|${a.signerId}|${a.role}|${a.verdict}|${a.reasons.join(",")}|${a.signedAt}`;
export const approveMessage = (a: { companyId: string; intentHash: string; personId: string; role: string; at: string }) =>
  `${DOMAINS.approve}|${a.companyId}|${a.intentHash}|${a.personId}|${a.role}|${a.at}`;
export const governMessage = (g: { companyId: string; proposalHash: string; personId: string }) =>
  `${DOMAINS.govern}|${g.companyId}|${g.proposalHash}|${g.personId}`;
