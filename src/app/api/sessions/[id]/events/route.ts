import { Command } from "@/engine/commands";
import { allowedOrigins } from "@/lib/server/b2b/auth";
import { BoundedRateLimiter, checkNonCrossOrigin, clientIp, readBoundedJson } from "@/lib/server/security";
import { command, eventsSince, VALID_SESSION_ID } from "@/lib/server/sessions";

const eventsLimiter = new BoundedRateLimiter(4096, 60_000);
const isAllowedHttpSessionId = (id: string) => VALID_SESSION_ID.test(id) && (process.env.NODE_ENV !== "production" || id.length >= 12);

/** Catch-up and polling: events after an id, plus the clock. Advances the session to sim now first. */
export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  const { id } = await ctx.params;
  if (!isAllowedHttpSessionId(id)) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: "Bad session id" } }, { status: 400 });
  if (eventsLimiter.limited(`sess-poll:${clientIp(req)}`, 300)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  }
  const url = new URL(req.url);
  const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
  const epoch = Math.max(0, Number(url.searchParams.get("epoch") ?? 0) || 0);
  return Response.json({ ok: true, data: await eventsSince(id, after, epoch) });
}

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/events">) {
  if (!checkNonCrossOrigin(req, allowedOrigins(req))) {
    return Response.json({ ok: false, error: { code: "CROSS_ORIGIN", message: "Cross-origin request blocked" } }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!isAllowedHttpSessionId(id)) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: "Bad session id" } }, { status: 400 });
  if (eventsLimiter.limited(`sess-cmd:${clientIp(req)}`, 120)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many commands" } }, { status: 429 });
  }
  const j = await readBoundedJson(req, 32 * 1024);
  const parsed = j ? Command.safeParse(j.body) : null;
  if (!parsed?.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed?.error.message ?? "Invalid JSON" } }, { status: 400 });
  return Response.json({ ok: true, data: (await command(id, parsed.data)) ?? null });
}
