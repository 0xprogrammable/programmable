import { decodeEventLog, encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, parseAbiParameters, type Hex } from "viem";
import {
  moduleAddress, moduleBytes, moduleEqual, moduleHash, moduleInteger, moduleRecord,
  moduleUint, rejectModuleEvidence,
} from "./release";
import { type ModuleModeReleaseV2 } from "./release-v2";

/** Immutable receipt snapshot emitted by the reviewed native V2 Hook. */
export const moduleModeEconomicsAbiV2 = parseAbi([
  "event NativeEconomicsBound(bytes32 indexed poolId,bytes32 indexed economicsPolicyId,uint16 protocolFeeBps,uint16 authorPoolFeeBps,bytes32[] eligibleFamilies,bool[] selectionEligible,bytes32[] selectionReviewDigests)",
]);

const blockKeys = ["chainId", "blockNumber", "blockHash"];
const policyRoles = ["launcher", "hook", "swapRouter", "rewardLedger"] as const;
type Block = Readonly<{ chainId: 4663; blockNumber: string; blockHash: Hex }>;
function list(value: unknown, maximum: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !("value" in d))) rejectModuleEvidence(label);
  return value;
}
function bound(value: unknown, keys: readonly string[], block: Block, label: string) {
  const r = moduleRecord(value, [...blockKeys, ...keys], label);
  moduleEqual(r.chainId, block.chainId, `${label}.chainId`);
  moduleEqual(moduleUint(r.blockNumber, `${label}.blockNumber`, true), block.blockNumber, `${label}.blockNumber`);
  moduleEqual(moduleHash(r.blockHash, `${label}.blockHash`), block.blockHash, `${label}.blockHash`);
  return r;
}

/** Reconstructs only the immutable launch receipt and pool snapshot, never current registry eligibility. */
export function normalizeModuleModeEconomicsV2(event: unknown, reads: unknown, release: Pick<ModuleModeReleaseV2, "contracts" | "sourceVersion" | "economicsPolicyId">,
  block: Block, tx: Hex, poolId: Hex, selectionFamilies: readonly Hex[], launchLogIndex: number) {
  const raw = bound(event, ["transactionHash", "logIndex", "address", "topics", "data", "removed"], block, "economics.event");
  moduleEqual(raw.transactionHash, tx, "economics.transactionHash");
  moduleEqual(raw.removed, false, "economics.removed");
  moduleEqual(moduleAddress(raw.address, "economics.address"), release.contracts.hook.address, "economics.address");
  if (moduleInteger(raw.logIndex, "economics.logIndex") >= launchLogIndex) rejectModuleEvidence("economics.event-order");
  const topics = list(raw.topics, 3, "economics.topics").map(value => moduleHash(value, "economics.topic"));
  if (topics.length !== 3) rejectModuleEvidence("economics.topics");
  const data = moduleBytes(raw.data, "economics.data", 4096);
  const decoded = decodeEventLog({ abi: moduleModeEconomicsAbiV2, eventName: "NativeEconomicsBound", data, topics: topics as [Hex, ...Hex[]], strict: true });
  const args = decoded.args;
  const expectedTopics = encodeEventTopics({ abi: moduleModeEconomicsAbiV2, eventName: "NativeEconomicsBound", args });
  topics.forEach((topic, index) => moduleEqual(topic, expectedTopics[index], "economics.canonical-topics"));
  moduleEqual(data, encodeAbiParameters(parseAbiParameters("uint16,uint16,bytes32[],bool[],bytes32[]"),
    [args.protocolFeeBps, args.authorPoolFeeBps, args.eligibleFamilies, args.selectionEligible, args.selectionReviewDigests]), "economics.canonical-data");
  moduleEqual(args.poolId, poolId, "economics.poolId");
  moduleEqual(args.economicsPolicyId, release.economicsPolicyId, "economics.policyId");
  const r = bound(reads, ["address", "sourceVersion", "policyIds", "platformFeeBps", "selectionEligible", "selectionReviewDigests"], block, "economics.reads");
  moduleEqual(moduleAddress(r.address, "economics.reads.address"), release.contracts.hook.address, "economics.reads.address");
  moduleEqual(r.sourceVersion, release.sourceVersion, "economics.sourceVersion");
  const policies = moduleRecord(r.policyIds, policyRoles, "economics.policyIds");
  for (const role of policyRoles) moduleEqual(policies[role], release.economicsPolicyId, `economics.${role}.policyId`);
  const eligible = list(r.selectionEligible, 16, "economics.selectionEligible").map(v => {
    if (typeof v !== "boolean") rejectModuleEvidence("economics.selectionEligible");
    return v;
  });
  const reviews = list(r.selectionReviewDigests, 16, "economics.selectionReviewDigests").map(v => {
    const hash = moduleBytes(v, "economics.reviewDigest", 32);
    if (hash.length !== 66) rejectModuleEvidence("economics.reviewDigest");
    return hash;
  });
  if (eligible.length !== selectionFamilies.length || reviews.length !== selectionFamilies.length) rejectModuleEvidence("economics.selection-length");
  const byFamily = new Map<Hex, Hex>();
  const eligibilityReviews = selectionFamilies.map((family, index) => {
    moduleEqual(eligible[index], args.selectionEligible[index], "economics.snapshot.eligible");
    moduleEqual(reviews[index], args.selectionReviewDigests[index], "economics.snapshot.reviewDigest");
    if (eligible[index] && BigInt(reviews[index]!) === 0n) rejectModuleEvidence("economics.eligible-without-review");
    const digest = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bool,bytes32"), [family, eligible[index]!, reviews[index]!]));
    if (byFamily.has(family)) moduleEqual(digest, byFamily.get(family), "economics.family-snapshot-conflict");
    byFamily.set(family, digest);
    return digest;
  });
  moduleEqual(args.selectionEligible.length, eligible.length, "economics.event-selection-length");
  moduleEqual(args.selectionReviewDigests.length, reviews.length, "economics.event-review-length");
  const eligibleFamilies = [...new Set(selectionFamilies.filter((_, index) => eligible[index]))].sort();
  if (eligibleFamilies.length > 8) rejectModuleEvidence("economics.eligible-family-budget");
  moduleEqual(args.eligibleFamilies.length, eligibleFamilies.length, "economics.eligible-family-length");
  eligibleFamilies.forEach((family, index) => moduleEqual(family, args.eligibleFamilies[index], "economics.eligible-family"));
  const protocolFeeBps = 10 as const;
  const authorPoolFeeBps = eligibleFamilies.length === 0 ? 0 as const : 20 as const;
  moduleEqual(args.protocolFeeBps, protocolFeeBps, "economics.protocol-bps");
  moduleEqual(args.authorPoolFeeBps, authorPoolFeeBps, "economics.author-bps");
  const platformFeeBps = protocolFeeBps + authorPoolFeeBps;
  moduleEqual(r.platformFeeBps, platformFeeBps, "economics.platform-bps");
  return Object.freeze({ economicsPolicyId: release.economicsPolicyId, protocolFeeBps, authorPoolFeeBps, platformFeeBps,
    eligibleFamilies: Object.freeze(eligibleFamilies), selectionEligible: Object.freeze(eligible), selectionReviewDigests: Object.freeze(reviews),
    eligibilityReviews: Object.freeze(eligibilityReviews) });
}
