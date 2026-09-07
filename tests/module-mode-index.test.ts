import { describe, expect, it, vi } from "vitest";
import configuredRelease from "../config/module-mode/robinhood.preview.json";
import { bindActiveModuleModeRelease } from "../lib/module-mode/release";
import type { RobinhoodLaunch } from "../lib/robinhood-launches";
import { launchList, parseSnapshot, profileLaunchList, type RobinhoodSnapshot } from "../lib/server/robinhood-index/model";
import type { IndexStore } from "../lib/server/robinhood-index/store";
import { configuredModuleModeSource, moduleModeSource, type ModuleModeFinalizedCollector } from "../lib/server/robinhood-index/module-source";
import { syncModuleModeIndex, syncRobinhoodIndex, type IndexSource } from "../lib/server/robinhood-index/sync";
import { a, h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";
const now = Date.parse("2026-09-05T12:00:00Z");
const point = (n:bigint|number) => ({number:String(n),hash:h(Number(n)+300)});
const options = {now:()=>now,rangeSize:10000n};

function customRow():RobinhoodLaunch {return {routerAddress:a(900),launchId:h(910),tokenAddress:a(901),hookAddress:a(902),creator:a(90),poolManager:a(903),poolId:h(911),stampHash:h(912),transactionHash:h(913),blockNumber:"90",blockHash:h(390),logIndex:1,launchedAt:new Date(now).toISOString(),name:"Custom",symbol:"C",decimals:18};}
function baseSnapshot():RobinhoodSnapshot {return {version:1,chainId:4663,routerAddress:a(900),binding:h(914),startBlock:"50",cursor:point(199),checkpoints:[point(99),point(199)],finalizedBlock:"199",updatedAt:new Date(now).toISOString(),items:[customRow()]};}
function memoryStore(initial:RobinhoodSnapshot=baseSnapshot()) {
  let current=structuredClone(parseSnapshot(initial)); let revision=1;
  const write=vi.fn(async (snapshot:RobinhoodSnapshot,etag:string|null)=>{
    if(etag!==`revision-${revision}`) throw new Error("Compare-and-swap conflict");
    current=structuredClone(parseSnapshot(snapshot)); revision++;
  });
  const store:IndexStore={read:async()=>({snapshot:structuredClone(current),etag:`revision-${revision}`}),write};
  return {store,write,read:()=>current,concurrentWrite:()=>{revision++;}};
}
function collector(entries=[moduleEvidenceFixture().evidence]):ModuleModeFinalizedCollector {
  return {
    authenticateRelease:vi.fn(async()=>{}),
    finalizedBoundary:vi.fn<ModuleModeFinalizedCollector["finalizedBoundary"]>(async release=>({chainId:4663,sourceReleaseDigest:release.releaseDigest,blockNumber:"199",blockHash:point(199).hash,verificationDigest:h(920)})),
    canonicalBlock:vi.fn<ModuleModeFinalizedCollector["canonicalBlock"]>(async(_release,n)=>({chainId:4663,blockNumber:String(n),blockHash:point(n).hash})),
    collectRange:vi.fn<ModuleModeFinalizedCollector["collectRange"]>(async(release,from,to)=>({sourceReleaseDigest:release.releaseDigest,fromBlock:String(from),toBlock:String(to),complete:true,
      launches:entries.filter(entry=>BigInt(entry.header.blockNumber)>=from&&BigInt(entry.header.blockNumber)<=to).map(evidence=>({evidence,launchedAt:new Date(now).toISOString()}))})),
  };
}

describe("Module Mode joins the canonical Robinhood index",()=>{
  it("adds native coins and preserves Custom provenance in one saved profile/Explore list",async()=>{
    const {release}=moduleEvidenceFixture(); const source=await moduleModeSource(release,collector()); const saved=memoryStore();
    const before=structuredClone(saved.read().items);
    expect(await syncModuleModeIndex(source,saved.store,options)).toMatchObject({status:"ready",launches:1,indexedThrough:"199"});
    expect(saved.read().items).toEqual(before); expect(saved.read().moduleMode?.items).toHaveLength(1);
    expect(saved.read().moduleMode?.items[0]).toMatchObject({creator:a(90),sourceKind:"module-native-v1",routerAddress:null,stampHash:null});
    expect(launchList(saved.read(),1,"",now).items).toHaveLength(2);
    expect(profileLaunchList(saved.read(),a(90),1,now).items).toHaveLength(2);
    expect(profileLaunchList(saved.read(),a(300),1,now).items).toHaveLength(0);
  });
  it("uses the same CAS fence and does not overwrite another worker's checkpoint",async()=>{
    const saved=memoryStore(); const c=collector(); const original=c.collectRange;
    c.collectRange=async(...args)=>{const value=await original(...args);saved.concurrentWrite();return value;};
    const source=await moduleModeSource(moduleEvidenceFixture().release,c);
    await expect(syncModuleModeIndex(source,saved.store,options)).rejects.toThrow("Compare-and-swap");
    expect(saved.read().moduleMode).toBeUndefined(); expect(saved.read().items).toEqual([customRow()]);
  });
  it("rejects a partial or tampered scan without committing any member of that range",async()=>{
    const second=moduleEvidenceFixture(1).evidence; second.program.selections[0].config="0x01";
    const source=await moduleModeSource(moduleEvidenceFixture().release,collector([moduleEvidenceFixture().evidence,second]));
    const saved=memoryStore();
    expect(await syncModuleModeIndex(source,saved.store,options)).toMatchObject({status:"partial",launches:0,indexedThrough:null});
    expect(saved.write).not.toHaveBeenCalled(); expect(saved.read().moduleMode).toBeUndefined();
  });
  it("rewinds only the Module slice when its canonical checkpoint changes",async()=>{
    const fixture=moduleEvidenceFixture();const saved=memoryStore();
    await syncModuleModeIndex(await moduleModeSource(fixture.release,collector()),saved.store,{...options,rangeSize:50n});
    expect(saved.read().moduleMode?.items).toHaveLength(1);
    const originalCustom=structuredClone(saved.read().items); const c=collector([]);
    c.canonicalBlock=async(_release,n)=>({chainId:4663,blockNumber:String(n),blockHash:n>=100n?h(Number(n)+1000):point(n).hash});
    c.finalizedBoundary=async release=>({chainId:4663,sourceReleaseDigest:release.releaseDigest,blockNumber:"199",blockHash:h(1199),verificationDigest:h(921)});
    const result=await syncModuleModeIndex(await moduleModeSource(fixture.release,c),saved.store,{...options,rangeSize:50n});
    expect(result).toMatchObject({status:"ready",rewound:true,launches:0});
    expect(saved.read().items).toEqual(originalCustom); expect(saved.read().moduleMode?.cursor?.hash).toBe(h(1199));
  });
  it("preserves the Module slice when the established Custom source advances",async()=>{
    const fixture=moduleEvidenceFixture();const saved=memoryStore();
    await syncModuleModeIndex(await moduleModeSource(fixture.release,collector()),saved.store,options);
    const modules=structuredClone(saved.read().moduleMode);
    const source:IndexSource={routerAddress:a(900),binding:h(914),startBlock:50n,finalized:point(299),block:async n=>point(n),launches:async()=>[]};
    expect(await syncRobinhoodIndex(source,saved.store,options)).toMatchObject({status:"ready",indexedThrough:"299"});
    expect(saved.read().moduleMode).toEqual(modules); expect(saved.read().items).toEqual([customRow()]);
  });
  it("keeps last verified rows visible with stale status during source failure",async()=>{
    const fixture=moduleEvidenceFixture();const saved=memoryStore();
    await syncModuleModeIndex(await moduleModeSource(fixture.release,collector()),saved.store,options);
    const c=collector();c.collectRange=async()=>{throw new Error("Provider unavailable");};
    expect(await syncModuleModeIndex(await moduleModeSource(fixture.release,c),saved.store,options)).toMatchObject({status:"partial"});
    expect(profileLaunchList(saved.read(),a(90),1,now+300001)).toMatchObject({status:"stale",page:{totalItems:2}});
  });
  it("rejects a module disguised as a Custom stamp and cross-source duplicate tokens",async()=>{
    const fixture=moduleEvidenceFixture();const saved=memoryStore();
    await syncModuleModeIndex(await moduleModeSource(fixture.release,collector()),saved.store,options);
    const snapshot=structuredClone(saved.read()); snapshot.moduleMode!.items[0]={...snapshot.moduleMode!.items[0],stampHash:h(1)} as never;
    expect(()=>parseSnapshot(snapshot)).toThrow("Invalid Module Mode launch");
    const duplicate=structuredClone(saved.read()); duplicate.items[0]={...duplicate.items[0],tokenAddress:duplicate.moduleMode!.items[0].tokenAddress};
    expect(()=>parseSnapshot(duplicate)).toThrow("Duplicate cross-source");
  });
  it("requires explicit migration for release/source changes without rewriting historical records",async()=>{
    const fixture=moduleEvidenceFixture(); const saved=memoryStore();
    const source=await moduleModeSource(fixture.release,collector());await syncModuleModeIndex(source,saved.store,options);
    await expect(syncModuleModeIndex({...source,releaseDigest:h(998)},saved.store,options)).rejects.toThrow("index migration required");
    expect(saved.read().moduleMode?.releaseDigest).toBe(fixture.release.releaseDigest);
  });
  it("keeps independent historical checkpoints and preserves every source when another generation advances", async () => {
    const saved = memoryStore();
    const original = await moduleModeSource(moduleEvidenceFixture().release, collector());
    await syncModuleModeIndex(original, saved.store, options);
    const first = structuredClone(saved.read().moduleMode);
    const next = { ...original, sourceAddress: a(990), releaseDigest: h(991),
      launches: async () => first!.items.map(row => ({ ...row, sourceAddress: a(990), sourceReleaseDigest: h(991),
        tokenAddress: a(992), launchId: h(993), poolId: h(994), transactionHash: h(995) })) };
    await syncModuleModeIndex(next, saved.store, options);
    expect(saved.read().moduleMode).toEqual(first);
    expect(saved.read().moduleModeSources).toHaveLength(1);
    expect(profileLaunchList(saved.read(), a(90), 1, now).page.totalItems).toBe(3);
    expect(launchList(saved.read(), 1, "", now).page.totalItems).toBe(3);
    const second = structuredClone(saved.read().moduleModeSources);
    await syncModuleModeIndex(original, saved.store, options);
    expect(saved.read().moduleModeSources).toEqual(second);
    await syncModuleModeIndex(next, saved.store, options);
    expect(saved.read().moduleModeSources).toEqual(second);
    const broken = { ...next, finalized: { number: "199", hash: h(1199) },
      block: async (n: bigint) => ({ number: String(n), hash: h(Number(n) + 1000) }), launches: async () => [] };
    expect(await syncModuleModeIndex(broken, saved.store, options)).toMatchObject({ rewound: true, status: "ready" });
    expect(saved.read().moduleMode).toEqual(first);
    expect(saved.read().moduleModeSources?.[0].items).toEqual([]);
  });
  it("rejects cross-generation token/pool duplication and source identity collisions before saving", async () => {
    const saved = memoryStore();
    const source = await moduleModeSource(moduleEvidenceFixture().release, collector());
    await syncModuleModeIndex(source, saved.store, options);
    const before = structuredClone(saved.read());
    const row = before.moduleMode!.items[0];
    const duplicate = { ...source, sourceAddress: a(990), releaseDigest: h(991),
      launches: async () => [{ ...row, sourceAddress: a(990), sourceReleaseDigest: h(991), launchId: h(992) }] };
    await expect(syncModuleModeIndex(duplicate, saved.store, options)).rejects.toThrow("Duplicate cross-source");
    expect(saved.read()).toEqual(before);
    const repeated = structuredClone(before);
    repeated.moduleModeSources = [structuredClone(repeated.moduleMode!)];
    expect(() => parseSnapshot(repeated)).toThrow("Duplicate Module Mode source");
  });
  it("authenticates the checked-in active release before exposing its index source",async()=>{
    const release=bindActiveModuleModeRelease(configuredRelease); const c=collector([]);
    const boundary=point(BigInt(release.startBlock)+199n);
    c.finalizedBoundary=vi.fn(async()=>({chainId:4663 as const,sourceReleaseDigest:release.releaseDigest,
      blockNumber:boundary.number,blockHash:boundary.hash,verificationDigest:h(920)}));
    expect(await configuredModuleModeSource(c)).toMatchObject({sourceKind:"module-native-v1",
      sourceAddress:release.contracts.launcher.address,releaseDigest:release.releaseDigest,
      startBlock:BigInt(release.startBlock),finalized:boundary});
    expect(c.authenticateRelease).toHaveBeenCalledExactlyOnceWith(release);
    expect(c.collectRange).not.toHaveBeenCalled();
  });
  it("keeps an unbound preview disabled without calling a collector",async()=>{
    vi.resetModules();
    vi.doMock("../config/module-mode/robinhood.preview.json",()=>({default:{...configuredRelease,
      enabled:false,status:"preview",lifecycleEvidenceDigest:null}}));
    try {
      const {configuredModuleModeSource:previewSource}=await import("../lib/server/robinhood-index/module-source");
      const c=collector(); expect(await previewSource(c)).toBeNull();
      expect(c.authenticateRelease).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../config/module-mode/robinhood.preview.json");
      vi.resetModules();
    }
  });
  it("rejects an unauthenticated release and does not fabricate a fresh Custom snapshot",async()=>{
    const c=collector();c.authenticateRelease=async()=>{throw new Error("Invalid release authority");};
    await expect(moduleModeSource(moduleEvidenceFixture().release,c)).rejects.toThrow("Invalid release authority");
    const source=await moduleModeSource(moduleEvidenceFixture().release,collector());
    await expect(syncModuleModeIndex(source,{read:async()=>null,write:vi.fn()},options)).rejects.toThrow("must be initialized");
  });
  it("rejects omitted-range completion and wrong canonical hashes before returning visible records",async()=>{
    const c=collector();const original=c.collectRange;c.collectRange=async(...args)=>({...await original(...args),complete:false} as never);
    const source=await moduleModeSource(moduleEvidenceFixture().release,c);
    await expect(source.launches(50n,199n,[])).rejects.toThrow("incomplete");
    const changed=collector(); changed.canonicalBlock=async(_release,n)=>({chainId:4663,blockNumber:String(n),blockHash:n===100n?h(888):point(n).hash});
    const changedSource=await moduleModeSource(moduleEvidenceFixture().release,changed);
    await expect(changedSource.launches(50n,199n,[])).rejects.toThrow("block changed");
  });
});
