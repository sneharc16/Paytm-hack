import { expect, test } from "@playwright/test";

// PRD 29.3: play the stage demo in local mode and check the final counters.
test("the three minute story ends on the PRD numbers", async ({ page, context }) => {
  const session = `E2E-${Date.now() % 100000}`;
  await page.goto(`/demo?grid=1&session=${session}`);
  await expect(page.getByText("The 3 minute story")).toBeVisible();

  // 8:55 PM -> 8:58 PM -> 9:06 PM -> 9:10 PM
  for (const step of ["Review Radar catches 46 complaints", "PadhoAI is told privately", "Pakka sweeps 1,300 mandates"]) {
    await page.getByRole("button", { name: "Next moment" }).click();
    await expect(page.getByText(step)).toBeVisible({ timeout: 15_000 });
  }

  // Sunita skips this month on the phone. No PIN.
  const phone = page.locator("main").first();
  await phone.getByRole("button", { name: "अभी देखें" }).click();
  await expect(page.getByRole("dialog")).toContainText("PadhoAI");
  await page.getByText("इस महीने स्किप करो").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "इस महीने स्किप करो" }).click();
  await expect(page.getByRole("dialog")).toContainText("हो गया।");
  await page.getByRole("button", { name: "ठीक है" }).click();

  // Rahul, in another tab of the same browser: jump to 28 Oct 6:05 PM, the retry waits for 9:30 PM.
  for (const at of ["9:30 PM", "11:40 PM", "6:05 PM"]) {
    await page.getByRole("button", { name: "Next moment" }).click();
    await expect(page.locator("header").getByText(at, { exact: true })).toBeVisible({ timeout: 15_000 });
  }
  const rahul = await context.newPage();
  await rahul.goto(`/app?session=${session}&persona=rahul`);
  await rahul.getByRole("button", { name: /^StadiumPass/ }).click();
  await expect(rahul.getByText("Shaam 5 se raat 9:30 tak AutoPay nahi chalta")).toBeVisible();

  // Jump to the end of the night.
  await page.getByRole("button", { name: "6. A person steps in" }).click();
  await expect(page.locator("header").getByText("6:00 AM", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Counters" }).click();
  await expect(page.getByText("₹1,59,334")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("₹55,016")).toBeVisible();
  await expect(page.getByText("₹12,579").first()).toBeVisible();
  const zero = page.getByText("Money moved without a rule", { exact: true }).locator("..");
  await expect(zero.locator("div").first()).toHaveText("0");
});
