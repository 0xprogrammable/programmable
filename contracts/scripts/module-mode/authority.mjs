import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveProductionVerifyProofFromGitHubV1, PRODUCTION_VERIFY_PROOF_MAX_AGE_MS } from '../../../scripts/production-verify-proof.mjs';
import { REPOSITORY_ROOT, git, repositoryState } from './build.mjs';
import { need, sha256 } from './core.mjs';
const exec = promisify(execFile);

/** Uses the existing authenticated GitHub CLI transport; never reads or prints its stored token. */
async function githubCliFetch(url) {
  const parsed = new URL(url); need(parsed.origin === 'https://api.github.com', 'Unapproved GitHub API origin');
  const { stdout } = await exec('gh', ['api', '--hostname', 'github.com', `${parsed.pathname}${parsed.search}`], { cwd: REPOSITORY_ROOT, maxBuffer: 4 * 1024 * 1024, timeout: 15000 });
  return new Response(stdout, { status: 200, headers: { 'content-type': 'application/json' } });
}
export async function assertSourceAuthority(plan, reviewedPlanDigest, runId, runAttempt) {
  need(plan.sourceClean === true && plan.planDigest === reviewedPlanDigest, 'Owner must explicitly review this exact clean-source plan digest');
  const state = await repositoryState();
  need(state.sourceClean && state.branch === 'production' && state.sourceCommit === plan.sourceCommit && state.sourceTree === plan.sourceTree, 'Wallet actions require the exact clean production source');
  need(await git(REPOSITORY_ROOT, ['rev-parse', 'refs/remotes/origin/production']) === state.sourceCommit, 'Local origin/production differs');
  need(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(runAttempt) && runAttempt > 0, 'Exact hosted Verify run and attempt required');
  const workflow = await readFile(path.join(REPOSITORY_ROOT, '.github/workflows/verify.yml'));
  return resolveProductionVerifyProofFromGitHubV1({ repository: 'programmablehq/programmable', repositoryId: 1_314_365_508,
    commitSha: state.sourceCommit, treeSha: state.sourceTree, workflowFileSha256: `sha256:${sha256(workflow)}`,
    verificationMode: 'change', githubApiUrl: 'https://api.github.com', githubToken: 'github-cli-transport-does-not-read-token',
    fetchImpl: githubCliFetch, nowMs: Date.now(), maxAgeMs: PRODUCTION_VERIFY_PROOF_MAX_AGE_MS, expectedRunId: runId, expectedRunAttempt: runAttempt });
}
