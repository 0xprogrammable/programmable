import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("loads the actual Module Mode launch and management client graphs without string code generation", async () => {
  // Keep application, wallet, SDK and validator imports real. Styles do not execute JS.
  const bundled = await build({
    stdin: {
      contents: `
        import { ModuleModeLaunchHost } from './components/module-mode-launch-host';
        import { ModuleCoinConsole } from './components/module-coin-console';
        import { ModuleEngineHost } from './components/module-engine-host';
        if ([ModuleModeLaunchHost, ModuleCoinConsole, ModuleEngineHost].some(value => typeof value !== 'function')) {
          throw new Error('Module Mode client roots did not load');
        }
        let codeGenerationBlocked = false;
        try { new Function('return true'); } catch (error) { codeGenerationBlocked = error.name === 'EvalError'; }
        if (!codeGenerationBlocked) throw new Error('String code generation was not disabled');
        console.log('Module Mode client graph loaded with string code generation disabled');
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    write: false,
    outdir: "/module-mode-csp-test",
    loader: { ".css": "empty" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_PRIVY_APP_ID": '""' },
    metafile: true,
  });
  const directory = await mkdtemp(join(tmpdir(), "module-mode-client-csp-"));
  try {
    const script = join(directory, "client.cjs");
    await writeFile(script, bundled.outputFiles[0].contents);
    const output = execFileSync(process.execPath, ["--disallow-code-generation-from-strings", script], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    });
    expect(output.trim()).toBe("Module Mode client graph loaded with string code generation disabled");
    // Also reject deferred legacy schema compilation in a client-only import branch.
    expect(Object.keys(bundled.metafile.inputs).filter(path => /(?:^|\/)ajv\//u.test(path))).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
