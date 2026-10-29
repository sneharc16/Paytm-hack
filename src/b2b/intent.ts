// src/b2b/intent.ts: the payment intent and its receipt. The intent is the exact thing every agent and person
// signs; its hash binds tenant, payee account, amount, invoices, nonce, policy and model together, so changing
// any one of them after signing invalidates every signature.
import { z } from "zod";
import { canonical, dhash } from "./crypto";
import type { PaymentIntent } from "./types";

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const paise = z.number().int().safe();

export const IntentSchema = z.strictObject({
  v: z.literal(1),
  domain: z.literal("PAKKA_B2B_INTENT_V1"),
  intentId: z.string().regex(/^pi_[a-z0-9_]{1,40}$/),
  companyId: z.string().regex(/^co_[a-z]+$/),
  vendorId: z.string().regex(/^v_[a-z0-9_]+$/),
  beneficiaryId: z.string().min(1).max(60),
  accountHash: hex64,
  amount: paise.positive(),
  tds: paise.nonnegative(),
  invoiceIds: z.array(z.string().min(1)).min(1).max(20),
  rail: z.enum(["IMPS", "NEFT", "RTGS"]),
  nonce: z.number().int().positive().safe(),
  policyVersion: z.number().int().positive(),
  policyHash: hex64,
  modelHash: hex64,
  preparedFor: z.string().min(1),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export const intentHash = (i: PaymentIntent) => dhash("intent", canonical(i));
