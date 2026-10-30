// Connects the engine to model output from the demo cache. Runs the same in the browser and on the server,
// synchronously, so replay stays deterministic. The input is masked exactly as the bake masked it, the cached
// (masked) output is checked and then unmasked here. Anything missing, not approved by the review loop or
// failing a check falls back to the template, and the flight recorder says which one was used.
import { setSummarizer } from "@/engine/actions";
import { setWriter, type ReminderFacts, type Written } from "@/engine/explain";
import { setAlertWriter, setTagger } from "@/engine/radar";
import type { ReviewStamp } from "@/engine/types";
import { mask, unmask } from "@/lib/privacy/mask";
import type { ReviewMeta } from "./agents/loop";
import { cacheKey, entryByKey, lookup, versionFor } from "./cache";
import { factcheckAlert, factcheckReminder, factcheckSummary } from "./factcheck";
import { alertInput, reminderInput, summaryInput, tagInput, type ModelInput } from "./inputs";
import { AlertOut, CaseOut, ReminderOut, TagOut } from "./schemas";

export { reminderInput };

/** The L1 prompt is about an upcoming charge, so only those messages are model-written. Refund offers and
 *  failed-charge notices describe something that already happened and keep their templates. */
export const MODEL_KINDS = new Set(["ask", "tell", "follow_up", "collect", "remind"]);

/** The review trail for a stamped message, from the demo cache. */
export function reviewTrail(key: string | undefined): ReviewMeta | undefined {
  if (!key) return undefined;
  return entryByKey(key)?.review;
}

export const stamp = (key: string, meta: ReviewMeta | undefined, masked: Record<string, number>): ReviewStamp | undefined =>
  meta ? { key, status: meta.status, rounds: meta.rounds, ...(meta.reason ? { reason: meta.reason } : {}), masked } : undefined;

/** Look a task up in the demo cache the way the bake stored it: masked input, masked output. */
export function cached(m: ModelInput): { output: unknown; stamp?: ReviewStamp; key: string } | null {
  let masked: unknown, vault;
  try { ({ masked, vault } = mask(m.input, m.mask)); } catch { return null; }
  const hit = lookup(m.task, masked);
  if (!hit) return null;
  const key = cacheKey(m.task, masked);
  const s = stamp(key, hit.review, vault.counts());
  return { output: hit.output === null ? null : unmask(hit.output, vault), stamp: s, key };
}

// Pakka live: the server asks Sarvam for a message before the engine needs it (the engine itself stays
// synchronous), keyed by the exact facts. A dry run of the tick collects which facts will be needed.
const liveTexts = new Map<string, Written>();
let capture: ReminderFacts[] | null = null;
export const liveKey = (f: ReminderFacts) => JSON.stringify([f.cycleId, f.kind, f.language, reminderInput(f).input]);
export function setLiveText(f: ReminderFacts, w: Written) { if (liveTexts.size > 5000) liveTexts.clear(); liveTexts.set(liveKey(f), w); }
/** Run `fn` and return the reminder facts it would have asked the model for that have no live text yet. */
export function captureReminders(fn: () => void): ReminderFacts[] {
  capture = [];
  try { fn(); return capture; } finally { capture = null; }
}

let installed = false;
export function installModelHooks() {
  if (installed) return;
  installed = true;

  setWriter((facts, tpl) => {
    if (!MODEL_KINDS.has(facts.kind)) return tpl;
    const live = liveTexts.get(liveKey(facts));
    if (live) return live;
    if (capture) capture.push(facts);
    const hit = cached(reminderInput(facts));
    if (!hit) return tpl;
    if (hit.output === null) return { ...tpl, review: hit.stamp, fallback: `review:${hit.stamp?.reason ?? "template"}` };
    const out = ReminderOut.safeParse(hit.output);
    if (!out.success) return { ...tpl, review: hit.stamp, fallback: "invalid_output" };
    const fails = factcheckReminder(facts, out.data);
    if (fails.length) return { ...tpl, review: hit.stamp && { ...hit.stamp, status: "template", reason: `factcheck:${fails.join(";")}` }, fallback: `factcheck_failed:${fails.join(";")}` };
    return { title: out.data.title, body: out.data.body, voice: out.data.voice_script, language: out.data.language, modelVersion: versionFor("reminder"), review: hit.stamp };
  });

  setTagger((r) => {
    const hit = cached(tagInput(r.text));
    const out = hit?.output ? TagOut.safeParse(hit.output) : null;
    if (out?.success) return { gap: out.data.gap, confidence: out.data.confidence, evidence: out.data.evidence, modelVersion: versionFor("tagger") };
    return { gap: r.goldGap ?? "other", confidence: 1, evidence: r.text.slice(0, 120), modelVersion: "seed-labels" };
  });

  setSummarizer((facts, tpl, ctx) => {
    const hit = cached(summaryInput(facts, ctx.names));
    if (!hit) return tpl;
    const out = hit.output ? CaseOut.safeParse(hit.output) : null;
    if (!out?.success || factcheckSummary(facts, out.data).length) return { ...tpl, review: hit.stamp && { ...hit.stamp, status: "template" } };
    return { ...out.data, modelVersion: versionFor("case_summary"), review: hit.stamp };
  });

  setAlertWriter((metrics, tpl) => {
    const hit = cached(alertInput(metrics));
    if (!hit) return tpl;
    const out = hit.output ? AlertOut.safeParse(hit.output) : null;
    if (!out?.success || factcheckAlert(metrics, out.data).length) return { ...tpl, review: hit.stamp && { ...hit.stamp, status: "template" } };
    return { ...out.data, modelVersion: versionFor("alert"), review: hit.stamp };
  });
}
