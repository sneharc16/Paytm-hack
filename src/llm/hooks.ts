// Connects the engine to model output from the demo cache. Runs the same in the browser and on the server,
// synchronously, so replay stays deterministic. Anything missing or failing a check falls back to the template,
// and the flight recorder says which one was used.
import { setSummarizer } from "@/engine/actions";
import { setWriter, type ReminderFacts } from "@/engine/explain";
import { setAlertWriter, setTagger } from "@/engine/radar";
import { lookup } from "./cache";
import { factcheckAlert, factcheckReminder, factcheckSummary } from "./factcheck";
import { PROMPTS } from "./prompts";
import { AlertOut, CaseOut, ReminderOut, TagOut } from "./schemas";

/** The model's input: the facts without internal ids. */
export function reminderInput(f: ReminderFacts) {
  const { cycleId: _omit, ...facts } = f;
  void _omit;
  return facts;
}

let installed = false;
export function installModelHooks() {
  if (installed) return;
  installed = true;

  setWriter((facts, tpl) => {
    const hit = lookup("reminder", reminderInput(facts));
    if (!hit) return tpl;
    const out = ReminderOut.safeParse(hit.output);
    if (!out.success) return { ...tpl, fallback: "invalid_output" };
    const fails = factcheckReminder(facts, out.data);
    if (fails.length) return { ...tpl, fallback: `factcheck_failed:${fails.join(";")}` };
    return { title: out.data.title, body: out.data.body, voice: out.data.voice_script, language: out.data.language, modelVersion: PROMPTS.reminder.version };
  });

  setTagger((r) => {
    const hit = lookup("tagger", { text: r.text });
    const out = hit ? TagOut.safeParse(hit.output) : null;
    if (out?.success) return { gap: out.data.gap, confidence: out.data.confidence, evidence: out.data.evidence, modelVersion: PROMPTS.tagger.version };
    return { gap: r.goldGap ?? "other", confidence: 1, evidence: r.text.slice(0, 120), modelVersion: "seed-labels" };
  });

  setSummarizer((facts, tpl) => {
    const hit = lookup("case_summary", facts);
    const out = hit ? CaseOut.safeParse(hit.output) : null;
    if (!out?.success || factcheckSummary(facts, out.data).length) return tpl;
    return { ...out.data, modelVersion: PROMPTS.case_summary.version };
  });

  setAlertWriter((metrics, tpl) => {
    const hit = lookup("alert", metrics);
    const out = hit ? AlertOut.safeParse(hit.output) : null;
    if (!out?.success || factcheckAlert(metrics, out.data).length) return tpl;
    return { ...out.data, modelVersion: PROMPTS.alert.version };
  });
}
