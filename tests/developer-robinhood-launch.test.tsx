import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { developerApiKeysInitialSection } from
  "../lib/developer-api-key-route";
import {
  DeveloperRobinhoodLaunch,
  MAX_ROBINHOOD_LAUNCH_BYTES,
  ROBINHOOD_CREATE_URL,
  ROBINHOOD_PREFLIGHT_URL,
  RobinhoodFeePolicyDisclosure,
  createRobinhoodLaunch,
  isRobinhoodIdempotencyKey,
  preflightRobinhoodLaunch,
} from "../components/developer-robinhood-launch";

const componentSource = readFileSync(
  new URL("../components/developer-robinhood-launch.tsx", import.meta.url),
  "utf8",
);
const apiKeysSource = readFileSync(
  new URL("../components/developer-api-keys.tsx", import.meta.url),
  "utf8",
);
const launchEntrySource = readFileSync(
  new URL("../components/launch-entry.tsx", import.meta.url),
  "utf8",
);

const apiKey = `pm_live_${"A".repeat(22)}_${"B".repeat(43)}`;
const idempotencyKey = ["test", "robinhood", "replay", "0001"].join("-");
const launchId = "018f3e2a-7b4c-7d5e-8f90-123456789abc";

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function preflightResponse(deployable = true) {
  return {
    schemaVersion: "programmable.custom-launch-preflight.v2",
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    requestHash: `sha256:${"1".repeat(64)}`,
    rawRequestSha256: `sha256:${"2".repeat(64)}`,
    disposition: deployable ? "supported" : "needs_evidence",
    launchEligibility: {
      deployable,
      routable: false,
      featured: false,
    },
    hardBlockFindingCodes: [],
    needsEvidenceFindingCodes: deployable ? [] : ["SOURCE_EVIDENCE_REQUIRED"],
    warningFindingCodes: [],
    quotaConsumed: false,
    nonceAllocated: false,
    persisted: false,
    walletSignatureRequiredLater: true,
    walletBroadcastByService: false,
  };
}

function createdResponse(status = "accepted") {
  return {
    schemaVersion: "programmable.custom-launch.v4",
    apiVersion: "v4",
    chainId: "4663",
    caip2: "eip155:4663",
    routeId: "custom-launch:create:v4",
    launchId,
    requestId: launchId,
    status,
  };
}

describe("Robinhood Custom launch website flow", () => {
  it("sends the same exact ArrayBuffer directly to preflight and create", async () => {
    const requestBytes = new TextEncoder().encode('{"exact":true}\n').buffer;
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(preflightResponse()))
      .mockResolvedValueOnce(json(createdResponse(), 202));

    const proof = await preflightRobinhoodLaunch(
      fetcher,
      apiKey,
      requestBytes,
    );
    const created = await createRobinhoodLaunch(
      fetcher,
      apiKey,
      idempotencyKey,
      proof,
    );

    expect(created.launchId).toBe(launchId);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe(ROBINHOOD_PREFLIGHT_URL);
    expect(fetcher.mock.calls[1]?.[0]).toBe(ROBINHOOD_CREATE_URL);
    const preflightInit = fetcher.mock.calls[0]?.[1] as RequestInit;
    const createInit = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(preflightInit.body).toBe(requestBytes);
    expect(createInit.body).toBe(requestBytes);
    expect(createInit.body).toBe(preflightInit.body);
    for (const init of [preflightInit, createInit]) {
      expect(init.credentials).toBe("omit");
      expect(init.referrerPolicy).toBe("no-referrer");
      expect(init.redirect).toBe("error");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("authorization"))
        .toBe(`Bearer ${apiKey}`);
    }
    expect(new Headers(preflightInit.headers).has("idempotency-key"))
      .toBe(false);
    expect(new Headers(createInit.headers).get("idempotency-key"))
      .toBe(idempotencyKey);
  });

  it.each([200, 202])(
    "accepts the verified create resource for HTTP %i",
    async (status) => {
      const requestBytes = new TextEncoder().encode("{}").buffer;
      const preflightFetcher = vi.fn().mockResolvedValue(
        json(preflightResponse()),
      );
      const proof = await preflightRobinhoodLaunch(
        preflightFetcher,
        apiKey,
        requestBytes,
      );
      const createFetcher = vi.fn().mockResolvedValue(
        json(createdResponse(status === 200 ? "replayed" : "accepted"), status),
      );

      await expect(createRobinhoodLaunch(
        createFetcher,
        apiKey,
        idempotencyKey,
        proof,
      )).resolves.toMatchObject({ launchId });
    },
  );

  it("retries an ambiguous create with the same body and Idempotency-Key", async () => {
    const requestBytes = new TextEncoder().encode("{}").buffer;
    const proof = await preflightRobinhoodLaunch(
      vi.fn().mockResolvedValue(json(preflightResponse())),
      apiKey,
      requestBytes,
    );
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(json(createdResponse("replayed"), 200));

    await expect(createRobinhoodLaunch(
      fetcher,
      apiKey,
      idempotencyKey,
      proof,
    )).rejects.toThrow("create result is unknown");
    await expect(createRobinhoodLaunch(
      fetcher,
      apiKey,
      idempotencyKey,
      proof,
    )).resolves.toMatchObject({ status: "replayed" });

    const first = fetcher.mock.calls[0]?.[1] as RequestInit;
    const retry = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(first.body).toBe(requestBytes);
    expect(retry.body).toBe(requestBytes);
    expect(new Headers(first.headers).get("idempotency-key"))
      .toBe(idempotencyKey);
    expect(new Headers(retry.headers).get("idempotency-key"))
      .toBe(idempotencyKey);
  });

  it("enforces the exact 16 MiB body limit before any network request", async () => {
    const fetcher = vi.fn();
    expect(MAX_ROBINHOOD_LAUNCH_BYTES).toBe(16 * 1024 * 1024);

    await expect(preflightRobinhoodLaunch(
      fetcher,
      apiKey,
      new ArrayBuffer(MAX_ROBINHOOD_LAUNCH_BYTES + 1),
    )).rejects.toThrow("no larger than 16 MiB");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps blocked preflight honest and refuses create", async () => {
    const requestBytes = new TextEncoder().encode("{}").buffer;
    const proof = await preflightRobinhoodLaunch(
      vi.fn().mockResolvedValue(json(preflightResponse(false))),
      apiKey,
      requestBytes,
    );

    expect(proof.deployable).toBe(false);
    await expect(createRobinhoodLaunch(
      vi.fn(),
      apiKey,
      idempotencyKey,
      proof,
    )).rejects.toThrow("did not pass a deployable preflight");
  });

  it("renders secret-safe, accessible controls and locks replay identity", () => {
    const html = renderToStaticMarkup(
      <DeveloperRobinhoodLaunch onOpenLaunch={() => undefined} />,
    );

    expect(html).toContain('type="password"');
    expect(html).toContain('id="robinhood-launch-file"');
    expect(html).toContain('accept=".json,application/json"');
    expect(html).toContain("Preflight required");
    expect(html).toContain("Create launch request");
    expect(html).toContain("never signs or broadcasts");
    expect(html).not.toContain("Robinhood fee policy");
    expect(html).not.toContain("0xD88539d3c4C460136a733A3Fd60cf6BF269079da");
    expect(html).not.toContain("fee-policy-pending");
    expect(html).not.toContain(apiKey);
    expect(componentSource).not.toContain("localStorage");
    expect(componentSource).not.toContain("sessionStorage");
    expect(componentSource).not.toContain("console.");
    expect(componentSource).toContain("setIdempotencyLocked(true)");
    expect(componentSource).toContain("disabled={busy || idempotencyLocked}");
    expect(isRobinhoodIdempotencyKey(idempotencyKey)).toBe(true);
    expect(isRobinhoodIdempotencyKey("too-short")).toBe(false);
  });

  it("renders one static, labelled fee policy disclosure outside the private launch form", () => {
    const html = renderToStaticMarkup(<RobinhoodFeePolicyDisclosure />);

    expect(html).toContain(
      'aria-labelledby="robinhood-fee-policy-title"',
    );
    expect(html).toContain(
      '<span id="robinhood-fee-policy-title">Robinhood fee policy</span><span>0.20%</span>',
    );
    expect(html).toContain(
      "Programmable policy for new Robinhood V4 API Custom launch requests is 0.20% (2,000 ppm), recipient <code>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code>. Existing launches are unchanged.",
    );
    expect(html).toContain(
      "The current V4 runtime does not claim immutable onchain fee enforcement, fee behavior, claiming, or guaranteed revenue. The Launch Stamp proves provenance only.",
    );
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain("fee-policy-pending");
  });

  it("shares key management while retaining explicit Robinhood launch deep links", () => {
    expect(launchEntrySource).toContain(
      'href="/developers/api-keys"',
    );
    expect(launchEntrySource).toContain('data-launch-model-launchable="false"');
    expect(launchEntrySource).not.toContain("Live API");
    expect(apiKeysSource).toContain(
      'url.searchParams.get("start") === "custom"',
    );
    expect(apiKeysSource).toContain(
      'url.searchParams.get("chainId") === "4663"',
    );
    expect(apiKeysSource).toContain('setActiveSection("launch")');
    expect(apiKeysSource.match(/<RobinhoodFeePolicyDisclosure \/>/gu))
      .toHaveLength(1);
    expect(apiKeysSource.indexOf("<RobinhoodFeePolicyDisclosure />"))
      .toBeLessThan(apiKeysSource.indexOf("{!authReady ? ("));
    expect(apiKeysSource.indexOf("<DeveloperRobinhoodLaunch"))
      .toBeGreaterThan(apiKeysSource.indexOf(") : !account ? ("));
    expect(developerApiKeysInitialSection({
      start: "custom",
      chainId: "4663",
    })).toBe("launch");
    expect(developerApiKeysInitialSection({
      start: "custom",
      chainId: "1",
    })).toBe("keys");
    expect(developerApiKeysInitialSection({ chainId: "4663" })).toBe("keys");
  });
});
