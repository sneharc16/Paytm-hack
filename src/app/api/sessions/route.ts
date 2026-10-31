import { allowedOrigins } from "@/lib/server/b2b/auth";
import { BoundedRateLimiter, checkNonCrossOrigin, clientIp } from "@/lib/server/security";
import { getSession, newSessionId } from "@/lib/server/sessions";

const createLimiter = new BoundedRateLimiter(2048, 60_000);

export async function POST(req: Request) {
  if (!checkNonCrossOrigin(req, allowedOrigins(req))) {
    return Response.json({ ok: false, error: { code: "CROSS_ORIGIN", message: "Cross-origin request blocked" } }, { status: 403 });
  }
  if (createLimiter.limited(`sess-create:${clientIp(req)}`, 20)) {
    return Response.json({ ok: false, error: { code: "RATE_LIMITED", message: "Too many sessions created" } }, { status: 429 });
  }
  const id = newSessionId();
  await getSession(id);
  return Response.json({ ok: true, data: { id } });
}
