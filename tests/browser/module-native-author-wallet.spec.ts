import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Executable local server wraps the actual Console and private Native client.
import { createModuleNativeAuthorWalletServer } from "./fixtures/module-native-author-wallet-server.mjs";
let server: Server, origin: string;
const newWallet = "0x" + "a".repeat(40);
test.beforeAll(async () => { server = await createModuleNativeAuthorWalletServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture failed"); origin = "http://127.0.0.1:" + address.port; });
test.afterAll(async () => { server.close(); await once(server, "close"); });
for (const width of [1440, 390, 320]) test(`actual author review, keyboard, cancel and receipt at ${width}px`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 }); await page.goto(origin + (width === 320 ? "?version=2" : ""));
  await page.getByRole("button", { name: "Load author wallets" }).click();
  const authors = page.getByRole("region", { name: "Author reward wallets", exact: true });
  await expect(authors.getByRole("heading", { name: "Buyer rewards", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`author-controls-${width}.png`), fullPage: true });
  const input = authors.getByRole("textbox", { name: "New author reward wallet" }).first();
  await input.fill("invalid"); await input.press("Enter"); await expect(authors.getByRole("alert")).toContainText("different, nonzero"); await expect(input).toBeFocused();
  await input.fill(newWallet); await input.press("Tab");
  const review = authors.getByRole("button", { name: "Review author wallet change" }).first(); await expect(review).toBeFocused();
  expect(await review.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe("none"); expect((await review.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.keyboard.press("Enter"); const reviewSection = page.getByRole("region", { name: "Change author reward wallet", exact: true });
  await expect(reviewSection).toBeFocused(); await expect(reviewSection.getByText(/every coin using this family/)).toBeVisible();
  await expect(reviewSection.getByText(/does not enforce the preview expiry/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath(`author-review-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (width === 390) { await page.evaluate(() => { document.documentElement.style.zoom = "2"; }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); await page.screenshot({ path: testInfo.outputPath("author-review-zoom.png"), fullPage: true }); await page.evaluate(() => { document.documentElement.style.zoom = "1"; }); }
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(review).toBeFocused(); await expect(input).toHaveValue(newWallet); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Confirm in wallet" }).click(); await expect(page.getByRole("region", { name: "Author wallet change result" })).toContainText(newWallet);
  await expect(page.getByLabel("Test wallet calls")).toHaveText("Wallet calls: 1"); expect(errors).toEqual([]);
});
test("current reward wallet has no author authority", async ({ page }) => {
  await page.goto(origin + "?role=recipient"); await page.getByRole("button", { name: "Load author wallets" }).click();
  const authors = page.getByRole("region", { name: "Author reward wallets", exact: true });
  await expect(authors.getByRole("textbox")).toHaveCount(0); await expect(authors.getByText("Only the registered author shown above can change this wallet.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Claim fee balance" })).toBeEnabled();
});
test("missing author getters leave healthy claims available", async ({ page }) => {
  await page.goto(origin + "?missing"); await page.getByRole("button", { name: "Load author wallets" }).click();
  await expect(page.getByText(/Some author wallets could not be verified/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "New author reward wallet" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Claim fee balance" })).toBeEnabled();
});
for (const mode of ["uncertain", "reject"]) test(`${mode} request preserves the correct recovery state`, async ({ page }) => {
  await page.goto(origin); await page.getByLabel("Test wallet response").selectOption(mode); await page.getByRole("button", { name: "Load author wallets" }).click();
  await page.getByRole("textbox", { name: "New author reward wallet" }).first().fill(newWallet); await page.getByRole("button", { name: "Review author wallet change" }).first().click();
  await page.getByRole("button", { name: "Confirm in wallet" }).click();
  if (mode === "uncertain") {
    await expect(page.getByRole("button", { name: "Check confirmation" })).toBeVisible(); await page.reload();
    await expect(page.getByRole("button", { name: "Load author wallets" })).toBeDisabled(); await expect(page.getByRole("button", { name: "Check confirmation" })).toBeVisible();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("programmable:module-operation:")).length)).toBe(1);
    await expect(page.getByLabel("Test wallet calls")).toHaveText("Wallet calls: 1");
  } else {
    await expect(page.getByRole("alert")).toContainText("rejected"); await expect(page.getByRole("button", { name: "Review author wallet change" }).first()).toBeEnabled();
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("programmable:module-operation:")).length)).toBe(0);
  }
});

test("late wallet A author receipt cannot replace wallet B's saved claim hash or snapshot (N-01)", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message)); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin + "?race"); await page.getByLabel("Test wallet response").selectOption("deferred");
  await page.getByRole("button", { name: "Load author wallets" }).click();
  await page.getByRole("textbox", { name: "New author reward wallet" }).first().fill(newWallet);
  await page.getByRole("button", { name: "Review author wallet change" }).first().click(); await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("button", { name: "Check confirmation" })).toBeVisible();
  await page.getByRole("button", { name: "Connect wallet B with saved claim" }).click();
  const otherHash = "0x" + "b".repeat(64), field = page.getByRole("textbox", { name: "Transaction hash", exact: true });
  await expect(field).toHaveValue(otherHash);
  await page.getByRole("button", { name: "Release wallet A receipt" }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("programmable:module-operation:v1:4663:" + window.__nativeAuthorRace.actor))).toBeNull();
  await expect(field).toHaveValue(otherHash);
  await expect(page.getByRole("link", { name: "View transaction", exact: true })).toHaveAttribute("href", new RegExp(otherHash + "$"));
  await expect(page.getByRole("heading", { name: "Manage Author controls fixture", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Author wallet change result" })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("programmable:module-operation:v1:4663:" + window.__nativeAuthorRace.otherAccount)!).transactionHash)).toBe(otherHash);
  await page.getByRole("button", { name: "Check confirmation" }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeAuthorRace.receiptRequests.at(-1))).toBe(otherHash);
  await expect(page.getByRole("alert")).toContainText("transaction hash");
  await expect(page.getByLabel("Test wallet calls")).toHaveText("Wallet calls: 1"); expect(errors).toEqual([]);
});

test("a newer saved operation of the same wallet takes priority over the old active reference (N-01)", async ({ page }) => {
  await page.goto(origin + "?race"); await page.getByLabel("Test wallet response").selectOption("deferred");
  await page.getByRole("button", { name: "Load author wallets" }).click();
  await page.getByRole("textbox", { name: "New author reward wallet" }).first().fill(newWallet);
  await page.getByRole("button", { name: "Review author wallet change" }).first().click(); await page.getByRole("button", { name: "Confirm in wallet" }).click();
  await expect(page.getByRole("button", { name: "Check confirmation" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm elsewhere and save next claim" }).click();
  const otherHash = "0x" + "b".repeat(64), field = page.getByRole("textbox", { name: "Transaction hash", exact: true });
  await expect(field).toHaveValue(otherHash); await page.getByRole("button", { name: "Release wallet A receipt" }).click();
  await page.getByRole("button", { name: "Check confirmation" }).click();
  await expect.poll(() => page.evaluate(() => window.__nativeAuthorRace.receiptRequests.at(-1))).toBe(otherHash);
  await expect(page.getByRole("alert")).toContainText("transaction hash"); await expect(field).toHaveValue(otherHash);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("programmable:module-operation:v1:4663:" + window.__nativeAuthorRace.actor)!).transactionHash)).toBe(otherHash);
  await expect(page.getByRole("region", { name: "Author wallet change result" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Manage Author controls fixture", exact: true })).toBeVisible();
  await expect(page.getByLabel("Test wallet calls")).toHaveText("Wallet calls: 1");
});
