import { signInFinish, signOut } from "@/lib/server/b2b/handlers";

export const POST = (req: Request) => signInFinish(req);
export const DELETE = (req: Request) => signOut(req);
