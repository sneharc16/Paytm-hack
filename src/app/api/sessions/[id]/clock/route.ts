import { ClockCommand } from "@/engine/commands";
import { allowedOrigins } from "@/lib/server/b2b/auth";
import { BoundedRateLimiter, checkNonCrossOrigin, clientIp, readBoundedJson } from "@/lib/server/security";
import { clockCommand, VALID_SESSION_ID } from "@/lib/server/sessions";

const clockLimiter = new BoundedRateLimiter(4096, 60_000);
const isAllowedHttpSessionId = (id: string) => VALID_SESSION_ID.test(id) && (process.env.NODE_ENV !== "production" || id.length >= 12);

export async function POST(req: Request, ctx: RouteContext<"/api/sessions/[id]/clock">) {
  if (!checkNonCrossOrigin(req, allowedOrigins(req))) {
    return Response.json({ ok: false, error: { code: "CROSS_ORIGIN", message: "Cross-origin request blocked" } }, { status: 403 });
  }
  const { id } = await ctx.params;
  if (!isAllowedHttpSessionId(id)) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: "Bad session id" } }, { status: 400 });
  if (clockLimiter.limited(`sess-clock:${clientIp(req)}`, 60)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many clock updates" } }, { status: 429 });
  }
  const j = await readBoundedJson(req, 8 * 1024);
  const parsed = j ? ClockCommand.safeParse(j.body) : null;
  if (!parsed?.success) return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: parsed?.error.message ?? "Invalid JSON" } }, { status: 400 });
  return Response.json({ ok: true, data: await clockCommand(id, parsed.data) });
}
