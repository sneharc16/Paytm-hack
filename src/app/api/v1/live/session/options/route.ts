import { signInOptions } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => signInOptions(req);
