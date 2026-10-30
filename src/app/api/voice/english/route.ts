import { toEnglishRoute } from "@/lib/server/voice";

export const POST = (req: Request) => toEnglishRoute(req);
