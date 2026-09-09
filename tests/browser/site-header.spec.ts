import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test } from "@playwright/test";
// @ts-expect-error The fixture is shared with the manual browser QA host.
import { createSiteHeaderServer } from "./fixtures/site-header-server.mjs";

let server: Server;
let origin: string;
test.beforeAll(async () => {
  server = await createSiteHeaderServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.close(); await once(server, "close"); });
test.beforeEach(async ({ page }) => { await page.goto(origin); });

const walletName = "Wallet 0xaaaa…aaaa";

test("wallet opens only its actions; copy, Escape, outside click and focus work", async ({page,context}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const trigger = page.getByRole("button", {name:walletName,exact:true});
  await trigger.click();
  const menu = page.getByRole("group",{name:"Wallet actions",exact:true});
  await expect(menu.getByRole("link")).toHaveText(["Profile", "API keys", "Privacy & settings"]);
  await expect(menu.getByRole("link", { name: "API keys", exact: true })).toHaveAttribute("href", "/developers/api-keys");
  await expect(menu.getByRole("button")).toHaveText(["Copy address","Disconnect"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await menu.getByRole("button",{name:"Copy address",exact:true}).click();
  await expect(menu.getByRole("status")).toHaveText("Address copied");
  expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("link",{name:"Profile",exact:true})).toBeFocused();
  await page.getByRole("link",{name:"Outside control"}).click();
  await expect(menu).toHaveCount(0);
  await expect(trigger).toHaveCSS("background-color","rgba(0, 0, 0, 0)");
});

test("disconnect failure stays inline and success returns to connect",async ({page})=>{
  await page.getByRole("button",{name:"Fail disconnect"}).click();
  await page.getByRole("button",{name:walletName,exact:true}).click();
  await page.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(page.getByText("Unable to disconnect. Try again.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("disconnect-options")).toHaveText('{"showDialogOnFailure":false}');
  await page.getByRole("button",{name:"Fail disconnect"}).click();
  await page.getByRole("button",{name:walletName,exact:true}).click();
  await page.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(page.getByRole("button",{name:"Connect wallet",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Connect wallet",exact:true})).toBeFocused();
  await expect(page.getByRole("group",{name:"Wallet actions",exact:true})).toHaveCount(0);
});

test("keeps network selection out of the global header",async ({page})=>{
  await expect(page.getByRole("button",{name:/Viewing .* Switch to/})).toHaveCount(0);
  await expect(page.getByRole("button",{name:walletName,exact:true})).toBeVisible();
});

test("Explore exposes an icon-only Ethereum trigger and Robinhood choice",async ({page})=>{
  const trigger=page.getByRole("button",{name:"Explore chain: Ethereum",exact:true});
  await expect(trigger).toHaveText("");
  await trigger.click();
  const listbox=page.getByRole("listbox",{name:"Explore chains",exact:true});
  await expect(listbox.getByRole("option")).toHaveCount(1);
  const robinhoodOption=listbox.getByRole("option",{name:"Switch Explore to Robinhood",exact:true});
  await expect(robinhoodOption).not.toHaveAttribute("aria-disabled");
  await expect(listbox).not.toContainText("Base");
  await page.keyboard.press("ArrowDown");
  await expect(robinhoodOption).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("view-chain")).toHaveText("4663");
  await expect(page.getByTestId("requests")).toBeEmpty();
  await expect(listbox).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Explore chain: Robinhood",exact:true})).toBeFocused();
});

test("Explore chain menu closes outside and stays inside the mobile viewport",async ({page})=>{
  await page.setViewportSize({width:390,height:844});
  const trigger=page.getByRole("button",{name:"Explore chain: Ethereum",exact:true});
  await trigger.click();
  const listbox=page.getByRole("listbox",{name:"Explore chains",exact:true});
  const box=await listbox.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(0);
  expect((box?.x??0)+(box?.width??0)).toBeLessThanOrEqual(390);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole("heading",{name:"Header interaction fixture",exact:true}).click();
  await expect(listbox).toHaveCount(0);
});

test("anonymous Connect wallet closes navigation before opening login",async ({page})=>{
  await page.getByRole("button",{name:"Use anonymous session"}).click();
  await page.getByRole("button",{name:"Open menu",exact:true}).click();
  await page.getByRole("button",{name:"Connect wallet",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Connect wallet fixture"})).toBeVisible();
  await expect(page.getByRole("button",{name:"Open menu",exact:true})).toHaveAttribute("aria-expanded","false");
});

test("passive session hydration is labelled loading without claiming an SDK prompt is open", async ({ page }) => {
  await page.getByRole("button", { name: "Toggle wallet hydration", exact: true }).click();
  await expect(page.getByRole("banner").getByRole("button", { name: "Loading wallet", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Opening wallet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle wallet hydration", exact: true }).click();
  await expect(page.getByRole("button", { name: walletName, exact: true })).toBeEnabled();
});

test("keyboard navigation opens instantly and returns focus without trapping the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const trigger = page.getByRole("button", { name: "Open menu", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const navigation = page.getByRole("navigation", { name: "Menu navigation", exact: true });
  await expect(navigation).toBeVisible();
  const sheet = navigation.locator("../..");
  await expect(sheet).toHaveCSS("transition-duration", "0s");
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "Explore", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(navigation).not.toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Explore chain: Ethereum", exact: true })).toBeFocused();
});

test("sticky navigation stays readable and opening its menu preserves the scroll position", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => {
    document.querySelector("main")!.style.minHeight = "2400px";
    window.scrollTo(0, 600);
  });
  const header = page.getByRole("banner");
  await expect.poll(async () => (await header.boundingBox())?.y).toBe(0);
  expect(await header.evaluate((element) => {
    const color = getComputedStyle(element).backgroundColor;
    return color !== "rgba(0, 0, 0, 0)" && color !== "transparent";
  })).toBe(true);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const triggerBox = await page.getByRole("button", { name: "Open menu", exact: true }).boundingBox();
  if (!triggerBox) throw new Error("Missing menu trigger");
  // Use the visible pointer target. Locator.click() first scrolls a sticky
  // control into the document's scroll-padding area, unlike a user's click.
  await page.mouse.click(triggerBox.x + triggerBox.width / 2, triggerBox.y + triggerBox.height / 2);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
});

for(const width of [320,390,1440,1920]) {
  test(`header menus fit at ${width}px and remain mutually exclusive`,async ({page})=>{
    await page.setViewportSize({width,height:844});
    await page.getByRole("button",{name:walletName,exact:true}).click();
    const menu=page.getByRole("group",{name:"Wallet actions",exact:true});
    const box=await menu.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x??0)+(box?.width??0)).toBeLessThanOrEqual(width);
    await page.getByRole("button",{name:"Open menu",exact:true}).click();
    await expect(menu).toHaveCount(0);
    const navigation = page.getByRole("navigation",{name:"Menu navigation",exact:true});
    await expect(navigation).toBeVisible();
    const headerBox = await page.getByRole("banner").boundingBox();
    const sheetBox = await navigation.locator("../..").boundingBox();
    const triggerBox = await page.getByRole("button", { name: "Close menu", exact: true }).boundingBox();
    expect(sheetBox?.y).toBeGreaterThanOrEqual((headerBox?.y ?? 0) + (headerBox?.height ?? 0));
    expect(Math.abs((sheetBox?.x ?? 0) + (sheetBox?.width ?? 0) - (triggerBox?.x ?? 0) - (triggerBox?.width ?? 0))).toBeLessThanOrEqual(4);
    await page.getByRole("button",{name:walletName,exact:true}).click();
    await expect(menu).toBeVisible();
    await expect(page.getByRole("button",{name:"Open menu",exact:true})).toHaveAttribute("aria-expanded","false");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
  });
}
