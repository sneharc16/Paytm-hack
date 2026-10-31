import { BoundedRateLimiter, clientIp } from "@/lib/server/security";
import { getSession, VALID_SESSION_ID } from "@/lib/server/sessions";

const readLimiter = new BoundedRateLimiter(4096, 60_000);
const isAllowedHttpSessionId = (id: string) => VALID_SESSION_ID.test(id) && (process.env.NODE_ENV !== "production" || id.length >= 12);

export async function GET(req: Request, ctx: RouteContext<"/api/sessions/[id]">) {
  const { id } = await ctx.params;
  if (!isAllowedHttpSessionId(id)) {
    return Response.json({ ok: false, error: { code: "BAD_REQUEST", message: "Bad session id" } }, { status: 400 });
  }
  if (readLimiter.limited(`sess-get:${clientIp(req)}`, 120)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429 });
  }
  return Response.json({ ok: true, data: await getSession(id) });
}
