import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { encodeAbiParameters, keccak256 } from "viem";

import { RELEASE_GATED_FLAG_NAMES, WORKER_ACTIVATION_FLAG_NAMES } from "../perf/read-model-deploy-policy.mjs";
import { evaluateIndexedWebsiteReadDeployPolicy, readIndexedWebsiteSourceExpectations } from "../perf/indexed-website-read-deploy-policy.mjs";
import { runIndexedWebsiteReadSmoke } from "../smoke-indexed-website-reads.mjs";

const NOW = Date.parse("2026-09-09T03:00:00.000Z");
const UPDATED = new Date(NOW - 60_000).toISOString();
const ADDRESS = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const HASH = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const DIGEST = `sha256:${"a".repeat(64)}`;
const EXPECTATIONS = readIndexedWebsiteSourceExpectations();
const DEPLOYMENT_ID = `dpl_${"a".repeat(24)}`;
const SHA = "b".repeat(40);
const BYPASS = "fixture-protection-bypass-0123456789";
const PROJECT = "prj_programmablefixture";
const PROJECTION_SOURCE = "https://api.programmable.market/v4/chains/4663/finalized-launch-projections";

function sourceConfiguration(t, engineRelease) {
  const root = mkdtempSync(join(tmpdir(), "indexed-website-sources-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ["config/envio-classic-v4-catalog-release.v1.json", "config/module-mode/robinhood.preview.json",
    "config/module-engine/robinhood.json", "config/module-mode/historical-releases.json",
    "config/module-engine/historical-releases.json", "contracts/deployments/robinhood-custom-launch-v1.json"]) {
    const target = join(root, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file === "config/module-engine/robinhood.json" ? JSON.stringify(engineRelease) : readFileSync(file));
  }
  return root;
}

test("Any Quote retains its authentication version and uses the existing Engine index transport", async t => {
  const release = JSON.parse(readFileSync("tests/fixtures/module-engine-any-quote-index.json", "utf8")).cases[0].release;
  const root = sourceConfiguration(t, release), expectations = readIndexedWebsiteSourceExpectations(root);
  assert.deepEqual(expectations.robinhood.modules[1], { source: "module-engine-v1", sourceVersion: release.sourceVersion,
    sourceAddress: release.contracts.host.address, releaseDigest: release.releaseDigest, startBlock: release.startBlock });
  assert.equal(JSON.parse(readFileSync(join(root, "config/module-engine/robinhood.json"), "utf8")).sourceVersion, "module-engine-any-quote-v1");
  assert.deepEqual(expectations.robinhood.modules.filter((_value, index) => index !== 1), EXPECTATIONS.robinhood.modules.filter((_value, index) => index !== 1));
  const observations = transport => fixture(({ url, spec }) => {
    if (url.pathname !== "/api/explore/robinhood") return;
    const expected = expectations.robinhood.modules[1];
    const source = { ...robinhoodSource(), source: transport, sourceAddress: expected.sourceAddress,
      releaseDigest: expected.releaseDigest, startBlock: expected.startBlock };
    spec.body.sourceEvidence.modules = [source];
    spec.body.items = [{ ...robinhoodItem(), sourceKind: "module-engine-v1", sourceAddress: source.sourceAddress,
      sourceReleaseDigest: source.releaseDigest, routerAddress: null, stampHash: null, verificationDigest: HASH(2222) }];
  });
  const f = observations("module-engine-v1");
  assert.equal((await runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl, sourceExpectations: expectations }))).chains[1].totalItems, 1);
  await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: observations(release.sourceVersion).fetchImpl, sourceExpectations: expectations })), /module release binding/u);
});

test("source expectations reject unsupported authentication versions and wrong source-role dispatch", t => {
  const release = JSON.parse(readFileSync("tests/fixtures/module-engine-any-quote-index.json", "utf8")).cases[0].release;
  for (const mutate of [
    value => { value.sourceVersion = "module-engine-any-quote-v2"; },
    value => { value.sourceVersion = "module-native-v2"; },
    value => { value.contracts.launcher = value.contracts.host; delete value.contracts.host; },
    value => { value.chainId = 1; },
    value => { value.releaseDigest = HASH(0); },
    value => { value.startBlock = "0"; },
  ]) {
    const changed = structuredClone(release); mutate(changed);
    assert.throws(() => readIndexedWebsiteSourceExpectations(sourceConfiguration(t, changed)), /Robinhood release identity is invalid/u);
  }
  for (const source of EXPECTATIONS.robinhood.modules) assert.equal(source.source,
    source.sourceVersion === "module-engine-any-quote-v1" ? "module-engine-v1" : source.sourceVersion);
});

function ethereumItem(n) {
  const tokenAddress = ADDRESS(n);
  const launchId = `1:${tokenAddress}`;
  return { launchId, tokenAddress, creator: ADDRESS(1000), hookAddress: EXPECTATIONS.ethereum.hooks[0],
    transactionHash: HASH(n), blockNumber: "25900000", name: `Ethereum ${n}`, symbol: `E${n}`, decimals: 18,
    launchedAt: UPDATED, category: "classic", provenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1", source: "canonical-launch-read-model",
      category: "classic", recordId: launchId, modelId: "classic", modelVersion: "classic-v4",
    } };
}

function robinhoodSource() {
  return { source: "canonical-launch-stamp-router", sourceAddress: EXPECTATIONS.robinhood.routerAddress,
    binding: HASH(1000), startBlock: EXPECTATIONS.robinhood.startBlock, cursor: { number: "60000000", hash: HASH(2000) },
    finalizedBlock: "60000000", updatedAt: UPDATED };
}

function robinhoodItem() {
  return { tokenAddress: ADDRESS(100), launchId: HASH(100), creator: ADDRESS(1000), transactionHash: HASH(100),
    routerAddress: EXPECTATIONS.robinhood.routerAddress, blockNumber: "59000000", blockHash: HASH(3000),
    stampHash: HASH(1234), name: "Robinhood coin", symbol: "RHC", decimals: 18, launchedAt: UPDATED };
}

function projectedLaunch({ sourceVersion = "custom_launch_plan_v1", primary = false, market = false } = {}) {
  const components = [{ componentId: "settlement", artifactId: "unknown-project", expectedAddress: ADDRESS(200), runtimeCodeHash: HASH(200) }];
  const markets = market ? [1, 2].map(n => ({ marketId: `market-${n}`, kind: "uniswap_v4", poolManager: ADDRESS(500),
    currency0: { address: ADDRESS(0) }, currency1: { componentId: "settlement" }, hooks: { address: ADDRESS(201) }, fee: n * 100, tickSpacing: n })) : [];
  const projection = { schemaVersion: "programmable.launch-projection.v1", sourceVersion,
    launchId: "312b9b12-4fba-4147-b039-cc164fd580dc", chainId: "4663", controller: ADDRESS(1000),
    createdAt: UPDATED, finalizedAt: UPDATED, manifestDigest: sourceVersion === "multi_role_v2" ? null : DIGEST,
    planHash: sourceVersion === "multi_role_v2" ? null : DIGEST, components, markets,
    primaryComponentId: primary ? "settlement" : null, primaryMarketId: market ? "market-2" : null, publication: null,
    assuranceClaims: [], claimDescriptors: [], sourceVerification: "verified",
    distribution: { programmableRouting: "untested", uniswapApi: "not_requested", uniswapLabsRouting: "unknown", hooklist: "not_requested" },
    finality: { status: "final", transactionHashes: [HASH(200)], blockNumber: "59000000", blockHash: HASH(200),
      witness: { kind: "chain_read", ref: "fixture:finality", details: { fixture: true } } } };
  return { sourceKind: sourceVersion === "multi_role_v2" ? "multi-role-v2" : "custom-launch-plan-v1", launchProjection: projection,
    primaryAssetAddress: primary ? ADDRESS(200) : null, routerAddress: null, stampHash: null,
    launchId: projection.launchId, tokenAddress: ADDRESS(200), creator: projection.controller,
    hookAddress: market ? ADDRESS(201) : null, poolManager: market ? ADDRESS(500) : null,
    poolId: market ? keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [ADDRESS(0), ADDRESS(200), 200, 2, ADDRESS(201)])) : null,
    transactionHash: HASH(200), blockNumber: "59000000", blockHash: HASH(200), logIndex: 0,
    launchedAt: UPDATED, name: null, symbol: null, decimals: null };
}

function projectedFixture({ rows = [projectedLaunch()], updatedAt = UPDATED, nextCursor = null, status = "ready", mutate = () => {} } = {}) {
  return fixture(context => {
    const { url, spec } = context;
    if (url.pathname === "/api/explore/robinhood") {
      spec.body.items = structuredClone(rows);
      spec.body.presentations = [];
      spec.body.updatedAt = [UPDATED, updatedAt].sort()[0];
      spec.body.sourceEvidence.launchProjections = { sourceUrl: PROJECTION_SOURCE, updatedAt, nextCursor };
      spec.body.status = status;
      spec.headers["x-programmable-indexing-status"] = status;
      spec.body.page.totalItems = rows.length;
    }
    if (url.pathname.startsWith("/token/") && !url.searchParams.has("chain")) {
      spec.text = `<main><h1>Unnamed contract</h1><a href="/explore/robinhood">Explore</a>` +
        `<a href="https://robinhoodchain.blockscout.com/address/${rows[0].tokenAddress}">Explorer</a></main>`;
    }
    mutate(context);
  });
}

function listBody(chainId, page) {
  const ethereum = chainId === 1;
  const items = ethereum ? Array.from({ length: 51 }, (_, index) => ethereumItem(index + 1)) : [robinhoodItem()];
  const selected = items.slice((page - 1) * 50, page * 50);
  const body = { chainId, status: ethereum ? "stale" : "ready", updatedAt: UPDATED, items: selected,
    presentations: selected.map(item => ({ tokenAddress: item.tokenAddress, imageUrl: null, description: null, links: [], market: null })),
    page: { number: page, size: 50, totalItems: items.length, totalPages: Math.ceil(items.length / 50), hasMore: page < Math.ceil(items.length / 50) } };
  return ethereum ? { ...body, sources: { classic: "current", custom: "last-known-good" }, sourceEvidence: {
    classic: { source: "envio-classic-v3", deployment: EXPECTATIONS.ethereum.deployment,
      sourceCommit: EXPECTATIONS.ethereum.sourceCommit, commitment: DIGEST, generatedAt: UPDATED, asOfBlock: "25930000", asOfBlockHash: HASH(567) },
    custom: { source: "canonical-launch-stamp-router", commitment: DIGEST, generatedAt: UPDATED, asOfBlock: "25930000", asOfBlockHash: HASH(567) },
  } } : { ...body, sourceEvidence: { router: robinhoodSource(), modules: [] } };
}

function fixture(mutate = () => {}) {
  const calls = [];
  let bindingCount = 0;
  const fetchImpl = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init, headers: new Headers(init.headers) });
    let spec;
    if (url.hostname === "api.vercel.com") {
      bindingCount += 1;
      spec = { body: { id: DEPLOYMENT_ID, url: "candidate.vercel.app", projectId: PROJECT,
        readyState: "READY", meta: { githubCommitSha: SHA } }, status: 200, headers: { "content-type": "application/json" } };
    } else if (url.pathname.startsWith("/api/explore/")) {
      const body = listBody(url.pathname.endsWith("ethereum") ? 1 : 4663, Number(url.searchParams.get("page")));
      spec = { body, status: 200, headers: { "content-type": "application/json", "x-content-type-options": "nosniff",
        "x-programmable-indexing-status": body.status } };
    } else if (url.pathname.startsWith("/token/")) {
      const ethereum = url.searchParams.get("chain") === "1";
      const item = ethereum ? ethereumItem(1) : robinhoodItem();
      spec = { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, text: `<html>` +
        `<nav><a href="https://dexscreener.com/robinhood/${HASH(100)}">Official token</a></nav><main><h1>${item.name}</h1>` +
        `<a href="/explore/${ethereum ? "ethereum" : "robinhood"}">Explore</a>` +
        `<a href="https://${ethereum ? "etherscan.io" : "robinhoodchain.blockscout.com"}/token/${item.tokenAddress}">Explorer</a></main></html>` };
    } else throw new Error(`unexpected fixture path ${url.pathname}`);
    mutate({ url, spec, bindingCount });
    return new Response(spec.text ?? JSON.stringify(spec.body), { status: spec.status, headers: spec.headers });
  };
  return { calls, fetchImpl };
}

function input(overrides = {}) {
  return { targetKind: "staged", targetUrl: "https://candidate.vercel.app", deploymentId: DEPLOYMENT_ID,
    gitHead: SHA, projectId: PROJECT, teamId: "team_fixture", token: "fixture-vercel-token",
    automationBypassSecret: BYPASS, sourceExpectations: EXPECTATIONS, nowMs: NOW, ...overrides };
}

test("website read policy retains every legacy API and retired worker flag gate", () => {
  const contents = RELEASE_GATED_FLAG_NAMES.map(name => `${name}=false`).join("\n");
  const policy = evaluateIndexedWebsiteReadDeployPolicy(contents);
  assert.equal(policy.mode, "indexed-website-read");
  assert.equal(policy.policyReady, true);
  assert.equal(policy.runtimeEvidenceRequired, true);
  assert.equal(policy.runtimeVerified, false);
  assert.equal(policy.publicReadAuthentication, "none");
  for (const name of [...RELEASE_GATED_FLAG_NAMES, ...WORKER_ACTIVATION_FLAG_NAMES]) {
    const active = contents.includes(`${name}=`) ? contents.replace(`${name}=false`, `${name}=true`) : `${contents}\n${name}=true`;
    assert.equal(evaluateIndexedWebsiteReadDeployPolicy(active).policyReady, false, name);
  }
  assert.equal(evaluateIndexedWebsiteReadDeployPolicy("").policyReady, false);
});

test("staged smoke scans complete catalogs and token pages with only the protection bypass", async () => {
  const f = fixture();
  const result = await runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl }));
  assert.equal(result.mode, "indexed-website-read");
  assert.equal(result.deploymentId, DEPLOYMENT_ID);
  assert.equal(result.gitHead, SHA);
  assert.equal(result.publicReadAuthentication, "none");
  assert.deepEqual(result.chains.map(({ chainId, status, totalItems }) => ({ chainId, status, totalItems })), [
    { chainId: 1, status: "stale", totalItems: 51 }, { chainId: 4663, status: "ready", totalItems: 1 },
  ]);
  assert.equal(result.chains[0].pages.length, 2);
  assert.equal(result.chains[0].pages[0].sources.custom, "last-known-good");
  assert.equal(f.calls.filter(call => call.url.hostname === "api.vercel.com").length, 2);
  for (const call of f.calls.filter(call => call.url.hostname !== "api.vercel.com")) {
    assert.equal(call.url.origin, "https://candidate.vercel.app");
    assert.equal(call.init.method, "GET");
    assert.equal(call.init.redirect, "error");
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.cache, "no-store");
    assert.equal(call.headers.get("authorization"), null);
    assert.equal(call.headers.get("cookie"), null);
    assert.equal(call.headers.get("x-vercel-protection-bypass"), BYPASS);
    assert.equal(call.headers.get("x-vercel-set-bypass-cookie"), "false");
    assert.ok(call.init.signal instanceof AbortSignal);
  }
  assert.doesNotMatch(JSON.stringify(result), /fixture-vercel-token|fixture-protection-bypass/u);
});

test("production observation uses the canonical domain without authentication or bypass", async () => {
  const f = fixture();
  const result = await runIndexedWebsiteReadSmoke(input({ targetKind: "production", targetUrl: "https://programmable.market", fetchImpl: f.fetchImpl }));
  assert.equal(result.targetKind, "production");
  for (const call of f.calls.filter(call => call.url.hostname !== "api.vercel.com")) {
    assert.equal(call.url.origin, "https://programmable.market");
    assert.equal(call.headers.get("authorization"), null);
    assert.equal(call.headers.get("x-vercel-protection-bypass"), null);
    assert.equal(call.headers.get("cookie"), null);
  }
});

test("staged smoke accepts historical and new projected identities without requiring an asset or market", async () => {
  for (const options of [{}, { primary: true, market: true }, { sourceVersion: "multi_role_v2", primary: true }]) {
    const row = projectedLaunch(options);
    const f = projectedFixture({ rows: [row] });
    const result = await runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl }));
    assert.equal(result.chains[1].totalItems, 1);
    assert.equal(result.chains[1].pages[0].sourceEvidence.launchProjections.sourceUrl, PROJECTION_SOURCE);
    assert.equal(result.chains[1].tokenPage.tokenAddress, row.tokenAddress);
    assert.ok(f.calls.every(call => ["api.vercel.com", "candidate.vercel.app"].includes(call.url.hostname)));
  }
});

test("projected source timestamps and pagination retain ready, stale and syncing meanings", async () => {
  for (const options of [{ updatedAt: new Date(NOW - 301_000).toISOString(), status: "stale" },
    { updatedAt: new Date(NOW - 120_000).toISOString(), nextCursor: "more", status: "syncing" }]) {
    const f = projectedFixture(options);
    const result = await runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl }));
    assert.equal(result.chains[1].status, options.status);
    assert.equal(result.chains[1].pages[0].updatedAt, options.updatedAt);
  }
  for (const options of [{ updatedAt: new Date(NOW - 301_000).toISOString() }, { nextCursor: "more" }]) {
    const f = projectedFixture(options);
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl })), /ready checkpoint/u);
  }
});

test("independent projected launches may reuse a component but a duplicate launch remains invalid", async () => {
  const first = projectedLaunch();
  const second = projectedLaunch();
  second.launchId = second.launchProjection.launchId = "a-second-launch";
  const f = projectedFixture({ rows: [first, second] });
  const result = await runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl }));
  assert.equal(result.chains[1].totalItems, 2);
  const duplicate = projectedFixture({ rows: [first, first] });
  await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: duplicate.fetchImpl })), /duplicate launch/u);
});

test("projected rows cannot forge source, controller, component, market, finality or provider states", async () => {
  for (const mutate of [
    body => { body.sourceEvidence.launchProjections.sourceUrl = "https://untrusted.invalid/feed"; },
    body => { body.sourceEvidence.launchProjections.updatedAt = new Date(NOW + 120_000).toISOString(); },
    body => { body.sourceEvidence.launchProjections = null; },
    body => { body.items[0].launchProjection.sourceVersion = "multi_role_v2"; },
    body => { body.items[0].launchProjection.chainId = "1"; },
    body => { body.items[0].launchProjection.controller = ADDRESS(9); },
    body => { body.items[0].launchProjection.finality.status = "pending"; },
    body => { body.items[0].launchProjection.finality.witness = null; },
    body => { body.items[0].launchProjection.finality.transactionHashes = [HASH(9)]; },
    body => { body.items[0].launchProjection.distribution.uniswapLabsRouting = "guaranteed"; },
    body => { body.items[0].launchProjection.components[0].expectedAddress = ADDRESS(9); },
    body => { body.items[0].launchProjection.primaryComponentId = "missing"; },
    body => { body.items[0].primaryAssetAddress = null; },
    body => { body.items[0].poolId = HASH(9); },
    body => { body.items[0].launchProjection.markets[1].hooks = { componentId: "missing" }; },
    body => { body.items[0].launchProjection.primaryMarketId = "missing"; },
    body => { body.items[0].routerAddress = ADDRESS(9); },
  ]) {
    const f = projectedFixture({ rows: [projectedLaunch({ primary: true, market: true })],
      mutate: ({ url, spec }) => { if (url.pathname === "/api/explore/robinhood") mutate(spec.body); } });
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl })), /indexed website/u);
  }
  const wrongDetail = projectedFixture({ mutate: ({ url, spec }) => {
    if (url.pathname.startsWith("/token/") && !url.searchParams.has("chain")) spec.text = spec.text.replace("/address/", "/token/");
  } });
  await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: wrongDetail.fetchImpl })), /chain links/u);
});

test("current Ethereum sources, finalized module sources and stale observations retain their meaning", async () => {
  const f = fixture(({ url, spec }) => {
    if (url.pathname === "/api/explore/ethereum") {
      spec.body.status = "ready";
      spec.body.sources.custom = "current";
      spec.headers["x-programmable-indexing-status"] = "ready";
    }
    if (url.pathname === "/api/explore/robinhood") {
      spec.body.status = "stale";
      spec.headers["x-programmable-indexing-status"] = "stale";
      for (const [index, expected] of EXPECTATIONS.robinhood.modules.entries()) {
        const source = { ...robinhoodSource(), ...expected };
        spec.body.sourceEvidence.modules.push(source);
        spec.body.items.push({ ...robinhoodItem(), tokenAddress: ADDRESS(101 + index), launchId: HASH(101 + index),
          sourceKind: source.source, sourceAddress: source.sourceAddress, sourceReleaseDigest: source.releaseDigest,
          routerAddress: null, stampHash: null, verificationDigest: HASH(2222) });
      }
      spec.body.page.totalItems = spec.body.items.length;
    }
  });
  const result = await runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl }));
  assert.equal(result.chains[0].status, "ready");
  assert.equal(result.chains[1].status, "stale");
  assert.equal(result.chains[1].totalItems, 1 + EXPECTATIONS.robinhood.modules.length);

  const delayed = fixture(({ url, spec }) => {
    if (url.pathname === "/api/explore/ethereum" && spec.body.page.number === 1) {
      spec.body.status = "ready";
      spec.body.sources.custom = "current";
      spec.headers["x-programmable-indexing-status"] = "ready";
    }
  });
  const delayResult = await runIndexedWebsiteReadSmoke(input({ fetchImpl: delayed.fetchImpl }));
  assert.equal(delayResult.chains[0].status, "stale");
});

test("wrong source, partial source and unsupported ready claims fail closed", async () => {
  for (const mutate of [
    body => { body.chainId = 4663; },
    body => { body.sources.custom = "unavailable"; body.status = "partial"; },
    body => { body.status = "ready"; },
    body => { body.sourceEvidence.classic.sourceCommit = "c".repeat(40); },
    body => { body.sourceEvidence.classic.asOfBlockHash = "unknown"; },
    body => { body.sourceEvidence.classic.generatedAt = new Date(NOW + 120_000).toISOString(); },
    body => { body.sourceEvidence.custom = null; },
    body => { body.items[0].provenance.source = "interface-preview"; },
    body => { body.items[0].launchId = `4663:${body.items[0].tokenAddress}`; },
    body => { body.items[0].hookAddress = EXPECTATIONS.robinhood.routerAddress; },
  ]) {
    const f = fixture(({ url, spec }) => { if (url.pathname === "/api/explore/ethereum") mutate(spec.body); });
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl })), /indexed website/u);
  }
});

test("count corruption, duplicate pages and crossed presentation identities fail", async () => {
  for (const mutate of [
    body => { body.page.totalItems = 0; },
    body => { body.page.totalPages += 1; },
    body => { body.page.hasMore = !body.page.hasMore; },
    body => { body.presentations[0].tokenAddress = ADDRESS(100); },
    body => { body.presentations[0].links = [{ url: `https://robinhoodchain.blockscout.com/token/${ADDRESS(1)}` }]; },
    body => { body.presentations[0].links = [{ url: `/token/${ADDRESS(1)}` }]; },
    body => { if (body.page.number === 2) body.items[0] = ethereumItem(1); },
  ]) {
    const f = fixture(({ url, spec }) => { if (url.pathname === "/api/explore/ethereum") mutate(spec.body); });
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl })), /indexed website/u);
  }
});

test("Robinhood source checkpoints, exact source bindings and market chain are checked", async () => {
  for (const mutate of [
    body => { body.sourceEvidence.router.sourceAddress = ADDRESS(567); },
    body => { body.sourceEvidence.router.cursor.number = "61000000"; },
    body => { body.sourceEvidence.router.updatedAt = new Date(NOW + 120_000).toISOString(); },
    body => { body.items[0].routerAddress = ADDRESS(567); },
    body => { body.items[0].sourceKind = "module-engine-v1"; },
    body => { body.presentations[0].market = { sourceUrl: "https://dexscreener.com/ethereum/0x123" }; },
  ]) {
    const f = fixture(({ url, spec }) => { if (url.pathname === "/api/explore/robinhood") mutate(spec.body); });
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl })), /indexed website/u);
  }
});

test("application auth, HTML masquerading as JSON, oversize bodies and broken token pages fail", async () => {
  for (const mutate of [
    ({ url, spec }) => { if (url.pathname === "/api/explore/ethereum") spec.status = 401; },
    ({ url, spec }) => { if (url.pathname === "/api/explore/ethereum") spec.headers["content-type"] = "text/html"; },
    ({ url, spec }) => { if (url.pathname === "/api/explore/ethereum") spec.text = "x".repeat(2 * 1024 * 1024 + 1); },
    ({ url, spec }) => { if (url.pathname.startsWith("/token/")) spec.status = 404; },
    ({ url, spec }) => { if (url.pathname.startsWith("/token/")) spec.text = "<h1>Token details</h1>"; },
    ({ url, spec }) => { if (url.pathname.startsWith("/token/")) spec.text = spec.text.replace("/explore/ethereum", "/explore/robinhood"); },
  ]) {
    const f = fixture(mutate);
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl })), /indexed website/u);
  }
});

test("exact deployment binding must hold before and after the observations", async () => {
  for (const failedBinding of [1, 2]) {
    const f = fixture(({ url, spec, bindingCount }) => {
      if (url.hostname === "api.vercel.com" && bindingCount === failedBinding) spec.body.meta.githubCommitSha = "c".repeat(40);
    });
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ fetchImpl: f.fetchImpl })), /exact staged deployment binding/u);
    if (failedBinding === 1) assert.equal(f.calls.length, 1);
  }
  for (const targetUrl of ["http://candidate.vercel.app", "https://candidate.vercel.app/path", "https://attacker.example", "https://user:password@candidate.vercel.app"]) {
    const f = fixture();
    await assert.rejects(runIndexedWebsiteReadSmoke(input({ targetUrl, fetchImpl: f.fetchImpl })), /target/u);
    assert.equal(f.calls.length, 0);
  }
});

test("workflow requires separate website policy, bound smoke and retained evidence before preview handoff", () => {
  const workflow = readFileSync(".github/workflows/deploy-production.yml", "utf8");
  const step = name => {
    const start = workflow.indexOf(`      - name: ${name}`);
    assert.notEqual(start, -1, name);
    const end = workflow.indexOf("\n      - name:", start + 1);
    return workflow.slice(start, end < 0 ? undefined : end);
  };
  const policy = step("Validate indexed website read policy");
  assert.match(policy, /perf:indexed-website:deploy-policy/u);
  assert.match(policy, /--env-file \.vercel\/\.env\.production\.local/u);
  const smoke = step("Smoke exact staged indexed website reads");
  assert.match(smoke, /steps\.staged-deployment\.outputs\.target_url/u);
  assert.match(smoke, /steps\.staged-deployment\.outputs\.deployment_id/u);
  assert.match(smoke, /needs\.release-gate\.outputs\.verified_sha/u);
  assert.match(smoke, /steps\.indexed-website-policy\.outputs\.mode/u);
  assert.match(smoke, /npm run smoke:indexed-website-reads/u);
  assert.doesNotMatch(policy + smoke, /continue-on-error|\n        if:/u);
  assert.ok(workflow.indexOf("Smoke exact staged indexed website reads") < workflow.indexOf("Reverify staged candidate binding"));
  assert.match(step("Preserve exact indexed website read evidence"), /if-no-files-found: error/u);
  const handoff = step("Record staged candidate handoff");
  assert.match(handoff, /Legacy Explore API indexing status/u);
  assert.match(handoff, /Ethereum website catalog/u);
  assert.match(handoff, /Robinhood website catalog/u);
  assert.match(handoff, /last-known-good source states/u);
  assert.doesNotMatch(handoff, /Expected external indexing calls:/u);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  for (const name of ["test", "test:interface:ci", "verify:custom-v2:checks:ci"]) {
    assert.match(pkg.scripts[name], /indexed-website-reads\.test\.mjs/u);
  }
});
