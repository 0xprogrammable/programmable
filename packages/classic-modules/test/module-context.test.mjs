import test from 'node:test';
import assert from 'node:assert/strict';
import contextFixture from './module-context-fixture-v1.json' with { type: 'json' };
import { createModuleApiClient } from '../src/open-client.mjs';
import { runCli } from '../src/cli.mjs';
import { apiCapabilities, json, localServer, TEST_KEY } from './open-client-fixture.mjs';

async function contextServer(t, context = contextFixture) {
  return localServer(t, (request, response) => {
    if (request.url === '/v1/modules/capabilities') {
      assert.equal(request.headers.authorization, undefined);
      return json(response, 200, apiCapabilities());
    }
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/v1/modules/context');
    assert.equal(request.headers.authorization, `Bearer ${TEST_KEY}`);
    return json(response, 200, context);
  });
}

test('a fresh CLI session reads its wallet and submission prerequisites using either credential name', async (t) => {
  const { apiOrigin, seen } = await contextServer(t);
  for (const env of [{ PROGRAMMABLE_API_KEY: TEST_KEY }, { PROGRAMMABLE_MODULES_API_KEY: TEST_KEY },
    { PROGRAMMABLE_API_KEY: TEST_KEY, PROGRAMMABLE_MODULES_API_KEY: TEST_KEY }]) {
    let stdout = ''; let stderr = '';
    const code = await runCli(['module-context', '--api-origin', apiOrigin], {
      env, stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
    });
    assert.equal(code, 0, stderr);
    const result = JSON.parse(stdout);
    assert.equal(result.identity.author, contextFixture.identity.author);
    assert.equal(result.identity.defaultRewardWallet, result.identity.author);
    assert.deepEqual(result.inputs.requiredUserInput, ['idea']);
    assert.equal(result.authorization.canSubmit, true);
    assert.equal(result.intake.openRuntimeIdentifiers, true);
    assert.ok(result.review.limits.sourceBytes < result.intake.limits.sourceBytes);
    assert.equal(result.review.approval, 'manual');
    assert.equal(result.approved, false);
    assert.ok(!`${stdout}${stderr}`.includes(TEST_KEY));
  }
  assert.equal(seen.length, 6);
});

test('different credentials stop before requests and neither value is logged', async (t) => {
  const { apiOrigin, seen } = await contextServer(t);
  const secondKey = 'local_only_different_connection_123456789';
  let stdout = ''; let stderr = '';
  const code = await runCli(['module-context', '--api-origin', apiOrigin], {
    env: { PROGRAMMABLE_API_KEY: TEST_KEY, PROGRAMMABLE_MODULES_API_KEY: secondKey },
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
  });
  assert.equal(code, 1);
  assert.equal(JSON.parse(stderr).errors[0].code, 'MODULE_API_KEY_CONFLICT');
  assert.ok(!`${stdout}${stderr}`.includes(TEST_KEY) && !`${stdout}${stderr}`.includes(secondKey));
  assert.equal(seen.length, 0);
});

test('read-only and paused context remain useful without granting submission or approval', async (t) => {
  for (const pause of [false, true]) {
    const context = structuredClone(contextFixture);
    context.intake.available = !pause;
    context.authorization.scopes = ['modules:read'];
    context.authorization.missingScopes = ['modules:submit'];
    context.authorization.canSubmit = false;
    context.authorization.canRead = !pause;
    const { apiOrigin } = await contextServer(t, context);
    const result = await createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).context();
    assert.equal(result.authorization.canSubmit, false);
    assert.equal(result.approved, false);
  }
});

test('context rejects substituted wallets, scope claims, approval claims and reflected secrets', async (t) => {
  for (const mutate of [
    (value) => { value.identity.author = `0x${'0'.repeat(40)}`; },
    (value) => { value.identity.defaultRewardWallet = `0x${'2'.repeat(40)}`; },
    (value) => { value.authorization.scopes = ['modules:read']; },
    (value) => { value.intake.available = false; },
    (value) => { value.review.planRequired = false; },
    (value) => { value.approved = true; },
    (value) => { value.links.guide = TEST_KEY; },
  ]) {
    const context = structuredClone(contextFixture); mutate(context);
    const { apiOrigin } = await contextServer(t, context);
    await assert.rejects(createModuleApiClient({ apiOrigin, apiKey: TEST_KEY }).context(), { code: 'MODULE_CONTEXT_RESPONSE' });
  }
});
