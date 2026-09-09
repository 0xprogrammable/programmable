import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error Executable local fixture for real disclosure and dialog components.
import { createDisclosureMotionServer } from "./fixtures/disclosure-motion-server.mjs";

let server: Server, origin: string;
test.beforeAll(async () => {
  server = await createDisclosureMotionServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture failed");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.close(); await once(server, "close"); });

for (const width of [1440, 390, 320]) {
  test(`native and controlled disclosures reverse without a height jump at ${width}px`, async ({ page }) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 844 }); await page.goto(origin);
    for (const [trigger, panel] of [["#native > summary", "#native"], ['button[aria-controls="controlled"]', "#controlled"]]) {
      const heights = await page.evaluate(async ({ trigger, panel }) => {
        const button = document.querySelector<HTMLElement>(trigger)!;
        const content = document.querySelector<HTMLElement>(panel)!;
        const height = () => content.getBoundingClientRect().height;
        const click = () => button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
        const wait = (duration: number) => new Promise(resolve => setTimeout(resolve, duration));
        const closed = height(); click(); await wait(50); const opening = height();
        click(); await wait(0); const reversed = height(); await wait(180); const reclosed = height();
        click(); await wait(220); const opened = height();
        click(); await wait(35); const closing = height();
        const input = content.querySelector<HTMLElement>("input, textarea, select")!; input.focus();
        const closingFocusable = document.activeElement === input;
        await wait(180);
        return { closed, opening, reversed, reclosed, opened, closing, final: height(), closingFocusable };
      }, { trigger, panel });
      expect(heights.opening).toBeGreaterThan(heights.closed + 1);
      expect(heights.opening).toBeLessThan(heights.opened);
      expect(Math.abs(heights.reversed - heights.opening)).toBeLessThan(3);
      expect(heights.reclosed).toBeCloseTo(heights.closed, 0);
      expect(heights.closing).toBeGreaterThan(heights.closed);
      expect(heights.closing).toBeLessThan(heights.opened);
      expect(heights.final).toBeCloseTo(heights.closed, 0);
      expect(heights.closingFocusable).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("keyboard, reduced motion, and programmatic validation stay immediate", async ({ page }) => {
  await page.goto(origin);
  const summary = page.locator("#native > summary"); await summary.focus(); await page.keyboard.press("Enter");
  await expect(page.getByLabel("Description")).toBeVisible();
  expect(await page.locator("#native").evaluate(element => element.getAnimations().length)).toBe(0);
  await page.keyboard.press("Enter"); await expect(page.getByLabel("Description")).not.toBeVisible();
  await page.getByRole("button", { name: "Reveal details" }).click(); await expect(page.getByLabel("Description")).toBeVisible();
  await page.evaluate(async () => {
    document.querySelector("#native > summary")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    await new Promise(resolve => setTimeout(resolve, 30));
    (document.querySelector("#native") as HTMLDetailsElement).open = true;
  });
  await expect(page.getByLabel("Description")).toBeVisible();
  expect(await page.locator("#native").evaluate(element => element.getAnimations().length)).toBe(0);
  await summary.focus(); await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Check website" }).click();
  await expect(page.getByLabel("Website")).toBeVisible(); await expect(page.getByLabel("Website")).toBeFocused();
  expect(await page.locator("#native").evaluate(element => element.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await summary.click(); await expect(page.getByLabel("Description")).not.toBeVisible();
  await summary.click(); await expect(page.getByLabel("Description")).toBeVisible();
  await page.getByRole("button", { name: "Creator fees" }).click(); await expect(page.getByLabel("Buy fee")).toBeVisible();
  expect(await page.locator("#controlled").evaluate(element => element.getAnimations().length)).toBe(0);
});

test("dialog enters and exits with a pointer, while Escape and keyboard restore focus immediately", async ({ page }) => {
  await page.goto(origin); const trigger = page.getByRole("button", { name: "Add modules" });
  await trigger.click(); const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  await expect(page.getByRole("heading", { name: "Modules", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(page.getByRole("button", { name: "Done" })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Close modules" })).toBeFocused();
  await page.getByRole("button", { name: "Close modules" }).click();
  await expect(dialog).toHaveAttribute("data-closing", ""); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.press("Enter"); await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.getAnimations().length)).toBe(0);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe("");
  await trigger.click(); await page.mouse.click(2, 2); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" }); await trigger.click();
  expect(await dialog.evaluate(element => element.getAnimations().length)).toBe(0);
  await page.getByRole("button", { name: "Done" }).click(); await expect(dialog).toHaveCount(0);
});
