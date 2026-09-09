import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PROGRAMMABLE_AGENT_ENTRY } from "../lib/agent-connection";

it("keeps the module host guide outside the externally managed docs namespace", () => {
  const path = new URL(PROGRAMMABLE_AGENT_ENTRY.workflows.moduleContribution.developerGuide).pathname;
  expect(path).not.toMatch(/^\/docs(?:\/|$)/);
  const alias = readFileSync(`app${path}/page.tsx`, "utf8");
  expect(alias).toContain('from "@/app/docs/developers/module-mode/page"');
  const page = readFileSync("app/docs/developers/module-mode/page.tsx", "utf8");
  expect(page).toContain(`canonical: "${path}"`);
  expect(page).toContain("module-context");
  expect(page).toContain("default reward wallet");
  expect(page).toContain("PROGRAMMABLE_API_KEY");
  expect(page).toContain("Launches + modules");
  expect(readFileSync("components/module-contribution-entry.tsx", "utf8")).toContain(`href="${path}"`);
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  expect(config.redirects).not.toContainEqual({ source: "/docs/developers/module-mode", destination: path, permanent: false });
});
