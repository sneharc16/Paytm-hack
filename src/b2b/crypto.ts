// src/b2b/crypto.ts: canonical encoding, domain-separated hashes and Ed25519 verification.
// Signing lives in keys.ts. The guard imports only this file, so it can check a signature but can never make one.
import { ed25519 } from "@noble/curves/ed25519.js";
import { p256 } from "@noble/curves/nist.js";
import { sha256 as sha256Bytes } from "@noble/hashes/sha2.js";
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
  action: "PAKKA_B2B_ACTION_V1",
  request: "PAKKA_B2B_REQUEST_V1",
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
/** A person's own action (freeze, decide a bank change, invite, register an agent...), bound to its exact
 *  parameters and time, so a signature for one action can never be replayed as another. */
export const actionMessage = (a: { companyId: string; personId: string; kind: string; params: unknown; at: string }) =>
  `${DOMAINS.action}|${a.companyId}|${a.personId}|${a.kind}|${canonical(a.params)}|${a.at}`;

/** What an API client signs on every request: method, path, time, a one-time nonce and the body's hash. */
export const requestMessage = (r: { method: string; path: string; timestamp: string; nonce: string; body: string }) =>
  `${DOMAINS.request}|${r.method.toUpperCase()}|${r.path}|${r.timestamp}|${r.nonce}|${sha256(r.body)}`;

// ---------- base64url ----------
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export function b64uEncode(b: Uint8Array): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < b.length ? B64[(n >> 6) & 63] : "") + (i + 2 < b.length ? B64[n & 63] : "");
  }
  return out;
}
export function b64uDecode(s: string): Uint8Array | null {
  if (typeof s !== "string") return null;
  const clean = s.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  if (!/^[A-Za-z0-9_-]*$/.test(clean) || clean.length % 4 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]) : 0));
    const n = (c[0] << 18) | (c[1] << 12) | (c[2] << 6) | c[3];
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return new Uint8Array(out);
}

// ---------- passkeys (WebAuthn) ----------
/** A passkey registered by a person. publicKey is raw: 65-byte uncompressed P-256 (alg -7) or 32-byte Ed25519 (alg -8). */
export interface PasskeyCredential { id: string; alg: -7 | -8; publicKey: string; addedAt: string; signCount?: number }
/** An assertion returned by navigator.credentials.get, all fields base64url. */
export interface WebAuthnSig { credentialId: string; authenticatorData: string; clientDataJSON: string; signature: string }
export interface RelyingParty { rpId: string; origins: string[] }

/** Extract the 32-bit big-endian signature counter from WebAuthn authenticatorData[33..36]. */
export function webAuthnSignCount(wa: WebAuthnSig | undefined): number | null {
  const ad = wa ? b64uDecode(wa.authenticatorData) : null;
  if (!ad || ad.length < 37) return null;
  return new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0, false);
}

/** W3C WebAuthn clone check: synced passkeys report 0->0; counter-backed authenticators must strictly advance. */
export function isValidSignCount(prevCount: number | undefined, nextCount: number | null): boolean {
  if (nextCount === null) return false;
  const prev = prevCount ?? 0;
  if (prev === 0 && nextCount === 0) return true;
  return nextCount > prev;
}

/** The WebAuthn challenge for a message: SHA-256 of its bytes, base64url. The person's device signs over it. */
export const challengeFor = (message: string) => b64uEncode(sha256Bytes(enc.encode(message)));

const eqBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Verify a passkey signature over `message`, synchronously and without the network: the client data must be
 * a "get" ceremony for exactly this message's challenge from an allowed origin, the authenticator data must
 * name this relying party with user presence and user verification, and the signature must check out against
 * the credential's registered public key. Fails closed on anything unexpected.
 */
export function verifyWebAuthn(cred: PasskeyCredential | undefined, rp: RelyingParty | null, message: string, wa: WebAuthnSig | undefined, opts?: { checkSignCount?: boolean }): boolean {
  try {
    if (!cred || !rp || !wa || wa.credentialId !== cred.id) return false;
    const cdBytes = b64uDecode(wa.clientDataJSON), ad = b64uDecode(wa.authenticatorData), sig = b64uDecode(wa.signature);
    if (!cdBytes || !ad || !sig || ad.length < 37) return false;
    const cd = JSON.parse(new TextDecoder().decode(cdBytes)) as { type?: string; challenge?: string; origin?: string; crossOrigin?: boolean };
    if (cd.type !== "webauthn.get" || cd.challenge !== challengeFor(message) || !cd.origin || !rp.origins.includes(cd.origin) || cd.crossOrigin === true) return false;
    if (!eqBytes(ad.slice(0, 32), sha256Bytes(enc.encode(rp.rpId)))) return false;
    const flags = ad[32];
    if ((flags & 0x01) === 0 || (flags & 0x04) === 0) return false; // user present and user verified
    if (opts?.checkSignCount && !isValidSignCount(cred.signCount, new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0, false))) return false;
    const signed = new Uint8Array(ad.length + 32);
    signed.set(ad);
    signed.set(sha256Bytes(cdBytes), ad.length);
    const pk = fromHex(cred.publicKey);
    if (!pk) return false;
    if (cred.alg === -7) return pk.length === 65 && p256.verify(sig, signed, pk, { prehash: true, lowS: false, format: "der" }) === true;
    if (cred.alg === -8) return pk.length === 32 && sig.length === 64 && ed25519.verify(sig, signed, pk) === true;
    return false;
  } catch {
    return false;
  }
}

export interface Signer { publicKey: string; credentials?: PasskeyCredential[] }
/** A person's signature: a passkey assertion, or (simulation only) an Ed25519 device-key signature. */
export function verifyPersonSig(p: Signer, message: string, sig: { sig?: string; webauthn?: WebAuthnSig }, rp: RelyingParty | null, requirePasskey: boolean): boolean {
  if (sig.webauthn) return verifyWebAuthn(p.credentials?.find((c) => c.id === sig.webauthn!.credentialId), rp, message, sig.webauthn);
  if (requirePasskey) return false;
  return !!sig.sig && !!p.publicKey && verifySig(p.publicKey, message, sig.sig);
}
