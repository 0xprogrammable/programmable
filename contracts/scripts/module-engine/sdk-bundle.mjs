import { createRequire } from 'node:module';
import path from 'node:path';

/** Installed Uniswap ESM files use extensionless imports. Resolve their locked CJS exports for Node operator bundles. */
export function moduleEngineSdkBundle() {
  return {
    plugins: [{ name: 'module-engine-locked-uniswap-cjs', setup(bundler) {
      bundler.onResolve({ filter: /^@uniswap\// }, args => ({ path: createRequire(path.join(args.resolveDir, 'module-engine-resolve.cjs')).resolve(args.path) }));
    } }],
    banner: { js: "import { createRequire as createModuleEngineRequire } from 'node:module'; const require = createModuleEngineRequire(import.meta.url);" },
  };
}
