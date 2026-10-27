// src/engine/commands.ts: the command set every surface can send (PRD 27), validated with Zod and applied
// to a session at sim time `at`. Shared by the API route and any in-browser host.
import { z } from "zod";
import {
  askQuestion, callbackDone, customerDecision, merchantRefundDecision, personDecision, refundAnswer,
  setKillSwitch, setMerchantSettings, topupConfirmed, verifyPin,
} from "./actions";
import type { Session } from "./session";
import type { ISO } from "./types";

export const Command = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("customer_decision"), cycleId: z.string(), choice: z.enum(["keep", "skip", "pause", "cancel", "downgrade"]), pinToken: z.string().optional() }),
  z.object({ kind: z.literal("pin"), userId: z.string(), digits: z.string().max(6) }),
  z.object({ kind: z.literal("topup_confirmed"), cycleId: z.string() }),
  z.object({ kind: z.literal("refund_answer"), executionId: z.string(), yes: z.boolean() }),
  z.object({ kind: z.literal("question"), userId: z.string(), text: z.string().min(1).max(300) }),
  z.object({ kind: z.literal("merchant_settings"), merchantId: z.string(), by: z.string(), settings: z.object({
    askBeforeFirstCharge: z.boolean().optional(), shareUsageSignal: z.boolean().optional(), offerSkip: z.boolean().optional(),
    refundAuto: z.boolean().optional(), refundCap: z.number().int().nonnegative().optional(), refundDailyLimit: z.number().int().nonnegative().optional(),
    offerCopy: z.object({ hi: z.string().max(200).optional(), hinglish: z.string().max(200).optional(), en: z.string().max(200).optional() }).optional(),
  }) }),
  z.object({ kind: z.literal("merchant_refund_decision"), executionId: z.string(), decision: z.enum(["approve", "decline"]), reason: z.string().max(300).optional() }),
  z.object({ kind: z.literal("person_decision"), caseId: z.string(), decision: z.enum(["refund", "uphold", "need_info"]), reason: z.string().min(1).max(300), by: z.string() }),
  z.object({ kind: z.literal("callback_done"), caseId: z.string() }),
  z.object({ kind: z.literal("kill_switch"), scope: z.string(), on: z.boolean(), reason: z.string().max(200) }),
]);
export type Command = z.infer<typeof Command>;

export function applyCommand(s: Session, at: ISO, c: Command): unknown {
  switch (c.kind) {
    case "customer_decision": return customerDecision(s, at, c.cycleId, c.choice, { pinToken: c.pinToken });
    case "pin": return verifyPin(s, at, c.userId, c.digits);
    case "topup_confirmed": return topupConfirmed(s, at, c.cycleId);
    case "refund_answer": return refundAnswer(s, at, c.executionId, c.yes);
    case "question": return askQuestion(s, at, c.userId, c.text);
    case "merchant_settings": return setMerchantSettings(s, at, c.merchantId, c.settings, c.by);
    case "merchant_refund_decision": return merchantRefundDecision(s, at, c.executionId, c.decision, c.reason);
    case "person_decision": return personDecision(s, at, c.caseId, c.decision, c.reason, c.by);
    case "callback_done": return callbackDone(s, at, c.caseId);
    case "kill_switch": return setKillSwitch(s, at, c.scope, c.on, c.reason);
  }
}

export const ClockCommand = z.object({
  action: z.enum(["play", "pause", "speed", "jump", "restart"]),
  value: z.union([z.number(), z.string()]).optional(),
});
export type ClockCommand = z.infer<typeof ClockCommand>;
