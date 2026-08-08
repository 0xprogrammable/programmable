import type {
  PrincipalCustomLaunchApplicationSummaryV2,
  Sha256DigestV2,
} from "./contract-v2";
import { canonicalBrowserSha256V2 } from "./browser-authority-v2";

export const MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3 = 200;
export const MAXIMUM_PRINCIPAL_APPLICATIONS_V3 = 100_000;
export const PRINCIPAL_APPLICATION_PAGINATION_TIMEOUT_MS_V3 = 30_000;

export class PrincipalApplicationPaginationTimeoutErrorV3 extends Error {
  constructor() {
    super("Submission list loading timed out before every page was verified");
    this.name = "PrincipalApplicationPaginationTimeoutErrorV3";
  }
}

export class PrincipalApplicationPaginationCancelledErrorV3 extends Error {
  constructor() {
    super("Submission list loading was cancelled");
    this.name = "PrincipalApplicationPaginationCancelledErrorV3";
  }
}

type ApplicationPageClientV3 = Readonly<{
  applications(input: Readonly<{
    limit?: number;
    cursor?: string;
    signal?: AbortSignal;
  }>): Promise<Readonly<{
    subject: Readonly<{
      githubUserId: string;
      githubPrincipalHash: Sha256DigestV2;
    }>;
    applications: readonly PrincipalCustomLaunchApplicationSummaryV2[];
    nextCursor: string | null;
  }>>;
}>;

export async function readAllPrincipalApplicationsV3(
  client: ApplicationPageClientV3,
  options: Readonly<{
    signal?: AbortSignal;
    timeoutMs?: number;
  }> = {},
): Promise<Readonly<{
  githubPrincipalHash: Sha256DigestV2;
  applications: readonly PrincipalCustomLaunchApplicationSummaryV2[];
}>> {
  const timeoutMs = options.timeoutMs
    ?? PRINCIPAL_APPLICATION_PAGINATION_TIMEOUT_MS_V3;
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > 120_000
  ) throw new TypeError("Submission list timeout is invalid");
  if (options.signal?.aborted === true) {
    throw new PrincipalApplicationPaginationCancelledErrorV3();
  }
  const aggregateController = new AbortController();
  const cancel = () => aggregateController.abort("caller-cancelled");
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = globalThis.setTimeout(
    () => aggregateController.abort("aggregate-timeout"),
    timeoutMs,
  );
  const applications: PrincipalCustomLaunchApplicationSummaryV2[] = [];
  const observedCursors = new Set<string>();
  const observedApplicationHandles = new Set<string>();
  let cursor: string | undefined;
  let githubUserId: string | null = null;
  let githubPrincipalHash: Sha256DigestV2 | null = null;

  try {
    for (let pageNumber = 0; pageNumber < MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3; pageNumber += 1) {
      const page = await readApplicationPageV3(client, {
        limit: 50,
        ...(cursor === undefined ? {} : { cursor }),
      }, aggregateController.signal);
      if (
        !/^[1-9][0-9]{0,19}$/u.test(page.subject.githubUserId)
        || !/^sha256:[0-9a-f]{64}$/u.test(page.subject.githubPrincipalHash)
        || page.subject.githubPrincipalHash !== canonicalBrowserSha256V2(
          "programmable.github-submitter-principal.v1",
          { githubUserId: page.subject.githubUserId },
        )
        || (githubUserId !== null
          && page.subject.githubUserId !== githubUserId)
        || (githubPrincipalHash !== null
          && page.subject.githubPrincipalHash !== githubPrincipalHash)
      ) throw new Error("GitHub submission identity changed while loading");
      githubUserId ??= page.subject.githubUserId;
      githubPrincipalHash ??= page.subject.githubPrincipalHash;
      if (
        page.applications.length
          > MAXIMUM_PRINCIPAL_APPLICATIONS_V3 - applications.length
      ) {
        throw new Error("Submission list exceeds its explicit safety bound");
      }
      for (const application of page.applications) {
        if (observedApplicationHandles.has(application.applicationHandle)) {
          throw new Error("Submission list contains a duplicate application handle");
        }
        observedApplicationHandles.add(application.applicationHandle);
      }
      applications.push(...page.applications);

      const next = page.nextCursor ?? undefined;
      if (next === undefined) {
        if (githubPrincipalHash === null) {
          throw new Error("GitHub submission identity is unavailable");
        }
        return { githubPrincipalHash, applications };
      }
      if (observedCursors.has(next)) {
        throw new Error("Submission list pagination is invalid");
      }
      observedCursors.add(next);
      cursor = next;
    }
    throw new Error("Submission list exceeds its explicit safety bound");
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", cancel);
  }
}

async function readApplicationPageV3(
  client: ApplicationPageClientV3,
  input: Readonly<{ limit: number; cursor?: string }>,
  signal: AbortSignal,
): ReturnType<ApplicationPageClientV3["applications"]> {
  if (signal.aborted) throw paginationAbortErrorV3(signal.reason);
  let rejectOnAbort: ((reason: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = reject;
  });
  const onAbort = () => rejectOnAbort?.(paginationAbortErrorV3(signal.reason));
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([
      client.applications({ ...input, signal }),
      aborted,
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function paginationAbortErrorV3(reason: unknown): Error {
  return reason === "aggregate-timeout"
    ? new PrincipalApplicationPaginationTimeoutErrorV3()
    : new PrincipalApplicationPaginationCancelledErrorV3();
}
