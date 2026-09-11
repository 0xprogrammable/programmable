import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, type Hex, type TransactionReceipt } from "viem";
import { ROBINHOOD_MAINNET_RPC_URL } from "@/lib/chains";
import { moduleEngineHostAbi, moduleEnginePlanParameters } from "@/lib/module-engine/abi";
import { MODULE_ENGINE_ANY_QUOTE_ETH_SOURCE_ID } from "@/lib/module-engine/profile";
import { bindActiveModuleEngineRelease, bindModuleEngineTemplate, computeModuleEngineHostManifestHash, ENGINE_ZERO_ADDRESS as ZERO } from "@/lib/module-engine/catalog";
import { assertModuleEngineRelease, createModuleEngineClient, materializeModuleEngineRuntime, moduleEngineTradeIntent, prepareModuleEngineLaunch, prepareModuleEngineOperation, readModuleEngineLaunch, revalidateModuleEngineTransaction, verifyModuleEngineOperationReceipt } from "@/lib/module-engine/client";
import { fixture, ACCOUNT, QUOTE, TOKEN, CODE, CODE_HASH, addr, hash } from "./module-engine-fixture";

describe("Module Engine public RPC failover", () => {
  afterEach(() => vi.unstubAllGlobals());
  const secondaryUrl = "https://rpc-robinhood.blockmachine.io";
  const sourceRead = { address: addr(1), abi: moduleEngineHostAbi, functionName: "SOURCE_VERSION", blockNumber: 100n } as const;
  function responses(secondaryAvailable: boolean) {
    const attempts: { url: string; body: { id: number; method: string; params: unknown[] } }[] = [];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init), body = await request.json();
      const url = new URL(request.url).origin;
      attempts.push({ url, body });
      if (url === ROBINHOOD_MAINNET_RPC_URL || !secondaryAvailable) return new Response("Forbidden", { status: 403 });
      expect(url).toBe(secondaryUrl);
      return Response.json({ jsonrpc: "2.0", id: body.id, result: MODULE_ENGINE_ANY_QUOTE_ETH_SOURCE_ID });
    }));
    return attempts;
  }
  it("tries the secondary immediately after primary 403 and preserves the direct call and block", async () => {
    const attempts = responses(true);
    await expect(createModuleEngineClient().readContract(sourceRead)).resolves.toBe(MODULE_ENGINE_ANY_QUOTE_ETH_SOURCE_ID);
    expect(attempts.map(attempt => attempt.url)).toEqual([ROBINHOOD_MAINNET_RPC_URL, secondaryUrl]);
    const call = { method: "eth_call", params: [{ to: sourceRead.address, data: encodeFunctionData(sourceRead) }, "0x64"] };
    expect(attempts.map(({ body: { method, params } }) => ({ method, params }))).toEqual([call, call]);
  });
  it("rejects when both public providers fail without retrying either provider", async () => {
    const attempts = responses(false);
    await expect(createModuleEngineClient().readContract(sourceRead)).rejects.toThrow("HTTP request failed");
    expect(attempts.map(attempt => attempt.url)).toEqual([ROBINHOOD_MAINNET_RPC_URL, secondaryUrl]);
  });
});

describe("isolated engine source and transaction bindings", () => {
  it("uses the actual Host ABI without native launch selectors", () => { expect(moduleEngineHostAbi.some(item => item.type === "event" && item.name === "EngineLaunchBound")).toBe(true); expect(moduleEngineHostAbi.some(item => item.type === "event" && item.name.includes("Native"))).toBe(false); });
  it("rejects another host source even with the same reviewed pins", async () => { const f = fixture(); f.state.wrongSource = true; await expect(assertModuleEngineRelease(f)).rejects.toThrow("source version"); });
  it("rejects manifest or registry substitution", async () => { const f = fixture(); f.state.wrongManifest = true; await expect(prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN })).rejects.toThrow("manifest"); });
  it("keeps historical operations usable after new launches are disabled", async () => { const f = fixture(); f.state.enabled = false; expect((await prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN })).kind).toBe("execute"); await expect(prepareModuleEngineLaunch(f.launchInput)).rejects.toThrow("unavailable"); });
  it("reads a distinct host launch and exact engine context", async () => { const f = fixture(); expect(await readModuleEngineLaunch({ ...f, token: TOKEN })).toEqual(f.launch); });
  it("binds the token through its pinned factory and CREATE2 identity, not a global runtime hash", async () => { const f = fixture(); vi.mocked(f.client.getCode).mockImplementation(async ({ address }) => address.toLowerCase() === TOKEN.toLowerCase() ? "0x6001" : CODE); expect(await readModuleEngineLaunch({ ...f, token: TOKEN })).toEqual(f.launch); expect(() => bindActiveModuleEngineRelease({ ...f.release, tokenRuntimeCodeHash: CODE_HASH })).toThrow(); const read = vi.mocked(f.client.readContract).getMockImplementation()!; vi.mocked(f.client.readContract).mockImplementation(async input => input.functionName === "getUERC20Address" ? addr(888) : read(input)); await expect(readModuleEngineLaunch({ ...f, token: TOKEN })).rejects.toThrow("Factory token address"); });
  it("requires an exact Host allowance in the actual quote asset", async () => { const f = fixture(); f.state.allowance = 0n; const result = await prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN }); expect(result).toEqual({ kind: "approval-required", token: QUOTE, spender: f.host, amount: 5_000_000n, currentAllowance: 0n }); expect(f.client.call).not.toHaveBeenCalled(); });
  it("binds operation nonce and refuses a stale request before wallet", async () => { const f = fixture(); const prepared = await prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN }); expect(prepared.kind).toBe("execute"); if (prepared.kind === "approval-required") throw new Error(); f.state.nonce = 1n; await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).rejects.toThrow("nonce changed"); });
  it("keeps ERC20 asset roles meaningful for zero amounts", async () => { const f = fixture(); await expect(prepareModuleEngineOperation({ ...f, account: ACCOUNT, token: TOKEN, intent: { ...f.intent, inputAmount: 0n, outputAsset: TOKEN, minimumOutput: 0n } })).rejects.toThrow("asset roles"); });
  it("rejects creator-only authority that is merely declared by a UI", async () => { const f = fixture(); f.template.manifest.manifest.revision.operationPermissions[0].authorization = 1; f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest); f.state.authorization = 1; await expect(prepareModuleEngineOperation({ ...f, account: addr(89), token: TOKEN })).rejects.toThrow("Creator-only"); });
  it("prepares a real launch plan and byte-identical reviewed transaction", async () => { const f = fixture(); const result = await prepareModuleEngineLaunch(f.launchInput); expect(result.kind).toBe("launch"); if (result.kind !== "launch") throw new Error(); expect(result.transaction.to).toBe(f.host); expect(result.transaction.value).toBe("0x0"); expect(result.quoteDecimals).toBe(6); const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data: result.transaction.data }); expect(decoded.functionName).toBe("launch"); expect(result.planHash).toBe(keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, f.host, ACCOUNT, decoded.args![0] as never]))); expect(await revalidateModuleEngineTransaction(result, ACCOUNT)).toBe(result.transaction); await expect(revalidateModuleEngineTransaction(result, ACCOUNT)).rejects.toThrow("fresh"); });
  it("uses Host V1's admitted family list for Ledger V2 fees without calling a Native V2 Registry getter", async () => {
    const f = fixture(), families = [hash(11)];
    f.template.manifest.manifest.revision.eligibleFamilies = families;
    f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest);
    const reader = vi.mocked(f.client.readContract).getMockImplementation()!;
    vi.mocked(f.client.readContract).mockImplementation(async input => {
      if (input.functionName === "familyFeeEligibility") throw new Error("Registry V1 has no such selector");
      const result = await reader(input);
      return input.functionName === "getRevision" ? [...(result as unknown[]).slice(0, 3), families] : result;
    });
    const prepared = await prepareModuleEngineLaunch(f.launchInput);
    expect(prepared.kind).toBe("launch"); if (prepared.kind !== "launch") throw new Error();
    expect(prepared.platformFeeBps).toBe(30);
    await expect(revalidateModuleEngineTransaction(prepared, ACCOUNT)).resolves.toEqual(prepared.transaction);
    expect(f.client.readContract).not.toHaveBeenCalledWith(expect.objectContaining({ functionName: "familyFeeEligibility" }));
    const plain = fixture(), plainPrepared = await prepareModuleEngineLaunch(plain.launchInput);
    expect(plainPrepared.kind === "launch" && plainPrepared.platformFeeBps).toBe(10);
    await expect(prepareModuleEngineLaunch({ ...plain.launchInput, availability: { ...plain.availability, release: { ...plain.release, enabled: false } } as never })).rejects.toThrow("active");
  });
  it("rejects a fixed quote override and a fixed configuration override", async () => { const f = fixture(); f.template.manifest.manifest.revision.fixedQuoteAsset = addr(80); f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest); await expect(prepareModuleEngineLaunch(f.launchInput)).rejects.toThrow("Fixed quote"); f.template.manifest.manifest.revision.fixedQuoteAsset = ZERO; f.template.manifest.manifest.revision.fixedConfigurationHash = hash(88); f.template.manifestHash = computeModuleEngineHostManifestHash(f.template.manifest); await expect(prepareModuleEngineLaunch(f.launchInput)).rejects.toThrow("Fixed configuration"); });
  it("applies all constructor patches and rejects overlaps or partial words", () => { const template = `0x${"00".repeat(64)}6000` as Hex, args = `0x${"11".repeat(32)}${"22".repeat(32)}` as Hex; expect(materializeModuleEngineRuntime(template, args, [0, 32], [32, 0])).toBe(`0x${"22".repeat(32)}${"11".repeat(32)}6000`); expect(() => materializeModuleEngineRuntime(template, args, [0, 16], [0, 32])).toThrow("bounds"); expect(() => materializeModuleEngineRuntime(template, args, [0], [1])).toThrow("bounds"); });
  it("requires a nonzero ETH fee floor and preserves actual quote/primary directions", () => { expect(() => moduleEngineTradeIntent({ buy: true, token: TOKEN, quoteAsset: QUOTE, recipient: ACCOUNT, inputAmount: 1n, minimumOutput: 1n, minimumEthFees: 0n, conversionRoute: "0x" })).toThrow("positive"); const sell = moduleEngineTradeIntent({ buy: false, token: TOKEN, quoteAsset: QUOTE, recipient: ACCOUNT, inputAmount: 8n, minimumOutput: 4n, minimumEthFees: 2n, conversionRoute: "0x" }); expect(sell.inputAsset).toBe(TOKEN); expect(sell.outputAsset).toBe(QUOTE); });
  it("rejects a native event address or different operation nonce on readback", async () => { const f = fixture(); f.state.nonce = 1n; const operation = { ...f.intent, actor: ACCOUNT, nonce: 0n, deadline: f.state.timestamp + 300n }; const args = { launchId: f.launch.launchId, operationId: operation.operationId, actor: ACCOUNT, recipient: ACCOUNT, nonce: 0n, inputAsset: QUOTE, inputAmount: operation.inputAmount, outputAsset: ZERO, outputAmount: 0n, resultHash: hash(87) }; const event = moduleEngineHostAbi.find(item => item.type === "event" && item.name === "EngineOperationExecuted"); if (event?.type !== "event") throw new Error(); const receipt = { status: "success", transactionHash: hash(70), blockNumber: 100n, blockHash: f.blockHash, logs: [{ address: addr(777), transactionHash: hash(70), blockNumber: 100n, blockHash: f.blockHash, removed: false, topics: encodeEventTopics({ abi: moduleEngineHostAbi, eventName: "EngineOperationExecuted", args } as never), data: encodeAbiParameters(event.inputs.filter(item => !item.indexed), event.inputs.filter(item => !item.indexed).map(item => args[item.name as keyof typeof args])) }] } as unknown as TransactionReceipt; await expect(verifyModuleEngineOperationReceipt({ ...f, operation, receipt })).rejects.toThrow("exactly one"); receipt.logs[0].address = f.host; expect((await verifyModuleEngineOperationReceipt({ ...f, operation, receipt })).kind).toBe("execute"); await expect(verifyModuleEngineOperationReceipt({ ...f, operation: { ...operation, nonce: 2n }, receipt })).rejects.toThrow("nonce"); });
  it("does not accept an available label with another profile or altered ABI digest", () => { const f = fixture(); const bad = structuredClone(f.template); bad.manifest.manifest.source.engine.abiHash = hash(99); expect(() => bindModuleEngineTemplate(bad)).toThrow("ABI digest"); });
});
