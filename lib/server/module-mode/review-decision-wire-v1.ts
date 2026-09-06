import { createHash } from "node:crypto";

/** Portable wire validation only. A valid hash is NOT reviewer authority or an onchain approval. */
export const MODULE_REVIEW_DECISION_SCHEMA_V1 = "programmable.modules.review-decision.v1" as const;
export type ReviewDigest = `0x${string}`;
export interface ModuleReviewDecisionCommandV1 {
  readonly schemaVersion: "programmable.modules.review-command.v1";
  readonly submissionId: string;
  readonly requestDigest: ReviewDigest;
  readonly expectedReviewRevision: number;
  readonly outcome: "request_changes" | "reject" | "accept";
  readonly reason: string;
  readonly artifactDigest: ReviewDigest | null;
  readonly hostManifestHash: ReviewDigest | null;
  readonly acknowledgedReviewAreas: readonly string[];
}
export interface ModuleReviewDecisionRecordV1 {
  readonly schemaVersion: typeof MODULE_REVIEW_DECISION_SCHEMA_V1;
  readonly reviewerWallet: string;
  readonly policyDigest: ReviewDigest;
  readonly subject: Readonly<{submissionId:string;principalId:string;author:string;requestDigest:ReviewDigest}>;
  readonly command: ModuleReviewDecisionCommandV1;
  readonly decidedAt: string;
  readonly registryApproved: false;
  readonly available: false;
  readonly decisionDigest: ReviewDigest;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST=/^0x(?!0{64}$)[0-9a-f]{64}$/u;
const ADDRESS=/^0x(?!0{40}$)[0-9a-f]{40}$/u;
function exact(x:unknown,keys:readonly string[]): x is Record<string,unknown> {
  return x!==null&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
}
function canonical(value:unknown):string {
  if(value===null||typeof value==="boolean"||typeof value==="string")return JSON.stringify(value);
  if(typeof value==="number"&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return `[${value.map(canonical).join(",")}]`;
  if(typeof value==="object"&&value!==null)return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(",")}}`;
  throw new TypeError("MODULE_REVIEW_WIRE_INVALID");
}
export function computeModuleReviewDecisionDigestV1(value:Omit<ModuleReviewDecisionRecordV1,"decisionDigest">):ReviewDigest {
  return `0x${createHash("sha256").update(canonical({domain:MODULE_REVIEW_DECISION_SCHEMA_V1,value})).digest("hex")}`;
}
export function validateModuleReviewDecisionCommandV1(value:unknown):value is ModuleReviewDecisionCommandV1 {
  if(!exact(value,["schemaVersion","submissionId","requestDigest","expectedReviewRevision","outcome","reason","artifactDigest","hostManifestHash","acknowledgedReviewAreas"]))return false;
  if(value.schemaVersion!=="programmable.modules.review-command.v1"||typeof value.submissionId!=="string"||!UUID.test(value.submissionId)
    ||typeof value.requestDigest!=="string"||!DIGEST.test(value.requestDigest)||!Number.isSafeInteger(value.expectedReviewRevision)||Number(value.expectedReviewRevision)<0
    ||!["accept","request_changes","reject"].includes(String(value.outcome)))return false;
  if(typeof value.reason!=="string"||value.reason.trim()!==value.reason||value.reason.length<10||Buffer.byteLength(value.reason)>4096||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.reason))return false;
  const areas=value.acknowledgedReviewAreas;
  if(!Array.isArray(areas)||areas.length>32||new Set(areas).size!==areas.length||areas.some(a=>typeof a!=="string"||!/^[a-z][a-z0-9-]{0,127}$/u.test(a)))return false;
  return value.outcome==="accept"
    ?typeof value.artifactDigest==="string"&&DIGEST.test(value.artifactDigest)&&typeof value.hostManifestHash==="string"&&DIGEST.test(value.hostManifestHash)
    :value.artifactDigest===null&&value.hostManifestHash===null;
}
export function validateModuleReviewDecisionRecordV1(value:unknown):value is ModuleReviewDecisionRecordV1 {
  try {
    if(!exact(value,["schemaVersion","reviewerWallet","policyDigest","subject","command","decidedAt","registryApproved","available","decisionDigest"]))return false;
    if(value.schemaVersion!==MODULE_REVIEW_DECISION_SCHEMA_V1||typeof value.reviewerWallet!=="string"||!ADDRESS.test(value.reviewerWallet)
      ||typeof value.policyDigest!=="string"||!DIGEST.test(value.policyDigest)||value.registryApproved!==false||value.available!==false)return false;
    const s=value.subject;
    if(!exact(s,["submissionId","principalId","author","requestDigest"])||typeof s.submissionId!=="string"||!UUID.test(s.submissionId)
      ||typeof s.principalId!=="string"||!UUID.test(s.principalId)||typeof s.author!=="string"||!ADDRESS.test(s.author)||s.author===value.reviewerWallet
      ||typeof s.requestDigest!=="string"||!DIGEST.test(s.requestDigest))return false;
    if(!validateModuleReviewDecisionCommandV1(value.command)||value.command.submissionId!==s.submissionId||value.command.requestDigest!==s.requestDigest)return false;
    if(typeof value.decidedAt!=="string"||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value.decidedAt)||new Date(value.decidedAt).toISOString()!==value.decidedAt)return false;
    const {decisionDigest,...contents}=value;
    return typeof decisionDigest==="string"&&DIGEST.test(decisionDigest)&&computeModuleReviewDecisionDigestV1(contents as unknown as Omit<ModuleReviewDecisionRecordV1,"decisionDigest">)===decisionDigest;
  } catch { return false; }
}
