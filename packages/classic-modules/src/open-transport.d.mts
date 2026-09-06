import type { OpenSourcePackage, OpenIssue, OpenHex } from './open-packages.mjs';
export const MODULE_SUBMISSION_FORMAT: 'programmable.modules.submission.v0.1';
export const MODULE_TRANSPORT_LIMITS: Readonly<{requestBytes:number;fileBytes:number;totalSourceBytes:number;files:128;descriptorBytes:number}>;
export class ModuleTransportError extends Error { code:string;path:string;constructor(code:string,message:string,path?:string) }
export interface ModuleSourceFile {path:string;sha256:string;encoding:'base64';bytes:string}
export interface ModuleSubmissionRequest {
  format:typeof MODULE_SUBMISSION_FORMAT;descriptor:OpenSourcePackage;files:ModuleSourceFile[];supersedesSubmissionId?:string;
}
export type ModuleSubmissionValidation = {ok:false;errors:OpenIssue[]} | {
  ok:true;request:ModuleSubmissionRequest;packageId:OpenHex;familyId:OpenHex;requestDigest:OpenHex;totalSourceBytes:number;
  sourceBytesVerified:true;sourceRevisionVerified:false;authorAuthenticated:false;buildVerified:false;runtimeVerified:false;
  reviewStatus:'unreviewed';onchainApproved:false;available:false;
};
export function validateModuleSubmissionRequest(input:unknown):ModuleSubmissionValidation;
export function parseModuleSubmissionJSON(body:string|Uint8Array):ModuleSubmissionValidation;
export function moduleSubmissionFromPack(pack:unknown,options?:{supersedesSubmissionId?:string}):ModuleSubmissionRequest;
