import { describe, expect, it } from "vitest";
import { readInvoiceEmail } from "@/b2b/intake";
import { findDuplicate } from "@/b2b/match";
import { generateBusinessWorld } from "@/b2b/world";

const w = generateBusinessWorld("2711");
const vendorOf = (id: string) => w.vendors.find((v) => v.id === id)!;
describe("email intake", () => {
  it("flags the injected email and extracts the bank details as data", () => {
    const inv = w.invoices.find((i) => i.tag === "injection")!;
    const r = readInvoiceEmail(inv, vendorOf(inv.vendorId));
    expect(r.flags).toEqual(expect.arrayContaining(["INJECTION", "BANK_CHANGE_IN_EMAIL", "URGENCY", "DISCOURAGES_CALLBACK", "SENDER_MISMATCH"]));
    expect(r.bankChange).toEqual({ accountNo: w.storyAccounts.fraud.accountNo, ifsc: w.storyAccounts.fraud.ifsc, holderClaimed: "R K Enterprises" });
  });
  it("leaves ordinary emails clean", () => {
    for (const inv of w.invoices.filter((i) => !i.tag)) expect(readInvoiceEmail(inv, vendorOf(inv.vendorId)).flags).toEqual([]);
  });
  it("finds exact and likely duplicates", () => {
    const orig = w.invoices.find((i) => i.tag === "dup_original")!;
    expect(findDuplicate(w.invoices.find((i) => i.tag === "dup_exact")!, [orig])?.kind).toBe("exact");
    expect(findDuplicate(w.invoices.find((i) => i.tag === "dup_fuzzy")!, [orig])?.kind).toBe("likely");
    expect(findDuplicate(orig, w.invoices.filter((i) => !i.tag))).toBeNull();
  });
});
