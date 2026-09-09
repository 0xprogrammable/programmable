import { describe, expect, it } from "vitest";
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbiParameters, type Address, type Hex } from "viem";
import { buildLaunchPlanRoutedSwapV1, launchPlanTradeAmountsV1, parseLaunchPlanTradeRequestV1,
  ROUTED_FEE_RECIPIENT_V1, ROUTED_TRADE_CONTRACTS_V1, ROUTED_TRADE_REQUEST_V1, ROUTED_TRADE_ROUTER_ABI_V1 } from "@/lib/custom-launch/routed-trade-plan-v1";
import { projectionFixture, component, controller, now, nowIso } from "./fixtures/universal-launch-v1";

// Independent of V4Planner's ABI table: Universal Router 2.1.1 (999d561c)
// pins v4-periphery 3231810e39b8c4d569b9d66907fa4ef8cd2cec22.
// src/interfaces/IV4Router.sol SHA-256:
// 82048fb6a2b92a52aa37c516bc1d25dc31c062749016701345ee8e36b02306d9
// https://github.com/Uniswap/v4-periphery/blob/3231810e39b8c4d569b9d66907fa4ef8cd2cec22/src/interfaces/IV4Router.sol
const SWAP = parseAbiParameters("((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)");
const ACTIONS = parseAbiParameters("bytes actions,bytes[] params");
const PAYMENT = parseAbiParameters("address currency,uint256 amount");
const PORTION = parseAbiParameters("address currency,address recipient,uint256 bps");
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const SENDER = "0x0000000000000000000000000000000000000001" as const;

describe("routed trade ABI bound to the deployed Robinhood Universal Router", () => {
  it.each([
    { currency0: ZERO, zeroForOne: true },
    { currency0: ZERO, zeroForOne: false },
    { currency0: controller, zeroForOne: true },
    { currency0: controller, zeroForOne: false },
  ])("preserves $currency0 direction=$zeroForOne through the deployed struct and fee actions", ({ currency0, zeroForOne }) => {
    // Retain the real release binding here; no mocked RPC or SDK decoder.
    expect(ROUTED_TRADE_CONTRACTS_V1.universalRouter).toMatchObject({
      address: "0x06AfBA43Fd06227fA663b0DAecF536f6EaA6bf99",
      runtimeCodeHash: "0xbe8e8191bb42d843c2e948a5a55772eaab864ce01e54dcd47c9d089170b302d5",
    });
    const poolKey = { currency0, currency1: component, fee: 3000, tickSpacing: 60, hooks: ZERO };
    const projection = { ...projectionFixture(), markets: [{ marketId: "generic-market", kind: "uniswap_v4" as const,
      poolManager: ROUTED_TRADE_CONTRACTS_V1.poolManager.address as Address,
      currency0: { address: currency0 }, currency1: { componentId: "settlement" }, hooks: { address: ZERO }, fee: 3000, tickSpacing: 60 }],
    assuranceClaims: [{ claimType: "fee_on_programmable_routed_trades", subject: "route-fee",
      observedValue: { obligationId: "route-fee", mode: "programmable_routed", policyVersion: "programmable.custom-launch-fee.v1", rateBps: 20,
        scope: "programmable_built_or_routed_qualifying_swaps", recipient: ROUTED_FEE_RECIPIENT_V1, marketIds: ["generic-market"] },
      status: "disclosed" as const, witness: { kind: "policy" as const, ref: "fixture:fee", details: {} },
      assessor: "fixture", assessorVersion: "1", validAt: nowIso, blockNumber: "42" }] };
    const input = zeroForOne ? currency0 : component, output = zeroForOne ? component : currency0;
    // Empty, short, word-aligned, unaligned and the maximum accepted hook payload.
    for (const hookData of ["0x", "0x01020304", `0x${"ab".repeat(32)}`, `0x${"cd".repeat(33)}`, `0x${"ef".repeat(4096)}`] as Hex[]) {
      const request = parseLaunchPlanTradeRequestV1({ schemaVersion: ROUTED_TRADE_REQUEST_V1, chainId: "4663",
        launchId: projection.launchId, planHash: projection.planHash, marketId: "generic-market", owner: controller,
        zeroForOne, amountIn: "100000", slippageBps: 50, deadline: (now + 600n).toString(), hookData });
      const transaction = buildLaunchPlanRoutedSwapV1(projection, request, 50001n);
      const decoded = decodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, data: transaction.data });
      const [actions, params] = decodeAbiParameters(ACTIONS, decoded.args[1][0]!);
      const expectedSwap = { poolKey, zeroForOne, amountIn: 100000n,
        amountOutMinimum: 49750n, minHopPriceX36: 0n, hookData };
      expect(decodeAbiParameters(SWAP, params[0]!)[0]).toEqual(expectedSwap);
      const expectedParams = [encodeAbiParameters(SWAP, [expectedSwap]),
        encodeAbiParameters(PAYMENT, [input, 100000n]),
        encodeAbiParameters(PORTION, [output, ROUTED_FEE_RECIPIENT_V1, 20n]),
        encodeAbiParameters(PAYMENT, [output, 49651n])];
      expect(actions).toBe("0x060c100f"); // swap, settle, 20-bps output portion, trader minimum
      expect(params).toEqual(expectedParams);
      const expectedInputs = [encodeAbiParameters(ACTIONS, ["0x060c100f", expectedParams])];
      if (input === ZERO) expectedInputs.push(encodeAbiParameters(PORTION, [ZERO, SENDER, 0n]));
      expect(transaction.data).toBe(encodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, functionName: "execute",
        args: [input === ZERO ? "0x1004" : "0x10", expectedInputs, now + 600n] }));
      expect(transaction.to).toBe(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address);
      expect(transaction.value).toBe(input === ZERO ? "100000" : "0");
    }
    expect(launchPlanTradeAmountsV1(50001n, 20, 50)).toEqual({ grossAmountOut: "50001", platformFeeAmount: "100",
      amountOut: "49901", amountOutMinimum: "49651", grossAmountOutMinimum: "49750" });
  });
});
