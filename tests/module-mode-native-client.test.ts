import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, keccak256, parseAbiParameters, sha256, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { createModuleModeState, PREVIEW_MODULE_CATALOG, setModuleSelected, validateModuleModeDraft, type ModuleModeDraft, type ModuleModeState } from "../lib/module-mode/builder";
import { bindActiveModuleModeRelease, type ModuleModeDependency } from "../lib/module-mode/release";
import { MODULE_MODE_AVAILABILITY_SCHEMA, nativeCanonicalJson, type ModuleModeAvailability, type NativeModuleModeCatalogEntry } from "../lib/module-mode/native-catalog";
import { MODULE_NATIVE_METADATA_TYPE, MODULE_NATIVE_SELECTION_TYPE, moduleNativeApprovalAbi, moduleNativeLaunchAbi, moduleNativeRouterAbi } from "../lib/module-mode/native-abi";
import { assertModuleNativeRelease, prepareModuleNativeApproval, prepareModuleNativeLaunch, prepareModuleNativeManagementTransaction, prepareModuleNativeSwap, revalidateModuleNativeTransaction, waitForModuleNativeReceipt, ModuleNativeTransactionRevertedError, type ModuleNativeClient, type PreparedModuleNativeTransaction } from "../lib/module-mode/native-client";
import { managementCoreAbi, type ModuleManagementBuildInput } from "../lib/module-mode/management";
import { moduleEvidenceFixture, a, h } from "./fixtures/module-mode-evidence";

const now = BigInt(Math.floor(Date.now() / 1000));
type Call = { account?: Address; to: Address; data: Hex; value?: bigint; blockNumber?: bigint };
type Read = { address: Address; functionName: string; args: readonly unknown[]; blockNumber?: bigint };
function harness(withModules = false) {
  const rawFixture = moduleEvidenceFixture(0, 0);
  const f = { ...rawFixture, wallet: rawFixture.evidence.getLaunch.record.launchWallet, token: rawFixture.evidence.getLaunch.record.token, graffiti: rawFixture.evidence.token.graffiti };
  const release = bindActiveModuleModeRelease(f.release); const pins = release.contracts;
  const roleByAddress = new Map(Object.entries(pins).map(([role, pin]) => [pin.address.toLowerCase(), role as ModuleModeDependency]));
  const catalog: NativeModuleModeCatalogEntry[] = withModules ? PREVIEW_MODULE_CATALOG.map((entry, i) => ({ ...entry, status: "available", nativeBinding: {
    familyId: h(i === 0 ? 900 : 100), packageId: h(200 + i), factory: a(100 + i), factoryCodeHash: keccak256(toHex(`factory${i}`)), moduleCodeHash: h(400 + i), callbackGas: 100_000, manifestHash: h(500 + i), reviewDigest: h(600 + i),
  } })) : [];
  const availability: ModuleModeAvailability = { schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release, catalog, reason: null };
  let chainId = 4663; let codeMismatch = false; let disabled = false; let allowance = 0n; let blockHash = h(400);
  let adminRevision = 0n; let currentCreator = f.wallet;
  let lastLaunch: Record<string, unknown> | null = null;
  let simulatedLaunch = { ...f.evidence.getLaunch.record, positionTokenId: 1n, initialBuyNative: 1000n, initialBuyTokens: 90_000n };
  let receipt: TransactionReceipt; let receiptTx: Record<string, unknown>;
  const readContract = vi.fn(async ({ address, functionName: fn, args }: Read): Promise<unknown> => {
    const role = roleByAddress.get(address.toLowerCase());
    if (fn === "getLaunch") return simulatedLaunch;
    if (fn === "getLaunchIdentity") return { ...f.evidence.identity.record, launchId: simulatedLaunch.launchId, recipeHash: simulatedLaunch.recipeHash };
    if (fn === "getRevision") {
      const entry = catalog.find(item => item.nativeBinding.packageId === args[0]); if (!entry) throw new Error("Unknown revision");
      return { ...entry.nativeBinding, enabled: !disabled };
    }
    if (fn === "creator") return pins.launcher.address;
    if (fn === "totalSupply") return 1_000_000_000n * 10n ** 18n;
    if (fn === "decimals") return 18;
    if (fn === "name") return "Fixture 0";
    if (fn === "symbol") return "F0";
    if (fn === "instances") return [];
    if (fn === "creatorRecipients") return [[currentCreator], [10000], adminRevision];
    if (fn === "treasury") return a(901);
    if (fn === "rewardAdmin") return f.wallet;
    if (fn === "claimable") return 500n;
    if (fn === "claimedBy" || fn === "contributionByPool") return 100n;
    if (fn === "allowance") return allowance;
    if (fn === "poolConfig") return [pins.launcher.address, f.wallet, pins.swapRouter.address, pins.swapRouter.runtimeCodeHash, 0, 1000, simulatedLaunch.recipeHash, simulatedLaunch.launchKey];
    if (fn === "feeComponents") return [0, 20, 500, 0];
    if (fn === "predictTokenAddress") return [f.token, f.graffiti];
    if (fn === "minInitialBuyNative") return 1000n;
    if (fn === "engineCodeHash") return pins.hook.runtimeCodeHash;
    if (fn === "runtimeOf") return pins.runtime.address;
    if (fn === "routerOf") return pins.swapRouter.address;
    const target = fn === "feeHook" || fn === "engine" ? "hook" : fn === "ledger" ? "rewardLedger" : fn === "vault" ? "budgetVault" : fn === "source" ? "launcher" : fn;
    if (target in pins && role) return pins[target as ModuleModeDependency].address;
    throw new Error(`Unexpected read ${role}.${fn}`);
  });
  const call = vi.fn(async ({ data }: Call) => {
    for (const abi of [moduleNativeLaunchAbi, moduleNativeRouterAbi, moduleNativeApprovalAbi, managementCoreAbi]) {
      let decoded: ReturnType<typeof decodeFunctionData<Abi>>;
      try { decoded = decodeFunctionData({ abi, data }); } catch { continue; }
      if (decoded.functionName === "launch") {
        const p = decoded.args![0] as Record<string, unknown>; lastLaunch = p;
        const selections = p.modules as { packageId: Hex }[];
        const families = selections.map(selection => catalog.find(item => item.nativeBinding.packageId === selection.packageId)!.nativeBinding.familyId);
        const recipeHash = keccak256(encodeAbiParameters(parseAbiParameters(`string,uint256,address,address,uint16,uint16,bytes32[],${MODULE_NATIVE_SELECTION_TYPE}`), ["programmable.module-mode.native-recipe.v1", 4663n, pins.hook.address, pins.registry.address, Number(p.buyCreatorFeeBps), Number(p.sellCreatorFeeBps), families, p.modules as never]));
        const programHash = keccak256(encodeAbiParameters(parseAbiParameters(`bytes32,${MODULE_NATIVE_SELECTION_TYPE}`), [keccak256(toHex("programmable.module-mode.native-program.v1")), p.modules as never]));
        const launchKey = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,(address source,address launchWallet,address token,address poolManager,bytes32 poolId,bytes32 recipeHash,bytes32 programHash)"), [keccak256(toHex("programmable.module-mode.native-binding.v1")), 4663n, pins.runtime.address, pins.hook.address, { source: pins.launcher.address, launchWallet: f.wallet, token: f.token, poolManager: pins.poolManager.address, poolId: f.evidence.getLaunch.record.poolId, recipeHash, programHash }]));
        simulatedLaunch = { ...simulatedLaunch, recipeHash, launchKey, initialBuyNative: p.initialBuyNative as bigint };
        return { data: encodeFunctionResult({ abi: moduleNativeLaunchAbi, functionName: "launch", result: simulatedLaunch }) };
      }
      if (decoded.functionName === "swap") {
        const [, isBuy, specified] = decoded.args as [Address, boolean, bigint, bigint, Address, bigint];
        const values = isBuy ? specified < 0n ? [-specified, 100_000n] : [20_000n, specified] : specified < 0n ? [3000n, -specified] : [specified, 5000n];
        return { data: encodeFunctionResult({ abi: moduleNativeRouterAbi, functionName: "swap", result: values as [bigint, bigint] }) };
      }
      if (decoded.functionName === "approve") return { data: encodeFunctionResult({ abi: moduleNativeApprovalAbi, functionName: "approve", result: true }) };
      if (["claimTo", "replaceCreatorWallets", "changeCreatorWallet"].includes(decoded.functionName)) return { data: "0x" };
    }
    throw new Error("Unexpected eth_call");
  });
  const block = () => ({ number: 100n, hash: blockHash, timestamp: now });
  const client = {
    getChainId: vi.fn(async () => chainId), getBlock: vi.fn(async () => block()), readContract, call,
    getCode: vi.fn(async ({ address }: { address: Address }) => {
      const role = roleByAddress.get(address.toLowerCase());
      if (role) return codeMismatch && role === "hook" ? "0x1234" : toHex(`fixture ${role}`);
      const i = catalog.findIndex(entry => entry.nativeBinding.factory.toLowerCase() === address.toLowerCase());
      return i >= 0 ? toHex(`factory${i}`) : undefined;
    }),
    estimateGas: vi.fn(async () => 100_000n), getTransaction: vi.fn(async () => receiptTx), waitForTransactionReceipt: vi.fn(async () => receipt),
  } as unknown as ModuleNativeClient;
  const state: ModuleModeState = { ...createModuleModeState(), name: "Fixture 0", symbol: "F0", description: "A local RPC fixture", sellFeePercent: "10", initialBuyEth: "0.000000000000001", tokenImage: { kind: "uri", uri: "https://example.com/fixture.webp", contentVerified: false } };
  function draft(custom = state) {
    const result = validateModuleModeDraft(custom, catalog, { roles: { creator: f.wallet, launchWallet: f.wallet } });
    if (!result.ok) throw new Error(JSON.stringify(result.issues)); return result.draft;
  }
  const launch = (raw = draft()) => prepareModuleNativeLaunch({ client, availability, draft: raw, account: f.wallet, creatorSalt: h(500), image: { uri: "https://example.com/fixture.webp" } });
  function setupReceipt(prepared: PreparedModuleNativeTransaction, status: "success" | "reverted" = "success") {
    const transactionHash = h(600); const blockNumber = 100n;
    const logs: TransactionReceipt["logs"] = [];
    function add(abi: Abi, eventName: string, address: Address, args: Record<string, unknown>) {
      const event = abi.find(item => item.type === "event" && item.name === eventName)!;
      if (event.type !== "event") throw new Error("Missing fixture ABI");
      const values = event.inputs.filter(item => !item.indexed);
      logs.push({ address, blockHash, blockNumber, transactionHash, transactionIndex: 0, logIndex: logs.length, removed: false,
        topics: encodeEventTopics({ abi, eventName, args } as never) as [Hex, ...Hex[]], data: encodeAbiParameters(values, values.map(item => args[item.name!])) });
    }
    if (prepared.kind === "launch") {
      const p = lastLaunch!;
      add(moduleNativeLaunchAbi, "ModuleNativeLaunched", pins.launcher.address, simulatedLaunch);
      add(moduleNativeLaunchAbi, "ModuleNativeProgramBound", pins.launcher.address, { launchId: simulatedLaunch.launchId, launchKey: prepared.launchKey, runtime: pins.runtime.address,
        fundingHash: keccak256(encodeAbiParameters([{ type: "uint256[]" }], [p.moduleFunding as bigint[]])), totalFunding: (p.moduleFunding as bigint[]).reduce((sum, n) => sum + n, 0n) });
      add(moduleNativeLaunchAbi, "ModuleNativeConfigurationBound", pins.launcher.address, { launchId: simulatedLaunch.launchId,
        metadataHash: keccak256(encodeAbiParameters(parseAbiParameters(`string,string,${MODULE_NATIVE_METADATA_TYPE}`), [p.name as string, p.symbol as string, p.metadata as never])),
        creatorConfigurationHash: keccak256(encodeAbiParameters(parseAbiParameters("address[],uint16[]"), [p.creatorWallets as Address[], p.creatorSharesBps as number[]])), economicsHash: h(302) });
      add(moduleNativeLaunchAbi, "ModuleNativeTokenIdentityBound", pins.launcher.address, { launchId: simulatedLaunch.launchId, creatorSalt: h(500), graffiti: f.graffiti });
    }
    if (prepared.kind === "swap") add(moduleNativeRouterAbi, "NativeTradeCompleted", pins.swapRouter.address, { poolId: prepared.poolId, actor: prepared.account, recipient: prepared.recipient, isBuy: prepared.isBuy, amountSpecified: prepared.amountSpecified, nativeAmount: prepared.nativeAmount, tokenAmount: prepared.tokenAmount });
    if (prepared.kind === "approve") { allowance = prepared.amount; add(moduleNativeApprovalAbi, "Approval", prepared.token, { owner: prepared.account, spender: pins.swapRouter.address, value: prepared.amount }); }
    receipt = { transactionHash, blockNumber, blockHash, status, logs, from: prepared.account, to: prepared.transaction.to } as TransactionReceipt;
    receiptTx = { hash: transactionHash, blockNumber, blockHash, from: prepared.account, to: prepared.transaction.to, input: prepared.transaction.data, value: BigInt(prepared.transaction.value), chainId: 4663 };
    return { transactionHash, receipt, transaction: receiptTx };
  }
  return { client, f, release, availability, state, catalog, draft, launch, setupReceipt, readContract, call,
    setAdminRevision: (revision: bigint) => { adminRevision = revision; }, setCreator: (wallet: Address) => { currentCreator = wallet; },
    setChain: (id: number) => { chainId = id; }, setCodeMismatch: () => { codeMismatch = true; }, disable: () => { disabled = true; }, setAllowance: (n: bigint) => { allowance = n; }, setBlockHash: (value: Hex) => { blockHash = value; } };
}
function redigest(draft: ModuleModeDraft): ModuleModeDraft {
  const { draftId: _, ...body } = draft; void _;
  return { ...body, draftId: sha256(toHex(nativeCanonicalJson(body))) };
}

describe("native wallet transaction adapter", () => {
  it("prepares the exact launch call and never substitutes a preview ID for a registry ID", async () => {
    const fixture = harness(); const prepared = await fixture.launch();
    expect(prepared.transaction).toMatchObject({ chainId: 4663, from: fixture.f.wallet, to: fixture.release.contracts.launcher.address, value: toHex(1000n), action: "launch" });
    expect(prepared.minimumTokenOut).toBe(89_100n); expect(prepared.gasEstimate).toBe(120_000n);
    expect(prepared.predictedToken.toLowerCase()).toBe(fixture.f.token);
    const decoded = decodeFunctionData({ abi: moduleNativeLaunchAbi, data: prepared.transaction.data });
    expect(decoded.args![0]).toMatchObject({ initialBuyNative: 1000n, minimumInitialTokenOut: 89_100n, modules: [], moduleFunding: [] });
    expect(Object.isFrozen(prepared.transaction)).toBe(true);
  });
  it("rechecks code and chain bindings, rejects forged/cloned preparations, and consumes one signing attempt", async () => {
    const f = harness(); const prepared = await f.launch();
    await expect(revalidateModuleNativeTransaction({ ...prepared }, f.f.wallet)).rejects.toThrow("Unknown");
    await expect(revalidateModuleNativeTransaction(prepared, a(999))).rejects.toThrow("Connected account");
    expect(await revalidateModuleNativeTransaction(prepared, f.f.wallet)).toMatchObject({ chainId: 4663, from: f.f.wallet, gas: toHex(120_000n) });
    await expect(revalidateModuleNativeTransaction(prepared, f.f.wallet)).rejects.toThrow("already been used");
    const changed = harness(); const next = await changed.launch(); changed.setCodeMismatch();
    await expect(revalidateModuleNativeTransaction(next, changed.f.wallet)).rejects.toThrow("Runtime code");
    const wrong = harness(); wrong.setChain(1);
    await expect(assertModuleNativeRelease({ client: wrong.client, release: wrong.release })).rejects.toThrow("different chain");
  });
  it("independently rejects changed draft bytes, invalid fees, combined values and ETH minimum", async () => {
    const f = harness();
    await expect(f.launch({ ...f.draft(), initialBuyWei: "1001" })).rejects.toThrow("Draft digest");
    await expect(f.launch(redigest({ ...f.draft(), fees: { ...f.draft().fees, creatorBuyBps: 50 } }))).rejects.toThrow("whole percentages");
    await expect(f.launch(redigest({ ...f.draft(), totalNativeValueWei: "999999" }))).rejects.toThrow("Launch value");
    await expect(f.launch(redigest({ ...f.draft(), initialBuyWei: "999", totalNativeValueWei: "999" }))).rejects.toThrow("released minimum");
    const addedFeeField = f.draft(); Object.assign(addedFeeField.fees, { feeRecipient: a(999) });
    await expect(f.launch(redigest(addedFeeField))).rejects.toThrow("draft.fees.keys");
    const fakeImageVerification = f.draft(); Object.assign(fakeImageVerification.token.image, { contentVerified: true });
    await expect(f.launch(redigest(fakeImageVerification))).rejects.toThrow("verification state changed");
  });
  it("refuses fresh gas growth and immutable dependency mismatch before the signing boundary", async () => {
    const f = harness(); const prepared = await f.launch();
    vi.mocked(f.client.estimateGas).mockResolvedValue(110_000n);
    await expect(revalidateModuleNativeTransaction(prepared, f.f.wallet)).rejects.toThrow("gas estimate increased");
    const other = harness(); other.readContract.mockImplementationOnce(async () => a(999));
    await expect(other.launch()).rejects.toThrow("launcher.poolManager");
  });
  it("sorts actual selections and their separate funding by reviewed family, rechecks revision availability", async () => {
    const f = harness(true); let state = setModuleSelected(f.state, f.catalog[0], true); state = setModuleSelected(state, f.catalog[1], true);
    (state.moduleValues[f.catalog[1].id] as Record<string, unknown>).refundWallet = { role: "creator" };
    const prepared = await f.launch(f.draft(state));
    const decoded = decodeFunctionData({ abi: moduleNativeLaunchAbi, data: prepared.transaction.data });
    if (decoded.functionName !== "launch") throw new Error("Unexpected function");
    const [p] = decoded.args;
    expect(p.modules.map(item => item.packageId)).toEqual([f.catalog[1].nativeBinding.packageId, f.catalog[0].nativeBinding.packageId]);
    expect(p.moduleFunding).toEqual([10n ** 16n, 0n]); expect(BigInt(prepared.transaction.value)).toBe(1000n + 10n ** 16n);
    f.disable(); await expect(revalidateModuleNativeTransaction(prepared, f.f.wallet)).rejects.toThrow("no longer available");
  });
  it("rejects stale catalog/schema/account configuration and uploaded image mismatches", async () => {
    const f = harness(true); const state = setModuleSelected(f.state, f.catalog[0], true); const draft = f.draft(state);
    const altered = structuredClone(draft); altered.modules[0].programConfigurationBytes = "0x1234";
    await expect(f.launch(redigest(altered))).rejects.toThrow("Native program configuration");
    f.catalog[0].nativeBinding.packageId = h(777);
    await expect(f.launch(draft)).rejects.toThrow("catalog digest");
    const local = harness(); const imageDraft = redigest({ ...local.draft(), token: { ...local.draft().token, image: { kind: "local", sha256: h(333), bytes: 100, mimeType: "image/webp" } } });
    await expect(local.launch(imageDraft)).rejects.toThrow("Uploaded image source digest");
  });
  it("simulates all four authenticated router directions and exposes separate PoolManager fees", async () => {
    for (const [isBuy, amountSpecified, limit] of [[true, -10_000n, undefined], [true, 100n, 30_000n], [false, -100n, undefined], [false, 100n, 6000n]] as const) {
      const f = harness(); f.setAllowance(100_000n);
      const result = await prepareModuleNativeSwap({ client: f.client, availability: f.availability, account: f.f.wallet, token: f.f.token, recipient: a(91), isBuy, amountSpecified, limit });
      expect(result.kind).toBe("swap"); if (result.kind !== "swap") throw new Error("Unexpected approval");
      expect(result.transaction.to).toBe(f.release.contracts.swapRouter.address);
      expect(result.feeComponents).toEqual({ creatorBps: 0, platformBps: 20, poolProtocolPips: 500, poolLpPips: 0 });
      const data = f.setupReceipt(result);
      expect(await waitForModuleNativeReceipt({ client: f.client, prepared: result, transactionHash: data.transactionHash })).toMatchObject({ status: "mined", finalized: false, indexed: false, kind: "swap" });
    }
  });
  it("requires a separately reviewed bounded direct approval before a sell and does not auto-send the trade", async () => {
    const f = harness();
    const result = await prepareModuleNativeSwap({ client: f.client, availability: f.availability, account: f.f.wallet, token: f.f.token, recipient: f.f.wallet, isBuy: false, amountSpecified: -100n });
    expect(result).toEqual({ kind: "approval-required", token: f.f.token, spender: f.release.contracts.swapRouter.address, amount: 100n, currentAllowance: 0n });
    const prepared = await prepareModuleNativeApproval({ client: f.client, availability: f.availability, account: f.f.wallet, token: f.f.token, amount: 100n });
    expect(decodeFunctionData({ abi: moduleNativeApprovalAbi, data: prepared.transaction.data }).args).toEqual([f.release.contracts.swapRouter.address, 100n]);
    const receipt = f.setupReceipt(prepared); expect((await waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: receipt.transactionHash })).kind).toBe("approve");
    await expect(prepareModuleNativeApproval({ client: f.client, availability: f.availability, account: f.f.wallet, token: f.f.token, amount: (1n << 256n) - 1n })).rejects.toThrow("approval amount");
  });
  it("binds mined launch receipt to transaction bytes, actual state, image, funding and canonical block", async () => {
    const f = harness(); const prepared = await f.launch(); const data = f.setupReceipt(prepared);
    expect(await waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: data.transactionHash })).toMatchObject({ status: "mined", finalized: false, indexed: false, kind: "launch", token: f.f.token });
    data.transaction.input = "0x1234";
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: data.transactionHash })).rejects.toThrow("calldata");
    data.transaction.input = prepared.transaction.data; data.transaction.from = a(123);
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: data.transactionHash })).rejects.toThrow("sender");
    data.transaction.from = prepared.account; data.transaction.value = 999n;
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: data.transactionHash })).rejects.toThrow("value or chain");
    data.transaction.value = BigInt(prepared.transaction.value); f.setBlockHash(h(401));
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: data.transactionHash })).rejects.toThrow("Canonical receipt block");
  });
  it("reports a typed revert only after binding the failed transaction, and rejects missing/foreign receipt events", async () => {
    const f = harness(); const prepared = await f.launch(); const data = f.setupReceipt(prepared, "reverted");
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: data.transactionHash })).rejects.toBeInstanceOf(ModuleNativeTransactionRevertedError);
    data.transaction.to = a(999);
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: data.transactionHash })).rejects.not.toBeInstanceOf(ModuleNativeTransactionRevertedError);
    const next = f.setupReceipt(prepared); next.receipt.logs[0].address = a(999);
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: next.transactionHash })).rejects.toThrow("exactly one ModuleNativeLaunched");
  });
  it("reconstructs a fee claim through the real management builder, isolates the reviewed intent and binds its receipt", async () => {
    const f = harness();
    const input: ModuleManagementBuildInput = { client: f.client, release: f.release, catalog: [], token: f.f.token, actor: f.f.wallet,
      intent: { kind: "claim-fees", recipient: a(91) }, deadline: now + 300n };
    const prepared = await prepareModuleNativeManagementTransaction(input);
    expect(prepared).toMatchObject({ kind: "manage", token: f.f.token, blockNumber: 100n, gasEstimate: 120_000n, expiresAt: now + 300n });
    const decoded = decodeFunctionData({ abi: managementCoreAbi, data: prepared.transaction.data });
    expect(decoded.functionName).toBe("claimTo"); expect(String(decoded.args?.[0]).toLowerCase()).toBe(a(91));
    input.intent = { kind: "claim-fees", recipient: a(92) }; input.deadline += 100n;
    const checked = await revalidateModuleNativeTransaction(prepared, f.f.wallet);
    expect(checked).toEqual({ ...prepared.transaction, gas: toHex(120_000n) });
    expect(f.client.estimateGas).toHaveBeenLastCalledWith(expect.objectContaining({ blockNumber: 100n, account: f.f.wallet, to: f.release.contracts.rewardLedger.address }));
    const mined = f.setupReceipt(prepared);
    expect(await waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: mined.transactionHash })).toMatchObject({ status: "mined", kind: "manage", token: f.f.token, finalized: false, indexed: false });
    mined.transaction.input = "0x1234";
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: mined.transactionHash })).rejects.toThrow("calldata");
    const reverted = f.setupReceipt(prepared, "reverted");
    await expect(waitForModuleNativeReceipt({ client: f.client, prepared, transactionHash: reverted.transactionHash })).rejects.toBeInstanceOf(ModuleNativeTransactionRevertedError);
  });
  it("refuses changed CTO revisions or lost recipient rights when revalidating the actual management action", async () => {
    const f = harness(); const common = { client: f.client, release: f.release, catalog: [], token: f.f.token, actor: f.f.wallet, deadline: now + 300n };
    const prepared = await prepareModuleNativeManagementTransaction({ ...common, intent: { kind: "replace-creators", recipients: [a(91)] } });
    f.setAdminRevision(1n);
    await expect(revalidateModuleNativeTransaction(prepared, f.f.wallet)).rejects.toThrow("Reviewed management data changed");
    const rotation = await prepareModuleNativeManagementTransaction({ ...common, intent: { kind: "rotate-creator", index: 0, recipient: a(91) } });
    f.setCreator(a(92));
    await expect(revalidateModuleNativeTransaction(rotation, f.f.wallet)).rejects.toThrow("current recipient");
    await expect(prepareModuleNativeManagementTransaction({ ...common, deadline: now, intent: { kind: "claim-fees", recipient: a(91) } })).rejects.toThrow("expired");
  });
});
