import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex, type Address, type Hex } from "viem";

import preview from "../config/classic-modules/robinhood.preview.json";
import {
  bindActiveClassicModuleSource,
  ClassicModuleProvenanceError,
  normalizeClassicModuleLaunch,
  normalizeClassicModuleLaunches,
} from "../lib/classic-modules/provenance";

// Deliberately synthetic local evidence. No values here describe a deployed or finalized release.
const h = (value: number) => `0x${value.toString(16).padStart(64, "0")}` as Hex;
const a = (value: number) => `0x${value.toString(16).padStart(40, "0")}` as Address;
const eventAbi = parseAbi([
  "event ClassicModuleLaunched(bytes32 indexed launchId,address indexed launchWallet,address indexed token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens)",
]);

function fixture(seed = 0, moduleCount = 2) {
  const codes = ["0x60016001", "0x60026002", "0x60036003", "0x60046004", "0x60056005"] as const;
  const profile = {
    ...preview,
    status: "active",
    enabled: true,
    releaseDigest: h(0xabc),
    launcher: a(1),
    launcherRuntimeCodeHash: keccak256(codes[0]),
    hook: a(2),
    hookRuntimeCodeHash: keccak256(codes[1]),
    registry: a(3),
    registryRuntimeCodeHash: keccak256(codes[2]),
    poolManager: a(4),
    poolManagerRuntimeCodeHash: keccak256(codes[3]),
    tokenFactory: a(5),
    tokenFactoryRuntimeCodeHash: keccak256(codes[4]),
    tokenCreationCodeHash: keccak256("0x60066006"),
    startBlock: "50",
    minimumInitialBuyNative: "1000",
  };
  const launchWallet = a(0xfff);
  const name = `Fixture ${seed}`;
  const symbol = `F${seed}`;
  const creatorSalt = h(9000 + seed);
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,uint256,address,address,bytes32"),
    ["programmable.classic-module-token.v1", 4663n, profile.launcher, launchWallet, creatorSalt]));
  const salt = keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"),
    [name, symbol, 18, profile.launcher, graffiti]));
  const token = getCreate2Address({ from: profile.tokenFactory, salt, bytecodeHash: profile.tokenCreationCodeHash }).toLowerCase() as Address;
  const tokenRuntime = toHex(`synthetic runtime with token immutables: ${name}:${graffiti}`);
  const block = { chainId: 4663, blockNumber: "100", blockHash: h(100) };
  const transactionHash = h(200 + seed);
  const modules = Array.from({ length: moduleCount }, (_, index) => {
    const familyId = h(1000 + index);
    return {
      versionId: keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint32"), [familyId, 1])),
      familyId,
      implementation: a(100 + index),
      codeHash: keccak256(toHex(`module ${index}`)),
      kind: 2,
      config: toHex(`config ${index}`),
    };
  });
  const itemHashes = modules.map((item) => keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,bytes32,address,bytes32,uint8,bytes32"),
    [item.versionId, item.familyId, item.implementation, item.codeHash, item.kind, keccak256(item.config)],
  )));
  const recipeHash = keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32,uint256,address,address,uint16,uint16,bytes32[]"),
    [keccak256(toHex("programmable.classic.recipe.v1")), 4663n, profile.hook, profile.registry, 0, 100, itemHashes],
  ));
  const key = { currency0: a(0), currency1: token, fee: 0, tickSpacing: 200, hooks: profile.hook };
  const poolId = keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
    [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]));
  const launch = {
    launchId: h(300 + seed), launchWallet, token, poolId, recipeHash, hook: profile.hook,
    positionRecipient: a(0xccc + seed), positionTokenId: "7", initialBuyNative: "2000", initialBuyTokens: "1000000000000000000",
  };
  const topics = encodeEventTopics({ abi: eventAbi, eventName: "ClassicModuleLaunched", args: {
    launchId: launch.launchId, launchWallet: launch.launchWallet, token,
  } });
  const data = encodeAbiParameters(parseAbiParameters("bytes32,bytes32,address,address,uint256,uint256,uint256"), [
    poolId, recipeHash, launch.hook, launch.positionRecipient, 7n, 2000n, 1000000000000000000n,
  ]);
  const evidence = {
    schemaVersion: "programmable.classic-modules-evidence.v1",
    header: { ...block },
    receipt: { ...block, transactionHash, status: "success" },
    event: { ...block, transactionHash, logIndex: 4, address: profile.launcher, topics, data, removed: false },
    getLaunch: { ...block, address: profile.launcher, token, tokenFactory: profile.tokenFactory, record: launch },
    token: {
      ...block, address: token, name, symbol, decimals: 18, totalSupply: "1000000000000000000000000000",
      creator: profile.launcher, graffiti, creatorSalt,
    },
    factoryPrediction: {
      ...block, address: profile.tokenFactory, name, symbol, decimals: 18, creator: profile.launcher, graffiti, token,
    },
    pool: { ...block, address: profile.poolManager, poolId, key, sqrtPriceX96: (1n << 96n).toString() },
    recipe: {
      ...block, address: profile.hook, poolId, recipeHash, registry: profile.registry,
      registrar: profile.launcher, launchWallet: launch.launchWallet,
      baseBuyFeeBps: 0, baseSellFeeBps: 100, modules,
    },
    registry: {
      ...block, address: profile.registry,
      versions: modules.map((module, index) => ({
        versionId: module.versionId, familyId: module.familyId, version: 1,
        implementation: module.implementation, codeHash: module.codeHash, manifestHash: h(5000 + index),
        kind: module.kind, enabled: true, author: a(6000 + index),
      })),
    },
    runtimeReads: [
      ...[profile.launcher, profile.hook, profile.registry, profile.poolManager, profile.tokenFactory].map((address, index) => ({
        ...block, address, code: codes[index] as Hex,
      })),
      { ...block, address: token, code: tokenRuntime },
      ...modules.map((module, index) => ({ ...block, address: module.implementation, code: toHex(`module ${index}`) })),
    ],
    verification: {
      status: "verified", policy: "robinhood-ethereum-finalized-v1", verificationDigest: h(700),
      sourceReleaseDigest: profile.releaseDigest,
      l2: { ...block, transactionHash },
      l1Posting: { chainId: 1, blockNumber: "200", blockHash: h(2000), transactionHash: h(2001) },
      l1Finalized: { chainId: 1, blockNumber: "205", blockHash: h(2050), tag: "finalized" },
      providers: [
        { id: "fixture-provider-a", blockNumber: "205", blockHash: h(2050) },
        { id: "fixture-provider-b", blockNumber: "205", blockHash: h(2050) },
      ],
    },
  };
  return { profile, evidence };
}

function setAt(object: unknown, path: string, value: unknown) {
  const parts = path.split(".");
  let cursor = object as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  cursor[parts.at(-1)!] = value;
}

describe("Classic module provenance boundary", () => {
  it("normalizes canonical identity, the launch wallet, and exact immutable module revisions", () => {
    const { evidence, profile } = fixture();
    const row = normalizeClassicModuleLaunch(evidence, profile);
    expect(row.id).toBe(`4663:${evidence.getLaunch.record.token}`);
    expect(row.poolIdentity).toBe(`4663:${profile.poolManager}:${evidence.getLaunch.record.poolId}`);
    expect(row.launchIdentity).toBe(`4663:${profile.launcher}:${evidence.getLaunch.record.launchId}`);
    expect(row.kind).toBe("classic");
    expect(row.launchWallet).toBe(a(0xfff));
    expect(row.initialBuyNative).toBe("2000");
    expect(row.modules).toEqual(evidence.recipe.modules);
    expect(row.versions.map((version) => version.author)).toEqual([a(6000), a(6001)]);
    expect(row.verification.ethereumBlockNumber).toBe("205");
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.modules[0])).toBe(true);
    expect(Object.isFrozen(row.versions)).toBe(true);
  });

  it("keeps the supplied Robinhood preview disabled and entirely unbound", () => {
    expect(preview.status).toBe("preview");
    expect(preview.enabled).toBe(false);
    for (const key of ["releaseDigest", "launcher", "launcherRuntimeCodeHash", "hook", "hookRuntimeCodeHash",
      "registry", "registryRuntimeCodeHash", "poolManager", "poolManagerRuntimeCodeHash", "tokenFactory",
      "tokenFactoryRuntimeCodeHash", "tokenCreationCodeHash",
      "startBlock", "minimumInitialBuyNative"] as const) expect(preview[key]).toBeNull();
    expect(() => bindActiveClassicModuleSource(preview)).toThrow(ClassicModuleProvenanceError);
    expect(() => normalizeClassicModuleLaunch(fixture().evidence, preview)).toThrow(ClassicModuleProvenanceError);
    expect(() => normalizeClassicModuleLaunches([], preview)).toThrow(ClassicModuleProvenanceError);
    expect(preview).not.toHaveProperty("tokenRuntimeCodeHash");
  });

  it.each([
    ["an inactive status", "status", "preview"],
    ["a truthy enabled string", "enabled", "true"],
    ["the wrong chain", "chainId", 1],
    ["an unpinned launcher", "launcher", null],
    ["a missing registry runtime", "registryRuntimeCodeHash", null],
    ["a missing factory runtime", "tokenFactoryRuntimeCodeHash", null],
    ["an unpinned factory", "tokenFactory", null],
    ["a missing token creation artifact", "tokenCreationCodeHash", null],
    ["a substituted token creation artifact", "tokenCreationCodeHash", h(999)],
    ["an absent release digest", "releaseDigest", null],
    ["zero native minimum", "minimumInitialBuyNative", "0"],
    ["a fractional native minimum", "minimumInitialBuyNative", "1.5"],
    ["an unsupported fee tier", "poolFee", 500],
    ["a weaker finality policy", "finalityPolicy", "l2-confirmed"],
  ])("rejects source configuration with %s", (_name, path, replacement) => {
    const { evidence, profile } = fixture();
    setAt(profile, path as string, replacement);
    expect(() => normalizeClassicModuleLaunch(evidence, profile)).toThrow(ClassicModuleProvenanceError);
  });

  it.each([
    ["wrong block chain", "header.chainId", 1],
    ["before deployment", "header.blockNumber", "49"],
    ["failed receipt", "receipt.status", "reverted"],
    ["receipt block fork", "receipt.blockHash", h(999)],
    ["unknown launcher", "event.address", a(999)],
    ["removed event", "event.removed", true],
    ["event transaction substitution", "event.transactionHash", h(999)],
    ["partial event", "event.data", "0x"],
    ["unknown event", "event.topics.0", h(999)],
    ["changed creator", "getLaunch.record.launchWallet", a(999)],
    ["zero NFT sentinel", "getLaunch.record.positionTokenId", "0"],
    ["getter from another block", "getLaunch.blockNumber", "99"],
    ["getter for another token", "getLaunch.token", a(999)],
    ["getter from another source", "getLaunch.address", a(999)],
    ["forged launcher factory binding", "getLaunch.tokenFactory", a(999)],
    ["token state from another block", "token.blockHash", h(999)],
    ["a forged token creator", "token.creator", a(999)],
    ["changed token decimals", "token.decimals", 6],
    ["changed token supply", "token.totalSupply", "2000000000000000000000000000"],
    ["forged token name", "token.name", "Another name"],
    ["forged token graffiti", "token.graffiti", h(999)],
    ["forged creator salt", "token.creatorSalt", h(999)],
    ["an unknown token factory", "factoryPrediction.address", a(999)],
    ["a forged factory prediction", "factoryPrediction.token", a(999)],
    ["another predicted token name", "factoryPrediction.name", "Another name"],
    ["a substituted factory runtime", "runtimeReads.4.code", "0x600099"],
    ["empty token runtime", "runtimeReads.5.code", "0x"],
    ["uninitialized pool", "pool.sqrtPriceX96", "0"],
    ["wrong pool currency", "pool.key.currency1", a(999)],
    ["wrong pool ID", "pool.poolId", h(999)],
    ["wrong pool hook", "pool.key.hooks", a(999)],
    ["wrong pool manager", "pool.address", a(999)],
    ["changed recipe config", "recipe.modules.0.config", "0xffff"],
    ["oversize recipe config", "recipe.modules.0.config", `0x${"ff".repeat(257)}`],
    ["unknown module kind", "recipe.modules.0.kind", 3],
    ["changed base fee", "recipe.baseSellFeeBps", 200],
    ["fractional base fee step", "recipe.baseSellFeeBps", 10],
    ["wrong recipe registrar", "recipe.registrar", a(999)],
    ["wrong recipe owner", "recipe.launchWallet", a(999)],
    ["wrong recipe registry", "recipe.registry", a(999)],
    ["changed revision number", "registry.versions.0.version", 2],
    ["missing approved manifest", "registry.versions.0.manifestHash", h(0)],
    ["unbound author", "registry.versions.0.author", a(0)],
    ["changed registry implementation", "registry.versions.0.implementation", a(999)],
    ["changed runtime", "runtimeReads.0.code", "0x600099"],
    ["empty runtime", "runtimeReads.0.code", "0x"],
    ["runtime read from wrong block", "runtimeReads.0.blockHash", h(999)],
    ["partial verification", "verification.status", "pending"],
    ["unknown verification policy", "verification.policy", "l2-confirmed"],
    ["another verified transaction", "verification.l2.transactionHash", h(999)],
    ["an unbound release", "verification.sourceReleaseDigest", h(999)],
    ["posting beyond finality", "verification.l1Posting.blockNumber", "206"],
    ["conflicting posting hash at finalized height", "verification.l1Posting.blockNumber", "205"],
    ["an unsafe checkpoint", "verification.l1Finalized.tag", "safe"],
    ["disagreeing providers", "verification.providers.1.blockHash", h(999)],
    ["duplicate provider identities", "verification.providers.1.id", "fixture-provider-a"],
  ])("rejects %s", (_name, path, replacement) => {
    const { evidence, profile } = fixture();
    setAt(evidence, path as string, replacement);
    expect(() => normalizeClassicModuleLaunch(evidence, profile)).toThrow(ClassicModuleProvenanceError);
  });

  it("accepts zero selected modules without manufacturing an author", () => {
    const { evidence, profile } = fixture(0, 0);
    const row = normalizeClassicModuleLaunch(evidence, profile);
    expect(row.modules).toEqual([]);
    expect(row.versions).toEqual([]);
  });

  it("accepts different named tokens with different immutable runtimes under one released factory", () => {
    const first = fixture();
    const second = fixture(1);
    const rows = normalizeClassicModuleLaunches([first.evidence, second.evidence], first.profile);
    expect(rows[0].tokenIdentity.name).toBe("Fixture 0");
    expect(rows[1].tokenIdentity.name).toBe("Fixture 1");
    expect(rows[0].tokenIdentity.graffiti).not.toBe(rows[1].tokenIdentity.graffiti);
    expect(rows[0].tokenRuntimeCodeHash).not.toBe(rows[1].tokenRuntimeCodeHash);
    expect(rows[0].tokenRuntimeCodeHash).toBe(keccak256(first.evidence.runtimeReads[5].code));
    expect(rows[1].tokenRuntimeCodeHash).toBe(keccak256(second.evidence.runtimeReads[5].code));
    expect(rows[0].tokenFactory).toBe(rows[1].tokenFactory);
    expect(rows[0].tokenCreationCodeHash).toBe(rows[1].tokenCreationCodeHash);
    expect(() => normalizeClassicModuleLaunch({ ...first.evidence, expectedTokenRuntimeCodeHash: h(999) }, first.profile)).toThrow(/evidence.keys/);
  });

  it("recomputes the pool and recipe rather than trusting repeated forged hashes", () => {
    const pool = fixture();
    pool.evidence.getLaunch.record.poolId = h(999);
    pool.evidence.pool.poolId = h(999);
    pool.evidence.recipe.poolId = h(999);
    pool.evidence.event.data = `${h(999)}${pool.evidence.event.data.slice(66)}`;
    expect(() => normalizeClassicModuleLaunch(pool.evidence, pool.profile)).toThrow(/computedPoolId/);
    const recipe = fixture();
    recipe.evidence.getLaunch.record.recipeHash = h(999);
    recipe.evidence.recipe.recipeHash = h(999);
    recipe.evidence.event.data = `0x${recipe.evidence.event.data.slice(2, 66)}${h(999).slice(2)}${recipe.evidence.event.data.slice(130)}`;
    expect(() => normalizeClassicModuleLaunch(recipe.evidence, recipe.profile)).toThrow(/computedRecipeHash/);
  });

  it("does not invalidate an existing snapshot because new use was disabled later", () => {
    const { evidence, profile } = fixture();
    evidence.registry.versions[0].enabled = false;
    expect(normalizeClassicModuleLaunch(evidence, profile).modules).toHaveLength(2);
  });

  it("orders registry metadata by the immutable recipe rather than provider response order", () => {
    const { evidence, profile } = fixture();
    const expected = normalizeClassicModuleLaunch(evidence, profile);
    evidence.registry.versions.reverse();
    expect(normalizeClassicModuleLaunch(evidence, profile)).toEqual(expected);
  });

  it("allows at most eight module families in one launch", () => {
    const allowed = fixture(0, 8);
    expect(normalizeClassicModuleLaunch(allowed.evidence, allowed.profile).modules).toHaveLength(8);
    const excess = fixture(0, 9);
    expect(() => normalizeClassicModuleLaunch(excess.evidence, excess.profile)).toThrow(/recipe.modules/);
  });

  it("rejects families duplicated with mixed hex case and unsorted families", () => {
    const { evidence, profile } = fixture();
    evidence.recipe.modules[1].familyId = `0x${evidence.recipe.modules[0].familyId.slice(2).toUpperCase()}`;
    expect(() => normalizeClassicModuleLaunch(evidence, profile)).toThrow(/duplicate-module-slot/);
    const reordered = fixture();
    reordered.evidence.recipe.modules.reverse();
    expect(() => normalizeClassicModuleLaunch(reordered.evidence, reordered.profile)).toThrow(/module-order/);
  });

  it("rejects two competing fee policies", () => {
    const { evidence, profile } = fixture();
    evidence.recipe.modules.forEach((module) => { module.kind = 1; });
    expect(() => normalizeClassicModuleLaunch(evidence, profile)).toThrow(/conflicting-fee-policies/);
  });

  it("requires the complete runtime and registry read sets", () => {
    const partial = fixture();
    partial.evidence.runtimeReads.pop();
    expect(() => normalizeClassicModuleLaunch(partial.evidence, partial.profile)).toThrow(/runtimeReads.length/);
    const duplicated = fixture();
    duplicated.evidence.runtimeReads[1] = { ...duplicated.evidence.runtimeReads[0] };
    expect(() => normalizeClassicModuleLaunch(duplicated.evidence, duplicated.profile)).toThrow(/runtime.address-set/);
    const version = fixture();
    version.evidence.registry.versions[1] = { ...version.evidence.registry.versions[0] };
    expect(() => normalizeClassicModuleLaunch(version.evidence, version.profile)).toThrow(/duplicate-version/);
  });

  it("normalizes address casing and refuses duplicate canonical rows or log slots", () => {
    const { evidence, profile } = fixture();
    const duplicate = structuredClone(evidence);
    duplicate.getLaunch.record.token = `0x${duplicate.getLaunch.record.token.slice(2).toUpperCase()}`;
    duplicate.getLaunch.token = duplicate.getLaunch.record.token;
    expect(normalizeClassicModuleLaunch(duplicate, profile).id).toBe(normalizeClassicModuleLaunch(evidence, profile).id);
    expect(() => normalizeClassicModuleLaunches([evidence, duplicate], profile)).toThrow(/batch.duplicate-identity/);
  });

  it("returns a complete frozen batch, and throws rather than dropping an invalid row", () => {
    const first = fixture();
    const second = fixture(1);
    const batch = normalizeClassicModuleLaunches([first.evidence, second.evidence], first.profile);
    expect(batch).toHaveLength(2);
    expect(Object.isFrozen(batch)).toBe(true);
    second.evidence.event.removed = true;
    expect(() => normalizeClassicModuleLaunches([first.evidence, second.evidence], first.profile)).toThrow(ClassicModuleProvenanceError);
  });

  it("does not treat unknown fields or absent evidence as an acceptable partial record", () => {
    const { evidence, profile } = fixture();
    expect(() => normalizeClassicModuleLaunch({ ...evidence, publicReady: true }, profile)).toThrow(/evidence.keys/);
    expect(() => normalizeClassicModuleLaunch({ ...evidence, verification: undefined }, profile)).toThrow(ClassicModuleProvenanceError);
  });
});
