import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { assertProgrammableLaunchTagRuleset } from "../verify-programmable-launch-tag-ruleset.mjs";

const workflowPath = new URL(
  "../../.github/workflows/release-programmable-launch.yml",
  import.meta.url,
);
const source = readFileSync(workflowPath, "utf8");
const immutablePreflightSource = readFileSync(new URL(
  "../verify-immutable-release-owner-preflight.mjs",
  import.meta.url,
), "utf8");
const immutablePreflightCaptureSource = readFileSync(new URL(
  "../capture-immutable-release-owner-preflight.mjs",
  import.meta.url,
), "utf8");
const immutablePreflightAllowedSigners = readFileSync(new URL(
  "../../.github/release-trust/programmable-launch-immutable-release-owner.allowed_signers",
  import.meta.url,
), "utf8");
const robinhoodCaptureWorkflowPath = new URL(
  "../../.github/workflows/capture-robinhood-custom-launch-postdeployment.yml",
  import.meta.url,
);
const robinhoodPromotionWorkflowPath = new URL(
  "../../.github/workflows/finalize-robinhood-custom-launch-promotion.yml",
  import.meta.url,
);
const robinhoodCaptureSource = readFileSync(robinhoodCaptureWorkflowPath, "utf8");
const robinhoodPromotionSource = readFileSync(robinhoodPromotionWorkflowPath, "utf8");
const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const cleanCheckoutAssertion = "test -z \"$(git status --porcelain=v1 --untracked-files=all)\"";

function replaceLast(value, search, replacement) {
  const index = value.lastIndexOf(search);
  assert.notEqual(index, -1, `missing mutation target: ${search}`);
  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`;
}

function failures(value) {
  const implementation = [
    value,
    immutablePreflightSource,
    immutablePreflightCaptureSource,
    immutablePreflightAllowedSigners,
  ].join("\n");
  const required = [
    "github.repository_id == 1314365508",
    "github.ref == 'refs/heads/production'",
    "github.ref_protected == true",
    "github.actor == 'hazarxyz'",
    "github.actor_id == '258789013'",
    "github.triggering_actor == 'hazarxyz'",
    "github.run_attempt == 1",
    "github.event.sender.login == 'hazarxyz'",
    "github.event.sender.id == 258789013",
    "environment: production",
    "actions: read",
    "artifact-metadata: write",
    "attestations: write",
    "contents: write",
    "id-token: write",
    "runs-on: ubuntu-24.04",
    "persist-credentials: false",
    "fetch-depth: 0",
    "+refs/heads/production:refs/remotes/origin/production",
    "*Username*) printf '%s\\n' 'x-access-token' ;;",
    "*Password*) printf '%s\\n' \"$GH_TOKEN\" ;;",
    "GIT_ASKPASS=\"$askpass\" GIT_TERMINAL_PROMPT=0 git fetch",
    "test \"$(git rev-parse refs/remotes/origin/production^{commit})\" = \"$GITHUB_SHA\"",
    "test \"$GITHUB_WORKFLOW_SHA\" = \"$GITHUB_SHA\"",
    "test \"$GITHUB_WORKFLOW_REF\" = \"$GITHUB_REPOSITORY/.github/workflows/release-programmable-launch.yml@$GITHUB_REF\"",
    "test -z \"$(git symbolic-ref -q HEAD || true)\"",
    "test \"$(git remote get-url origin)\" = \"https://github.com/$GITHUB_REPOSITORY\"",
    "test -z \"$(git status --porcelain=v1 --untracked-files=all)\"",
    "node-version: 24.14.0",
    "mktemp -d \"$RUNNER_TEMP/cosign-v3.1.3.XXXXXX\"",
    "curl --proto '=https' --tlsv1.2",
    "https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64",
    "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71",
    "sha256sum --check --strict",
    "PROGRAMMABLE_COSIGN_BIN=$cosign",
    "npm@11.16.0",
    "npm install --global npm@11.16.0 --ignore-scripts --no-audit --no-fund",
    "pkg.packageManager !== \"npm@11.16.0\"",
    "Install exact root dependency closure",
    "node scripts/production-verify-proof.mjs resolve",
    "--verification-mode change",
    "digest-mismatch: error",
    "gh attestation verify \"$proof\"",
    "--source-digest \"$GITHUB_SHA\"",
    "node scripts/production-verify-proof.mjs verify",
    "https://api.github.com/repos/$GITHUB_REPOSITORY/rulesets",
    "--header \"Authorization: Bearer $GH_TOKEN\"",
    "X-GitHub-Api-Version: 2026-03-10",
    "Protect Programmable Launch CLI release tags",
    "21679403",
    "node scripts/verify-programmable-launch-tag-ruleset.mjs \"$rulesets\"",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm test",
    "npm run verify:machine-contracts",
    "npm run pack:dry-run",
    "node scripts/programmable-launch-v4-release-binding.mjs verify-release-ready",
    "npm run release:custom-launch:v4:clean-room:test",
    "PROGRAMMABLE_PRODUCTION_VERIFY_PROOF: ${{ runner.temp }}/production-verify-proof/production-verify-proof.json",
    "PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION: ${{ github.workspace }}/release/robinhood-chain-4663/${{ (inputs.version == '4.1.0' || inputs.version == '4.1.1') && 'v4.1/' || '' }}programmable-backend-authorization.json",
    "startsWith(inputs.version, '4.')",
    'finalizer="contracts/scripts/finalize-robinhood-custom-launch-deployment.mjs"',
    'finalizer="contracts/scripts/finalize-robinhood-custom-launch-v41-deployment.mjs"',
    'promotion_evidence="$evidence/v4.1"',
    'node scripts/programmable-launch-v41-release-binding.mjs verify-release-ready',
    'node scripts/programmable-launch-v411-release-binding.mjs verify-release-ready',
    '*) echo "Unsupported V4 release version" >&2; exit 1 ;;',

    "node scripts/programmable-launch-release-assets.mjs build",
    "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
    "Freshly revalidate exact V4 Phase B immediately before mutation",
    "ROBINHOOD_MAINNET_RPC_URL_PRIMARY: ${{ secrets.ROBINHOOD_MAINNET_RPC_URL_PRIMARY }}",
    "ROBINHOOD_MAINNET_RPC_URL_SECONDARY: ${{ secrets.ROBINHOOD_MAINNET_RPC_URL_SECONDARY }}",
    "ETHEREUM_MAINNET_RPC_URL_PRIMARY: ${{ secrets.ETHEREUM_MAINNET_RPC_URL_PRIMARY }}",
    "ETHEREUM_MAINNET_RPC_URL_SECONDARY: ${{ secrets.ETHEREUM_MAINNET_RPC_URL_SECONDARY }}",
    "FLY_API_TOKEN: ${{ secrets.PROGRAMMABLE_CUSTOM_LAUNCH_API_FLY_READ_TOKEN }}",
    "test -n \"$ROBINHOOD_MAINNET_RPC_URL_PRIMARY\"",
    "test -n \"$ROBINHOOD_MAINNET_RPC_URL_SECONDARY\"",
    "test -n \"$ETHEREUM_MAINNET_RPC_URL_PRIMARY\"",
    "test -n \"$ETHEREUM_MAINNET_RPC_URL_SECONDARY\"",
    "test -n \"$FLY_API_TOKEN\"",
    "node \"$finalizer\" apply",
    "--bundle \"$promotion_evidence/programmable-promotion-bundle.json\"",
    "--stage \"$evidence/programmable-stage-bundle.json\"",
    "--capture \"$evidence/programmable-postdeployment-capture.json\"",
    "--backend-input \"$promotion_evidence/backend-promotion-input.public.json\"",
    "--backend-attestation-bundle \"$promotion_evidence/backend-promotion-input.attestation.json\"",
    "--backend-authorization \"$promotion_evidence/programmable-backend-authorization.json\"",
    "--backend-authorization-attestation-bundle \"$promotion_evidence/programmable-backend-authorization.attestation.json\"",
    "--capture-attestation-bundle \"$evidence/programmable-postdeployment-capture.attestation.json\"",
    "--stage-attestation-bundle \"$evidence/programmable-stage-bundle.attestation.json\"",
    "--source-verify-proof \"$evidence/production-verify-proof.json\"",
    "--source-verify-attestation-bundle \"$evidence/production-verify-proof.attestation.json\"",
    "--source-verify-run-id \"$run_id\"",
    "--source-verify-run-attempt \"$run_attempt\"",
    "--source-verify-artifact-id \"$artifact_id\"",
    "--source-verify-artifact-digest \"$artifact_digest\"",
    "test \"$(jq -er '.command' \"$result\")\" = \"apply\"",
    "test \"$(jq -er '.releaseReady' \"$result\")\" = \"true\"",
    "test \"$(jq -er '.publicAuthorization' \"$result\")\" = \"true\"",
    "test \"$(jq -er '.publicWrites' \"$result\")\" = \"true\"",
    "test \"$(jq -er '.wroteLiveArtifacts' \"$result\")\" = \"false\"",
    "test \"$(jq -er '.preparedArtifactPreserved' \"$result\")\" = \"true\"",
    "test \"$(jq -er '.replayed' \"$result\")\" = \"false\"",
    ".promotionBundleDigest | select(test(\"^sha256:[0-9a-f]{64}$\"))",
    ".freshProviderReadbackDigest | select(test(\"^sha256:[0-9a-f]{64}$\"))",
    ".freshSourceVerificationClosureDigest | select(test(\"^sha256:[0-9a-f]{64}$\"))",
    ".freshBackendReadbackDigest | select(test(\"^sha256:[0-9a-f]{64}$\"))",
    ".freshObservedAt | select(test(\"^[0-9]{4}-[0-9]{2}-[0-9]{2}T",
    "test \"$phase_b_digest\" = \"$expected_phase_b_digest\"",
    "Atomically create exact tag ref and immutable GitHub Release",
    "--arg ref \"refs/tags/$TAG\"",
    "--arg sha \"$GITHUB_SHA\"",
    "--request POST",
    "https://api.github.com/repos/$GITHUB_REPOSITORY/git/refs",
    "if [ \"$tag_status\" = \"422\" ]",
    "test \"$tag_status\" = \"201\"",
    "test \"$(jq -er '.object.type' \"$tag_response\")\" = \"commit\"",
    "test \"$(jq -er '.object.sha' \"$tag_response\")\" = \"$GITHUB_SHA\"",
    "repos/$GITHUB_REPOSITORY/git/ref/tags/$TAG",
    "gh release create \"$TAG\"",
    "--verify-tag",
    "--notes-file \"$notes\"",
    "isImmutable",
    "gh release download \"$TAG\"",
    "gh release verify \"$TAG\"",
    "gh release verify-asset \"$TAG\"",
    "node scripts/programmable-launch-release-assets.mjs verify",
    "Reconfirm protected production tip immediately before publication",
    "Reconfirm protected production tip at completion",
    "--header \"Accept: application/vnd.github+json\"",
    "--header \"X-GitHub-Api-Version: 2026-03-10\"",
    "repos/$GITHUB_REPOSITORY/git/ref/heads/production",
    "PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64",
    "PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64",
    "test -n \"$IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64\"",
    "test -n \"$IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64\"",
    "node scripts/verify-immutable-release-owner-preflight.mjs",
    "--record-base64 \"$IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64\"",
    "--signature-base64 \"$IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64\"",
    "--allowed-signers \"$GITHUB_WORKSPACE/.github/release-trust/programmable-launch-immutable-release-owner.allowed_signers\"",
    "--repository \"$GITHUB_REPOSITORY\"",
    "--repository-id \"1314365508\"",
    "--revision \"$GITHUB_SHA\"",
    "--environment \"production\"",
    "--actor-id \"$GITHUB_ACTOR_ID\"",
    "--actor-login \"$GITHUB_ACTOR\"",
    "programmable.github-immutable-release-owner-preflight.v3",
    "258789013+hazarxyz@users.noreply.github.com",
    "SHA256:RTXVJ3XspKUc+Qmj/daOWwU2WyT+qbRBtsJJwNpItdI",
    "immutable-release-preflight@programmable.xyz",
    "namespaces=\"immutable-release-preflight@programmable.xyz\" ssh-ed25519",
    "spawnSync(SSH_KEYGEN",
    "\"-Y\",\n      \"verify\"",
    "recordBytes.at(-1) !== 0x0a",
    "canonicalImmutableReleaseOwnerPreflightBytes(value).equals(recordBytes)",
    "responseValue.enforced_by_owner",
    "owner preflight capture is forbidden inside GitHub Actions",
    "ghJson(\"/user\"",
    "git/ref/heads/production",
    "immutable-releases",
    "\"-Y\",\n    \"sign\"",
    "https://api.github.com/repos/${repository}/immutable-releases",
    "nowMilliseconds - observedAtMilliseconds > MAXIMUM_AGE_MS",
    "Verify owner-authenticated immutable-release preflight",
  ];
  const missing = required.filter((item) => !implementation.includes(item));
  const freshStep = value.split("      - name: Freshly revalidate exact V4 Phase B immediately before mutation")[1]
    ?.split("      - name:")[0] ?? "";
  const freshLines = new Set(freshStep.split("\n").map(line => line.trim()));
  for (const requiredInput of [
    "PROGRAMMABLE_PRODUCTION_VERIFY_PROOF: ${{ runner.temp }}/production-verify-proof/production-verify-proof.json",
    "PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION: ${{ github.workspace }}/release/robinhood-chain-4663/${{ (inputs.version == '4.1.0' || inputs.version == '4.1.1') && 'v4.1/' || '' }}programmable-backend-authorization.json",
    'test -f "$PROGRAMMABLE_PRODUCTION_VERIFY_PROOF"',
    'test -f "$PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION"',
  ]) {
    if (!freshLines.has(requiredInput)) missing.push(`fresh apply must receive ${requiredInput}`);
  }
  const downloadStep = value.split("      - name: Fresh-download and verify the published release")[1]
    ?.split("      - name:")[0] ?? "";
  const downloadLines = new Set(downloadStep.split("\n").map(line => line.trim()));
  for (const requiredInput of [
    "PROGRAMMABLE_PRODUCTION_VERIFY_PROOF: ${{ runner.temp }}/production-verify-proof/production-verify-proof.json",
    "PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION: ${{ github.workspace }}/release/robinhood-chain-4663/${{ (inputs.version == '4.1.0' || inputs.version == '4.1.1') && 'v4.1/' || '' }}programmable-backend-authorization.json",
  ]) {
    if (!downloadLines.has(requiredInput)) missing.push(`download verification must receive ${requiredInput}`);
  }
  if (value.split("node scripts/verify-immutable-release-owner-preflight.mjs").length - 1 !== 2) {
    missing.push("immutable preflight must be verified exactly twice");
  }
  for (const item of [
    "PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64",
    "PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64",
    'test -n "$IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64"',
    'test -n "$IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64"',
    "--allowed-signers \"$GITHUB_WORKSPACE/.github/release-trust/programmable-launch-immutable-release-owner.allowed_signers\"",
  ]) {
    const expectedCount = item.startsWith("PROGRAMMABLE_") ? 3 : 2;
    if (value.split(item).length - 1 !== expectedCount) {
      missing.push(`${item} must appear in all required owner preflight checks`);
    }
  }
  if (value.split('node scripts/verify-programmable-launch-tag-ruleset.mjs "$rulesets" --owner-preflight').length - 1 !== 2) {
    missing.push("owner-bound tag protection must be verified before build and publication");
  }
  return missing;
}

test("CLI release workflow closes source, test, provenance, and immutability gates", () => {
  assert.deepEqual(failures(source), []);
  assert.equal(rootPackage.packageManager, "npm@11.16.0");
  assert.equal(source.includes("npm publish"), false);
  assert.equal(source.includes("--clobber"), false);
  assert.equal(source.includes("pull_request"), false);
  assert.equal(source.includes("push:\n"), false);
  assert.equal(source.includes("--record \"$IMMUTABLE_RELEASES_PREFLIGHT\""), false);
  assert.equal(source.includes("capture-immutable-release-owner-preflight.mjs"), false);
  assert.equal(source.includes("ssh-keygen -Y sign"), false);
  assert.equal(source.includes("--target"), false);
  assert.equal(source.includes("git tag"), false);
  assert.equal(source.includes("DELETE /git/refs"), false);
  const rulesetGate = source.slice(
    source.indexOf("Require protected CLI tags and a fresh release identity"),
    source.indexOf("Install exact runtime dependency closure"),
  );
  assert.equal(
    rulesetGate.split("--header \"Authorization: Bearer $GH_TOKEN\"").length - 1,
    2,
    "both ruleset requests must be authenticated",
  );
  assert.equal(
    source.split("npm ci --ignore-scripts --no-audit --no-fund").length - 1,
    2,
    "root verifier and packaged CLI dependencies must both be installed",
  );
  assert.ok(
    source.indexOf("Verify owner-authenticated immutable-release preflight")
      < source.indexOf("Install exact root dependency closure"),
    "immutable-release preflight must run before dependency installation",
  );
  assert.ok(
    source.indexOf("Verify owner-authenticated immutable-release preflight")
      < source.indexOf("Build and self-verify deterministic release assets"),
    "immutable-release preflight must run before release asset construction",
  );
  assert.ok(
    source.lastIndexOf("node scripts/verify-immutable-release-owner-preflight.mjs")
      > source.indexOf("Reconfirm protected production tip immediately before publication"),
    "immutable-release preflight must be revalidated immediately before publication",
  );
  assert.ok(
    source.lastIndexOf("node scripts/verify-immutable-release-owner-preflight.mjs")
      < source.indexOf("Freshly revalidate exact V4 Phase B immediately before mutation"),
    "immutable-release preflight revalidation must precede release creation",
  );
  assert.ok(
    source.indexOf("Freshly revalidate exact V4 Phase B immediately before mutation")
      < source.indexOf("Atomically create exact tag ref and immutable GitHub Release"),
    "fresh Phase B apply must immediately precede the first external mutation",
  );
  assert.ok(
    source.indexOf("--request POST") < source.indexOf("gh release create \"$TAG\""),
    "the exact immutable tag ref must exist before release creation",
  );
  assert.ok(
    source.indexOf("Install exact root dependency closure")
      < source.indexOf("Require exact V4 policy, profile, deployment, and machine-contract binding"),
    "root dependencies must be installed before the V4 release-ready verifier",
  );
});

test("4.1.1 dispatch selects its client binding and preserves the active 4.1 API gates", () => {
  const cases = [...source.matchAll(/case "\$EXPECTED_VERSION" in[\s\S]*?\n\s*esac/g)].map(match => match[0]);
  assert.equal(cases.length, 3);
  function runSelection(value, version) {
    return spawnSync("bash", ["-c", [
      "set -euo pipefail",
      'node() { printf "node %s\\n" "$*"; }',
      'npm() { printf "npm %s\\n" "$*"; }',
      value,
      'printf "backend=%s\\nfinalizer=%s\\nevidence=%s\\n" "${PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION-}" "${finalizer-}" "${promotion_evidence-}"',
    ].join("\n")], { encoding: "utf8", env: { PATH: process.env.PATH,
      EXPECTED_VERSION: version, GITHUB_WORKSPACE: "/fixture", evidence: "/fixture/evidence" } });
  }
  const selected = cases.map(value => runSelection(value, "4.1.1"));
  for (const result of selected) assert.equal(result.status, 0, result.stderr);
  assert.match(selected[0].stdout, /node scripts\/programmable-launch-v411-release-binding\.mjs verify-release-ready/);
  assert.match(selected[0].stdout, /backend=\/fixture\/release\/robinhood-chain-4663\/v4\.1\/programmable-backend-authorization\.json/);
  const priorTests = runSelection(cases[1], "4.1.0").stdout.split("\n")[0].split(" ").slice(2);
  for (const relative of priorTests) assert.ok(selected[1].stdout.split(" ").includes(relative), relative);
  assert.match(selected[1].stdout, /scripts\/test\/programmable-launch-v411-release-binding\.test\.mjs/);
  assert.match(selected[2].stdout, /finalizer=contracts\/scripts\/finalize-robinhood-custom-launch-v41-deployment\.mjs/);
  assert.match(selected[2].stdout, /evidence=\/fixture\/evidence\/v4\.1/);
  for (const version of ["4.1.2", "4.2.0", "4.1.1-preview"]) {
    for (const value of cases) assert.notEqual(runSelection(value, version).status, 0, version);
  }
});

test("release workflow contract mutations fail closed", () => {
  const freshStart = source.indexOf("      - name: Freshly revalidate exact V4 Phase B immediately before mutation");
  const downloadStart = source.indexOf("      - name: Fresh-download and verify the published release");
  const mutations = [
    ...["PROGRAMMABLE_PRODUCTION_VERIFY_PROOF", "PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION"].map(name =>
      source.slice(0, downloadStart) + source.slice(downloadStart).replace(new RegExp(`^          ${name}: .*\\n`, "m"), "")),
    ...["PROGRAMMABLE_PRODUCTION_VERIFY_PROOF", "PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION"].map(name =>
      source.slice(0, freshStart) + source.slice(freshStart).replace(new RegExp(`^          ${name}: .*\\n`, "m"), "")),
    source.replace("github.ref == 'refs/heads/production'", "true"),
    source.replace("github.ref_protected == true", "true"),
    source.replace("github.actor == 'hazarxyz'", "true"),
    source.replace("github.actor_id == '258789013'", "true"),
    source.replace("github.triggering_actor == 'hazarxyz'", "true"),
    source.replace("github.run_attempt == 1", "true"),
    source.replace("github.event.sender.login == 'hazarxyz'", "true"),
    source.replace("github.event.sender.id == 258789013", "true"),
    source.replace("persist-credentials: false", "persist-credentials: true"),
    source.replace("runs-on: ubuntu-24.04", "runs-on: ubuntu-latest"),
    source.replace("+refs/heads/production:refs/remotes/origin/production", "+refs/heads/production:refs/heads/production"),
    source.replace("GIT_ASKPASS=\"$askpass\" GIT_TERMINAL_PROMPT=0 git fetch", "git fetch"),
    source.replace(
      "*Password*) printf '%s\\n' \"$GH_TOKEN\" ;;",
      "*Password*) printf '%s\\n' anonymous ;;",
    ),
    source.replaceAll("npm@11.16.0", "npm@latest"),
    source.replace("Install exact root dependency closure", "Skip root dependencies"),
    source.replaceAll("--verification-mode change", "--verification-mode custom-v2-release"),
    source.replace("digest-mismatch: error", "digest-mismatch: warn"),
    source.replaceAll("--source-digest \"$GITHUB_SHA\"", ""),
    source.replaceAll("--header \"Authorization: Bearer $GH_TOKEN\"", ""),
    source.replaceAll("https://api.github.com/repos/$GITHUB_REPOSITORY/rulesets", "https://example.invalid"),
    source.replace("Protect Programmable Launch CLI release tags", "missing"),
    source.replace("node scripts/verify-programmable-launch-tag-ruleset.mjs \"$rulesets\"", "echo unchecked"),
    source.replace("npm test", "echo skipped"),
    source.replace('finalizer="contracts/scripts/finalize-robinhood-custom-launch-v41-deployment.mjs"', 'finalizer="untrusted.mjs"'),
    source.replace('node scripts/programmable-launch-v41-release-binding.mjs verify-release-ready', 'echo unbound-successor'),
    source.replace('node scripts/programmable-launch-v411-release-binding.mjs verify-release-ready', 'echo unbound-client-patch'),
    source.replace('promotion_evidence="$evidence/v4.1"', 'promotion_evidence="$evidence"'),
    source.replace("node scripts/programmable-launch-v4-release-binding.mjs verify-release-ready", "echo unbound"),
    source.replace("npm run release:custom-launch:v4:clean-room:test", "echo skipped-clean-room-contract"),
    source.replaceAll(
      "PROGRAMMABLE_ROBINHOOD_BACKEND_AUTHORIZATION: ${{ github.workspace }}/release/robinhood-chain-4663/${{ (inputs.version == '4.1.0' || inputs.version == '4.1.1') && 'v4.1/' || '' }}programmable-backend-authorization.json",
      "",
    ),
    source.replace("node scripts/programmable-launch-release-assets.mjs build", "echo fabricated"),
    source.replace("actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26", "actions/attest@main"),
    source.replace(
      "FLY_API_TOKEN: ${{ secrets.PROGRAMMABLE_CUSTOM_LAUNCH_API_FLY_READ_TOKEN }}",
      "FLY_API_TOKEN: missing",
    ),
    source.replace(
      'node "$finalizer" apply',
      "echo skipped-fresh-apply",
    ),
    source.replace("test \"$(jq -er '.releaseReady' \"$result\")\" = \"true\"", "true"),
    source.replace("test \"$(jq -er '.publicAuthorization' \"$result\")\" = \"true\"", "true"),
    source.replace("test \"$(jq -er '.publicWrites' \"$result\")\" = \"true\"", "true"),
    source.replace("test \"$(jq -er '.wroteLiveArtifacts' \"$result\")\" = \"false\"", "true"),
    source.replace("test \"$phase_b_digest\" = \"$expected_phase_b_digest\"", "true"),
    source.replace("--request POST", "--request PATCH"),
    source.replace("if [ \"$tag_status\" = \"422\" ]", "if false; then"),
    source.replace("test \"$tag_status\" = \"201\"", "true"),
    source.replace("--verify-tag", ""),
    source.replace("gh release verify-asset \"$TAG\"", "echo trusted"),
    source.replaceAll("--header \"X-GitHub-Api-Version: 2026-03-10\"", ""),
    source.replaceAll(
      "PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64",
      "UNTRUSTED_PREFLIGHT_RECORD_BASE64",
    ),
    source.replaceAll(
      "PROGRAMMABLE_IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64",
      "UNTRUSTED_PREFLIGHT_SIGNATURE_BASE64",
    ),
    source.replaceAll('test -n "$IMMUTABLE_RELEASES_PREFLIGHT_RECORD_BASE64"', "true"),
    source.replaceAll('test -n "$IMMUTABLE_RELEASES_PREFLIGHT_SIGNATURE_BASE64"', "true"),
    source.replaceAll(
      '--allowed-signers "$GITHUB_WORKSPACE/.github/release-trust/programmable-launch-immutable-release-owner.allowed_signers"',
      '--allowed-signers "$RUNNER_TEMP/untrusted"',
    ),
    source.replaceAll('--actor-id "$GITHUB_ACTOR_ID"', '--actor-id "0"'),
    source.replaceAll('--actor-login "$GITHUB_ACTOR"', '--actor-login "someone-else"'),
    source.replaceAll("--owner-preflight", ""),
    source.replaceAll('--repository-id "1314365508"', '--repository-id "0"'),
    replaceLast(
      source,
      "node scripts/verify-immutable-release-owner-preflight.mjs",
      "echo skipped-immutable-preflight",
    ),
  ];
  for (const [index, mutation] of mutations.entries()) {
    assert.notDeepEqual(failures(mutation), [], `mutation ${index} escaped the gate`);
  }
});

function robinhoodCaptureFailures(value) {
  const required = [
    "github.repository_id == 1314365508",
    "github.ref == 'refs/heads/production'",
    "github.ref_protected == true",
    "environment: production",
    "actions: read",
    "artifact-metadata: write",
    "attestations: write",
    "contents: read",
    "id-token: write",
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    "persist-credentials: false",
    "fetch-depth: 0",
    "+refs/heads/production:refs/remotes/origin/production",
    "*Username*) printf '%s\\n' 'x-access-token' ;;",
    "*Password*) printf '%s\\n' \"$GH_TOKEN\" ;;",
    "GIT_ASKPASS=\"$askpass\" GIT_TERMINAL_PROMPT=0 git fetch",
    "test \"$(git rev-parse refs/remotes/origin/production^{commit})\" = \"$GITHUB_SHA\"",
    "test \"$GITHUB_WORKFLOW_SHA\" = \"$GITHUB_SHA\"",
    "test \"$GITHUB_WORKFLOW_REF\" = \"$GITHUB_REPOSITORY/.github/workflows/capture-robinhood-custom-launch-postdeployment.yml@$GITHUB_REF\"",
    "test -z \"$(git symbolic-ref -q HEAD || true)\"",
    "test \"$(git remote get-url origin)\" = \"https://github.com/$GITHUB_REPOSITORY\"",
    cleanCheckoutAssertion,
    "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
    "node-version: 24.14.0",
    "npm@11.16.0",
    "npm install --global npm@11.16.0 --ignore-scripts --no-audit --no-fund",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "Evidence #1: retain the historical protected Verify proof",
    "node scripts/production-verify-proof.mjs resolve",
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    "digest-mismatch: error",
    "gh attestation download \"$proof\"",
    "bundle_dir=\"$(mktemp -d \"$RUNNER_TEMP/production-verify-attestation.XXXXXX\")\"",
    "test \"${#bundle_files[@]}\" = \"1\"",
    "node scripts/production-verify-proof.mjs verify",
    "ROBINHOOD_MAINNET_RPC_URL_PRIMARY: ${{ secrets.ROBINHOOD_MAINNET_RPC_URL_PRIMARY }}",
    "ROBINHOOD_MAINNET_RPC_URL_SECONDARY: ${{ secrets.ROBINHOOD_MAINNET_RPC_URL_SECONDARY }}",
    "ETHEREUM_MAINNET_RPC_URL_PRIMARY: ${{ secrets.ETHEREUM_MAINNET_RPC_URL_PRIMARY }}",
    "ETHEREUM_MAINNET_RPC_URL_SECONDARY: ${{ secrets.ETHEREUM_MAINNET_RPC_URL_SECONDARY }}",
    "[[ \"$L1_POSTING_BLOCK\" =~ ^[1-9][0-9]*$ ]]",
    "node contracts/scripts/capture-robinhood-custom-launch-postdeployment.mjs capture",
    "--transaction-hash \"$DEPLOYMENT_TX_HASH\"",
    "--l1-posting-block \"$L1_POSTING_BLOCK\"",
    "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
    "steps.attest-capture.outputs.bundle-path",
    "steps.attest-stage.outputs.bundle-path",
    "cp -- \"$ACTION_BUNDLE_PATH\" \"$bundle\"",
    "cmp --silent -- \"$ACTION_BUNDLE_PATH\" \"$bundle\"",
    "finalize-robinhood-custom-launch-deployment.mjs assemble-stage",
    "--capture-attestation-bundle",
    "--source-verify-proof",
    "--source-verify-attestation-bundle",
    "--source-verify-run-id",
    "--source-verify-run-attempt",
    "--source-verify-artifact-id",
    "--source-verify-artifact-digest",
    "test \"$(jq -r '.releaseReady' \"$stage\")\" = \"false\"",
    "finalize-robinhood-custom-launch-deployment.mjs verify-stage",
    "--stage-attestation-bundle",
    "git diff --exit-code",
    "test \"$(find \"$evidence\" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')\" = \"7\"",
    "Reconfirm protected production tip at completion",
    "--header \"Accept: application/vnd.github+json\"",
    "--header \"X-GitHub-Api-Version: 2026-03-10\"",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "if-no-files-found: error",
    "compression-level: 0",
    "overwrite: false",
  ];
  const missing = required.filter((item) => !value.includes(item));
  if (value.split(cleanCheckoutAssertion).length - 1 !== 2) {
    missing.push("exactly two initial/final clean-checkout assertions");
  }
  if (value.split('--github-output "$GITHUB_OUTPUT"').length - 1 !== 2) {
    missing.push("resolve and verify GitHub output bindings");
  }
  return missing;
}

test("Robinhood Phase A workflow captures and attests an exact closed handoff", () => {
  assert.deepEqual(robinhoodCaptureFailures(robinhoodCaptureSource), []);
  assert.equal(robinhoodCaptureSource.includes("FLY_API_TOKEN"), false);
  assert.equal(robinhoodCaptureSource.includes("authorize-backend"), false);
  assert.equal(robinhoodCaptureSource.includes("finalized-live"), false);
  assert.equal(robinhoodCaptureSource.includes("pull_request"), false);
  assert.equal(robinhoodCaptureSource.includes("push:\n"), false);
});

test("Robinhood Phase A workflow contract mutations fail closed", () => {
  const mutations = [
    robinhoodCaptureSource.replace("github.ref == 'refs/heads/production'", "true"),
    robinhoodCaptureSource.replace("github.ref_protected == true", "true"),
    robinhoodCaptureSource.replace("persist-credentials: false", "persist-credentials: true"),
    robinhoodCaptureSource.replace(
      "GIT_ASKPASS=\"$askpass\" GIT_TERMINAL_PROMPT=0 git fetch",
      "git fetch",
    ),
    robinhoodCaptureSource.replace(
      "*Password*) printf '%s\\n' \"$GH_TOKEN\" ;;",
      "*Password*) printf '%s\\n' anonymous ;;",
    ),
    robinhoodCaptureSource.replace(cleanCheckoutAssertion, "true"),
    replaceLast(robinhoodCaptureSource, cleanCheckoutAssertion, "true"),
    robinhoodCaptureSource.replace("node-version: 24.14.0", "node-version: latest"),
    robinhoodCaptureSource.replace("gh attestation download \"$proof\"", "echo skipped"),
    robinhoodCaptureSource.replace("test \"${#bundle_files[@]}\" = \"1\"", "true"),
    replaceLast(
      robinhoodCaptureSource,
      '--github-output "$GITHUB_OUTPUT"',
      "--github-output missing",
    ),
    robinhoodCaptureSource.replaceAll("--header \"X-GitHub-Api-Version: 2026-03-10\"", ""),
    robinhoodCaptureSource.replace(
      "ROBINHOOD_MAINNET_RPC_URL_SECONDARY: ${{ secrets.ROBINHOOD_MAINNET_RPC_URL_SECONDARY }}",
      "ROBINHOOD_MAINNET_RPC_URL_SECONDARY: missing",
    ),
    robinhoodCaptureSource.replace(
      "node contracts/scripts/capture-robinhood-custom-launch-postdeployment.mjs capture",
      "echo fabricated",
    ),
    robinhoodCaptureSource.replace("--l1-posting-block \"$L1_POSTING_BLOCK\"", ""),
    robinhoodCaptureSource.replace(
      "finalize-robinhood-custom-launch-deployment.mjs assemble-stage",
      "finalize-robinhood-custom-launch-deployment.mjs verify-stage",
    ),
    robinhoodCaptureSource.replace("steps.attest-stage.outputs.bundle-path", "unchecked"),
    robinhoodCaptureSource.replace(
      "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
      "actions/upload-artifact@main",
    ),
  ];
  for (const [index, mutation] of mutations.entries()) {
    assert.notDeepEqual(
      robinhoodCaptureFailures(mutation),
      [],
      `Robinhood Phase A mutation ${index} escaped the gate`,
    );
  }
});

function robinhoodPromotionFailures(value) {
  const required = [
    "github.repository_id == 1314365508",
    "push:",
    "(github.event_name == 'workflow_dispatch' || github.event_name == 'push')",
    "group: robinhood-custom-launch-promotion-${{ github.sha }}",
    "github.ref == 'refs/heads/production'",
    "github.ref_protected == true",
    "environment: production",
    "actions: read",
    "artifact-metadata: write",
    "attestations: write",
    "contents: read",
    "id-token: write",
    "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09",
    "persist-credentials: false",
    "fetch-depth: 0",
    "+refs/heads/production:refs/remotes/origin/production",
    "*Username*) printf '%s\\n' 'x-access-token' ;;",
    "*Password*) printf '%s\\n' \"$GH_TOKEN\" ;;",
    "GIT_ASKPASS=\"$askpass\" GIT_TERMINAL_PROMPT=0 git fetch",
    "test \"$(git rev-parse refs/remotes/origin/production^{commit})\" = \"$GITHUB_SHA\"",
    "test \"$GITHUB_WORKFLOW_SHA\" = \"$GITHUB_SHA\"",
    "test \"$GITHUB_WORKFLOW_REF\" = \"$GITHUB_REPOSITORY/.github/workflows/finalize-robinhood-custom-launch-promotion.yml@$GITHUB_REF\"",
    "test -z \"$(git symbolic-ref -q HEAD || true)\"",
    "test \"$(git remote get-url origin)\" = \"https://github.com/$GITHUB_REPOSITORY\"",
    "PUSH_BASE_SHA: ${{ github.event.before }}",
    "git diff --no-renames --name-only \"$PUSH_BASE_SHA\" \"$GITHUB_SHA\"",
    "test \"${#actual_changes[@]}\" -eq \"${#expected_changes[@]}\"",
    "test \"${actual_changes[$index]}\" = \"${expected_changes[$index]}\"",
    cleanCheckoutAssertion,
    "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444",
    "node-version: 24.14.0",
    "mktemp -d \"$RUNNER_TEMP/cosign-v3.1.3.XXXXXX\"",
    "curl --proto '=https' --tlsv1.2",
    "https://github.com/sigstore/cosign/releases/download/v3.1.3/cosign-linux-amd64",
    "4629c757b7618056f8ddd7e2625ae9fdd94c0372a65049520bc7d9df9efc7f71",
    "sha256sum --check --strict",
    "PROGRAMMABLE_COSIGN_BIN=$cosign",
    "npm@11.16.0",
    "npm install --global npm@11.16.0 --ignore-scripts --no-audit --no-fund",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "Evidence #1 and the separately attested public-safe backend handoff are",
    "landed by a reviewed evidence PR",
    "Evidence #3 is a later protected evidence PR",
    "evidence_path=\"$phase_a/$evidence_file\"",
    "test -f \"$evidence_path\"",
    "test ! -L \"$evidence_path\"",
    "test \"$(stat -c '%a' \"$evidence_path\")\" = \"644\"",
    "test \"$evidence_size\" -ge 1",
    "test \"$evidence_size\" -le 268435456",
    "git cat-file -e \"$GITHUB_SHA:release/robinhood-chain-4663/$evidence_file\"",
    "test \"$(find \"$phase_a\" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')\" = \"9\"",
    "test ! -e \"$backend/backend-promotion-input.json\"",
    "git merge-base --is-ancestor \"$capture_revision\" \"$GITHUB_SHA\"",
    "test \"$capture_revision\" != \"$GITHUB_SHA\"",
    "backend-promotion-input.public.json",
    "backend-promotion-input.attestation.json",
    "compgen -A variable | grep -E '^(COSIGN|FULCIO|REKOR|SIGSTORE|TUF)_' || true",
    "Sigstore trust override environment is forbidden",
    "\"$PROGRAMMABLE_COSIGN_BIN\" verify-blob",
    "--certificate-identity",
    "https://github.com/programmablehq/programmable-open-hook-v2-internal/.github/workflows/capture-programmable-robinhood-promotion.yml@refs/heads/main",
    "--certificate-oidc-issuer \"https://token.actions.githubusercontent.com\"",
    "--certificate-github-workflow-name",
    "Capture Programmable Robinhood backend promotion",
    "--certificate-github-workflow-repository",
    "--certificate-github-workflow-ref \"refs/heads/main\"",
    "--certificate-github-workflow-sha \"$BACKEND_REVISION\"",
    "--certificate-github-workflow-trigger \"workflow_dispatch\"",
    "gh attestation trusted-root > \"$trusted_root\"",
    "--bundle \"$bundle\"",
    "--custom-trusted-root \"$TRUSTED_ROOT\"",
    "--source-digest \"$source_revision\"",
    "--signer-digest \"$source_revision\"",
    "--deny-self-hosted-runners",
    ".github/workflows/verify.yml",
    ".github/workflows/capture-robinhood-custom-launch-postdeployment.yml",
    ".github/workflows/capture-programmable-robinhood-promotion.yml",
    "run_id=\"$(jq -er '.runId | select(test(\"^[1-9][0-9]*$\"))' \"$coordinates\")\"",
    "run_attempt=\"$(jq -er '.runAttempt | select(test(\"^[1-9][0-9]*$\"))' \"$coordinates\")\"",
    "artifact_id=\"$(jq -er '.artifactId | select(test(\"^[1-9][0-9]*$\"))' \"$coordinates\")\"",
    "artifact_digest=\"$(jq -er '.artifactDigest | select(test(\"^sha256:[0-9a-f]{64}$\"))' \"$coordinates\")\"",
    "printf 'run_id=%s\\n' \"$run_id\"",
    "printf 'run_attempt=%s\\n' \"$run_attempt\"",
    "printf 'artifact_id=%s\\n' \"$artifact_id\"",
    "printf 'artifact_digest=%s\\n' \"$artifact_digest\"",
    "finalize-robinhood-custom-launch-deployment.mjs authorize-backend",
    "--capture-attestation-bundle",
    "--stage-attestation-bundle",
    "--source-verify-proof",
    "--source-verify-attestation-bundle",
    "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
    "steps.attest-authorization.outputs.bundle-path",
    "steps.attest-promotion.outputs.bundle-path",
    "finalize-robinhood-custom-launch-deployment.mjs promote",
    "finalize-robinhood-custom-launch-deployment.mjs materialize-release-assets",
    "--asset-output-root \"$outputs\"",
    "--backend-input \"$BACKEND_DIR/backend-promotion-input.public.json\"",
    "--backend-authorization \"${{ steps.authorize-backend.outputs.path }}\"",
    "--backend-authorization-attestation-bundle \"${{ steps.retain-authorization.outputs.bundle }}\"",
    "test \"$(jq -r '.state' \"$promotion\")\" = \"finalized-live\"",
    "cp -- \"$ACTION_BUNDLE_PATH\" \"$bundle\"",
    "cmp --silent -- \"$ACTION_BUNDLE_PATH\" \"$bundle\"",
    "test \"$(find \"$outputs\" -type f | wc -l | tr -d ' ')\" = \"8\"",
    "git diff --exit-code",
    "--header \"Accept: application/vnd.github+json\"",
    "--header \"X-GitHub-Api-Version: 2026-03-10\"",
    "repos/$GITHUB_REPOSITORY/git/ref/heads/production",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    "if-no-files-found: error",
    "compression-level: 0",
    "overwrite: false",
    "Evidence PR merged: \\`false\\` (separate protected gate)",
    "Reconfirm finalization producer remains protected production tip",
  ];
  const missing = required.filter((item) => !value.includes(item));
  const forbiddenCosignOptions = [
    "--insecure-ignore-tlog",
    "--insecure-ignore-sct",
    "--certificate-identity-regexp",
    "--certificate-oidc-issuer-regexp",
    "--key",
    "--trusted-root",
    "--rekor-url",
    "--fulcio-url",
  ];
  for (const option of forbiddenCosignOptions) {
    const pattern = new RegExp(`(^|\\s)${option}(?:\\s|=|$)`, "u");
    if (pattern.test(value)) missing.push(`forbidden Cosign option ${option}`);
  }
  if (value.split(cleanCheckoutAssertion).length - 1 !== 2) {
    missing.push("exactly two initial/final clean-checkout assertions");
  }
  return missing;
}

test("Robinhood Phase B workflow accepts only portable public-safe producer evidence", () => {
  assert.deepEqual(robinhoodPromotionFailures(robinhoodPromotionSource), []);
  assert.equal(robinhoodPromotionSource.includes("${{ secrets."), false);
  assert.equal(robinhoodPromotionSource.includes("FLY_API_TOKEN"), false);
  assert.equal(robinhoodPromotionSource.includes("ROBINHOOD_MAINNET_RPC_URL"), false);
  assert.equal(robinhoodPromotionSource.includes("ETHEREUM_MAINNET_RPC_URL"), false);
  assert.equal(robinhoodPromotionSource.includes("inputs.trusted_root"), false);
  assert.equal(/--backend-input[^\n]*backend-promotion-input\.json(?:\s|")/u
    .test(robinhoodPromotionSource), false);
  assert.equal(/cp -- [^\n]*backend-promotion-input\.json(?:\s|")/u
    .test(robinhoodPromotionSource), false);
  assert.equal(robinhoodPromotionSource.includes("actions/download-artifact@"), false);
  assert.equal(robinhoodPromotionSource.includes("inputs.phase_a_artifact"), false);
  assert.equal(robinhoodPromotionSource.includes("inputs.backend_artifact"), false);
  assert.equal(robinhoodPromotionSource.includes("pull_request:"), false);
  assert.equal(robinhoodPromotionSource.includes("create-storage-record: false"), false);
  assert.equal(robinhoodPromotionSource.includes('test(\\"'), false);
});

test("Robinhood Phase B workflow contract mutations fail closed", () => {
  const mutations = [
    robinhoodPromotionSource.replace(
      "(github.event_name == 'workflow_dispatch' || github.event_name == 'push')",
      "true",
    ),
    robinhoodPromotionSource.replace(
      "group: robinhood-custom-launch-promotion-${{ github.sha }}",
      "group: robinhood-custom-launch-promotion",
    ),
    robinhoodPromotionSource.replace("github.ref == 'refs/heads/production'", "true"),
    robinhoodPromotionSource.replace("github.ref_protected == true", "true"),
    robinhoodPromotionSource.replace("persist-credentials: false", "persist-credentials: true"),
    robinhoodPromotionSource.replace(
      "GIT_ASKPASS=\"$askpass\" GIT_TERMINAL_PROMPT=0 git fetch",
      "git fetch",
    ),
    robinhoodPromotionSource.replace(
      "*Password*) printf '%s\\n' \"$GH_TOKEN\" ;;",
      "*Password*) printf '%s\\n' anonymous ;;",
    ),
    robinhoodPromotionSource.replace(cleanCheckoutAssertion, "true"),
    replaceLast(robinhoodPromotionSource, cleanCheckoutAssertion, "true"),
    robinhoodPromotionSource.replace(
      "git diff --no-renames --name-only \"$PUSH_BASE_SHA\" \"$GITHUB_SHA\"",
      "printf '%s\\n' \"${expected_changes[@]}\"",
    ),
    robinhoodPromotionSource.replace(
      "test \"${#actual_changes[@]}\" -eq \"${#expected_changes[@]}\"",
      "true",
    ),
    robinhoodPromotionSource.replace("test ! -L \"$evidence_path\"", "true"),
    robinhoodPromotionSource.replace(
      "git cat-file -e \"$GITHUB_SHA:release/robinhood-chain-4663/$evidence_file\"",
      "test -e \"$phase_a/$evidence_file\"",
    ),
    robinhoodPromotionSource.replace(
      "test \"$(find \"$phase_a\" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')\" = \"9\"",
      "true",
    ),
    robinhoodPromotionSource.replace("gh attestation trusted-root > \"$trusted_root\"", "echo supplied"),
    robinhoodPromotionSource.replace("--custom-trusted-root \"$TRUSTED_ROOT\"", ""),
    robinhoodPromotionSource.replace("--source-digest \"$source_revision\"", ""),
    robinhoodPromotionSource.replace("--signer-digest \"$source_revision\"", ""),
    robinhoodPromotionSource.replace("--deny-self-hosted-runners", ""),
    robinhoodPromotionSource.replace("--certificate-github-workflow-sha \"$BACKEND_REVISION\"", ""),
    robinhoodPromotionSource.replace("--certificate-github-workflow-trigger \"workflow_dispatch\"", ""),
    robinhoodPromotionSource.replace(
      "compgen -A variable | grep -E '^(COSIGN|FULCIO|REKOR|SIGSTORE|TUF)_' || true",
      "true",
    ),
    ...[
      "--insecure-ignore-tlog",
      "--insecure-ignore-sct",
      "--certificate-identity-regexp",
      "--certificate-oidc-issuer-regexp",
      "--key",
      "--trusted-root",
      "--rekor-url",
      "--fulcio-url",
    ].map((option) => `${robinhoodPromotionSource}\n${option} attacker-controlled\n`),
    robinhoodPromotionSource.replaceAll("backend-promotion-input.public.json", "backend-promotion-input.json"),
    robinhoodPromotionSource.replace(
      "finalize-robinhood-custom-launch-deployment.mjs authorize-backend",
      "echo fabricated",
    ),
    robinhoodPromotionSource.replace(
      "finalize-robinhood-custom-launch-deployment.mjs promote",
      "echo skipped",
    ),
    robinhoodPromotionSource.replace(
      "finalize-robinhood-custom-launch-deployment.mjs materialize-release-assets",
      "echo skipped",
    ),
    robinhoodPromotionSource.replaceAll(
      "--header \"X-GitHub-Api-Version: 2026-03-10\"",
      "",
    ),
    robinhoodPromotionSource.replaceAll(
      "--backend-authorization-attestation-bundle \"${{ steps.retain-authorization.outputs.bundle }}\"",
      "",
    ),
    robinhoodPromotionSource.replaceAll(
      "actions/attest@59d89421af93a897026c735860bf21b6eb4f7b26",
      "actions/attest@main",
    ),
    robinhoodPromotionSource.replace("steps.attest-promotion.outputs.bundle-path", "unchecked"),
    robinhoodPromotionSource.replace(
      "Evidence #3 is a later protected evidence PR",
      "Evidence #3 is complete",
    ),
  ];
  for (const [index, mutation] of mutations.entries()) {
    assert.notDeepEqual(
      robinhoodPromotionFailures(mutation),
      [],
      `Robinhood Phase B mutation ${index} escaped the gate`,
    );
  }
});

function tagRuleset(updatedAt = "2026-08-27T20:27:05.716Z") {
  return {
    id: 21679403,
    name: "Protect Programmable Launch CLI release tags",
    target: "tag",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["refs/tags/programmable-launch-v*"],
        exclude: [],
      },
    },
    rules: [{ type: "update" }, { type: "deletion" }],
    updated_at: updatedAt,
  };
}

test("tag ruleset verification ignores provider timestamp spelling but rejects structural drift", () => {
  assert.doesNotThrow(() =>
    assertProgrammableLaunchTagRuleset(tagRuleset("2026-08-27T20:27:05.716Z")),
  );
  assert.doesNotThrow(() =>
    assertProgrammableLaunchTagRuleset(tagRuleset("2026-08-27T22:27:05.716+02:00")),
  );

  const mutations = [
    (value) => ({ ...value, id: 21679404 }),
    (value) => ({ ...value, name: "Different ruleset" }),
    (value) => ({ ...value, target: "branch" }),
    (value) => ({ ...value, enforcement: "evaluate" }),
    (value) => ({ ...value, bypass_actors: [{ actor_type: "OrganizationAdmin" }] }),
    (value) => ({
      ...value,
      conditions: { ref_name: { include: ["refs/tags/*"], exclude: [] } },
    }),
    (value) => ({ ...value, rules: [{ type: "update" }] }),
    (value) => ({
      ...value,
      rules: [{ type: "update", parameters: {} }, { type: "deletion" }],
    }),
  ];
  for (const [index, mutate] of mutations.entries()) {
    assert.throws(
      () => assertProgrammableLaunchTagRuleset(mutate(tagRuleset())),
      /tag ruleset mismatch/u,
      `structural mutation ${index} escaped the gate`,
    );
  }
});
