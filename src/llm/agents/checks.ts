// src/llm/agents/checks.ts: the code half of the rubric. Deterministic checks run before the reviewer sees a
// draft; a criterion that fails here stays failed whatever the reviewer says.
import { bannedWordsIn } from "@/copy/banned";
import { piiIn, tokensIn } from "@/lib/privacy/mask";
import { factcheckAlert, factcheckReminder, factcheckSummary, numbersIn } from "../factcheck";
import { ALERT_PRIVACY_LINE, ALLOWED_TOKENS, criteriaFor, JARGON, LIMITS, MAX_SENTENCE_WORDS, PUSH_WORDS, type ReviewTask } from "./rubric";

export interface CodeResult { pass: boolean; detail?: string }
export type CodeResults = Record<string, CodeResult>;

type Field = { field: string; text: string };

/** The text fields people will read, per task. */
export function textsOf(task: ReviewTask, draft: Record<string, unknown>): Field[] {
  const s = (k: string): Field[] => (typeof draft[k] === "string" ? [{ field: k, text: draft[k] as string }] : []);
  const arr = (k: string): Field[] => (Array.isArray(draft[k]) ? (draft[k] as unknown[]).filter((x) => typeof x === "string").map((x) => ({ field: k, text: x as string })) : []);
  switch (task) {
    case "reminder": return [...s("title"), ...s("body"), ...s("voice_script")];
    case "intake": return s("reply");
    case "case_summary": return [...arr("summary"), ...s("customer_ask"), ...s("rules_said"), ...s("merchant_position"), ...arr("evidence"), ...s("suggested_next_step")];
    case "alert": return [...s("headline"), ...s("detail")];
  }
}

const languageOf = (task: ReviewTask, facts: Record<string, unknown>) => (task === "reminder" || task === "intake" ? String(facts.language ?? "en") : "en");

export function devanagariShare(text: string): number {
  const letters = text.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => /[ऀ-ॿ]/.test(c)).length / letters.length : 0;
}

const sentences = (text: string) => text.split(/(?<=[.?!।])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function allowedNumbers(facts: unknown): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "number") out.add(v);
    else if (typeof v === "string") numbersIn(v.replace(/<[A-Z]+_\d+>/g, "")).forEach((n) => out.add(n));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/** Results for every code-checked criterion of the task. */
export function codeChecks(task: ReviewTask, facts: Record<string, unknown>, draft: Record<string, unknown>, knownTokens: Set<string> = new Set()): CodeResults {
  const fields = textsOf(task, draft);
  const all = fields.map((f) => f.text).join("\n");
  const r: CodeResults = {};
  const ids = new Set(criteriaFor(task).filter((c) => c.checkedBy.includes("code")).map((c) => c.id));
  const set = (id: string, pass: boolean, detail?: string) => { if (ids.has(id)) r[id] = pass ? { pass } : { pass, detail }; };

  // R1: numbers and case IDs only from the facts. Token numbers (<NAME_1>) are not facts and are skipped.
  const allowed = allowedNumbers(facts);
  const extra = [...new Set(numbersIn(all.replace(/<[A-Z]+_\d+>/g, "")).filter((n) => !allowed.has(n)))];
  const factsJson = JSON.stringify(facts);
  const badCases = [...new Set(all.match(/PAK-\d{4}/g) ?? [])].filter((c) => !factsJson.includes(c));
  set("R1", !extra.length && !badCases.length, [extra.length ? `numbers not in facts: ${extra.join(", ")}` : "", badCases.length ? `case IDs not in facts: ${badCases.join(", ")}` : ""].filter(Boolean).join("; "));

  // R2: required content.
  if (task === "reminder") {
    const title = String(draft.title ?? "");
    const miss: string[] = [];
    if (!title.includes(String(facts.brand))) miss.push("brand in title");
    if (facts.amount_text && !title.includes(String(facts.amount_text))) miss.push(`amount ${facts.amount_text} in title`);
    if (facts.charge_day && !all.toLowerCase().includes(String(facts.charge_day).toLowerCase())) miss.push(`charge day "${facts.charge_day}"`);
    set("R2", !miss.length, miss.length ? `missing: ${miss.join(", ")}` : undefined);
  } else if (task === "intake") {
    set("R2", String(draft.reply ?? "").trim().length > 0, "empty reply");
  } else if (task === "case_summary") {
    const n = Array.isArray(draft.summary) ? draft.summary.length : 0;
    const ok = n === 3 && String(draft.suggested_next_step ?? "").trim().length > 0;
    set("R2", ok, ok ? undefined : `summary has ${n} sentences; suggested_next_step ${draft.suggested_next_step ? "present" : "missing"}`);
  } else {
    set("R2", !!String(draft.headline ?? "").trim() && !!String(draft.detail ?? "").trim(), "headline or detail empty");
  }

  // R5: banned words and words that recommend a choice (the reviewer judges the rest).
  const banned = [...bannedWordsIn(all), ...PUSH_WORDS.filter((w) => all.toLowerCase().includes(w))];
  set("R5", !banned.length, banned.length ? `pushing or banned words: ${banned.join(", ")}` : undefined);

  // R6: script share.
  const lang = languageOf(task, facts);
  const share = devanagariShare(all);
  const scriptOk = lang === "hi" ? share >= 0.6 : share < 0.05;
  const langField = draft.language;
  const langOk = task !== "reminder" && task !== "intake" ? true : langField === undefined || langField === lang;
  set("R6", scriptOk && langOk, !scriptOk ? `${Math.round(share * 100)}% Devanagari for ${lang}` : `language field "${String(langField)}", asked for ${lang}`);

  // R7: lengths.
  const long = fields.filter((f) => LIMITS[task][f.field] !== undefined && f.text.length > LIMITS[task][f.field]).map((f) => `${f.field} ${f.text.length}/${LIMITS[task][f.field]}`);
  set("R7", !long.length, long.length ? `too long: ${long.join(", ")}` : undefined);

  // R8: sentence length everywhere; jargon in customer text.
  const longSentences = fields.flatMap((f) => sentences(f.text)).filter((s) => words(s) > MAX_SENTENCE_WORDS);
  const jargon = task === "reminder" || task === "intake" ? JARGON.filter((j) => new RegExp(`(^|[^\\p{L}])${j}($|[^\\p{L}])`, "iu").test(all)) : [];
  set("R8", !longSentences.length && !jargon.length, [longSentences.length ? `${longSentences.length} sentence(s) over ${MAX_SENTENCE_WORDS} words: "${longSentences[0].slice(0, 80)}"` : "", jargon.length ? `jargon: ${jargon.join(", ")}` : ""].filter(Boolean).join("; "));

  // R9: no personal values, only known and allowed tokens, none in a voice script.
  const tokens = tokensIn(all);
  const unknown = tokens.filter((t) => !knownTokens.has(t.token)).map((t) => t.token);
  const notAllowed = tokens.filter((t) => !ALLOWED_TOKENS[task].includes(t.type)).map((t) => t.token);
  const inVoice = tokensIn(String(draft.voice_script ?? "")).map((t) => t.token);
  const raw = piiIn(all.replace(/<[A-Z]+_\d+>/g, ""));
  const privOk = !unknown.length && !notAllowed.length && !inVoice.length && !raw.length;
  set("R9", privOk, [raw.length ? `personal values: ${raw.join(", ")}` : "", unknown.length ? `unknown tokens: ${unknown.join(", ")}` : "", notAllowed.length ? `tokens not allowed here: ${[...new Set(notAllowed)].join(", ")}` : "", inVoice.length ? "token in voice script" : ""].filter(Boolean).join("; "));

  // R10: a never-approved message must point to 1930. A trial charge is never called fraud (banned word list).
  if (task === "intake" && draft.intent === "never_approved") set("R10", /1930|१९३०/.test(all), "never approved, but no 1930 helpline in the reply");
  else set("R10", true);

  // L6-P: the exact privacy line.
  set("L6-P", String(draft.detail ?? "").includes(ALERT_PRIVACY_LINE), `missing "${ALERT_PRIVACY_LINE}"`);
  return r;
}

/** The existing deterministic fact-check (factcheck.ts), run again on the final text. */
export function finalFactcheck(task: ReviewTask, facts: Record<string, unknown>, out: Record<string, unknown>): string[] {
  switch (task) {
    case "reminder": return factcheckReminder(facts as never, out as never);
    case "alert": return factcheckAlert(facts, out as never);
    case "case_summary": return factcheckSummary(facts, out);
    case "intake": return [];
  }
}
