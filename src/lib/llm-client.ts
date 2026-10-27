"use client";
// Browser side of live model calls (L3 intake, L5 lint). Returns null on any failure, so callers use templates.
export async function callModel<T>(task: "intake" | "lint", input: unknown, session = "web"): Promise<{ output: T; promptVersion: string; model: string } | null> {
  try {
    const res = await fetch(`/api/llm/${task}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ session, input }) });
    const body = await res.json();
    if (!body.ok || !body.data?.output) return null;
    return body.data;
  } catch {
    return null;
  }
}
