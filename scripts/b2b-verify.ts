// pnpm b2b:verify <export.json>: check a Pakka for Business ledger export offline. Exit code 0 only if every check passes.
import { readFileSync } from "node:fs";
import { verifyExport, type LedgerExport } from "@/b2b/audit";

const file = process.argv[2];
if (!file) { console.error("pnpm b2b:verify <export.json>"); process.exit(2); }
const report = verifyExport(JSON.parse(readFileSync(file, "utf8")) as LedgerExport);
for (const c of report.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
console.log(JSON.stringify(report.summary, null, 2));
console.log(report.ok ? "\nThe export is intact and every signature verifies." : "\nThe export does NOT verify.");
process.exit(report.ok ? 0 : 1);
