import { toEventSelector } from "viem";
import { moduleModeLaunchAbi } from "./provenance";
import { MODULE_MODE_FINALITY_POLICY, MODULE_MODE_RELEASE_SCHEMA, MODULE_MODE_SOURCE_VERSION } from "./release";

/** Public integration metadata. The release and its deployed addresses are resolved separately. */
export const moduleModeIndexerContract = {
  schemaVersion: "programmable.module-mode-indexer.v1",
  chainId: 4663,
  sourceVersion: MODULE_MODE_SOURCE_VERSION,
  launchIdentityVersion: 1,
  guide: "https://programmable.market/developer-reference/module-mode-indexing",
  markdown: "https://programmable.market/developers/module-mode-indexing-v1.md",
  release: {
    url: "https://programmable.market/api/module-mode",
    responsePath: "release",
    schemaVersion: MODULE_MODE_RELEASE_SCHEMA,
    required: { enabled: true, status: "active", chainId: 4663, sourceVersion: MODULE_MODE_SOURCE_VERSION },
    addressPath: "contracts.launcher.address",
    runtimeHashPath: "contracts.launcher.runtimeCodeHash",
    startBlockPath: "startBlock",
    identityPath: "releaseDigest",
    sourceCommitPath: "sourceCommit",
    finalityPolicy: MODULE_MODE_FINALITY_POLICY,
  },
  abi: moduleModeLaunchAbi,
  events: moduleModeLaunchAbi.filter(entry => entry.type === "event").map(entry => ({
    name: entry.name, topic0: toEventSelector(entry),
    indexedInputs: entry.inputs.filter(input => "indexed" in input && input.indexed).map(input => input.name),
  })),
  identities: {
    token: ["chainId", "tokenAddress"],
    pool: ["chainId", "poolManager", "poolId"],
    launch: ["chainId", "sourceAddress", "launchId"],
    event: ["chainId", "blockHash", "transactionHash", "logIndex"],
    checkpoint: ["chainId", "sourceAddress", "sourceReleaseDigest", "blockNumber", "blockHash"],
    creator: "ModuleNativeLaunched.launchWallet",
  },
  normalizedRecord: {
    sourceKind: MODULE_MODE_SOURCE_VERSION,
    routerAddress: null,
    stampHash: null,
    requiredFields: ["sourceKind", "sourceAddress", "sourceReleaseDigest", "launchId", "tokenAddress",
      "hookAddress", "creator", "poolManager", "poolId", "recipeHash", "runtime", "launchKey",
      "verificationDigest", "modulePackageIds", "moduleFamilyIds", "transactionHash", "blockNumber",
      "blockHash", "logIndex", "launchedAt", "name", "symbol", "decimals", "routerAddress", "stampHash"],
    integerEncoding: { blockNumber: "decimal-string", logIndex: "nonnegative-safe-integer", decimals: "integer" },
    moduleIds: "Opaque bytes32 identifiers. Preserve their order and values; no module-name allowlist.",
    optionalEnrichment: ["module titles", "configuration labels", "icons", "market data", "trading support"],
  },
  reads: {
    websiteList: { url: "https://programmable.market/api/explore/robinhood", purpose: "Website discovery with presentation filters; not a complete archival feed." },
    creatorList: { url: "https://programmable.market/api/profile/robinhood?account={launchWallet}", purpose: "Creator profile lookup; traverse all pages." },
    archive: "Scan the bound launcher from release.startBlock to an independently verified finalized boundary. Persist a separate checkpoint for each release.",
  },
  source: "https://github.com/programmablehq/PROGRAMMABLE/blob/production/lib/module-mode/provenance.ts",
  versioning: "New modules within this source version use the same launch identity. A different source version requires its published adapter; preserve existing records while adding it.",
} as const;
