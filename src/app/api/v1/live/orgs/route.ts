import { createOrgFinish } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => createOrgFinish(req);
