import path from 'node:path';
import { REPOSITORY_ROOT, sealBuild } from '../module-mode/build.mjs';
import { bindReusedSourceClosure } from '../module-native-v2/build.mjs';
import { QUOTE_REUSE_DOMAIN } from './quote-core.mjs';
import { bindQuoteReviewCompiler } from './quote-review-compiler.mjs';

export const QUOTE_ARTIFACTS = Object.freeze({
  positionPlanner: 'StockPairedPositionPlannerV3.sol/StockPairedPositionPlannerV3.json',
  converter: 'ModuleQuoteEthConverterV1.sol/ModuleQuoteEthConverterV1.json',
  positionForwarderFactory: 'LockedPositionFeeForwarderFactoryV1.sol/LockedPositionFeeForwarderFactoryV1.json',
  reviewEngine: 'ModuleQuoteEngineV1.sol/ModuleQuoteEngineV1.json',
});
export async function sealQuoteBuild(options = {}) {
  const root = options.root ?? REPOSITORY_ROOT;
  const build = await sealBuild({ ...options, root, output: options.output ?? path.join(root, 'contracts/out/module-engine-quote-deployment/build'),
    sourcePaths: ['src/module-engine/ModuleQuoteEngineV1.sol'], artifactPaths: QUOTE_ARTIFACTS });
  const reviewed = await bindQuoteReviewCompiler(build, root, options.environment ?? process.env);
  return bindReusedSourceClosure(reviewed, root, { roles: ['positionForwarderFactory'], domain: QUOTE_REUSE_DOMAIN });
}
