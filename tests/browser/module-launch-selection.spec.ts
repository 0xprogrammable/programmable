import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Local executable browser fixture with no wallet or RPC calls.
import { createModuleLaunchSelectionServer } from "./fixtures/module-launch-selection-server.mjs";

let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createModuleLaunchSelectionServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { if (server) { server.close(); await once(server, "close"); } });

for (const width of [1440, 390, 320]) {
  test(`selection explains fees, keeps button size, and restores settings at ${width}px`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width, height: 900 }); await page.goto(origin);
    const summary = page.getByRole("complementary");
    await expect(summary).toContainText("Includes the 0.10% platform fee.");
    const trigger = page.getByRole("button", { name: "Add modules", exact: true });
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog"), card = dialog.getByRole("article");
    await expect(dialog.getByText("Estimated platform fee: 0.30% per trade.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("searchbox")).toBeHidden();
    await expect(card).toHaveCount(1);
    const add = dialog.getByRole("button", { name: "Add Opening buy cap", exact: true });
    const before = await add.boundingBox(), cardBefore = await card.boundingBox();
    expect(before!.height).toBeGreaterThanOrEqual(44);
    await add.press("Enter");
    const remove = dialog.getByRole("button", { name: "Remove Opening buy cap", exact: true });
    await expect(remove).toHaveText("Remove"); await expect(remove).toHaveAttribute("aria-pressed", "true");
    const after = await remove.boundingBox(), cardAfter = await card.boundingBox();
    expect(after!.width).toBeCloseTo(before!.width, 0); expect(after!.height).toBeCloseTo(before!.height, 0);
    expect(cardAfter!.height).toBeCloseTo(cardBefore!.height, 0);
    await page.screenshot({ path: testInfo.outputPath(`selection-${width}.png`) });
    await remove.press("Enter"); await expect(add).toHaveText("Add"); await add.press("Enter");
    await dialog.getByRole("button", { name: "Done", exact: true }).press("Enter");
    await expect(trigger).toBeFocused();
    await expect(summary).toContainText("Includes the 0.30% platform fee.");
    const configure = page.getByRole("button", { name: "Configure Opening buy cap", exact: true });
    await configure.press("Enter");
    await dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true }).fill("0.25");
    await page.keyboard.press("Escape"); await expect(configure).toBeFocused();
    await page.getByRole("button", { name: "Remove Opening buy cap", exact: true }).press("Enter");
    await expect(summary).toContainText("Includes the 0.10% platform fee.");
    await page.getByRole("button", { name: "Undo", exact: true }).press("Enter");
    await expect(configure).toBeFocused(); await configure.press("Enter");
    await expect(dialog.getByLabel("Maximum ETH per wallet (ETH)", { exact: true })).toHaveValue("0.25");
    await page.screenshot({ path: testInfo.outputPath(`configuration-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "reduce" }); await trigger.click();
    expect(await dialog.evaluate(element => element.getAnimations().length)).toBe(0);
    await dialog.getByRole("button", { name: "Done", exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("empty and single-template libraries keep irrelevant controls out of the flow", async ({ page }) => {
  await page.goto(`${origin}?mode=empty`); await page.getByRole("button", { name: "Add modules", exact: true }).click();
  await expect(page.getByText("No modules available yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toHaveCount(0);
  await page.goto(`${origin}?mode=engine`);
  await expect(page.getByRole("button", { name: "Choose module Timed escrow", exact: true })).toBeVisible();
  await expect(page.getByRole("searchbox")).toBeHidden(); await expect(page.getByRole("combobox")).toBeHidden();
  await page.goto(`${origin}?mode=unknown`); await page.getByRole("button", { name: "Add modules", exact: true }).click();
  await expect(page.getByText("Platform fee unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).not.toContainText("0.30%");
});
