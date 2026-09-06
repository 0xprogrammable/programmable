import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, keccak256, type Address, type Hex } from "viem";
import { PREVIEW_MODULE_CATALOG } from "@/lib/module-mode/builder";
import { buildModuleManagementTransaction, managementCoreAbi, readModuleManagementSnapshot, moduleManagementChainMatches, type ModuleManagementIntent } from "@/lib/module-mode/management";
import { managementReadAbi, referenceManagementManifest } from "@/lib/module-mode/management-manifest";
import { assertModuleNativeRelease, readModuleNativeLaunch, type ModuleNativeClient, type ModuleNativeLaunchRecord } from "@/lib/module-mode/native-client";
import type { NativeModuleModeCatalogEntry } from "@/lib/module-mode/native-catalog";
import { bindActiveModuleModeRelease } from "@/lib/module-mode/release";
import { moduleEvidenceFixture, a, h } from "./fixtures/module-mode-evidence";

vi.mock("@/lib/module-mode/native-client", () => ({ assertModuleNativeRelease: vi.fn(), readModuleNativeLaunch: vi.fn() }));

function fixture() {
  const release = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
  const actor = a(901); const outsider = a(902); const program = a(903); const factory = a(904);
  const programCode = "0x6000600055" as Hex; const factoryCode = "0x6001600055" as Hex;
  const launch: ModuleNativeLaunchRecord = { launchId: h(20), launchWallet: actor, token: a(21), poolId: h(22), recipeHash: h(23), hook: release.contracts.hook.address,
    positionRecipient: a(24), positionTokenId: 1n, initialBuyNative: 1n, initialBuyTokens: 1n, runtime: release.contracts.runtime.address, launchKey: h(25) };
  const instance = { instanceId: h(30), packageId: h(31), configHash: h(32), factory, factoryCodeHash: keccak256(factoryCode), module: program, moduleCodeHash: keccak256(programCode), callbackGas: 300000 };
  const catalog: NativeModuleModeCatalogEntry[] = [{ ...PREVIEW_MODULE_CATALOG[1], id: "arbitrary-reviewed-program", title: "Buyer rewards", status: "available",
    nativeBinding: { familyId: h(33), packageId: instance.packageId, factory, factoryCodeHash: instance.factoryCodeHash, moduleCodeHash: instance.moduleCodeHash,
      callbackGas: 300000, manifestHash: h(34), reviewDigest: h(35) }, management: referenceManagementManifest("reward") }];
  const state = { timestamp: 2_000_000n, end: 2_000_000n, nonce: 0n, revision: 4n, available: 8n, claimable: 2n, feeClaimable: 9n,
    refund: actor, creator: actor, administrator: actor, code: programCode, binding: true, manifest: true, registeredEnabled: true, canonical: true };
  const reads: Record<string, unknown> = { everyN: 3, minimumGrossNative: 1n, rewardNative: 2n, qualifiedBuys: 12n, rewardedBuys: 4n, includeInitialBuy: false, totalReclaimed: 0n };
  const simulated = vi.fn();
  const client = {
    getCode: vi.fn(async ({ address }: { address: Address }) => address === program ? state.code : factoryCode),
    getBlock: vi.fn(async () => ({ timestamp: state.timestamp, number: 100n, hash: state.canonical ? h(100) : h(101) })),
    readContract: vi.fn(async ({ address, functionName, args }: { address: Address; functionName: string; args: unknown[] }) => {
      if (functionName === "instances") return [instance];
      if (functionName === "creatorRecipients") return [[state.creator], [10000], state.revision];
      if (functionName === "treasury") return a(905);
      if (functionName === "rewardAdmin") return state.administrator;
      if (functionName === "name") return "Local fixture";
      if (functionName === "symbol") return "TEST";
      if (functionName === "available") return state.available;
      if (functionName === "claimable") return address === release.contracts.budgetVault.address ? state.claimable : state.feeClaimable;
      if (["claimed", "claimedBy", "contributionByPool"].includes(functionName)) return 1n;
      if (functionName === "actionNonce") return state.nonce;
      if (functionName === "instanceOf") return instance.instanceId;
      if (functionName === "bindingHash") return state.binding ? keccak256(encodeAbiParameters([{ type: "address" }, ...Array.from({ length: 4 }, () => ({ type: "bytes32" } as const))], [launch.runtime, launch.launchKey, instance.instanceId, instance.packageId, instance.configHash])) : h(999);
      if (functionName === "getRevision") return { familyId: h(33), factory, factoryCodeHash: instance.factoryCodeHash, moduleCodeHash: instance.moduleCodeHash, manifestHash: state.manifest ? h(34) : h(999), callbackGas: 300000, enabled: state.registeredEnabled };
      throw new Error(`Unexpected read ${functionName}: ${args}`);
    }),
    call: vi.fn(async (call: { to: Address; data: Hex; account?: Address; value?: bigint }) => {
      const manifest = catalog[0]?.management as ReturnType<typeof referenceManagementManifest> | undefined;
      for (const read of manifest?.reads ?? []) {
        const abi = managementReadAbi(read);
        if (encodeFunctionData({ abi: [abi], functionName: abi.name, args: [] }).slice(0, 10) === call.data.slice(0, 10)) {
          expect(call.to).toBe(program);
          const value = abi.name === "endsAt" ? state.end : abi.name === "refundWallet" ? state.refund : reads[abi.name];
          return { data: encodeAbiParameters(abi.outputs, [value]) };
        }
      }
      simulated(call); return { data: "0x" };
    }),
    estimateGas: vi.fn(async () => 100000n),
  } as unknown as ModuleNativeClient;
  vi.mocked(assertModuleNativeRelease).mockImplementation(async () => ({ release, blockNumber: 100n, blockHash: h(100), timestamp: state.timestamp }));
  vi.mocked(readModuleNativeLaunch).mockResolvedValue(launch);
  const build = (intent: ModuleManagementIntent, who = actor, deadline = state.timestamp + 300n) => buildModuleManagementTransaction({ client, release, catalog, token: launch.token, actor: who, intent, deadline });
  return { actor, outsider, instance, launch, catalog, release, client, state, simulated, build };
}

beforeEach(() => vi.clearAllMocks());
describe("bound Module Mode management", () => {
  it("reads actual bound program state and converts narrow Solidity integers without confusing actor balances", async () => {
    const f = fixture();
    const snapshot = await readModuleManagementSnapshot({ ...f, token: f.launch.token, actor: f.actor });
    expect(snapshot.instances[0].problem).toBeNull();
    expect(snapshot.instances[0].reads["every-n"]).toBe(3n);
    expect(snapshot.instances[0].reads["refund-wallet"]).toBe(f.actor);
    expect(snapshot.instances[0].available).toBe(8n);
    expect(snapshot.fees).toMatchObject({ claimable: 9n, adminRevision: 4n });
    const disconnected = await readModuleManagementSnapshot({ ...f, token: f.launch.token, actor: null });
    expect(disconnected.instances[0].claimable).toBeNull(); expect(disconnected.fees.claimable).toBeNull();
  });
  it("encodes only the declared action into the real runtime, preserving exact empty inputs and current nonce", async () => {
    const f = fixture(); const intent = { kind: "program", instanceId: f.instance.instanceId, actionId: "reclaim-unused", inputs: {} } as const;
    const first = await f.build(intent);
    expect(first.transaction.to).toBe(f.launch.runtime);
    expect(first.transaction.from).toBe(f.actor); expect(first.transaction.value).toBe("0x0");
    expect(first.blockNumber).toBe(100n); expect(first.blockHash).toBe(h(100));
    expect(f.client.estimateGas).toHaveBeenCalledWith(expect.objectContaining({ blockNumber: 100n }));
    const decoded = decodeFunctionData({ abi: managementCoreAbi, data: first.transaction.data });
    expect(decoded.functionName).toBe("executeAction");
    expect(decoded.args).toEqual([f.launch.launchKey, 0n, referenceManagementManifest("reward").actions[0].actionId, "0x", 0n, 2_000_300n]);
    f.state.nonce = 1n;
    const refreshed = await f.build(intent); expect(refreshed.transaction.data).not.toBe(first.transaction.data);
    expect(f.simulated).toHaveBeenCalledTimes(2);
  });
  it("refuses forged callback identities, before-expiry refunds, old deadlines and undeclared action bytes", async () => {
    const f = fixture(); const intent = { kind: "program", instanceId: f.instance.instanceId, actionId: "reclaim-unused", inputs: {} } as const;
    await expect(f.build(intent, f.outsider)).rejects.toThrow("action wallet");
    f.state.end += 1n; await expect(f.build(intent)).rejects.toThrow("end time"); f.state.end -= 1n;
    await expect(f.build(intent, f.actor, f.state.timestamp)).rejects.toThrow("expired");
    await expect(f.build({ ...intent, actionId: "sweep" })).rejects.toThrow("not declared");
    await expect(f.build({ ...intent, inputs: { recipient: f.outsider } })).rejects.toThrow();
    await expect(f.build({ ...intent, instanceId: h(888) })).rejects.toThrow("does not belong");
    expect(f.simulated).not.toHaveBeenCalled();
  });
  it("validates an arbitrary new schema-driven action without module-ID dispatch", async () => {
    const f = fixture(); const manifest = referenceManagementManifest("reward");
    manifest.capabilities.push("open-config-inputs@1");
    manifest.actions = [{ ...manifest.actions[0], id: "set-example", actionId: h(55), encoding: "open-config", availableAfterRead: null,
      inputSchema: { type: "record", fields: { count: { type: "uint", bits: 128, min: "1", label: "Count" } }, required: ["count"] } }];
    f.catalog[0].management = manifest;
    const result = await f.build({ kind: "program", instanceId: f.instance.instanceId, actionId: "set-example", inputs: { count: "7" } });
    const decoded = decodeFunctionData({ abi: managementCoreAbi, data: result.transaction.data });
    expect(decoded.args?.[3]).toBe(encodeAbiParameters([{ type: "uint128" }], [7n]));
    expect(result.description).toContain("Count: 7");
    await expect(f.build({ kind: "program", instanceId: f.instance.instanceId, actionId: "set-example", inputs: { count: "0" } })).rejects.toThrow();
  });
  it("blocks funding or program actions after code, config binding or registry manifest drift", async () => {
    for (const change of ["code", "binding", "manifest"] as const) {
      const f = fixture();
      if (change === "code") f.state.code = "0x00"; else f.state[change] = false;
      await expect(f.build({ kind: "fund", instanceId: f.instance.instanceId, amountWei: "10" })).rejects.toThrow();
      expect(f.simulated).not.toHaveBeenCalled();
    }
  });
  it("keeps backed claims independent of catalogue availability and always redirects only the actor's own claim", async () => {
    const f = fixture(); f.catalog.splice(0);
    const result = await f.build({ kind: "claim", instanceId: f.instance.instanceId, recipient: f.outsider });
    expect(result.transaction.to).toBe(f.release.contracts.budgetVault.address);
    expect(result.transaction.from).toBe(f.actor);
    expect(decodeFunctionData({ abi: managementCoreAbi, data: result.transaction.data })).toMatchObject({ functionName: "claimTo", args: [f.instance.instanceId, f.outsider] });
    await expect(f.build({ kind: "claim", instanceId: f.instance.instanceId, recipient: f.outsider, beneficiary: f.outsider } as ModuleManagementIntent)).rejects.toThrow();
  });
  it("does not invent an onchain pause from a new-launch availability toggle", async () => {
    const f = fixture(); f.state.registeredEnabled = false;
    await expect(f.build({ kind: "program", instanceId: f.instance.instanceId, actionId: "reclaim-unused", inputs: {} })).resolves.toBeDefined();
  });
  it("includes the actual immutable refund destination in a funded operation review", async () => {
    const f = fixture(); const result = await f.build({ kind: "fund", instanceId: f.instance.instanceId, amountWei: "1000000000000000" });
    expect(result.transaction.to).toBe(f.release.contracts.budgetVault.address);
    expect(BigInt(result.transaction.value)).toBe(1_000_000_000_000_000n);
    expect(result.description).toContain(f.actor);
    expect(decodeFunctionData({ abi: managementCoreAbi, data: result.transaction.data })).toMatchObject({ functionName: "fund", args: [f.instance.instanceId] });
  });
  it("uses only existing CTO authority and encodes fixed slots, expected revision and deadline", async () => {
    const f = fixture(); const intent = { kind: "replace-creators", recipients: [f.outsider] } as const;
    const result = await f.build({ ...intent, recipients: [...intent.recipients] });
    expect(result.transaction.to).toBe(f.release.contracts.rewardLedger.address);
    expect(result.description).toContain(`${f.outsider} (100%)`);
    expect(decodeFunctionData({ abi: managementCoreAbi, data: result.transaction.data })).toMatchObject({ functionName: "replaceCreatorWallets", args: [f.launch.poolId, [f.outsider], 4n, 2_000_300n] });
    await expect(f.build({ kind: "replace-creators", recipients: [f.actor] }, f.outsider)).rejects.toThrow("administrator");
    await expect(f.build({ kind: "replace-creators", recipients: [f.actor, f.outsider] })).rejects.toThrow("fixed shares");
    f.state.revision += 1n; const next = await f.build({ kind: "replace-creators", recipients: [f.outsider] });
    expect(next.transaction.data).not.toBe(result.transaction.data);
  });
  it("supports only the current slot wallet's own rotation and preserves older fee claimants", async () => {
    const f = fixture();
    const result = await f.build({ kind: "rotate-creator", index: 0, recipient: f.outsider });
    expect(decodeFunctionData({ abi: managementCoreAbi, data: result.transaction.data })).toMatchObject({ functionName: "changeCreatorWallet", args: [f.launch.poolId, 0n, f.outsider] });
    f.state.creator = f.outsider;
    await expect(f.build({ kind: "rotate-creator", index: 0, recipient: f.outsider })).rejects.toThrow("current recipient");
    const claim = await f.build({ kind: "claim-fees", recipient: f.actor });
    expect(claim.transaction.to).toBe(f.release.contracts.rewardLedger.address);
    expect(claim.description).toContain("full available Module Mode fee balance");
  });
  it("unknown capabilities remain unavailable and cannot turn into arbitrary transaction targets", async () => {
    const f = fixture(); const manifest = referenceManagementManifest("reward"); manifest.capabilities.push("external-rebalancer@1"); f.catalog[0].management = manifest;
    const snapshot = await readModuleManagementSnapshot({ ...f, token: f.launch.token });
    expect(snapshot.instances[0].problem).toContain("external-rebalancer@1");
    await expect(f.build({ kind: "fund", instanceId: f.instance.instanceId, amountWei: "10" })).rejects.toThrow("support");
    expect(f.simulated).not.toHaveBeenCalled();
  });
  it("rejects a canonical-block mismatch before handing any request to the wallet", async () => {
    const f = fixture(); f.state.canonical = false;
    await expect(f.build({ kind: "claim-fees", recipient: f.actor })).rejects.toThrow("chain changed");
    expect(f.simulated).not.toHaveBeenCalled();
  });
  it("accepts only the supported wallet chain representations", () => {
    for (const chain of ["4663", "0x1237", "eip155:4663"]) expect(moduleManagementChainMatches(chain)).toBe(true);
    for (const chain of ["1", "0x1", "eip155:1", "bad", undefined, null]) expect(moduleManagementChainMatches(chain)).toBe(false);
  });
});
