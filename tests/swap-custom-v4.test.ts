import { describe, expect, it, vi } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, getAddress, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
vi.mock("server-only", () => ({}));
vi.mock("@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json", async importOriginal => {
  const original = await importOriginal<{ default: { contracts: { uniswap: Record<string, { runtimeCodeHash: string }>; programmable: { programmableLaunchStampRouter: { runtimeCodeHash: string } } } } }>();
  const value = structuredClone(original.default), { keccak256 } = await import("viem");
  for (const item of Object.values(value.contracts.uniswap)) item.runtimeCodeHash = keccak256("0x6001600055");
  value.contracts.programmable.programmableLaunchStampRouter.runtimeCodeHash = keccak256("0x6001600055");
  return { default: value };
});
import profile from "@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json";
import { ROUTED_TRADE_CONTRACTS_V1 as infra, ROUTED_TRADE_PERMIT2_ABI_V1, ROUTED_TRADE_ROUTER_ABI_V1, ROUTED_TRADE_TOKEN_ABI_V1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { buildCustomV4Swap, buildCustomV4SwapApproval, CUSTOM_V4_NATIVE, customV4PoolId, customV4SwapPreparationDigest, parseCustomV4SwapRequest,
  prepareCustomV4SwapWallet, validateCustomV4SwapPreparation, type CustomV4SwapRequest } from "@/lib/swap/custom-v4";
import { prepareCustomV4Swap, readCustomV4SwapDescriptor } from "@/lib/server/swap/custom-v4";
import type { TradeRpcV1 } from "@/lib/server/custom-launch/routed-trade-rpc-v1";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";

const runtime = "0x6001600055" as Hex, runtimeHash = keccak256(runtime), now = 1800000000n;
const owner = getAddress("0x1111111111111111111111111111111111111111"), token = getAddress("0x2222222222222222222222222222222222222222"), hook = getAddress("0x3333333333333333333333333333333333333333");
const router = getAddress(profile.contracts.programmable.programmableLaunchStampRouter.address);
const hash = `0x${"12".repeat(32)}` as Hex, txHash = `0x${"23".repeat(32)}` as Hex, stampHash = `0x${"34".repeat(32)}` as Hex;
const poolKey = { currency0: CUSTOM_V4_NATIVE, currency1: token, fee: 3000, tickSpacing: 60, hooks: hook };
const INITIALIZE = parseAbi(["event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)"]);
const STAMP = parseAbi(["function launchStamp(bytes32) view returns ((uint8 kind,address launchWallet,address token,address hook,address poolManager,bytes32 poolId,bytes32 poolKeyHash,bytes32 componentSetHash,bytes32 routePayloadHash,address routeLauncher,bytes32 routeLauncherRuntimeCodeHash,bytes32 expectedResultHash,bytes32 permitDigest,bytes32 stampHash))", "function componentRuntimeCodeHash(address) view returns(bytes32)", "function launchIdByToken(address) view returns(bytes32)"]);
const TAKE = parseAbi(["function take(address,address,uint256)"]);
function launch(): RobinhoodLaunch { return { routerAddress: router, launchId: hash, tokenAddress: token, hookAddress: hook, creator: owner,
  poolManager: infra.poolManager.address, poolId: customV4PoolId(poolKey), stampHash, transactionHash: txHash, blockNumber: "42", blockHash: hash,
  logIndex: 10, launchedAt: null, name: "Fixture", symbol: "FIX", decimals: 18 }; }
function request(buy = true): CustomV4SwapRequest { return { token, owner, buy, amountIn: "100000", slippageBps: 50, deadline: (now + 600n).toString() }; }
type Options = { buy?: boolean; tokenApproval?: boolean; permitApproval?: boolean; revert?: boolean; outputMismatch?: boolean;
  overspend?: boolean; poolOriginMissing?: boolean; runtimeChanged?: boolean; stampOwnerChanged?: boolean; finalityPending?: boolean; incorrectApproval?: boolean };
function fixtureRpc(options: Options = {}): TradeRpcV1 {
  return async (method, params) => {
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_getBlockByNumber") return { number: params[0] === "0x2a" ? "0x2a" : options.finalityPending && params[0] === "finalized" ? "0x20" : "0x64", hash, timestamp: toHex(now) };
    if (method === "eth_getTransactionReceipt") return { status: "0x1", transactionHash: txHash, blockHash: hash, blockNumber: "0x2a", logs: options.poolOriginMissing ? [] : [{
      address: infra.poolManager.address, transactionHash: txHash, blockHash: hash, blockNumber: "0x2a", logIndex: "0x3", removed: false,
      topics: encodeEventTopics({ abi: INITIALIZE, eventName: "Initialize", args: { id: customV4PoolId(poolKey), currency0: CUSTOM_V4_NATIVE, currency1: token } }),
      data: encodeAbiParameters([{ type: "uint24" }, { type: "int24" }, { type: "address" }, { type: "uint160" }, { type: "int24" }], [3000, 60, hook, 1n << 96n, 0]),
    }] };
    if (method === "eth_getCode") return getAddress(String(params[0])) === owner ? "0x" : options.runtimeChanged && getAddress(String(params[0])) === hook ? "0x6002" : runtime;
    if (method === "eth_getBalance") return toHex(10n ** 18n);
    if (method === "eth_estimateGas") return "0x186a0";
    const tx = params[0] as { from: Address; to: Address; data: Hex; value: Hex };
    if (method === "eth_call") {
      if (tx.to.toLowerCase() === router.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: STAMP, data: tx.data });
        if (decoded.functionName === "componentRuntimeCodeHash") return encodeFunctionResult({ abi: STAMP, functionName: decoded.functionName, result: runtimeHash });
        if (decoded.functionName === "launchIdByToken") return encodeFunctionResult({ abi: STAMP, functionName: decoded.functionName, result: hash });
        const keyHash = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
          [keccak256(toHex("ProgrammablePoolKeyV1(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)")), CUSTOM_V4_NATIVE, token, 3000, 60, hook]));
        return encodeFunctionResult({ abi: STAMP, functionName: "launchStamp", result: { kind: 1, launchWallet: options.stampOwnerChanged ? token : owner, token, hook,
          poolManager: getAddress(infra.poolManager.address), poolId: customV4PoolId(poolKey), poolKeyHash: keyHash, componentSetHash: hash,
          routePayloadHash: hash, routeLauncher: router, routeLauncherRuntimeCodeHash: runtimeHash, expectedResultHash: hash, permitDigest: hash, stampHash } });
      }
      if (tx.to.toLowerCase() === infra.v4Quoter.address.toLowerCase()) return encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [50000n, 100000n]);
      if (tx.to.toLowerCase() === infra.universalRouter.address.toLowerCase()) return "0x";
      if (tx.to.toLowerCase() === infra.permit2.address.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, data: tx.data });
        if (decoded.functionName === "approve") return "0x";
        return encodeFunctionResult({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "allowance", result: [options.permitApproval && !params[2] ? 0n : options.incorrectApproval && params[2] ? 99999n : 100000n, Number(now + 600n), 0] });
      }
      const decoded = decodeFunctionData({ abi: ROUTED_TRADE_TOKEN_ABI_V1, data: tx.data });
      if (decoded.functionName === "approve") return toHex(1n, { size: 32 });
      if (decoded.functionName === "decimals") return toHex(18n, { size: 32 });
      if (decoded.functionName === "allowance") return toHex(params[2] ? options.incorrectApproval ? 99999n : 100000n : options.tokenApproval ? 0n : 100000n, { size: 32 });
      return toHex(params[2] ? options.buy === false ? 900000n : options.outputMismatch ? 1049999n : 1050000n : 1000000n, { size: 32 });
    }
    if (method === "debug_traceCall") {
      if ((params[2] as { tracer: string }).tracer === "prestateTracer") return { pre: { [owner.toLowerCase()]: { balance: toHex(10n ** 18n) } },
        post: { [owner.toLowerCase()]: { balance: toHex(options.buy === false ? 10n ** 18n + 50000n : 10n ** 18n - (options.overspend ? 100001n : 100000n)) } } };
      const approval = options.tokenApproval || options.permitApproval;
      return { type: "CALL", from: tx.from, to: tx.to, input: tx.data, value: tx.value, gasUsed: "0x186a0",
        output: options.tokenApproval ? toHex(1n, { size: 32 }) : "0x", ...(options.revert ? { error: "execution reverted" } : {}),
        calls: approval ? [] : [{ type: "CALL", from: infra.universalRouter.address, to: infra.poolManager.address, value: "0x0", gasUsed: "0x2710",
          input: encodeFunctionData({ abi: TAKE, functionName: "take", args: [options.buy === false ? CUSTOM_V4_NATIVE : token, owner, 50000n] }), output: "0x" }] };
    }
    throw new Error(`Unexpected fixture RPC ${method}`);
  };
}
const prepared = (options: Options = {}) => prepareCustomV4Swap(request(options.buy !== false), { loadLaunch: async () => launch(), rpcs: [fixtureRpc(options), fixtureRpc(options)], now: () => now });
const descriptor = () => readCustomV4SwapDescriptor(launch(), { rpcs: [fixtureRpc(), fixtureRpc()] });

describe("historical V4 native swap adapter", () => {
  it("retains real Router V1 provenance and reconstructs an ETH buy without a new route fee", async () => {
    const value = await prepared(), source = await descriptor();
    expect(source.source.kind).toBe("router_v1"); expect(source.launch).not.toHaveProperty("launchProjection");
    expect(value).not.toHaveProperty("fee");
    expect(validateCustomV4SwapPreparation(value, { descriptor: source, request: request() }, now)).toBe(value);
    const decoded = decodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, data: value.transaction.data });
    expect(decoded.args[0]).toBe("0x1004");
    const [actions] = decodeAbiParameters([{ type: "bytes" }, { type: "bytes[]" }], decoded.args[1][0]!);
    expect(actions).toBe("0x060c0f");
    expect(value.evidence.settlement?.outputBalanceIncrease).toBe("50000");
  });
  it("proves a sell pays ETH to the connected owner", async () => {
    const value = await prepared({ buy: false });
    expect(value.transaction.value).toBe("0"); expect(value.quote.outputDecimals).toBe(18);
    expect(validateCustomV4SwapPreparation(value, { descriptor: await descriptor(), request: request(false) }, now)).toBe(value);
  });
  it.each([{ tokenApproval: true, kind: "token_approval" }, { permitApproval: true, kind: "permit2_approval" }])("prepares exact $kind only", async options => {
    const value = await prepared({ buy: false, ...options });
    expect(value.status).toBe("approval_required"); expect(value.transaction.kind).toBe(options.kind); expect(value.evidence.settlement).toBeNull();
    expect(validateCustomV4SwapPreparation(value, { descriptor: await descriptor(), request: request(false) }, now)).toBe(value);
    expect(value.transaction).toEqual({ ...buildCustomV4SwapApproval(request(false), options.kind as "token_approval" | "permit2_approval"), gasLimit: "120000" });
  });
  it.each([{ poolOriginMissing: true }, { runtimeChanged: true }, { stampOwnerChanged: true }, { finalityPending: true }])("rejects changed source evidence %j", async options => {
    await expect(prepared(options)).rejects.toThrow();
  });
  it.each([{ outputMismatch: true }, { overspend: true }, { revert: true }, { buy: false, tokenApproval: true, incorrectApproval: true }])("rejects unproven execution effects %j", async options => {
    await expect(prepared(options)).rejects.toThrow();
  });
  it("does not accept an RPC disagreement as a successful trade", async () => {
    await expect(prepareCustomV4Swap(request(), { loadLaunch: async () => launch(), rpcs: [fixtureRpc(), fixtureRpc({ outputMismatch: true })], now: () => now })).rejects.toThrow();
  });
  it("rejects altered transaction bytes even with a recomputed response digest", async () => {
    const value = await prepared(), source = await descriptor(), changed = { ...value, transaction: { ...value.transaction, to: token } };
    const { preparationDigest, ...body } = changed;
    expect(preparationDigest).not.toBe(customV4SwapPreparationDigest(body));
    expect(() => validateCustomV4SwapPreparation({ ...body, preparationDigest: customV4SwapPreparationDigest(body) }, { descriptor: source, request: request() }, now)).toThrow();
    expect(() => validateCustomV4SwapPreparation(value, { descriptor: source, request: request() }, now + 26n)).toThrow();
    expect(() => buildCustomV4Swap(source, { ...request(), token: hook }, 50000n)).toThrow();
  });
  it("rejects generic calldata, unexpected recipients and unbounded input", () => {
    expect(() => parseCustomV4SwapRequest({ ...request(), to: router })).toThrow();
    expect(() => parseCustomV4SwapRequest({ ...request(), amountIn: (1n << 128n).toString() })).toThrow();
    expect(() => buildCustomV4SwapApproval(request(), "token_approval")).toThrow();
  });
  it("wallet preparation reconstructs and checks the transaction without sending", async () => {
    const value = await prepared(), source = await descriptor(), methods: string[] = [];
    const clock = vi.spyOn(Date, "now").mockReturnValue(Number(now * 1000n));
    try {
      const result = await prepareCustomV4SwapWallet({ request: async ({ method, params }) => {
        methods.push(method);
        if (method === "eth_accounts") return [owner]; if (method === "eth_chainId") return "0x1237";
        if (method === "eth_getCode") return String(params?.[0]).toLowerCase() === owner.toLowerCase() ? "0x" : runtime;
        if (method === "eth_getTransactionCount") return "0x1";
        if (method === "eth_call") return "0x"; if (method === "eth_estimateGas") return "0x186a0";
        if (method === "eth_gasPrice") return "0x1"; if (method === "eth_getBalance") return toHex(10n ** 18n);
        throw new Error("Unexpected wallet request");
      } }, owner, { action: "review", descriptor: source, request: request() }, (async () => Response.json(value)) as typeof fetch);
      expect(result.transaction.to).toBe(getAddress(infra.universalRouter.address)); expect(result.transaction.nonce).toBe("0x1");
      expect(methods).not.toContain("eth_sendTransaction");
    } finally { clock.mockRestore(); }
  });
});
