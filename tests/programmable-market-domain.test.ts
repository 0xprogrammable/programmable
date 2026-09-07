import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import robots from "../app/robots";
import sitemap from "../app/sitemap";

describe("programmable.market website origin", () => {
  it("publishes the new canonical origin in website metadata", async () => {
    const layoutSource = await readFile(
      new URL("../app/layout.tsx", import.meta.url),
      "utf8",
    );

    expect(layoutSource).toContain(
      'const siteUrl = new URL("https://programmable.market")',
    );
    expect(layoutSource).not.toContain(
      'const siteUrl = new URL("https://programmable.family")',
    );
  });

  it("publishes robots and sitemap on the canonical origin", () => {
    expect(robots()).toMatchObject({
      host: "https://programmable.market",
      sitemap: "https://programmable.market/sitemap.xml",
    });
    expect(sitemap()).not.toHaveLength(0);
    expect(
      sitemap().every(({ url }) => url.startsWith("https://programmable.market")),
    ).toBe(true);
  });

  it("redirects only the new www host to the apex", async () => {
    const redirects = await nextConfig.redirects?.();
    const hostRedirects = redirects?.filter(({ has }) =>
      has?.some(({ type }) => type === "host"),
    );

    expect(hostRedirects).toEqual([
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.programmable.market" }],
        destination: "https://programmable.market/:path*",
        permanent: true,
      },
    ]);
  });

  it("binds release workflows and read-model defaults to the canonical origin", async () => {
    const sources = await Promise.all(
      [
        "../.github/workflows/deploy-production.yml",
        "../scripts/perf/read-model-deploy-policy.mjs",
        "../scripts/perf/read-model-live-verifier.mjs",
        "../scripts/perf/read-model-gate.mjs",
        "../scripts/data-pipeline/cutover-http.mjs",
        "../scripts/data-pipeline/cutover-operator.mjs",
        "../scripts/verify-custom-launch-release-record.mjs",
        "../docs/data-pipeline/PRODUCTION-CUTOVER-OPERATOR.md",
      ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
    );
    const schema = JSON.parse(
      await readFile(
        new URL(
          "../docs/operations/releases/custom-launch-v1/release-record.schema.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );

    for (const source of sources) {
      expect(source).toContain("programmable.market");
      expect(source).not.toContain("programmable.family");
    }
    expect(
      schema.$defs.deploymentSnapshot.properties.productionAlias.enum,
    ).toEqual(["https://programmable.market", null]);
    expect(
      schema.$defs.promotedDeployment.properties.productionAlias.enum,
    ).toEqual(["https://programmable.market", null]);
  });
});
