// Mirrored source-bound policy of the protected shared-quote review adapter.
import { keccak256, stringToHex } from "viem";

/** This source-bound policy is specific to the new shared hook. Historical Engine/Native fees are unchanged. */
export const MODULE_ENGINE_SHARED_QUOTE_POLICY_V1 = Object.freeze({
  profile: "robinhood-any-quote.shared-hook.v1",
  hostRequirement: "robinhood-any-quote.shared-hook@1",
  sourceVersion: "module-engine-any-quote-v1",
  sourceVersionId: keccak256(stringToHex("programmable.module-engine.any-quote.v1")),
  configurationSchemaId: keccak256(stringToHex("programmable.any-quote.configuration.v1")),
  economicsPolicyId: keccak256(stringToHex("programmable.any-quote.base-30.creator-0-1000.v1")),
  platformRecipient: "0xd88539d3c4c460136a733a3fd60cf6bf269079da",
  platformBps: 30,
  creatorBpsMaximum: 1000,
  creatorBpsStep: 100,
  chainId: 4663,
  configurationBytes: 256,
  tickSpacing: 200,
  maximumPreparationAge: 180,
} as const);

export const MODULE_ENGINE_SHARED_QUOTE_CONFIGURATION_ABI_V1 = Object.freeze([
  { path: ["schemaId"], type: "bytes32" },
  { path: ["poolManager"], type: "address" },
  { path: ["poolManagerCodeHash"], type: "bytes32" },
  { path: ["sharedHook"], type: "address" },
  { path: ["quoteAsset"], type: "address" },
  { path: ["initialTick"], type: "int24" },
  { path: ["validUntil"], type: "uint64" },
  { path: ["priceEvidenceHash"], type: "bytes32" },
] as const);

export const MODULE_ENGINE_SHARED_QUOTE_REVIEW_AREAS_V1 = Object.freeze([
  "quote-base-30-bps-recipient-and-separate-fixed-creator-fees",
  "shared-hook-ledger-source-runtime-and-configuration-schema",
  "external-router-first-buy-backing-and-permanent-lp-lock",
] as const);

export const MODULE_ENGINE_SHARED_QUOTE_CHECKS_V1 = Object.freeze([
  "policyAndRuntimeBound", "zeroQuoteLaunch", "initialBuyRollback", "externalRouterFourForms",
  "partialFillRejected", "quoteClaimsBacked",
] as const);

// Fixed owned-source identity. Runtime compilation also requires the archived final core handoff.
export const MODULE_ENGINE_SHARED_QUOTE_ENVIRONMENT_V1 = Object.freeze({
  profile: "robinhood-any-quote.shared-hook.v1",
  sourceDigest: "0x445a9b5494c7b354cdceaf4b00d0b159929935188fcc5dee213cb458ef0e632b",
} as const);
export const MODULE_ENGINE_SHARED_QUOTE_REVIEW_LEDGER_V1 = "0xc73eddb25c1f02e4798500d43ca2131083d6a27f" as const;
// Only these three fields may be rebound after validation against the submitted source schema.
export const MODULE_ENGINE_SHARED_QUOTE_REVIEW_INFRASTRUCTURE_V1 = Object.freeze({
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  poolManagerCodeHash: "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
  sharedHook: "0xde8471377c8d6030049073068ec6cfd5273620cc",
} as const);
