import { decodeEventLog, decodeFunctionResult, encodeFunctionData, type Address, type Hex } from "viem";
import { moduleAddress, moduleBytes, moduleHash } from "../../lib/module-mode/release";
import { moduleEngineHostAbi, moduleEngineReadAbi } from "../../lib/module-engine/abi";
import { MODULE_ENGINE_CONTRACTS, MODULE_ENGINE_SOURCE_ID, type ModuleEngineReleaseIdentity } from "../../lib/module-engine/catalog";
import { assertEnginePublicationPlan, type EnginePublicationPlan } from "./core-engine";
import { acceptedDecision, need, same, type AuthenticatedReview } from "./review";
import { code, closing, equalRead, quantity, readPublicationReceipt, record, snapshot, type PublicationProvider } from "./rpc";

async function hostGetter(providers: PublicationProvider[], address: Address, name: "SOURCE_VERSION" | "registry" | "ledger" | "tokenFactory" | "launchPolicy" | "getRevision" | "permission", args: readonly Hex[], block: Hex): Promise<unknown> {
  const data = encodeFunctionData({abi:moduleEngineHostAbi,functionName:name,args:args as never});
  return decodeFunctionResult({abi:moduleEngineHostAbi,functionName:name,data:moduleBytes(await equalRead(providers,"eth_call",[{to:address,data},block]),"engine.getter",16384)});
}
async function reader(providers: PublicationProvider[], address: Address, name: "owner" | "families" | "hook" | "registry" | "poolManager" | "ECONOMICS_POLICY_ID", args: readonly Hex[], block: Hex): Promise<unknown> {
  const data=encodeFunctionData({abi:moduleEngineReadAbi,functionName:name,args:args as never});
  return decodeFunctionResult({abi:moduleEngineReadAbi,functionName:name,data:moduleBytes(await equalRead(providers,"eth_call",[{to:address,data},block]),"engine.getter",4096)});
}
async function releaseBindings(release: ModuleEngineReleaseIdentity, providers: PublicationProvider[], block: Hex) {
  need(quantity(block)>=BigInt(release.startBlock),"Engine release start block not reached");
  for(const name of MODULE_ENGINE_CONTRACTS) await code(providers,release.contracts[name].address,block,release.contracts[name].runtimeCodeHash);
  const host=release.contracts.host.address,ledger=release.contracts.ledger.address;
  need(await hostGetter(providers,host,"SOURCE_VERSION",[],block)===MODULE_ENGINE_SOURCE_ID,"Engine source version differs");
  for(const name of ["registry","ledger","tokenFactory","launchPolicy"] as const)
    need(moduleAddress(await hostGetter(providers,host,name,[],block),`engine.${name}`)===release.contracts[name].address,"Engine contract relationship differs");
  for(const [name,target] of [["hook",host],["registry",release.contracts.registry.address],["poolManager",release.contracts.poolManager.address]] as const)
    need(moduleAddress(await reader(providers,ledger,name,[],block),`ledger.${name}`)===target,"Engine ledger relationship differs");
  need(await reader(providers,ledger,"ECONOMICS_POLICY_ID",[],block)===release.economicsPolicyId,"Engine economics policy differs");
  return moduleAddress(await reader(providers,release.contracts.registry.address,"owner",[],block),"engine.registry.owner");
}
export async function readEnginePublicationOwner(release: ModuleEngineReleaseIdentity, providers: PublicationProvider[]) {
  const block=await snapshot(providers),owner=await releaseBindings(release,providers,block.number);
  await closing(providers,block);return owner;
}
function expectedRevision(plan: EnginePublicationPlan) {return plan.revision;}
function normalizedRevision(value: unknown) {
  const r=record(value);
  return {familyId:r.familyId,creationCodeHash:r.creationCodeHash,runtimeTemplateHash:r.runtimeTemplateHash,manifestHash:r.manifestHash,
    fixedQuoteAsset:moduleAddress(r.fixedQuoteAsset,"engine.fixedQuoteAsset",true),fixedConfigurationHash:r.fixedConfigurationHash,initialOperationId:r.initialOperationId,
    executionGas:r.executionGas,moneyRights:r.moneyRights,coinRights:r.coinRights,enabled:r.enabled};
}
export async function observeEnginePublicationReadback(plan: EnginePublicationPlan, review: AuthenticatedReview, providers: PublicationProvider[], transactions: {family:Hex|null;revision:Hex}) {
  assertEnginePublicationPlan(plan,review);acceptedDecision(review);
  const block=await snapshot(providers),owner=await releaseBindings(plan.release,providers,block.number);
  need(owner===plan.reviewAuthority,"Engine Registry authority changed");
  const revision=plan.manifest.manifest.revision,engine=plan.manifest.manifest.source.engine;
  const family=await reader(providers,plan.release.contracts.registry.address,"families",[revision.familyId],block.number) as readonly Address[];
  same(family.map(a=>moduleAddress(a,"family.wallet")),[moduleAddress(review.source.descriptor.author,"author"),moduleAddress(review.source.descriptor.rewardWallet,"reward")],"Engine registered family author/reward");
  for(const id of revision.eligibleFamilies) {
    const family=await reader(providers,plan.release.contracts.registry.address,"families",[id],block.number) as readonly Address[];
    moduleAddress(family[0],"eligible.author");moduleAddress(family[1],"eligible.reward");
  }
  const stored=await hostGetter(providers,plan.release.contracts.host.address,"getRevision",[revision.packageId],block.number) as readonly unknown[];
  need(Array.isArray(stored) && stored.length===4,"Engine Registry revision missing");
  same(normalizedRevision(stored[0]),expectedRevision(plan),"Immutable Engine Host revision");
  same(stored[1],engine.immutableRuntimeOffsets,"Engine runtime patches");same(stored[2],engine.immutableConstructorOffsets,"Engine constructor words");same(stored[3],revision.eligibleFamilies,"Engine fee families");
  for(const permission of revision.operationPermissions)
    same(await hostGetter(providers,plan.release.contracts.host.address,"permission",[revision.packageId,permission.operationId],block.number),permission,"Engine operation permission");
  const hashes=[...(transactions.family===null?[]:[moduleHash(transactions.family,"family.transaction")]),moduleHash(transactions.revision,"revision.transaction")];
  need(new Set(hashes).size===hashes.length,"Repeated engine publication transaction");
  const receipts=[];
  if(transactions.family!==null) receipts.push(await readPublicationReceipt(plan.calls[0],transactions.family,providers,block.number));
  const admitted=await readPublicationReceipt(plan.calls[1],transactions.revision,providers,block.number);
  need(Array.isArray(admitted.receipt.logs),"Engine admission event missing");
  const matches=admitted.receipt.logs.filter(raw=>{
    const log=record(raw);if(String(log.address).toLowerCase()!==plan.release.contracts.host.address || log.removed===true)return false;
    try {
      const parsed=decodeEventLog({abi:moduleEngineHostAbi,eventName:"EngineRevisionApproved",data:log.data as Hex,topics:log.topics as [Hex,...Hex[]],strict:true});
      const args=record(parsed.args);
      if(args.revisionId!==revision.packageId || args.familyId!==revision.familyId)return false;
      same(normalizedRevision(args.revision),expectedRevision(plan),"Engine admission event");return true;
    } catch {return false;}
  });
  need(matches.length===1,"Exact Engine Host admission event missing");receipts.push(admitted);
  await closing(providers,block);assertEnginePublicationPlan(plan,review);
  return {schemaVersion:"programmable.module-engine-publication-readback.v1" as const,status:"canonical-inclusion-verified" as const,
    finality:"separate-robinhood-ethereum-finality-proof-required" as const,chainId:4663 as const,releaseDigest:plan.release.releaseDigest,planDigest:plan.planDigest,
    packageId:revision.packageId,reviewDigest:plan.reviewDigest,block,revision:expectedRevision(plan),immutableRuntimeOffsets:engine.immutableRuntimeOffsets,
    immutableConstructorOffsets:engine.immutableConstructorOffsets,operationPermissions:revision.operationPermissions,eligibleFamilies:revision.eligibleFamilies,receipts,
    providers:providers.map(p=>({providerId:p.providerId,trustDomain:p.trustDomain,endpointCommitment:p.endpointCommitment})),observedAt:new Date().toISOString(),available:false as const};
}
