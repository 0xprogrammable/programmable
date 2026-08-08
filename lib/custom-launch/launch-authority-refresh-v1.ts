import type {
  ApplicationHandleV3,
  LaunchDescriptorV2,
  LaunchEligibilityViewV2,
  PrincipalCustomLaunchApplicationSummaryV2,
  PrincipalLaunchAuthorityRefreshViewV1,
} from "./contract-v2";
import { canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { CustomLaunchWebsiteRequestErrorV2 } from "./client-v2";

const DEFAULT_POLL_ATTEMPTS = 40;
const DEFAULT_POLL_DELAY_MS = 1_500;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_OVERALL_TIMEOUT_MS = 60_000;
const DEFAULT_TRANSIENT_BASE_DELAY_MS = 500;
const DEFAULT_TRANSIENT_MAX_DELAY_MS = 4_000;
export const LAUNCH_AUTHORITY_MINIMUM_REMAINING_MS_V1 = 30_000;
export const LAUNCH_AUTHORITY_REFRESH_IDEMPOTENCY_KEY_DOMAIN_V1 =
  "programmable.launch-authority-refresh-idempotency-key.v1";

type RefreshClientV1 = Readonly<{
  launchAuthorityRefresh(
    applicationHandle: ApplicationHandleV3,
    request: Readonly<{
      schemaVersion: "programmable.principal-launch-authority-refresh-request.v1";
    }>,
    idempotencyKey: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PrincipalLaunchAuthorityRefreshViewV1>;
}>;

export class LaunchAuthorityRefreshCancelledErrorV1 extends Error {}
export class LaunchAuthorityRefreshBindingErrorV1 extends Error {}
export class LaunchAuthorityRefreshDependencyUnavailableErrorV1 extends Error {}
export class LaunchAuthorityRefreshFailedErrorV1 extends Error {}
export class LaunchAuthorityRefreshTimeoutErrorV1
  extends LaunchAuthorityRefreshFailedErrorV1 {}
class LaunchAuthorityRefreshRequestTimeoutErrorV1 extends Error {}

export class LaunchAuthorityRefreshSingleFlightV1 {
  readonly #active = new Map<string, Promise<PrincipalLaunchAuthorityRefreshViewV1>>();

  run(
    key: string,
    operation: () => Promise<PrincipalLaunchAuthorityRefreshViewV1>,
  ): Promise<PrincipalLaunchAuthorityRefreshViewV1> {
    const existing = this.#active.get(key);
    if (existing !== undefined) return existing;
    const promise = operation().finally(() => {
      if (this.#active.get(key) === promise) this.#active.delete(key);
    });
    this.#active.set(key, promise);
    return promise;
  }
}

export function launchAuthorityRefreshIdempotencyKeyV1(input: Readonly<{
  application: PrincipalCustomLaunchApplicationSummaryV2;
  currentValidUntil?: string;
  attempt?: number;
}>): string {
  const binding = input.application.launchEntitlementBindingHash;
  if (
    binding === null
    || !/^sha256:[0-9a-f]{64}$/u.test(binding)
    || !/^github-[0-9a-f]{64}$/u.test(input.application.applicationHandle)
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "This exact GitHub submission has no current launch authority",
  );
  const attempt = input.attempt ?? 0;
  if (
    !Number.isSafeInteger(attempt)
    || attempt < 0
    || attempt > 10_000
  ) throw new TypeError("refresh generation is invalid");
  let generation: string;
  if (input.currentValidUntil === undefined) {
    generation = `initial:${input.application.updatedAt}`;
  } else {
    const validUntil = Date.parse(input.currentValidUntil);
    if (!Number.isFinite(validUntil)) {
      throw new LaunchAuthorityRefreshBindingErrorV1(
        "Launch authority expiry is invalid",
      );
    }
    generation = `ttl:${input.currentValidUntil}`;
  }
  const digest = canonicalBrowserSha256V2(
    LAUNCH_AUTHORITY_REFRESH_IDEMPOTENCY_KEY_DOMAIN_V1,
    {
      applicationHandle: input.application.applicationHandle,
      attempt,
      generation,
      launchEntitlementBindingHash: binding,
    },
  );
  return `launch-authority-refresh:v1:${digest.slice("sha256:".length)}`;
}

export function launchAuthorityNeedsRefreshV1(input: Readonly<{
  descriptor: LaunchDescriptorV2;
  eligibility: LaunchEligibilityViewV2;
  now?: number;
  minimumRemainingMs?: number;
}>): boolean {
  const now = input.now ?? Date.now();
  const minimumRemainingMs = input.minimumRemainingMs
    ?? LAUNCH_AUTHORITY_MINIMUM_REMAINING_MS_V1;
  const descriptorExpiry = Date.parse(input.descriptor.validUntil);
  const eligibilityExpiry = Date.parse(input.eligibility.validUntil);
  if (
    !Number.isFinite(now)
    || !Number.isSafeInteger(minimumRemainingMs)
    || minimumRemainingMs < 0
    || !Number.isFinite(descriptorExpiry)
    || !Number.isFinite(eligibilityExpiry)
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "Launch authority expiry is invalid",
  );
  return Math.min(descriptorExpiry, eligibilityExpiry) <= now + minimumRemainingMs;
}

export function launchAuthorityRefreshRequiredV1(input: Readonly<{
  descriptor: LaunchDescriptorV2;
  eligibility: LaunchEligibilityViewV2;
  forceFreshObservation: boolean;
  refreshCompleted: boolean;
  now?: number;
}>): boolean {
  return (input.forceFreshObservation && !input.refreshCompleted)
    || launchAuthorityNeedsRefreshV1(input);
}

export function launchAuthorityObservationMatchesSetupV1(input: Readonly<{
  refresh: PrincipalLaunchAuthorityRefreshViewV1;
  descriptor: LaunchDescriptorV2;
  eligibility: LaunchEligibilityViewV2;
}>): boolean {
  return input.refresh.state === "current"
    && input.refresh.grantId === input.descriptor.grantId
    && input.refresh.grantBindingHash === input.descriptor.grantBindingHash
    && input.refresh.grantId === input.eligibility.grantId
    && input.refresh.grantBindingHash === input.eligibility.grantBindingHash
    && input.refresh.validUntil === input.descriptor.validUntil
    && input.refresh.validUntil === input.eligibility.validUntil;
}

export async function pollPrincipalLaunchAuthorityRefreshV1(input: Readonly<{
  client: RefreshClientV1;
  application: PrincipalCustomLaunchApplicationSummaryV2;
  idempotencyKey: string;
  isActive: () => boolean;
  attempts?: number;
  delayMs?: number;
  requestTimeoutMs?: number;
  overallTimeoutMs?: number;
  transientBaseDelayMs?: number;
  transientMaxDelayMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  monotonicNow?: () => number;
  onTransientRetry?: (input: Readonly<{
    attempt: number;
    maximumAttempts: number;
    delayMs: number;
    code: string;
  }>) => void;
}>): Promise<PrincipalLaunchAuthorityRefreshViewV1> {
  if (input.application.state !== "ready_for_registration") {
    throw new LaunchAuthorityRefreshBindingErrorV1(
    "This exact GitHub submission is not ready for launch verification",
    );
  }
  if (
    input.application.receiptDigest === null
    || input.application.launchEntitlementBindingHash === null
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "This exact GitHub submission has no current launch authority",
  );
  const attempts = input.attempts ?? DEFAULT_POLL_ATTEMPTS;
  const delayMs = input.delayMs ?? DEFAULT_POLL_DELAY_MS;
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const overallTimeoutMs = input.overallTimeoutMs ?? DEFAULT_OVERALL_TIMEOUT_MS;
  const transientBaseDelayMs = input.transientBaseDelayMs
    ?? DEFAULT_TRANSIENT_BASE_DELAY_MS;
  const transientMaxDelayMs = input.transientMaxDelayMs
    ?? DEFAULT_TRANSIENT_MAX_DELAY_MS;
  const wait = input.delay ?? ((milliseconds: number) => new Promise<void>(
    (resolve) => window.setTimeout(resolve, milliseconds),
  ));
  const now = input.now ?? Date.now;
  const monotonicNow = input.monotonicNow
    ?? (() => globalThis.performance.now());
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 100) {
    throw new TypeError("refresh poll attempts are invalid");
  }
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 10_000) {
    throw new TypeError("refresh poll delay is invalid");
  }
  if (
    !Number.isSafeInteger(requestTimeoutMs)
    || requestTimeoutMs < 1
    || requestTimeoutMs > 30_000
  ) throw new TypeError("refresh request timeout is invalid");
  if (
    !Number.isSafeInteger(overallTimeoutMs)
    || overallTimeoutMs < requestTimeoutMs
    || overallTimeoutMs > 300_000
  ) throw new TypeError("refresh overall timeout is invalid");
  if (
    !Number.isSafeInteger(transientBaseDelayMs)
    || transientBaseDelayMs < 0
    || transientBaseDelayMs > 10_000
    || !Number.isSafeInteger(transientMaxDelayMs)
    || transientMaxDelayMs < transientBaseDelayMs
    || transientMaxDelayMs > 30_000
  ) throw new TypeError("refresh transient backoff is invalid");
  const startedAt = monotonicNow();
  if (!Number.isFinite(startedAt)) {
    throw new TypeError("refresh monotonic clock is invalid");
  }
  const deadline = startedAt + overallTimeoutMs;
  let identity: PrincipalLaunchAuthorityRefreshViewV1 | null = null;
  let observedPending = false;
  let transientFailureCount = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!input.isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
    const remainingBeforeRequest = deadline - monotonicNow();
    if (remainingBeforeRequest <= 0) break;
    let snapshot: PrincipalLaunchAuthorityRefreshViewV1;
    try {
      snapshot = await requestLaunchAuthorityRefreshWithTimeoutV1({
        client: input.client,
        applicationHandle: input.application.applicationHandle,
        idempotencyKey: input.idempotencyKey,
        timeoutMs: Math.max(1, Math.min(
          requestTimeoutMs,
          Math.ceil(remainingBeforeRequest),
        )),
      });
    } catch (caught) {
      if (!input.isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
      if (!isTransientLaunchAuthorityRefreshErrorV1(caught)) throw caught;
      transientFailureCount += 1;
      if (attempt + 1 >= attempts) break;
      const remainingBeforeRetry = deadline - monotonicNow();
      if (remainingBeforeRetry <= 0) break;
      const backoffMs = Math.min(
        transientMaxDelayMs,
        transientBaseDelayMs * (2 ** Math.min(transientFailureCount - 1, 10)),
      );
      const boundedBackoffMs = Math.max(0, Math.min(
        backoffMs,
        Math.floor(remainingBeforeRetry),
      ));
      input.onTransientRetry?.({
        attempt: attempt + 1,
        maximumAttempts: attempts,
        delayMs: boundedBackoffMs,
        code: transientLaunchAuthorityRefreshErrorCodeV1(caught),
      });
      await wait(boundedBackoffMs);
      continue;
    }
    if (!input.isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
    transientFailureCount = 0;
    assertLaunchAuthorityRefreshBindingV1(snapshot, input.application, identity);
    identity ??= snapshot;
    if (snapshot.state === "current") {
      if (Date.parse(snapshot.validUntil!) <= now()) {
        throw new LaunchAuthorityRefreshBindingErrorV1(
          "Launch verification returned an expired source observation",
        );
      }
      return snapshot;
    }
    if (snapshot.state === "failed") {
      throw new LaunchAuthorityRefreshFailedErrorV1(
        "Final source verification could not be completed. Try again shortly",
      );
    }
    observedPending = true;
    if (attempt + 1 >= attempts) break;
    const remainingBeforePoll = deadline - monotonicNow();
    if (remainingBeforePoll <= 0) break;
    await wait(Math.max(0, Math.min(delayMs, Math.floor(remainingBeforePoll))));
  }
  if (!observedPending && transientFailureCount > 0) {
    throw new LaunchAuthorityRefreshDependencyUnavailableErrorV1(
      "GitHub or the verification service is temporarily unavailable. Your approval is unchanged. Try again shortly",
    );
  }
  throw new LaunchAuthorityRefreshTimeoutErrorV1(
    "Final source verification is still running. Your approval is unchanged. Try again shortly",
  );
}

async function requestLaunchAuthorityRefreshWithTimeoutV1(input: Readonly<{
  client: RefreshClientV1;
  applicationHandle: ApplicationHandleV3;
  idempotencyKey: string;
  timeoutMs: number;
}>): Promise<PrincipalLaunchAuthorityRefreshViewV1> {
  const controller = new AbortController();
  const timeoutError = new LaunchAuthorityRefreshRequestTimeoutErrorV1(
    "Launch authority refresh request timed out",
  );
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = globalThis.setTimeout(() => {
      reject(timeoutError);
      controller.abort(timeoutError);
    }, input.timeoutMs);
  });
  try {
    return await Promise.race([
      input.client.launchAuthorityRefresh(
        input.applicationHandle,
        { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
        input.idempotencyKey,
        { signal: controller.signal },
      ),
      deadline,
    ]);
  } finally {
    if (timeout !== undefined) globalThis.clearTimeout(timeout);
  }
}

function isTransientLaunchAuthorityRefreshErrorV1(caught: unknown): boolean {
  if (
    caught instanceof LaunchAuthorityRefreshRequestTimeoutErrorV1
    || caught instanceof TypeError
  ) return true;
  return caught instanceof CustomLaunchWebsiteRequestErrorV2
    && (
      caught.code === "DEPENDENCY_UNAVAILABLE"
      || caught.status === 408
      || caught.status === 425
      || caught.status === 429
      || caught.status === 502
      || caught.status === 503
      || caught.status === 504
    );
}

function transientLaunchAuthorityRefreshErrorCodeV1(caught: unknown): string {
  if (caught instanceof LaunchAuthorityRefreshRequestTimeoutErrorV1) {
    return "REQUEST_TIMEOUT";
  }
  if (caught instanceof CustomLaunchWebsiteRequestErrorV2) return caught.code;
  return "NETWORK_UNAVAILABLE";
}

export function assertLaunchAuthorityRefreshBindingV1(
  snapshot: PrincipalLaunchAuthorityRefreshViewV1,
  application: PrincipalCustomLaunchApplicationSummaryV2,
  previous: PrincipalLaunchAuthorityRefreshViewV1 | null = null,
): void {
  if (
    snapshot.applicationId !== application.applicationId
    || snapshot.applicationHandle !== application.applicationHandle
    || snapshot.grantBindingHash !== application.launchEntitlementBindingHash
    || (previous !== null && (
      snapshot.requestId !== previous.requestId
      || snapshot.requestDigest !== previous.requestDigest
      || snapshot.applicationId !== previous.applicationId
      || snapshot.applicationHandle !== previous.applicationHandle
      || snapshot.grantId !== previous.grantId
      || snapshot.grantBindingHash !== previous.grantBindingHash
      || snapshot.requestedAt !== previous.requestedAt
    ))
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "Launch verification returned a different approved identity and was stopped",
  );
}
