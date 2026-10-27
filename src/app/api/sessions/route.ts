import { createSession } from "@/lib/server/sessions";

export async function POST() {
  return Response.json({ ok: true, data: { id: createSession("2711") } });
}
