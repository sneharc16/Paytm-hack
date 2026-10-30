import { copyDeck } from "@/lib/server/voice";

export const GET = (req: Request) => copyDeck(req);
