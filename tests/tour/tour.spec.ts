// The whole-product tour: every screen, the consumer live flow and the business live flow, driven in real Chrome
// against a running dev server, with a screenshot of each step and a results file the test report is built from.
//
//   pnpm b2b:live-demo http://localhost:3001      a sealed company with people and agents (once)
//   pnpm tour                                     this file; screenshots in docs/test-report/screens
//
// Passkeys are real WebAuthn ceremonies against Chrome's virtual authenticator (CDP WebAuthn domain). For the
// demo company's people, their software passkeys are loaded into it, so they sign in exactly as on a phone.
import { execFileSync } from "node:child_process";
import { createECDH, createHash, createPrivateKey } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs/test-report/screens");
const RESULTS = path.join(ROOT, "docs/test-report/results.json");
const PY = path.join(ROOT, "sdk/python");
const demo = JSON.parse(readFileSync(path.join(ROOT, ".pakka-data/demo-people.json"), "utf8")) as { orgId: string; vendorId: string; vendorGstin: string; members: Record<string, { name: string; id: string; seed: string }> };

type Row = { id: string; area: string; title: string; status: "pass" | "fail"; note: string; shot: string | null; ms: number };
const rows: Row[] = [];
let n = 0;

async function step(page: Page, area: string, title: string, fn: () => Promise<string | void>) {
  const id = String(++n).padStart(2, "0");
  const slug = `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50)}`;
  const t0 = Date.now();
  let status: Row["status"] = "pass", note = "";
  try { note = (await fn()) ?? ""; } catch (e) { status = "fail"; note = String((e as Error).message ?? e).split("\n").slice(0, 3).join(" ").slice(0, 300); }
  let shot: string | null = `screens/${slug}.png`;
  try { await page.screenshot({ path: path.join(OUT, `${slug}.png`), fullPage: false }); } catch { shot = null; }
  rows.push({ id, area, title, status, note, shot, ms: Date.now() - t0 });
  writeFileSync(RESULTS, JSON.stringify({ at: new Date().toISOString(), base: test.info().project.use.baseURL, rows }, null, 2));
}

const b64 = (b: Buffer) => b.toString("base64");
const b64u = (b: Buffer) => b.toString("base64url");
const sha = (s: string) => createHash("sha256").update(s).digest();

/** A context whose Chrome has a virtual platform authenticator, optionally holding one person's passkey. */
async function withAuthenticator(ctx: BrowserContext, page: Page, person?: { seed: string; handle: string }) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  if (person) {
    // The same key SoftPasskey(seed) derives: secret = sha256("soft-passkey|seed"), id = sha256("cred|seed")[0..16].
    const d = sha(`soft-passkey|${person.seed}`);
    const ecdh = createECDH("prime256v1"); ecdh.setPrivateKey(d);
    const pub = ecdh.getPublicKey();
    const pkcs8 = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)) }, format: "jwk" }).export({ type: "pkcs8", format: "der" });
    await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: { credentialId: b64(sha(`cred|${person.seed}`).subarray(0, 16)), isResidentCredential: true, rpId: "localhost", privateKey: b64(pkcs8 as Buffer), userHandle: b64(Buffer.from(person.handle)), signCount: 10_000 } });
  }
  return { cdp, authenticatorId };
}

const consoleErrors = new Map<Page, string[]>();
function watch(page: Page) {
  const errs: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Download the React DevTools|\[HMR\]|webpack-hmr|net::ERR_ABORTED|status of 401/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message.slice(0, 200)}`));
  consoleErrors.set(page, errs);
  return errs;
}
const noErrors = (page: Page) => { const e = consoleErrors.get(page) ?? []; const got = e.splice(0); return got.length ? `console: ${got.join(" | ")}` : ""; };

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { mkdirSync(OUT, { recursive: true }); });

// ---------------------------------------------------------------- 1. every public screen
test("every public screen renders", async ({ page }) => {
  watch(page);
  const screens: [string, string, RegExp][] = [
    ["/", "Home and hub", /Pakka/],
    ["/app", "Consumer app (demo world)", /AutoPay|Pakka/],
    ["/demo", "Stage demo", /Demo view/],
    ["/merchant", "Merchant console", /Pakka|merchant|Merchant/],
    ["/ops", "Ops console", /Pakka|Ops|ops/],
    ["/ops/radar", "Ops: review radar", /Radar|radar|Pakka/],
    ["/ops/cases", "Ops: cases", /Case|case|Pakka/],
    ["/ops/audit", "Ops: audit", /Audit|audit|Pakka/],
    ["/business", "Pakka for Business simulation", /Pakka|Business|business/],
    ["/business/live", "Business live: welcome", /Create a company/],
    ["/live", "Consumer live: welcome", /Pakka/],
  ];
  for (const [url, title, re] of screens) {
    await step(page, "Screens", title, async () => {
      const res = await page.goto(url, { waitUntil: "domcontentloaded" });
      expect(res?.status(), `HTTP status for ${url}`).toBeLessThan(400);
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await expect(page.locator("body")).toContainText(re, { timeout: 20_000 });
      await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error|This page could not be found/);
      return [`HTTP ${res?.status()}`, noErrors(page)].filter(Boolean).join("; ");
    });
  }
});

// ---------------------------------------------------------------- 2. consumer live
test("consumer live: passkey sign-up, SMS, reminder, pause with passkey", async ({ browser }) => {
  test.setTimeout(6 * 60_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  watch(page);
  await withAuthenticator(ctx, page);
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const [y, m, d] = today.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  await step(page, "Consumer live", "Sign up with a passkey", async () => {
    await page.goto("/live");
    await page.getByLabel(/Aapka naam/).or(page.getByPlaceholder(/naam/i)).first().fill("Asha Tour");
    await page.getByRole("button", { name: "Passkey se account banaiye" }).click();
    await expect(page.getByText("Namaste Asha")).toBeVisible({ timeout: 20_000 });
    return noErrors(page);
  });
  await step(page, "Consumer live", "Paste a bank SMS and let Pakka read it", async () => {
    await page.getByRole("button", { name: /AutoPay jodiye/ }).first().click();
    await page.getByRole("textbox").filter({ hasText: "" }).last().waitFor();
    await page.locator("textarea").fill(`Dear Customer, your UPI AutoPay mandate for StreamKaro of Rs 299.00 per month is set up. Next debit on ${d}-${months[Number(m) - 1]}-${y}. -Bank`);
    await page.getByRole("button", { name: "SMS padhiye" }).click();
    await expect(page.getByText(/SMS se bhara hai/)).toBeVisible({ timeout: 30_000 });
    // A ₹2 trial that turns into ₹299: the risk model asks the person before the first real charge.
    await page.getByLabel("Abhi trial chal raha hai").check();
    await page.getByLabel(/Trial ki rakam/).fill("2");
    await page.getByLabel(/Trial kab shuru hua/).fill(new Date(Date.now() - 6 * 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10));
    return noErrors(page);
  });
  await step(page, "Consumer live", "Add the AutoPay", async () => {
    await page.getByRole("button", { name: "Jodiye", exact: true }).click();
    await expect(page.getByText("StreamKaro").first()).toBeVisible({ timeout: 20_000 });
    return noErrors(page);
  });
  await step(page, "Consumer live", "Reminder arrives, written live", async () => {
    // The notice is due a minute after the AutoPay is added; the page polls the server.
    await expect(page.getByText(/Pakka ke sandesh/)).toBeVisible({ timeout: 150_000 });
    const by = await page.getByText(/Sarvam ne aapki bhasha mein likha|Pakka ka tay sandesh/).first().textContent().catch(() => null);
    return [by ? `label: ${by}` : "", noErrors(page)].filter(Boolean).join("; ");
  });
  await step(page, "Consumer live", "Open the decision sheet", async () => {
    await page.getByRole("button", { name: "Abhi dekhein" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    return noErrors(page);
  });
  await step(page, "Consumer live", "Choose pause: Pakka asks for the passkey", async () => {
    const dlg = page.getByRole("dialog");
    await dlg.getByText("Pause karo", { exact: true }).first().click();
    await dlg.getByRole("button", { name: /Pause karo/ }).last().click();
    await expect(page.getByRole("button", { name: "Passkey se pakka kijiye" })).toBeVisible({ timeout: 10_000 });
    return noErrors(page);
  });
  await step(page, "Consumer live", "Confirm with the passkey: AutoPay paused", async () => {
    await page.getByRole("button", { name: "Passkey se pakka kijiye" }).click();
    await expect(page.getByText(/AutoPay ruk gaya/)).toBeVisible({ timeout: 30_000 });
    return noErrors(page);
  });
  await step(page, "Consumer live", "What Pakka did, after the pause", async () => {
    const ok = page.getByRole("button", { name: /Theek hai|ठीक है|OK/ });
    if (await ok.isVisible().catch(() => false)) await ok.click();
    await page.getByText(/Pakka ne kya kiya/).first().scrollIntoViewIfNeeded();
    return noErrors(page);
  });
  await ctx.close();
});

// ---------------------------------------------------------------- 3. business live: a company and an API key, from scratch
test("business live: create a company and an agent API key in the UI, then use it from Python", async ({ browser }) => {
  test.setTimeout(4 * 60_000);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  await withAuthenticator(ctx, page);
  const keyDir = path.join("/tmp", `pakka-tour-${Date.now()}`);
  mkdirSync(keyDir, { recursive: true });
  const keygen = execFileSync("python3", [path.join(PY, "pakka_business.py"), "keygen", "tour-payables"], { cwd: keyDir }).toString();
  const publicKey = keygen.trim().split("\n").pop()!.trim();

  await step(page, "API key", "Create a company with a passkey", async () => {
    await page.goto("/business/live");
    const f = async (label: string, v: string) => page.getByLabel(label, { exact: true }).fill(v);
    await f("Legal name", "Tarang Traders Pvt Ltd"); await f("Short name", "Tarang"); await f("GSTIN", "29AAHCT4455K1ZS"); await f("City", "Bengaluru");
    await f("Your name", "Ira Tour"); await f("Your title", "Chief financial officer"); await f("Your work email", "ira@tarang.example");
    await page.getByRole("button", { name: "Create and register my passkey" }).click();
    await expect(page.getByText("Setup not sealed: no payouts yet")).toBeVisible({ timeout: 20_000 });
    return noErrors(page);
  });
  await step(page, "API key", "Open People and agents", async () => {
    await page.getByRole("button", { name: "People and agents" }).first().click();
    await expect(page.getByText("Register an agent")).toBeVisible();
    await page.getByText("Register an agent").scrollIntoViewIfNeeded();
    return noErrors(page);
  });
  await step(page, "API key", "Fill in the agent and its public key", async () => {
    await page.getByPlaceholder("Name").last().fill("Payables agent");
    await page.locator("select").filter({ hasText: "Payables (proposer)" }).selectOption("proposer");
    await page.getByPlaceholder(/Model and version/).fill("tarang-ap-proposer-v1");
    await page.getByPlaceholder(/Public key/).fill(publicKey);
    return `public key ${publicKey.slice(0, 16)}...`;
  });
  let apiKey = "";
  await step(page, "API key", "Sign with a passkey: the API key is shown once", async () => {
    await page.getByRole("button", { name: "Sign and register" }).click();
    const box = page.getByText(/^pk_[a-z0-9]+_/).first();
    await expect(box).toBeVisible({ timeout: 20_000 });
    apiKey = (await box.textContent())!.trim();
    await box.scrollIntoViewIfNeeded();
    return `API key ${apiKey.slice(0, 16)}... (${apiKey.length} chars)`;
  });
  await step(page, "API key", "Python client connects with the new key", async () => {
    expect(apiKey).toMatch(/^pk_[a-z0-9]+_[A-Za-z0-9_-]{20,}$/);
    const out = execFileSync("python3", [path.join(PY, "pakka_business.py"), "set-key", path.join(keyDir, "tour-payables.key.json"), apiKey, test.info().project.use.baseURL!], { cwd: PY }).toString().trim();
    expect(out).toContain("Connected as Payables agent (proposer) at Tarang");
    await page.getByRole("button", { name: "Agent API" }).first().click();
    return out;
  });
  await ctx.close();
});

// ---------------------------------------------------------------- 4. business live: people at work on the demo company
test("business live: a maker clears phishing, Python agents raise a payout, a checker approves it", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const as = async (who: string) => {
    const m = demo.members[who];
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page);
    await withAuthenticator(ctx, page, { seed: m.seed, handle: `${demo.orgId}:${m.id}` });
    await page.goto("/business/live");
    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page.getByText(`${m.name},`)).toBeVisible({ timeout: 20_000 });
    return { ctx, page };
  };
  const nav = (page: Page, label: string) => page.getByRole("navigation").getByRole("button", { name: label }).click();

  const meera = await as("meera");
  await step(meera.page, "Business live", "Governor signs in with a passkey: overview", async () => { await nav(meera.page, "Overview"); return noErrors(meera.page); });
  await step(meera.page, "Business live", "Payables", async () => { await nav(meera.page, "Payables"); return noErrors(meera.page); });
  await step(meera.page, "Business live", "Ledger: hash chained", async () => { await nav(meera.page, "Ledger"); return noErrors(meera.page); });
  await step(meera.page, "Business live", "Policy and keys", async () => { await nav(meera.page, "Policy and keys"); return noErrors(meera.page); });
  await step(meera.page, "Business live", "Audit export", async () => { await nav(meera.page, "Audit export"); return noErrors(meera.page); });
  await step(meera.page, "Business live", "Red team: attacks on a copy of the real ledger", async () => {
    await nav(meera.page, "Red team");
    await meera.page.getByRole("button", { name: "Run the attacks" }).click();
    await expect(meera.page.getByText("Defended").first()).toBeVisible({ timeout: 60_000 });
    await meera.page.waitForTimeout(1500);
    const text = await meera.page.locator("main").innerText();
    const [, attacks, through, skipped] = /Attacks\s+(\d+)\s+Got through\s+(\d+)\s+Skipped[^\d]*(\d+)/.exec(text) ?? [];
    const defended = await meera.page.getByText("Defended", { exact: true }).count();
    expect(Number(through), "attacks that got through").toBe(0);
    expect(defended + Number(skipped)).toBe(Number(attacks));
    return `${attacks} attacks: ${defended} defended, ${through} got through, ${skipped} skipped`;
  });
  await step(meera.page, "Business live", "People and agents", async () => { await nav(meera.page, "People and agents"); return noErrors(meera.page); });
  await step(meera.page, "Business live", "Agent API page", async () => { await nav(meera.page, "Agent API"); return noErrors(meera.page); });
  await meera.ctx.close();

  let phishOut = "";
  const neha = await as("neha");
  await step(neha.page, "Business live", "Python agents send a phishing invoice: guard holds it", async () => {
    phishOut = execFileSync("python3", ["example_payout.py", "--keys", path.join(ROOT, ".pakka-agents"), "--vendor", demo.vendorId, "--gstin", demo.vendorGstin, "--phish"], { cwd: PY }).toString();
    expect(phishOut).toContain("blocked: NO_OPEN_BANK_CHANGE");
    return phishOut.trim().split("\n").filter((l) => /flags|risk|blocked/.test(l)).join(" / ");
  });
  await step(neha.page, "Business live", "Maker sees bank changes the phishing emails asked for", async () => {
    await neha.page.reload();
    await nav(neha.page, "Vendors and banks");
    await expect(neha.page.getByRole("button", { name: "Vendor never asked" }).first()).toBeVisible({ timeout: 10_000 });
    return `${await neha.page.getByRole("button", { name: "Vendor never asked" }).count()} open requests`;
  });
  await step(neha.page, "Business live", "Maker calls the number on file: vendor never asked", async () => {
    for (let i = 0; i < 12; i++) {
      const b = neha.page.getByRole("button", { name: "Vendor never asked" }).first();
      if (!(await b.isVisible().catch(() => false))) break;
      await b.click();
      await neha.page.waitForTimeout(1200);
    }
    await expect(neha.page.getByRole("button", { name: "Vendor never asked" })).toHaveCount(0, { timeout: 15_000 });
    return noErrors(neha.page);
  });
  await neha.ctx.close();

  let pyOut = "";
  const arjun = await as("arjun");
  await step(arjun.page, "Business live", "Python agents raise a payout that needs a checker", async () => {
    pyOut = execFileSync("python3", ["example_payout.py", "--keys", path.join(ROOT, ".pakka-agents"), "--vendor", demo.vendorId, "--gstin", demo.vendorGstin], { cwd: PY }).toString();
    expect(pyOut).toContain("awaiting_approval");
    await nav(arjun.page, "Approvals");
    await expect(arjun.page.getByRole("button", { name: "Approve as checker" }).first()).toBeVisible({ timeout: 20_000 });
    return pyOut.trim().split("\n").slice(-3).join(" / ");
  });
  await step(arjun.page, "Business live", "Checker approves with a passkey: guard releases the payout", async () => {
    // Approve the payout the Python agents just raised (not some other one in the queue).
    const prefix = /Intent ([0-9a-f]{12}): awaiting_approval/.exec(pyOut)![1];
    const number = /invoice (INV-[0-9A-F]+) /.exec(pyOut)![1];
    const approve = arjun.page.getByRole("button", { name: "Approve as checker" });
    const card = arjun.page.locator("div").filter({ hasText: number }).filter({ has: approve }).last();
    await card.getByRole("button", { name: "Approve as checker" }).click();
    await expect(arjun.page.getByText("Approved with your passkey")).toBeVisible({ timeout: 20_000 });
    await arjun.page.waitForTimeout(1500);
    const status = execFileSync("python3", ["-c", `from pakka_business import PakkaAgent
a = PakkaAgent.from_file(${JSON.stringify(path.join(ROOT, ".pakka-agents/payables.json"))})
h = [e["payload"]["intentHash"] for e in a.events(0)["events"] if e["type"] == "intent_proposed" and e["payload"]["intentHash"].startswith("${prefix}")][0]
v = a.intent(h); print(v["status"], v["utr"], ",".join(c["code"] for c in v["checks"] if not c.get("ok")))`], { cwd: PY }).toString().trim();
    await nav(arjun.page, "Overview");
    // Settled; or, when the tour runs again on the same day, deferred by the vendor's daily payout count.
    expect(status).toMatch(/^(settled|sent|pending) |^deferred None VELOCITY$/);
    return `intent ${prefix}: ${status}; ${noErrors(arjun.page)}`;
  });
  await step(arjun.page, "Business live", "Real invoice from the phishing email waits for a checker (PRD 3)", async () => {
    // The callback exposed the fake bank details, not a fake invoice: the goods arrived, so it is owed. It goes to
    // a checker with every flag shown, and pays only the account on file.
    const number = /invoice (INV-[0-9A-F]+) /.exec(phishOut)![1];
    await nav(arjun.page, "Approvals");
    const card = arjun.page.locator("div").filter({ hasText: number }).filter({ has: arjun.page.getByRole("button", { name: "Approve as checker" }) }).last();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("The account on file");
    await expect(card).toContainText("BANK_CHANGE_IN_EMAIL");
    await card.scrollIntoViewIfNeeded();
    return `${number} waits for the checker, flags shown, payee is the account on file`;
  });
  await step(arjun.page, "Business live", "Ledger after the payout", async () => { await nav(arjun.page, "Ledger"); return noErrors(arjun.page); });
  await arjun.ctx.close();
});
