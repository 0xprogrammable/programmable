#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseCliOrExit } from "./cli-args.mjs";
import { parseBoundedLosslessJson } from "./github-public-source-core.mjs";
import { validateReviewedDriftReceipt } from "./reviewed-drift-receipt-core.mjs";
import { validateAgainstSchema } from "./submission-core.mjs";
import { validateStarterCatalogClosure, validateTemplateCatalogHistory } from "./verify-skill-catalog-core.mjs";
import { scanPins, validateKnowledgeRoutingClosure, validateLocalModuleClosure } from "./verify-skill-closure-core.mjs";
import { validateScriptsAndTests } from "./verify-skill-execution-core.mjs";
import { createPortableFilesystem, isForbiddenPortableDirectory, isInside, resolveSkillRootWithoutSymlinks } from "./verify-skill-filesystem-core.mjs";
import { validateInstalledProvenance } from "./verify-skill-provenance-core.mjs";
import { markdownHeadingAnchors, parseCanonicalYamlMapping, redactInstalledLocalPathForPortableScan } from "./verify-skill-yaml-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const canonicalSkillRoot = path.resolve(scriptDirectory, "..");
const nodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0], 10);
if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
  console.error("verify-skill.mjs: NODE_24_OR_NEWER_REQUIRED");
  process.exit(1);
}
const MAX_PORTABLE_FILES = 640;
const MAX_PORTABLE_BYTES = 12_000_000;
const MAX_PORTABLE_FILE_BYTES = 1_000_000;
const REQUIRED_PORTABLE_TESTS = Object.freeze(`
application-api-schema application-dependency-core application-v3-prepare-revision-core build-info
build-profile builder-lifecycle canonical-json-core cli
cli-central-base cli-central-package cli-entry cli-open-world
cli-open-world-github cli-output-dir cli-prepare-pr companion-manifest-v2
composition-checker contract-registry cross-chain-policy dependency-pointer-core
example-materializer fee-conformance fee-conformance-receipt-v1 fee-conformance-vector-set-v1
fee-policy-v2 fee-policy-v2-vector-parity github-application github-exact-object-resolver
github-public-source-core golden-scenarios historical-v1-freeze implementation-legos-runtime
knowledge-router launch-bundle launch-bundle-v2 launch-bundle-v2-cli
launch-plan-graph legacy-strict-json-boundaries official-launchpad open-world-migration
open-world-regressions open-world-runtime open-world-security open-world-source-signals
open-world-v2 open-world-v2-module-boundaries ordinary-launch-cli package-dependency-contract
policy-bundle project-compiler project-surfaces public-claims
raw-git-integrity-core registry-acceptance-v3-github registry-discovery residual-json-boundaries
resolve-contract-core review-target review-target-contract reviewed-drift-receipt
runtime-assets-core schema-security semantic-rule-registry source-closure-verifier
source-evidence-workflow source-manifest strict-json-core submission
template-catalog trade-capability-manifest typed-launch-contracts-v1 upstream-drift
v4-hook-semantic-contract verify-package-build-info verify-skill-static
`.trim().split(/\s+/u).map((stem) => `scripts/test/${stem}.test.mjs`));
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const errors = [];
const { options } = parseCliOrExit({
  command: "verify-skill.mjs",
  usage: "verify-skill.mjs [--installed] [--skill-root <path> --untrusted-data]",
  summary: "Validate the portable skill package, bundled resources and deterministic tooling.",
  options: [
    { name: "--installed", key: "installed", type: "boolean", description: "Run the portable installed-package checks without repository-coupled fixtures." },
    { name: "--skill-root", key: "skillRoot", type: "value", valueName: "path", description: "Validate a skill package at this path." },
    { name: "--untrusted-data", key: "untrustedData", type: "boolean", description: "Treat the selected package as data and do not execute its scripts or tests." }
  ],
  positionals: { min: 0, max: 0 }
});
const installedMode = options.installed;
const untrustedDataMode = options.untrustedData;
if (installedMode && untrustedDataMode) {
  console.error("verify-skill.mjs: --installed and --untrusted-data cannot be combined");
  process.exit(2);
}
let skillRoot = canonicalSkillRoot;
if (options.skillRoot) {
  const requestedRoot = path.resolve(options.skillRoot);
  try {
    skillRoot = resolveSkillRootWithoutSymlinks(requestedRoot);
  } catch (error) {
    console.error(`verify-skill.mjs: ${error.message}`);
    process.exit(2);
  }
}
if (skillRoot !== canonicalSkillRoot && !untrustedDataMode) {
  console.error("verify-skill.mjs: a non-canonical --skill-root requires --untrusted-data");
  process.exit(2);
}
const { read, relative, walk } = createPortableFilesystem(skillRoot);
const packageTree = walk(skillRoot);
const packageSymlinks = packageTree
  .filter((entry) => entry.stat.isSymbolicLink())
  .map((entry) => `symbolic links are not allowed: ${relative(entry.path)}`);
if (packageSymlinks.length > 0) {
  for (const error of [...new Set(packageSymlinks)].sort()) console.error(`- ${error}`);
  process.exit(1);
}
const transientDirectories = packageTree
  .filter((entry) => entry.stat.isDirectory() && isForbiddenPortableDirectory(relative(entry.path)))
  .map((entry) => relative(entry.path));
if (transientDirectories.length > 0) {
  for (const directory of [...new Set(transientDirectories)].sort()) {
    console.error(`- transient build or staging directory is not portable: ${directory}`);
  }
  process.exit(1);
}
const packageEntriesByPath = new Map(packageTree.map((entry) => [relative(entry.path), entry]));
const packageEntries = packageTree.filter((entry) => entry.stat.isFile());
const packageFiles = packageEntries.map((entry) => entry.path);
const packageContext = { packageEntries, packageEntriesByPath, packageFiles, read, relative, skillRoot };

const required = [
  "SKILL.md",
  "LICENSE.txt",
  "THIRD_PARTY_NOTICES.md",
  "agents/openai.yaml",
  "references/agent-entry-and-application.md",
  "references/architecture-candidates-v1.schema.json",
  "references/application-api.schema.json",
  "references/approval-criteria.md",
  "references/business-system-compiler.md",
  "references/build-profiles.md",
  "references/builder-reviewer-alignment.md",
  "references/builder-toolchain-lock-v1.json",
  "references/capability-contract-v1.schema.json",
  "references/command-receipt-v1.schema.json",
  "references/compatibility-standard.md",
  "references/execution-gates-and-attestation.md",
  "references/execution-surface-coverage-v1.schema.json",
  "references/fee-conformance-receipt-v1.schema.json",
  "references/fee-conformance-vector-set-v1.schema.json",
  "references/idea-source-v1.schema.json",
  "references/intent-contract-v1.schema.json",
  "references/intent-contract.md",
  "references/architecture-decisions-v1.schema.json",
  "references/intent-fidelity-v1.schema.json",
  "references/intake-playbook.md",
  "references/knowledge-routing.json",
  "references/delegated-payer-sponsor-intent-v1.schema.json",
  "references/launch-admission-decision-v1.schema.json",
  "references/normative-property-manifest-v1.json",
  "references/normative-property-manifest-v1.schema.json",
  "references/permit2-launch-witness-v1.schema.json",
  "references/rwa-evidence-profile-v1.schema.json",
  "references/scientific-data-evidence-profile-v1.schema.json",
  "references/swap-mode-classification-v1.schema.json",
  "references/test-evidence-outcome-v1.schema.json",
  "references/open-world-v2-workflow.md",
  "references/open-world-v2-output-contract.md",
  "references/github-application-v3.md",
  "references/historical-v1-freeze.json",
  "references/launch-bundle-input-v1.schema.json",
  "references/launch-bundle-output-v1.schema.json",
  "references/launch-bundle-input-v2.schema.json",
  "references/launch-bundle-output-v2.schema.json",
  "references/launch-plan-graph-input-v1.schema.json",
  "references/launch-plan-graph-output-v1.schema.json",
  "references/companion-manifests.md",
  "references/companion-manifest-v2.schema.json",
  "references/deployment-snapshot.json",
  "references/github-public-source-contract-v1.json",
  "references/github-public-source-contract-v1.schema.json",
  "references/github-application-journey.md",
  "references/official-launchpad-deployments.json",
  "references/official-model-patterns.md",
  "references/programmable-registry-snapshot.json",
  "references/output-contract.md",
  "references/programmable-fee-policy.md",
  "references/programmable-fee-policy-v2.md",
  "references/fee-policy-v2.schema.json",
  "references/public-pr-application.schema.json",
  "references/public-pr-application-v3.schema.json",
  "references/registry-acceptance-v3.schema.json",
  "references/source-closure-manifest-v1.schema.json",
  "references/open-world-security-v1.schema.json",
  "references/programmable-trade-execution-v1.schema.json",
  "references/product-graph-v1.schema.json",
  "references/project-spec-v1.schema.json",
  "references/project-state-v1.schema.json",
  "references/project-toolchain-lock-v1.schema.json",
  "references/repository-plan-v1.schema.json",
  "references/semantic-rule-registry-v1.json",
  "references/semantic-rule-registry-v1.schema.json",
  "references/contract-registry-source-v1.json",
  "references/contract-registry-v1.json",
  "references/submission-schema-catalog.json",
  "references/submission-v2.schema.json",
  "references/trade-capability-manifest-v1.schema.json",
  "references/routing-and-discovery.md",
  "references/runtime-assets-v1.schema.json",
  "references/runtime-assets.md",
  "references/scenario-matrix.md",
  "references/security-and-evidence.md",
  "references/standard-fee-kernel.md",
  "references/submission-regressions.md",
  "references/submission-workflow.md",
  "references/submission.schema.json",
  "references/upstream-sources.json",
  "references/upstream-sources.md",
  "references/upstream-snapshot-2026-08-07.json",
  "references/upstream-reviewed-drift-v1.json",
  "references/upstream-reviewed-drift-v1.schema.json",
  "references/upgrades-and-release.md",
  "references/v4-sdk-integration.md",
  "references/v4-hook-lego.md",
  "references/v4-liquidity-and-state.md",
  "references/v4-protocol-mechanics.md",
  "references/v4-deployment-evidence-v1.schema.json",
  "references/v4-deployment-preimage-v1.schema.json",
  "references/workflow.md",
  "references/template-catalog.md",
  "references/template-catalog-history.json",
  "assets/build-profiles/catalog.json",
  "assets/examples/dynamic-lp-fee.json",
  "assets/examples/managed-usdc-quote.json",
  "assets/examples/transparent-pool-scoped-fee.json",
  "assets/examples/unsafe-hidden-curve.json",
  "assets/templates/submission.example.json",
  "assets/templates/open-world-v2/new-idea/architecture-decisions.v1.json",
  "assets/templates/open-world-v2/new-idea/fee-policy-v2.schema.json",
  "assets/templates/open-world-v2/new-idea/idea-source.v1.json",
  "assets/templates/open-world-v2/new-idea/intent-contract.v1.json",
  "assets/templates/open-world-v2/new-idea/intent-fidelity.v1.json",
  "assets/templates/open-world-v2/new-idea/schemas/custom-profile.example.schema.json",
  "assets/templates/open-world-v2/new-idea/security-assessment-v1.schema.json",
  "assets/templates/open-world-v2/new-idea/security-assessment.v1.json",
  "assets/templates/open-world-v2/new-idea/submission.v2.json",
  "assets/templates/open-world-v2/public-pr-application-v3.example.json",
  "assets/templates/open-world-v2/launch-bundle-input-v2.example.json",
  "assets/templates/open-world-v2/schemas/contract-price-formation.schema.json",
  "assets/templates/open-world-v2/source-closure-manifest-v1.example.json",
  "assets/templates/launch-bundle-input.example.json",
  "assets/templates/no-hook-architecture.example.json",
  "assets/templates/token-mechanics.example.json",
  "assets/templates/runtime-assets.example.json",
  "assets/templates/companion-closure-workflow.yml",
  "assets/templates/primary-foundry-evidence-workflow.yml",
  "assets/templates/primary-npm-evidence-workflow.yml",
  "assets/templates/companion-manifest-v2.example.json",
  "assets/templates/deployment-evidence.example.json",
  "assets/templates/dependency-lock.example.json",
  "assets/templates/gate-status.example.json",
  "assets/templates/release-candidate.example.json",
  "assets/templates/PROPOSAL.md",
  "assets/templates/THREAT_MODEL.md",
  "assets/templates/TEST_PLAN.md",
  "assets/templates/EVIDENCE.md",
  "assets/templates/lifecycle/installed-state.TEST-ONLY.example.json",
  "assets/templates/lifecycle/migration-current-document.example.json",
  "assets/templates/lifecycle/migration-proposal.example.json",
  "assets/templates/lifecycle/release-candidate.critical-hotfix.caller-declared.example.json",
  "assets/templates/lifecycle/release-history.caller-declared.example.json",
  "assets/templates/lifecycle/signed-update.TEST-ONLY.example.json",
  "assets/templates/lifecycle/trusted-pin.TEST-ONLY.example.json",
  "assets/starter-catalog/catalog.json",
  "assets/test-vectors/admin-launch-authorization-v1.first-freeze.json",
  "assets/test-vectors/approval-policy-blind-fixtures-v1.json",
  "assets/test-vectors/blind-eval-definitions-v1.json",
  "assets/test-vectors/canonical-json-v2.json",
  "assets/reference-kernels/programmable-volume-fee-v1/.gitignore",
  "assets/reference-kernels/programmable-volume-fee-v1/README.md",
  "assets/reference-kernels/programmable-volume-fee-v1/SECURITY_PROPERTIES.md",
  "assets/reference-kernels/programmable-volume-fee-v1/evidence/fee-conformance-evidence.example.json",
  "assets/reference-kernels/programmable-volume-fee-v1/foundry.toml",
  "assets/reference-kernels/programmable-volume-fee-v1/package-lock.json",
  "assets/reference-kernels/programmable-volume-fee-v1/package.json",
  "assets/reference-kernels/programmable-volume-fee-v1/remappings.txt",
  "assets/reference-kernels/programmable-volume-fee-v1/src/ProgrammableVolumeFeeHookFactoryV1.sol",
  "assets/reference-kernels/programmable-volume-fee-v1/src/ProgrammableVolumeFeeHookV1.sol",
  "assets/reference-kernels/programmable-volume-fee-v1/test/MockReferenceToken.sol",
  "assets/reference-kernels/programmable-volume-fee-v1/test/ProgrammableVolumeFeeHookV1.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/.gitignore",
  "assets/reference-kernels/programmable-volume-fee-v2/README.md",
  "assets/reference-kernels/programmable-volume-fee-v2/SECURITY_PROPERTIES.md",
  "assets/reference-kernels/programmable-volume-fee-v2/evidence/fee-conformance-evidence.example.json",
  "assets/reference-kernels/programmable-volume-fee-v2/foundry.toml",
  "assets/reference-kernels/programmable-volume-fee-v2/package-lock.json",
  "assets/reference-kernels/programmable-volume-fee-v2/package.json",
  "assets/reference-kernels/programmable-volume-fee-v2/remappings.txt",
  "assets/reference-kernels/programmable-volume-fee-v2/src/ProgrammableVolumeFeeHookFactoryV2.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/src/ProgrammableVolumeFeeHookV2.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/MockReferenceToken.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/MockWETH9.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/ProgrammableVolumeFeeHookV2.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/ProgrammableVolumeFeeHookV2Erc20.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/ProgrammableVolumeFeeHookV2Parity.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/ProgrammableVolumeFeeHookV2UniversalRouterErc20.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/ProgrammableVolumeFeeHookV2UniversalRouterNative.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/V4PlannerEncodingParity.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/helpers/ProgrammableVolumeFeeHookV2Erc20Fixture.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/helpers/UniversalRouterV4Fixture.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/invariant/ProgrammableVolumeFeeHookV2.invariant.t.sol",
  "assets/reference-kernels/programmable-volume-fee-v2/test/sdk-routing-parity.test.mjs",
  "assets/reference-kernels/programmable-volume-fee-v2/test/vectors/fee-policy-v2-vectors.json",
  "assets/reference-kernels/programmable-volume-fee-v2/test/vectors/v4-routing-parity-vectors.json",
  "assets/reference-kernels/programmable-volume-fee-v2/test/vendor/PinnedPermit2Artifact.sol",
  "scripts/bounded-child-process-core.mjs",
  "scripts/bounded-network-response-core.mjs",
  "scripts/build-info-core.mjs",
  "scripts/build-profile-core.mjs",
  "scripts/build-profile.mjs",
  "scripts/build-review-target.mjs",
  "scripts/builder-lifecycle-core.mjs",
  "scripts/builder-lifecycle.mjs",
  "scripts/builder-template-contract.mjs",
  "scripts/application-recheck.mjs",
  "scripts/canonical-json-core.mjs",
  "scripts/canonical-json-legacy-adapters.mjs",
  "scripts/cli-args.mjs",
  "scripts/cli-central-base.mjs",
  "scripts/cli-central-package.mjs",
  "scripts/companion-manifest-contract.mjs",
  "scripts/contract-registry-core.mjs",
  "scripts/cli-github-source.mjs",
  "scripts/cli-local-draft.mjs",
  "scripts/cli-output-dir.mjs",
  "scripts/cli-prepare-pr.mjs",
  "scripts/cli-review-target.mjs",
  "scripts/cli-runtime.mjs",
  "scripts/cli.mjs",
  "scripts/check-upstream-drift.mjs",
  "scripts/closure-report-core.mjs",
  "scripts/composition-checker-contract-core.mjs",
  "scripts/composition-checker-core.mjs",
  "scripts/composition-checker-protocol-rules.mjs",
  "scripts/composition-checker-shared.mjs",
  "scripts/composition-checker-system-rules.mjs",
  "scripts/composition-checker.mjs",
  "scripts/deployment-core.mjs",
  "scripts/example-materializer-core.mjs",
  "scripts/evm-encoding-core.mjs",
  "scripts/fee-conformance-core.mjs",
  "scripts/fee-conformance.mjs",
  "scripts/fee-conformance-v1-constants.mjs",
  "scripts/fee-conformance-receipt-v1-core.mjs",
  "scripts/fee-conformance-vector-set-v1-core.mjs",
  "scripts/fee-policy-v2-core.mjs",
  "scripts/generate-public-pr-application-schema.mjs",
  "scripts/generate-contract-registry.mjs",
  "scripts/github-exact-object-resolver.mjs",
  "scripts/github-public-source-core.mjs",
  "scripts/github-application-core.mjs",
  "scripts/github-application.mjs",
  "scripts/knowledge-router-core.mjs",
  "scripts/knowledge-router.mjs",
  "scripts/launch-bundle-core.mjs",
  "scripts/launch-bundle.mjs",
  "scripts/launch-bundle-v2-core.mjs",
  "scripts/launch-bundle-v2.mjs",
  "scripts/launch-plan-graph-core.mjs",
  "scripts/launch-plan-graph.mjs",
  "scripts/registry-acceptance-v3-github-core.mjs",
  "scripts/materialize-example.mjs",
  "scripts/metadata-core.mjs",
  "scripts/official-launchpad-core.mjs",
  "scripts/open-world-migration-core.mjs",
  "scripts/open-world-security-core.mjs",
  "scripts/open-world-source-signals-core.mjs",
  "scripts/open-world-v2-core.mjs",
  "scripts/open-world-v2-extension-schema-core.mjs",
  "scripts/open-world-v2-extension-schema-inspection.mjs",
  "scripts/open-world-v2-package-io.mjs",
  "scripts/open-world-v2-primitives.mjs",
  "scripts/open-world-v2-privacy-core.mjs",
  "scripts/open-world.mjs",
  "scripts/no-custom-hook-route-core.mjs",
  "scripts/normative-policy-core.mjs",
  "scripts/package-dependency-contract.mjs",
  "scripts/project-surfaces-core.mjs",
  "scripts/project-command-executor-core.mjs",
  "scripts/project-compiler-core.mjs",
  "scripts/project-compiler.mjs",
  "scripts/project-tradable-authoring-core.mjs",
  "scripts/project-tradable-submission-core.mjs",
  "scripts/project-contracts-core.mjs",
  "scripts/project-state-core.mjs",
  "scripts/public-claims-core.mjs",
  "scripts/public-pr-application-v3-core.mjs",
  "scripts/registry-discovery-core.mjs",
  "scripts/registry-discovery.mjs",
  "scripts/repository-root.mjs",
  "scripts/repository-completion-core.mjs",
  "scripts/restricted-json-schema-core.mjs",
  "scripts/restricted-json-schema-definition-core.mjs",
  "scripts/resolve-contract-core.mjs",
  "scripts/resolve-contract.mjs",
  "scripts/resolve-deployment.mjs",
  "scripts/reviewed-drift-receipt-core.mjs",
  "scripts/review-target-contract.mjs",
  "scripts/review-target-core.mjs",
  "scripts/runtime-assets-core.mjs",
  "scripts/scaffold-submission.mjs",
  "scripts/source-manifest.mjs",
  "scripts/semantic-rule-registry-core.mjs",
  "scripts/settlement-policy-core.mjs",
  "scripts/strict-json-core.mjs",
  "scripts/submission-core.mjs",
  "scripts/submission-analysis-helpers.mjs",
  "scripts/submission-constants-core.mjs",
  "scripts/submission-provenance-core.mjs",
  "scripts/submission-report-core.mjs",
  "scripts/submission-target-validation-core.mjs",
  "scripts/submission-value-core.mjs",
  "scripts/template-catalog-core.mjs",
  "scripts/typed-launch-contracts-v1-core.mjs",
  "scripts/template-catalog.mjs",
  "scripts/token-behavior-validation-core.mjs",
  "scripts/token-mechanics-policy-core.mjs",
  "scripts/token-mechanics-resolution-core.mjs",
  "scripts/trade-capability-manifest-core.mjs",
  "scripts/update-registry-snapshot.mjs",
  "scripts/v4-deployment-evidence-core.mjs",
  "scripts/v4-hook-semantic-contract-core.mjs",
  "scripts/test/fee-conformance-v1-fixture.mjs",
  ...REQUIRED_PORTABLE_TESTS,
  "scripts/validate-submission.mjs",
  "scripts/validate-semantic-rule-registry.mjs",
  "scripts/verify-package.mjs",
  "scripts/verify-skill-catalog-core.mjs",
  "scripts/verify-skill-closure-core.mjs",
  "scripts/verify-skill-execution-core.mjs",
  "scripts/verify-skill-filesystem-core.mjs",
  "scripts/verify-skill-provenance-core.mjs",
  "scripts/verify-skill-yaml-core.mjs",
  "scripts/verify-skill.mjs",
  "scripts/doctor.mjs"
];

for (const relativePath of required) {
  const entry = packageEntriesByPath.get(relativePath);
  if (!entry?.stat.isFile()) errors.push(`missing ${relativePath}`);
}

const discoveredPortableTestPaths = packageEntries
  .map((entry) => relative(entry.path))
  .filter((relativePath) => /^scripts\/test\/[^/]+\.test\.mjs$/u.test(relativePath))
  .sort();
const declaredPortableTestSet = new Set(REQUIRED_PORTABLE_TESTS);
const discoveredPortableTestSet = new Set(discoveredPortableTestPaths);
const missingPortableTestPaths = REQUIRED_PORTABLE_TESTS
  .filter((relativePath) => !discoveredPortableTestSet.has(relativePath))
  .sort();
const undeclaredPortableTestPaths = discoveredPortableTestPaths
  .filter((relativePath) => !declaredPortableTestSet.has(relativePath));
const duplicatePortableTestDeclarations = REQUIRED_PORTABLE_TESTS
  .filter((relativePath, index) => REQUIRED_PORTABLE_TESTS.indexOf(relativePath) !== index);
errors.push(...[[
    "portable test inventory must exactly match declared required tests",
    `missing files: ${missingPortableTestPaths.join(", ") || "none"}`,
    `undeclared tests: ${undeclaredPortableTestPaths.join(", ") || "none"}`,
    `duplicate declarations: ${[...new Set(duplicatePortableTestDeclarations)].sort().join(", ") || "none"}`
  ].join("; ")].filter(() => missingPortableTestPaths.length + undeclaredPortableTestPaths.length + duplicatePortableTestDeclarations.length > 0));

const packageBytes = packageEntries.reduce((total, entry) => total + entry.stat.size, 0);
if (packageFiles.length > MAX_PORTABLE_FILES) errors.push(`portable package has ${packageFiles.length} files; keep it at or below ${MAX_PORTABLE_FILES}`);
if (packageBytes > MAX_PORTABLE_BYTES) errors.push(`portable package is ${packageBytes} bytes; keep it at or below ${MAX_PORTABLE_BYTES}`);
for (const entry of packageEntries) {
  if (entry.stat.size > MAX_PORTABLE_FILE_BYTES) errors.push(`${relative(entry.path)} exceeds the ${MAX_PORTABLE_FILE_BYTES}-byte per-file limit`);
}
if (errors.length > 0) await failWithErrors(errors);

for (const jsonPath of packageFiles.filter((entry) => entry.toLowerCase().endsWith(".json"))) {
  try {
    const source = utf8Decoder.decode(fs.readFileSync(jsonPath));
    parseBoundedLosslessJson(source);
  } catch {
    errors.push(`${relative(jsonPath)}: must be bounded duplicate-free UTF-8 JSON`);
  }
}
if (errors.length > 0) await failWithErrors(errors);

const skill = read("SKILL.md");
const rawSkillLineCount = skill.split("\n").length;
let lineCount = rawSkillLineCount;
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
let parsedSkillFrontmatter = null;
if (!frontmatter) {
  errors.push("SKILL.md frontmatter is missing");
} else {
  const parsed = parseCanonicalYamlMapping(frontmatter[1], "SKILL.md frontmatter", {
    name: { type: "string", required: true },
    description: { type: "string", required: true },
    license: { type: "string" },
    metadata: {
      type: "mapping",
      fields: installedMode
        ? {
            "github-path": { type: "provenance-string" },
            "github-pinned": { type: "provenance-string" },
            "github-ref": { type: "provenance-string" },
            "github-repo": { type: "provenance-string" },
            "github-tree-sha": { type: "provenance-string" },
            "local-path": { type: "provenance-string" }
          }
        : {
            "short-description": { type: "string" }
          }
    }
  }, {
    childIndentation: installedMode ? 4 : 2
  });
  parsedSkillFrontmatter = parsed;
  errors.push(...parsed.errors);
  if (parsed.errors.length === 0) {
    // gh skill adds installer provenance to frontmatter. Keep the instruction
    // budget identical before and after installation instead of charging those
    // trusted metadata lines against the portable skill body.
    if (installedMode && Object.hasOwn(parsed.value, "metadata")) {
      lineCount -= Object.keys(parsed.value.metadata).length + 1;
    }
    const packageName = path.basename(skillRoot);
    const declaredName = parsed.value.name;
    if (declaredName !== packageName) errors.push(`SKILL.md name must match the package directory: expected ${packageName}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(declaredName) || declaredName.length > 64) {
      errors.push("SKILL.md frontmatter: name must be 1-64 characters of lowercase letters, digits and single hyphens");
    }
    if (parsed.value.description.length > 1024 || /[<>]/.test(parsed.value.description)) {
      errors.push("SKILL.md frontmatter: description must be at most 1024 characters and may not contain angle brackets");
    }
    if (installedMode && Object.hasOwn(parsed.value, "metadata")) {
      errors.push(...validateInstalledProvenance(parsed.value.metadata, declaredName));
    }
  }
}
if (lineCount > 500) errors.push(`SKILL.md has ${lineCount} instruction lines; keep the portable instructions below 500`);

for (const textPath of packageFiles.filter((entry) => /\.(?:json|md|mjs|js|ts|sol|toml|txt|ya?ml|sh)$/i.test(entry))) {
  const source = fs.readFileSync(textPath, "utf8");
  const portableSource = installedMode && relative(textPath) === "SKILL.md"
    ? redactInstalledLocalPathForPortableScan(source, parsedSkillFrontmatter)
    : source;
  const localFileScheme = ["file", "://"].join("");
  const macHome = ["", "Users", "[A-Za-z0-9._-]+", ""].join("/");
  const linuxHome = ["", "home", "[A-Za-z0-9._-]+", ""].join("/");
  const windowsHome = ["[A-Za-z]:", "Users", "[^\\\\\\s]+", ""].join("\\\\");
  const localPathPatterns = [
    new RegExp(macHome),
    new RegExp(linuxHome),
    new RegExp(windowsHome)
  ];
  if (portableSource.includes(localFileScheme) || localPathPatterns.some((pattern) => pattern.test(portableSource))) {
    errors.push(`${relative(textPath)}: portable package contains a local filesystem path`);
  }
}

const interfaceConfig = read("agents/openai.yaml");
const parsedInterface = parseCanonicalYamlMapping(interfaceConfig, "agents/openai.yaml", {
  interface: {
    type: "mapping",
    required: true,
    fields: {
      display_name: { type: "quoted-string", required: true },
      short_description: { type: "quoted-string", required: true },
      icon_small: { type: "quoted-string" },
      icon_large: { type: "quoted-string" },
      brand_color: { type: "quoted-string" },
      default_prompt: { type: "quoted-string", required: true }
    }
  }
});
errors.push(...parsedInterface.errors);
if (parsedInterface.errors.length === 0) {
  const interfaceValues = parsedInterface.value.interface;
  if (!interfaceValues.default_prompt.includes("$programmable-v4-hook-builder")) {
    errors.push("agents/openai.yaml: default_prompt must invoke $programmable-v4-hook-builder");
  }
  if (interfaceValues.short_description.length < 25 || interfaceValues.short_description.length > 64) {
    errors.push("agents/openai.yaml: short_description must be 25-64 characters");
  }
}

const markdownAnchors = new Map();
for (const markdownPath of packageFiles.filter((entry) => entry.endsWith(".md"))) {
  const source = fs.readFileSync(markdownPath, "utf8");
  for (const match of source.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (!target || /^https?:\/\//.test(target) || target.startsWith("mailto:")) continue;
    const [targetPath, rawFragment = ""] = target.split("#", 2);
    const pathOnly = decodeURIComponent(targetPath.split("?", 1)[0]);
    const absolute = pathOnly === "" ? markdownPath : path.resolve(path.dirname(markdownPath), pathOnly);
    if (!isInside(skillRoot, absolute) || !packageEntriesByPath.has(relative(absolute))) {
      errors.push(`${relative(markdownPath)}: missing or escaping link ${target}`);
      continue;
    }
    if (rawFragment && absolute.endsWith(".md")) {
      const expectedAnchor = decodeURIComponent(rawFragment).toLowerCase();
      const anchors = markdownAnchors.get(absolute) ?? markdownHeadingAnchors(fs.readFileSync(absolute, "utf8"));
      markdownAnchors.set(absolute, anchors);
      if (!anchors.has(expectedAnchor)) {
        errors.push(`${relative(markdownPath)}: missing Markdown anchor ${target}`);
      }
    }
  }
}

try {
  const candidateSchema = JSON.parse(read("references/submission.schema.json"));
  const schema = untrustedDataMode
    ? JSON.parse(fs.readFileSync(path.join(canonicalSkillRoot, "references", "submission.schema.json"), "utf8"))
    : candidateSchema;
  const example = JSON.parse(read("assets/templates/submission.example.json"));
  const schemaFindings = validateAgainstSchema(example, schema);
  for (const finding of schemaFindings) errors.push(`template ${finding.path}: ${finding.message}`);
  const legacyNoHookExample = JSON.parse(read("assets/templates/no-hook-architecture.example.json"));
  const legacyNoHookSubmission = structuredClone(example);
  legacyNoHookSubmission.noHookArchitecture = legacyNoHookExample;
  const legacyNoHookFindings = validateAgainstSchema(legacyNoHookSubmission, schema);
  for (const finding of legacyNoHookFindings) errors.push(`legacy no-hook template ${finding.path}: ${finding.message}`);
  const tokenMechanicsExample = JSON.parse(read("assets/templates/token-mechanics.example.json"));
  const tokenMechanicsSubmission = structuredClone(example);
  tokenMechanicsSubmission.tokenMechanics = tokenMechanicsExample;
  const tokenMechanicsFindings = validateAgainstSchema(tokenMechanicsSubmission, schema);
  for (const finding of tokenMechanicsFindings) errors.push(`token mechanics template ${finding.path}: ${finding.message}`);
} catch (error) {
  errors.push(`schema or template JSON: ${error.message}`);
}

try {
  const runtimeSchema = JSON.parse(read("references/runtime-assets-v1.schema.json"));
  const runtimeExample = JSON.parse(read("assets/templates/runtime-assets.example.json"));
  const runtimeFindings = validateAgainstSchema(runtimeExample, runtimeSchema);
  for (const finding of runtimeFindings) errors.push(`runtime asset template ${finding.path}: ${finding.message}`);
} catch (error) {
  errors.push(`runtime asset schema or template JSON: ${error.message}`);
}

try {
  const candidateLaunchSchema = JSON.parse(read("references/launch-bundle-input-v1.schema.json"));
  const launchSchema = untrustedDataMode
    ? JSON.parse(fs.readFileSync(path.join(canonicalSkillRoot, "references", "launch-bundle-input-v1.schema.json"), "utf8"))
    : candidateLaunchSchema;
  const launchExample = JSON.parse(read("assets/templates/launch-bundle-input.example.json"));
  const launchFindings = validateAgainstSchema(launchExample, launchSchema);
  for (const finding of launchFindings) errors.push(`launch-bundle template ${finding.path}: ${finding.message}`);
} catch (error) {
  errors.push(`launch-bundle schema or template JSON: ${error.message}`);
}

try {
  const launchOutputSchema = JSON.parse(read("references/launch-bundle-output-v1.schema.json"));
  if (launchOutputSchema.$id !== "urn:programmable:launch-bundle-output:1.0.0") {
    errors.push("launch-bundle output schema: unexpected $id");
  }
} catch (error) {
  errors.push(`launch-bundle output schema JSON: ${error.message}`);
}

validateStarterCatalogClosure(errors, packageContext);
validateTemplateCatalogHistory(errors, packageContext);
validateKnowledgeRoutingClosure(errors, packageContext);
validateLocalModuleClosure(errors, packageContext);

try {
  const sources = JSON.parse(read("references/upstream-sources.json"));
  scanPins(sources, "$", errors);
} catch (error) {
  errors.push(`upstream-sources.json: ${error.message}`);
}

try {
  const sourceBytes = fs.readFileSync(path.join(skillRoot, "references/upstream-sources.json"));
  const sources = JSON.parse(utf8Decoder.decode(sourceBytes));
  const receipt = JSON.parse(read("references/upstream-reviewed-drift-v1.json"));
  const receiptSchema = JSON.parse(read("references/upstream-reviewed-drift-v1.schema.json"));
  if (receiptSchema.$id !== "urn:programmable:upstream-reviewed-drift:1.0.0") {
    errors.push("upstream-reviewed-drift-v1.schema.json: unexpected $id");
  }
  const availablePaths = new Set(packageEntries.filter((entry) => entry.stat.isFile()).map((entry) => relative(entry.path)));
  validateReviewedDriftReceipt(receipt, sources, { sourceBytes, availablePaths });
} catch (error) {
  errors.push(`upstream-reviewed-drift-v1.json: ${error.message}`);
}

try {
  const deploymentSnapshot = JSON.parse(read("references/deployment-snapshot.json"));
  scanPins(deploymentSnapshot.source, "$.deploymentSnapshot.source", errors);
  const ids = new Set();
  for (const record of deploymentSnapshot.records ?? []) {
    if (ids.has(record.id)) errors.push(`deployment-snapshot.json: duplicate record id ${record.id}`);
    ids.add(record.id);
  }
} catch (error) {
  errors.push(`deployment-snapshot.json: ${error.message}`);
}

await validateScriptsAndTests({
  errors,
  installedMode,
  relative,
  skillRoot,
  untrustedDataMode,
  walk
});

if (errors.length > 0) {
  await failWithErrors(errors);
}

if (untrustedDataMode) {
  console.log(`Validated candidate skill structure, schema, links, Git pin shapes and script syntax without executing candidate scripts or tests; SKILL.md has ${lineCount} lines.`);
} else {
  console.log(`Validated portable skill structure, schema, links, Git pin shapes, deterministic CLI checks${installedMode ? "" : " and repository fixture tests"} and ${lineCount}-line SKILL.md.`);
}

async function failWithErrors(messages) {
  const output = `${[...new Set(messages)].sort().map((error) => `- ${error}`).join("\n")}\n`;
  await new Promise((resolve, reject) => {
    process.stderr.write(output, (error) => error ? reject(error) : resolve());
  });
  process.exit(1);
}
