import { getSession, newSessionId } from "@/lib/server/sessions";

export async function POST() {
  const id = newSessionId();
  await getSession(id);
  return Response.json({ ok: true, data: { id } });
}
