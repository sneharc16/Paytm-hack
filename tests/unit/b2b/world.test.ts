import { describe, expect, it } from "vitest";
import { isGstin, isPan } from "@/b2b/gstin";
import { generateBusinessWorld, KAVERI, SAANJH } from "@/b2b/world";

const w = generateBusinessWorld("2711");
describe("business world seed 2711", () => {
  it("is deterministic", () => expect(generateBusinessWorld("2711")).toEqual(w));
  it("has the fixed counts", () => {
    expect(w.vendors.filter((v) => v.companyId === SAANJH)).toHaveLength(35);
    expect(w.vendors.filter((v) => v.companyId === KAVERI)).toHaveLength(6);
    expect(w.invoices.filter((i) => i.companyId === SAANJH)).toHaveLength(41);
    expect(w.invoices.filter((i) => i.companyId === KAVERI)).toHaveLength(8);
    expect(w.invoices.filter((i) => i.tag)).toHaveLength(14);
    expect(w.vendors.filter((v) => v.companyId === SAANJH && v.msme)).toHaveLength(16);
    expect(Object.values(w.bankScripts).sort()).toEqual(["fail_technical", "pending_then_success", "timeout_then_success"]);
  });
  it("keeps money in integer paise", () => {
    for (const i of w.invoices) {
      for (const n of [i.total, i.taxable, i.gst, ...i.lines.map((l) => l.rate)]) expect(Number.isSafeInteger(n)).toBe(true);
      expect(i.taxable + i.gst).toBe(i.total);
    }
  });
  it("gives every company and vendor a valid GSTIN and PAN, except the one tampered invoice", () => {
    for (const x of [...w.companies, ...w.vendors]) { expect(isGstin(x.gstin), x.gstin).toBe(true); expect(isPan(x.pan)).toBe(true); }
    const bad = w.invoices.filter((i) => !isGstin(i.gstin));
    expect(bad.map((i) => i.tag)).toEqual(["bad_gstin"]);
  });
  it("gives each person and agent a distinct key", () => {
    const keys = [...w.people, ...w.agents].map((x) => x.publicKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
