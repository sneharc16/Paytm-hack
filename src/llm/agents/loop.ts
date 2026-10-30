// src/llm/agents/loop.ts: generator, reviewer, consolidator. A round is one draft and one review. The loop ends
// when every criterion passes ("agreed") or after 5 rounds, when the reviewer's binding decision is final and
// the consolidator applies it ("reviewer_final"). The final text is checked again by code and by factcheck.ts;
// anything that fails, times out or errors gives "template". Models are injected, so tests run without network.
import type { z } from "zod";
import { codeChecks, finalFactcheck } from "./checks";
import {
  consolidatorSchema, consolidatorSystem, consolidatorUser, generatorSchema, generatorSystem, generatorUser, reviewerSystem, reviewerUser,
  ReviewerOut, reviewVersion, type Binding,
} from "./prompts";
import { criteriaFor, type ReviewTask } from "./rubric";

export const MAX_ROUNDS = 5;

export type Role = "generator" | "reviewer" | "consolidator";
export type Caller = (role: Role, system: string, user: string, schema: z.ZodType) => Promise<{ ok: true; raw: unknown; model: string } | { ok: false; reason: string }>;

export type Verdict = "pass" | "fail";
export interface RoundLog {
  round: number;
  verdicts: Record<string, Verdict>;
  /** Why each criterion failed: by the code check or the reviewer, the words and the fix. */
  fails: { criterion: string; by: "code" | "reviewer"; quote: string; fix: string }[];
  contests: { criterion: string; factsQuote: string; answer: "upheld" | "withdrawn"; reason: string }[];
}
export type ReviewStatus = "agreed" | "reviewer_final" | "template";
export interface ReviewMeta {
  status: ReviewStatus;
  rounds: number;
  trail: RoundLog[];
  binding?: Binding;
  /** Why the template was used. */
  reason?: string;
  models: Partial<Record<Role, string>>;
  version: string;
  calls: number;
}

export interface LoopResult { output: Record<string, unknown> | null; meta: ReviewMeta }

export interface LoopOptions {
  call: Caller;
  /** Tokens present in the masked input; the draft may use only these. */
  knownTokens?: Set<string>;
  /** Wall-clock deadline (ms since epoch). Checked before each call. */
  deadline?: number;
  now?: () => number;
  maxRounds?: number;
}

export async function reviewLoop(task: ReviewTask, facts: Record<string, unknown>, opts: LoopOptions): Promise<LoopResult> {
  const now = opts.now ?? Date.now;
  const maxRounds = opts.maxRounds ?? MAX_ROUNDS;
  const criteria = criteriaFor(task);
  const factsJson = JSON.stringify(facts);
  const meta: ReviewMeta = { status: "template", rounds: 0, trail: [], models: {}, version: reviewVersion(task), calls: 0 };
  const template = (reason: string): LoopResult => ({ output: null, meta: { ...meta, status: "template", reason } });
  const timeUp = () => opts.deadline !== undefined && now() >= opts.deadline;

  const call = async <T>(role: Role, system: string, user: string, schema: z.ZodType<T>): Promise<{ ok: true; value: T } | { ok: false; reason: string }> => {
    meta.calls++;
    const r = await opts.call(role, system, user, schema);
    if (!r.ok) return { ok: false, reason: `${role}_${r.reason}` };
    meta.models[role] = r.model;
    const parsed = schema.safeParse(r.raw);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: `${role}_invalid_output` };
  };

  let draft: Record<string, unknown> | null = null;
  let review: unknown = undefined;
  let final: Record<string, unknown> | null = null;

  for (let round = 1; round <= maxRounds; round++) {
    if (timeUp()) return template("time_budget");
    const gen = await call("generator", generatorSystem(task), generatorUser(task, facts, draft ? { draft, review } : undefined), generatorSchema(task));
    if (!gen.ok) return template(gen.reason);
    draft = gen.value.draft as Record<string, unknown>;
    const contests = gen.value.contests;
    const code = codeChecks(task, facts, draft, opts.knownTokens);

    if (timeUp()) return template("time_budget");
    const finalRound = round === maxRounds;
    const codeForReviewer = Object.fromEntries(Object.entries(code).map(([id, c]) => [id, c.pass ? "pass" : `fail: ${c.detail ?? ""}`]));
    const rev = await call("reviewer", reviewerSystem(), reviewerUser(task, facts, draft, codeForReviewer, contests, finalRound), ReviewerOut);
    if (!rev.ok) return template(rev.reason);

    // Resolve each criterion: a code fail stands; otherwise the reviewer's verdict, unless a contest was withdrawn.
    // A contest counts only if its quote really is in FACTS.
    const log: RoundLog = { round, verdicts: {}, fails: [], contests: [] };
    for (const c of criteria) {
      const v = rev.value.verdicts.find((x) => x.criterion === c.id);
      const contest = contests.find((x) => x.criterion === c.id);
      const answer = rev.value.contest_answers.find((x) => x.criterion === c.id);
      const quoteInFacts = !!contest && contest.facts_quote.trim().length > 0 && factsJson.includes(contest.facts_quote.trim());
      if (contest) log.contests.push({ criterion: c.id, factsQuote: contest.facts_quote, answer: answer?.answer === "withdrawn" && quoteInFacts && code[c.id]?.pass !== false ? "withdrawn" : "upheld", reason: !quoteInFacts ? "Quote is not in FACTS" : code[c.id]?.pass === false ? "Failed a code check" : answer?.reason ?? "No answer" });
      if (code[c.id] && !code[c.id].pass) {
        log.verdicts[c.id] = "fail";
        log.fails.push({ criterion: c.id, by: "code", quote: "", fix: code[c.id].detail ?? "" });
      } else if (!v || v.verdict === "fail") {
        const withdrawn = log.contests.find((x) => x.criterion === c.id)?.answer === "withdrawn";
        log.verdicts[c.id] = withdrawn ? "pass" : "fail";
        if (!withdrawn) log.fails.push({ criterion: c.id, by: "reviewer", quote: v?.quote ?? "", fix: v?.fix ?? "No verdict returned" });
      } else {
        log.verdicts[c.id] = "pass";
      }
    }
    meta.trail.push(log);
    meta.rounds = round;

    if (!log.fails.length) { meta.status = "agreed"; final = draft; break; }
    review = log.fails.map((f) => ({ criterion: f.by === "code" ? `${f.criterion} [code]` : f.criterion, words: f.quote, fix: f.fix }));

    if (finalRound) {
      // The reviewer's decision is final.
      const binding = rev.value.binding;
      if (!binding) return template("reviewer_no_binding");
      meta.binding = binding;
      if (binding.use_template) return template("reviewer_use_template");
      if (timeUp()) return template("time_budget");
      const con = await call("consolidator", consolidatorSystem(task), consolidatorUser(task, facts, draft, binding), consolidatorSchema(task));
      if (!con.ok) return template(con.reason);
      final = con.value as Record<string, unknown>;
      meta.status = "reviewer_final";
      // The consolidator may not bring back what the reviewer removed, and must include what it required.
      const text = JSON.stringify(final);
      const back = [...binding.remove, ...binding.change.map((c) => c.from)].filter((w) => w.trim() && text.includes(w));
      const missing = binding.include.filter((w) => w.trim() && !text.includes(w));
      if (back.length || missing.length) return template(`binding_not_applied:${[...back.map((w) => `kept "${w}"`), ...missing.map((w) => `missing "${w}"`)].join(";")}`);
    }
  }

  if (!final) return template("no_final");
  // Final gate: every code check and the existing fact-check, on the text that would be sent.
  const again = codeChecks(task, facts, final, opts.knownTokens);
  const failedCode = Object.entries(again).filter(([, c]) => !c.pass).map(([id, c]) => `${id}:${c.detail ?? ""}`);
  const fc = finalFactcheck(task, facts, final);
  if (failedCode.length || fc.length) return { output: null, meta: { ...meta, status: "template", reason: `final_check:${[...failedCode, ...fc].join(";")}` } };
  return { output: final, meta };
}
