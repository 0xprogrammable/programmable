import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");
const guide = read("public/developers/robinhood-launch-guide-v1.md");
const guideUrl = "https://programmable.market/developers/robinhood-launch-guide-v1.md";

describe("separate Robinhood launch workflow documentation", () => {
  it("makes both public reports discoverable before implementation without creating a key", () => {
    for (const relative of ["public/developers/custom-launch-api-v1.md", "docs/public/developers/custom-launch.md"]) {
      const entry = read(relative);
      expect(entry).toContain(guideUrl);
      expect(entry).toContain("GET /v4/chains/4663/launch-guide");
      expect(entry).toContain("programmable.robinhood-launch-guide.v1");
      expect(entry).toMatch(/no(?: API)? key|without a key/);
      expect(entry).toContain("CLI `4.1.1`");
      expect(entry).toContain("API profile `4.1.0`");
    }
    const reportCommands = guide.match(/```sh\n([\s\S]*?)\n```/)?.[1] ?? "";
    expect(reportCommands.split("\n")).toEqual([
      "curl --fail --silent --show-error https://api.programmable.market/v4/chains/4663/launch-coverage",
      "curl --fail --silent --show-error https://api.programmable.market/v4/chains/4663/launch-guide",
    ]);
    expect(reportCommands).not.toMatch(/Authorization|PROGRAMMABLE_API_KEY|\?/);
    expect(guide).toContain("authority.requestAuthorized");
    expect(guide).toContain("scenarioProfileVersion");
    expect(guide).toContain("not-evaluated");
    expect(guide).toContain("https://programmable.market/schemas/custom-launch/guide/v1.json");
  });

  it("documents the twelve scenario identities and keeps missing coverage separate from unsafe behavior", () => {
    for (const id of [
      "reviewed-native20-seed", "combined-token-hook", "hook-owned-pol-no-initial-buy", "no-pool",
      "multiple-pools", "non-native-pair", "custom-token-or-initializer", "stateful-module",
      "return-delta-settlement", "static-module", "custom-curve-or-auction", "unclassified-mechanism",
    ]) expect(guide).toContain(`| \`${id}\`:`);
    for (const boundary of [
      "BLOB-style", "tokenAndHookMayShareAddress: false", "LP fee 0", "tick spacing 60",
      "no optional module", "proof-available", "none-versioned-transport-required",
      "The mechanism being unknown does not make it unsafe",
    ]) expect(guide).toContain(boundary);
    expect(guide).toContain("do not prove execution, reserves, solvency or launch eligibility");
    expect(guide).toContain("Historical 4.0 requests retain their original `funding: none` semantics");
    expect(guide).toContain("cannot obtain a launch permit");
  });

  it("distinguishes response outcomes and operation-specific recovery without introducing write authority", () => {
    for (const text of [
      "`custom-launch:create`", "`custom-launch:read`", "read-only key cannot preflight/create",
      "`202` for a new durable request", "`200` for an exact idempotent replay",
      "TX_SIMULATION_PENDING", "`launchEligibility.deployable`",
      "`401 UNAUTHENTICATED`", "`403 INSUFFICIENT_SCOPE`", "`403 CHAIN_NOT_ALLOWED`",
      "`WALLET_BINDING_MISMATCH`", "`404 NOT_FOUND`", "`409 IDEMPOTENCY_CONFLICT`",
      "explicitly retryable `503`", "`Retry-After`", "same operation with its exact request bytes and idempotency key",
      "`CUSTOM_LAUNCH_V4_PERMIT_WINDOW_INVALID`", "`PERMIT_EXPIRED`",
      "requestId", "never send credentials", "never sign or broadcast",
    ]) expect(guide).toContain(text);
    expect(read("public/developers/custom-launch-api-v1.md")).toContain("before intentionally creating");
    expect(guide.indexOf("## 4. Build, preflight and submit exact bytes"))
      .toBeGreaterThan(guide.indexOf("## 2. Match the intended scenario"));
    expect(guide.indexOf("After that wallet transaction has been sent"))
      .toBeLessThan(guide.indexOf("--watch --until finalized"));
    expect(guide).toContain("(`resource.launchId` in CLI JSON)");
    expect(guide).toContain("Source verification, Programmable publication and");
  });

  it("uses command options accepted by the existing immutable CLI without accessing files or credentials", () => {
    const commands = [...guide.matchAll(/```sh\n([\s\S]*?)\n```/g)]
      .flatMap(match => match[1].split("\n"))
      .filter(line => line.startsWith("programmable-launch "));
    expect(commands).toHaveLength(5);
    expect(commands[0]).toBe("programmable-launch pack --config programmable-launch.config.json --output launch.json");
    for (const command of commands) {
      expect(command).not.toMatch(/--out(?:\s|$)/);
      const output = execFileSync(process.execPath, [
        "packages/launch/bin/programmable-launch.mjs", ...command.split(" ").slice(1), "--help",
      ], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH, NODE_ENV: "test" } });
      expect(output).toContain("Usage: programmable-launch");
    }
    const polling = commands.filter(command => command.startsWith("programmable-launch status "));
    for (const command of polling) expect(command).toContain("status LAUNCH_ID --api-version 4 --chain-id 4663");
  });
});
