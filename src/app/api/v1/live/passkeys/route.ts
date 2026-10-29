import { passkeyFinish } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => passkeyFinish(req);
