// src/b2b/match.ts: three-way match (purchase order, goods receipt, invoice) and duplicate detection.
import type { GoodsReceipt, Invoice, PurchaseOrder } from "./types";

export interface MatchResult { ok: boolean; issues: string[] }

export function threeWayMatch(inv: Invoice, po: PurchaseOrder | undefined, grn: GoodsReceipt | undefined, toleranceBps: number): MatchResult {
  const issues: string[] = [];
  if (!po) return { ok: false, issues: ["NO_PO"] };
  if (po.vendorId !== inv.vendorId || po.companyId !== inv.companyId) issues.push("PO_OTHER_VENDOR");
  if (!grn) return { ok: false, issues: [...issues, "NO_GRN"] };
  for (const l of inv.lines) {
    const p = po.lines.find((x) => x.sku === l.sku);
    const g = grn.lines.find((x) => x.sku === l.sku);
    if (!p) { issues.push(`NOT_ON_PO:${l.sku}`); continue; }
    if (l.rate * 10_000 > p.rate * (10_000 + toleranceBps)) issues.push(`RATE_ABOVE_PO:${l.sku}`);
    if (l.qty > p.qty) issues.push(`QTY_ABOVE_PO:${l.sku}`);
    if (!g || l.qty > g.qty) issues.push(`QTY_ABOVE_RECEIVED:${l.sku}`);
  }
  const taxable = inv.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  if (taxable !== inv.taxable || inv.taxable + inv.gst !== inv.total) issues.push("TOTALS_DO_NOT_ADD_UP");
  return { ok: issues.length === 0, issues };
}

const normNo = (n: string) => n.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/(R|REV|DUP|COPY)\d*$/, "");

export interface Duplicate { kind: "exact" | "likely"; of: string }

/** Against invoices already accepted for payment (paid, paying or approved), not against held ones. */
export function findDuplicate(inv: Invoice, accepted: Invoice[]): Duplicate | null {
  for (const o of accepted) {
    if (o.id === inv.id || o.vendorId !== inv.vendorId) continue;
    if (o.number.trim().toUpperCase() === inv.number.trim().toUpperCase()) return { kind: "exact", of: o.id };
  }
  for (const o of accepted) {
    if (o.id === inv.id || o.vendorId !== inv.vendorId) continue;
    if (normNo(o.number) === normNo(inv.number) || (o.poId === inv.poId && o.total === inv.total)) return { kind: "likely", of: o.id };
  }
  return null;
}
