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
// --fresh discards a language's existing lines first (after a change to how it is translated).
const fresh = process.argv.includes("--fresh");
const named = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const want = (named.length ? named : REGIONAL) as RegionalCode[];
if (!sarvamEnabled()) { console.error("Set SARVAM_API_KEY in .env.local first."); process.exit(1); }
const doc = JSON.parse(readFileSync(file, "utf8")) as { version: number; source: string; langs: Record<string, Record<string, string>>; baked?: Record<string, string> };
const total = Object.keys(sourceLines()).length;
async function main() {
  // Drop empty tables left by an earlier failed run.
  for (const k of Object.keys(doc.langs)) if (!Object.keys(doc.langs[k]).length) delete doc.langs[k];
  for (const lang of want) {
    if (!REGIONAL.includes(lang)) { console.error(`Unknown language ${lang}`); continue; }
    const t0 = Date.now();
    // Lines already baked are kept and not paid for again; only missing ones are translated.
    const have = fresh ? {} : doc.langs[lang] ?? {};
    const { table, failed, outOfCredits } = await translateDeck(lang, have);
    const merged = { ...have, ...table };
    if (Object.keys(merged).length) doc.langs[lang] = Object.fromEntries(Object.entries(merged).sort());
    doc.baked = { ...(doc.baked ?? {}), [lang]: new Date().toISOString().slice(0, 10) };
    writeFileSync(file, JSON.stringify(doc, null, 2) + "\n");
    console.log(`${langInfo(lang).english.padEnd(10)} ${Object.keys(merged).length}/${total} lines (${Object.keys(table).length} new) in ${Math.round((Date.now() - t0) / 1000)}s${failed.length ? `; kept in base language: ${failed.slice(0, 4).join(" | ")}${failed.length > 4 ? " ..." : ""}` : ""}`);
    if (outOfCredits) { console.error("\nSarvam says the account is out of credits. Lines baked so far are saved; top up and run again to fill the rest."); process.exit(2); }
  }
}
void main();
