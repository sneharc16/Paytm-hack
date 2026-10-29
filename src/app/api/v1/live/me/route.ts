import { me } from "@/lib/server/b2b/handlers";

export const GET = (req: Request) => me(req);
