// Demo cache: model outputs baked ahead of time (scripts/bake-llm.ts), so the stage demo needs no network.
// Keyed by task, prompt version and input; the entry records which model wrote it.
import { sha256 } from "@/lib/hash";
import demo from "./demo-cache.json";
import { PROMPTS, type Task } from "./prompts";

export interface CacheEntry { task: Task; model: string; promptVersion: string; input: unknown; output: unknown; createdAt: string }

/** JSON with sorted keys, so the same input always gives the same key. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export const cacheKey = (task: Task, input: unknown) => sha256(`${task}|${PROMPTS[task].version}|${stableJson(input)}`);

const entries = (demo as { entries?: Record<string, CacheEntry> }).entries ?? {};

export function lookup(task: Task, input: unknown): CacheEntry | undefined {
  return entries[cacheKey(task, input)];
}

export const demoCacheSize = () => Object.keys(entries).length;
