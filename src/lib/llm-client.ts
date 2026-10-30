"use client";
// Browser side of live model calls (L3 intake, L5 lint). The browser sends only the text; the server builds the
// facts and masks them. Returns the server's answer (output or fallback, with the review stamp), or null when
// the call itself failed, so callers use templates.
import type { ReviewStamp } from "@/engine/types";

export interface LiveResult<T> { output?: T; promptVersion: string; model?: string; fallback?: string; review?: ReviewStamp; masked?: Record<string, number> }

export async function callModel<T>(task: "intake" | "lint", input: { text: string }, opts: { session?: string; userId?: string; lang?: string } = {}): Promise<LiveResult<T> | null> {
  try {
    const res = await fetch(`/api/llm/${task}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: opts.session ?? "web", input, userId: opts.userId, lang: opts.lang }) });
    const body = await res.json();
    return body.ok ? body.data : null;
  } catch {
    return null;
  }
}
