// src/b2b/testing/softPasskey.ts: a software passkey for tests and scripts. It produces the same assertion bytes
// a phone or laptop authenticator does (P-256, user present and verified), so the verifier code under test is the
// production code. Never used by the app's people: they sign with real passkeys in the browser.
import { p256 } from "@noble/curves/nist.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { b64uEncode, challengeFor, toHex, type PasskeyCredential, type RelyingParty, type WebAuthnSig } from "../crypto";

const enc = new TextEncoder();

export class SoftPasskey {
  readonly secret: Uint8Array;
  readonly credential: PasskeyCredential;
  private counter = 0;
  constructor(seed: string, public rp: RelyingParty, addedAt = "2026-10-29T00:00:00.000Z") {
    this.secret = sha256(enc.encode(`soft-passkey|${seed}`));
    this.credential = { id: b64uEncode(sha256(enc.encode(`cred|${seed}`)).slice(0, 16)), alg: -7, publicKey: toHex(p256.getPublicKey(this.secret, false)), addedAt };
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
