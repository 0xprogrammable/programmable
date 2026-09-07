import { readFileSync } from "node:fs";
import { decodeEventLog, toEventSelector, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { GET } from "../app/api/module-mode/indexer/v1/route";
import { moduleModeIndexerContract } from "../lib/module-mode/indexer-contract";
import { PROGRAMMABLE_AGENT_ENTRY } from "../lib/agent-connection";
import { moduleModePublicLaunch } from "../lib/server/robinhood-index/module-source";
import { normalizeModuleModeLaunch } from "../lib/module-mode/provenance";
import nextConfig from "../next.config";
import { moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

describe("public Module Mode indexing contract", () => {
  it("publishes a decodable native ABI and matching topics without requiring credentials", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const contract = await response.json();
    expect(contract.schemaVersion).toBe("programmable.module-mode-indexer.v1");
    expect(contract.release).toMatchObject({ responsePath: "release", required: {
      chainId: 4663, sourceVersion: "module-native-v1", enabled: true, status: "active",
    } });
    const { evidence } = moduleEvidenceFixture();
    const decoded = decodeEventLog({ abi: contract.abi as typeof moduleModeIndexerContract.abi,
      eventName: "ModuleNativeLaunched", data: evidence.event.data,
      topics: evidence.event.topics as [Hex, ...Hex[]], strict: true });
    expect(decoded.eventName).toBe("ModuleNativeLaunched");
    const args = decoded.args;
    expect(args.token.toLowerCase()).toBe(evidence.getLaunch.record.token);
    expect(args.launchWallet.toLowerCase()).toBe(evidence.getLaunch.record.launchWallet);
    for (const event of moduleModeIndexerContract.events) {
      const abi = moduleModeIndexerContract.abi.find(entry => entry.type === "event" && entry.name === event.name)!;
      expect(toEventSelector(abi)).toBe(event.topic0);
    }
  });

  it.each([0, 1, 3, 8])("keeps identity and opaque revisions for a coin with %i synthetic modules", count => {
    const { release, evidence } = moduleEvidenceFixture(0, count);
    // These package IDs are unrelated to the public catalog; historical availability is independent.
    evidence.registry.revisions.forEach(revision => { revision.enabled = false; });
    const row = moduleModePublicLaunch(normalizeModuleModeLaunch(evidence, release), null);
    expect(row.modulePackageIds).toEqual(evidence.program.selections.map(selection => selection.packageId));
    expect(row.moduleFamilyIds).toEqual(evidence.program.families);
    expect(row).toMatchObject({ creator: evidence.getLaunch.record.launchWallet, sourceKind: "module-native-v1", routerAddress: null, stampHash: null });
    expect(Object.keys(row).sort()).toEqual([...moduleModeIndexerContract.normalizedRecord.requiredFields].sort());
  });

  it("links a cold agent to the contract and keeps the downloadable guide identical to GitBook source", async () => {
    const entry = PROGRAMMABLE_AGENT_ENTRY.workflows.moduleIndexing;
    expect(entry.contract).toBe("https://programmable.market/api/module-mode/indexer/v1");
    expect(entry.authenticationRequired).toBe(false);
    expect(readFileSync("public/developers/module-mode-indexing-v1.md", "utf8"))
      .toBe(readFileSync("docs/public/developers/module-mode-indexing.md", "utf8"));
    const redirects = await nextConfig.redirects!();
    for (const name of ["module-mode", "module-mode-indexing", "robinhood-terminal-indexer"]) {
      expect(redirects).toContainEqual({ source: `/docs/developers/${name}`, destination: `/developer-reference/${name}`, permanent: false });
    }
  });
});
