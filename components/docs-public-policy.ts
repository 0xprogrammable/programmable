import { PROGRAMMABLE_FEE_POLICY } from "@/components/developer-docs-contract";
import { PLATFORM_FEE_BPS } from "@/lib/launch";

// Compatibility data for internal policy tests and machine-readable tooling.
// Public pages use neutral copy and do not render these lifecycle labels.
export type DocsLifecycle = "Live" | "Preview" | "Planned" | "Legacy";
export type DocsAvailability = "Open" | "Gated" | "Unavailable";

export type DocsProductState = Readonly<{
  availability: DocsAvailability;
  detail: string;
  label: string;
  lifecycle: DocsLifecycle;
}>;

export const PROGRAMMABLE_PUBLIC_REPOSITORIES = {
  developers: "https://github.com/programmablehq/Developers",
  product: "https://github.com/programmablehq/PROGRAMMABLE",
  productIssues: "https://github.com/programmablehq/PROGRAMMABLE/issues",
  launchPolicy: "https://github.com/programmablehq/Launch-Policy",
} as const;

export const PROGRAMMABLE_PRODUCT_STATES = {
  classic: {
    availability: "Open",
    detail: "Classic launches are available through Create.",
    label: "Classic",
    lifecycle: "Live",
  },
  custom: {
    availability: "Open",
    detail:
      "Custom launch preparation uses a wallet-bound API key, and the controller wallet signs separately.",
    label: "Custom hooks",
    lifecycle: "Live",
  },
  publicTemplates: {
    availability: "Unavailable",
    detail:
      "The public template submission and creator payout workflow is being prepared.",
    label: "Public templates",
    lifecycle: "Planned",
  },
  stockPaired: {
    availability: "Unavailable",
    detail: "Existing launches remain documented. New launches are closed.",
    label: "Stock-Paired",
    lifecycle: "Legacy",
  },
} as const satisfies Record<string, DocsProductState>;

export const PROGRAMMABLE_STATUS_REVIEW = {
  expiresAtIso: "2026-09-10T00:00:00Z",
  reviewedAtIso: "2026-08-11T00:00:00Z",
} as const;

export function isProgrammableStatusCurrent(nowMs = Date.now()): boolean {
  return nowMs <= Date.parse(PROGRAMMABLE_STATUS_REVIEW.expiresAtIso);
}

export const PROGRAMMABLE_FEE_TABLE = {
  classic: {
    basis: "gross native swap amount",
    chargeMode: "included in the selected buy or sell fee",
    creatorShare:
      "the selected fee minus the Programmable share, paid as creator rewards",
    programmableBps: PLATFORM_FEE_BPS,
    status: "Live",
    total: "selected separately for buys and sells from 100 to 1,000 bps",
  },
  publicTemplate: {
    basis: "an official launch using the exact active template version",
    chargeMode: "one 20 bps public template fee",
    creatorBps: 10,
    programmableBps: 10,
    status: "Planned",
    totalBps: 20,
  },
  standardCustom: {
    basis: "a verified official Custom market path",
    chargeMode: "added to the project hook fee",
    programmableBps: PROGRAMMABLE_FEE_POLICY.nativeCustom.programmableShareBps,
    status: "Gated",
    totalBps: PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps,
  },
  robinhoodCustom: {
    basis: "gross native ETH amount per successful buy or sell",
    chargeMode: "additional to creator and pool fees",
    programmableBps: 20,
    recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    rounding: "rounded up to the next wei per trade",
  },
} as const;

export const PROGRAMMABLE_REVENUE_TARGET = {
  basis: "attributable net Programmable protocol revenue",
  buybackBps: 8_000,
  keeperBps: 0,
  status: "Planned",
  treasuryBps: 2_000,
} as const;

export const PROGRAMMABLE_REVENUE_CURRENT = {
  basis: "revenue processed by the current V2 deployment",
  buybackBps: 4_950,
  keeperBps: 50,
  status: "Live",
  treasuryBps: 5_000,
} as const;

export const V4_TOKEN_ADDRESS = "0x7987f03462200b3D8A072E02C89A8A41dCB124EE";

export function formatBps(bps: number): string {
  return `${bps} bps (${(bps / 100).toFixed(2)}%)`;
}
