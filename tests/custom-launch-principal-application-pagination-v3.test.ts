import { afterEach, describe, expect, it, vi } from "vitest";

import { createCustomLaunchWebsiteClientV2 } from "../lib/custom-launch/client-v2";
import type {
  ApplicationHandleV3,
  PrincipalCustomLaunchApplicationSummaryV2,
} from "../lib/custom-launch/contract-v2";
import {
  MAXIMUM_PRINCIPAL_APPLICATIONS_V3,
  MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3,
  PrincipalApplicationPaginationCancelledErrorV3,
  PrincipalApplicationPaginationTimeoutErrorV3,
  readAllPrincipalApplicationsV3,
} from "../lib/custom-launch/principal-application-pagination-v3";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";

const GITHUB_USER_ID = "123456789";
const GITHUB_PRINCIPAL_HASH = canonicalBrowserSha256V2(
  "programmable.github-submitter-principal.v1",
  { githubUserId: GITHUB_USER_ID },
);

function application(index: number): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: `application-${index}`,
    applicationHandle: `github-${index.toString(16).padStart(64, "0")}` as ApplicationHandleV3,
    revisionId: `revision-${index}`,
    repositoryId: String(index + 1),
    repositoryOwnerId: "309941960",
    repositoryFullName: `builder/project-${index}`,
    pullRequestNumber: index + 1,
    commitOid: index.toString(16).padStart(40, "0"),
    treeOid: (index + 1).toString(16).padStart(40, "0"),
    state: "approved",
    reasonCodes: [],
    actionCodes: [],
    correctionCount: 0,
    correctionPreview: [],
    receiptDigest: `sha256:${"1".repeat(64)}`,
    launchEntitlementBindingHash: `sha256:${"2".repeat(64)}`,
    updatedAt: "2026-08-05T12:00:00.000Z",
  };
}

function page(
  applications: readonly PrincipalCustomLaunchApplicationSummaryV2[],
  nextCursor: string | null,
  subject: Readonly<{
    githubUserId: string;
    githubPrincipalHash: `sha256:${string}`;
  }> = {
    githubUserId: GITHUB_USER_ID,
    githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
  },
) {
  return {
    subject,
    applications,
    nextCursor,
  };
}

describe("principal Application V3 pagination", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads every page beyond the former silent 500-submission cutoff", async () => {
    const all = Array.from({ length: 550 }, (_, index) => application(index));
    const applications = vi.fn(async (input: Readonly<{
      limit?: number;
      cursor?: string;
      signal?: AbortSignal;
    }>) => {
      expect(input.limit).toBe(50);
      expect(input.signal).toBeInstanceOf(AbortSignal);
      const pageIndex = input.cursor === undefined
        ? 0
        : Number(input.cursor.slice("cursor-".length));
      const start = pageIndex * 50;
      const nextPage = pageIndex + 1;
      return page(
        all.slice(start, start + 50),
        nextPage * 50 < all.length ? `cursor-${nextPage}` : null,
      );
    });

    await expect(readAllPrincipalApplicationsV3({ applications })).resolves.toMatchObject({
      githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
      applications: all,
    });
    expect(applications).toHaveBeenCalledTimes(11);
  });

  it("fails visibly on a cursor cycle instead of returning a partial list", async () => {
    const applications = vi.fn(async () => page([], "cursor-cycle-0001"));

    await expect(readAllPrincipalApplicationsV3({ applications })).rejects.toThrow(
      "Submission list pagination is invalid",
    );
    expect(applications).toHaveBeenCalledTimes(2);
  });

  it("rejects a principal ID or derived hash change between pages", async () => {
    const otherUserId = "987654321";
    const otherSubject = {
      githubUserId: otherUserId,
      githubPrincipalHash: canonicalBrowserSha256V2(
        "programmable.github-submitter-principal.v1",
        { githubUserId: otherUserId },
      ),
    };
    const applications = vi.fn(async (input: Readonly<{ cursor?: string }>) =>
      input.cursor === undefined
        ? page([application(0)], "cursor-next-0001")
        : page([application(1)], null, otherSubject));

    await expect(readAllPrincipalApplicationsV3({ applications })).rejects.toThrow(
      "GitHub submission identity changed while loading",
    );
  });

  it("rejects a principal hash that was not derived from the numeric GitHub ID", async () => {
    const applications = vi.fn(async () => page([], null, {
      githubUserId: GITHUB_USER_ID,
      githubPrincipalHash: `sha256:${"f".repeat(64)}`,
    }));

    await expect(readAllPrincipalApplicationsV3({ applications })).rejects.toThrow(
      "GitHub submission identity changed while loading",
    );
  });

  it("fails visibly at the explicit generous page safety bound", async () => {
    let pageNumber = 0;
    const applications = vi.fn(async () => {
      pageNumber += 1;
      return page([], `cursor-${pageNumber.toString().padStart(16, "0")}`);
    });

    await expect(readAllPrincipalApplicationsV3({ applications })).rejects.toThrow(
      "Submission list exceeds its explicit safety bound",
    );
    expect(applications).toHaveBeenCalledTimes(MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3);
    expect(MAXIMUM_PRINCIPAL_APPLICATION_PAGES_V3).toBe(200);
    expect(MAXIMUM_PRINCIPAL_APPLICATIONS_V3).toBe(100_000);
  });

  it("applies one aggregate deadline and returns no partial page data", async () => {
    vi.useFakeTimers();
    const applications = vi.fn(async (input: Readonly<{
      cursor?: string;
      signal?: AbortSignal;
    }>) => {
      if (input.cursor === undefined) return page([application(0)], "cursor-next");
      return await new Promise<ReturnType<typeof page>>((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(input.signal?.reason), {
          once: true,
        });
      });
    });
    const pending = readAllPrincipalApplicationsV3(
      { applications },
      { timeoutMs: 250 },
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(
      PrincipalApplicationPaginationTimeoutErrorV3,
    );

    await vi.advanceTimersByTimeAsync(250);
    await rejected;
    expect(applications).toHaveBeenCalledTimes(2);
  });

  it("propagates caller cancellation to the in-flight page and returns no partial data", async () => {
    const controller = new AbortController();
    let pageSignal: AbortSignal | undefined;
    const applications = vi.fn(async (input: Readonly<{
      cursor?: string;
      signal?: AbortSignal;
    }>) => {
      if (input.cursor === undefined) return page([application(0)], "cursor-next");
      pageSignal = input.signal;
      return await new Promise<ReturnType<typeof page>>((_resolve, reject) => {
        input.signal?.addEventListener("abort", () => reject(input.signal?.reason), {
          once: true,
        });
      });
    });
    const pending = readAllPrincipalApplicationsV3(
      { applications },
      { signal: controller.signal },
    );
    const rejected = expect(pending).rejects.toBeInstanceOf(
      PrincipalApplicationPaginationCancelledErrorV3,
    );
    await vi.waitFor(() => expect(applications).toHaveBeenCalledTimes(2));

    controller.abort();

    await rejected;
    expect(pageSignal?.aborted).toBe(true);
  });

  it("passes the aggregate signal through the API client to fetch", async () => {
    const controller = new AbortController();
    const fetchV2 = vi.fn(async (_path: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(init?.signal).not.toBe(controller.signal);
      return new Response(JSON.stringify({
        schemaVersion: "programmable.principal-custom-launch-application-list.v3",
        subject: {
          provider: "github",
          githubUserId: "123456789",
          githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
        },
        applications: [application(0)],
        nextCursor: null,
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    const client = createCustomLaunchWebsiteClientV2({
      session: {
        accessToken: "access-token-value",
        identityToken: "identity-token-value",
      },
      fetch: fetchV2,
    });

    await expect(readAllPrincipalApplicationsV3(client, {
      signal: controller.signal,
    })).resolves.toMatchObject({ applications: [{ applicationId: "application-0" }] });
    expect(fetchV2).toHaveBeenCalledOnce();
  });
});
