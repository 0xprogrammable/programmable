import { getAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import chainProfile from "../../../contracts/spec/robinhood-custom-launch/chain-4663.v1.json";

const uniswap = chainProfile.contracts.uniswap;
export const ANY_QUOTE_CHAIN_ID = 4663 as const;
export const ANY_QUOTE_TOKEN_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const ANY_QUOTE_TICK_SPACING = 200 as const;
export const ANY_QUOTE_START_FDV_USD = 5_000n;
export const ANY_QUOTE_SCHEMA_ID = keccak256(stringToHex("programmable.any-quote.configuration.v1"));
export const ANY_QUOTE_PROFILE_ID = keccak256(stringToHex("robinhood-any-quote.shared-hook.v1"));
export const ANY_QUOTE_NATIVE_BUY_OPERATION_ID = keccak256(stringToHex("spot.buy.native-exact-input.v1"));
export const ANY_QUOTE_NATIVE = "0x0000000000000000000000000000000000000000" as Address;
export const ANY_QUOTE_WETH = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
export const ANY_QUOTE_USDG = getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168");
/** The installed SDK's chain-4663 address table still contains a superseded router. */
export const ANY_QUOTE_INFRASTRUCTURE = {
  universalRouter: getAddress(uniswap.universalRouter.address),
  universalRouterCodeHash: uniswap.universalRouter.runtimeCodeHash as Hex,
  poolManager: getAddress(uniswap.poolManager.address),
  poolManagerCodeHash: uniswap.poolManager.runtimeCodeHash as Hex,
  stateView: getAddress(uniswap.stateView.address),
  stateViewCodeHash: uniswap.stateView.runtimeCodeHash as Hex,
  v4Quoter: getAddress(uniswap.v4Quoter.address),
  v4QuoterCodeHash: uniswap.v4Quoter.runtimeCodeHash as Hex,
  v3Factory: getAddress("0x1f7d7550B1b028f7571E69A784071F0205FD2EfA"),
  v3FactoryCodeHash: "0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739" as Hex,
  v3Quoter: getAddress("0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7"),
  v3QuoterCodeHash: "0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28" as Hex,
  v2Factory: getAddress("0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f"),
  v2FactoryCodeHash: "0xbab145d02e7005f0d84c6c1639d39b799b0ea16df99ebbdaf5a14d9da820b4e0" as Hex,
  permit2: getAddress(uniswap.permit2.address),
} as const;

export type AnyQuoteRationalV1 = { numerator: string; denominator: string };
export type AnyQuoteCheckpointV1 = { number: string; hash: Hex; timestamp: string };
export type AnyQuotePoolKeyV1 = {
  currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address;
};
export type AnyQuoteModulePoolV1 = {
  token: Address; quoteAsset: Address; sharedHook: Address; poolId: Hex;
};
export type AnyQuoteAmmHopV1 =
  | { protocol: "V2"; tokenIn: Address; tokenOut: Address; pool: Address }
  | { protocol: "V3"; tokenIn: Address; tokenOut: Address; pool: Address; fee: number }
  | { protocol: "V4"; tokenIn: Address; tokenOut: Address; poolId: Hex; key: AnyQuotePoolKeyV1; hookData: Hex };

/** Typed discovery output. A route quote is not proof of ERC20 transfers or of the composed trade. */
export type AnyQuoteExternalRouteV1 = {
  provider: "uniswap-trading-api" | "weth-identity";
  chainId: 4663;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  amountOut: string;
  hops: readonly AnyQuoteAmmHopV1[];
  checkpoint: AnyQuoteCheckpointV1;
  validUntil: string;
  evidenceHash: Hex;
};

export type AnyQuotePriceEvidenceV1 = {
  usd: AnyQuoteRationalV1;
  source: "chainlink" | "robinhood-stock-rest" | "qualified-amm";
  observedAt: string;
  validUntil: string;
  evidenceHash: Hex;
  /** Feed-specific heartbeat, or bounded HTTP freshness, never a universal oracle cutoff. */
  heartbeatSeconds: number;
};

export type AnyQuoteReadinessV1 =
  | {
      status: "compatible"; chainId: 4663; quoteAsset: Address;
      token: { name: string; symbol: string; decimals: number };
      checkpoint: AnyQuoteCheckpointV1;
      price: AnyQuotePriceEvidenceV1;
      routes: { buy: AnyQuoteExternalRouteV1; sell: AnyQuoteExternalRouteV1 };
      validUntil: string; evidenceHash: Hex;
      checks: {
        codeAndMetadata: "verified";
        routePools: "verified-at-checkpoint";
        externalQuotes: "same-block-bidirectional";
        fullExecution: "required-before-signing";
      };
    }
  | {
      status: "incompatible" | "inconclusive"; chainId: 4663;
      quoteAsset: Address | null; code: string; retryable: boolean;
    };

export class AnyQuoteErrorV1 extends Error {
  constructor(readonly code: string, readonly status: "incompatible" | "inconclusive" = "inconclusive") {
    super(code);
    this.name = "AnyQuoteErrorV1";
  }
}
export function anyQuoteAddressV1(value: unknown, allowNative = false): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new AnyQuoteErrorV1("INVALID_ADDRESS", "incompatible");
  const result = getAddress(value.toLowerCase());
  if (BigInt(result) < 3n && (!allowNative || BigInt(result) !== 0n)) throw new AnyQuoteErrorV1("INVALID_ADDRESS", "incompatible");
  return result;
}
export const anyQuoteSameAddressV1 = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function anyQuoteUintV1(value: unknown, max = (1n << 256n) - 1n, allowZero = false): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value)) throw new AnyQuoteErrorV1("INVALID_AMOUNT");
  const parsed = BigInt(value);
  if (parsed > max || (!allowZero && parsed === 0n)) throw new AnyQuoteErrorV1("INVALID_AMOUNT");
  return parsed;
}
