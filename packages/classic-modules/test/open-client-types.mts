import { createModuleApiClient, type ModuleSubmissionPage, type ModuleSubmissionResponse, type ModuleReviewStatus, type ModuleReviewCapabilities } from '../src/open-client.mjs';
import { moduleSubmissionFromPack } from '../src/open-transport.mjs';
import { resolveOpenConfigBindings, type OpenConfigSchema, type OpenConfigParameterBinding } from '../src/open-packages.mjs';

export function checkParameterBindingTypes() {
  const binding: OpenConfigParameterBinding = { mode: 'fixed', value: '7' };
  const schema: OpenConfigSchema = { type: 'uint', binding };
  return resolveOpenConfigBindings(schema, undefined);
}

/** Compile-only SDK consumer. This function is not executed by the test suite. */
export async function checkClientTypes(sourcePack: unknown, apiOrigin: string, apiKey: string) {
  const client = createModuleApiClient({ apiOrigin, apiKey, timeoutMs: 20_000 });
  const caps = await client.capabilities();
  const schema: 'programmable.modules.api.v0.1' = caps.schemaVersion;
  const format: 'programmable.modules.submission.v0.1' = caps.submissionFormat;
  const receipt = await client.submit(moduleSubmissionFromPack(sourcePack), { idempotencyKey: 'compile-only-type-check' });
  const idempotent: boolean = receipt.idempotent;
  const approved: false = receipt.submission.approved;
  const available: false = receipt.submission.available;
  const rewardWallet: `0x${string}` = receipt.submission.rewardWallet;
  const status: ModuleSubmissionResponse = await client.status(receipt.submission.submissionId);
  const page: ModuleSubmissionPage = await client.list({ cursor: status.submission.submissionId });
  const reviewCaps: ModuleReviewCapabilities = await client.reviewCapabilities();
  const review: ModuleReviewStatus = await client.reviewStatus(status.submission.submissionId);
  const reviewApproved: false = review.approved;
  return { schema, format, idempotent, approved, available, rewardWallet, page, reviewCaps, review, reviewApproved };
}
