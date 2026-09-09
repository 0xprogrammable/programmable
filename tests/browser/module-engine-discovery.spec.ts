import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Executable fixture server for manual and automated browser inspection.
import { createModuleEngineDiscoveryServer } from "./fixtures/module-engine-discovery-server.mjs";
declare global { interface Window { __moduleEngineDetailsRequests: string[] } }
let server: Server; let origin: string;
test.beforeAll(async () => { server = await createModuleEngineDiscoveryServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const a = server.address(); if (!a || typeof a === "string") throw new Error("Fixture did not start"); origin = `http://127.0.0.1:${a.port}`; });
test.afterAll(async () => { server.close(); await once(server, "close"); });
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`template selection and bound public operations at ${viewport.width}px`, async ({ page }, testInfo) => {
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", e => { if (e.type() === "error") errors.push(e.text()); });
    await page.setViewportSize(viewport); await page.goto(origin);
    const select = page.getByRole("button", { name: "Choose module Conditional payment", exact: true });
    await expect(select).toBeVisible(); expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`library-${viewport.width}.png`), fullPage: true });
    await select.focus(); expect(await select.evaluate(e => getComputedStyle(e).outlineStyle)).not.toBe("none");
    await page.keyboard.press("Enter"); await expect(select).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("searchbox", { name: "Search modules" }).fill("refund");
    await expect(page.getByRole("button", { name: "Choose module Quote escrow", exact: true })).toHaveCount(0);
    await expect(select).toBeVisible();
    await page.getByRole("searchbox", { name: "Search modules" }).fill("unmatched");
    await expect(page.getByText("No matching modules", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    const profile = page.getByRole("button", { name: "View module Quote escrow, version 1.0.0", exact: true });
    await profile.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Reviewed operations" })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Deposit", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog").getByText("Quote asset", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`operations-${viewport.width}.png`) });
    await page.keyboard.press("Escape"); await expect(profile).toBeFocused();
    await page.getByRole("region", { name: "Attached modules" }).getByRole("button", { name: "Quote escrow", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible(); await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.__moduleEngineDetailsRequests.every(q => new URLSearchParams(q).get("sourceKind") === "module-engine-v1"))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
