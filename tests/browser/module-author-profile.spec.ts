import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error This fixture host is also executable for manual browser QA.
import { createModuleAuthorProfileServer } from "./fixtures/module-author-profile-server.mjs";

declare global { interface Window { __moduleAuthorProfileFixture: { status: "ready" | "partial"; empty: boolean; fail: boolean } } }
let server: Server; let origin: string;
test.beforeAll(async () => { server = await createModuleAuthorProfileServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start"); origin = `http://127.0.0.1:${address.port}`; });
test.afterAll(async () => { server.close(); await once(server, "close"); });

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`historical versions remain readable and keyboard selectable at ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("console", entry => { if (entry.type() === "error") errors.push(entry.text()); });
    await page.setViewportSize(viewport); await page.goto(origin);
    await expect(page.getByRole("status")).toHaveText("Some module versions are unavailable. Showing verified publications.");
    await expect(page.getByRole("heading", { name: "Modules 2+", exact: true })).toBeVisible();
    const previous = page.getByRole("button", { name: "View module Opening rules, version 1.0.0", exact: true });
    const current = page.getByRole("button", { name: "View module Opening rules, version 2.0.0", exact: true });
    await expect(previous).toBeVisible(); await expect(current).toBeVisible();
    expect((await previous.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`profile-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await previous.focus(); expect(await previous.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter"); await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("1.0.0", { exact: true })).toBeVisible();
    await page.getByText("Module identity", { exact: true }).click();
    await expect(page.getByRole("dialog").getByText(`0x${"14".padStart(64, "0")}`, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(previous).toBeFocused();
    await page.keyboard.press("Tab"); await expect(current).toBeFocused(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByText("2.0.0", { exact: true })).toBeVisible();
    await page.getByText("Module identity", { exact: true }).click();
    await expect(page.getByRole("dialog").getByText(`0x${"15".padStart(64, "0")}`, { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`version-${viewport.width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("a partial empty response never claims the contributor has no publications", async ({ page }) => {
  await page.goto(origin); await expect(page.getByRole("button", { name: /version 1\.0\.0/ })).toBeVisible();
  await page.evaluate(() => { window.__moduleAuthorProfileFixture.empty = true; });
  await page.getByRole("button", { name: "Refresh modules", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Some module versions are unavailable. Refresh to check again.");
  await expect(page.getByText("No published modules yet.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /View module/ })).toHaveCount(0);
});

test("refresh failure preserves already verified versions and recovery removes the partial notice", async ({ page }) => {
  await page.goto(origin); await expect(page.getByRole("button", { name: /version 1\.0\.0/ })).toBeVisible();
  await page.evaluate(() => { window.__moduleAuthorProfileFixture.fail = true; });
  await page.getByRole("button", { name: "Refresh modules", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Couldn’t refresh modules.");
  await expect(page.getByRole("button", { name: /View module/ })).toHaveCount(2);
  await page.evaluate(() => { window.__moduleAuthorProfileFixture.fail = false; window.__moduleAuthorProfileFixture.status = "ready"; });
  await page.getByRole("button", { name: "Refresh modules", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Modules 2", exact: true })).toBeVisible();
  await expect(page.getByRole("status")).toBeEmpty();
});
