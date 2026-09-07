import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { moduleHash } from "../../lib/module-mode/release";
import { canonicalizeJson } from "../../lib/server/projection-target/canonical-json";
import type { ModuleEngineReleaseIdentity } from "../../lib/module-engine/catalog";
import { reviewRecord } from "../../lib/module-mode/review-contract";
import { acceptedDecision, need, same, type AuthenticatedReview, type createAuthenticatedReviewReader } from "./review";
import { createEngineHostPreparation, prepareEnginePublication, type EnginePublicationDefinition } from "./core-engine";
import { readEnginePublicationOwner, observeEnginePublicationReadback } from "./rpc-engine";
import { publicationRpc, type PublicationProvider } from "./rpc";

/** Called only by the existing operator, after its session and private output checks. */
export async function runEnginePublication(input: {command:string;identity:unknown;definition:unknown;review:AuthenticatedReview;
  reader:ReturnType<typeof createAuthenticatedReviewReader>;output:string;providers:()=>Promise<(Omit<PublicationProvider,"rpc">&{url:string})[]>;readTransactions:()=>Promise<unknown>}) {
  const {command,review,output}=input;
  need(["manifest","prepare","export"].includes(command),"Unknown engine publication command");
  const definition=input.definition as EnginePublicationDefinition,host=createEngineHostPreparation(review,input.identity as ModuleEngineReleaseIdentity,definition);
  let plan:ReturnType<typeof prepareEnginePublication>|undefined;
  let evidence:Awaited<ReturnType<typeof observeEnginePublicationReadback>>|undefined;
  if(command!=="manifest") {
    acceptedDecision(review);
    const providers=(await input.providers()).map(({url,...binding})=>({...binding,rpc:publicationRpc(url)}));
    const owner=await readEnginePublicationOwner(host.release,providers);
    plan=prepareEnginePublication(review,host.release,definition,owner);
    if(command==="export") {
      const tx=reviewRecord(await input.readTransactions(),["family","revision"]);
      evidence=await observeEnginePublicationReadback(plan,review,providers,{family:tx.family===null?null:moduleHash(tx.family,"family.transaction"),revision:moduleHash(tx.revision,"revision.transaction")});
      const fresh=await input.reader.read(review.job.subject.submissionId);
      same(prepareEnginePublication(fresh,host.release,definition,owner),plan,"Review changed during engine onchain readback");
    }
  }
  await mkdir(output,{mode:0o700});
  const write=(name:string,value:unknown)=>writeFile(path.join(output,name),`${canonicalizeJson(value)}\n`,{flag:"wx",mode:0o600});
  if(command==="manifest") {await write("manifest.json",host.manifest);await write("host-preparation.json",host);}
  else {
    await write("unsigned-plan.json",plan);
    // Kept nonavailable. Canonical inclusion cannot stand in for Ethereum finality or protected website publication.
    await write("catalog-preparation.json",plan!.catalogPreparation);
    if(command==="export") {
      const packageId=host.manifest.manifest.revision.packageId,directory=path.join(output,"public","developers","modules",packageId);
      await mkdir(directory,{recursive:true,mode:0o700});
      await writeFile(path.join(directory,"source.json"),review.sourceBytes,{flag:"wx",mode:0o600});
      for(const [name,value] of [["manifest",host.manifest],["review",acceptedDecision(review)]] as const)
        await writeFile(path.join(directory,`${name}.json`),`${canonicalizeJson(value)}\n`,{flag:"wx",mode:0o600});
      await write("publication-evidence.json",evidence);
      await write("export.complete.json",{schemaVersion:"programmable.module-engine-publication-export.v1",status:"ready-for-protected-publication-review",packageId,
        releaseDigest:host.release.releaseDigest,reviewDigest:plan!.reviewDigest,planDigest:plan!.planDigest,websitePublished:false,ethereumFinalityProven:false,available:false});
    }
  }
  console.log(JSON.stringify({status:command==="export"?"ready-for-protected-publication-review":command==="manifest"?"review-required":"unsigned-revalidation-required",output,
    packageId:host.manifest.manifest.revision.packageId,manifestHash:host.manifestHash,...(plan?{planDigest:plan.planDigest}:{}),available:false}));
}
