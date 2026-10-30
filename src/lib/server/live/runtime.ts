// Pakka live on the server: load a person, let their clock run to now (wall time), apply what they asked for,
// save. Reminder text is written live by Sarvam before the engine needs it: a dry run of the tick says which
// messages are due, Sarvam writes each one (fact-checked, then translated and checked again for a regional
// language), and the real tick picks the text up. Anything that fails keeps the hand-written template.
import { tick } from "@/engine/agent";
import type { ReminderFacts, Written } from "@/engine/explain";
import { buildLiveWorld, horizonFrom } from "@/engine/live";
import { Session } from "@/engine/session";
import type { ISO } from "@/engine/types";
import { checkTranslation } from "@/copy/regional";
import { isRegional, type UiLang } from "@/copy/languages";
import { llmEnabled, runTask } from "@/llm/client";
import { factcheckReminder } from "@/llm/factcheck";
import { captureReminders, installModelHooks, liveKey, reminderInput, setLiveText } from "@/llm/hooks";
import { PROMPTS } from "@/llm/prompts";
import { ReminderOut } from "@/llm/schemas";
import { sarvamEnabled, translate } from "@/lib/server/sarvam";
import { LiveConflict, liveStore, type LiveDoc } from "./store";

export class NotFound extends Error {}
export const nowIso = (): ISO => new Date().toISOString();

export function sessionOf(doc: LiveDoc, until: ISO): Session {
  return new Session(doc.profile.id, buildLiveWorld(doc.profile, doc.autopays, until), doc.events);
}

/** One message from Sarvam for these facts, in the person's language, or null (the template stays). */
export async function writeReminder(f: ReminderFacts, ui: UiLang): Promise<Written | null> {
  const r = await runTask("reminder", reminderInput(f), { useDemoCache: false, timeoutMs: 15_000 });
  if (!r.ok) return null;
  const out = ReminderOut.safeParse(r.output);
  if (!out.success || factcheckReminder(f, out.data).length) return null;
  const base: Written = { title: out.data.title, body: out.data.body, voice: out.data.voice_script, language: out.data.language, modelVersion: `${PROMPTS.reminder.version}:${r.model}` };
  if (!isRegional(ui) || !sarvamEnabled()) return base;
  // Every field must survive the same check the copy deck passes, or the whole message stays in the base language.
  const fields = await Promise.all([base.title, base.body, base.voice ?? ""].map(async (text) => {
    if (!text) return "";
    const t = await translate(text, ui, f.language);
    if (!t.ok) return null;
    const c = checkTranslation(text, t.data, ui);
    if (c.ok) return c.text;
    // A field of only names, numbers and loanwords ("Readwell AutoPay ₹649") comes back unchanged; that is right.
    return c.problems.every((p) => p === "script") && t.data.trim() === text.trim() ? text : null;
  }));
  if (fields.some((x) => x === null)) return base;
  return { ...base, title: fields[0]!, body: fields[1]!, voice: fields[2] || undefined, language: ui, modelVersion: `${base.modelVersion}+sarvam-translate` };
}

async function prewrite(doc: LiveDoc, until: ISO, now: ISO) {
  if (!llmEnabled()) return;
  const dry = sessionOf(doc, until);
  const need = captureReminders(() => tick(dry, now));
  const unique = [...new Map(need.map((f) => [liveKey(f), f])).values()].slice(0, 6);
  await Promise.all(unique.map(async (f) => { const w = await writeReminder(f, doc.profile.uiLang); if (w) setLiveText(f, w); }));
}

export interface Step<T> {
  /** Change the stored person before the clock runs (add an AutoPay, change language). Return an error code to stop. */
  mutate?: (doc: LiveDoc, now: ISO) => string | null;
  /** Act on the engine at `now`, after the clock has caught up (a decision, a question). */
  act?: (s: Session, now: ISO, doc: LiveDoc) => T;
}

/** Load, mutate, catch the clock up to now, act, save. Retried if another request saved in between. */
export async function withPerson<T>(id: string, step: Step<T> = {}): Promise<{ doc: LiveDoc; until: ISO; now: ISO; result?: T; error?: string }> {
  installModelHooks();
  for (let attempt = 0; ; attempt++) {
    const stored = await liveStore().get(id);
    if (!stored) throw new NotFound();
    const doc = structuredClone(stored);
    const now = nowIso(), until = horizonFrom(now);
    const error = step.mutate?.(doc, now) ?? null;
    if (error) return { doc: stored, until, now, error };
    await prewrite(doc, until, now);
    const s = sessionOf(doc, until);
    const before = s.events.length;
    tick(s, now);
    const result = step.act?.(s, now, doc);
    s.drain();
    const changed = !!step.mutate || s.events.length !== before;
    if (!changed) return { doc, until, now, result };
    doc.events = s.events;
    doc.version = stored.version + 1;
    try {
      await liveStore().put(doc);
      return { doc, until, now, result };
    } catch (e) {
      if (!(e instanceof LiveConflict) || attempt >= 3) throw e;
    }
  }
}

/** Cron: every person's clock catches up, so reminders and charges happen even when nobody has the app open. */
export async function tickEveryone() {
  const ids = await liveStore().ids();
  let events = 0;
  for (const id of ids) {
    const before = (await liveStore().get(id))?.events.length ?? 0;
    const r = await withPerson(id);
    events += r.doc.events.length - before;
  }
  return { people: ids.length, events };
}
