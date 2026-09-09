import { once } from "node:events";
import type { Server } from "node:http";
import { expect, test, type Page } from "@playwright/test";
// @ts-expect-error The esbuild fixture host is a JavaScript module.
import { createWalletSessionServer } from "./fixtures/wallet-session-server.mjs";

const accountA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const accountB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
let server: Server;
let origin: string;
const browserErrors = new WeakMap<Page, string[]>();

test.beforeAll(async () => {
  server = await createWalletSessionServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (!server) return;
  server.close();
  await once(server, "close");
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    errors.push(`Unexpected external request from wallet fixture: ${url.origin}`);
    await route.abort();
  });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});

async function open(page: Page, path = "/profile") {
  await page.goto(origin + path);
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expect(page.getByLabel("Session ready", { exact: true })).toHaveText("true");
}

function inlineWallet(page: Page) {
  return page.getByRole("region", { name: "Inline wallet controls", exact: true });
}

async function scenario(page: Page, name: string) {
  await page.getByLabel("SDK scenario", { exact: true }).selectOption(name);
}

async function calls(page: Page) {
  return JSON.parse(await page.getByLabel("SDK calls", { exact: true }).innerText()) as { method: string; options?: unknown }[];
}

async function expectMethods(page: Page, methods: string[]) {
  await expect.poll(async () => (await calls(page)).map((call) => call.method)).toEqual(methods);
}

test("only the admin wallet gets one dashboard entry, including keyboard and account changes", async ({ page }) => {
  await open(page);
  const header = page.getByRole("banner");
  await header.getByRole("button", { name: "Wallet 0xaaaa…aaaa", exact: true }).click();
  await expect(header.getByRole("link", { name: "Admin Dashboard", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await scenario(page, "website-admin");
  const button = header.getByRole("button", { name: /^Wallet 0x7987…1b9c$/i });
  await button.focus();
  await page.keyboard.press("Enter");
  const link = header.getByRole("link", { name: "Admin Dashboard", exact: true });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute("href", "/admin/modules");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(button).toBeFocused();
  await expect(link).toBeHidden();
  await button.click();
  await scenario(page, "primary");
  await expect(header.getByRole("link", { name: "Admin Dashboard", exact: true })).toHaveCount(0);
  await scenario(page, "website-admin");
  await scenario(page, "anonymous");
  await expect(header.getByRole("link", { name: "Admin Dashboard", exact: true })).toHaveCount(0);
});

for (const path of ["/profile", "/developers/api-keys"]) {
  test(`${path}: primary account wins over a newer unlinked or foreign wallet`, async ({ page }) => {
    await open(page, path);
    await expect(inlineWallet(page).getByRole("button", { name: "Manage wallet 0xaaaa…aaaa", exact: true })).toBeVisible();
    await expect(page.getByLabel("Wallet linked", { exact: true })).toHaveText("true");
    await scenario(page, "foreign-linked");
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
    await page.getByRole("button", { name: "Open account", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Wallet", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText("0xbbbb");
    await expectMethods(page, []);
  });

  test(`${path}: known linked account reconnects without trying to create or link it again`, async ({ page }) => {
    await open(page, path);
    await scenario(page, "linked-disconnected");
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText("none");
    await inlineWallet(page).getByRole("button", { name: "Connect wallet", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "SDK wallet dialog", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expectMethods(page, ["connectWallet"]);
    expect((await calls(page))[0].options).toMatchObject({ walletChainType: "ethereum-only" });
    await page.getByRole("button", { name: "Complete wallet A reconnect", exact: true }).click();
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText(/Complete wallet setup|Add an Ethereum wallet/)).toHaveCount(0);
  });
}

test("a user change never adopts connected wallets belonging to the previous account", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Change SDK user, keep old wallets", exact: true }).click();
  await expect(page.getByLabel("SDK user", { exact: true })).toHaveText("fixture-user-beta");
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText("none");
  await expect(page.getByLabel("Wallet linked", { exact: true })).toHaveText("false");
  await expect(page.getByRole("button", { name: /Manage wallet/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["connectWallet"]);
});

test("verified ownership survives an SDK linked flag with mismatched address casing", async ({ page }) => {
  await open(page);
  await scenario(page, "owned-unmatched");
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await expect(page.getByLabel("Wallet linked", { exact: true })).toHaveText("true");
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Wallet", exact: true })).toBeVisible();
  await expectMethods(page, []);
});

test("an SDK user restoring authentication cannot start another login", async ({ page }) => {
  await open(page);
  await scenario(page, "restoring-user");
  await expect(inlineWallet(page).getByRole("button", { name: "Loading wallet", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, []);
  await page.getByRole("button", { name: "Restore SDK session", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, []);
});

test("a completed SDK session settles login even when no completion callback arrives", async ({ page }) => {
  await open(page);
  await scenario(page, "anonymous");
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["login"]);
  await page.getByRole("button", { name: "Restore session without login callback", exact: true }).dispatchEvent("click");
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expect(page.getByLabel("Wallet opening", { exact: true })).toHaveText("false");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectMethods(page, ["login"]);
});

test("sign out waits for the SDK readback before allowing a fresh login", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Delay logout readback", exact: true }).click();
  await page.getByRole("button", { name: "Sign out of app", exact: true }).click();
  await expect(page.getByLabel("Session authenticated", { exact: true })).toHaveText("false");
  await expect(inlineWallet(page).getByRole("button", { name: "Loading wallet", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  expect((await calls(page)).some((call) => call.method === "login")).toBe(false);
  await page.getByRole("button", { name: "Finish logout readback", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await inlineWallet(page).getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "SDK wallet dialog", exact: true })).toBeVisible();
  expect((await calls(page)).filter((call) => call.method === "login")).toHaveLength(1);
});

for (const width of [1440, 390, 320]) {
  test(`wallet dialog at ${width}px keeps copy, focus, and provider recovery usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page);
    const trigger = page.getByRole("button", { name: "Open account", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Wallet", exact: true });
    const close = dialog.getByRole("button", { name: "Close wallet dialog", exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Sign out", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    // Native modal focus cannot be moved into the underlying page.
    await trigger.evaluate((button) => button.focus());
    await expect(close).toBeFocused();
    await page.keyboard.press("Tab");
    const copy = dialog.getByRole("button", { name: "Copy address", exact: true });
    await expect(copy).toBeFocused();
    await expect(copy).toHaveCSS("outline-color", "rgb(231, 134, 178)");
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("button", { name: "Address copied", exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(accountA);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const button of await dialog.getByRole("button").all()) {
      const size = await button.boundingBox();
      expect(size?.height).toBeGreaterThanOrEqual(44);
      expect(size?.width).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByRole("button", { name: "Add wallet", exact: true }).click();
    await expectMethods(page, ["linkWallet"]);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.getByRole("button", { name: "Reject linking foreign account", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("This wallet belongs to another account. Sign out, then sign in with that wallet.");
    await expect(dialog.getByRole("button", { name: "Reconnect wallet", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
}

test("wallet hydration prevents login and linking until the connected wallet list settles", async ({ page }) => {
  await open(page);
  await scenario(page, "hydrating");
  await expect(inlineWallet(page).getByRole("button", { name: "Loading wallet", exact: true })).toBeDisabled();
  await expect(page.getByRole("banner").getByRole("button", { name: "Loading wallet", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Opening wallet", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Session ready", { exact: true })).toHaveText("false");
  await expect(page.getByLabel("Wallet opening", { exact: true })).toHaveText("false");
  await page.getByRole("button", { name: "Open account", exact: true }).dblclick();
  await expectMethods(page, []);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Finish wallet hydration", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, []);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["connectWallet"]);
});

test("only an authenticated account without a linked wallet starts the SDK link flow", async ({ page }) => {
  await open(page, "/developers/api-keys");
  await scenario(page, "email-without-wallet");
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["linkWallet"]);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Reject linking foreign account", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("This wallet belongs to another account. Sign out, then sign in with that wallet.");
});

test("the SDK modal suppresses an existing application wallet dialog", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Wallet", exact: true })).toBeVisible();
  // This represents an SDK status event, not a click through the application modal.
  await page.getByRole("button", { name: "Open SDK modal", exact: true }).dispatchEvent("click");
  await expect(page.getByRole("dialog", { name: "Wallet", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "SDK wallet dialog", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expectMethods(page, []);
});

test("login completion uses the actual login wallet and clears that selection for another user", async ({ page }) => {
  await open(page, "/developers/api-keys");
  await scenario(page, "anonymous");
  await inlineWallet(page).getByRole("button", { name: "Connect wallet", exact: true }).click();
  await expectMethods(page, ["login"]);
  await page.getByRole("button", { name: "Complete wallet B login", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Change SDK user, same linked addresses", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
});

test("explicit account selection is restricted to owned wallets and does not survive a user change", async ({ page }) => {
  await open(page);
  await scenario(page, "both-owned");
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "0xbbbb…bbbb", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
  await page.getByRole("button", { name: "Change SDK user, same linked addresses", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await expectMethods(page, []);
});

for (const [sdkScenario, method] of [["anonymous", "login"], ["linked-disconnected", "connectWallet"], ["email-without-wallet", "linkWallet"]]) {
  test(`two rapid clicks make one SDK ${method} request`, async ({ page }) => {
    await open(page, "/developers/api-keys");
    await scenario(page, sdkScenario);
    await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
    await page.getByRole("button", { name: "Open account", exact: true }).dblclick();
    await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
    await expectMethods(page, []);
    await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
    await expectMethods(page, [method]);
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });
}

test("session restoration during a pending login lease cancels the obsolete login", async ({ page }) => {
  await open(page);
  await scenario(page, "anonymous");
  await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Restore SDK session", exact: true }).click();
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, []);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a user change while awaiting a reconnect lease cancels the old request and allows a fresh attempt", async ({ page }) => {
  await open(page);
  await scenario(page, "linked-disconnected");
  await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Change SDK user, keep old wallets", exact: true }).click();
  await expect(page.getByLabel("SDK user", { exact: true })).toHaveText("fixture-user-beta");
  await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, []);
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expectMethods(page, ["connectWallet"]);
});

test("signing out while awaiting a reconnect lease never opens a prompt for the old account", async ({ page }) => {
  await open(page);
  await scenario(page, "linked-disconnected");
  await page.getByRole("button", { name: "Delay browser lock", exact: true }).click();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  await expect(page.getByLabel("Pending browser locks", { exact: true })).toHaveText("1");
  await page.getByRole("button", { name: "Sign out of app", exact: true }).click();
  await expect(page.getByLabel("Session authenticated", { exact: true })).toHaveText("false");
  await page.getByRole("button", { name: "Resume browser lock", exact: true }).click();
  await expect(page.getByLabel("Wallet busy", { exact: true })).toHaveText("false");
  await expectMethods(page, ["logout"]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(inlineWallet(page).getByRole("button", { name: "Connect wallet", exact: true })).toBeVisible();
});

for (const path of ["/profile", "/developers/api-keys"]) {
  test(`${path}: the header keeps wallet actions compact and restores keyboard focus`, async ({ page }) => {
    await open(page, path);
    await scenario(page, "owned-with-foreign");
    const header = page.getByRole("banner");
    const trigger = header.getByRole("button", { name: "Wallet 0xaaaa…aaaa", exact: true });
    await trigger.click();
    const menu = header.getByRole("group", { name: "Wallet actions", exact: true });
    await expect(menu.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute("href", "/profile");
    await expect(menu.getByRole("button", { name: "Copy address", exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Disconnect", exact: true })).toBeVisible();
    await expect(menu.getByRole("button", { name: "Manage wallets", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectMethods(page, []);
  });

  test(`${path}: contextual account selection exposes only owned wallets and restores focus`, async ({ page }) => {
    await open(page, path);
    await scenario(page, "owned-with-foreign");
    const trigger = page.getByRole("button", { name: "Open account", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Wallet", exact: true });
    await expect(dialog).toBeVisible();
    const wallets = dialog.locator('[aria-label="Connected wallets"]');
    await expect(wallets.getByRole("button")).toHaveCount(2);
    await expect(wallets).not.toContainText("0xcccc");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await dialog.getByRole("button", { name: "0xbbbb…bbbb", exact: true }).click();
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectMethods(page, []);
  });
}

test("the inline wallet menu exposes profile and API access without a management action", async ({ page }) => {
  await open(page);
  const trigger = inlineWallet(page).getByRole("button", { name: "Manage wallet 0xaaaa…aaaa", exact: true });
  await trigger.click();
  const menu = page.getByRole("group", { name: "Wallet actions", exact: true });
  await expect(menu.getByRole("link", { name: "Profile", exact: true })).toHaveAttribute("href", "/profile");
  await expect(menu.getByRole("link", { name: "API keys", exact: true })).toHaveAttribute("href", "/developers/api-keys");
  await expect(menu.getByRole("button", { name: "Manage wallets", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectMethods(page, []);
});

test("an unsupported wallet network is informational and never forces Ethereum from the account dialog", async ({ page }) => {
  await open(page, "/developers/api-keys");
  await scenario(page, "unsupported-network");
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Wallet", exact: true });
  await expect(dialog.getByText("Wallet network", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Switch to/ })).toHaveCount(0);
  await expect(dialog).not.toContainText("Programmable uses Ethereum");
  await expect(page.getByLabel("Selected wallet network", { exact: true })).toHaveText("0x2105");
  await expectMethods(page, []);
});

async function networkResults(page: Page) {
  return JSON.parse(await page.getByLabel("Network switch results", { exact: true }).innerText()) as (boolean | string)[];
}

async function expectNetworkResults(page: Page, results: (boolean | string)[]) {
  await expect.poll(() => networkResults(page)).toEqual(results);
}

async function beginDelayedNetworkSwitch(page: Page) {
  await page.getByRole("button", { name: "Delay network switch", exact: true }).click();
  await page.getByRole("button", { name: "Open account", exact: true }).click();
  // The fixture initiates the public context action; only SDK completion and
  // provider readbacks are simulated. No transaction/signing RPC is supported.
  await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).dispatchEvent("click");
  await expect(page.getByLabel("Pending network switches", { exact: true })).toHaveText("1");
  await expect(page.getByLabel("Network switch busy", { exact: true })).toHaveText("true");
}

test("a normal network update can replace the SDK wrapper while preserving its connection capability", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).click();
  await expectNetworkResults(page, [true]);
  await expect(page.getByLabel("Selected wallet network", { exact: true })).toHaveText("0x1");
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
  const methods = (await calls(page)).map((call) => call.method);
  expect(methods.filter((method) => method === "switchChain")).toHaveLength(1);
  expect(methods).toEqual(expect.arrayContaining(["eth_chainId", "eth_accounts"]));
  expect(methods).not.toContain("forbidden-wallet-operation");
});

test("duplicate requests do not open a second SDK network switch", async ({ page }) => {
  await open(page);
  await beginDelayedNetworkSwitch(page);
  await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).dispatchEvent("click");
  await expectNetworkResults(page, [false]);
  expect((await calls(page)).filter((call) => call.method === "switchChain")).toHaveLength(1);
  await page.getByRole("button", { name: "Resolve network switch", exact: true }).dispatchEvent("click");
  await expectNetworkResults(page, [false, true]);
  await expect(page.getByLabel("Network switch busy", { exact: true })).toHaveText("false");
});

test("a rejected network switch keeps the existing chain and releases the pending gate for retry", async ({ page }) => {
  await open(page);
  await beginDelayedNetworkSwitch(page);
  await page.getByRole("button", { name: "Reject network switch", exact: true }).dispatchEvent("click");
  await expectNetworkResults(page, [false]);
  await expect(page.getByLabel("Selected wallet network", { exact: true })).toHaveText("0x1237");
  await expect(page.getByLabel("Network switch busy", { exact: true })).toHaveText("false");
  await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).dispatchEvent("click");
  await expectNetworkResults(page, [false, true]);
  expect((await calls(page)).filter((call) => call.method === "switchChain")).toHaveLength(2);
});

for (const invalidReadback of ["Return a different provider account", "Return the wrong provider network"]) {
  test(`network success is rejected when the SDK will ${invalidReadback.toLowerCase()}`, async ({ page }) => {
    await open(page);
    await page.getByRole("button", { name: invalidReadback, exact: true }).click();
    await page.getByRole("button", { name: "Request Ethereum wallet network", exact: true }).click();
    await expectNetworkResults(page, [false]);
    await expect(page.getByLabel("Network switch busy", { exact: true })).toHaveText("false");
    expect((await calls(page)).some((call) => call.method === "forbidden-wallet-operation")).toBe(false);
  });
}

for (const transition of ["user", "account", "capability"] as const) {
  for (const completion of ["Resolve network switch", "Reject network switch"]) {
    test(`${completion.toLowerCase()} after a ${transition} change never publishes obsolete success or error`, async ({ page }) => {
      await open(page);
      await scenario(page, "both-owned");
      await beginDelayedNetworkSwitch(page);
      if (transition === "user") {
        await page.getByRole("button", { name: "Change SDK user, same linked addresses", exact: true }).dispatchEvent("click");
        await expect(page.getByLabel("SDK user", { exact: true })).toHaveText("fixture-user-beta");
      } else if (transition === "account") {
        await page.getByRole("dialog").getByRole("button", { name: "0xbbbb…bbbb", exact: true }).click();
        await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
        // Observe any late error in the new account's visible dialog, without
        // reopening after completion (which would clear the error itself).
        await page.getByRole("button", { name: "Open account", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Wallet", exact: true })).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Replace connected wallet capability", exact: true }).dispatchEvent("click");
      }
      await page.getByRole("button", { name: completion, exact: true }).dispatchEvent("click");
      await expectNetworkResults(page, [false]);
      await expect(page.getByLabel("Network switch busy", { exact: true })).toHaveText("false");
      await expect(page.getByRole("alert")).toHaveCount(0);
      if (transition === "account") {
        await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
        await expect(page.getByLabel("Selected wallet network", { exact: true })).toHaveText("0x1237");
      }
    });
  }
}

test("disconnecting while a network switch is pending invalidates its eventual success", async ({ page }) => {
  await open(page);
  await beginDelayedNetworkSwitch(page);
  await page.getByRole("button", { name: "Sign out of app", exact: true }).dispatchEvent("click");
  await expect(page.getByLabel("Session authenticated", { exact: true })).toHaveText("false");
  await page.getByRole("button", { name: "Resolve network switch", exact: true }).dispatchEvent("click");
  await expectNetworkResults(page, [false]);
  await expect(page.getByLabel("Selected account", { exact: true })).toHaveText("none");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const completion of ["Resolve network switch", "Reject network switch"]) {
  test(`${completion.toLowerCase()} stays obsolete after selecting another account and returning to the original`, async ({ page }) => {
    await open(page);
    await scenario(page, "both-owned");
    await beginDelayedNetworkSwitch(page);
    const dialog = page.getByRole("dialog", { name: "Wallet", exact: true });

    await dialog.getByRole("button", { name: "0xbbbb…bbbb", exact: true }).click();
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountB);
    await page.getByRole("button", { name: "Open account", exact: true }).click();
    await dialog.getByRole("button", { name: "0xaaaa…aaaa", exact: true }).click();
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);

    // Keep the original account's dialog visible before completion, so an
    // obsolete SDK error cannot be hidden or cleared by reopening afterwards.
    await page.getByRole("button", { name: "Open account", exact: true }).click();
    await expect(dialog).toBeVisible();
    await page.getByRole("button", { name: completion, exact: true }).dispatchEvent("click");

    await expectNetworkResults(page, [false]);
    await expect(page.getByLabel("Network switch busy", { exact: true })).toHaveText("false");
    await expect(page.getByLabel("Selected account", { exact: true })).toHaveText(accountA);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect((await calls(page)).filter((call) => call.method === "switchChain")).toHaveLength(1);
  });
}
