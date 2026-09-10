import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const EMPTY_SCOPE = Object.freeze({
  contracts: false,
  custom_v2: false,
  database: false,
  dependencies: false,
  indexer: false,
  interface: false,
  read_model: false,
  robinhood_phase_b_evidence: false,
  robinhood_phase_b_evidence_exact: false,
  robinhood_v41_phase_b_evidence: false,
  robinhood_v41_phase_b_evidence_exact: false,
});

const FULL_SCOPE_KEYS = Object.freeze([
  "contracts",
  "custom_v2",
  "database",
  "dependencies",
  "indexer",
  "interface",
  "read_model",
]);

export const ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS = Object.freeze([
  "release/robinhood-chain-4663/backend-promotion-input.attestation.json",
  "release/robinhood-chain-4663/backend-promotion-input.public.json",
]);

const ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATH_SET = new Set(
  ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS,
);

export const ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS = Object.freeze([
  "release/robinhood-chain-4663/v4.1/backend-promotion-input.attestation.json",
  "release/robinhood-chain-4663/v4.1/backend-promotion-input.public.json",
]);

const ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATH_SET = new Set(
  ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS,
);

export const ROBINHOOD_V41_CLI_COORDINATE_PATH =
  "docs/operations/releases/custom-launch-v4.1/clean-room-release-coordinate.json";

// This optimization proves the complete before/after bytes, not just a path
// match. Anything outside the two existing URL literals remains a full check.
export const INTERFACE_GUIDANCE_LITERAL_PATHS = Object.freeze([
  "lib/custom-launch/v4-public-contract-discovery.ts",
  "tests/public-robinhood-v41-agent-docs.test.ts",
]);
export const INTERFACE_GUIDANCE_MARKDOWN_PATHS = Object.freeze([
  "public/developers/custom-launch-api-v1.md",
  "docs/public/developers/custom-launch.md",
]);
const GUIDANCE_LINE_PATTERNS = [
  /^    guideUrl: `\$\{SITE_ORIGIN\}(\/developers\/[A-Za-z0-9][A-Za-z0-9/_-]*\.md)`,\n/gmu,
  /^      robinhoodGuide: "https:\/\/programmable\.market(\/developers\/[A-Za-z0-9][A-Za-z0-9/_-]*\.md)",\n/gmu,
];

function readGitChange(file, { baseSha, headSha }) {
  const git = (args) => execFileSync("git", args, { maxBuffer: 4 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const text = (buffer) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  const status = text(git(["diff", "--no-renames", "--name-status", "-z", baseSha, headSha, "--", file]));
  if (status !== `M\0${file}\0`) throw new Error("Guidance paths must be modified existing files.");
  return [baseSha, headSha].map((sha) => {
    const entry = text(git(["ls-tree", "-z", sha, "--", file]));
    if (!new RegExp(`^100644 blob [a-f0-9]{40}\\t${file.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\x00$`, "u").test(entry)) {
      throw new Error("Guidance paths must retain their regular-file mode.");
    }
    return text(git(["show", `${sha}:${file}`]));
  });
}

export function isInterfaceGuidanceOnlyChange(paths, {
  baseSha,
  headSha,
  scope = classifyVerifyPaths(paths),
  readChange = readGitChange,
} = {}) {
  if (!/^[a-f0-9]{40}$/u.test(baseSha ?? "") || !/^[a-f0-9]{40}$/u.test(headSha ?? "")
    || baseSha === headSha || scope.interface !== true
    || Object.entries(scope).some(([key, value]) => key !== "interface" && value !== false)) return false;
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0 || uniquePaths.length !== paths.length
    || !uniquePaths.some((file) => INTERFACE_GUIDANCE_LITERAL_PATHS.includes(file))) return false;
  try {
    for (const file of uniquePaths) {
      const literalIndex = INTERFACE_GUIDANCE_LITERAL_PATHS.indexOf(file);
      if (literalIndex === -1 && !INTERFACE_GUIDANCE_MARKDOWN_PATHS.includes(file)) return false;
      const [before, after] = readChange(file, { baseSha, headSha });
      if (typeof before !== "string" || typeof after !== "string" || before === after) return false;
      if (literalIndex === -1) continue;
      const pattern = GUIDANCE_LINE_PATTERNS[literalIndex];
      const oldMatches = [...before.matchAll(pattern)];
      const newMatches = [...after.matchAll(pattern)];
      if (oldMatches.length !== 1 || newMatches.length !== 1) return false;
      const withoutUrl = (content, match) => content.slice(0, match.index)
        + match[0].replace(match[1], "/GUIDANCE_URL") + content.slice(match.index + match[0].length);
      if (withoutUrl(before, oldMatches[0]) !== withoutUrl(after, newMatches[0])) return false;
    }
    return true;
  } catch {
    // Missing history, deleted/renamed files, invalid bytes, or unreadable Git
    // objects never select reduced coverage.
    return false;
  }
}

const CUSTOM_V2_EXACT_PATHS = new Set([
  "config/custom-registry-v2.deployment.prelaunch.json",
  "config/generic-launch-foundation.prelaunch.v1.json",
  "config/generic-launch-foundation.v1.schema.json",
  "config/generic-launch-public.v2.schema.json",
  "docs/operations/WEBSITE-PROJECTION-DATABASE-BACKEND-HANDOFF-V1.json",
  "lib/custom-launch/registry-public-manifest-v2.ts",
  "lib/data-pipeline/custom-registry-v2-event-manifest.ts",
  "lib/server/custom-launch/registry-manifest-v2.ts",
  "lib/server/projection-target/approval-v3-target.ts",
  "scripts/custom-v2-read-model-contract-v2.mjs",
  "scripts/custom-v2-stage-gate.mjs",
  "scripts/custom-v2-signer-probe-gate.mjs",
  "scripts/read-bounded-response.mjs",
  "scripts/reconcile-generic-signer-probe-deployments.mjs",
  "scripts/test/custom-v2-read-model-contract-v2.test.mjs",
  "scripts/test/custom-v2-signer-probe-gate.test.mjs",
  "scripts/test/read-bounded-response.test.mjs",
  "scripts/test/reconcile-generic-signer-probe-deployments.test.mjs",
  "scripts/test/custom-v2-stage-gate.test.mjs",
  "scripts/test/custom-v2-production-workflow-contract.test.mjs",
]);

function isCustomV2OnlyPath(path) {
  return CUSTOM_V2_EXACT_PATHS.has(path)
    || /^app\/api\/custom-launch\/(?:generic|registry)\/v2\//u.test(path)
    || /^app\/api\/ops\/custom-launch\/generic-v2-(?:projector|signer-probe)\//u.test(path)
    || /^app\/v2\/internal\/projections\/approval-descriptors\//u.test(path)
    || /^app\/custom-launches\//u.test(path)
    || /^components\/generic-launch-directory-v2(?:\.module\.css|\.tsx)$/u.test(path)
    || /^lib\/server\/custom-launch\/generic-launch-[^/]*-v[12]\.ts$/u.test(path)
    || /^tests\/(?:approval-v3-artifact-projection-target|custom-registry-v2-(?:bindings|public-release)|generic-launch-(?:postgres-v2|projector-v2|read-production-probe-v1|read-signer-v2|read-v2|record-v2))\.test\.ts$/u.test(path);
}

export const CONTRACT_RELEASE_TEST_PATHS = Object.freeze([
  "tests/classic-v3-deployment-sequence.test.ts",
  "tests/deep-release-verifier.test.ts",
  "tests/deep-v2-release-verifier.test.ts",
]);

export const DATABASE_RUNTIME_TEST_PATHS = Object.freeze([
  "tests/website-projection-target.test.ts",
]);

export const DATABASE_RUNTIME_SOURCE_PATHS = Object.freeze([
  "lib/server/custom-launch/genesis-canary-public-v1.ts",
  "lib/server/custom-launch/project-read-v2.ts",
  "lib/server/custom-launch/public-readiness.ts",
  "lib/server/custom-launch/registry-public-read-v1.ts",
  "lib/server/custom-launch/registry-public-store-v1.ts",
]);

export const READ_MODEL_CONTRACT_DOC_PATHS = Object.freeze([
  "docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md",
  "docs/operations/read-model-scheduler-cutover.md",
]);

function markAll(scope) {
  for (const key of FULL_SCOPE_KEYS) {
    scope[key] = true;
  }
}

export function classifyVerifyPaths(
  paths,
  { forceAll = false, customV2Release = false } = {},
) {
  const scope = { ...EMPTY_SCOPE };
  if (typeof customV2Release !== "boolean") {
    throw new TypeError("Custom V2 release classification must be boolean");
  }
  if (forceAll) {
    markAll(scope);
    return scope;
  }

  // A manual Generic V2 production release verifies the complete, current
  // Custom V2 tree, even when the production tip's last diff was unrelated.
  // This is a distinct verification intent, not a changed-path claim.
  if (customV2Release) scope.custom_v2 = true;

  const uniquePaths = new Set(paths.filter(Boolean));
  const robinhoodEvidencePaths = [...uniquePaths].filter((candidate) =>
    ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(candidate));
  scope.robinhood_phase_b_evidence = robinhoodEvidencePaths.length > 0;
  scope.robinhood_phase_b_evidence_exact =
    uniquePaths.size === ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS.length
    && robinhoodEvidencePaths.length === ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATHS.length;
  const robinhoodV41EvidencePaths = [...uniquePaths].filter((candidate) =>
    ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(candidate));
  scope.robinhood_v41_phase_b_evidence = robinhoodV41EvidencePaths.length > 0;
  scope.robinhood_v41_phase_b_evidence_exact =
    uniquePaths.size === ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS.length
    && robinhoodV41EvidencePaths.length === ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATHS.length;

  for (const path of paths) {
    if (!path) continue;

    // Each version's short-lived, cryptographically attested evidence pair has
    // a dedicated protected Contracts check. Both checks reject partial, mixed,
    // and cross-version imports and verify the exact subject, Sigstore identity,
    // stage binding, and unchanged ten-minute authorization window before merge.
    if (ROBINHOOD_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(path)
      || ROBINHOOD_V41_PHASE_B_BACKEND_EVIDENCE_PATH_SET.has(path)) continue;

    // This exact JSON document selects an immutable CLI release; it does not
    // change Solidity, database, indexer, or dependency inputs. The Interface
    // lane builds its public discovery consumer and authenticates the complete
    // V4.1 coordinate/activation closure, including producer and asset hashes.
    // Schemas, sibling release records, verifier changes, and mixed code
    // changes still select their own full gates below.
    if (path === ROBINHOOD_V41_CLI_COORDINATE_PATH) {
      scope.interface = true;
      continue;
    }

    // This closed generation-2 surface has its own production proof and
    // staged health contract. In particular, flipping the versioned Registry
    // deployment binding must not pay Classic, Stock, Explore, or the global
    // market read-model gates.
    if (isCustomV2OnlyPath(path)) {
      scope.custom_v2 = true;
      continue;
    }

    if (
      /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|bun\.lock|tsconfig[^/]*\.json|next\.config\.[^/]+|eslint\.config\.[^/]+|vitest\.config\.[^/]+)$/u.test(
        path,
      ) ||
      /^(?:\.github|config|ops|releases|scripts)\//u.test(path) ||
      /^(?:docs\/(?:operations\/releases|security)|lib\/vendor)\//u.test(
        path,
      ) ||
      /^(?:Dockerfile|docker-compose\.ya?ml)$/u.test(path)
    ) {
      markAll(scope);
      continue;
    }

    if (READ_MODEL_CONTRACT_DOC_PATHS.includes(path)) {
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      /^(?:(?:README|AGENTS|CONTRIBUTING|SECURITY|SUPPORT|CODE_OF_CONDUCT)\.md|LICENSE)$/u.test(
        path,
      ) ||
      /^docs\//u.test(path)
    ) {
      continue;
    }

    if (/^(?:contracts\/|foundry\.toml$|remappings\.txt$|scripts\/test\/any-quote-(?:route-price\.test\.mjs|route-runtime\.test\.mjs|route-permit2\.hex|readiness-discovery\.test\.mjs)$)/u.test(path)) {
      scope.contracts = true;
      scope.interface = true;
      continue;
    }

    if (/^supabase\//u.test(path)) {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      DATABASE_RUNTIME_TEST_PATHS.includes(path) ||
      DATABASE_RUNTIME_SOURCE_PATHS.includes(path) ||
      /^lib\/server\/projection-target\//u.test(path)
    ) {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (CONTRACT_RELEASE_TEST_PATHS.includes(path)) {
      scope.contracts = true;
      scope.interface = true;
      continue;
    }

    if (/^indexer\//u.test(path)) {
      scope.indexer = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (path === "lib/data-pipeline/postgres.ts") {
      scope.database = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (/^lib\/onchain\//u.test(path)) {
      scope.contracts = true;
      scope.interface = true;
      scope.read_model = true;
      continue;
    }

    if (
      /^(?:app|assets|components|lib|public|tests)\//u.test(path) ||
      /^(?:next-env\.d\.ts|vercel\.json)$/u.test(path)
    ) {
      scope.interface = true;
      if (
        /^(?:app\/api\/(?:explore|ops)\/|lib\/data-pipeline\/)/u.test(path) ||
        /^lib\/market-data\//u.test(path) ||
        path === "lib/explore-financial-data.ts" ||
        path === "vercel.json"
      ) {
        scope.read_model = true;
      }
      continue;
    }

    // New or unknown surfaces fail safe until they are explicitly classified.
    markAll(scope);
  }

  return scope;
}

function printGithubOutputs(scope) {
  for (const [key, value] of Object.entries(scope)) {
    console.log(`${key}=${value}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const forceAll = process.argv[2] === "--all";
  const customV2Release = process.argv[2] === "--custom-v2-release";
  if ((forceAll || customV2Release) && process.argv.length !== 3) {
    throw new Error("Verify scope mode does not accept a path file");
  }
  if (!forceAll && !customV2Release && process.argv.length !== 3) {
    throw new Error("Exactly one changed-path file is required");
  }
  const paths = forceAll || customV2Release
    ? []
    : readFileSync(process.argv[2], "utf8")
        .split("\n")
        .map((path) => path.trim())
        .filter(Boolean);
  const scope = classifyVerifyPaths(paths, { forceAll, customV2Release });
  printGithubOutputs({ ...scope, interface_guidance_only: !forceAll && !customV2Release
    && isInterfaceGuidanceOnlyChange(paths, { scope, baseSha: process.env.BASE_SHA, headSha: process.env.HEAD_SHA }) });
}
