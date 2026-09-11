#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { encodeAbiParameters, keccak256 } from "viem";

import { readBoundedResponseText } from "./read-bounded-response.mjs";
import { verifyLiveVercelBinding } from "./perf/read-model-live-verifier.mjs";
import { verifyProductionDeploymentBinding } from "./perf/read-model-post-promotion.mjs";
import { canonicalJson } from "./perf/read-model-deploy-policy.mjs";
import {
  INDEXED_WEBSITE_READ_MODE, INDEXED_WEBSITE_ROUTES, readIndexedWebsiteSourceExpectations,
} from "./perf/indexed-website-read-deploy-policy.mjs";

const ADDRESS = /^0x(?!0{40}$)[0-9a-f]{40}$/iu;
const HASH = /^0x(?!0{64}$)[0-9a-f]{64}$/iu;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const BLOCK = /^(?:0|[1-9][0-9]{0,19})$/u;
const PAGE_SIZE = 50;
const MAXIMUM_ITEMS = 10_000;
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const PRODUCTION_ORIGIN = "https://programmable.market";
const LAUNCH_PROJECTION_SOURCE = "https://api.programmable.market/v4/chains/4663/finalized-launch-projections";
const LAUNCH_CONTRACT_URL = "https://programmable.market/openapi/custom-launch-v4.2.json";
const projectionValidator = new Ajv2020({ strict: false });
addFormats(projectionValidator);
projectionValidator.addSchema(JSON.parse(readFileSync(new URL("../public/openapi/custom-launch-v4.2.json", import.meta.url), "utf8")), LAUNCH_CONTRACT_URL);
const validateProjection = projectionValidator.compile({ $ref: `${LAUNCH_CONTRACT_URL}#/components/schemas/LaunchProjectionV1` });
const same = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const check = (condition, label) => { if (!condition) throw new Error(`indexed website ${label} is invalid`); };
const hash = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function timestamp(value, nowMs) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value && Date.parse(value) <= nowMs + 60_000;
}

function exactTarget(value, kind) {
  let target;
  try { target = new URL(value); } catch { throw new Error("indexed website target is invalid"); }
  check(target.protocol === "https:" && target.username === "" && target.password === "" &&
    target.port === "" && target.pathname === "/" && target.search === "" && target.hash === "" &&
    (kind === "staged" ? target.hostname.endsWith(".vercel.app") : kind === "production" && target.origin === PRODUCTION_ORIGIN), "target");
  return target;
}

function validateSources(body, route, expectations, nowMs) {
  check(timestamp(body.updatedAt, nowMs), "catalog timestamp");
  if (route.chainId === 1) {
    check(record(body.sources) && Object.keys(body.sources).sort().join(",") === "classic,custom" && record(body.sourceEvidence), "Ethereum sources");
    for (const name of ["classic", "custom"]) {
      const source = body.sourceEvidence[name];
      check(["current", "last-known-good"].includes(body.sources[name]) && record(source) &&
        source.source === (name === "classic" ? "envio-classic-v3" : "canonical-launch-stamp-router") &&
        BLOCK.test(source.asOfBlock ?? "") && HASH.test(source.asOfBlockHash ?? "") && DIGEST.test(source.commitment ?? "") &&
        timestamp(source.generatedAt, nowMs), "Ethereum source evidence");
    }
    const classic = body.sourceEvidence.classic;
    check(classic.deployment === expectations.ethereum.deployment && classic.sourceCommit === expectations.ethereum.sourceCommit,
      "Ethereum source release binding");
    check(body.updatedAt === [classic.generatedAt, body.sourceEvidence.custom.generatedAt].sort()[0], "Ethereum oldest source timestamp");
    check(body.status === (Object.values(body.sources).every(value => value === "current") ? "ready" : "stale"), "Ethereum source status");
  } else {
    const evidence = body.sourceEvidence;
    check(record(evidence) && record(evidence.router) && Array.isArray(evidence.modules) && evidence.modules.length <= 32,
      "Robinhood sources");
    const sources = [evidence.router, ...evidence.modules];
    const addresses = new Set();
    for (const source of sources) {
      check(record(source) && ADDRESS.test(source.sourceAddress ?? "") &&
        BLOCK.test(source.startBlock ?? "") && BLOCK.test(source.finalizedBlock ?? "") && record(source.cursor) &&
        BLOCK.test(source.cursor.number ?? "") && HASH.test(source.cursor.hash ?? "") && timestamp(source.updatedAt, nowMs) &&
        BigInt(source.cursor.number) >= BigInt(source.startBlock) && BigInt(source.cursor.number) <= BigInt(source.finalizedBlock),
      "Robinhood source checkpoint");
      check(!addresses.has(source.sourceAddress.toLowerCase()), "Robinhood duplicate source");
      addresses.add(source.sourceAddress.toLowerCase());
      if (source === evidence.router) {
        check(source.source === "canonical-launch-stamp-router" && HASH.test(source.binding ?? "") &&
          same(source.sourceAddress, expectations.robinhood.routerAddress) && source.startBlock === expectations.robinhood.startBlock,
        "Robinhood Router binding");
      } else {
        check(expectations.robinhood.modules.some(expected => expected.source === source.source &&
          same(expected.sourceAddress, source.sourceAddress) && same(expected.releaseDigest, source.releaseDigest) &&
          expected.startBlock === source.startBlock), "Robinhood module release binding");
      }
    }
    const projection = evidence.launchProjections;
    if (projection != null) check(record(projection) && projection.sourceUrl === LAUNCH_PROJECTION_SOURCE &&
      timestamp(projection.updatedAt, nowMs) && (projection.nextCursor === null ||
        typeof projection.nextCursor === "string" && projection.nextCursor.length <= 4096), "Robinhood projection source");
    check(body.updatedAt === [...sources, ...(projection ? [projection] : [])].map(source => source.updatedAt).sort()[0], "Robinhood oldest source timestamp");
    if (body.status === "ready") check(sources.every(source => source.cursor.number === source.finalizedBlock &&
      nowMs - Date.parse(source.updatedAt) <= 300_000) && (!projection ||
      projection.nextCursor === null && nowMs - Date.parse(projection.updatedAt) <= 300_000), "Robinhood ready checkpoint");
  }
}

function projectedItem(item) {
  return item.sourceKind === "multi-role-v2" || item.sourceKind === "custom-launch-plan-v1";
}

function launchIdentity(item) {
  return projectedItem(item) ? `${item.sourceKind}:${item.launchId}` : item.tokenAddress.toLowerCase();
}

function validateProjectedItem(item, sources) {
  const projection = item.launchProjection;
  check(sources.launchProjections?.sourceUrl === LAUNCH_PROJECTION_SOURCE && validateProjection(projection) &&
    projection.chainId === "4663" && projection.sourceVersion === (item.sourceKind === "multi-role-v2" ? "multi_role_v2" : "custom_launch_plan_v1") &&
    projection.finality.status === "final" && projection.finality.transactionHashes.length > 0 &&
    projection.finality.blockNumber !== null && projection.finality.blockHash !== null && projection.finality.witness !== null &&
    item.launchId === projection.launchId && same(item.creator, projection.controller) &&
    item.blockNumber === projection.finality.blockNumber && same(item.blockHash, projection.finality.blockHash) &&
    same(item.transactionHash, projection.finality.transactionHashes.at(-1)) &&
    item.routerAddress === null && item.stampHash === null, "Robinhood projected launch provenance");
  const primary = projection.components.find(component => component.componentId === projection.primaryComponentId);
  const identity = primary ?? projection.components[0];
  const componentIds = new Set(projection.components.map(component => component.componentId));
  check(identity && componentIds.size === projection.components.length &&
    (projection.primaryComponentId === null || primary) && same(item.tokenAddress, identity.expectedAddress) &&
    (primary ? same(item.primaryAssetAddress, primary.expectedAddress) : item.primaryAssetAddress === null), "Robinhood projected component identity");
  const addressFor = reference => {
    const address = reference.address ?? projection.components.find(component => component.componentId === reference.componentId)?.expectedAddress;
    check(/^0x[0-9a-f]{40}$/iu.test(address ?? ""), "Robinhood projected market reference");
    return address;
  };
  for (const market of projection.markets) for (const reference of [market.currency0, market.currency1, market.hooks]) addressFor(reference);
  const primaryMarket = projection.markets.find(market => market.marketId === projection.primaryMarketId);
  check(new Set(projection.markets.map(market => market.marketId)).size === projection.markets.length &&
    (projection.primaryMarketId === null || primaryMarket), "Robinhood projected primary market");
  if (primaryMarket) {
    const poolId = keccak256(encodeAbiParameters([{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [addressFor(primaryMarket.currency0), addressFor(primaryMarket.currency1), primaryMarket.fee, primaryMarket.tickSpacing, addressFor(primaryMarket.hooks)]));
    check(same(item.poolManager, primaryMarket.poolManager) && same(item.hookAddress, addressFor(primaryMarket.hooks)) && same(item.poolId, poolId),
      "Robinhood projected market identity");
  } else check(item.poolManager === null && item.hookAddress === null && item.poolId === null, "Robinhood no-market projection");
}

function validateItem(item, body, route, expectations) {
  check(record(item) && ADDRESS.test(item.tokenAddress ?? "") && ADDRESS.test(item.creator ?? "") &&
    HASH.test(item.transactionHash ?? "") && BLOCK.test(item.blockNumber ?? "") &&
    (item.chainId === undefined || item.chainId === route.chainId), "launch identity");
  if (route.chainId === 1) {
    const provenance = item.provenance;
    check(ADDRESS.test(item.hookAddress ?? "") && ["classic", "custom"].includes(item.category) && record(provenance) &&
      provenance.schemaVersion === "programmable.explore-launch-category-provenance.v1" && provenance.category === item.category,
    "Ethereum category provenance");
    if (provenance.source === "canonical-launch-read-model") {
      check(item.category === "classic" && item.launchId === `1:${item.tokenAddress.toLowerCase()}` &&
        provenance.recordId === item.launchId && expectations.ethereum.hooks.includes(item.hookAddress.toLowerCase()) &&
        BigInt(item.blockNumber) <= BigInt(body.sourceEvidence.classic.asOfBlock),
      "Ethereum canonical identity");
    } else {
      check(provenance.source === "canonical-launch-stamp-router" && HASH.test(item.launchId ?? "") &&
        same(provenance.launchId, item.launchId) && ADDRESS.test(provenance.routerAddress ?? "") &&
        !same(provenance.routerAddress, expectations.robinhood.routerAddress) &&
        HASH.test(provenance.stampHash ?? "") && HASH.test(provenance.blockHash ?? "") &&
        same(provenance.transactionHash, item.transactionHash) && provenance.blockNumber === item.blockNumber &&
        BigInt(item.blockNumber) <= BigInt(body.sourceEvidence.custom.asOfBlock), "Ethereum Router identity");
    }
  } else {
    const sources = body.sourceEvidence;
    if (projectedItem(item)) {
      validateProjectedItem(item, sources);
      return;
    }
    const source = item.sourceKind === undefined ? sources.router : sources.modules.find(entry =>
      entry.source === item.sourceKind && same(entry.sourceAddress, item.sourceAddress) && same(entry.releaseDigest, item.sourceReleaseDigest));
    check(source && HASH.test(item.launchId ?? "") && HASH.test(item.blockHash ?? "") &&
      BigInt(item.blockNumber) >= BigInt(source.startBlock) && BigInt(item.blockNumber) <= BigInt(source.cursor.number), "Robinhood launch source");
    if (item.sourceKind === undefined) check(same(item.routerAddress, source.sourceAddress) && HASH.test(item.stampHash ?? ""), "Robinhood Router identity");
    else check(item.routerAddress === null && item.stampHash === null && HASH.test(item.verificationDigest ?? "") &&
      (item.primaryMarket == null || item.primaryMarket.chainId === 4663), "Robinhood module identity");
  }
}

function validateChainLink(value, route) {
  check(typeof value === "string" && value.length > 0, "link");
  let url;
  try { url = new URL(value, PRODUCTION_ORIGIN); } catch { check(false, "link"); }
  check(["https:", "http:"].includes(url.protocol) && !url.username && !url.password, "link");
  if (url.hostname === "etherscan.io") check(route.chainId === 1, "cross-chain explorer link");
  if (url.hostname === "robinhoodchain.blockscout.com") check(route.chainId === 4663, "cross-chain explorer link");
  if (url.hostname === "dexscreener.com") check(url.pathname.split("/")[1] === route.slug, "cross-chain market link");
  if (url.origin === PRODUCTION_ORIGIN && url.pathname.startsWith("/token/")) {
    check(ADDRESS.test(url.pathname.slice(7)) && (route.chainId === 1
      ? url.searchParams.get("chain") === "1" : [null, "4663"].includes(url.searchParams.get("chain"))), "cross-chain token link");
  }
}

export function validateIndexedWebsiteList({ body, response, route, pageNumber, expectations, nowMs }) {
  check(response.status === 200 && record(body) && body.chainId === route.chainId &&
    (route.chainId === 1 ? ["ready", "stale"] : ["ready", "stale", "syncing"]).includes(body.status) &&
    response.headers.get("x-programmable-indexing-status") === body.status &&
    response.headers.get("x-content-type-options") === "nosniff", `${route.slug} response status`);
  check(record(body.page) && body.page.number === pageNumber && body.page.size === PAGE_SIZE &&
    Number.isSafeInteger(body.page.totalItems) && body.page.totalItems > 0 && body.page.totalItems <= MAXIMUM_ITEMS &&
    body.page.totalPages === Math.ceil(body.page.totalItems / PAGE_SIZE) && body.page.hasMore === (pageNumber < body.page.totalPages) &&
    Array.isArray(body.items) && body.items.length === Math.min(PAGE_SIZE, body.page.totalItems - (pageNumber - 1) * PAGE_SIZE), "pagination");
  validateSources(body, route, expectations, nowMs);
  const identities = new Set();
  const addresses = new Set();
  for (const item of body.items) {
    validateItem(item, body, route, expectations);
    check(!identities.has(launchIdentity(item)), "duplicate launch identity");
    identities.add(launchIdentity(item));
    addresses.add(item.tokenAddress.toLowerCase());
  }
  check(Array.isArray(body.presentations), "presentations");
  const presented = new Set();
  for (const item of body.presentations) {
    check(record(item) && ADDRESS.test(item.tokenAddress ?? "") && addresses.has(item.tokenAddress.toLowerCase()) &&
      !presented.has(item.tokenAddress.toLowerCase()) && Array.isArray(item.links), "presentation identity");
    presented.add(item.tokenAddress.toLowerCase());
    for (const link of item.links) validateChainLink(link?.url, route);
    if (item.market !== null) {
      check(route.chainId === 4663 && record(item.market), "market source");
      validateChainLink(item.market.sourceUrl, route);
    }
  }
  return body;
}

function htmlText(value) {
  return value.replace(/&(?:amp|quot|lt|gt|#x27|#39);/gu,
    entity => ({ "&amp;": "&", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&#x27;": "'", "&#39;": "'" })[entity]);
}

async function observeReads(input, target, headers, observedAt) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const expectations = input.sourceExpectations ?? await readIndexedWebsiteSourceExpectations();
  async function request(path, contentType) {
    const url = new URL(path, target);
    check(url.origin === target.origin, "request origin");
    const response = await fetchImpl(url, { method: "GET", headers: { ...headers, accept: contentType },
      credentials: "omit", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== contentType) {
      await response.body?.cancel?.("unexpected content type").catch(() => {});
      throw new Error("indexed website response content type is invalid");
    }
    const text = await readBoundedResponseText(response, { maximumBytes: MAXIMUM_RESPONSE_BYTES, label: "indexed website response" });
    return { response, text, bodyDigest: hash(text) };
  }
  return Promise.all(INDEXED_WEBSITE_ROUTES.map(async route => {
    let first;
    const identities = new Set();
    const pages = [];
    for (let number = 1; number <= (first?.page.totalPages ?? 1); number += 1) {
      const result = await request(`${route.path}?page=${number}&pageSize=${PAGE_SIZE}&sort=newest&mode=all`, "application/json");
      let body;
      try { body = JSON.parse(result.text); } catch { throw new Error("indexed website JSON is invalid"); }
      validateIndexedWebsiteList({ body, response: result.response, route, pageNumber: number, expectations, nowMs: Date.parse(observedAt) });
      first ??= body;
      check(body.page.totalItems === first.page.totalItems, "catalog changed during pagination; rerun smoke");
      for (const item of body.items) {
        check(!identities.has(launchIdentity(item)), "duplicate launch across pages; rerun smoke");
        identities.add(launchIdentity(item));
      }
      pages.push({ number, status: body.status, count: body.items.length, updatedAt: body.updatedAt,
        sourceEvidence: body.sourceEvidence, ...(body.sources ? { sources: body.sources } : {}), bodyDigest: result.bodyDigest });
    }
    check(identities.size === first.page.totalItems, "catalog count");
    const item = first.items.find(row => typeof row.name === "string" && row.name.length > 0) ?? first.items[0];
    const tokenPath = `/token/${item.tokenAddress.toLowerCase()}${route.chainId === 1 ? "?chain=1" : ""}`;
    const token = await request(tokenPath, "text/html");
    check(token.response.status === 200, "token page response");
    // Global navigation can intentionally link to the official token on another
    // chain. Chain isolation applies to the requested token's main content.
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/iu.exec(token.text)?.[1];
    check(typeof main === "string", "token page main content");
    const heading = /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu.exec(main)?.[1];
    const expectedName = item.name?.trim() || (projectedItem(item) ? "Unnamed contract" : "Unnamed token");
    check(heading && htmlText(heading.replace(/<[^>]*>/gu, "")) === expectedName, "verified token page heading");
    const anchors = [...main.matchAll(/<a\b[^>]*\bhref="([^"]+)"/giu)].map(match => htmlText(match[1]));
    const explorer = route.chainId === 1 ? "https://etherscan.io" : "https://robinhoodchain.blockscout.com";
    check(anchors.some(href => same(href, `${explorer}/${projectedItem(item) ? "address" : "token"}/${item.tokenAddress}`)) &&
      anchors.includes(`/explore/${route.slug}`), "token page chain links");
    for (const href of anchors) {
      // Only chain-specific destinations are in scope; project/social links may
      // use mailto or other schemes and are never fetched by this smoke.
      if (/^(?:https?:\/\/|\/)/iu.test(href)) validateChainLink(href, route);
    }
    const status = pages.some(page => page.status === "stale") ? "stale"
      : pages.some(page => page.status === "syncing") ? "syncing" : "ready";
    return { chainId: route.chainId, status, totalItems: identities.size, pages,
      tokenPage: { path: tokenPath, tokenAddress: item.tokenAddress, bodyDigest: token.bodyDigest } };
  }));
}

export async function runIndexedWebsiteReadSmoke(input) {
  const target = exactTarget(input.targetUrl, input.targetKind);
  check(/^dpl_[A-Za-z0-9]{20,80}$/u.test(input.deploymentId ?? "") &&
    /^[0-9a-f]{40}$/u.test(input.gitHead ?? "") && /^prj_[A-Za-z0-9]{8,128}$/u.test(input.projectId ?? ""), "deployment identity");
  const observedAt = new Date(input.nowMs ?? Date.now()).toISOString();
  const headers = {};
  if (input.targetKind === "staged") {
    check(typeof input.automationBypassSecret === "string" && input.automationBypassSecret.length >= 16 &&
      input.automationBypassSecret.length <= 512 && !/[\r\n]/u.test(input.automationBypassSecret), "protection bypass");
    headers["x-vercel-protection-bypass"] = input.automationBypassSecret;
    headers["x-vercel-set-bypass-cookie"] = "false";
  }
  async function binding() {
    const common = { token: input.token, teamId: input.teamId, projectId: input.projectId, fetchImpl: input.fetchImpl };
    if (input.targetKind === "staged") {
      const result = await verifyLiveVercelBinding({ ...common, gitHead: input.gitHead,
        evidence: { target: { url: target.origin, vercelDeploymentId: input.deploymentId, gitHead: input.gitHead } } });
      check(result.ok, "exact staged deployment binding");
    } else {
      const checks = await verifyProductionDeploymentBinding({ ...common, targetUrl: target.origin,
        expectedDeploymentId: input.deploymentId, expectedGitHead: input.gitHead });
      check(checks.every(result => result.status === "pass"), "exact production deployment binding");
    }
  }
  await binding();
  const chains = await observeReads(input, target, headers, observedAt);
  await binding();
  return { schemaVersion: "programmable.indexed-website-read-evidence.v1", mode: INDEXED_WEBSITE_READ_MODE,
    targetKind: input.targetKind, targetUrl: target.origin, deploymentId: input.deploymentId, gitHead: input.gitHead,
    projectId: input.projectId, observedAt, publicReadAuthentication: "none", chains,
    scope: "Website catalogs and server-rendered token pages; existing readers enforce source trust. No market, trading, worker activation or legacy API availability claim." };
}

async function main() {
  const result = await runIndexedWebsiteReadSmoke({ targetKind: "staged", targetUrl: process.env.STAGED_TARGET_URL,
    deploymentId: process.env.STAGED_DEPLOYMENT_ID, gitHead: process.env.VERIFIED_SHA,
    projectId: process.env.VERCEL_PROJECT_ID, teamId: process.env.VERCEL_ORG_ID, token: process.env.VERCEL_TOKEN,
    automationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
  check(process.env.INDEXED_WEBSITE_POLICY_MODE === result.mode, "preflight mode");
  check(typeof process.env.INDEXED_WEBSITE_EVIDENCE_OUTPUT === "string" && process.env.INDEXED_WEBSITE_EVIDENCE_OUTPUT.length > 0 &&
    typeof process.env.GITHUB_OUTPUT === "string" && process.env.GITHUB_OUTPUT.length > 0, "evidence output");
  const json = canonicalJson(result);
  const digest = hash(json);
  const outputPath = resolve(process.env.INDEXED_WEBSITE_EVIDENCE_OUTPUT);
  writeFileSync(outputPath, json, { encoding: "utf8", mode: 0o600, flag: "wx" });
  appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nevidence_path=${outputPath}\nevidence_sha256=${digest}\n` +
    result.chains.map(chain => `${chain.chainId === 1 ? "ethereum" : "robinhood"}_status=${chain.status}\n` +
      `${chain.chainId === 1 ? "ethereum" : "robinhood"}_count=${chain.totalItems}\n`).join(""), { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ mode: result.mode, evidenceSha256: digest,
    chains: result.chains.map(({ chainId, status, totalItems }) => ({ chainId, status, totalItems })) })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    const detail = error instanceof Error && error.message.startsWith("indexed website ")
      ? error.message : "indexed website read smoke failed";
    process.stderr.write(`${detail}; no release evidence accepted\n`);
    process.exitCode = 1;
  });
}
