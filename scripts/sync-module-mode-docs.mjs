import { readFile, writeFile } from "node:fs/promises";

const source = new URL("../docs/public/developers/module-mode-indexing.md", import.meta.url);
const target = new URL("../public/developers/module-mode-indexing-v1.md", import.meta.url);
const content = await readFile(source, "utf8");
if (process.argv.includes("--write")) {
  await writeFile(target, content);
} else if (await readFile(target, "utf8").catch(() => null) !== content) {
  throw new Error("Module Mode indexing Markdown differs. Run node scripts/sync-module-mode-docs.mjs --write.");
}
