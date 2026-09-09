import { V4_API_DISCOVERY, V4_API_PROFILE_VERSION } from "@/lib/custom-launch/v4-api-discovery";
import { robinhoodV4PublicContractDiscovery, robinhoodV4PublicPolicyDescription } from "@/lib/custom-launch/v4-public-contract-discovery";
import { V4_TOKEN_ADDRESS } from "@/components/docs-public-policy";
import { chainExplorePaths, chainExploreSchemas } from "@/lib/public-chain-explore-openapi";

const SITE_ORIGIN = "https://programmable.market";
const CUSTOM_LAUNCH_API_ORIGIN = "https://api.programmable.market";

const jsonResponse = (
  schema: Record<string, unknown>,
  description: string,
) => ({
  description,
  content: {
    "application/json": {
      schema,
    },
  },
});

const component = (name: string) => ({
  $ref: `#/components/schemas/${name}`,
});

const exploreIndexResetStateResponseHeaders = {
  "Cache-Control": {
    description:
      "Reset responses are never stored by clients or shared caches.",
    schema: { const: "no-store" },
  },
  "X-Programmable-Indexing-Status": {
    description: "Explore indexing is intentionally reset while it is rebuilt.",
    schema: { const: "reset" },
  },
} as const;

const exploreIndexResetResponseHeaders = {
  ...exploreIndexResetStateResponseHeaders,
  "Retry-After": {
    description: "Clients may retry after the one-hour reset interval.",
    schema: { const: "3600" },
  },
} as const;

export const programmablePublicOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Programmable developer APIs",
    version: "1.11.0",
    summary:
      "Ethereum and Robinhood Explore feeds, Custom launch contracts and release discovery.",
    description:
      robinhoodV4PublicPolicyDescription(V4_API_PROFILE_VERSION, "The unauthenticated GET /api/explore/ethereum and GET /api/explore/robinhood endpoints serve chain-specific verified launch pages. Their response status distinguishes current, incomplete, saved and unavailable reads; module catalog filters do not restrict source submission ideas. The legacy /api/explore and /api/explore/token routes, including analytics and chart, retain their indexing-reset responses. At the separately hosted Custom Launch API, fresh writes use the public Ethereum V3.3 contract. Robinhood Chain V4 exposes a public self-serve launch path when live publicWrites, publicAuthorization and releaseReady discovery fields are all true. Clients must verify these gates before creating. The required default policy for new Robinhood V4 API Custom launches is 20 bps to the published recipient. It is policy configuration, not proof of canonical onchain fee enforcement, a charged fee or platform revenue, and missing onchain fee enforcement is not itself a write blocker. V2 and V1 history remain readable, while both legacy creation routes are write-fenced with non-retryable 409 CUSTOM_LAUNCH_V2_READ_ONLY and CUSTOM_LAUNCH_V1_READ_ONLY responses. CLI and model checks prepare a request; only the API server decides whether verified evidence permits a wallet handoff. Legacy Registry and GitHub submission intake is closed. An API key and the CLI never sign or broadcast a controller-wallet transaction."),
    contact: {
      name: "Programmable",
      url: `${SITE_ORIGIN}/docs/developers`,
    },
  },
  jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
  servers: [{ url: SITE_ORIGIN, description: "Programmable production" }],
  externalDocs: {
    description: "Programmable developer documentation",
    url: `${SITE_ORIGIN}/docs/developers`,
  },
  tags: [
    {
      name: "Discovery",
      description:
        "Verified chain-specific launch feeds and the explicit reset contracts of legacy Explore routes.",
    },
    {
      name: "Operations",
      description: "Public, provider-free Explore indexing state.",
    },
    {
      name: "Registry",
      description: "Custom Registry public-read readiness and release binding.",
    },
    {
      name: "Metadata",
      description: "Machine-readable API discovery.",
    },
    {
      name: "Custom launch",
      description:
        "Fresh wallet-key, partner-root and bounded-partner-subkey writes use Ethereum V3.3. For Robinhood V4 self-serve writes, resolve the live discovery authority and require publicWrites, publicAuthorization and releaseReady to all be true. Its required 20 bps default policy is not a canonical onchain-enforcement or revenue claim. V2 and V1 remain available for existing history only. Manage wallet keys at programmable.market/developers/api-keys.",
    },
  ],
  paths: {
    ...chainExplorePaths,
    "/api": {
      get: {
        operationId: "getPublicApiIndex",
        summary: "Read the public API index",
        description:
          "Returns canonical links and the safety boundary for the documented read-only surface.",
        tags: ["Metadata"],
        security: [],
        responses: {
          "200": jsonResponse(component("ApiIndex"), "Public API index."),
        },
      },
    },
    "/api/ops/health": {
      get: {
        operationId: "getOperationsHealth",
        summary: "Read the Explore indexing state",
        description:
          "Reports the intentional provider-free Explore index reset. It performs no provider or indexer health check.",
        tags: ["Operations"],
        security: [],
        responses: {
          "200": {
            ...jsonResponse(
              component("OperationsHealth"),
              "Provider-free Explore index reset state.",
            ),
            headers: exploreIndexResetStateResponseHeaders,
          },
        },
      },
    },
    "/api/explore": {
      get: {
        operationId: "listVerifiedLaunches",
        summary: "Read the Explore index reset state",
        description:
          "Valid requests return a deterministic 503 while token indexing is intentionally reset. No catalog, ranking, search, market-data provider or fallback is read.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "chain",
            in: "query",
            description: "Chain namespace retained for request validation.",
            schema: { type: "integer", enum: [1, 4663], default: 1 },
          },
          {
            name: "page",
            in: "query",
            description:
              "One-based result page retained for request validation.",
            schema: { type: "integer", minimum: 1, default: 1 },
          },
          {
            name: "limit",
            in: "query",
            description: "Results per page retained for request validation.",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 9 },
          },
          {
            name: "q",
            in: "query",
            description:
              "One to 100 Unicode code points retained for request validation.",
            schema: { type: "string", minLength: 1, maxLength: 100 },
          },
          {
            name: "model",
            in: "query",
            description: "Launch category retained for request validation.",
            schema: { type: "string", enum: ["classic", "custom"] },
          },
          {
            name: "socials",
            in: "query",
            description: "Social-link filter retained for request validation.",
            schema: { type: "string", enum: ["yes", "no"] },
          },
          {
            name: "sort",
            in: "query",
            description: "Sort selection retained for request validation.",
            schema: {
              type: "string",
              enum: [
                "newest",
                "oldest",
                "trending",
                "market-cap",
                "market-cap-asc",
                "highest-market-cap",
                "lowest-market-cap",
              ],
              default: "newest",
            },
          },
          {
            name: "rankingCommitment",
            in: "query",
            description:
              "Previously issued ranking commitment retained only for request validation during the reset.",
            schema: {
              type: "string",
              pattern: "^sha256:[0-9a-f]{64}$",
            },
          },
        ],
        responses: {
          "400": jsonResponse(component("ApiError"), "Invalid query shape."),
          "503": {
            ...jsonResponse(
              component("ExploreIndexResetError"),
              "Explore token indexing is intentionally reset.",
            ),
            headers: exploreIndexResetResponseHeaders,
          },
        },
      },
    },
    "/api/explore/token": {
      get: {
        operationId: "getVerifiedToken",
        summary: "Read the token-detail index reset state",
        description:
          "Valid requests return a deterministic 503 while token indexing is intentionally reset. A 404 is not emitted because no completed identity lookup occurs.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "chain",
            in: "query",
            description: "Chain namespace retained for request validation.",
            schema: { type: "integer", enum: [1, 4663], default: 1 },
          },
          {
            name: "address",
            in: "query",
            required: true,
            description: "EVM token contract address on the selected chain.",
            schema: component("EthereumAddress"),
            example: V4_TOKEN_ADDRESS,
          },
        ],
        responses: {
          "400": jsonResponse(
            component("ApiError"),
            "Invalid address or query shape.",
          ),
          "503": {
            ...jsonResponse(
              component("ExploreIndexResetError"),
              "Explore token indexing is intentionally reset.",
            ),
            headers: exploreIndexResetResponseHeaders,
          },
        },
      },
    },
    "/api/explore/token/analytics": {
      get: {
        operationId: "getVerifiedTokenAnalytics",
        summary: "Read the token-analytics index reset state",
        description:
          "Valid requests return a deterministic 503 while token analytics indexing is intentionally reset. No analytics provider or fallback is read.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "chain",
            in: "query",
            description: "Ethereum only. Omit for chain 1.",
            schema: { type: "integer", enum: [1], default: 1 },
          },
          {
            name: "address",
            in: "query",
            required: true,
            description: "EVM token contract address.",
            schema: component("EthereumAddress"),
            example: V4_TOKEN_ADDRESS,
          },
          {
            name: "section",
            in: "query",
            description: "Analytics section retained for request validation.",
            schema: {
              type: "string",
              enum: ["summary", "holders", "traders"],
              default: "summary",
            },
          },
          {
            name: "limit",
            in: "query",
            description:
              "Optional fixed ranking limit. When present, the exact decimal value 20 is required.",
            schema: { type: "integer", const: 20, default: 20 },
          },
        ],
        responses: {
          "400": jsonResponse(
            component("ApiError"),
            "Invalid analytics query.",
          ),
          "503": {
            ...jsonResponse(
              component("ExploreIndexResetError"),
              "Explore token analytics indexing is intentionally reset.",
            ),
            headers: exploreIndexResetResponseHeaders,
          },
        },
      },
    },
    "/api/explore/token/chart": {
      get: {
        operationId: "getVerifiedTokenChart",
        summary: "Read the token-chart index reset state",
        description:
          "Valid requests return the provider-neutral market-chart-error.v2 response while token chart indexing is intentionally reset. No chart provider or fallback is read.",
        tags: ["Discovery"],
        security: [],
        parameters: [
          {
            name: "address",
            in: "query",
            required: true,
            description: "EVM token contract address.",
            schema: component("EthereumAddress"),
            example: V4_TOKEN_ADDRESS,
          },
          {
            name: "range",
            in: "query",
            description: "Requested bounded chart range.",
            schema: {
              type: "string",
              enum: ["1h", "1d", "1w", "all"],
              default: "all",
            },
          },
        ],
        responses: {
          "400": jsonResponse(component("ApiError"), "Invalid chart query."),
          "503": {
            ...jsonResponse(
              component("MarketChartError"),
              "Explore token chart indexing is intentionally reset.",
            ),
            headers: exploreIndexResetResponseHeaders,
          },
        },
      },
    },
    "/api/custom-launch/registry/v2/readiness": {
      get: {
        operationId: "getCustomRegistryReadiness",
        summary: "Read Custom Registry readiness",
        description:
          "Reports whether the exact production Registry binding and provider quorum are verified for public reads.",
        tags: ["Registry"],
        security: [],
        responses: {
          "200": jsonResponse(
            component("RegistryReadiness"),
            "Registry public-read boundary is ready.",
          ),
          "503": jsonResponse(
            component("ApiError"),
            "Registry public reads remain fail-closed.",
          ),
        },
      },
    },
    "/api/custom-launch/registry/v2/manifest": {
      get: {
        operationId: "getCustomRegistryManifest",
        summary: "Read the Custom Registry release manifest",
        description:
          "Returns the exact chain, deployment, runtime, source, artifact, and finality commitments for the live Registry public-read surface.",
        tags: ["Registry"],
        security: [],
        responses: {
          "200": jsonResponse(
            component("RegistryManifest"),
            "Exact live Registry release manifest.",
          ),
          "503": jsonResponse(
            component("ApiError"),
            "No verified live Registry manifest is available.",
          ),
        },
      },
    },
    "/v1/custom-launches": {
      get: {
        operationId: "listCustomLaunches",
        summary: "List your Custom launch requests",
        description:
          "Returns newest-first bounded summaries for the exact wallet bound to the API key. Pagination is keyset-based, output is always null, and pending rows receive bounded best-effort chain reconciliation without hiding durable history on RPC failure. Read the single-resource route for the full prepared artifact and exact output.",
        tags: ["Custom launch"],
        servers: [
          {
            url: CUSTOM_LAUNCH_API_ORIGIN,
            description: "Programmable Custom Launch API",
          },
        ],
        security: [{ CustomLaunchApiKey: [] }],
        parameters: [
          {
            name: "limit",
            in: "query",
            required: false,
            description: "Page size. Defaults to 10 and never exceeds 25.",
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 25,
              default: 10,
            },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            description: "Opaque nextCursor returned by the previous page.",
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 512,
              pattern: "^[A-Za-z0-9_-]+$",
            },
          },
        ],
        responses: {
          "200": jsonResponse(
            component("CustomLaunchListPage"),
            "Wallet-owned launch request page.",
          ),
          "400": jsonResponse(
            component("CustomLaunchApiError"),
            "Invalid pagination query.",
          ),
          "401": jsonResponse(
            component("CustomLaunchApiError"),
            "API key is missing, malformed, expired, revoked, or unknown.",
          ),
          "403": jsonResponse(
            component("CustomLaunchApiError"),
            "API key lacks custom-launch:read.",
          ),
          "503": jsonResponse(
            component("CustomLaunchApiError"),
            "Launch history is temporarily unavailable.",
          ),
        },
      },
      post: {
        operationId: "createCustomLaunch",
        deprecated: true,
        summary: "V1 launch creation is read-only",
        description:
          "The V1 creation route is retained only as an explicit write fence. After successful API-key authentication and scope checks it returns 409 CUSTOM_LAUNCH_V1_READ_ONLY before reading an idempotency key or request body. This response is non-retryable. Use the live V1 GET operations for existing history and the standalone public V3.3 contract for fresh writes.",
        tags: ["Custom launch"],
        servers: [
          {
            url: CUSTOM_LAUNCH_API_ORIGIN,
            description: "Programmable Custom Launch API",
          },
        ],
        security: [{ CustomLaunchApiKey: [] }],
        responses: {
          "401": jsonResponse(
            component("CustomLaunchApiError"),
            "API key is missing, malformed, expired, revoked, or unknown.",
          ),
          "403": jsonResponse(
            component("CustomLaunchApiError"),
            "API key lacks the legacy custom-launch:create scope.",
          ),
          "409": {
            description:
              "V1 launch creation is read-only. Do not retry this request.",
            content: {
              "application/json": {
                schema: component("CustomLaunchApiError"),
                example: {
                  schemaVersion: "programmable.api-error.v1",
                  error: {
                    code: "CUSTOM_LAUNCH_V1_READ_ONLY",
                    message:
                      "V1 launch creation is read-only; use the public V3.3 launch contract",
                    requestId: "018f1f8e-7d93-7c2f-8d7f-e114942e7f25",
                  },
                },
              },
            },
          },
        },
      },
    },
    "/v1/custom-launches/{launchId}": {
      get: {
        operationId: "getCustomLaunch",
        summary: "Read a Custom launch",
        description:
          "Returns one existing launch owned by the API key's wallet principal. After the controller wallet broadcasts a previously authorized transaction, polling this single-resource route performs request-driven Router reconciliation for authorized and submitted launches. There is no background reconciliation timer. A missing launch and another principal's launch both return 404.",
        tags: ["Custom launch"],
        servers: [
          {
            url: CUSTOM_LAUNCH_API_ORIGIN,
            description: "Programmable Custom Launch API",
          },
        ],
        security: [{ CustomLaunchApiKey: [] }],
        parameters: [
          {
            name: "launchId",
            in: "path",
            required: true,
            description:
              "Legacy path name for the API request UUID returned as both launchId and requestId. It is not the bytes32 onchainLaunchId.",
            schema: component("CustomLaunchRequestId"),
          },
        ],
        responses: {
          "200": jsonResponse(
            component("CustomLaunchResource"),
            "Current durable launch state.",
          ),
          "401": jsonResponse(
            component("CustomLaunchApiError"),
            "API key is missing, malformed, expired, revoked, or unknown.",
          ),
          "403": jsonResponse(
            component("CustomLaunchApiError"),
            "API key lacks custom-launch:read.",
          ),
          "404": jsonResponse(
            component("CustomLaunchApiError"),
            "Launch not found for this wallet principal.",
          ),
          "429": {
            description:
              "The read rate limit was reached. Retry the same single-resource read after the indicated delay.",
            headers: {
              "Retry-After": {
                description:
                  "Delay in seconds or an HTTP date after which the request may be retried.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: component("CustomLaunchApiError"),
              },
            },
          },
          "503": {
            description: "The Custom Launch API is temporarily unavailable.",
            headers: {
              "Retry-After": {
                description:
                  "Optional delay in seconds or an HTTP date after which the same request may be retried.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: component("CustomLaunchApiError"),
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "getOpenApiDocument",
        summary: "Read this OpenAPI document",
        tags: ["Metadata"],
        security: [],
        responses: {
          "200": jsonResponse(
            { type: "object" },
            "OpenAPI 3.1 description of the public read and Custom launch APIs.",
          ),
        },
      },
    },
  },
  components: {
    securitySchemes: {
      CustomLaunchApiKey: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "pm_live_<22-char-key-id>_<43-char-secret>",
        description:
          "Wallet-bound API key managed at https://programmable.market/developers/api-keys. Keys can create through V3.3 and read wallet-owned V2 and V1 history. A create scope does not override either legacy write fence. Keys are not wallets and cannot sign or broadcast transactions.",
      },
    },
    schemas: {
      ...chainExploreSchemas,
      EthereumAddress: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{40}$",
        examples: [V4_TOKEN_ADDRESS],
      },
      Hex32: {
        type: "string",
        pattern: "^0x[0-9a-fA-F]{64}$",
      },
      LowerHex32: {
        type: "string",
        pattern: "^0x[0-9a-f]{64}$",
      },
      NonzeroLowerHex32: {
        type: "string",
        pattern: "^0x(?!0{64}$)[0-9a-f]{64}$",
      },
      Sha256Digest: {
        type: "string",
        pattern: "^sha256:[0-9a-f]{64}$",
      },
      CanonicalUint256: {
        type: "string",
        pattern: "^(?:0|[1-9][0-9]*)$",
        maxLength: 78,
        description: "Base-10 uint256 with no sign or leading zeroes.",
      },
      CanonicalIdentifier: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/+\\-]{0,255}$",
      },
      CustomLaunchRequestId: {
        type: "string",
        format: "uuid",
        description:
          "Durable API request identifier. This is distinct from the bytes32 onchain launch identifier.",
      },
      HexData: {
        type: "string",
        pattern: "^0x(?:[0-9a-fA-F]{2})*$",
      },
      HookPermission: {
        type: "string",
        enum: [
          "beforeInitialize",
          "afterInitialize",
          "beforeAddLiquidity",
          "afterAddLiquidity",
          "beforeRemoveLiquidity",
          "afterRemoveLiquidity",
          "beforeSwap",
          "afterSwap",
          "beforeDonate",
          "afterDonate",
          "beforeSwapReturnDelta",
          "afterSwapReturnDelta",
          "afterAddLiquidityReturnDelta",
          "afterRemoveLiquidityReturnDelta",
        ],
      },
      SourceBundleEntryV2: {
        type: "object",
        required: [
          "path",
          "kind",
          "mode",
          "byteLength",
          "contentSha256",
          "symlinkTarget",
        ],
        properties: {
          path: {
            type: "string",
            minLength: 1,
            description:
              "NFC-normalized relative path. Empty segments, dot segments, backslashes, controls, and encoded slash or backslash are rejected.",
          },
          kind: { type: "string", enum: ["file", "symlink"] },
          mode: { type: "string", enum: ["100644", "100755", "120000"] },
          byteLength: {
            type: "string",
            pattern: "^(?:0|[1-9][0-9]*)$",
            maxLength: 20,
            description: "Base-10 uint64 byte length.",
          },
          contentSha256: component("Sha256Digest"),
          symlinkTarget: { type: ["string", "null"] },
        },
        allOf: [
          {
            if: { properties: { kind: { const: "file" } } },
            then: {
              properties: {
                mode: { type: "string", enum: ["100644", "100755"] },
                symlinkTarget: { type: "null" },
              },
            },
            else: {
              properties: {
                mode: { const: "120000" },
                symlinkTarget: { type: "string" },
              },
            },
          },
        ],
        additionalProperties: false,
      },
      SourceBundleManifestV2: {
        type: "object",
        required: ["schemaVersion", "entries"],
        properties: {
          schemaVersion: { const: "2.0.0" },
          entries: {
            type: "array",
            minItems: 1,
            description:
              "Complete, non-empty entries in strictly increasing, unique UTF-8 path-byte order. The platform recomputes the frozen manifest digest and requires it to match sourceDescriptor.sourceBundleDigest; it does not fetch or compile source files.",
            items: component("SourceBundleEntryV2"),
          },
        },
        additionalProperties: false,
      },
      DeterministicSourceBundleV2: {
        type: "object",
        required: [
          "schemaVersion",
          "kind",
          "controllerWallet",
          "sourceLineageNonce",
          "sourceBundleDigest",
          "bundleContentSha256",
          "publicOriginCommitment",
        ],
        properties: {
          schemaVersion: { const: "2.0.0" },
          kind: { const: "deterministic-source-bundle" },
          controllerWallet: {
            ...component("EthereumAddress"),
            description: "Must equal launchWallet after address normalization.",
          },
          sourceLineageNonce: component("CanonicalUint256"),
          sourceBundleDigest: component("LowerHex32"),
          bundleContentSha256: component("Sha256Digest"),
          publicOriginCommitment: component("LowerHex32"),
        },
        additionalProperties: false,
      },
      GraphAddressLocatorV1: {
        type: "object",
        required: ["targetId", "byteOffset", "encoding"],
        properties: {
          targetId: component("CanonicalIdentifier"),
          byteOffset: { type: "integer", minimum: 0 },
          encoding: {
            type: "string",
            enum: ["abi-address-word", "packed-address-20"],
          },
        },
        additionalProperties: false,
      },
      CustomGraphTargetV1: {
        type: "object",
        required: [
          "targetId",
          "applicantSalt",
          "creationBytecode",
          "constructorArguments",
          "initializerCalldata",
          "constructorAddressLocators",
          "initializerAddressLocators",
          "deploymentValueWei",
          "initializerValueWei",
          "expectedRuntimeCodeHash",
          "componentKind",
          "declaredHookPermissions",
        ],
        properties: {
          targetId: component("CanonicalIdentifier"),
          applicantSalt: component("Hex32"),
          creationBytecode: {
            type: "string",
            pattern: "^0x(?:[0-9a-fA-F]{2})+$",
            description:
              "Non-empty EVM creation bytecode. Creation bytecode plus constructor arguments is limited to 49,152 bytes.",
          },
          constructorArguments: component("HexData"),
          initializerCalldata: {
            ...component("HexData"),
            description: "Limited to 131,072 bytes after address patching.",
          },
          constructorAddressLocators: {
            type: "array",
            maxItems: 256,
            items: component("GraphAddressLocatorV1"),
          },
          initializerAddressLocators: {
            type: "array",
            maxItems: 256,
            items: component("GraphAddressLocatorV1"),
          },
          deploymentValueWei: component("CanonicalUint256"),
          initializerValueWei: component("CanonicalUint256"),
          expectedRuntimeCodeHash: {
            type: "string",
            pattern: "^0x(?!0{64}$)[0-9a-fA-F]{64}$",
          },
          componentKind: {
            type: "string",
            enum: ["token", "hook", "other"],
          },
          declaredHookPermissions: {
            oneOf: [
              {
                type: "array",
                maxItems: 14,
                items: component("HookPermission"),
              },
              { type: "null" },
            ],
          },
        },
        allOf: [
          {
            if: { properties: { componentKind: { const: "hook" } } },
            then: {
              properties: {
                declaredHookPermissions: {
                  type: "array",
                  maxItems: 14,
                  uniqueItems: true,
                  items: component("HookPermission"),
                },
              },
            },
            else: {
              properties: { declaredHookPermissions: { type: "null" } },
            },
          },
        ],
        additionalProperties: false,
      },
      CustomGraphBundleV1: {
        type: "object",
        required: ["schemaVersion", "sourceBundleSha256", "targets", "pool"],
        properties: {
          schemaVersion: { const: "programmable.custom-graph-bundle.v1" },
          sourceBundleSha256: {
            ...component("Sha256Digest"),
            description: "Must equal sourceDescriptor.bundleContentSha256.",
          },
          targets: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            description:
              "Closed target graph with exactly one token target and one hook target. Constructor dependencies must be acyclic.",
            items: component("CustomGraphTargetV1"),
          },
          pool: {
            type: "object",
            required: ["tokenTargetId", "hookTargetId", "fee", "tickSpacing"],
            properties: {
              tokenTargetId: component("CanonicalIdentifier"),
              hookTargetId: component("CanonicalIdentifier"),
              fee: {
                oneOf: [
                  { type: "integer", minimum: 0, maximum: 1_000_000 },
                  { const: 8_388_608 },
                ],
              },
              tickSpacing: { type: "integer", minimum: 1, maximum: 32_767 },
            },
            additionalProperties: false,
          },
        },
        description:
          "Aggregate init code and initializer calldata are limited to 524,288 bytes. Predicted hook-address permission bits must equal declaredHookPermissions.",
        additionalProperties: false,
      },
      AgentLaunchAttestationCheckV1: {
        type: "object",
        required: ["checkId", "evidenceSha256"],
        properties: {
          checkId: component("CanonicalIdentifier"),
          evidenceSha256: component("Sha256Digest"),
        },
        additionalProperties: false,
      },
      AgentLaunchAttestationV1: {
        type: "object",
        required: [
          "schemaVersion",
          "subjectGraphBundleHash",
          "agentId",
          "checkedAt",
          "checks",
        ],
        properties: {
          schemaVersion: { const: "programmable.agent-launch-attestation.v1" },
          subjectGraphBundleHash: {
            ...component("Sha256Digest"),
            description:
              "SHA-256 of the canonical normalized graph bundle. It must match the submitted graph bundle.",
          },
          agentId: component("CanonicalIdentifier"),
          checkedAt: {
            type: "string",
            format: "date-time",
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
          },
          checks: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            uniqueItems: true,
            items: component("AgentLaunchAttestationCheckV1"),
          },
        },
        description:
          "Required agent self-attestation with evidence digests for the submitted graph subject. It is excluded from permit and launch authorization. Programmable does not fetch or assess the evidence, adopt the attestation, or make a safety, audit, approval, compilation, or simulation claim.",
        additionalProperties: false,
      },
      ExactSourceCompilationUnitV1: {
        type: "object",
        description:
          "One exact Solidity Standard JSON compilation input. The decoded UTF-8 bytes, not a reconstructed object, are the hash preimage. The input is closed to language, sources and settings; every source entry contains only inline content and no URL.",
        required: [
          "compilationUnitId",
          "compilerVersion",
          "standardJsonInputBase64",
          "standardJsonInputSha256",
        ],
        properties: {
          compilationUnitId: component("CanonicalIdentifier"),
          compilerVersion: {
            type: "string",
            pattern: "^0\\.[0-9]+\\.[0-9]+\\+commit\\.[0-9a-f]{8}$",
            description:
              "Exact solc build identifier, including the eight-character commit suffix.",
          },
          standardJsonInputBase64: {
            type: "string",
            minLength: 4,
            maxLength: 6_990_508,
            pattern:
              "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$",
            description:
              "Canonical base64 of the exact UTF-8 Solidity Standard JSON input bytes. Decoded input is limited to 5,242,880 bytes per compilation unit and across all units in the request.",
          },
          standardJsonInputSha256: component("Sha256Digest"),
        },
        additionalProperties: false,
      },
      ExactSourceComponentV1: {
        type: "object",
        description:
          "Exact compiler target identity and resolved constructor arguments for one graph target.",
        required: [
          "targetId",
          "compilationUnitId",
          "sourcePath",
          "contractName",
          "constructorArguments",
        ],
        properties: {
          targetId: component("CanonicalIdentifier"),
          compilationUnitId: component("CanonicalIdentifier"),
          sourcePath: { type: "string", minLength: 1 },
          contractName: component("CanonicalIdentifier"),
          constructorArguments: {
            type: "string",
            pattern: "^0x(?:[0-9a-f]{2})*$",
            description:
              "Lowercase ABI-encoded constructor arguments after graph address locators are resolved.",
          },
        },
        additionalProperties: false,
      },
      ExactSourceVerificationBundleV1: {
        type: "object",
        description:
          "Optional exact-source material bound to the prepared artifact. Compilation units are uniquely sorted by UTF-8 compilationUnitId; components are uniquely sorted by UTF-8 targetId and exactly cover every graph target. Decoded Standard JSON is limited to 5,242,880 bytes per compilation unit and in aggregate.",
        required: ["schemaVersion", "compilationUnits", "components"],
        properties: {
          schemaVersion: {
            const: "programmable.exact-source-verification-bundle.v1",
          },
          compilationUnits: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: component("ExactSourceCompilationUnitV1"),
          },
          components: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: component("ExactSourceComponentV1"),
          },
        },
        additionalProperties: false,
      },
      CustomLaunchCreateRequest: {
        type: "object",
        required: [
          "schemaVersion",
          "launchWallet",
          "chainId",
          "nonce",
          "sourceDescriptor",
          "sourceBundleManifest",
          "graphBundle",
          "agentAttestation",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-launch-create-request.v1",
          },
          launchWallet: {
            ...component("EthereumAddress"),
            description: "Must equal the API key's bound wallet.",
          },
          chainId: { const: "1" },
          nonce: component("NonzeroLowerHex32"),
          sourceDescriptor: component("DeterministicSourceBundleV2"),
          sourceBundleManifest: component("SourceBundleManifestV2"),
          graphBundle: component("CustomGraphBundleV1"),
          agentAttestation: component("AgentLaunchAttestationV1"),
          verificationBundle: {
            ...component("ExactSourceVerificationBundleV1"),
            description:
              "Optional for V1 compatibility. When present, the exact bundle is cryptographically bound to the prepared artifact and enables post-finality exact-match verification.",
          },
        },
        additionalProperties: false,
      },
      CustomLaunchFailure: {
        type: "object",
        required: ["code", "message", "retryable"],
        properties: {
          code: {
            type: "string",
            description:
              "Stable failure code. PERMIT_EXPIRED is terminal and requires a new nonce and Idempotency-Key.",
          },
          message: { type: "string" },
          retryable: { type: "boolean" },
        },
        additionalProperties: false,
      },
      PreparedLaunchStampRequest: {
        type: "object",
        required: [
          "launchId",
          "token",
          "tokenRuntimeCodeHash",
          "poolKey",
          "hookRuntimeCodeHash",
          "components",
        ],
        properties: {
          launchId: {
            ...component("LowerHex32"),
            description: "The bytes32 onchain launch identifier.",
          },
          token: component("EthereumAddress"),
          tokenRuntimeCodeHash: component("LowerHex32"),
          poolKey: {
            type: "object",
            required: ["currency0", "currency1", "fee", "tickSpacing", "hooks"],
            properties: {
              currency0: component("EthereumAddress"),
              currency1: component("EthereumAddress"),
              fee: { type: "integer", minimum: 0, maximum: 8_388_608 },
              tickSpacing: { type: "integer" },
              hooks: component("EthereumAddress"),
            },
            additionalProperties: false,
          },
          hookRuntimeCodeHash: component("LowerHex32"),
          components: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: [
                "resultIndex",
                "account",
                "runtimeCodeHash",
                "kind",
                "scope",
              ],
              properties: {
                resultIndex: { type: "integer", minimum: 0, maximum: 255 },
                account: component("EthereumAddress"),
                runtimeCodeHash: component("LowerHex32"),
                kind: { type: "integer", enum: [0, 1, 2] },
                scope: { const: 1 },
              },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      PreparedLaunchPermit: {
        type: "object",
        required: [
          "chainId",
          "router",
          "launchWallet",
          "kind",
          "routePayloadHash",
          "expectedResultHash",
          "stampRequestHash",
          "nonce",
          "validAfter",
          "deadline",
          "valueWei",
        ],
        properties: {
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          launchWallet: component("EthereumAddress"),
          kind: { const: 1 },
          routePayloadHash: component("LowerHex32"),
          expectedResultHash: component("LowerHex32"),
          stampRequestHash: component("LowerHex32"),
          nonce: component("NonzeroLowerHex32"),
          validAfter: component("CanonicalUint256"),
          deadline: component("CanonicalUint256"),
          valueWei: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      PreparedLaunchArtifact: {
        type: "object",
        description:
          "Hash-bound prepared launch artifact. Stable signing and provenance fields are typed here; route construction details remain part of the returned artifact and are covered by artifactHash.",
        required: [
          "schemaVersion",
          "graphBundleHash",
          "sourceBundleSha256",
          "chainBindings",
          "callerConstraints",
          "timing",
          "route",
          "predictedComponents",
          "market",
          "stampRequest",
          "stampRequestHash",
          "permit",
          "permitDigest",
          "unsignedRouterTransaction",
          "claims",
          "artifactHash",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.prepared-custom-graph-launch.v1",
          },
          graphBundleHash: component("Sha256Digest"),
          sourceBundleSha256: component("Sha256Digest"),
          chainBindings: { type: "object", additionalProperties: true },
          callerConstraints: { type: "object", additionalProperties: true },
          timing: { type: "object", additionalProperties: true },
          route: { type: "object", additionalProperties: true },
          predictedComponents: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          market: { type: "object", additionalProperties: true },
          stampRequest: component("PreparedLaunchStampRequest"),
          stampRequestHash: component("LowerHex32"),
          permit: component("PreparedLaunchPermit"),
          permitDigest: component("LowerHex32"),
          unsignedRouterTransaction: {
            type: "object",
            required: [
              "chainId",
              "from",
              "to",
              "valueWei",
              "functionName",
              "selector",
              "calldataWithEmptySignature",
              "signatureState",
              "preimageHash",
            ],
            properties: {
              chainId: { const: "1" },
              from: component("EthereumAddress"),
              to: component("EthereumAddress"),
              valueWei: component("CanonicalUint256"),
              functionName: { const: "launchAndStampV1" },
              selector: { const: "0xe5f6b8cd" },
              calldataWithEmptySignature: component("HexData"),
              signatureState: { const: "permit-authority-signature-required" },
              preimageHash: component("Sha256Digest"),
            },
            additionalProperties: false,
          },
          claims: {
            type: "object",
            required: ["provenance", "safety", "approval"],
            properties: {
              provenance: { const: "prepared-for-atomic-router-stamp" },
              safety: { const: "not-asserted" },
              approval: { const: "not-asserted" },
            },
            additionalProperties: false,
          },
          artifactHash: component("Sha256Digest"),
        },
        additionalProperties: false,
      },
      AgentLaunchAttestationResult: {
        type: "object",
        description:
          "Normalized caller-supplied agent self-attestation. Programmable validates its shape and subject binding but does not assess the evidence or adopt the claims.",
        required: [
          "schemaVersion",
          "subjectGraphBundleHash",
          "agentId",
          "checkedAt",
          "checks",
          "attribution",
          "platformVerification",
          "safetyClaim",
          "approvalClaim",
        ],
        properties: {
          schemaVersion: { const: "programmable.agent-launch-attestation.v1" },
          subjectGraphBundleHash: component("Sha256Digest"),
          agentId: component("CanonicalIdentifier"),
          checkedAt: { type: "string", format: "date-time" },
          checks: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            items: component("AgentLaunchAttestationCheckV1"),
          },
          attribution: { const: "agent-self-attested" },
          platformVerification: { const: "not-performed-by-this-attestation" },
          safetyClaim: { const: "not-made" },
          approvalClaim: { const: "not-made" },
        },
        additionalProperties: false,
      },
      SignedPreparedLaunchPermit: {
        type: "object",
        description:
          "Platform permit-authority signature. This is not a controller-wallet transaction signature.",
        required: [
          "schemaVersion",
          "artifactHash",
          "chainId",
          "router",
          "authoritySafe",
          "signerAddress",
          "permitDigest",
          "safeMessageDigest",
          "signature",
          "validAfter",
          "deadline",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.signed-prepared-launch-permit.v1",
          },
          artifactHash: component("Sha256Digest"),
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          authoritySafe: component("EthereumAddress"),
          signerAddress: component("EthereumAddress"),
          permitDigest: component("LowerHex32"),
          safeMessageDigest: component("LowerHex32"),
          signature: component("HexData"),
          validAfter: component("CanonicalUint256"),
          deadline: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      CustomLaunchWalletTransaction: {
        type: "object",
        description:
          "Exact permit-attached Router transaction for the separate controller-wallet signer to review, sign and broadcast.",
        required: [
          "schemaVersion",
          "chainId",
          "from",
          "to",
          "valueWei",
          "functionName",
          "selector",
          "calldata",
          "signatureState",
          "requiresControllerWalletSignature",
          "broadcastByService",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-launch-wallet-transaction.v1",
          },
          chainId: { const: "1" },
          from: component("EthereumAddress"),
          to: component("EthereumAddress"),
          valueWei: component("CanonicalUint256"),
          functionName: { const: "launchAndStampV1" },
          selector: { const: "0xe5f6b8cd" },
          calldata: component("HexData"),
          signatureState: { const: "permit-authority-signature-attached" },
          requiresControllerWalletSignature: { const: true },
          broadcastByService: { const: false },
        },
        additionalProperties: false,
      },
      CustomLaunchObservationWindow: {
        type: "object",
        description:
          "Bounded Mainnet Router log window captured during preparation. Single-resource GET polling reconciles only inside this window.",
        required: [
          "schemaVersion",
          "chainId",
          "router",
          "fromBlock",
          "toBlock",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-launch-observation-window.v1",
          },
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          fromBlock: component("CanonicalUint256"),
          toBlock: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      CustomLaunchOnchainEvidence: {
        type: "object",
        description:
          "Canonical Router event and same-block launchStamp getter evidence matched to the prepared artifact. Finalized means confirmationDepth is at least 64.",
        required: [
          "schemaVersion",
          "finalityState",
          "chainId",
          "router",
          "onchainLaunchId",
          "transactionHash",
          "blockNumber",
          "blockHash",
          "logIndex",
          "token",
          "hook",
          "poolManager",
          "poolId",
          "stampHash",
          "confirmationDepth",
          "requiredConfirmationDepth",
          "observedAtBlockNumber",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-launch-onchain-evidence.v1",
          },
          finalityState: { type: "string", enum: ["submitted", "finalized"] },
          chainId: { const: "1" },
          router: component("EthereumAddress"),
          onchainLaunchId: component("LowerHex32"),
          transactionHash: component("LowerHex32"),
          blockNumber: component("CanonicalUint256"),
          blockHash: component("LowerHex32"),
          logIndex: { type: "integer", minimum: 0 },
          token: component("EthereumAddress"),
          hook: component("EthereumAddress"),
          poolManager: component("EthereumAddress"),
          poolId: component("LowerHex32"),
          stampHash: component("LowerHex32"),
          confirmationDepth: component("CanonicalUint256"),
          requiredConfirmationDepth: { const: "64" },
          observedAtBlockNumber: component("CanonicalUint256"),
        },
        additionalProperties: false,
      },
      CustomLaunchPreparedOutput: {
        type: "object",
        description:
          "Prepared artifact before the platform permit is signed. No wallet transaction or observation window is available yet.",
        required: [
          "schemaVersion",
          "artifact",
          "agentAttestation",
          "signedPermit",
          "walletTransaction",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-launch-authorization-result.v1",
          },
          artifact: component("PreparedLaunchArtifact"),
          agentAttestation: component("AgentLaunchAttestationResult"),
          signedPermit: { type: "null" },
          walletTransaction: { type: "null" },
        },
        additionalProperties: false,
      },
      CustomLaunchAuthorizedOutput: {
        type: "object",
        description:
          "Permit-attached wallet handoff plus bounded reconciliation state. onchain is null until single-resource polling observes a canonical Router stamp.",
        required: [
          "schemaVersion",
          "artifact",
          "agentAttestation",
          "signedPermit",
          "walletTransaction",
          "observationWindow",
          "onchain",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-launch-authorization-result.v1",
          },
          artifact: component("PreparedLaunchArtifact"),
          agentAttestation: component("AgentLaunchAttestationResult"),
          signedPermit: component("SignedPreparedLaunchPermit"),
          walletTransaction: component("CustomLaunchWalletTransaction"),
          observationWindow: component("CustomLaunchObservationWindow"),
          onchain: {
            oneOf: [component("CustomLaunchOnchainEvidence"), { type: "null" }],
          },
        },
        additionalProperties: false,
      },
      CustomLaunchOutput: {
        description:
          "Typed durable output for prepared, authorized, submitted and finalized launch states.",
        oneOf: [
          component("CustomLaunchPreparedOutput"),
          component("CustomLaunchAuthorizedOutput"),
        ],
      },
      SourceVerificationComponentV1: {
        type: "object",
        required: ["targetId", "address", "status", "provider"],
        properties: {
          targetId: component("CanonicalIdentifier"),
          address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
          status: {
            type: "string",
            enum: ["queued", "retrying", "exact_match", "needs_attention"],
          },
          provider: {
            type: ["string", "null"],
            enum: ["sourcify", "etherscan", "blockscout", null],
          },
        },
        additionalProperties: false,
      },
      SourceVerificationStatusV1: {
        type: "object",
        description:
          "Server-authored exact-source verification state. Only literal exact_match for every exclusive component means Source verified; clients must not infer or submit this object.",
        required: ["schemaVersion", "status", "components", "updatedAt"],
        properties: {
          schemaVersion: {
            const: "programmable.source-verification-status.v1",
          },
          status: {
            type: "string",
            enum: ["queued", "retrying", "exact_match", "needs_attention"],
          },
          components: {
            type: "array",
            minItems: 1,
            maxItems: 16,
            items: component("SourceVerificationComponentV1"),
          },
          updatedAt: {
            type: "string",
            format: "date-time",
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
          },
        },
        additionalProperties: false,
      },
      CustomLaunchResource: {
        type: "object",
        description:
          "Durable API request state. launchId is the legacy alias of requestId; onchainLaunchId is the distinct Router bytes32 identifier and is present whenever durable output retains a prepared artifact. Poll this resource after wallet broadcast to drive request-scoped reconciliation.",
        required: [
          "schemaVersion",
          "launchId",
          "requestId",
          "onchainLaunchId",
          "routeId",
          "ownerWallet",
          "status",
          "requestHash",
          "createdAt",
          "updatedAt",
          "output",
          "failure",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-launch.v1" },
          launchId: {
            ...component("CustomLaunchRequestId"),
            description:
              "Deprecated-compatible alias of requestId. It is not an onchain identifier.",
            deprecated: true,
          },
          requestId: component("CustomLaunchRequestId"),
          onchainLaunchId: {
            description:
              "Router bytes32 launch identifier. It is null before preparation and when a terminal failure clears the durable output.",
            oneOf: [component("LowerHex32"), { type: "null" }],
          },
          routeId: { const: "custom-launch:create:v1" },
          ownerWallet: component("EthereumAddress"),
          status: {
            type: "string",
            description:
              "authorized means the permit-attached transaction awaits a separate wallet signature and broadcast. submitted means exact canonical Router event/getter evidence was observed below 64 confirmations. finalized means the same evidence reached at least 64 confirmations.",
            enum: [
              "received",
              "validating",
              "prepared",
              "authorized",
              "submitted",
              "finalized",
              "failed",
              "cancelled",
            ],
          },
          requestHash: {
            type: "string",
            pattern: "^sha256:[0-9a-f]{64}$",
            description:
              "Server-side canonical idempotency request digest. It is distinct from a caller's local SHA-256 of the exact HTTP request bytes.",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          output: {
            description:
              "Null before preparation and after a terminal failure. prepared returns CustomLaunchPreparedOutput; authorized, submitted and finalized return CustomLaunchAuthorizedOutput.",
            oneOf: [component("CustomLaunchOutput"), { type: "null" }],
          },
          failure: {
            oneOf: [component("CustomLaunchFailure"), { type: "null" }],
          },
          sourceVerification: {
            description:
              "Optional server-authored post-finality verification state. It is absent or null for legacy requests, requests without an exact-source bundle, and requests that have not created verification jobs.",
            oneOf: [component("SourceVerificationStatusV1"), { type: "null" }],
          },
        },
        additionalProperties: false,
      },
      CustomLaunchListPage: {
        type: "object",
        description:
          "Newest-first wallet-owned summary page. Each item uses the CustomLaunchResource shape but always has output=null; use the single-resource route for the prepared artifact. launchId remains the legacy alias of requestId; neither should be confused with onchainLaunchId.",
        required: ["schemaVersion", "launches", "nextCursor"],
        properties: {
          schemaVersion: { const: "programmable.custom-launch-list.v1" },
          launches: {
            type: "array",
            maxItems: 25,
            items: component("CustomLaunchResource"),
          },
          nextCursor: {
            oneOf: [
              {
                type: "string",
                minLength: 16,
                maxLength: 512,
                pattern: "^[A-Za-z0-9_-]+$",
              },
              { type: "null" },
            ],
          },
        },
        additionalProperties: false,
      },
      CustomLaunchApiError: {
        type: "object",
        required: ["schemaVersion", "error"],
        properties: {
          schemaVersion: { const: "programmable.api-error.v1" },
          error: {
            type: "object",
            required: ["code", "message", "requestId"],
            properties: {
              code: {
                type: "string",
                description:
                  "Stable API error code, including IDEMPOTENCY_CONFLICT, NONCE_CONFLICT and PERMIT_EXPIRED.",
              },
              message: { type: "string" },
              requestId: {
                type: "string",
                format: "uuid",
                description:
                  "HTTP correlation identifier for this error response, not a Custom launch resource requestId.",
              },
              details: {},
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            oneOf: [
              { type: "string" },
              {
                type: "object",
                required: ["code", "message", "resolution"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  resolution: { type: "string" },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        additionalProperties: true,
      },
      ApiIndex: {
        type: "object",
        required: [
          "schemaVersion",
          "status",
          "openapi",
          "documentation",
          "llms",
          "scope",
        ],
        properties: {
          schemaVersion: { const: "programmable.public-api-index.v1" },
          status: { const: "ready" },
          openapi: { type: "string", format: "uri" },
          documentation: { type: "string", format: "uri" },
          llms: { type: "string", format: "uri" },
          scope: {
            type: "object",
            required: ["access", "actionsExcluded", "identityPolicy"],
            properties: {
              access: { const: "unauthenticated-read-only" },
              actionsExcluded: {
                type: "array",
                items: { type: "string" },
              },
              identityPolicy: { type: "string" },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      OperationsHealth: {
        type: "object",
        description:
          "Provider-free status for the intentional Explore indexing reset.",
        required: ["status", "providers"],
        properties: {
          status: { const: "index-reset" },
          providers: {
            type: "array",
            maxItems: 0,
            items: false,
          },
        },
        additionalProperties: false,
      },
      ExploreIndexResetError: {
        type: "object",
        description:
          "Deterministic Explore response while token indexing is intentionally reset.",
        required: ["error"],
        properties: {
          error: { const: "Token data is temporarily unavailable" },
          status: { const: "index_rebuilding" },
        },
        additionalProperties: false,
      },
      MarketChartError: {
        type: "object",
        description:
          "Provider-neutral chart response while token chart indexing is intentionally reset.",
        required: [
          "schemaVersion",
          "source",
          "status",
          "generatedAt",
          "address",
          "range",
          "reason",
          "error",
        ],
        properties: {
          schemaVersion: { const: "programmable.market-chart-error.v2" },
          source: { const: "programmable" },
          status: { const: "unavailable" },
          generatedAt: { type: "string", format: "date-time" },
          address: component("EthereumAddress"),
          range: { type: "string", enum: ["1h", "1d", "1w", "all"] },
          reason: { const: "identity-unavailable" },
          error: { const: "Price history is temporarily unavailable" },
        },
        additionalProperties: false,
      },
      RegistryReadiness: {
        type: "object",
        required: [
          "schemaVersion",
          "status",
          "registryStatus",
          "generation",
          "chainId",
          "runtimeBindings",
          "providerQuorum",
          "checkedAt",
        ],
        properties: {
          schemaVersion: { const: "programmable.custom-registry-readiness.v2" },
          status: { const: "ready" },
          registryStatus: { const: "live" },
          generation: { const: "2" },
          chainId: { const: "1" },
          manifestPath: { const: "/api/custom-launch/registry/v2/manifest" },
          runtimeBindings: { const: "verified" },
          providerQuorum: { const: "verified" },
          checkedAt: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
      },
      RegistryManifest: {
        type: "object",
        required: [
          "schemaVersion",
          "status",
          "generation",
          "chainId",
          "caip2",
          "publicReadEnabled",
          "indexingEnabled",
          "registry",
          "release",
          "finality",
        ],
        properties: {
          schemaVersion: {
            const: "programmable.custom-registry-public-manifest.v2",
          },
          status: { const: "live" },
          generation: { const: "2" },
          chainId: { const: "1" },
          caip2: { const: "eip155:1" },
          publicReadEnabled: { const: true },
          indexingEnabled: { const: true },
          registry: {
            type: "object",
            required: [
              "address",
              "runtimeCodeKeccak256",
              "deploymentTransactionHash",
              "deploymentBlock",
              "deploymentBlockHash",
            ],
            properties: {
              address: component("EthereumAddress"),
              runtimeCodeKeccak256: component("Hex32"),
              deploymentTransactionHash: component("Hex32"),
              deploymentBlock: { type: "string", pattern: "^[1-9][0-9]*$" },
              deploymentBlockHash: component("Hex32"),
            },
            additionalProperties: false,
          },
          release: { type: "object", additionalProperties: { type: "string" } },
          finality: {
            type: "object",
            additionalProperties: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    },
  },
  "x-programmable-availability": {
    exploreIndexing: {
      scope: "legacy-routes-only",
      paths: ["/api/explore", "/api/explore/token", "/api/explore/token/analytics", "/api/explore/token/chart"],
      status: "reset",
      publicReadStatus: 503,
      providerCalls: false,
      fallbacks: false,
      backgroundWorkers: false,
    },
    chainExplore: {
      authenticationRequired: false,
      ethereum: { path: "/api/explore/ethereum", chainId: 1, statuses: ["ready", "partial", "stale", "unavailable"] },
      robinhood: { path: "/api/explore/robinhood", chainId: 4663, statuses: ["ready", "syncing", "stale", "unavailable"] },
      availability: "Read each response status and source evidence. Documentation does not establish current provider availability or public launch authorization.",
      categoryBoundary: "mode filters published launch sources only; module source intake has no business-category allowlist.",
    },
    v1Reads: "live",
    v1Create: {
      status: "read-only",
      httpStatus: 409,
      errorCode: "CUSTOM_LAUNCH_V1_READ_ONLY",
      retryable: false,
    },
    v2ReleaseCandidate: {
      status: "retired-to-read-compatibility",
      release: "2.0.0",
      publicAuthorization: false,
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v2.json`,
    },
    v2: {
      reads: "live",
      create: "read-only",
      createHttpStatus: 409,
      createErrorCode: "CUSTOM_LAUNCH_V2_READ_ONLY",
      retryable: false,
      preparedAndSimulatingReads: "observation-only",
      readMayAuthorize: false,
      authorizedAndSubmittedReconciliation: "bounded",
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v2.json`,
    },
    v3: {
      status: "live",
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      profileVersion: "3.3.0",
      freshWritesOnly: true,
      compatibleProfileVersions: ["3.2.0", "3.1.0", "3.0.0", "2.0.0"],
      productionLaunchAuthorized: true,
      createHttpStatus: 202,
      replayHttpStatus: 200,
      retryAfter: "honor-on-429-or-503",
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v3.json`,
      openApiDocumentStatus: "preparatory-not-live",
      activationAuthority: `${SITE_ORIGIN}/.well-known/programmable.json`,
      pendingProfile: {
        profileVersion: "3.4.0",
        cliVersion: "3.3.9",
        released: false,
        installable: false,
        acceptedForFreshWrites: false,
        activationRequires: "backend-and-well-known",
      },
    },
    v4: {
      status: V4_API_DISCOVERY.status,
      runtimeStatus: "routes-deployed",
      activationStage: V4_API_DISCOVERY.activationStage,
      activationScope: V4_API_DISCOVERY.activationScope,
      publication: V4_API_DISCOVERY.publication,
      targetLaunchPath: "public-self-serve",
      apiVersion: "4",
      profileVersion: "4.0.0",
      cliVersion: "4.0.0",
      sourceCandidate: !V4_API_DISCOVERY.cliReleased,
      released: V4_API_DISCOVERY.cliReleased,
      installable: V4_API_DISCOVERY.cliInstallable,
      release: V4_API_DISCOVERY.cliRelease,
      releaseReady: V4_API_DISCOVERY.releaseReady,
      publicAuthorization: V4_API_DISCOVERY.publicAuthorization,
      publicWrites: V4_API_DISCOVERY.publicWrites,
      chainId: 4663,
      caip2: "eip155:4663",
      openApiUrl: `${SITE_ORIGIN}/openapi/custom-launch-v4.json`,
      packConfigSchemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4/pack-config.json`,
      sourceVerificationSchemaUrl: `${SITE_ORIGIN}/schemas/custom-launch/v4/source-verification-status.json`,
      capabilitiesPath: "/v4/chains/4663/capabilities",
      readinessPath: "/v4/chains/4663/readiness",
      finalizedMetadataPath: "/v4/chains/4663/finalized-custom-launches",
      statusPath: "/v4/chains/4663/custom-launches/{launchId}",
      terminalIndexerGuideUrl: `${SITE_ORIGIN}/developer-reference/robinhood-terminal-indexer`,
      terminalIndexerFixtureUrl: `${SITE_ORIGIN}/fixtures/robinhood-terminal-indexer-v1.json`,
      launchStampRouterAbiUrl: `${SITE_ORIGIN}/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json`,
      launchStampRouterAbiSha256:
        "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
      launchStampRouterProfileNormalizedAbiSha256:
        "sha256:ab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0",
      launchStampRouterProfileNormalizedAbiHashing: "jq -cS plus trailing LF",
      statusCommand:
        "programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized",
      statuses: [
        "received",
        "validating",
        "action_required",
        "authorized",
        "awaiting_wallet_signature",
        "wallet_action_required",
        "submitted",
        "sequencer_soft_confirmed",
        "ethereum_posted",
        "finalized",
        "failed",
      ],
      actionRequiredMeaning: "server-authored-remediation-not-wallet-action",
      cliWalletAuthority: false,
      platformFeePolicyStatus: "required-default-configuration",
      feeBehaviorClaim: false,
      universalFeeBehaviorClaim: false,
      platformFeePolicy: {
        required: true,
        status: "required-default-configuration",
        appliesTo: "new-robinhood-v4-api-custom-launches-only",
        changesExistingLaunches: false,
        changesEthereumLaunches: false,
        rateBps: 20,
        ratePpm: 2_000,
        ratePercent: "0.20%",
        recipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
        basis: null,
        feeCurrency: null,
        accountingMode: null,
        rounding: null,
        accrual: null,
        claimMechanism: null,
        enforcement: "not-guaranteed-onchain",
        canonicalOnchainEnforcementProven: false,
        guaranteedRevenue: false,
        feeBehaviorClaim: false,
        universalFeeBehaviorClaim: false,
      },
      genericFeeClaiming: "not-live",
      externalIndexingGuaranteed: false,
      releaseBlockers: V4_API_DISCOVERY.activationBlockers,
      sourceVerificationStartsAfter: "finalized",
      sourceVerificationIndependentFromFinality: true,
      indexingTradingAndPublicationIndependent: true,
      ...robinhoodV4PublicContractDiscovery(V4_API_PROFILE_VERSION),
    },
    legacyIntake: { registry: "closed", github: "closed" },
  },
  "x-programmable-boundary": {
    identity:
      "Chain-specific Explore feeds expose verified Ethereum Classic/Router identities and Robinhood Custom/Module release identities. They are presentation feeds, not complete archives. No token identity is served by the legacy reset routes.",
    excluded:
      "Unverified launch identities and entries excluded by each chain's presentation policy. These filters are not an allowlist for module source intake.",
    marketData:
      "Ethereum Explore market values remain null. Robinhood Explore can include separate market observations; absent values stay null. The legacy reset routes read no market, ranking, search, analytics or chart data.",
    router:
      "Chain-specific feeds retain exact Router and Module source evidence. Module sources are not assigned fabricated Router stamps. Feed visibility remains separate from review approval, catalog admission and tradability; legacy reset routes publish no Router evidence.",
    market:
      "Router verification requires pool initialization and fixed runtime and pool bindings, not active liquidity or tradability; the Custom graph owns liquidity behavior.",
    actions:
      robinhoodV4PublicPolicyDescription(V4_API_PROFILE_VERSION, "Fresh Ethereum V3.3 creation and lifecycle reads preserve exact idempotent request bytes, bounded best-effort reconciliation of pending history rows and precise single-resource polling. Robinhood V4 Router and backend are deployed and ready and target public self-serve, and live discovery derives API availability from the verified release and wallet-handoff evidence; indexing and publication remain independent. The required 20 bps default configuration is not a canonical onchain fee-enforcement, charged-fee or revenue claim, and missing onchain fee enforcement is not itself a write blocker. V2 and V1 history remain readable and both legacy creation routes remain write-fenced. CLI, client and model output is preparation only; the API server independently enforces objective static hard blocks and exact Router simulation. Missing behavior execution leaves routability, liquidity and fee claims unverified, while an authenticated executed hard-invariant failure blocks wallet handoff. Exact-source provider verification starts after finality, runs independently and never revises launch finality. API keys never sign, broadcast, trade, claim fees, manage buybacks, or write profiles. The CLI also never signs or broadcasts."),
  },
  "x-programmable-wallet-authorization-gate": {
    decisionAuthority: "api-server",
    clientChecks: "preparation-only",
    localOrModelApprovalAccepted: false,
    requiredForProfileVersion: "3.4.0",
    walletHandoffRequiresVerifiedEvidence: false,
    mandatoryServerGates: [
      "static-hard-block-policy",
      "exact-router-simulation",
    ],
    configurationIsExecutionEvidence: false,
    requiredPlatformFeeConformanceStatus: "verified",
    nonFeeVectorsMayRemainUnverified: true,
    evidenceAuthority: "platform-runtime-executor",
    signedExecutionReceiptRequired: true,
    notConfiguredDisposition: "claims_remain_unverified",
    unavailableDisposition: "claims_remain_unverified",
    executedFeeFailureDisposition: "blocks_wallet_handoff",
    executedHardInvariantFailureDisposition: "blocks_wallet_handoff",
    feeBehaviorClaim: false,
    tenBpsClaimRequiresExactPerLaunchVerifiedFeePathEvidence: true,
    claimScope: "exact-launch-and-stamped-poolkey-only",
  },
  "x-programmable-api-scopes": {
    "custom-launch:create": {
      state: V4_API_DISCOVERY.releaseReady
        ? "v1-v2-write-fenced-v3.3-live-v4-public-api-wallet-handoff"
        : "v1-v2-write-fenced-v3.3-live-v4-pending-public-discovery-promotion",
      description:
        robinhoodV4PublicPolicyDescription(V4_API_PROFILE_VERSION, "Fresh public writes use Ethereum V3.3. Robinhood V4 targets public self-serve after its non-fee release predicates are deployed; require live discovery fields before create. Its 20 bps recipient configuration is required policy but not guaranteed canonical onchain enforcement. V2 and V1 POST remain non-retryable write fences with CUSTOM_LAUNCH_V2_READ_ONLY and CUSTOM_LAUNCH_V1_READ_ONLY."),
    },
    "custom-launch:read": {
      state: "grantable",
      description: "Read Custom launches owned by the key's wallet principal.",
    },
    "fees:claim": {
      state: "reserved-disabled",
      description:
        "Not grantable or callable for arbitrary Custom hooks. FADE uses a separately bound adapter.",
    },
    "buybacks:manage": {
      state: "reserved-disabled",
      description:
        "Not grantable or callable for arbitrary Custom hooks. FADE uses a separately bound adapter.",
    },
    evolution:
      "New scopes and endpoints are additive. Existing keys never inherit a scope activated later.",
  },
} as const;
