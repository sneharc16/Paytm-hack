import { unstable_rethrow } from "next/navigation";
import { readBoundedJson } from "@/lib/server/security";
import { NotFound } from "./runtime";

// JSON responses for the business API. Errors carry a stable code; internals and stack traces never leave.
export const okJson = (data: unknown, init: ResponseInit = {}) => Response.json({ ok: true, data }, init);
export const errJson = (status: number, code: string, message = code, extra: Record<string, unknown> = {}) =>
  Response.json({ ok: false, error: { code, message, ...extra } }, { status });

export async function readJson(req: Request, limit = 64 * 1024): Promise<{ raw: string; body: unknown } | null> {
  return readBoundedJson(req, limit);
}

/** A refusal from the engine is a 4xx with its reason as the code; anything thrown is a bare 500. */
export function fromResult(r: { ok: boolean; reason?: string; data?: Record<string, unknown> }) {
  if (r.ok) return okJson(r.data ?? {});
  const code = (r.reason ?? "REFUSED").split(":")[0];
  const status = code === "INVALID" ? 400 : code.includes("NOT_IN_COMPANY") || code === "AGENT_NOT_ACTIVE" ? 403 : 409;
  return errJson(status, code, r.reason, r.data ?? {});
}

export async function guarded(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    unstable_rethrow(e); // Next's own control flow (prerender bail-outs) must pass through
    if (e instanceof NotFound) return errJson(404, "NOT_FOUND");
    console.error("[b2b]", e);
    return errJson(500, "INTERNAL");
  }
}
