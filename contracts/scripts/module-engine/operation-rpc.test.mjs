import test from 'node:test';
import assert from 'node:assert/strict';
import { anyQuoteClient, anyQuoteWalletStep } from './operation-rpc.mjs';
import { ENGINE_LIFECYCLE_OPERATOR_SCHEMA } from './publication-plan.mjs';

const address = '0x0000000000000000000000000000000000000001';
const call = { to: address, data: '0x12345678' };
const blockHash = `0x${'12'.repeat(32)}`;

function fixture(respond = () => '0x1234') {
  const requests = [[], []];
  const providers = requests.map((seen, index) => ({ rpc: async (method, params) => {
    seen.push(structuredClone({ method, params }));
    return respond(index, method, params);
  } }));
  const context = {
    pair: (pair, method, params) => Promise.all(pair.map(provider => provider.rpc(method, params))),
    same(values) {
      assert.deepEqual(values[0], values[1], 'Provider quorum disagrees');
      return values[0];
    },
  };
  const client = () => anyQuoteClient(providers, context, { number: '0x100' });
  return { requests, client };
}
const request = (client, method, params) => client.request({ method, params }, { retryCount: 0 });

for (const [method, input] of [['eth_call', call], ['eth_getCode', address]]) {
  test(`${method} coalesces concurrent and completed identical pinned reads through both providers`, async () => {
    const f = fixture(), client = f.client(), params = [input, '0x100'];
    assert.deepEqual(await Promise.all([request(client, method, params), request(client, method, structuredClone(params))]), ['0x1234', '0x1234']);
    assert.equal(await request(client, method, params), '0x1234');
    assert.deepEqual(f.requests.map(seen => seen.length), [1, 1]);
  });

  test(`${method} keeps different pinned block numbers and hashes distinct`, async () => {
    const f = fixture((_index, _method, params) => params[1]), client = f.client();
    for (const ref of ['0x100', '0x101', { blockHash, requireCanonical: true }, { blockHash: `0x${'34'.repeat(32)}`, requireCanonical: true }]) {
      assert.deepEqual(await request(client, method, [input, ref]), ref);
      assert.deepEqual(await request(client, method, [input, structuredClone(ref)]), ref);
    }
    assert.deepEqual(f.requests.map(seen => seen.length), [4, 4]);
  });

  test(`${method} never retains omitted, latest, pending or other symbolic block reads`, async () => {
    const f = fixture(), client = f.client();
    for (const params of [[input], ...['latest', 'pending', 'safe', 'finalized', 'earliest'].map(ref => [input, ref])]) {
      await request(client, method, params);
      await request(client, method, params);
    }
    assert.deepEqual(f.requests.map(seen => seen.length), [12, 12]);
  });
}

test('pinned calls retain all transaction and state-override parameters in their identity', async () => {
  const f = fixture(), client = f.client();
  for (const params of [[call, '0x100'], [{ ...call, data: '0x87654321' }, '0x100'], [{ ...call, from: address }, '0x100'], [call, '0x100', { [address]: { balance: '0x1' } }]]) {
    await request(client, 'eth_call', params);
    await request(client, 'eth_call', structuredClone(params));
  }
  assert.deepEqual(f.requests.map(seen => seen.length), [4, 4]);
});

for (const failure of ['quorum disagreement', 'provider rejection']) {
  test(`${failure} is shared in flight but removed so a later quorum read can succeed`, async () => {
    let fail = true;
    const f = fixture(index => {
      if (fail && index === 1) {
        if (failure === 'provider rejection') throw new Error('Provider unavailable');
        return '0x4321';
      }
      return '0x1234';
    }), client = f.client(), read = () => request(client, 'eth_call', [call, '0x100']);
    const failed = await Promise.allSettled([read(), read()]);
    assert.deepEqual(failed.map(result => result.status), ['rejected', 'rejected']);
    assert.match(failed[0].reason.message, /Provider quorum disagrees|Provider unavailable/);
    assert.deepEqual(f.requests.map(seen => seen.length), [1, 1]);
    fail = false;
    assert.equal(await read(), '0x1234');
    assert.equal(await read(), '0x1234');
    assert.deepEqual(f.requests.map(seen => seen.length), [2, 2]);
  });
}

test('canonical block reads remain fresh while latest block requests are still anchored', async () => {
  let hash = blockHash;
  const f = fixture(() => ({ hash })), client = f.client();
  for (const method of ['eth_getBlockByNumber', 'eth_getBlockByHash']) {
    const params = [method === 'eth_getBlockByNumber' ? 'latest' : blockHash, false];
    assert.deepEqual(await request(client, method, params), { hash });
    hash = `0x${'56'.repeat(32)}`;
    assert.deepEqual(await request(client, method, params), { hash });
  }
  assert.deepEqual(f.requests.map(seen => seen.length), [4, 4]);
  assert.deepEqual(f.requests[0][0].params, ['0x100', false]);
  assert.deepEqual(f.requests[1][1].params, ['0x100', false]);
});

test('gas, nonce, balances and receipt reads remain fresh even with explicit blocks', async () => {
  let value = '0x1';
  const f = fixture(() => value), client = f.client();
  for (const [method, params] of [['eth_estimateGas', [call, '0x100']], ['eth_getTransactionCount', [address, '0x100']],
    ['eth_getBalance', [address, '0x100']], ['eth_getTransactionReceipt', [blockHash]], ['eth_chainId', []]]) {
    assert.equal(await request(client, method, params), value);
    value = '0x2';
    assert.equal(await request(client, method, params), value);
  }
  assert.deepEqual(f.requests.map(seen => seen.length), [10, 10]);
});

test('separate Any Quote clients never share successful pinned reads across operation phases', async () => {
  let value = '0x1';
  const f = fixture(() => value), first = f.client();
  assert.equal(await request(first, 'eth_call', [call, '0x100']), '0x1');
  value = '0x2';
  assert.equal(await request(f.client(), 'eth_call', [call, '0x100']), '0x2');
  assert.deepEqual(f.requests.map(seen => seen.length), [2, 2]);
});

test('an approval-required sell result reports renewal instead of a malformed canonical preparation', () => {
  const plan = { schemaVersion: ENGINE_LIFECYCLE_OPERATOR_SCHEMA, identity: { sourceVersion: 'module-engine-any-quote-eth-v1' }, steps: [{ kind: 'any-quote-sell' }] };
  assert.throws(() => anyQuoteWalletStep(plan, 0, { kind: 'approval-required', allowanceKind: 'permit2' }), /Permit2.*approval.*renew/i);
  assert.throws(() => anyQuoteWalletStep(plan, 0, { kind: 'approval-required', allowanceKind: 'erc20' }), /token.*approval/i);
  assert.throws(() => anyQuoteWalletStep(plan, 0, {}), /Canonical Any Quote preparation required/);
});
