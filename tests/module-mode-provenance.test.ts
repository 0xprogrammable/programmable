import { describe, expect, it } from "vitest";
import preview from "../config/module-mode/robinhood.preview.json";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_DEPENDENCIES, ModuleModeProvenanceError } from "../lib/module-mode/release";
import { normalizeModuleModeLaunch, normalizeModuleModeLaunches } from "../lib/module-mode/provenance";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

function replace(value:unknown,path:string,next:unknown) {
  const keys=path.split("."); let item=value as Record<string,unknown>;
  for(const key of keys.slice(0,-1)) item=item[key] as Record<string,unknown>;
  item[keys.at(-1)!]=next;
}

describe("Module Mode native source provenance",()=>{
  it("binds the genuine native ABI, immutable program and creator without claiming a Custom stamp",()=>{
    const {release,evidence}=moduleEvidenceFixture(); const row=normalizeModuleModeLaunch(evidence,release);
    expect(row.kind).toBe("module-mode"); expect(row.sourceVersion).toBe("module-native-v1");
    expect(row.id).toBe(`4663:${evidence.token.address}`); expect(row.launchWallet).toBe(a(90));
    expect(row.instances).toHaveLength(2); expect(row.revisions.map(r=>r.author)).toEqual([a(300),a(301)]);
    expect(row).not.toHaveProperty("stampHash"); expect(row).not.toHaveProperty("kindEnum");
    expect(Object.isFrozen(row)).toBe(true); expect(Object.isFrozen(row.selections[0])).toBe(true);
  });
  it("supports zero modules and varying UERC20 immutable runtime without inventing authors",()=>{
    const first=moduleEvidenceFixture(0,0); const second=moduleEvidenceFixture(1,0);
    const rows=normalizeModuleModeLaunches([first.evidence,second.evidence],first.release);
    expect(rows).toHaveLength(2); expect(rows[0].selections).toEqual([]); expect(rows[0].revisions).toEqual([]);
    expect(rows[0].tokenRuntimeCodeHash).not.toBe(rows[1].tokenRuntimeCodeHash);
  });
  it("keeps the checked-in profile disabled and unbound",()=>{
    expect(preview.enabled).toBe(false); expect(preview.status).toBe("preview");
    expect(Object.values(preview.contracts).every(pin=>pin.address===null&&pin.runtimeCodeHash===null)).toBe(true);
    expect(()=>bindActiveModuleModeRelease(preview)).toThrow(ModuleModeProvenanceError);
    expect(()=>normalizeModuleModeLaunches([],preview)).toThrow(ModuleModeProvenanceError);
  });
  it.each([
    ["header.chainId",1], ["receipt.status","reverted"], ["event.removed",true], ["event.address",a(999)],
    ["programEvent.transactionHash",h(999)], ["configurationEvent.blockHash",h(888)], ["programEvent.logIndex",10],
    ["tokenIdentityEvent.logIndex",10], ["tokenIdentityEvent.address",a(800)],
    ["getLaunch.record.launchWallet",a(666)], ["identity.version",2], ["identity.record.poolManager",a(777)],
    ["token.creator",a(888)], ["token.factoryPrediction",a(111)], ["token.graffiti",h(99)], ["token.name","Replacement"],
    ["token.totalSupply","999"], ["pool.key.currency0",a(1)], ["pool.key.hooks",a(888)], ["pool.poolId",h(50)],
    ["program.launchKey",h(90)], ["program.engine",a(900)], ["program.routerCodeHash",h(789)], ["program.buyCreatorFeeBps",50],
    ["program.families.1",h(100)], ["program.selections.0.config","0x1234"], ["program.selections.0.callbackGas",100],
    ["program.instances.0.bindingHash",h(222)], ["program.instances.1.module",a(200)], ["program.funding.0","100"],
    ["registry.revisions.0.author",a(0)], ["registry.revisions.0.familyId",h(555)], ["registry.revisions.0.packageId",h(888)],
    ["runtimeReads.0.blockHash",h(345)], ["runtimeReads.0.code","0x"], ["runtimeReads.1.code","0x6000"],
    ["verification.sourceReleaseDigest",h(888)], ["verification.l1Posting.blockNumber","206"],
    ["verification.providers.0.blockHash",h(22)], ["verification.providers.1.trustDomain","fixture-a.invalid"],
    ["verification.providers.3.blockHash",h(77)], ["verification.l2.transactionHash",h(888)],
  ])("rejects altered evidence at %s",(path,value)=>{
    const {release,evidence}=moduleEvidenceFixture(); replace(evidence,path as string,value);
    expect(()=>normalizeModuleModeLaunch(evidence,release)).toThrow(ModuleModeProvenanceError);
  });
  it("retains historical attribution if a revision is disabled after a successful launch",()=>{
    const {release,evidence}=moduleEvidenceFixture(); evidence.registry.revisions[0].enabled=false;
    expect(normalizeModuleModeLaunch(evidence,release).revisions[0].author).toBe(a(300));
  });
  it("rejects repeated identities atomically and rejects partial runtime evidence",()=>{
    const {release,evidence}=moduleEvidenceFixture();
    expect(()=>normalizeModuleModeLaunches([evidence,evidence],release)).toThrow("batch.duplicate-identity");
    evidence.runtimeReads.pop(); expect(()=>normalizeModuleModeLaunch(evidence,release)).toThrow("runtimeReads.length");
  });
  it("rejects unknown release keys and accessor objects before executing getters",()=>{
    const {release,evidence}=moduleEvidenceFixture();
    expect(()=>bindActiveModuleModeRelease({...release,enabledByUser:true})).toThrow("release.keys");
    let accessed=false; Object.defineProperty(evidence.token,"name",{get(){accessed=true;return "x";},enumerable:true});
    expect(()=>normalizeModuleModeLaunch(evidence,release)).toThrow(ModuleModeProvenanceError); expect(accessed).toBe(false);
  });
});


describe("Module Mode immutable release digest", () => {
  it("matches the fixed canonical Keccak identity vector and ignores object key order", () => {
    const { release } = moduleEvidenceFixture();
    expect(computeModuleModeReleaseDigest(release)).toBe("0xd545a5ca686c4e1f381acdc9af54dc71655a8391e24a8a80fabaf01e6ecbc1cb");
    const reordered: Record<string, unknown> = Object.fromEntries(Object.entries(release).reverse());
    reordered.contracts = Object.fromEntries(Object.entries(release.contracts).reverse());
    expect(bindActiveModuleModeRelease(reordered).releaseDigest).toBe(release.releaseDigest);
  });
  it.each([
    ["sourceCommit", "b".repeat(40)], ["startBlock", "51"], ["minimumInitialBuyNative", "1001"],
    ["tokenCreationCodeHash", h(333)],
    ...MODULE_MODE_DEPENDENCIES.flatMap((role, index) => [[`contracts.${role}.address`, a(10000 + index)], [`contracts.${role}.runtimeCodeHash`, h(20000 + index)]]),
  ])("binds %s into the immutable identity", (path, value) => {
    const { release } = moduleEvidenceFixture(); const old = release.releaseDigest;
    replace(release, path, value);
    expect(computeModuleModeReleaseDigest(release)).not.toBe(old);
    expect(() => bindActiveModuleModeRelease(release)).toThrow("release.computedDigest");
  });
  it.each([["schemaVersion", "other"], ["sourceVersion", "other"], ["chainId", 1], ["finalityPolicy", "unfinalized"]])("rejects another fixed identity at %s", (path, value) => {
    const { release } = moduleEvidenceFixture(); replace(release, path as string, value);
    expect(() => computeModuleModeReleaseDigest(release)).toThrow(ModuleModeProvenanceError);
  });
  it("keeps activation/evidence outside the identity while requiring separate active bindings", () => {
    const { release } = moduleEvidenceFixture(); const expected = release.releaseDigest;
    for (const field of ["deploymentEvidenceDigest", "sourceVerificationDigest", "lifecycleEvidenceDigest"] as const) release[field] = h(4567);
    expect(computeModuleModeReleaseDigest(release)).toBe(expected);
    expect(bindActiveModuleModeRelease(release).releaseDigest).toBe(expected);
    expect(computeModuleModeReleaseDigest({ ...release, enabled: false, status: "preview" })).toBe(expected);
    expect(() => bindActiveModuleModeRelease({ ...release, enabled: false })).toThrow("release.enabled");
  });
});
