import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminDashboardLink } from "../components/admin-dashboard-link";
import { WEBSITE_ADMIN_WALLET } from "../lib/admin-access";

function menu(account: string | null, authenticated = true, menuOpen = true) {
  return renderToStaticMarkup(<AdminDashboardLink account={account}
    authenticated={authenticated} menuOpen={menuOpen} onNavigate={() => {}} />);
}

describe("admin dashboard wallet boundary", () => {
  it.each([WEBSITE_ADMIN_WALLET, WEBSITE_ADMIN_WALLET.toLowerCase()])(
    "shows one dashboard entry for the authenticated admin %s", account => {
      const html = menu(account);
      expect(html).toContain('href="/admin/modules"');
      expect(html.match(/Admin Dashboard/g)).toHaveLength(1);
      expect(html).not.toContain('tabindex="-1"');
    },
  );
  it.each([null, "", "0x2222222222222222222222222222222222222222",
    `${WEBSITE_ADMIN_WALLET} `, WEBSITE_ADMIN_WALLET.slice(0, -1)])(
    "does not expose the entry for another or invalid wallet %s", account => {
      expect(menu(account)).toBe("");
    },
  );
  it("removes the entry when authentication is lost", () => {
    expect(menu(WEBSITE_ADMIN_WALLET, false)).toBe("");
  });
  it("does not keep the admin entry after switching to another account", () => {
    expect(menu(WEBSITE_ADMIN_WALLET)).toContain("Admin Dashboard");
    expect(menu("0x2222222222222222222222222222222222222222")).toBe("");
  });
  it("keeps a closed menu out of keyboard tab order", () => {
    expect(menu(WEBSITE_ADMIN_WALLET, true, false)).toContain('tabindex="-1"');
  });
});
