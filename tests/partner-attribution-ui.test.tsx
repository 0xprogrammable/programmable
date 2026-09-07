import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PartnerLaunchAttribution } from
  "../components/partner-launch-attribution";
import {
  parseLaunchPartnerAttributionV1,
  type LaunchPartnerAttributionV1,
} from "../lib/launch-partner-attribution";
import {
  PARTNER_ADMIN_SCHEMA_V1,
  PARTNER_BUDGET_LIMITS_V1,
  parsePartnerListV1,
  parsePartnerListPageV1,
  parsePartnerRootKeyMutationV1,
} from "../lib/partner-admin-contract";

const PARTNER_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const ROOT_KEY_ID = "028f3e2a-7b4c-7d5e-8f90-123456789abc";
const KEY_ID = "A".repeat(22);

const ATTRIBUTION = Object.freeze({
  schemaVersion: "programmable.launch-partner-attribution.v1",
  partnerId: PARTNER_ID,
  name: "Partner Studio",
  website: "https://partner.example/",
  attributionSource: "authenticated-partner-api-key",
  attributionVersion: 1,
  snapshotDigest: `sha256:${"a1".repeat(32)}`,
}) satisfies LaunchPartnerAttributionV1;

const ROOT_KEY = Object.freeze({
  id: ROOT_KEY_ID,
  partnerId: PARTNER_ID,
  keyId: KEY_ID,
  label: "Primary root key",
  keyPrefix: `pm_partner_root_${KEY_ID}`,
  scopes: [
    "custom-launch:create",
    "custom-launch:read",
    "partner-subkeys:manage",
  ],
  budgets: {
    prepareRequestsPerHour: 100,
    readRequestsPerMinute: 60,
    subkeyAdminRequestsPerHour: 20,
  },
  createdAt: "2026-08-27T10:00:00.000Z",
  expiresAt: "2027-08-28T10:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  rotatedFromRootKeyId: null,
});

const PARTNER = Object.freeze({
  id: PARTNER_ID,
  slug: "partner-studio",
  displayName: "Partner Studio",
  publicUrl: "https://partner.example/",
  status: "active",
  createdAt: "2026-08-27T10:00:00.000Z",
  updatedAt: "2026-08-27T10:00:00.000Z",
  suspendedAt: null,
  revokedAt: null,
  rootKeys: [ROOT_KEY],
});

describe("partner attribution UI", () => {
  it("accepts only the exact server-owned attribution snapshot", () => {
    expect(parseLaunchPartnerAttributionV1(ATTRIBUTION)).toEqual(ATTRIBUTION);
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      launchedVia: "caller-controlled",
    })).toBeNull();
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      website: "https://partner.example/?api_key=secret",
    })).toBeNull();
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      website: "https://partner.example/?%2561pi_key=secret",
    })).toBeNull();
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      website: "https://partner.example/%C2%85",
    })).toBeNull();
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      website: "https://partner.example/%E2%80%8B",
    })).toBeNull();
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      name: "Partner\u202eStudio",
    })).toBeNull();
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      attributionSource: "request-body",
    })).toBeNull();
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      name: "A".repeat(96),
    })?.name).toHaveLength(96);
    expect(parseLaunchPartnerAttributionV1({
      ...ATTRIBUTION,
      name: "A".repeat(97),
    })).toBeNull();
  });

  it("renders the exact public label as an accessible external link", () => {
    const html = renderToStaticMarkup(
      <PartnerLaunchAttribution attribution={ATTRIBUTION} />,
    );
    expect(html).toContain("Launched via Partner Studio");
    expect(html).toContain('href="https://partner.example/"');
    expect(html).toContain("opens in a new tab");
    expect(html.toLowerCase()).not.toContain("verified");
    expect(html.toLowerCase()).not.toContain("safe");
  });

  it("parses persistent root metadata and a one-time root secret", () => {
    expect(parsePartnerListV1({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partners: [PARTNER],
    })).toEqual([PARTNER]);
    const secret = `${ROOT_KEY.keyPrefix}_${"B".repeat(43)}`;
    expect(parsePartnerRootKeyMutationV1({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partner: PARTNER,
      rootKey: ROOT_KEY,
      secretState: "delivered-once",
      rootKeySecret: secret,
    })?.rootKeySecret).toBe(secret);
    expect(parsePartnerRootKeyMutationV1({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partner: PARTNER,
      rootKey: ROOT_KEY,
      secretState: "already-delivered",
      rootKeySecret: secret,
    })).toBeNull();
  });

  it("binds bounded partner pagination and accepts the backend root-key ceiling", () => {
    const roots = Array.from({ length: 500 }, () => ROOT_KEY);
    const page = parsePartnerListPageV1({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partners: [{ ...PARTNER, rootKeys: roots }],
      pagination: {
        page: 2,
        pageSize: 12,
        totalPartners: 13,
        totalPages: 2,
      },
    });
    expect(page?.partners[0]?.rootKeys).toHaveLength(500);
    expect(parsePartnerListPageV1({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partners: [{ ...PARTNER, rootKeys: [...roots, ROOT_KEY] }],
      pagination: {
        page: 2,
        pageSize: 12,
        totalPartners: 13,
        totalPages: 2,
      },
    })).toBeNull();
    expect(parsePartnerListPageV1({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partners: [PARTNER],
      pagination: {
        page: 2,
        pageSize: 12,
        totalPartners: 25,
        totalPages: 2,
      },
    })).toBeNull();
  });

  it("enforces the backend budget ceilings in browser-facing metadata", () => {
    const maximumBudgets = PARTNER_BUDGET_LIMITS_V1;
    expect(parsePartnerListV1({
      schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
      partners: [{
        ...PARTNER,
        rootKeys: [{ ...ROOT_KEY, budgets: maximumBudgets }],
      }],
    })).not.toBeNull();
    for (const budgets of [
      { ...maximumBudgets, prepareRequestsPerHour: 10_001 },
      { ...maximumBudgets, readRequestsPerMinute: 10_001 },
      { ...maximumBudgets, subkeyAdminRequestsPerHour: 1_001 },
    ]) {
      expect(parsePartnerListV1({
        schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
        partners: [{
          ...PARTNER,
          rootKeys: [{ ...ROOT_KEY, budgets }],
        }],
      })).toBeNull();
    }
  });

  it("keeps attribution in public Explore, Profile and direct token paths", () => {
    const explore = readFileSync(
      new URL("../components/explore-view.tsx", import.meta.url),
      "utf8",
    );
    const profile = readFileSync(
      new URL("../components/profile-view.tsx", import.meta.url),
      "utf8",
    );
    const tokenDetail = readFileSync(
      new URL("../components/token-detail-view.tsx", import.meta.url),
      "utf8",
    );
    expect(explore).toContain("<PartnerLaunchAttribution");
    expect(profile).toContain("<PartnerLaunchAttribution");
    expect(tokenDetail).toContain("<PartnerLaunchAttribution");
    expect(tokenDetail).toContain(
      "parseLaunchPartnerAttributionV1(value.partnerAttribution)",
    );
  });

  it("keeps permanent partner revocation and bounded pages explicit", () => {
    const source = readFileSync(
      new URL("../components/partner-admin-console.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("Revoke permanently");
    expect(source).toContain("This cannot be undone");
    expect(source).toContain('aria-label="Partner pages"');
    expect(source).toContain("ROOT_KEYS_PER_PAGE");
    expect(source).toContain(
      "`Use a whole number from 1 to ${invalidBudget.maximum}.`",
    );
  });

  it("recovers an unlinked partner-admin wallet without retrying the request", () => {
    const source = readFileSync(
      new URL("../components/partner-admin-console.tsx", import.meta.url),
      "utf8",
    );
    const start = source.indexOf('data-state="wallet-not-linked"');
    const end = source.indexOf(") : accessDenied ? (", start);
    const walletRecoveryState = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(walletRecoveryState).toContain("Link this wallet to continue");
    expect(walletRecoveryState).toContain("select another linked wallet");
    expect(walletRecoveryState).toContain("onClick={openWallet}");
    expect(walletRecoveryState).toContain("Link wallet");
    expect(walletRecoveryState).not.toContain("Try again");
  });
});
