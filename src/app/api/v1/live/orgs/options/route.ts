import { createOrgOptions } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => createOrgOptions(req);
