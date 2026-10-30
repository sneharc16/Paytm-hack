import { prepare } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => prepare(req);
