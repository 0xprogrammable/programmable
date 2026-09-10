#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  evaluateReadModelDeployPolicy,
  validateBoundVercelProductionMetadata,
} from "./read-model-deploy-policy.mjs";

export const INDEXED_WEBSITE_READ_MODE = "indexed-website-read";
export const INDEXED_WEBSITE_ROUTES = Object.freeze([
  Object.freeze({ chainId: 1, slug: "ethereum", path: "/api/explore/ethereum" }),
  Object.freeze({ chainId: 4663, slug: "robinhood", path: "/api/explore/robinhood" }),
]);

const HASH = /^0x(?!0{64}$)[0-9a-f]{64}$/iu;
const ADDRESS = /^0x(?!0{40}$)[0-9a-f]{40}$/iu;

// Reuse the source identities already reviewed with this checkout. This does
// not replace the server readers' release, provenance or finality validation.
export function readIndexedWebsiteSourceExpectations(root = process.cwd()) {
  const json = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
  const catalog = json("config/envio-classic-v4-catalog-release.v1.json");
  const envio = catalog.releaseBinding?.envio;
  if (catalog.status !== "indexer-activated" || catalog.chainId !== 1 ||
    catalog.releaseBinding?.chainId !== 1 ||
    !/^[a-z0-9][a-z0-9-]{1,127}$/u.test(envio?.deploymentLabel ?? "") ||
    !/^[0-9a-f]{40}$/u.test(envio?.sourceCommit ?? "")) {
    throw new Error("indexed website Ethereum release identity is invalid");
  }
  const modules = [
    json("config/module-mode/robinhood.preview.json"),
    json("config/module-engine/robinhood.json"),
    ...json("config/module-mode/historical-releases.json").releases.map(({ release }) => release),
    ...json("config/module-engine/historical-releases.json").releases.map(({ release }) => release),
  ].map((release) => {
    const engine = ["module-engine-v1", "module-engine-any-quote-v1"].includes(release.sourceVersion);
    const sourceAddress = engine
      ? release.contracts?.host?.address : release.contracts?.launcher?.address;
    if (release.chainId !== 4663 ||
      !["module-native-v1", "module-native-v2", "module-engine-v1", "module-engine-any-quote-v1"].includes(release.sourceVersion) ||
      !ADDRESS.test(sourceAddress ?? "") || !HASH.test(release.releaseDigest ?? "") ||
      !/^[1-9][0-9]{0,19}$/u.test(release.startBlock ?? "")) {
      throw new Error("indexed website Robinhood release identity is invalid");
    }
    // The saved index uses one Engine transport. Keep the configured authentication
    // version distinct; the immutable release digest still binds that exact version.
    return Object.freeze({ source: engine ? "module-engine-v1" : release.sourceVersion, sourceVersion: release.sourceVersion, sourceAddress: sourceAddress.toLowerCase(),
      releaseDigest: release.releaseDigest.toLowerCase(), startBlock: release.startBlock });
  });
  const robinhood = json("contracts/deployments/robinhood-custom-launch-v1.json");
  const routerAddress = robinhood.contracts?.programmableLaunchStampRouter?.address;
  const startBlock = robinhood.deploymentEvidence?.blockNumber;
  if (robinhood.chainId !== "4663" || !ADDRESS.test(routerAddress ?? "") ||
    !/^[1-9][0-9]{0,19}$/u.test(startBlock ?? "")) {
    throw new Error("indexed website Robinhood Router identity is invalid");
  }
  return Object.freeze({
    ethereum: Object.freeze({ deployment: envio.deploymentLabel, sourceCommit: envio.sourceCommit,
      hooks: catalog.releaseBinding.sources.filter(source => /^ClassicV[0-9]+Hook$/u.test(source.contractName)).map(source => source.address.toLowerCase()) }),
    robinhood: Object.freeze({ routerAddress: routerAddress.toLowerCase(), startBlock, modules: Object.freeze(modules) }),
  });
}

export function evaluateIndexedWebsiteReadDeployPolicy(contents) {
  const legacy = evaluateReadModelDeployPolicy(contents);
  return Object.freeze({
    mode: INDEXED_WEBSITE_READ_MODE,
    policyReady: legacy.policyReady,
    runtimeEvidenceRequired: true,
    runtimeVerified: false,
    publicReadAuthentication: "none",
    probeProviderCredentialsRequired: false,
    legacyReadPolicyMode: legacy.mode,
    legacyIndexedFlags: legacy.indexedFlags,
    retiredWorkerFlags: legacy.workerActivationFlags,
    rejectedFlagNames: [...legacy.invalidFlagNames, ...legacy.activeFlagNames],
    routes: INDEXED_WEBSITE_ROUTES,
  });
}

function main() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/u, "");
    if (!["env-file", "sensitive-env-metadata", "github-output"].includes(key) ||
      args[key] !== undefined || !argv[index + 1] || argv[index + 1].startsWith("--")) {
      throw new Error("indexed website policy arguments are invalid");
    }
    args[key] = argv[index + 1];
  }
  if (!args["env-file"] || !args["sensitive-env-metadata"]) {
    throw new Error("indexed website policy requires environment and bound metadata files");
  }
  validateBoundVercelProductionMetadata(
    readFileSync(resolve(args["sensitive-env-metadata"]), "utf8"), process.env.VERCEL_PROJECT_ID,
  );
  const policy = evaluateIndexedWebsiteReadDeployPolicy(readFileSync(resolve(args["env-file"]), "utf8"));
  if (!policy.policyReady) throw new Error(`indexed website policy rejected legacy flags: ${policy.rejectedFlagNames.join(", ")}`);
  const sourceExpectations = readIndexedWebsiteSourceExpectations();
  if (args["github-output"]) appendFileSync(resolve(args["github-output"]),
    `mode=${policy.mode}\nruntime_evidence_required=true\npublic_read_authentication=none\n`,
    { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...policy, sourceExpectations })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "indexed website policy failed"}\n`);
    process.exitCode = 1;
  }
}
