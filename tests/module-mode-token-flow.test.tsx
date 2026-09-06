import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RobinhoodTokenView } from "../components/robinhood-token-view";
import { isRobinhoodModuleLaunch, robinhoodLaunchDescription, robinhoodModuleManageHref, type RobinhoodLaunch } from "../lib/robinhood-launches";
import { readRobinhoodProfileResponse } from "../lib/profile/robinhood-profile";
import { normalizeModuleModeLaunches } from "../lib/module-mode/provenance";
import { moduleModePublicLaunch } from "../lib/server/robinhood-index/module-source";
import { bindActiveModuleModeRelease } from "../lib/module-mode/release";
import { launchList, profileLaunchList, snapshotLaunches, type RobinhoodSnapshot } from "../lib/server/robinhood-index/model";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

vi.mock("../components/use-robinhood-presentation", () => ({ useRobinhoodPresentation: () => ({ items: [], loading: false }) }));
const now = Date.parse("2026-09-06T00:00:00.000Z");
function moduleRow(count = 2) {
  const f = moduleEvidenceFixture(0, count);
  return moduleModePublicLaunch(normalizeModuleModeLaunches([f.evidence], bindActiveModuleModeRelease(f.release))[0], new Date(now).toISOString());
}
function customRow(): RobinhoodLaunch {
  return { routerAddress: a(900), launchId: h(910), tokenAddress: a(901), hookAddress: a(902), creator: a(90), poolManager: a(903),
    poolId: h(911), stampHash: h(912), transactionHash: h(913), blockNumber: "90", blockHash: h(390), logIndex: 1,
    launchedAt: new Date(now).toISOString(), name: "Custom fixture", symbol: "C", decimals: 18 };
}
function snapshot(): RobinhoodSnapshot {
  const row = moduleRow();
  return { version: 1, chainId: 4663, routerAddress: a(900), binding: h(914), startBlock: "50", cursor: { number: "100", hash: h(400) },
    checkpoints: [], finalizedBlock: "100", updatedAt: new Date(now).toISOString(), items: [customRow()],
    moduleMode: { version: 1, sourceKind: "module-native-v1", chainId: 4663, sourceAddress: row.sourceAddress, releaseDigest: row.sourceReleaseDigest,
      startBlock: "50", finalizedBlock: "100", updatedAt: new Date(now).toISOString(), cursor: { number: "100", hash: h(400) }, checkpoints: [], items: [row] } };
}

describe("Module Mode token identity and navigation", () => {
  it("shows native source identity and its real manage route without a Custom stamp claim", () => {
    const token = moduleRow();
    const html = renderToStaticMarkup(<RobinhoodTokenView address={token.tokenAddress} token={token} status="ready" />);
    expect(html).toContain("Programmable · Module Mode"); expect(html).toContain("2 modules");
    expect(html).toContain(`/launch/modules/manage/${token.tokenAddress}`);
    expect(html).toContain(`/launch/modules/manage/${token.tokenAddress}#trade`);
    expect(html).toContain(`/profile?account=${token.creator}`);
    expect(html).toContain(`/tx/${token.transactionHash}`);
    expect(html).not.toMatch(/Custom|launch stamp/);
    expect(robinhoodLaunchDescription(token)).toContain("Module Mode launch");
    expect(robinhoodLaunchDescription(token)).not.toContain("stamp");
  });
  it("supports a plain native coin and preserves the established Custom presentation", () => {
    const base = moduleRow(0);
    expect(renderToStaticMarkup(<RobinhoodTokenView address={base.tokenAddress} token={base} status="ready" />)).toContain("Base coin");
    const custom = customRow();
    expect(robinhoodLaunchDescription(custom)).toContain("Custom launch");
    expect(robinhoodModuleManageHref(custom)).toBeNull();
    expect(renderToStaticMarkup(<RobinhoodTokenView address={custom.tokenAddress} token={custom} status="ready" />)).not.toContain("Manage coin");
  });
  it("does not label an unindexed token or a receipt as a canonical Module launch", () => {
    const { evidence } = moduleEvidenceFixture();
    expect(isRobinhoodModuleLaunch(evidence.receipt)).toBe(false);
    expect(isRobinhoodModuleLaunch({ sourceKind: "module-native-v1", tokenAddress: a(1) })).toBe(false);
    expect(renderToStaticMarkup(<RobinhoodTokenView address={a(1)} token={null} status="syncing" />)).not.toContain("Manage coin");
  });
  it.each([
    { stampHash: h(1) }, { routerAddress: a(1) }, { verificationDigest: undefined }, { sourceReleaseDigest: h(0) },
    { runtime: a(0) }, { sourceKind: "other-native-v1" }, { moduleFamilyIds: [h(100), h(100)] }, { modulePackageIds: [] },
  ])("rejects incomplete or disguised Module data %j", change => {
    const row = { ...moduleRow(), ...change };
    expect(isRobinhoodModuleLaunch(row)).toBe(false);
    const response = { ...profileLaunchList(snapshot(), a(90), 1, now), items: [row] };
    expect(() => readRobinhoodProfileResponse(response, a(90))).toThrow("Invalid profile launch");
  });
  it("retains the native source through Explore and the launch wallet's profile, excluding pending rows", () => {
    const saved = snapshot(); const row = saved.moduleMode!.items[0];
    const list = launchList(saved, 1, "", now); const profile = profileLaunchList(saved, a(90), 1, now);
    expect(list.items.find(item => item.sourceKind === "module-native-v1")).toEqual(row);
    expect(readRobinhoodProfileResponse(profile, a(90)).items).toContainEqual(row);
    expect(profileLaunchList(saved, a(999), 1, now).items).toEqual([]);
    expect(snapshotLaunches(saved)).toHaveLength(2);
    saved.moduleMode!.pending = { block: { number: "100", hash: h(400) }, items: [row] }; saved.moduleMode!.items = [];
    expect(launchList(saved, 1, "", now).items).not.toContainEqual(row);
    expect(profileLaunchList(saved, a(90), 1, now).items).not.toContainEqual(row);
  });
  it("makes stale index status explicit while retaining verified identity", () => {
    const token = moduleRow();
    const html = renderToStaticMarkup(<RobinhoodTokenView address={token.tokenAddress} token={token} status="stale" />);
    expect(html).toContain("Showing the last verified launch record"); expect(html).toContain("Manage coin");
  });
});
