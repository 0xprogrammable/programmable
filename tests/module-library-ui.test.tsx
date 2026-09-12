import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModuleLibrary } from "@/components/module-library";
import { ModuleEngineLibrary } from "@/components/module-engine-library";
import { moduleModeFeePolicy } from "@/lib/module-mode/builder";
import type { ModuleLibraryEntry } from "@/lib/module-mode/library";
import { bindNativeCatalogEntry } from "@/lib/module-mode/native-catalog";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2 } from "@/lib/module-mode/release";
import catalog from "@/config/module-mode/catalog.json";
import { fixture } from "./module-engine-fixture";
import { h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

const entry = bindNativeCatalogEntry(catalog.entries[0].entry);
const base = moduleEvidenceFixture().release;
const identity = { ...base, schemaVersion: "programmable.module-mode-source.v2", sourceVersion: "module-native-v2", economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 };
const release = bindActiveModuleModeRelease({ ...identity, releaseDigest: computeModuleModeReleaseDigest(identity) });
const actions = { onAdd: vi.fn(), onRemove: vi.fn() };
const engineEntry: ModuleLibraryEntry & { kind: "engine" } = {
  id: "any-quote", title: "Any Quote", summary: "Choose a quote token", status: "available", kind: "engine",
  discovery: { category: "pairs/quote-assets", author: "0xd88539d3c4c460136a733a3fd60cf6bf269079da" },
};

describe("Module selection presentation", () => {
  it("shows the release-bound fee before adding, and makes the selected action explicit", () => {
    const html = renderToStaticMarkup(<ModuleLibrary catalog={[entry]} selectedIds={[entry.id]} {...actions}
      feePolicyFor={candidate => moduleModeFeePolicy(release, [candidate])} />);
    expect(html).toContain("Estimated platform fee: 0.30% per trade.");
    expect(html).toContain(`aria-label="Remove ${entry.title}"`);
    expect(html).toMatch(/>Remove<\/button>/);
    expect(html).not.toContain("Draft only");
  });

  it("uses the same cards for presentation entries, overriding their fee while retaining native fee policy", () => {
    const feePolicyFor = vi.fn((candidate: typeof entry | typeof engineEntry) => {
      if ("kind" in candidate) throw new Error("Presentation entries have no native fee policy.");
      return moduleModeFeePolicy(release, [candidate]);
    });
    const html = renderToStaticMarkup(<ModuleLibrary catalog={[entry, engineEntry]} selectedIds={[]} {...actions}
      feeDescriptionFor={candidate => "kind" in candidate ? "Platform fee: 0.30% in ETH per trade." : undefined}
      feePolicyFor={feePolicyFor} />);
    expect(html.match(/<article /gu)).toHaveLength(2);
    expect(html).toContain('aria-label="Add Any Quote"');
    expect(html).toContain('data-category="pairs"');
    expect(html).toContain("Platform fee: 0.30% in ETH per trade.");
    expect(html).toContain("Estimated platform fee: 0.30% per trade.");
    expect(html).toContain("By 0xd885…79da");
    expect(feePolicyFor).toHaveBeenCalledExactlyOnceWith(entry);
  });

  it("explains a blocked addition accessibly while allowing selected modules to be removed", () => {
    const reason = "Remove the current module before adding this one.";
    const html = renderToStaticMarkup(<ModuleLibrary catalog={[entry, engineEntry]} selectedIds={[entry.id]} {...actions}
      feeDescriptionFor={() => "Platform fee: 0.30% per trade."} disabledFor={() => reason} />);
    const add = html.match(/<button[^>]+aria-label="Add Any Quote"[^>]*>/u)?.[0];
    const remove = html.match(new RegExp(`<button[^>]+aria-label="Remove ${entry.title}"[^>]*>`, "u"))?.[0];
    expect(add).toContain('disabled=""');
    expect(remove).toBeDefined();
    expect(remove).not.toContain('disabled=""');
    const descriptionIds = add?.match(/aria-describedby="([^"]+)"/u)?.[1].split(" ");
    expect(descriptionIds).toHaveLength(2);
    for (const id of descriptionIds ?? []) expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`>${reason}</div>`);
  });

  it("disables both addition and removal while a global operation is pending", () => {
    const html = renderToStaticMarkup(<ModuleLibrary catalog={[entry, engineEntry]} selectedIds={[entry.id]} {...actions} disabled />);
    const buttons = [...html.matchAll(/<button[^>]+aria-label="(?:Add|Remove) [^"]+"[^>]*>/gu)].map(match => match[0]);
    expect(buttons).toHaveLength(2);
    expect(buttons.every(button => button.includes('disabled=""'))).toBe(true);
  });

  it("does not invent an author fee for an ineligible family or missing eligibility", () => {
    const ineligible = { ...entry, nativeBinding: { ...entry.nativeBinding, feeEligibility: { eligible: false, reviewDigest: h(0) } } };
    const known = renderToStaticMarkup(<ModuleLibrary catalog={[ineligible]} selectedIds={[]} {...actions}
      feePolicyFor={candidate => moduleModeFeePolicy(release, [candidate])} />);
    const unknown = renderToStaticMarkup(<ModuleLibrary catalog={[entry]} selectedIds={[]} {...actions} feePolicyFor={() => null} />);
    const unbound = renderToStaticMarkup(<ModuleLibrary catalog={[entry]} selectedIds={[]} {...actions} />);
    expect(known).toContain("Estimated platform fee: 0.10% per trade.");
    expect(unknown).toContain("Platform fee unavailable.");
    expect(unknown).not.toContain("0.30%");
    expect(unbound).not.toContain("Estimated platform fee");
  });

  it("does not offer a filter reset when no catalog exists", () => {
    const html = renderToStaticMarkup(<ModuleLibrary catalog={[]} selectedIds={[]} {...actions} />);
    expect(html).toContain("No modules available yet");
    expect(html).toContain('href="/developers/modules"');
    expect(html).not.toContain("Clear filters");
  });

  it("only offers categories represented by actual engine templates", () => {
    const first = fixture().template;
    const second = structuredClone(first);
    second.manifest.manifest.catalogDefinition.interface = "settlement-v1";
    second.manifest.manifest.catalogDefinition.id = "payment-fixture";
    second.manifestHash = h(500);
    const html = renderToStaticMarkup(<ModuleEngineLibrary templates={[first, second]} selectedId="" onSelect={vi.fn()} />);
    expect([...html.matchAll(/<option value="([^"]+)"/gu)].map(match => match[1])).toEqual(["all", "escrow-v1", "settlement-v1"]);
    expect(html).not.toContain('value="quote-v1"');
    expect(html).not.toContain('value="custom-v1"');
  });

  it("hides search and category controls for a single engine template", () => {
    const html = renderToStaticMarkup(<ModuleEngineLibrary templates={[fixture().template]} selectedId="" onSelect={vi.fn()} />);
    expect(html).toMatch(/<div[^>]+hidden=""><div[^>]+><label[^>]+for="[^"]+-search"/u);
    expect(html).toMatch(/<label[^>]+hidden=""><span[^>]+>Module category<\/span>/u);
  });
});
