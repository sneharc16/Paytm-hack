// src/b2b/testing/softPasskey.ts: a software passkey for tests and scripts. It produces the same assertion bytes
// a phone or laptop authenticator does (P-256, user present and verified), so the verifier code under test is the
// production code. Never used by the app's people: they sign with real passkeys in the browser.
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { b64uDecode, b64uEncode, challengeFor, toHex, type PasskeyCredential, type RelyingParty, type WebAuthnSig } from "../crypto";

const enc = new TextEncoder();

// Minimal CBOR encoder: enough for a "none" attestation object and a COSE key.
type Cbor = number | string | Uint8Array | Map<Cbor, Cbor> | Record<string, unknown>;
function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  return [(major << 5) | 25, n >> 8, n & 255];
}
function cbor(v: Cbor): number[] {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") { const b = enc.encode(v); return [...head(3, b.length), ...b]; }
  if (v instanceof Uint8Array) return [...head(2, v.length), ...v];
  const entries: [Cbor, Cbor][] = v instanceof Map ? [...v.entries()] : Object.entries(v) as [Cbor, Cbor][];
  return [...head(5, entries.length), ...entries.flatMap(([k, x]) => [...cbor(k), ...cbor(x)])];
}

export class SoftPasskey {
  readonly secret: Uint8Array;
  readonly credential: PasskeyCredential;
  private counter = 0;
  constructor(seed: string, public rp: RelyingParty, addedAt = "2026-10-29T00:00:00.000Z") {
    this.secret = sha256(enc.encode(`soft-passkey|${seed}`));
    this.credential = { id: b64uEncode(sha256(enc.encode(`cred|${seed}`)).slice(0, 16)), alg: -7, publicKey: toHex(p256.getPublicKey(this.secret, false)), addedAt };
  }

  /** What navigator.credentials.create returns: a "none" attestation with this key, as RegistrationResponseJSON. */
  register(challenge: string, opts: { origin?: string; rpId?: string } = {}) {
    const pub = p256.getPublicKey(this.secret, false);
    const coseKey = cbor(new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, pub.slice(1, 33)], [-3, pub.slice(33)]]));
    const credId = Uint8Array.from(atobUrl(this.credential.id));
    const authData = new Uint8Array([...sha256(enc.encode(opts.rpId ?? this.rp.rpId)), 0x45, 0, 0, 0, 0, ...new Uint8Array(16), credId.length >> 8, credId.length & 255, ...credId, ...coseKey]);
    const attestationObject = new Uint8Array(cbor({ fmt: "none", attStmt: new Map(), authData } as unknown as Record<string, unknown>));
    const clientDataJSON = enc.encode(JSON.stringify({ type: "webauthn.create", challenge, origin: opts.origin ?? this.rp.origins[0], crossOrigin: false }));
    return {
      id: this.credential.id, rawId: this.credential.id, type: "public-key" as const, clientExtensionResults: {},
      response: { clientDataJSON: b64uEncode(clientDataJSON), attestationObject: b64uEncode(attestationObject), transports: ["internal" as const] },
    };
  }

  /** What navigator.credentials.get returns for a server challenge, as AuthenticationResponseJSON. */
  assert(challenge: string, userHandle?: string) {
    const s = this.sign("", { challenge });
    return { id: s.credentialId, rawId: s.credentialId, type: "public-key", clientExtensionResults: {}, response: { authenticatorData: s.authenticatorData, clientDataJSON: s.clientDataJSON, signature: s.signature, ...(userHandle ? { userHandle: b64uEncode(enc.encode(userHandle)) } : {}) } };
  }

  /** Sign `message` the way navigator.credentials.get does for challenge = challengeFor(message). */
  sign(message: string, opts: { origin?: string; rpId?: string; flags?: number; challenge?: string } = {}): WebAuthnSig {
    const rpIdHash = sha256(enc.encode(opts.rpId ?? this.rp.rpId));
    const ad = new Uint8Array(37);
    ad.set(rpIdHash);
    ad[32] = opts.flags ?? 0x05;
    new DataView(ad.buffer).setUint32(33, ++this.counter);
    const cd = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: opts.challenge ?? challengeFor(message), origin: opts.origin ?? this.rp.origins[0], crossOrigin: false }));
    const signed = new Uint8Array(ad.length + 32);
    signed.set(ad);
    signed.set(sha256(cd), ad.length);
    const sig = p256.sign(signed, this.secret, { prehash: true, format: "der", lowS: false });
    return { credentialId: this.credential.id, authenticatorData: b64uEncode(ad), clientDataJSON: b64uEncode(cd), signature: b64uEncode(sig) };
  }
}

const atobUrl = (s: string) => b64uDecode(s) ?? new Uint8Array();
