import { describe, expect, it, vi } from "vitest";
import { bindActiveModuleModeRelease } from "../lib/module-mode/release";
import { createModuleModeHttpCollector, moduleModeSource } from "../lib/server/robinhood-index/module-source";
import { IndexRangeTooWide } from "../lib/server/robinhood-index/sync";
import { h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";
const SERVICE_TOKEN="synthetic-service-test-credential-0123456789";
const origin="https://api.programmable.market";
const schemaVersion="programmable.module-mode-index.v1";
function factory(fetchBackend:typeof fetch) { return createModuleModeHttpCollector({backendBaseUrl:origin,websiteToken:SERVICE_TOKEN,fetchBackend}); }
const ok=(result:unknown)=>Response.json({schemaVersion,result});

describe("Private finalized Module Mode collector transport",()=>{
  it("uses only service auth and bounded release/block/range selectors",async()=>{
    const fixture=moduleEvidenceFixture();const release=bindActiveModuleModeRelease(fixture.release);
    const calls:{url:string;init:RequestInit}[]=[];
    const request=vi.fn<typeof fetch>(async(url,init)=>{
      calls.push({url:String(url),init:init!});
      if(String(url).endsWith("/release")) return ok(release);
      if(String(url).endsWith("/boundary")) return ok({chainId:4663,sourceReleaseDigest:release.releaseDigest,blockNumber:"100",blockHash:h(400),verificationDigest:h(700)});
      if(String(url).endsWith("/block")) return ok({chainId:4663,blockNumber:"100",blockHash:h(400)});
      return ok({sourceReleaseDigest:release.releaseDigest,fromBlock:"50",toBlock:"100",complete:true,launches:[{evidence:fixture.evidence,launchedAt:null}]});
    });
    const source=await moduleModeSource(release,factory(request));
    expect(await source.launches(50n,100n,[])).toHaveLength(1);
    for(const call of calls) {
      expect(call.url).toMatch(/^https:\/\/api\.programmable\.market\/internal\/module-mode-index\/v1\/(release|boundary|block|range)$/);
      expect(call.init).toMatchObject({method:"POST",redirect:"error",cache:"no-store"});
      expect(call.init.headers).toMatchObject({authorization:`Bearer ${SERVICE_TOKEN}`});
      const body=JSON.parse(String(call.init.body)); expect(body.sourceReleaseDigest).toBe(release.releaseDigest);
      expect(Object.keys(body).every(key=>["sourceReleaseDigest","blockNumber","fromBlock","toBlock"].includes(key))).toBe(true);
      expect(String(call.init.body)).not.toContain(SERVICE_TOKEN);
      expect(call.init.signal).toBeInstanceOf(AbortSignal);
    }
  });
  it("compares the complete activation proof after checking the immutable release digest",async()=>{
    const {release}=moduleEvidenceFixture();
    const request=vi.fn<typeof fetch>(async()=>ok({...release,lifecycleEvidenceDigest:h(1)}));
    await expect(factory(request).authenticateRelease(bindActiveModuleModeRelease(release))).rejects.toThrow("active release differs");
  });
  it.each(["http://api.programmable.market","https://user:password@api.programmable.market","https://api.programmable.market/path","https://api.programmable.market?secret=x","https://api.programmable.market#fragment"])("rejects another origin shape %s before transmitting a credential",url=>{
    const request=vi.fn<typeof fetch>();
    expect(()=>createModuleModeHttpCollector({backendBaseUrl:url,websiteToken:SERVICE_TOKEN,fetchBackend:request})).toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("treats only the exact bounded-range error as a request to split",async()=>{
    const release=bindActiveModuleModeRelease(moduleEvidenceFixture().release);
    const request=vi.fn<typeof fetch>(async()=>Response.json({schemaVersion,error:{code:"MODULE_INDEX_RANGE_TOO_WIDE"}},{status:413}));
    await expect(factory(request).collectRange(release,50n,100n)).rejects.toBeInstanceOf(IndexRangeTooWide);
    request.mockImplementation(async()=>Response.json({schemaVersion,error:{code:"MODULE_INDEX_FINALITY_PENDING"}},{status:503}));
    await expect(factory(request).collectRange(release,50n,100n)).rejects.toThrow("has not verified");
  });
  it("rejects duplicate JSON fields, unexpected envelopes and oversized bodies",async()=>{
    const release=bindActiveModuleModeRelease(moduleEvidenceFixture().release);
    const request=vi.fn<typeof fetch>(async()=>new Response('{"schemaVersion":"programmable.module-mode-index.v1","schemaVersion":"programmable.module-mode-index.v1","result":{}}',{headers:{"content-type":"application/json"}}));
    await expect(factory(request).finalizedBoundary(release)).rejects.toThrow("response is invalid");
    request.mockImplementation(async()=>Response.json({schemaVersion,result:{},verified:true}));
    await expect(factory(request).finalizedBoundary(release)).rejects.toThrow("collector.response.keys");
    request.mockImplementation(async()=>new Response("{}",{headers:{"content-type":"application/json","content-length":String(16*1024*1024+1)}}));
    await expect(factory(request).finalizedBoundary(release)).rejects.toThrow("budget");
  });
  it("does not expose upstream exception details or follow a redirect with the service credential",async()=>{
    const release=bindActiveModuleModeRelease(moduleEvidenceFixture().release);
    const request=vi.fn<typeof fetch>(async()=>{throw new Error(`upstream echoed ${SERVICE_TOKEN}`);});
    await expect(factory(request).authenticateRelease(release)).rejects.toThrow("Module Mode collector request is unavailable");
    expect(request.mock.calls[0][1]?.redirect).toBe("error");
  });
});
