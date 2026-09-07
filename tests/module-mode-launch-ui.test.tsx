import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModuleModeBuilder } from "@/components/module-mode-builder";
import { ModuleModeLaunchResult } from "@/components/module-mode-launch-host";

vi.mock("@/components/view-chain", () => ({ useViewChain: () => ({ hydrated: true, viewChainId: 4663, setViewChainId: vi.fn() }) }));
vi.mock("@/components/wallet-provider", () => ({ useWallet: vi.fn() }));

const token = `0x${"12".repeat(20)}` as const;
const transactionHash = `0x${"34".repeat(32)}` as const;

describe("Module Mode launch presentation", () => {
  it("starts with an empty image picker and named optional social fields", () => {
    const html = renderToStaticMarkup(<ModuleModeBuilder catalog={[]} launchAction={{ label: "Launch coin", description: "", onContinue: vi.fn() }} />);
    expect(html).toContain("Choose image");
    expect(html).not.toContain('alt="Your selected token image"');
    expect(html).not.toContain("Remove token image");
    for (const name of ["Twitter / X", "Website", "Telegram", "Discord", "GitHub", "GitBook"]) expect(html).toContain(`>${name}</label>`);
    expect(html).toMatch(/id="module-more-links"[^>]*hidden=""/);
    expect(html).toContain('aria-controls="module-more-links"');
    expect(html).toContain("Add more links");
    expect(html).toContain("Launch coin");
    expect(html).not.toMatch(/Review coin|Prepare launch|Prepared on your device/);
    for (const key of ["twitter", "website", "telegram", "discord", "github", "gitbook"]) {
      expect(html).toMatch(new RegExp(`id="module-social-${key}"[^>]*type="url"`));
    }
  });

  it("does not offer a token or a retry while submission is unresolved", () => {
    for (const phase of ["pending", "uncertain", "receipt-unavailable"] as const) {
      const html = renderToStaticMarkup(<ModuleModeLaunchResult phase={phase} token={token} transactionHash={phase === "uncertain" ? undefined : transactionHash} onCheck={vi.fn()} />);
      expect(html).not.toContain("Coin launched");
      expect(html).not.toContain("Copy address");
      expect(html).not.toContain("View token");
      expect(html).not.toContain("Launch coin");
      if (phase === "receipt-unavailable") expect(html).toContain("Check confirmation");
      else expect(html).not.toContain("Check confirmation");
    }
  });

  it("shows a verified launch with the actual address and a separate indexing note", () => {
    const result = <ModuleModeLaunchResult phase="mined" token={token} symbol="ORBIT" transactionHash={transactionHash} />;
    const html = renderToStaticMarkup(<ModuleModeBuilder resultContent={result} />);
    expect(html).toContain("Coin launched");
    expect(html).toContain(`href="/token/${token}?chain=4663"`);
    expect(html).toContain(`value="${token}"`);
    expect(html).toContain("Copy address");
    expect(html).toContain(`/tx/${transactionHash}`);
    expect(html).toContain("Explore updates after final confirmation");
    expect(html).not.toMatch(/<form|<aside|Choose image|Export draft/);
  });

  it("never presents a missing token receipt as a successful launch", () => {
    const html = renderToStaticMarkup(<ModuleModeLaunchResult phase="mined" transactionHash={transactionHash} />);
    expect(html).toContain("Confirming launch");
    expect(html).not.toMatch(/Coin launched|Copy address|View token/);
  });
});
