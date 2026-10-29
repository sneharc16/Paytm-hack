// pnpm bake:sarvam [lang ...]: translate the customer copy deck with Sarvam AI into regional languages and write
// src/copy/regional.json. Only lines that pass checkTranslation are kept; the rest fall back to Hindi or English.
// Needs SARVAM_API_KEY in .env.local. With no languages given, all 21 regional languages are baked.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { langInfo, REGIONAL, type RegionalCode } from "@/copy/languages";
import { sourceLines } from "@/copy/regional";
import { sarvamEnabled } from "@/lib/server/sarvam";
import { translateDeck } from "@/lib/server/voice";

const file = path.join(process.cwd(), "src/copy/regional.json");
const want = (process.argv.slice(2).length ? process.argv.slice(2) : REGIONAL) as RegionalCode[];
if (!sarvamEnabled()) { console.error("Set SARVAM_API_KEY in .env.local first."); process.exit(1); }
const doc = JSON.parse(readFileSync(file, "utf8")) as { version: number; source: string; langs: Record<string, Record<string, string>>; baked?: Record<string, string> };
const total = Object.keys(sourceLines()).length;
async function main() {
for (const lang of want) {
  if (!REGIONAL.includes(lang)) { console.error(`Unknown language ${lang}`); continue; }
  const t0 = Date.now();
  const { table, failed } = await translateDeck(lang);
  doc.langs[lang] = Object.fromEntries(Object.entries(table).sort());
  doc.baked = { ...(doc.baked ?? {}), [lang]: new Date().toISOString().slice(0, 10) };
  writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
  console.log(`${langInfo(lang).english.padEnd(10)} ${Object.keys(table).length}/${total} lines in ${Math.round((Date.now() - t0) / 1000)}s${failed.length ? `; kept in base language: ${failed.slice(0, 6).join(" | ")}${failed.length > 6 ? " ..." : ""}` : ""}`);
}
}
void main();
