import { expect, test } from "@playwright/test";

test("demo mode produces closable cinematic outcome", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "RUN DEMO" }).click();

  await expect(page.getByText("DEMO SCRIPT")).toBeVisible();
  await expect(page.getByText("SYSTEM VERDICT")).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Close outcome overlay" }).click();
  await expect(page.getByText("SYSTEM VERDICT")).not.toBeVisible();
});

test("simulation mode runs and reports simulation badge", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "SIMULATION" }).click();
  await page.getByRole("button", { name: "INITIATE CLASH" }).click();

  await expect(page.locator(".status-chip")).toContainText("SIMULATION");
  await expect(page.getByText(/Match started in SIMULATION mode/i)).toBeVisible({ timeout: 12_000 });
});

test("live-ai without key falls back to simulation visibly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "LIVE AI" }).click();
  await page.getByRole("button", { name: "INITIATE CLASH" }).click();

  await expect(page.getByText("FALLBACK SIMULATION")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".warning-chip")).toContainText(/LIVE AI unavailable|Fallback warning:/i, { timeout: 15_000 });
});
