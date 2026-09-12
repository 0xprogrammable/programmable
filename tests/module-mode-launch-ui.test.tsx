import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ModuleModeBuilder } from "@/components/module-mode-builder";
import { ModuleModeLaunchResult } from "@/components/module-mode-launch-host";
import { ModuleSchemaField } from "@/components/module-mode-fields";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2 } from "@/lib/module-mode/release";
import { moduleEvidenceFixture, a } from "./fixtures/module-mode-evidence";

vi.mock("@/components/view-chain", () => {
  const useViewChain = () => ({ hydrated: true, viewChainId: 4663, setViewChainId: vi.fn() });
  return { useViewChain, useRouteViewChain: useViewChain };
});
vi.mock("@/components/wallet-provider", () => ({ useWallet: vi.fn() }));

const token = `0x${"12".repeat(20)}` as const;
const transactionHash = `0x${"34".repeat(32)}` as const;

describe("Module Mode launch presentation", () => {
  it("renders the released plain fee for each generation and no V2 fee under a V1 release", () => {
    const v1 = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
    const identity = { ...v1, schemaVersion: "programmable.module-mode-source.v2", sourceVersion: "module-native-v2", economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 };
    const v2 = bindActiveModuleModeRelease({ ...identity, releaseDigest: computeModuleModeReleaseDigest(identity) });
    const legacy = renderToStaticMarkup(<ModuleModeBuilder release={v1} catalog={[]} />);
    const current = renderToStaticMarkup(<ModuleModeBuilder release={v2} catalog={[]} />);
    expect(legacy).toContain("+ 0.20%"); expect(legacy).not.toContain("+ 0.10%");
    expect(current).toContain("+ 0.10%"); expect(current).not.toContain("0.20%");
    expect(current).toContain("No author fee applies without an eligible module family");
  });
  it("shows complete fixed asset values and suppresses every child edit of a fixed template", () => {
    const schema = { type: "record", required: ["asset", "amount"], binding: { mode: "fixed", value: { asset: { chainId: "4663", address: a(99), decimals: 18 }, amount: "1000000000000000" } }, fields: {
      asset: { type: "asset", label: "Paired asset" }, amount: { type: "uint", label: "Amount" },
    } } as const;
    const html = renderToStaticMarkup(<ModuleSchemaField schema={schema as never} value={{}} onChange={vi.fn()} path="/module/template" fields={{ "/amount": { decimals: 18, suffix: "ETH" } }} />);
    expect(html).toContain("Fixed by template"); expect(html).toContain(a(99)); expect(html).toContain("Chain 4663"); expect(html).toContain("0.001 ETH");
    expect(html).not.toMatch(/<input|<select|<button/);
  });
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
