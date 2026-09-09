// Public projection contracts from the chain-specific Explore routes and readers.
type Schema = Record<string, unknown>;
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties: Record<string, Schema>, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });
const nullable = (schema: Schema) => ({ anyOf: [schema, { type: "null" }] });
const array = (items: Schema) => ({ type: "array", items });
const text = { type: "string" };
const integer = { type: "integer", minimum: 0 };
const timestamp = { type: "string", format: "date-time" };
const address = ref("EthereumAddress");
const hash = ref("Hex32");
const block = ref("CanonicalUint256");
const checkpoint = nullable(object({ number: block, hash }));
const sourceStatus = { enum: ["current", "last-known-good", "unavailable"] };
const page = object({ number: { type: "integer", minimum: 1 }, size: { enum: [10, 50] },
  totalItems: integer, totalPages: integer, hasMore: { type: "boolean" } });
const market = nullable(object({ poolId: text, priceUsd: nullable({ type: "number" }),
  marketCapUsd: nullable({ type: "number" }), liquidityUsd: nullable({ type: "number" }),
  volume24hUsd: nullable({ type: "number" }), change24hPercent: nullable({ type: "number" }),
  observedAt: timestamp, sourceUrl: text }));
const presentation = (marketSchema: Schema) => object({ tokenAddress: address,
  imageUrl: nullable(text), description: nullable(text),
  links: array(object({ label: text, url: text })), market: marketSchema });

const ethereumSource = nullable(object({ source: { enum: ["envio-classic-v3", "canonical-launch-stamp-router"] },
  asOfBlock: block, asOfBlockHash: hash, commitment: ref("Sha256Digest"), generatedAt: timestamp,
  deployment: text, sourceCommit: text }, ["source", "asOfBlock", "asOfBlockHash", "commitment", "generatedAt"]));
const ethereumProvenance = { oneOf: [
  object({ schemaVersion: { const: "programmable.explore-launch-category-provenance.v1" },
    category: { const: "classic" }, source: { const: "canonical-launch-read-model" },
    recordId: text, modelId: nullable(text), modelVersion: nullable(text) }),
  object({ schemaVersion: { const: "programmable.explore-launch-category-provenance.v1" },
    category: { enum: ["classic", "custom"] }, source: { const: "canonical-launch-stamp-router" },
    launchId: hash, stampHash: hash, routerAddress: address, transactionHash: hash, blockHash: hash,
    blockNumber: block, transactionIndex: integer, logIndex: integer }),
] };
const ethereumItem = object({ launchId: text, tokenAddress: address, hookAddress: address,
  creator: address, transactionHash: hash, blockNumber: block, launchedAt: text,
  name: text, symbol: text, decimals: nullable({ type: "integer" }),
  category: { enum: ["classic", "custom"] }, provenance: ethereumProvenance },
["launchId", "tokenAddress", "hookAddress", "launchedAt", "name", "symbol", "decimals", "category", "provenance"]);
const robinhoodItem = object({
  routerAddress: nullable(address), launchId: text,
  tokenAddress: { ...address, description: "Address used by the Coin route. For a projected launch without a primary asset, this identifies the first declared component and does not imply an ERC-20 role." },
  hookAddress: nullable(address),
  creator: address, poolManager: nullable(address), poolId: nullable(hash), stampHash: nullable(hash),
  transactionHash: hash, blockNumber: block, blockHash: hash, logIndex: integer,
  launchedAt: nullable(timestamp), name: nullable(text), symbol: nullable(text), decimals: nullable({ type: "integer" }),
  sourceKind: { enum: ["module-native-v1", "module-native-v2", "module-engine-v1", "multi-role-v2", "custom-launch-plan-v1"] },
  primaryAssetAddress: nullable(address),
  launchProjection: { $ref: "https://programmable.market/openapi/custom-launch-v4.2.json#/components/schemas/LaunchProjectionV1" },
  sourceAddress: address, sourceReleaseDigest: hash, recipeHash: hash, runtime: address,
  launchKey: hash, verificationDigest: hash, modulePackageIds: array(hash), moduleFamilyIds: array(hash),
  economicsPolicyId: text, protocolFeeBps: { const: 10 }, authorPoolFeeBps: { enum: [0, 20] },
  platformFeeBps: { enum: [10, 30] }, feeEligibleFamilyIds: array(hash),
  engineAddress: address, engineRevisionId: hash, engineFamilyId: hash, engineManifestHash: hash,
  engineRuntimeCodeHash: hash, tokenRuntimeCodeHash: hash, quoteAsset: address, quoteDecimals: integer,
  configurationHash: hash, constructorHash: hash, initCodeHash: hash, planHash: hash, resourcesHash: hash,
  primaryMarket: nullable(object({ kind: { const: "uniswap-v4" }, chainId: { const: 4663 },
    launchId: hash, poolManager: address, poolId: hash, quoteAsset: address, primaryToken: address,
    hook: address, initialTick: { type: "integer" } })),
}, ["routerAddress", "launchId", "tokenAddress", "hookAddress", "creator", "poolManager", "poolId", "stampHash",
  "transactionHash", "blockNumber", "blockHash", "logIndex", "launchedAt", "name", "symbol", "decimals"]);
const robinhoodSource = object({ source: { const: "canonical-launch-stamp-router" }, sourceAddress: address,
  binding: text, startBlock: block, cursor: checkpoint, finalizedBlock: block, updatedAt: timestamp });
const moduleSource = object({ source: { enum: ["module-native-v1", "module-native-v2", "module-engine-v1"] },
  sourceAddress: address, releaseDigest: hash, startBlock: block, cursor: checkpoint, finalizedBlock: block, updatedAt: timestamp });
const launchProjectionSource = nullable(object({
  sourceUrl: { const: "https://api.programmable.market/v4/chains/4663/finalized-launch-projections" },
  updatedAt: timestamp, nextCursor: nullable(text),
}));

export const chainExploreSchemas = {
  EthereumExplorePage: object({ chainId: { const: 1 }, status: { enum: ["ready", "partial", "stale", "unavailable"] },
    sources: object({ classic: sourceStatus, custom: sourceStatus }),
    sourceEvidence: object({ classic: ethereumSource, custom: ethereumSource }), updatedAt: nullable(timestamp),
    items: { ...array(ethereumItem), maxItems: 50 }, presentations: { ...array(presentation({ type: "null" })), maxItems: 50 }, page }),
  RobinhoodExplorePage: object({ chainId: { const: 4663 }, status: { enum: ["ready", "syncing", "stale", "unavailable"] },
    updatedAt: nullable(timestamp), items: { ...array(robinhoodItem), maxItems: 50 }, page,
    sourceEvidence: nullable(object({ router: robinhoodSource, modules: array(moduleSource), launchProjections: launchProjectionSource })),
    presentations: { ...array(presentation(market)), maxItems: 50 } }),
  ChainExploreInvalidQuery: object({ error: { const: "invalid_query" } }),
  EthereumExploreUnavailable: object({ error: { const: "Launches are temporarily unavailable" }, status: { const: "unavailable" } }),
} as const;

const response = (schema: Schema, description: string) => ({ description, content: { "application/json": { schema } } });
const statusPage = (name: string, statuses: readonly string[]) => ({ allOf: [ref(name), { properties: { status: { enum: statuses } } }] });
const parameters = (chain: "ethereum" | "robinhood") => [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 999999, default: 1 },
    description: "A positive decimal page number, at most six digits. The reader clamps it to the available pages." },
  { name: "pageSize", in: "query", schema: { type: "integer", enum: [10, 50], default: chain === "ethereum" ? 10 : 50 } },
  { name: "q", in: "query", schema: { type: "string", maxLength: 128, default: "" }, description: "Search text, at most 128 UTF-16 code units." },
  { name: "sort", in: "query", schema: { type: "string", enum: chain === "ethereum" ? ["newest", "oldest"] : ["highest", "lowest", "newest", "oldest"],
    default: chain === "ethereum" ? "newest" : "highest" } },
  { name: "mode", in: "query", schema: { type: "string", enum: chain === "ethereum" ? ["all", "classic", "custom"] : ["all", "module", "custom"], default: "all" },
    description: "Filter published launch sources in this presentation feed. These values do not restrict module source submissions." },
];
const headers = (statuses: readonly string[], cache: readonly string[]) => ({
  "X-Programmable-Indexing-Status": { schema: { enum: statuses } },
  "Cache-Control": { schema: { enum: cache } },
});
export const chainExplorePaths = {
  "/api/explore/ethereum": { get: {
    operationId: "listEthereumExploreLaunches", summary: "Read Ethereum launch pages",
    description: "Combines the verified Classic catalog and finalized Ethereum Router identities. ready means both sources are current; partial means one source is unavailable; stale means a saved source is being used. No source yields unavailable. updatedAt is the oldest included source observation. Market values are null. Unknown or repeated query parameters are rejected; no chain override is accepted. This presentation feed is not a complete archive or proof of tradability.",
    tags: ["Discovery"], security: [], parameters: parameters("ethereum"), responses: {
      "200": { ...response(statusPage("EthereumExplorePage", ["ready", "partial", "stale"]), "Current, partial or saved verified identities."),
        headers: headers(["ready", "partial", "stale"], ["public, max-age=0, s-maxage=15", "no-store"]) },
      "400": response(ref("ChainExploreInvalidQuery"), "Unsupported, duplicated or out-of-range query."),
      "503": { ...response({ oneOf: [statusPage("EthereumExplorePage", ["unavailable"]), ref("EthereumExploreUnavailable")] }, "No usable source, or a source conflict/read failure."),
        headers: headers(["unavailable"], ["no-store"]) },
    },
  } },
  "/api/explore/robinhood": { get: {
    operationId: "listRobinhoodExploreLaunches", summary: "Read Robinhood Chain launch pages",
    description: "Reads the saved verified Custom Router, exact Module Mode release indexes and finalized launch projections. Projected launches may have no primary asset or market; their original source, assurance and provider states remain separate. ready means each saved source has reached its finalized cursor; syncing means an admitted source is still catching up; stale means an observation is over five minutes old; unavailable means the snapshot cannot be read. updatedAt is the oldest source observation. Optional market observations drive highest/lowest sorting; missing values sort after known values. The verified main token retains the first slot on every page, independently of the query and mode. Public reads do not fall through to RPC indexing. Unknown or repeated query parameters are rejected; no chain override is accepted. This presentation feed is not a complete archive or a publication authority.",
    tags: ["Discovery"], security: [], parameters: parameters("robinhood"), responses: {
      "200": { ...response(statusPage("RobinhoodExplorePage", ["ready", "syncing", "stale"]), "Verified saved launch identities with optional presentations and markets."),
        headers: headers(["ready", "syncing", "stale"], ["public, max-age=0, s-maxage=15, stale-while-revalidate=30", "no-store"]) },
      "400": response(ref("ChainExploreInvalidQuery"), "Unsupported, duplicated or out-of-range query."),
      "503": { ...response(statusPage("RobinhoodExplorePage", ["unavailable"]), "No usable saved index. The response retains the empty page envelope."),
        headers: headers(["unavailable"], ["no-store"]) },
    },
  } },
} as const;
