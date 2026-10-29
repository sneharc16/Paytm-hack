// src/b2b/keys.ts: the simulated key store. Each agent and each person has an Ed25519 key derived from the world
// seed, standing in for a KMS key (agents) or a phone's secure element (people). Only the signing side imports
// this file: the agents, the person's device in the UI, and the red-team. guard.ts must never import it
// (tests/unit/b2b/architecture.test.ts checks that).
import { ed25519 } from "@noble/curves/ed25519.js";
import { approveMessage, attestMessage, DOMAINS, fromHex, governMessage, toHex } from "./crypto";
import { sha256 } from "@/lib/hash";
import type { Approval, Attestation, Verdict, AgentRole } from "./types";

const enc = new TextEncoder();

export function secretKey(seed: string, principalId: string): Uint8Array {
  return fromHex(sha256(`${DOMAINS.key}|${seed}|${principalId}`))!;
}
export const publicKeyOf = (seed: string, principalId: string) => toHex(ed25519.getPublicKey(secretKey(seed, principalId)));
export const signWith = (sk: Uint8Array, message: string) => toHex(ed25519.sign(enc.encode(message), sk));

export function attest(seed: string, signerId: string, role: AgentRole, intentHash: string, verdict: Verdict, reasons: string[], signedAt: string): Attestation {
  const a = { signerId, role, verdict, reasons, intentHash, signedAt };
  return { ...a, sig: signWith(secretKey(seed, signerId), attestMessage(a)) };
}

export function approve(seed: string, companyId: string, personId: string, role: "checker" | "cfo", intentHash: string, at: string): Approval {
  const a = { companyId, personId, role, intentHash, at };
  return { ...a, sig: signWith(secretKey(seed, personId), approveMessage(a)) };
}

export function governSign(seed: string, companyId: string, personId: string, proposalHash: string) {
  return signWith(secretKey(seed, personId), governMessage({ companyId, proposalHash, personId }));
}
