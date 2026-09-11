// Mirrored protected native environment; historical quote evidence is unchanged.
import { keccak256, stringToHex } from "viem";

/** Native fees are a distinct owned environment. Historical quote-fee evidence remains unchanged. */
export const MODULE_ENGINE_SHARED_QUOTE_ETH_POLICY_V1 = Object.freeze({
  profile: "robinhood-any-quote.shared-hook.native-eth.v1",
  hostRequirement: "robinhood-any-quote.shared-hook.native-eth@1",
  sourceVersion: "module-engine-any-quote-eth-v1",
  sourceVersionId: keccak256(stringToHex("programmable.module-engine.any-quote.native-eth.v1")),
  configurationSchemaId: keccak256(stringToHex("programmable.any-quote.configuration.v1")),
  economicsPolicyId: keccak256(stringToHex("programmable.any-quote.base-30.creator-0-1000.native-eth.v1")),
  platformRecipient: "0xd88539d3c4c460136a733a3fd60cf6bf269079da",
  platformBps: 30,
  creatorBpsMaximum: 1000,
  creatorBpsStep: 100,
  chainId: 4663,
  configurationBytes: 256,
  tickSpacing: 200,
  maximumPreparationAge: 180,
} as const);

export const MODULE_ENGINE_SHARED_QUOTE_ETH_CONFIGURATION_ABI_V1 = Object.freeze([
  { path: ["schemaId"], type: "bytes32" },
  { path: ["poolManager"], type: "address" },
  { path: ["poolManagerCodeHash"], type: "bytes32" },
  { path: ["sharedHook"], type: "address" },
  { path: ["quoteAsset"], type: "address" },
  { path: ["initialTick"], type: "int24" },
  { path: ["validUntil"], type: "uint64" },
  { path: ["priceEvidenceHash"], type: "bytes32" },
] as const);

export const MODULE_ENGINE_SHARED_QUOTE_ETH_REVIEW_AREAS_V1 = Object.freeze([
  "quote-base-30-bps-converted-to-native-and-separate-fixed-creator-fees",
  "native-shared-hook-ledger-route-source-runtime-and-configuration-schema",
  "external-router-first-buy-backing-and-permanent-lp-lock",
  "atomic-native-fee-conversion-failure-and-native-claim-backing",
] as const);

export const MODULE_ENGINE_SHARED_QUOTE_ETH_CHECKS_V1 = Object.freeze([
  "policyAndRuntimeBound", "zeroQuoteLaunch", "initialBuyRollback", "externalRouterFourForms",
  "partialFillRejected", "nativeFeeConversion", "nativeClaimsBacked", "conversionRollback",
] as const);

// Generated from frozen source 08f62cbdf1d2affccda6e180474ceed6b42328e3 and owned review-driver bytes.
export const MODULE_ENGINE_SHARED_QUOTE_ETH_ENVIRONMENT_V1 = Object.freeze({
  profile: "robinhood-any-quote.shared-hook.native-eth.v1",
  sourceDigest: "0x4095fed1043a7b3579c21ab7ee3fbd988327e31bd002d18191b6aa1fdf921919",
} as const);
export const MODULE_ENGINE_SHARED_QUOTE_ETH_REVIEW_LEDGER_V1 = "0x479056b9a48d1f7b80f2f18238f260f915bf2fc4" as const;
export const MODULE_ENGINE_SHARED_QUOTE_ETH_REVIEW_INFRASTRUCTURE_V1 = Object.freeze({
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  poolManagerCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  sharedHook: "0xd2b14819f2ce15c6f7d1e8c817610028ff9160cc",
} as const);
