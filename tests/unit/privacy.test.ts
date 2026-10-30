import { describe, expect, it } from "vitest";
import { describeMasked, mask, piiIn, tokensIn, unmask, Vault, type PiiType } from "@/lib/privacy/mask";

// [input, types that must be masked (in any order), values that must not survive]
const CASES: [string, PiiType[], string[]][] = [
  ["mera number 9876543210 hai", ["PHONE"], ["9876543210"]],
  ["call me on +91 98765 43210", ["PHONE"], ["98765 43210"]],
  ["+91-98765-43210 pe call karo", ["PHONE"], ["98765-43210"]],
  ["phone 09876543210", ["PHONE"], ["9876543210"]],
  ["919876543210 is mine", ["PHONE"], ["9876543210"]],
  ["987-654-3210", ["PHONE"], ["654-3210"]],
  ["मेरा नंबर ९८७६५४३२१० है", ["PHONE"], ["९८७६५४३२१०"]],
  ["pay to rahul.m@okaxis please", ["UPI"], ["rahul.m@okaxis"]],
  ["meri UPI id 9876543210@paytm hai", ["UPI"], ["9876543210@paytm"]],
  ["mail me at rahul.mehra@example.com", ["EMAIL"], ["rahul.mehra@example.com"]],
  ["account number 123456789012 hai", ["ACCOUNT"], ["123456789012"]],
  ["a/c no: 50100234567891", ["ACCOUNT"], ["50100234567891"]],
  ["mera khata 001234567890 SBI mein", ["ACCOUNT"], ["001234567890"]],
  ["मेरा खाता 123456789012 है", ["ACCOUNT"], ["123456789012"]],
  ["IFSC HDFC0001234", ["IFSC"], ["HDFC0001234"]],
  ["ifsc sbin0004567 hai", ["IFSC"], ["sbin0004567"]],
  ["PAN ABCDE1234F", ["PAN"], ["ABCDE1234F"]],
  ["aadhaar 2345 6789 0123", ["AADHAAR"], ["2345 6789 0123"]],
  ["mera aadhar 234567890123 hai", ["AADHAAR"], ["234567890123"]],
  ["card 4111 1111 1111 1111 se kata", ["CARD"], ["4111 1111 1111 1111"]],
  ["5500-0000-0000-0004 is my card", ["CARD"], ["5500-0000-0000-0004"]],
  ["OTP 482913 aaya", ["SECRET"], ["482913"]],
  ["my upi pin is 1234", ["SECRET"], ["1234"]],
  ["482913 is your OTP", ["SECRET"], ["482913"]],
  ["ओटीपी 4821 है", ["SECRET"], ["4821"]],
  ["password: 123456", ["SECRET"], ["123456"]],
  ["Sunita Verma here, why was I charged?", ["NAME"], ["Sunita", "Verma"]],
  ["sunita ji ka paisa", ["NAME"], ["sunita"]],
  // Negatives: kept as they are.
  ["₹599 kyun kata?", [], []],
  ["Rs. 1,59,334 refund chahiye", [], []],
  ["case PAK-2311 ka kya hua", [], []],
  ["1930 pe call karein", [], []],
  ["charge after 9:30 PM on 28 Oct", [], []],
  ["2026-10-28T16:00:00.000Z", [], []],
  ["VidyaKosh ne 599 kaat liye", [], []],
  ["5 din pehle 2 baar kata", [], []],
  ["12345 is not a phone", [], []],
  ["Sitara Media Pvt Ltd kaun hai", [], []],
];

describe("PII masking", () => {
  it.each(CASES)("%s", (text, types, gone) => {
    const { masked, vault } = mask(text, { names: ["Sunita Verma"] });
    expect(Object.keys(vault.counts()).sort()).toEqual([...types].sort());
    for (const g of gone) expect(masked).not.toContain(g);
    if (!types.length) expect(masked).toBe(text);
  });

  it("gives the same value the same token, and different values different tokens", () => {
    const { masked } = mask("9876543210 aur +91 98765 43210 aur 9123456789");
    expect(masked).toBe("<PHONE_1> aur <PHONE_1> aur <PHONE_2>");
  });

  it("round-trips everything except secrets", () => {
    const texts = CASES.map(([t]) => t).filter((t) => !piiIn(t).includes("SECRET"));
    for (const t of texts) {
      const { masked, vault } = mask(t, { names: ["Sunita Verma"] });
      expect(unmask(masked, vault)).toBe(t);
    }
  });

  it("never unmasks an OTP or PIN", () => {
    const { masked, vault } = mask("OTP 482913, pin 1234");
    const back = unmask(masked, vault);
    expect(back).not.toContain("482913");
    expect(back).not.toContain("1234");
    expect(back).toContain("••••");
  });

  it("masks inside objects and keeps keys and numbers", () => {
    const { masked, vault } = mask({ text: "call 9876543210", amount_rupees: 599, list: ["a@okhdfc"] });
    expect(masked).toEqual({ text: "call <PHONE_1>", amount_rupees: 599, list: ["<UPI_1>"] });
    expect(unmask(masked, vault)).toEqual({ text: "call 9876543210", amount_rupees: 599, list: ["a@okhdfc"] });
  });

  it("keeps brand and registered names given as keep words", () => {
    const { masked } = mask("PADHO0AI12 is a brand", { keep: ["PADHO0AI12"] });
    expect(masked).toBe("PADHO0AI12 is a brand");
  });

  it("serialises the vault as counts only", () => {
    const { vault } = mask("call 9876543210 or a@okaxis");
    const json = JSON.stringify({ vault });
    expect(json).not.toContain("9876543210");
    expect(json).not.toContain("okaxis");
    expect(json).toContain("PHONE");
    expect(String(vault)).not.toContain("9876");
  });

  it("describes what was masked without values", () => {
    const { vault } = mask("call 9876543210 or pay a@okaxis");
    expect(describeMasked(vault.counts())).toBe("2 masked: phone, UPI ID");
    expect(describeMasked({})).toBe("Nothing personal to mask");
  });

  it("finds tokens and leaves unknown ones for the caller to reject", () => {
    const v = new Vault();
    expect(tokensIn("hi <NAME_1>, call <PHONE_3>")).toEqual([{ token: "<NAME_1>", type: "NAME" }, { token: "<PHONE_3>", type: "PHONE" }]);
    expect(unmask("<PHONE_3>", v)).toBe("<PHONE_3>");
  });
});
