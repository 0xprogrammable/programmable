import type { ModuleReviewState } from "@/lib/module-mode/review-contract";

export const MODULE_SUBMISSIONS_SCHEMA = "programmable.modules.wallet-submissions.v1" as const;
export const MODULE_SUBMISSIONS_PAGE_SIZE = 5;
export const MODULE_SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const nextActions = {
  awaiting_plan: "await_review_plan",
  queued: "await_build",
  running: "await_build",
  built: "await_reviewer_decision",
  build_failed: "await_review_plan",
  changes_requested: "submit_new_version",
  rejected: "review_rejection",
  accepted: "await_registry_admission",
} as const;

export type ModuleSubmissionReview = Readonly<{
  state: ModuleReviewState;
  revision: number;
  attempt: number;
  updatedAt: string;
  latestDecision: Readonly<{
    outcome: "accept" | "request_changes" | "reject";
    reason: string;
    decidedAt: string;
  }> | null;
  nextAction: typeof nextActions[ModuleReviewState];
}>;

export type WalletModuleSubmission = Readonly<{
  submissionId: string;
  packageId: string;
  familySalt: string;
  name: string;
  version: string;
  author: string;
  rewardWallet: string;
  createdAt: string;
  review: ModuleSubmissionReview | null;
  registryApproved: false;
  available: false;
}>;

export type WalletModuleSubmissions = Readonly<{
  schemaVersion: typeof MODULE_SUBMISSIONS_SCHEMA;
  submissions: readonly WalletModuleSubmission[];
  nextCursor: string | null;
}>;

const address = /^0x[0-9a-f]{40}$/u;
const rewardAddress = /^0x[0-9a-fA-F]{40}$/u;
const digest = /^0x[0-9a-f]{64}$/u;
const unsafeText = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    throw new Error("Invalid module submissions response.");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && !unsafeText.test(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function integer(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

/** Shape and account binding only. The authenticated server reader supplies ownership authority. */
export function readWalletModuleSubmissions(value: unknown, ownerWallet: string): WalletModuleSubmissions {
  const page = record(value, ["schemaVersion", "submissions", "nextCursor"]);
  const owner = ownerWallet.toLowerCase();
  if (!address.test(owner) || page.schemaVersion !== MODULE_SUBMISSIONS_SCHEMA
    || !Array.isArray(page.submissions) || page.submissions.length > MODULE_SUBMISSIONS_PAGE_SIZE
    || (page.nextCursor !== null && (typeof page.nextCursor !== "string" || !MODULE_SUBMISSION_ID.test(page.nextCursor)))) {
    throw new Error("Invalid module submissions page.");
  }
  const ids = new Set<string>();
  for (const value of page.submissions) {
    const item = record(value, ["submissionId", "packageId", "familySalt", "name", "version", "author", "rewardWallet", "createdAt", "review", "registryApproved", "available"]);
    if (typeof item.submissionId !== "string" || !MODULE_SUBMISSION_ID.test(item.submissionId) || ids.has(item.submissionId)
      || typeof item.packageId !== "string" || !digest.test(item.packageId)
      || typeof item.familySalt !== "string" || !digest.test(item.familySalt)
      || !text(item.name, 160) || !text(item.version, 128) || item.author !== owner
      || typeof item.rewardWallet !== "string" || !rewardAddress.test(item.rewardWallet)
      || !timestamp(item.createdAt) || item.registryApproved !== false || item.available !== false) {
      throw new Error("Invalid module submission ownership or fields.");
    }
    ids.add(item.submissionId);
    if (item.review === null) continue;
    const review = record(item.review, ["state", "revision", "attempt", "updatedAt", "latestDecision", "nextAction"]);
    if (typeof review.state !== "string" || !Object.hasOwn(nextActions, review.state)
      || review.nextAction !== nextActions[review.state as ModuleReviewState]
      || !integer(review.revision) || !integer(review.attempt) || !timestamp(review.updatedAt)) {
      throw new Error("Invalid module submission review.");
    }
    if (review.latestDecision !== null) {
      const decision = record(review.latestDecision, ["outcome", "reason", "decidedAt"]);
      if (!["accept", "request_changes", "reject"].includes(String(decision.outcome))
        || !text(decision.reason, 4096) || !timestamp(decision.decidedAt)) {
        throw new Error("Invalid module submission decision.");
      }
    }
  }
  if (page.nextCursor !== null && (page.submissions.length !== MODULE_SUBMISSIONS_PAGE_SIZE
    || page.nextCursor !== page.submissions.at(-1)?.submissionId)) {
    throw new Error("Invalid module submissions cursor.");
  }
  return page as WalletModuleSubmissions;
}
