// Passkey ceremonies. Registration is verified with @simplewebauthn/server (attestation format, origin, RP ID,
// user verification) and the public key is stored raw in the ledger so the pure engine can verify signatures
// later. Sign-in uses a one-time challenge bound to the company and checked by the same verifier the guard uses.
import { generateRegistrationOptions, verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { cose, decodeCredentialPublicKey } from "@simplewebauthn/server/helpers";
import { b64uDecode, b64uEncode, challengeFor, toHex, verifyWebAuthn, type PasskeyCredential, type RelyingParty, type WebAuthnSig } from "@/b2b/crypto";
import type { Treasury } from "@/b2b/treasury";
import { allowedOrigins } from "./auth";
import { randomToken } from "./tokens";

export function relyingParty(req: Request): RelyingParty {
  const origins = allowedOrigins(req);
  return { rpId: process.env.PAKKA_RP_ID ?? new URL(origins[0]).hostname, origins };
}

/** userHandle carries "companyId:personId" so a discoverable passkey tells us who is signing in. */
export async function registrationOptions(rp: RelyingParty, companyId: string, personId: string, userName: string, displayName: string, exclude: PasskeyCredential[] = []) {
  return generateRegistrationOptions({
    rpName: "Pakka for Business", rpID: rp.rpId, userName, userDisplayName: displayName,
    userID: new TextEncoder().encode(`${companyId}:${personId}`),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -8],
    excludeCredentials: exclude.map((c) => ({ id: c.id })),
    timeout: 120_000,
  });
}

export async function verifyRegistration(rp: RelyingParty, response: RegistrationResponseJSON, expectedChallenge: string, at: string): Promise<PasskeyCredential | { error: string }> {
  let v;
  try {
    v = await verifyRegistrationResponse({ response, expectedChallenge, expectedOrigin: rp.origins, expectedRPID: rp.rpId, requireUserVerification: true, supportedAlgorithmIDs: [-7, -8] });
  } catch (e) {
    return { error: String((e as Error).message ?? e).slice(0, 160) };
  }
  if (!v.verified) return { error: "Passkey could not be verified" };
  const key = decodeCredentialPublicKey(v.registrationInfo.credential.publicKey);
  const alg = key.get(cose.COSEKEYS.alg);
  if (alg === -7) {
    const x = key.get(cose.COSEKEYS.x as never) as Uint8Array | undefined, y = key.get(cose.COSEKEYS.y as never) as Uint8Array | undefined;
    if (!x || !y || x.length !== 32 || y.length !== 32) return { error: "Unsupported P-256 key" };
    const raw = new Uint8Array(65); raw[0] = 4; raw.set(x, 1); raw.set(y, 33);
    return { id: v.registrationInfo.credential.id, alg: -7, publicKey: toHex(raw), addedAt: at };
  }
  if (alg === -8) {
    const x = key.get(cose.COSEKEYS.x as never) as Uint8Array | undefined;
    if (!x || x.length !== 32) return { error: "Unsupported Ed25519 key" };
    return { id: v.registrationInfo.credential.id, alg: -8, publicKey: toHex(x), addedAt: at };
  }
  return { error: "Use a passkey with P-256 or Ed25519" };
}

export const loginMessage = (nonce: string) => `PAKKA_B2B_LOGIN_V1|${nonce}`;

export function loginOptions(rp: RelyingParty) {
  const nonce = randomToken(24);
  return { nonce, options: { challenge: challengeFor(loginMessage(nonce)), rpId: rp.rpId, userVerification: "required" as const, timeout: 120_000, allowCredentials: [] } };
}

export interface AssertionJSON { id: string; rawId?: string; type?: string; response: { authenticatorData: string; clientDataJSON: string; signature: string; userHandle?: string } }

export const toSig = (a: AssertionJSON): WebAuthnSig => ({ credentialId: a.id, authenticatorData: a.response.authenticatorData, clientDataJSON: a.response.clientDataJSON, signature: a.response.signature });

export function userFromHandle(a: AssertionJSON): { orgId: string; personId: string } | null {
  const bytes = a.response.userHandle ? b64uDecode(a.response.userHandle) : null;
  const m = bytes ? /^(co_[a-z0-9]+):(p_[a-z0-9]+)$/.exec(new TextDecoder().decode(bytes)) : null;
  return m ? { orgId: m[1], personId: m[2] } : null;
}

export function verifyLogin(t: Treasury, personId: string, rp: RelyingParty, nonce: string, a: AssertionJSON): boolean {
  const p = t.world.people.find((x) => x.id === personId);
  return !!p && verifyWebAuthn(p.credentials?.find((c) => c.id === a.id), rp, loginMessage(nonce), toSig(a));
}

export { b64uEncode };
