// src/llm/client.ts: the one place that calls a language model (PRD 14.2). Server only: it reads the API keys.
// Providers: Anthropic (paid) or Google Gemini (free tier). Order: demo cache, then this process's cache,
// then the model. Every output is schema-validated; anything that fails (no key, timeout, refusal, bad JSON,
// rate limit) returns { ok: false } and the caller uses its template.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ApiError, FinishReason, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { cacheKey, lookup } from "./cache";
import { PROMPTS, type Task } from "./prompts";
import { SCHEMAS } from "./schemas";

export type TaskResult =
  | { ok: true; output: unknown; model: string; promptVersion: string; cacheHit: boolean; latencyMs: number }
  | { ok: false; reason: string; promptVersion: string };

const memory = new Map<string, { output: unknown; model: string }>();

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
export function setClientForTests(c: unknown) { client = c as Anthropic; }
export function setGeminiForTests(c: unknown) { gemini = c as GoogleGenAI; }

type Call = { ok: true; raw: unknown; model: string } | { ok: false; reason: string };

async function callAnthropic(task: Task, model: string, user: string): Promise<Call> {
  try {
    const response = await getClient().beta.messages.parse({
      model,
      max_tokens: 2000,
      system: PROMPTS[task].system,
      messages: [{ role: "user", content: user }],
      output_config: { effort: "low", format: betaZodOutputFormat(SCHEMAS[task]) },
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
function jsonSchemaFor(task: Task) {
  const { $schema: _drop, ...schema } = z.toJSONSchema(SCHEMAS[task]) as Record<string, unknown>;
  void _drop;
  return schema;
}

const TRANSIENT = new Set(["api_503", "api_504", "timeout", "rate_limited"]);

async function callGemini(task: Task, model: string, user: string, timeoutMs: number): Promise<Call> {
  const first = await callGeminiOnce(task, model, user, timeoutMs);
  // The free tier is often busy: retry once on the lighter model before giving up.
  const fast = modelFor("tagger", "gemini");
  if (!first.ok && TRANSIENT.has(first.reason) && model !== fast) return callGeminiOnce(task, fast, user, timeoutMs);
  return first;
}

async function callGeminiOnce(task: Task, model: string, user: string, timeoutMs: number): Promise<Call> {
  try {
    const response = await getGemini().models.generateContent({
      model,
      contents: user,
      config: {
        systemInstruction: PROMPTS[task].system, responseMimeType: "application/json", responseJsonSchema: jsonSchemaFor(task),
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

export async function runTask(task: Task, input: unknown, opts: { useDemoCache?: boolean; timeoutMs?: number } = {}): Promise<TaskResult> {
  const promptVersion = PROMPTS[task].version;
  if (opts.useDemoCache ?? process.env.LLM_USE_DEMO_CACHE !== "false") {
    const hit = lookup(task, input);
    if (hit) return { ok: true, output: hit.output, model: hit.model, promptVersion, cacheHit: true, latencyMs: 0 };
  }
  const key = cacheKey(task, input);
  const mem = memory.get(key);
  if (mem) return { ok: true, output: mem.output, model: mem.model, promptVersion, cacheHit: true, latencyMs: 0 };
  if (!llmEnabled() && !client && !gemini) return { ok: false, reason: "llm_off", promptVersion };

  const p = client ? "anthropic" : gemini ? "gemini" : provider();
  const model = modelFor(task, p);
  const started = Date.now();
  const call = p === "gemini" ? await callGemini(task, model, userContent(task, input), opts.timeoutMs ?? 45_000) : await callAnthropic(task, model, userContent(task, input));
  const latencyMs = Date.now() - started;
  if (!call.ok) {
    console.warn(JSON.stringify({ llm: task, model, promptVersion, fallback: call.reason }));
    return { ok: false, reason: call.reason, promptVersion };
  }
  const parsed = SCHEMAS[task].safeParse(call.raw);
  if (!parsed.success) return { ok: false, reason: "invalid_output", promptVersion };
  memory.set(key, { output: parsed.data, model: call.model });
  console.info(JSON.stringify({ llm: task, model: call.model, promptVersion, latencyMs, cacheHit: false }));
  return { ok: true, output: parsed.data, model: call.model, promptVersion, cacheHit: false, latencyMs };
}
