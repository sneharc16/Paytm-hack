// src/llm/inputs.ts: what each task sends to a model and how it is masked. The bake script, the engine hooks
// (browser and server) and the live route all build inputs here, so the masked input, and so the cache key,
// is the same everywhere.
import type { ReminderFacts } from "@/engine/explain";
import type { World } from "@/engine/types";
import { inr } from "@/lib/format";
import type { MaskOptions } from "@/lib/privacy/mask";
import type { Task } from "./prompts";

export interface ModelInput { task: Task; input: unknown; mask: MaskOptions }

/** L1: the facts without internal ids. Brand and registered name are kept as they are. */
export function reminderInput(f: ReminderFacts): ModelInput {
  const { cycleId: _omit, ...facts } = f;
  void _omit;
  return { task: "reminder", input: facts, mask: { keep: [f.brand, f.registered_name] } };
}

/** L4: the case facts; the customer's name is masked (the summary may carry it as a token). */
export const summaryInput = (facts: unknown, names: string[]): ModelInput => ({ task: "case_summary", input: facts, mask: { names } });

/** L6: the metrics. */
export const alertInput = (metrics: Record<string, unknown>): ModelInput => ({ task: "alert", input: metrics, mask: { keep: [String(metrics.brand ?? "")] } });

/** L2: one review. Review text can carry phone numbers or UPI IDs, so it is masked like everything else. */
export const tagInput = (text: string): ModelInput => ({ task: "tagger", input: { text }, mask: {} });

/** L5: the merchant's offer copy. */
export const lintInput = (text: string): ModelInput => ({ task: "lint", input: { text }, mask: {} });

/** L3: the customer's message with what we know about their mandates, so the reply can use facts only. */
export function intakeInput(world: World, userId: string, text: string, language: string): ModelInput {
  const user = world.users.find((u) => u.id === userId);
  const mandates = world.mandates.filter((m) => m.userId === userId).map((m) => {
    const mer = world.merchants.find((x) => x.id === m.merchantId)!;
    const plan = world.plans.find((p) => p.id === m.planId)!;
    return {
      brand: mer.brand, registered_name: mer.legalName, plan: plan.name, amount_text: inr(plan.amount),
      allowed_actions: m.irrevocable ? ["keep"] : ["keep", "pause", "cancel"],
      irrevocable: m.irrevocable,
    };
  });
  return {
    task: "intake",
    input: { message: text, language, mandates, helpline: "1930", never_approved_route: "Pakka's trust team reviews a charge the customer says they never approved." },
    mask: { names: user ? [user.name] : [], keep: mandates.flatMap((m) => [m.brand, m.registered_name]) },
  };
}
