#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_PATH = "config/read-model-operations.v1.json";
const VERCEL_CONFIG_PATH = "vercel.json";
const RESET_HELPER_PATH = "lib/server/explore-index-reset.ts";

const PUBLIC_RESET_ROUTES = Object.freeze([
  Object.freeze({
    method: "GET",
    path: "/api/explore",
    source: "app/api/explore/route.ts",
    responseCall: "tokenDataIndexResetResponse()",
  }),
  Object.freeze({
    method: "GET",
    path: "/api/explore/token",
    source: "app/api/explore/token/route.ts",
    responseCall: "tokenDataIndexResetResponse()",
  }),
  Object.freeze({
    method: "GET",
    path: "/api/explore/token/analytics",
    source: "app/api/explore/token/analytics/route.ts",
    responseCall: "tokenDataIndexResetResponse()",
  }),
  Object.freeze({
    method: "GET",
    path: "/api/explore/token/chart",
    source: "app/api/explore/token/chart/route.ts",
    responseCall: "tokenChartIndexResetResponse({",
  }),
  Object.freeze({
    method: "GET",
    path: "/api/explore/profile",
    source: "app/api/explore/profile/route.ts",
    responseCall: 'exploreIndexResetJson(creatorProfileApiError("temporary"))',
  }),
]);

const RETIRED_OPERATIONS = Object.freeze([
  Object.freeze({
    method: "GET",
    path: "/api/ops/index-v2",
    source: "app/api/ops/index-v2/route.ts",
    statusCode: 410,
    bodyFragment: 'operation: "index-v2"',
  }),
  Object.freeze({
    method: "GET",
    path: "/api/ops/projector",
    source: "app/api/ops/projector/route.ts",
    statusCode: 410,
    bodyFragment: 'operation: "projector"',
  }),
  Object.freeze({
    method: "GET",
    path: "/api/ops/market-projector",
    source: "app/api/ops/market-projector/route.ts",
    statusCode: 410,
    bodyFragment: 'operation: "market-projector"',
  }),
  Object.freeze({
    method: "GET",
    path: "/api/ops/alchemy-launch-refresh",
    source: "app/api/ops/alchemy-launch-refresh/route.ts",
    statusCode: 410,
    bodyFragment: 'operation: "alchemy-launch-refresh"',
  }),
  Object.freeze({
    method: "POST",
    path: "/api/ops/read-model-performance-capture",
    source: "app/api/ops/read-model-performance-capture/route.ts",
    statusCode: 410,
    bodyFragment: 'operation: "read-model-performance-capture"',
  }),
  Object.freeze({
    method: "POST",
    path: "/api/ops/read-model-real-block-sla",
    source: "app/api/ops/read-model-real-block-sla/route.ts",
    statusCode: 410,
    bodyFragment: 'operation: "read-model-real-block-sla"',
  }),
  Object.freeze({
    method: "PUT",
    path: "/api/ops/read-model-real-block-sla",
    source: "app/api/ops/read-model-real-block-sla/route.ts",
    statusCode: 410,
    bodyFragment: 'operation: "read-model-real-block-sla"',
  }),
]);

const PAUSED_TRIGGERS = Object.freeze([
  Object.freeze({
    method: "POST",
    path: "/api/ops/projector-wake",
    source: "app/api/ops/projector-wake/route.ts",
    statusCode: 200,
    bodyFragment: 'operation: "projector-wake"',
  }),
  Object.freeze({
    method: "POST",
    path: "/api/alchemy/webhook",
    source: "app/api/alchemy/webhook/route.ts",
    statusCode: 200,
    bodyFragment: 'operation: "alchemy-webhook"',
  }),
]);

const ACTIVE_CRONS = Object.freeze([
  Object.freeze({
    id: "protocol-revenue",
    path: "/api/ops/protocol-revenue",
    schedule: "* * * * *",
  }),
  Object.freeze({
    id: "custom-launch-generic-v2-projector",
    path: "/api/ops/custom-launch/generic-v2-projector",
    schedule: "* * * * *",
  }),
]);

const EXACT_MANUAL_VERCEL_PROMOTION =
  'vercel promote "$STAGED_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"';
const EXACT_MANUAL_VERCEL_ROLLBACK =
  'vercel rollback "$PREVIOUS_DEPLOYMENT_ID" --yes --token="$VERCEL_TOKEN"';

const RETIRED_RELEASE_REFERENCES = Object.freeze([
  "scripts/smoke-static-dexscreener-public-apis.mjs",
  "smoke-static-dexscreener-public-apis.test.mjs",
  "PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE",
  "read-model-projector-wake-canary.mjs",
  "public-provider-smoke",
  "Probe exact staged Envio Classic V3 catalog",
]);

const FORBIDDEN_ROUTE_IMPORT =
  /(?:\/market-data\/|\/data-pipeline\/|\/onchain\/|\/alchemy\/|\/indexers\/|\/public-explore|\/registry\/|envio|gmgn|dexscreener|bitquery)/iu;
const FORBIDDEN_ROUTE_CAPABILITY =
  /(?:\bfetch\s*\(|\bglobalThis\.fetch\b|\bcreatePublicClient\b|\bcreateWalletClient\b|\bhttp\s*\(|\bwebSocket\s*\(|\bPromise\.all\s*\(|\bPromise\.allSettled\s*\(|\bprocess\.env\b|\bafter\s*\(|\brevalidate(?:Path|Tag)\s*\(|\bread(?:Gmgn|Dexscreener|Bitquery|Envio|Durable|LiveExplore|FinalizedRouter|ProductionCustom)|\brunConfigured(?:Projector|MarketProjector)|\brefreshAlchemyExploreRegistry\b)/u;

// Kept as a compatibility export for the retired, skipped staged-health test
// suite. The reset contract intentionally has no staged provider-health guards.
export const STAGED_HEALTH_HANDOFF_SOURCE_GUARDS = Object.freeze([]);

function readSource(rootDirectory, path, overrides) {
  if (Object.hasOwn(overrides, path)) return overrides[path];
  try {
    return readFileSync(resolve(rootDirectory, path), "utf8");
  } catch {
    return null;
  }
}

function parseJson(source) {
  if (typeof source !== "string") return null;
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    );
  }
  return value;
}

function exactJson(left, right) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function sha256(source) {
  return typeof source === "string"
    ? createHash("sha256").update(source).digest("hex")
    : null;
}

function expectedDigest(binding, overrides) {
  return overrides[binding.path] ?? binding.sha256;
}

function sourceBindingMatches(source, binding, overrides) {
  return binding !== null && typeof binding === "object" &&
    typeof binding.path === "string" &&
    /^[0-9a-f]{64}$/u.test(expectedDigest(binding, overrides) ?? "") &&
    sha256(source(binding.path)) === expectedDigest(binding, overrides);
}

function importedSpecifiers(source) {
  if (typeof source !== "string") return [];
  return [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/gu),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gmu),
  ].map((match) => match[1]);
}

function hasNoIndexingCapability(source) {
  return typeof source === "string" &&
    !FORBIDDEN_ROUTE_CAPABILITY.test(source) &&
    importedSpecifiers(source).every(
      (specifier) => !FORBIDDEN_ROUTE_IMPORT.test(specifier),
    ) &&
    !/import\s*\(/u.test(source);
}

function hasOnlyAllowedImports(source, allowed) {
  return hasNoIndexingCapability(source) &&
    importedSpecifiers(source).every((specifier) => allowed.has(specifier));
}

function exactCronMap(vercel) {
  if (
    vercel === null ||
    typeof vercel !== "object" ||
    !Array.isArray(vercel.crons)
  ) return null;
  const result = new Map();
  for (const cron of vercel.crons) {
    if (
      cron === null ||
      typeof cron !== "object" ||
      Array.isArray(cron) ||
      Object.keys(cron).sort().join(",") !== "path,schedule" ||
      typeof cron.path !== "string" ||
      typeof cron.schedule !== "string" ||
      result.has(cron.path)
    ) return null;
    result.set(cron.path, cron.schedule);
  }
  return result;
}

function hasExactStaticHandler(source, operation) {
  if (!hasNoIndexingCapability(source)) return false;
  const handler = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${operation.method}\\(\\s*\\)`,
    "u",
  );
  return handler.test(source) &&
    source.includes(`status: ${operation.statusCode}`) &&
    source.includes(operation.bodyFragment) &&
    source.includes('"Cache-Control": "no-store"') &&
    !/\b(?:Request|NextRequest)\b/u.test(source);
}

function customLaunchCronIsBound(source, cron, overrides) {
  if (!cron || cron.id !== "custom-launch-generic-v2-projector") return false;
  const route = source(cron.route?.path);
  const runtime = source(cron.runtime?.path);
  const registryReader = source(cron.registryReader?.path);
  return [
    cron.route,
    cron.runtime,
    cron.store,
    cron.registryReader,
    cron.migration,
  ].every((binding) => sourceBindingMatches(source, binding, overrides)) &&
    typeof route === "string" &&
    route.includes("timingSafeEqual(expected, actual)") &&
    route.includes("Buffer.byteLength(expectedValue, \"utf8\") < 32") &&
    route.includes("Buffer.byteLength(expectedValue, \"utf8\") > 1_024") &&
    route.includes("process.env.CRON_SECRET") &&
    route.includes('response(401, "unauthorized")') &&
    route.includes('response(503, "reconciliation_unavailable")') &&
    route.includes(`limit: ${cron.batchLimit}`) &&
    typeof runtime === "string" &&
    runtime.includes("GENERIC_LAUNCH_LIFECYCLE_MAXIMUM_AGE_MS = 300_000") &&
    runtime.includes("GENERIC_LAUNCH_LIFECYCLE_REFRESH_AFTER_MS = 60_000") &&
    runtime.includes("GENERIC_LAUNCH_RECONCILIATION_LEASE_MS = 55_000") &&
    runtime.includes("GENERIC_LAUNCH_RECONCILIATION_CONCURRENCY = 8") &&
    typeof registryReader === "string" &&
    registryReader.includes("MAXIMUM_INITIAL_LOG_BLOCKS = 20_000n") &&
    registryReader.includes("MAXIMUM_CONCURRENT_LOG_REQUESTS = 24") &&
    exactJson(
      {
        maximumLifecycleAgeMs: cron.maximumLifecycleAgeMs,
        refreshAfterMs: cron.refreshAfterMs,
        leaseMs: cron.leaseMs,
        maximumApprovalInventory: cron.maximumApprovalInventory,
        batchLimit: cron.batchLimit,
        concurrency: cron.concurrency,
        maximumInitialLogBlocks: cron.maximumInitialLogBlocks,
        maximumConcurrentLogRequests: cron.maximumConcurrentLogRequests,
      },
      {
        maximumLifecycleAgeMs: 300_000,
        refreshAfterMs: 60_000,
        leaseMs: 55_000,
        maximumApprovalInventory: 48,
        batchLimit: 16,
        concurrency: 8,
        maximumInitialLogBlocks: 20_000,
        maximumConcurrentLogRequests: 24,
      },
    );
}

function protocolRevenueCronIsBound(source, cron, overrides) {
  if (!cron || cron.id !== "protocol-revenue") return false;
  const route = source(cron.route?.path);
  const runtime = source(cron.runtime?.path);
  const environment = source(".env.example");
  return [cron.route, cron.runtime, ...(cron.dependencies ?? []), cron.policy]
    .every((binding) => sourceBindingMatches(source, binding, overrides)) &&
    typeof route === "string" &&
    route.includes("timingSafeEqual(provided, expected)") &&
    route.includes("process.env.CRON_SECRET") &&
    route.includes("secretLength < 32") &&
    route.includes("secretLength > 1_024") &&
    route.includes("status: 401") &&
    typeof runtime === "string" &&
    runtime.includes("env.PROTOCOL_REVENUE_AUTOMATION_ENABLED !== \"true\"") &&
    typeof environment === "string" &&
    (environment.match(/^PROTOCOL_REVENUE_AUTOMATION_ENABLED=false$/gmu)?.length ?? 0) === 1 &&
    !environment.includes("NEXT_PUBLIC_PROTOCOL_REVENUE_AUTOMATION_ENABLED");
}

function hasOrderedFragments(source, fragments) {
  if (typeof source !== "string") return false;
  let cursor = -1;
  for (const fragment of fragments) {
    cursor = source.indexOf(fragment, cursor + 1);
    if (cursor < 0) return false;
  }
  return true;
}

function manualPromotionSequenceIsFailClosed(source) {
  if (typeof source !== "string") return false;
  const activePromotions = source.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^vercel promote(?:\s|$)/u.test(line));
  return activePromotions.length === 1 &&
    activePromotions[0] === EXACT_MANUAL_VERCEL_PROMOTION &&
    hasOrderedFragments(source, [
      "set -euo pipefail",
      'test ! -e "$PRE_PROMOTE_BINDING_OUTPUT"',
      "npm run perf:read-model:staged-deployment --",
      'grep -Fx "deployment_id=$STAGED_DEPLOYMENT_ID" "$PRE_PROMOTE_BINDING_OUTPUT"',
      'grep -Fx "target_url=$STAGED_TARGET_URL" "$PRE_PROMOTE_BINDING_OUTPUT"',
      EXACT_MANUAL_VERCEL_PROMOTION,
      "npm run perf:read-model:post-promotion --",
      '--deployment-id "$STAGED_DEPLOYMENT_ID"',
      '--git-head "$GITHUB_SHA"',
    ]);
}

function manualRollbackSequenceIsFailClosed(source) {
  if (typeof source !== "string") return false;
  const start = source.indexOf("Use fresh owner-only output paths.");
  const end = source.indexOf("\nThe metadata binder", start);
  if (start < 0 || end <= start) return false;
  const block = source.slice(start, end);
  const activeRollbacks = block.split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^vercel rollback(?:\s|$)/u.test(line));
  return activeRollbacks.length === 1 &&
    activeRollbacks[0] === EXACT_MANUAL_VERCEL_ROLLBACK &&
    hasOrderedFragments(block, [
      'test ! -e "$UNCERTAIN_PRODUCTION_BINDING_OUTPUT"',
      '--expected-deployment-id "$STAGED_DEPLOYMENT_ID"',
      '--expected-git-head "$GITHUB_SHA"',
      'grep -Fx "deployment_id=$STAGED_DEPLOYMENT_ID"',
      EXACT_MANUAL_VERCEL_ROLLBACK,
      'test ! -e "$ROLLBACK_PRODUCTION_BINDING_OUTPUT"',
      '--expected-deployment-id "$PREVIOUS_DEPLOYMENT_ID"',
      '--expected-git-head "$PREVIOUS_GIT_HEAD"',
      'grep -Fx "deployment_id=$PREVIOUS_DEPLOYMENT_ID"',
      'grep -Fx "deployment_url=$PREVIOUS_DEPLOYMENT_URL"',
      'grep -Fx "git_head=$PREVIOUS_GIT_HEAD"',
    ]);
}

function retiredCandidateCutoverIsFailClosed(source, packageJson) {
  const productionRunbook = source("docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md");
  const envioRunbook = source("docs/data-pipeline/ENVIO-CANDIDATE-RUNBOOK.md");
  const runtimeBinding = source("lib/data-pipeline/candidate-projector-runtime-binding.server.ts");
  const cutoverOperator = source("scripts/data-pipeline/cutover-operator.mjs");
  const cutoverRuntime = source("scripts/data-pipeline/cutover-runtime.mjs");
  const bootstrapRuntime = source("scripts/data-pipeline/hosted-db-bootstrap-runtime.mjs");
  return typeof productionRunbook === "string" &&
    productionRunbook.includes("# Historical candidate cutover retired") &&
    productionRunbook.includes("This document no longer authorizes a production cutover.") &&
    !productionRunbook.includes("```sh") &&
    !productionRunbook.includes("vercel promote") &&
    typeof envioRunbook === "string" &&
    envioRunbook.includes("# Historical Envio candidate record") &&
    envioRunbook.includes("must not be rebound") &&
    !envioRunbook.includes("```") &&
    typeof runtimeBinding === "string" &&
    runtimeBinding.includes("retired-candidate-projector-runtime-binding") &&
    !runtimeBinding.includes("candidate-backfill") &&
    typeof cutoverOperator === "string" &&
    cutoverOperator.includes("No mutation command is available") &&
    typeof cutoverRuntime === "string" &&
    cutoverRuntime.includes("historical candidate cutover is retired") &&
    !cutoverRuntime.includes("PROGRAMMABLE_") &&
    typeof bootstrapRuntime === "string" &&
    bootstrapRuntime.includes("historical candidate bootstrap is retired") &&
    !bootstrapRuntime.includes("PROGRAMMABLE_") &&
    packageJson?.scripts?.["test:retired-read-model-cutover"] ===
      "node --test scripts/data-pipeline/cutover-operator.test.mjs scripts/data-pipeline/cutover-runtime.test.mjs scripts/data-pipeline/hosted-db-bootstrap.test.mjs";
}

function exactWorkflowStep(workflow, name) {
  if (typeof workflow !== "string") return "";
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) return "";
  const end = workflow.indexOf("\n      - name:", start + marker.length);
  return workflow.slice(start, end < 0 ? undefined : end);
}

export function evaluateReadModelOperationsSourceContracts(
  rootDirectory,
  options = {},
) {
  const overrides = options.sourceOverrides ?? {};
  const expectedSha256Overrides = options.expectedSha256Overrides ?? {};
  const source = (path) => readSource(rootDirectory, path, overrides);
  const checks = [];
  const failures = [];
  const check = (id, condition, detail) => {
    checks.push({ id, status: condition ? "pass" : "fail", detail });
    if (!condition) failures.push({ id, detail });
  };

  const operations = parseJson(source(CONFIG_PATH));
  const vercel = parseJson(source(VERCEL_CONFIG_PATH));
  const crons = exactCronMap(vercel);
  const packageJson = parseJson(source("package.json"));
  const publicRoutes = operations?.publicReads?.routes;
  const retiredOperations = operations?.retiredOperations;
  const pausedTriggers = operations?.pausedTriggers;
  const activeCrons = operations?.activeCrons;

  check(
    "ops-index-reset-config",
    operations !== null &&
      Object.keys(operations).sort().join(",") ===
        "activeCrons,health,mode,pausedTriggers,providerPolicy,publicReads,release,retiredOperations,schemaVersion,scope" &&
      operations.schemaVersion === 1 &&
      operations.mode === "explore-index-reset-v1" &&
      exactJson(operations.scope, {
        included: "website-explore-token-discovery-and-market-indexing",
        excluded: {
          apiDocumentation: "unchanged",
          apiKeyManagement: "unchanged",
          customLaunch: "unchanged",
          profileClaims: "unchanged",
          protocolRevenue: "unchanged",
        },
      }) &&
      exactJson(operations.providerPolicy, {
        disabledProviders: ["gmgn", "dexscreener", "bitquery"],
        externalCallsExpected: 0,
        fallbacks: false,
        environmentActivation: false,
      }) &&
      exactJson(
        publicRoutes,
        PUBLIC_RESET_ROUTES.map((route) => ({
          method: route.method,
          path: route.path,
          source: route.source,
        })),
      ) &&
      operations.publicReads.status === "index_rebuilding" &&
      operations.publicReads.statusCode === 503 &&
      operations.publicReads.cacheControl === "no-store" &&
      operations.publicReads.retryAfter === "3600" &&
      operations.publicReads.indexingHeader === "reset" &&
      operations.publicReads.validationBeforeResetResponse === true &&
      exactJson(operations.health, {
        method: "GET",
        path: "/api/ops/health",
        source: "app/api/ops/health/route.ts",
        status: "index-reset",
        statusCode: 200,
        providers: [],
      }) &&
      exactJson(
        retiredOperations,
        RETIRED_OPERATIONS.map((route) => ({
          method: route.method,
          path: route.path,
          source: route.source,
          statusCode: route.statusCode,
        })),
      ) &&
      exactJson(
        pausedTriggers,
        PAUSED_TRIGGERS.map((route) => ({
          method: route.method,
          path: route.path,
          source: route.source,
          statusCode: route.statusCode,
        })),
      ) &&
      exactJson(operations.release, {
        smoke: {
          source: "scripts/smoke-explore-index-reset-public-apis.mjs",
          test: "scripts/test/smoke-explore-index-reset-public-apis.test.mjs",
          stagedExport: "runStagedExploreIndexResetSmokeV1",
          productionExport: "runProductionExploreIndexResetSmokeV1",
          publicRoutesChecked: 6,
          retiredOperationsChecked: 10,
          providerCallsExpected: 0,
        },
        providerRetry: false,
        wakeCanary: false,
        stageOnlyWorkflow: true,
        exactDeploymentBinding: true,
        manualRollback: true,
      }),
    "the manifest exposes one intentional zero-provider Explore reset without changing Custom Launch, claims, API keys or protocol revenue",
  );

  const resetHelper = source(RESET_HELPER_PATH);
  check(
    "ops-index-reset-response-helper",
    hasOnlyAllowedImports(resetHelper, new Set(["next/server"])) &&
      resetHelper.includes('"Cache-Control": "no-store"') &&
      resetHelper.includes('"Retry-After": "3600"') &&
      resetHelper.includes('"X-Programmable-Indexing-Status": "reset"') &&
      resetHelper.includes('error: "Token data is temporarily unavailable"') &&
      resetHelper.includes('status: "index_rebuilding"') &&
      /status:\s*503,\s*headers:\s*INDEX_RESET_HEADERS/u.test(resetHelper) &&
      resetHelper.includes('schemaVersion: "programmable.market-chart-error.v2"') &&
      resetHelper.includes('source: "programmable"') &&
      resetHelper.includes('reason: "identity-unavailable"'),
    "all reset responses share the exact no-store 503 contract and cannot perform network or provider work",
  );

  check(
    "ops-public-explore-routes-static",
    PUBLIC_RESET_ROUTES.every((route) => {
      const routeSource = source(route.source);
      const allowedImports = new Set([
        "next/server",
        "viem",
        ...(route.path === "/api/explore/profile"
          ? ["@/lib/profile/onchain-profile", "@/lib/server/explore-index-reset"]
          : []),
      ]);
      const importsAllowed = importedSpecifiers(routeSource).every((specifier) =>
        allowedImports.has(specifier) || specifier.endsWith("/lib/server/explore-index-reset")
      );
      return hasNoIndexingCapability(routeSource) &&
        importsAllowed &&
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${route.method}\\b`, "u")
          .test(routeSource) &&
        routeSource.includes("searchParams") &&
        routeSource.includes("status: 400") &&
        routeSource.includes("lib/server/explore-index-reset") &&
        routeSource.includes(route.responseCall);
    }),
    "the five Explore reads preserve local validation and then return only the static reset response",
  );

  check(
    "ops-health-index-reset",
    hasNoIndexingCapability(source(operations?.health?.source)) &&
      source(operations?.health?.source)?.includes('status: "index-reset"') &&
      source(operations?.health?.source)?.includes("providers: []") &&
      source(operations?.health?.source)?.includes("status: 200") &&
      source(operations?.health?.source)?.includes('"X-Programmable-Indexing-Status": "reset"'),
    "health reports the intentional reset and an empty provider set without consulting provider state",
  );

  check(
    "ops-retired-indexing-operations-static",
    RETIRED_OPERATIONS.every((operation) =>
      hasExactStaticHandler(source(operation.source), operation)
    ) && PAUSED_TRIGGERS.every((operation) =>
      hasExactStaticHandler(source(operation.source), operation)
    ),
    "all retired indexing writers and paused inbound triggers are argument-free static responses with no runtime capability",
  );

  check(
    "ops-cron-exact-set",
    Array.isArray(activeCrons) &&
      activeCrons.length === ACTIVE_CRONS.length &&
      crons?.size === ACTIVE_CRONS.length + 1 &&
      crons.get("/api/ops/robinhood-index") === "* * * * *" &&
      ACTIVE_CRONS.every((expected, index) =>
        activeCrons[index]?.id === expected.id &&
        activeCrons[index]?.path === expected.path &&
        activeCrons[index]?.schedule === expected.schedule &&
        crons.get(expected.path) === expected.schedule
      ),
    "Vercel schedules protocol revenue, Custom Launch V2 and the isolated Robinhood stamp index; retired workers stay disabled",
  );

  const protocolCron = activeCrons?.find(({ id }) => id === "protocol-revenue");
  const customCron = activeCrons?.find(
    ({ id }) => id === "custom-launch-generic-v2-projector",
  );
  check(
    "ops-protocol-revenue-binding",
    protocolRevenueCronIsBound(source, protocolCron, expectedSha256Overrides),
    "the unrelated protocol-revenue cron retains its exact source, bounded auth and default-off activation",
  );
  check(
    "ops-custom-v2-reconciler-binding",
    customLaunchCronIsBound(source, customCron, expectedSha256Overrides),
    "the unrelated Custom Launch V2 projector retains its exact source, bounded auth and lifecycle limits",
  );

  const workflow = source(".github/workflows/deploy-production.yml") ?? "";
  const resetSmokeStep = exactWorkflowStep(
    workflow,
    "Smoke exact staged legacy Explore API reset",
  );
  const handoffStep = exactWorkflowStep(workflow, "Record staged candidate handoff");
  const resetSmoke = source(operations?.release?.smoke?.source) ?? "";
  const postPromotion = source("scripts/perf/read-model-post-promotion.mjs") ?? "";
  check(
    "ops-reset-smoke-binding",
    /export\s+(?:async\s+)?function\s+runStagedExploreIndexResetSmokeV1/u.test(resetSmoke) &&
      /export\s+(?:async\s+)?function\s+runProductionExploreIndexResetSmokeV1/u.test(resetSmoke) &&
      !/(?:api\.gmgn|api\.dexscreener|streaming\.bitquery)\./iu.test(resetSmoke) &&
      resetSmokeStep.includes("id: index-reset-smoke") &&
      resetSmokeStep.includes("node scripts/smoke-explore-index-reset-public-apis.mjs") &&
      !resetSmokeStep.includes("if:") &&
      !resetSmokeStep.includes("continue-on-error") &&
      handoffStep.includes("INDEXING_STATUS: ${{ steps.index-reset-smoke.outputs.indexing_status }}") &&
      handoffStep.includes("PUBLIC_ROUTES_CHECKED: ${{ steps.index-reset-smoke.outputs.public_routes_checked }}") &&
      handoffStep.includes("RETIRED_OPERATIONS_CHECKED: ${{ steps.index-reset-smoke.outputs.retired_operations_checked }}") &&
      handoffStep.includes("PROVIDER_CALLS_EXPECTED: ${{ steps.index-reset-smoke.outputs.provider_calls_expected }}"),
    "staging runs one mandatory exact-origin reset smoke and records its zero-provider result",
  );

  check(
    "ops-retired-provider-release-paths-absent",
    RETIRED_RELEASE_REFERENCES.every((fragment) =>
      !workflow.includes(fragment) &&
      !postPromotion.includes(fragment) &&
      !JSON.stringify(packageJson).includes(fragment)
    ) &&
      source("scripts/smoke-static-dexscreener-public-apis.mjs") === null &&
      source("scripts/test/smoke-static-dexscreener-public-apis.test.mjs") === null &&
      packageJson?.scripts?.["perf:read-model:wake-canary"] === undefined,
    "old provider smoke, provider retry and wake-canary release authority are absent",
  );

  check(
    "ops-provider-environment-cannot-reactivate",
    [...PUBLIC_RESET_ROUTES, ...RETIRED_OPERATIONS, ...PAUSED_TRIGGERS].every(({ source: path }) =>
      !source(path)?.includes("process.env")
    ) &&
      operations?.providerPolicy?.environmentActivation === false &&
      operations?.providerPolicy?.externalCallsExpected === 0 &&
      operations?.providerPolicy?.fallbacks === false,
    "provider keys, flags and endpoints cannot reactivate a public read or retired indexing operation",
  );

  check(
    "ops-package-verify-binding",
    packageJson?.scripts?.verify?.includes("npm run perf:read-model:ops-gate") === true &&
      packageJson?.scripts?.test?.includes(
        "scripts/test/smoke-explore-index-reset-public-apis.test.mjs",
      ) === true &&
      packageJson?.scripts?.["test:interface:ci"]?.includes(
        "scripts/test/smoke-explore-index-reset-public-apis.test.mjs",
      ) === true &&
      packageJson?.scripts?.["verify:custom-v2:ci"]?.split(" && ").includes(
        "npm run verify:custom-v2:checks:ci",
      ) === true &&
      packageJson?.scripts?.["verify:custom-v2:checks:ci"]?.includes(
        "scripts/test/smoke-explore-index-reset-public-apis.test.mjs",
      ) === true,
    "canonical, interface and Custom V2 verification all consume the reset contract",
  );

  const verifyWorkflow = source(".github/workflows/verify.yml") ?? "";
  check(
    "ops-exact-candidate-and-verify-binding",
    workflow.includes("id: production-before") &&
      workflow.includes('--reject-git-head "$GITHUB_SHA"') &&
      workflow.indexOf("id: production-before") < workflow.indexOf("id: deploy") &&
      workflow.includes("node scripts/production-verify-proof.mjs resolve") &&
      workflow.includes("gh attestation verify") &&
      workflow.includes('--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/verify.yml"') &&
      workflow.includes('--source-digest "$GITHUB_SHA"') &&
      workflow.includes('--signer-digest "$GITHUB_SHA"') &&
      workflow.includes("vercel deploy --prod --skip-domain --archive=tgz") &&
      workflow.includes('--meta githubCommitSha="$GITHUB_SHA"') &&
      workflow.includes('--env VERCEL_GIT_COMMIT_SHA="$GITHUB_SHA"') &&
      !workflow.includes("vercel promote") &&
      !workflow.includes("vercel rollback") &&
      verifyWorkflow.includes("npm run perf:read-model:ops-gate") &&
      verifyWorkflow.includes("name: Bind production Verify proof") &&
      verifyWorkflow.includes("uses: actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26"),
    "the exact-SHA source-built candidate still consumes the independent Verify attestation and remains stage-only",
  );

  const metadataBinder = source("scripts/bind-vercel-sensitive-production-metadata.mjs") ?? "";
  check(
    "ops-sensitive-metadata-binding",
    workflow.includes("node scripts/bind-vercel-sensitive-production-metadata.mjs") &&
      workflow.includes('--metadata-file "$metadata_file"') &&
      workflow.includes('--vercel-project-id "$VERCEL_PROJECT_ID"') &&
      metadataBinder.includes("VERCEL_SAFE_ENVIRONMENT_METADATA_FIELDS") &&
      metadataBinder.includes("FORBIDDEN_VALUE_FIELDS") &&
      metadataBinder.includes("containsForbiddenValueField") &&
      metadataBinder.includes('writeFile(args["metadata-file"],') &&
      !metadataBinder.includes("console.log"),
    "staging keeps generic Vercel environment metadata value-free and project-bound",
  );

  check(
    "ops-production-post-promotion-binding",
    postPromotion.includes("verifyProductionDeploymentBinding") &&
      postPromotion.includes("verifyPostPromotion({") &&
      postPromotion.includes("runProductionExploreIndexResetSmokeV1({") &&
      postPromotion.includes('id: "production-explore-index-reset-public-apis"') &&
      postPromotion.includes('"--target-url, --deployment-id and --git-head are required"') &&
      !/(?:GMGN_API_KEY|DEXSCREENER|BITQUERY|input\.environment)/u.test(postPromotion) &&
      source("scripts/perf/read-model-production-binding.mjs")?.includes(
        "export async function resolveProductionBinding(input)",
      ) &&
      source("scripts/perf/read-model-production-binding.mjs")?.includes("rejectGitHead"),
    "post-promotion rebinds the exact deployment and commit before the same reset smoke",
  );

  const operationsRunbook = source("docs/operations/read-model-scheduler-cutover.md") ?? "";
  check(
    "ops-manual-promotion-and-rollback-binding",
    operationsRunbook.includes("stage-only and must never call `vercel promote`") &&
      manualPromotionSequenceIsFailClosed(operationsRunbook) &&
      manualRollbackSequenceIsFailClosed(operationsRunbook) &&
      /Auto-assign Custom Production\s+Domains/u.test(operationsRunbook) &&
      !/\bprj_[A-Za-z0-9]{8,128}\b/u.test(operationsRunbook),
    "manual promotion and rollback remain exact, ordered, owner-only and free of literal project IDs",
  );

  check(
    "ops-retired-candidate-cutover",
    retiredCandidateCutoverIsFailClosed(source, packageJson),
    "the historical candidate cutover remains non-executable",
  );

  const actionRoutes = [
    source("app/api/explore/profile/claim/route.ts") ?? "",
    source("app/api/trade/prepare/route.ts") ?? "",
  ];
  check(
    "ops-prepare-routes-no-broadcast-authority",
    actionRoutes.every((route) =>
      !/(?:sendTransaction|writeContract|eth_sendRawTransaction|createWalletClient)/u.test(route)
    ),
    "the excluded action routes remain preparation-only and gain no broadcast authority from the reset",
  );

  return { ok: failures.length === 0, checks, failures };
}

function main() {
  const result = evaluateReadModelOperationsSourceContracts(process.cwd());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main();
}
