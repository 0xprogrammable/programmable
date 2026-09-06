import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { developerDocsMarkdown } from "../lib/developer-docs-content";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

describe("separate public launch coverage contract", () => {
  it("discovers the public backend read without changing a launch profile", () => {
    const document = JSON.parse(read("public/openapi/launch-coverage-v1.json"));
    const operation = document.paths["/v4/chains/4663/launch-coverage"].get;
    expect(operation.security).toEqual([]);
    expect(document.servers).toEqual([{ url: "https://api.programmable.market" }]);
    expect(operation.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/RobinhoodLaunchCoverageV1",
    );
    expect(developerDocsMarkdown).toContain("https://programmable.market/openapi/launch-coverage-v1.json");
    expect(Object.keys(document.paths)).toEqual(["/v4/chains/4663/launch-coverage"]);
    expect(Object.keys(document.paths["/v4/chains/4663/launch-coverage"])).toEqual(["get"]);
    for (const version of ["v4", "v4.1"]) {
      const historical = JSON.parse(read(`public/openapi/custom-launch-${version}.json`));
      expect(historical.paths).not.toHaveProperty("/v4/chains/4663/launch-coverage");
      expect(historical.components.schemas.CustomLaunchCapabilitiesV2.properties).not.toHaveProperty("verifierCoverage");
    }
  });

  it("keeps the package, standalone and OpenAPI response schemas identical", () => {
    const packaged = read("packages/launch/schemas/robinhood-launch-coverage-v1.json");
    expect(read("public/schemas/custom-launch/coverage/v1.json")).toBe(packaged);
    const { $schema, $id, title, description, ...shape } = JSON.parse(packaged);
    expect($schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect($id).toBe("https://programmable.market/schemas/custom-launch/coverage/v1.json");
    expect(title).toBeTruthy();
    expect(description).toContain("never authorizes a launch");
    expect(JSON.parse(read("public/openapi/launch-coverage-v1.json")).components.schemas.RobinhoodLaunchCoverageV1).toEqual(shape);
  });

  it("documents backend-first deployment and a separate immutable client release", () => {
    const docs = read("docs/public/developers/custom-launch.md");
    expect(docs).toContain("tokenAndHookMayShareAddress: false");
    expect(docs).toContain("requestAuthorized: false");
    expect(docs).toContain("not a reason to rotate a key");
    const release = read("docs/operations/programmable-launch-cli-release.md");
    expect(release).toContain("Deploy the backend implementation");
    expect(release).toContain("a new package version, an immutable new");
    expect(release).toContain("Do not reuse");
    expect(release).toContain("LAUNCH_COVERAGE_UNAVAILABLE");
    const agentGuide = read("public/developers/custom-launch-api-v1.md");
    expect(agentGuide).toContain("tokenAndHookMayShareAddress: false");
    expect(agentGuide).toContain("Keep unknown codes unclassified");
    expect(developerDocsMarkdown).toContain("https://api.programmable.market/v4/chains/4663/launch-coverage");
    expect(developerDocsMarkdown).toContain("requestAuthorization.requestAuthorized is always false");
  });
});
