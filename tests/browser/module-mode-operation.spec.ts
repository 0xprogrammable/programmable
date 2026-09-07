import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error This fixture host is also executable for manual browser QA.
import { createModuleModeOperationServer } from "./fixtures/module-mode-operation-server.mjs";
import { a, h } from "../fixtures/module-mode-evidence";
import type {} from "./fixtures/module-mode-operation-wallet";

let server: Server; let origin = "";
test.beforeAll(async () => { server = await createModuleModeOperationServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture did not start"); origin = `http://127.0.0.1:${address.port}`; });
test.afterAll(async () => { server.close(); await once(server, "close"); });

async function start(page: import("@playwright/test").Page, kind = "manage") {
  await page.goto(`${origin}${kind === "manage" ? `/launch/modules/manage/${a(21)}` : "/launch/modules"}`);
  await page.waitForFunction(() => !!window.__moduleOperationFixture);
}

test("lost management response survives reload and a new tab, and only an exact readback unlocks it", async ({ page, context }) => {
  await start(page);
  await page.getByRole("button", { name: "Claim fee balance", exact: true }).click();
  await page.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
  await expect(page.getByText("Confirmation not verified", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Claim fee balance", exact: true })).toBeDisabled();
  const next = await context.newPage(); await start(next);
  await expect(next.getByRole("button", { name: "Claim fee balance", exact: true })).toBeDisabled();
  await next.evaluate(() => { window.__moduleOperationFixture.ready = true; });
  await next.getByLabel("Transaction hash", { exact: true }).fill(h(999));
  await next.getByRole("button", { name: "Check confirmation", exact: true }).click();
  await expect(next.getByRole("alert")).toContainText("does not match");
  await expect(next.getByRole("button", { name: "Claim fee balance", exact: true })).toBeDisabled();
  await next.getByLabel("Transaction hash", { exact: true }).fill(h(200));
  await next.getByRole("button", { name: "Check confirmation", exact: true }).click();
  await expect(next.getByText("Transaction mined", { exact: true }).last()).toBeVisible();
  await expect(next.getByRole("button", { name: "Claim fee balance", exact: true })).toBeEnabled();
  expect(await next.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(1);
  expect(await next.evaluate(() => window.__moduleOperationFixture.versionReads.filter(value => value !== "current").length)).toBe(2);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`launch recovery keyboard and reflow at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await start(page, "launch"); await page.evaluate(() => window.__moduleOperationFixture.seed("launch"));
    await page.reload();
    await expect(page.getByRole("heading", { name: "Check your wallet", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch coin", exact: true })).toHaveCount(0);
    const input = page.getByLabel("Transaction hash from your wallet");
    await input.focus(); await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Check wallet transaction", exact: true });
    await expect(submit).toBeFocused();
    expect(await submit.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none");
    expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toContainText("Enter the transaction hash");
    await expect(input).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath(`recovery-${viewport.width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = "1"; window.__moduleOperationFixture.ready = true; });
    await input.fill(h(200)); await input.press("Tab"); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Coin launched", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "View token", exact: true })).toHaveAttribute("href", `/token/${a(21)}?chain=4663`);
    expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(0);
    expect(errors).toEqual([]);
  });
}

test("a saved operation on another route exposes recovery and keeps all new actions locked", async ({ page }) => {
  await start(page, "launch"); await page.evaluate(() => window.__moduleOperationFixture.seed("launch", true));
  await start(page);
  await expect(page.getByRole("link", { name: "Open transaction recovery", exact: true })).toHaveAttribute("href", "/launch/modules");
  await expect(page.getByRole("button", { name: "Claim fee balance", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(0);
});

test("a definite wallet rejection clears only its operation and permits a fresh review", async ({ page }) => {
  await start(page); await page.evaluate(() => { window.__moduleOperationFixture.reject = true; });
  await page.getByRole("button", { name: "Claim fee balance", exact: true }).click();
  await page.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  await expect(page.getByRole("button", { name: "Claim fee balance", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("programmable:module-operation:")).length)).toBe(0);
  expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(1);
});

test("storage failure prevents the wallet call and a corrupt saved record stays locked after reload", async ({ page }) => {
  await start(page);
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key.startsWith("programmable:module-operation:")) throw new Error("Recovery storage unavailable"); return setItem.call(this, key, value); };
  });
  await page.getByRole("button", { name: "Claim fee balance", exact: true }).click();
  await page.getByRole("button", { name: "Confirm in wallet", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Recovery storage unavailable");
  expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(0);
  await page.reload();
  await page.evaluate(() => localStorage.setItem("programmable:module-operation:v1:4663:0x000000000000000000000000000000000000005a", ""));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("saved transaction record cannot be read");
  await expect(page.getByRole("button", { name: "Claim fee balance", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(0);
});

test("another tab's saved operation replaces an unsent local review without using that review for recovery", async ({ page, context }) => {
  await start(page);
  await page.getByRole("button", { name: "Claim fee balance", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm in wallet", exact: true })).toBeVisible();
  const second = await context.newPage(); await start(second); await second.evaluate(() => window.__moduleOperationFixture.seed("manage"));
  await expect(page.getByRole("button", { name: "Confirm in wallet", exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.__moduleOperationFixture.ready = true; });
  await page.getByLabel("Transaction hash", { exact: true }).fill(h(200));
  await page.getByRole("button", { name: "Check confirmation", exact: true }).click();
  await expect(page.getByText("Transaction mined", { exact: true }).last()).toBeVisible();
  expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(0);
});

test("a known launch hash is restored and can be checked without entering or sending another transaction", async ({ page }) => {
  await start(page, "launch"); await page.evaluate(() => window.__moduleOperationFixture.seed("launch", true));
  await page.reload();
  await expect(page.getByRole("link", { name: /View transaction/ })).toHaveAttribute("href", new RegExp(`/tx/${h(200)}$`));
  await page.evaluate(() => { window.__moduleOperationFixture.ready = true; });
  await page.getByRole("button", { name: "Check confirmation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coin launched", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__moduleOperationFixture.sendCount())).toBe(0);
});
