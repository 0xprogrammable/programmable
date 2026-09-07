import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Local executable fixture with the real Console, client lifecycle and recovery store.
import { createModuleEngineFeeControlsServer } from "./fixtures/module-engine-fee-controls-server.mjs";
let server: Server, origin: string;
const newWallet = "0x" + "a".repeat(40);
test.beforeAll(async () => { server = await createModuleEngineFeeControlsServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture failed"); origin = "http://127.0.0.1:" + address.port; });
test.afterAll(async () => { server.close(); await once(server, "close"); });
for (const width of [1440, 390, 320]) {
  test("creator and author recipient changes by keyboard at " + width + "px", async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 }); await page.goto(origin);
    await page.getByRole("button", { name: "Refresh balances", exact: true }).click();
    await page.getByRole("button", { name: "Load fee recipients" }).click();
    const section = page.getByRole("region", { name: "Fee recipients", exact: true });
    await expect(section.getByRole("heading", { name: "Author fee wallets" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("recipients-full-" + width + ".png"), fullPage: true });
    const change = section.getByText("Change my creator fee wallet", { exact: true }); await change.focus(); await page.keyboard.press("Enter");
    const input = section.getByRole("textbox", { name: "New creator fee wallet" }); await input.fill("invalid"); await input.press("Enter");
    await expect(section.getByRole("alert")).toContainText("valid nonzero"); await expect(input).toBeFocused(); await input.fill(newWallet);
    await page.keyboard.press("Tab"); const review = section.getByRole("button", { name: "Review wallet change", exact: true }); await expect(review).toBeFocused();
    expect(await review.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none"); expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter"); await expect(page.getByRole("heading", { name: "Review creator fee recipients" })).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("creator-review-" + width + ".png"), fullPage: true });
    await page.getByRole("button", { name: "Back to edit" }).click(); await expect(review).toBeFocused(); await page.keyboard.press("Enter");
    const confirm = page.getByRole("button", { name: "Confirm in wallet" }); await confirm.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Confirmed fee recipients" })).toContainText(newWallet);
    await expect(page.getByLabel("Test wallet calls")).toHaveText("Wallet calls: 1");
    await page.getByRole("button", { name: "Refresh balances", exact: true }).click(); await page.getByRole("button", { name: "Load fee recipients" }).click();
    await section.getByText("Change my author fee wallet", { exact: true }).click(); await section.getByRole("textbox", { name: "New author fee wallet" }).fill(newWallet);
    await section.getByRole("button", { name: "Review wallet change", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review author fee wallet" })).toBeFocused(); await expect(page.getByText(/whole family across all coins/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("author-review-" + width + ".png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 390) { await page.evaluate(() => { document.documentElement.style.zoom = "2"; }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: testInfo.outputPath("author-review-zoom.png"), fullPage: true }); }
    expect(errors).toEqual([]);
  });
  test("administrator replacement shows fixed shares and actual authority at " + width + "px", async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 }); await page.goto(origin + "?role=admin");
    await page.getByRole("button", { name: "Refresh balances", exact: true }).click(); await page.getByRole("button", { name: "Load fee recipients" }).click();
    const section = page.getByRole("region", { name: "Fee recipients", exact: true });
    await expect(section.getByText("Change my creator fee wallet", { exact: true })).toHaveCount(0);
    await expect(section.getByText("Change my author fee wallet", { exact: true })).toHaveCount(0);
    await section.getByText("Replace creator fee recipients", { exact: true }).click();
    await section.getByRole("textbox", { name: "New recipient 1 · 60%" }).fill(newWallet);
    await section.getByRole("button", { name: "Review wallet change", exact: true }).click();
    await expect(page.getByText("Ledger reward administrator", { exact: true })).toBeVisible(); await expect(page.getByText(/onchain deadline and administrative revision/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("admin-review-" + width + ".png"), fullPage: true });
    await page.getByRole("button", { name: "Confirm in wallet" }).click(); await expect(page.getByRole("region", { name: "Confirmed fee recipients" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
test("uncertain recipient request remains locked after reload", async ({ page }) => {
  await page.goto(origin); await page.getByLabel("Test wallet response").selectOption("uncertain");
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click(); await page.getByRole("button", { name: "Load fee recipients" }).click();
  const section = page.getByRole("region", { name: "Fee recipients", exact: true }); await section.getByText("Change my creator fee wallet", { exact: true }).click(); await section.getByRole("textbox", { name: "New creator fee wallet" }).fill(newWallet); await section.getByRole("button", { name: "Review wallet change" }).click();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("alert")).toContainText("uncertain"); await expect(page.getByRole("button", { name: "Confirm in wallet" })).toBeDisabled();
  await expect(page.getByLabel("Test wallet calls")).toHaveText("Wallet calls: 1"); await page.reload();
  await expect(page.getByText("The saved wallet operation is still pending.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Refresh balances", exact: true }).click(); await expect(page.getByRole("button", { name: "Load fee recipients" })).toBeDisabled();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("programmable:module-operation:")).length)).toBe(1);
});
