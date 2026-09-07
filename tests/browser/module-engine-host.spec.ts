import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Executable local fixture server.
import { createEngineHostServer } from "./fixtures/module-engine-host-server.mjs";
import { h as hash } from "../fixtures/module-mode-evidence";
declare global { interface Window { engineHostTest: { accountA: string; accountB: string; sent: string[]; recovered: { account: string; id: string; hash: string }[]; defer(): void; finish(): void; seed(other: boolean): Promise<string> } } }
let server: Server, origin = "";
test.beforeAll(async () => { server = await createEngineHostServer(); server.listen(0, "127.0.0.1"); await once(server, "listening"); const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture startup failed"); origin = `http://127.0.0.1:${address.port}`; });
test.afterAll(async () => { if (server) { server.close(); await once(server, "close"); } });
for (const other of [true, false]) test(`a saved ${other ? "other wallet" : "same wallet newer"} request takes precedence over an earlier launch result`, async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(origin);
  await page.getByRole("button", { name: "Submit test launch" }).click();
  await expect(page.getByRole("heading", { name: "Coin launched" })).toBeVisible();
  const id = await page.evaluate(other => window.engineHostTest.seed(other), other);
  await expect(page.getByRole("heading", { name: "Check your saved transaction" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coin launched" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View transaction" })).toHaveCount(0);
  await page.getByLabel("Transaction hash from your wallet", { exact: true }).fill(hash(800));
  await page.screenshot({ path: test.info().outputPath("saved-request-390.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Check wallet transaction", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coin launched" })).toBeVisible();
  const state = await page.evaluate(() => window.engineHostTest);
  expect(state.recovered).toEqual([{ account: other ? state.accountB : state.accountA, id, hash: hash(800) }]);
  expect(state.sent).toEqual([state.accountA]); expect(errors).toEqual([]);
});
test("a late receipt for wallet A cannot hide wallet B recovery, including after reload", async ({ page }) => {
  await page.goto(origin); await page.evaluate(() => window.engineHostTest.defer());
  await page.getByRole("button", { name: "Submit test launch" }).click();
  await expect(page.getByRole("heading", { name: "Check your saved transaction" })).toBeVisible();
  const id = await page.evaluate(() => window.engineHostTest.seed(true));
  await page.evaluate(() => window.engineHostTest.finish());
  await expect(page.getByRole("heading", { name: "Coin launched" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "View transaction" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Check your saved transaction" })).toBeVisible();
  await page.getByLabel("Transaction hash from your wallet", { exact: true }).fill(hash(800));
  await page.getByRole("button", { name: "Check wallet transaction", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Coin launched" })).toBeVisible();
  expect(await page.evaluate(() => window.engineHostTest.recovered.at(-1)?.id)).toBe(id);
  expect(await page.evaluate(() => window.engineHostTest.sent.length)).toBe(0);
});
