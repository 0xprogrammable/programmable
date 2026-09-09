import type { OpenHex } from './open-packages.mjs';
import type { MODULE_SUBMISSION_FORMAT, ModuleSubmissionRequest } from './open-transport.mjs';

export const MODULE_API_SCHEMA: 'programmable.modules.api.v0.1';
export const MODULE_CONTEXT_SCHEMA: 'programmable.modules.context.v1';
export const MODULE_REVIEW_CAPABILITIES_SCHEMA: 'programmable.modules.review-capabilities.v1';
export const MODULE_REVIEW_STATUS_SCHEMA: 'programmable.modules.review-status.v1';
export const MODULE_API_CLIENT_LIMITS: Readonly<{ responseBytes: number; timeoutMs: 20000; pageSize: 20 }>;
export interface ModuleApiErrorDetails { httpStatus?: number; path?: string; retryAfterSeconds?: number; submissionMayExist?: boolean }
export class ModuleApiError extends Error implements ModuleApiErrorDetails {
  code: string; httpStatus?: number; path?: string; retryAfterSeconds?: number; submissionMayExist?: boolean;
  constructor(code: string, message: string, details?: ModuleApiErrorDetails);
}
export interface ModuleApiCapabilities {
  schemaVersion: typeof MODULE_API_SCHEMA;
  moduleContributions: { apiKeyIssuance: boolean; submissions: boolean };
  submissionFormat: typeof MODULE_SUBMISSION_FORMAT;
  limits: { httpBytes: number; sourceBytes: number; sourceFileBytes: number; sourceFiles: number; pageSize: number; requestSeconds: number; concurrentUploads: number };
  reviewAvailable: false; approved: false; available: false;
}
export interface ModuleSubmissionReceipt {
  submissionId: string; packageId: OpenHex; familyId: OpenHex; requestDigest: OpenHex;
  author: OpenHex; rewardWallet: OpenHex; totalSourceBytes: number; name: string; version: string; createdAt: string;
  supersedesSubmissionId: string | null;
  status: 'draft_received'; reviewStatus: 'unreviewed'; sourceBytesVerified: true; sourceRevisionVerified: false;
  buildVerified: false; runtimeVerified: false; approved: false; available: false;
}
export interface ModuleContext {
  schemaVersion: typeof MODULE_CONTEXT_SCHEMA;
  identity: { author: OpenHex; defaultRewardWallet: OpenHex };
  authorization: { scopes: string[]; requiredScopes: string[]; missingScopes: string[]; canSubmit: boolean; canRead: boolean };
  intake: { available: boolean; submissionFormat: typeof MODULE_SUBMISSION_FORMAT; descriptorFormat: 'programmable.classic.source-package.v0.1';
    openRuntimeIdentifiers: true; openHostRequirements: true; categoryRequired: false; repositoryRequired: false;
    limits: ModuleApiCapabilities['limits'] & { descriptorBytes: number } };
  inputs: { requiredUserInput: ['idea']; optionalUserInput: string[]; authorSource: 'api_key_wallet'; rewardWalletDefault: 'author'; agentPreparedFields: string[] };
  review: { available: boolean; statusReadAvailable: boolean; planRequired: true; unknownRequirements: 'await_review_plan';
    profiles: { id: string; configurationCodec: string; compilerVersion: string; componentRuntimes: Record<string, string[]>; [key: string]: unknown }[];
    limits: Record<string, number>; dependencies: 'submitted_source_only'; submittedCommandsExecuted: false; approval: 'manual'; publicationSeparate: true; [key: string]: unknown };
  links: { guide: string; capabilities: string; reviewCapabilities: string; submit: string; submissions: string; review: string };
  approved: false; available: false;
}
export interface ModuleSubmissionResponse { schemaVersion: typeof MODULE_API_SCHEMA; submission: ModuleSubmissionReceipt }
export interface ModuleSubmissionPage { schemaVersion: typeof MODULE_API_SCHEMA; submissions: ModuleSubmissionReceipt[]; nextCursor: string | null }
export interface ModuleReviewCapabilities {
  schemaVersion: typeof MODULE_REVIEW_CAPABILITIES_SCHEMA;
  reviewAvailable: boolean; statusReadAvailable: boolean; reviewerPolicyDigest: OpenHex | null;
  workerSourceCommit: string | null; workerAuthorityReady: boolean; databaseReady: boolean; approved: false; available: false;
}
export type ModuleReviewState = 'awaiting_plan' | 'queued' | 'running' | 'built' | 'build_failed' | 'changes_requested' | 'rejected' | 'accepted';
export type ModuleReviewNextAction = 'await_review_plan' | 'await_build' | 'await_reviewer_decision' | 'submit_new_version' | 'review_rejection' | 'await_registry_admission';
export interface ModuleReviewDecision {
  outcome: 'accept' | 'request_changes' | 'reject'; reason: string; reviewerWallet: OpenHex; decidedAt: string;
  decisionDigest: OpenHex; artifactDigest: OpenHex | null; hostManifestHash: OpenHex | null;
}
export interface ModuleReviewStatus {
  schemaVersion: typeof MODULE_REVIEW_STATUS_SCHEMA;
  submissionId: string; packageId: OpenHex; familyId: OpenHex; requestDigest: OpenHex; author: OpenHex; rewardWallet: OpenHex; version: string;
  review: { state: ModuleReviewState; revision: number; attempt: number; createdAt: string; updatedAt: string;
    buildEvidenceRecorded: boolean; artifactDigest: OpenHex | null; lastError: string | null;
    latestDecision: ModuleReviewDecision | null; nextAction: ModuleReviewNextAction };
  sourceBytesVerified: true; sourceRevisionVerified: false; runtimeVerified: false; approved: false; available: false;
}
export interface ModuleApiClient {
  capabilities(): Promise<ModuleApiCapabilities>;
  context(): Promise<ModuleContext>;
  reviewCapabilities(): Promise<ModuleReviewCapabilities>;
  reviewStatus(submissionId: string): Promise<ModuleReviewStatus>;
  submit(request: ModuleSubmissionRequest, options: { idempotencyKey: string }): Promise<ModuleSubmissionResponse & { idempotent: boolean }>;
  status(submissionId: string): Promise<ModuleSubmissionResponse>;
  list(options?: { cursor?: string }): Promise<ModuleSubmissionPage>;
}
/** Node-only. Authentication is never sent to capabilities or to redirected origins. No automatic retries. */
export function createModuleApiClient(options: { apiOrigin: string; apiKey?: string; timeoutMs?: number }): ModuleApiClient;
export function validateModuleApiOrigin(input: string): string;
