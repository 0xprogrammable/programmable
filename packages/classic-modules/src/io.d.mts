import type { ConfigSchema, Hex, ModuleManifest } from './index.mjs';
import type { Buffer } from 'node:buffer';
export const FILE_LIMITS: Readonly<{ manifest: number; schema: number; recipe: number; catalogue: number; artifact: number; pack: number }>;
export interface ModulePack {
  format: 'programmable.classic.module-pack.v1'; manifest: ModuleManifest; manifestHash: Hex; configSchema: ConfigSchema;
  sourceArtifact: { sha256: string; encoding: 'base64'; bytes: string }; evidence: string;
}
export type LocalDecision = 'accepted' | 'changes_requested' | 'rejected';
export interface LocalReview {
  schemaVersion: '1.0'; submissionId: Hex; packageSha256: string; sequence: number;
  reviewer: Hex; decision: LocalDecision; note: string; recordedAt: string;
  authority: 'local-filesystem-operator'; onchainApproved: false;
}
export interface LocalStatus {
  schemaVersion: '1.0'; id: Hex; name: string; author: Hex; rewardWalletAtSubmission: Hex;
  packageSha256: string; submittedAt: string; status: 'submitted' | LocalDecision;
  reviewCount: number; lastReview: LocalReview | null; scope: 'local-only'; onchainApproved: false;
}
export function checkedRoot(root: string): Promise<string>;
export function readBoundedFile(root: string, relative: string, maximum: number): Promise<Buffer>;
export function readJsonFile(root: string, relative: string, maximum: number): Promise<unknown>;
export function writeJsonExclusive(root: string, relative: string, value: unknown): Promise<boolean>;
export function loadModulePackage(root: string, manifestPath: string): Promise<ModulePack>;
export function submitToLocalQueue(options: { root: string; manifestPath: string; queue: string }): Promise<{
  id: Hex; idempotent: boolean; status: 'submitted' | LocalDecision; scope: 'local-only'; onchainApproved: false;
}>;
export function localSubmissionStatus(options: { root: string; queue: string; id: Hex }): Promise<LocalStatus>;
export function listLocalQueue(options: { root: string; queue: string }): Promise<{ scope: 'local-only'; submissions: LocalStatus[] }>;
export function recordLocalReview(options: { root: string; queue: string; id: Hex; reviewer: Hex; decision: LocalDecision; note: string }): Promise<LocalReview>;
