// src/llm/client.ts: the one place that calls a language model (PRD 14.2). Server only: it reads the API keys.
// Providers: Anthropic (paid) or Google Gemini (free tier). Every input is masked first (src/lib/privacy): no
// personal value reaches a provider, and if masking fails nothing is sent. Order: demo cache, then this
// process's cache, then the model. Texts people read (L1, L3, L4, L6) go through the three-agent review loop
// (src/llm/agents); classifiers (L2, L5) are one call. Every output is schema-validated; anything that fails
// (no key, timeout, refusal, bad JSON, rate limit, review) returns { ok: false } and the caller uses its template.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { mask, tokensIn, unmask, type MaskOptions, type PiiType, type Vault } from "@/lib/privacy/mask";
import { reviewLoop, type ReviewMeta, type Role } from "./agents/loop";
import { isReviewed } from "./agents/rubric";
import { cacheKey, lookup, versionFor } from "./cache";
import { PROMPTS, type Task } from "./prompts";
import { SCHEMAS } from "./schemas";

type Masked = Partial<Record<PiiType, number>>;
export type TaskResult =
  | { ok: true; output: unknown; model: string; promptVersion: string; cacheHit: boolean; latencyMs: number; review?: ReviewMeta; masked: Masked }
  | { ok: false; reason: string; promptVersion: string; review?: ReviewMeta; masked?: Masked };

/** Outputs are kept masked; values go back in only for the caller, per request. */
const memory = new Map<string, { output: unknown; model: string; review?: ReviewMeta }>();

type Provider = "anthropic" | "gemini" | "none";
const anthropicKey = () => process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY;
const geminiKey = () => process.env.GEMINI_API_KEY;

/** LLM_PROVIDER if set; otherwise whichever key is present. */
export function provider(): Provider {
  const p = process.env.LLM_PROVIDER;
  if (p === "anthropic" || p === "gemini" || p === "none") return p;
  return anthropicKey() ? "anthropic" : geminiKey() ? "gemini" : "none";
}

const isFastTask = (task: Task) => task === "tagger" || task === "intake" || task === "lint";

/** Writing tasks use the main model; tagging, intake and lint use the fast one. */
export function modelFor(task: Task, p: Provider = provider()): string {
  if (p === "gemini") return isFastTask(task) ? process.env.GEMINI_MODEL_FAST || "gemini-3.5-flash-lite" : process.env.GEMINI_MODEL || "gemini-3.5-flash";
  return isFastTask(task) ? process.env.LLM_MODEL_FAST || "claude-haiku-5-5" : process.env.LLM_MODEL || "claude-sonnet-5-5";
}

export function llmEnabled(): boolean {
  const p = provider();
  return (p === "anthropic" && !!anthropicKey()) || (p === "gemini" && !!geminiKey());
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  // 6 second timeout, one retry (PRD 14.2).
  client ??= new Anthropic({ apiKey: anthropicKey(), timeout: 6000, maxRetries: 1 });
  return client;
}
let gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  gemini ??= new GoogleGenAI({ apiKey: geminiKey() });
  return gemini;
}
/** Tests swap in fakes. */
export function setClientForTests(c: unknown) { client = c as Anthropic; memory.clear(); }
export function setGeminiForTests(c: unknown) { gemini = c as GoogleGenAI; memory.clear(); }

type Call = { ok: true; raw: unknown; model: string } | { ok: false; reason: string };

async function callAnthropic(system: string, schema: z.ZodType, model: string, user: string): Promise<Call> {
  try {
    const response = await getClient().beta.messages.parse({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: betaZodOutputFormat(schema as z.ZodObject) },
      // Refusals on the Sonnet route fall back server-side; the Haiku route has no fallback and uses the template.
      ...(model.startsWith("claude-sonnet") ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "refusal" };
    if (response.stop_reason === "max_tokens") return { ok: false, reason: "max_tokens" };
    return { ok: true, raw: response.parsed_output, model: response.model };
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Anthropic.RateLimitError ? "rate_limited"
        : error instanceof Anthropic.AuthenticationError ? "auth"
        : error instanceof Anthropic.BadRequestError ? "bad_request"
        : error instanceof Anthropic.APIConnectionTimeoutError ? "timeout"
        : error instanceof Anthropic.APIConnectionError ? "connection"
        : error instanceof Anthropic.APIError ? `api_${error.status}`
        : "error",
    };
  }
}

/** JSON Schema for Gemini's structured output, from the same Zod schema. */
function jsonSchemaFor(zschema: z.ZodType) {
  const { $schema: _drop, ...schema } = z.toJSONSchema(zschema) as Record<string, unknown>;
  void _drop;
  return schema;
}

const TRANSIENT = new Set(["api_503", "api_504", "timeout", "rate_limited"]);

async function callGemini(system: string, schema: z.ZodType, model: string, user: string, timeoutMs: number): Promise<Call> {
  const first = await callGeminiOnce(system, schema, model, user, timeoutMs);
  // The free tier is often busy: retry once on the lighter model before giving up.
  const fast = modelFor("tagger", "gemini");
  if (!first.ok && TRANSIENT.has(first.reason) && model !== fast) return callGeminiOnce(system, schema, fast, user, timeoutMs);
  return first;
}

async function callGeminiOnce(system: string, schema: z.ZodType, model: string, user: string, timeoutMs: number): Promise<Call> {
  try {
    const response = await getGemini().models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: system, responseMimeType: "application/json", responseJsonSchema: jsonSchemaFor(schema),
        maxOutputTokens: 2000, abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
    if (response.promptFeedback?.blockReason) return { ok: false, reason: "refusal" };
    const finish = response.candidates?.[0]?.finishReason;
    if (finish === FinishReason.MAX_TOKENS) return { ok: false, reason: "max_tokens" };
    if (finish && finish !== FinishReason.STOP) return { ok: false, reason: "refusal" };
    const text = response.text;
    if (!text) return { ok: false, reason: "invalid_output" };
    try {
      return { ok: true, raw: JSON.parse(text), model: response.modelVersion ?? model };
    } catch {
      return { ok: false, reason: "invalid_output" };
    }
  } catch (error) {
    if (error instanceof ApiError) {
      return { ok: false, reason: error.status === 429 ? "rate_limited" : error.status === 401 || error.status === 403 ? "auth" : error.status === 400 ? "bad_request" : `api_${error.status}` };
    }
    const name = (error as Error)?.name;
    return { ok: false, reason: name === "AbortError" || name === "TimeoutError" ? "timeout" : "connection" };
  }
}

function userContent(task: Task, input: unknown): string {
  const json = JSON.stringify(input);
  switch (task) {
    case "reminder": return `FACTS:\n${json}`;
    case "tagger": return `Review:\n${(input as { text: string }).text}`;
    case "intake": return `Message:\n${(input as { text: string }).text}`;
    case "case_summary": return `FACTS:\n${json}`;
    case "lint": return `TEXT:\n${(input as { text: string }).text}`;
    case "alert": return `METRICS:\n${json}`;
  }
}

export interface RunOptions {
  useDemoCache?: boolean;
  /** Per call. */
  timeoutMs?: number;
  /** Overall budget for a reviewed task (all rounds), from now. */
  budgetMs?: number;
  /** Names we hold for this customer and words to keep (brands), for masking. */
  mask?: MaskOptions;
  /** Return the output still masked (the bake stores it that way). */
  keepMasked?: boolean;
}

/** Mask the input. Throws are caught by the caller: no masking, no model call. */
export function maskInput(input: unknown, opts: MaskOptions = {}) {
  return mask(input, opts);
}

const knownTokens = (masked: unknown) => new Set(tokensIn(JSON.stringify(masked)).map((t) => t.token));

function done(task: Task, output: unknown, vault: Vault, model: string, review: ReviewMeta | undefined, cacheHit: boolean, latencyMs: number, keepMasked = false): TaskResult {
  const promptVersion = versionFor(task);
  if (output === null || output === undefined) return { ok: false, reason: `review:${review?.reason ?? "template"}`, promptVersion, review, masked: vault.counts() };
  const parsed = SCHEMAS[task].safeParse(output);
  if (!parsed.success) return { ok: false, reason: "invalid_output", promptVersion, review, masked: vault.counts() };
  return { ok: true, output: keepMasked ? parsed.data : unmask(parsed.data, vault), model, promptVersion, cacheHit, latencyMs, review, masked: vault.counts() };
}

export async function runTask(task: Task, input: unknown, opts: RunOptions = {}): Promise<TaskResult> {
  const promptVersion = versionFor(task);
  let masked: unknown, vault: Vault;
  try {
    ({ masked, vault } = maskInput(input, opts.mask));
  } catch {
    return { ok: false, reason: "mask_failed", promptVersion };
  }
  if (opts.useDemoCache ?? process.env.LLM_USE_DEMO_CACHE !== "false") {
    const hit = lookup(task, masked);
    if (hit) return done(task, hit.output, vault, hit.model, hit.review, true, 0, opts.keepMasked);
  }
  const key = cacheKey(task, masked);
  const mem = memory.get(key);
  if (mem) return done(task, mem.output, vault, mem.model, mem.review, true, 0, opts.keepMasked);
  if (!llmEnabled() && !client && !gemini) return { ok: false, reason: "llm_off", promptVersion, masked: vault.counts() };

  const p = client ? "anthropic" : gemini ? "gemini" : provider();
  const started = Date.now();
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const deadline = opts.budgetMs !== undefined ? started + opts.budgetMs : undefined;
  const callWith = (system: string, schema: z.ZodType, model: string, user: string) => {
    const left = deadline !== undefined ? Math.max(1000, deadline - Date.now()) : timeoutMs;
    return p === "gemini" ? callGemini(system, schema, model, user, Math.min(timeoutMs, left)) : callAnthropic(system, schema, model, user);
  };

  if (isReviewed(task)) {
    // Writer and consolidator on the main model, reviewer on the fast one: a different tier, fewer shared blind spots.
    const roleModel: Record<Role, string> = { generator: modelFor(task, p), consolidator: modelFor(task, p), reviewer: modelFor("tagger", p) };
    const r = await reviewLoop(task, masked as Record<string, unknown>, {
      call: (role, system, user, schema) => callWith(system, schema, roleModel[role], user),
      knownTokens: knownTokens(masked), deadline,
    });
    const latencyMs = Date.now() - started;
    // Keep the outcome (template included) so this process does not ask again; the vault is never stored.
    if (!r.meta.reason?.startsWith("time_budget") && !/rate_limited|timeout|api_5|connection/.test(r.meta.reason ?? "")) memory.set(key, { output: r.output, model: r.meta.models.generator ?? roleModel.generator, review: r.meta });
    console.info(JSON.stringify({ llm: task, promptVersion, status: r.meta.status, rounds: r.meta.rounds, calls: r.meta.calls, latencyMs, reason: r.meta.reason, masked: vault.counts() }));
    return done(task, r.output, vault, r.meta.models.generator ?? roleModel.generator, r.meta, false, latencyMs, opts.keepMasked);
  }

  const model = modelFor(task, p);
  const call = await callWith(PROMPTS[task].system, SCHEMAS[task], model, userContent(task, masked));
  const latencyMs = Date.now() - started;
  if (!call.ok) {
    console.warn(JSON.stringify({ llm: task, model, promptVersion, fallback: call.reason }));
    return { ok: false, reason: call.reason, promptVersion, masked: vault.counts() };
  }
  const parsed = SCHEMAS[task].safeParse(call.raw);
  if (!parsed.success) return { ok: false, reason: "invalid_output", promptVersion, masked: vault.counts() };
  memory.set(key, { output: parsed.data, model: call.model });
  console.info(JSON.stringify({ llm: task, model: call.model, promptVersion, latencyMs, cacheHit: false, masked: vault.counts() }));
  return done(task, parsed.data, vault, call.model, undefined, false, latencyMs, opts.keepMasked);
}
