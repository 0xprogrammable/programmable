import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeveloperApiKeys } from "../components/developer-api-keys";
import { useWallet } from "../components/wallet-provider";

vi.mock("../components/wallet-provider", () => ({ useWallet: vi.fn() }));

describe("API keys session restoration", () => {
  it.each([false, true])(
    "waits for the wallet list when authentication is already ready (sessionReady=%s)",
    (sessionReady) => {
      const getAccessToken = vi.fn(async () => null);
      vi.mocked(useWallet).mockReturnValue({
        authReady: true,
        sessionReady,
        connecting: !sessionReady,
        openingWallet: false,
        wallet: null,
        getAccessToken,
        getIdentityToken: vi.fn(async () => null),
        openWallet: vi.fn(),
      } as unknown as ReturnType<typeof useWallet>);

      const html = renderToStaticMarkup(<DeveloperApiKeys />);
      if (sessionReady) {
        expect(html).toContain("Connect your wallet");
        expect(html).not.toContain("Loading wallet session");
      } else {
        expect(html).toContain("Loading wallet session");
        expect(html).not.toContain("Connect your wallet");
        expect(html).not.toContain("Opening wallet");
      }
      expect(getAccessToken).not.toHaveBeenCalled();
    },
  );

  it("keeps module issuance pending until the authenticated key list confirms availability", () => {
    const getAccessToken = vi.fn(async () => null);
    const getIdentityToken = vi.fn(async () => null);
    vi.mocked(useWallet).mockReturnValue({
      authReady: true,
      sessionReady: true,
      connecting: false,
      openingWallet: false,
      wallet: { account: "0x1111111111111111111111111111111111111111" },
      getAccessToken,
      getIdentityToken,
      openWallet: vi.fn(),
    } as unknown as ReturnType<typeof useWallet>);

    const html = renderToStaticMarkup(<DeveloperApiKeys />);
    expect(html).toContain("Custom launches");
    expect(html).toContain("Module contributions");
    expect(html).toContain("Checking module availability.");
    expect(html).toMatch(/<input[^>]*disabled=""[^>]*value="module-contributions"/u);
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="custom-launches"/u);
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(getIdentityToken).not.toHaveBeenCalled();
  });
});
