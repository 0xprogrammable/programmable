#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const CUSTOM_LAUNCH_PUBLIC_FLAG =
  "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED";

function parseBoolean(value, label) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${label} must be exactly true or false`);
}

function parseProductionMode(value) {
  if (value === "enabled") return true;
  if (value === "disabled") return false;
  throw new Error(
    "Custom Launch production mode must be exactly enabled or disabled",
  );
}

function parseStageMode(value) {
  if (value === "none" || value === "dark" || value === "enabled") {
    return value;
  }
  throw new Error(
    "Custom Launch stage mode must be exactly none, dark, or enabled",
  );
}

export function readCustomLaunchPublicFlag(envSource) {
  const matches = [];
  for (const line of envSource.split(/\r?\n/u)) {
    const match = new RegExp(`^${CUSTOM_LAUNCH_PUBLIC_FLAG}=(.*)$`, "u").exec(
      line,
    );
    if (match) matches.push(match[1]);
  }
  if (matches.length === 0) return false;
  if (matches.length !== 1)
    throw new Error("Custom Launch public flag must occur exactly once");
  const raw = matches[0];
  if (raw === "true" || raw === "false")
    return parseBoolean(raw, "Custom Launch public flag");
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    const unquoted = raw.slice(1, -1);
    if (!/[\\\r\n]/u.test(unquoted))
      return parseBoolean(unquoted, "Custom Launch public flag");
  }
  throw new Error(
    "Custom Launch public flag must be one exact boolean without expansion",
  );
}

export function resolveCustomLaunchStagingPolicy({
  requested,
  productionEnvSource,
  productionMode,
  stageMode,
}) {
  const requestedEnablement = parseBoolean(
    requested,
    "Custom Launch dispatch request",
  );
  const configuredEnablement = readCustomLaunchPublicFlag(productionEnvSource);
  const modeEnablement = parseProductionMode(productionMode);
  const exactStageMode = parseStageMode(stageMode);
  if (requestedEnablement !== configuredEnablement) {
    throw new Error(
      "Custom Launch dispatch request and pulled production configuration disagree",
    );
  }
  if (modeEnablement !== configuredEnablement) {
    throw new Error(
      "Custom Launch protected production mode and pulled production configuration disagree",
    );
  }
  const stageEnablement = exactStageMode === "enabled";
  if (stageEnablement !== configuredEnablement) {
    throw new Error(
      "Custom Launch stage mode and pulled production configuration disagree",
    );
  }
  return Object.freeze({
    stageMode: exactStageMode,
    releaseRecordRequired: exactStageMode !== "none",
    releaseRecordRequirement:
      exactStageMode === "dark"
        ? "dark_staging"
        : exactStageMode === "enabled"
          ? "staging"
          : "none",
    customLaunchProbeRequired: exactStageMode !== "none",
    authenticatedCanaryRequired: exactStageMode === "enabled",
    requiredDeploymentState:
      exactStageMode === "dark"
        ? "disabled"
        : exactStageMode === "enabled"
          ? "enabled"
          : "none",
    configuredEnablement,
  });
}

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !name?.startsWith("--") ||
      value === undefined ||
      value.startsWith("--")
    ) {
      throw new Error("arguments must be --name value pairs");
    }
    result[name.slice(2)] = value;
  }
  for (const name of [
    "env-file",
    "requested",
    "production-mode",
    "stage-mode",
    "github-output",
  ]) {
    if (!result[name]) throw new Error(`--${name} is required`);
  }
  return result;
}

async function main(argv) {
  const args = argumentsFrom(argv);
  const result = resolveCustomLaunchStagingPolicy({
    requested: args.requested,
    productionEnvSource: await readFile(args["env-file"], "utf8"),
    productionMode: args["production-mode"],
    stageMode: args["stage-mode"],
  });
  await appendFile(
    args["github-output"],
    [
      `release_record_required=${result.releaseRecordRequired}`,
      `release_record_requirement=${result.releaseRecordRequirement}`,
      `custom_launch_probe_required=${result.customLaunchProbeRequired}`,
      `authenticated_canary_required=${result.authenticatedCanaryRequired}`,
      `required_deployment_state=${result.requiredDeploymentState}`,
      `stage_mode=${result.stageMode}`,
      `configured_enablement=${result.configuredEnablement}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({
      status: "policy_resolved",
      stageMode: result.stageMode,
      releaseRecordRequired: result.releaseRecordRequired,
      customLaunchProbeRequired: result.customLaunchProbeRequired,
      authenticatedCanaryRequired: result.authenticatedCanaryRequired,
    })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Custom Launch policy resolution failed"}\n`,
    );
    process.exitCode = 1;
  });
}
