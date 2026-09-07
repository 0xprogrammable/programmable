import { parseAbi, parseAbiParameters } from "viem";
import { moduleModeLaunchAbi } from "./provenance";
import type { ModuleModeRelease } from "./release";

export const MODULE_NATIVE_SELECTION_TYPE = "(bytes32 packageId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,uint32 callbackGas,bytes config)[]";
export const MODULE_NATIVE_METADATA_TYPE = "(string description,string website,string image,bytes extraData)";
export const moduleNativeLaunchAbi = [...moduleModeLaunchAbi, ...parseAbi([
  `function launch((string name,string symbol,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,bytes32 creatorSalt,${MODULE_NATIVE_METADATA_TYPE} metadata,address[] creatorWallets,uint16[] creatorSharesBps,${MODULE_NATIVE_SELECTION_TYPE} modules,uint256[] moduleFunding,uint256 initialBuyNative,uint256 minimumInitialTokenOut,uint256 deadline) parameters) payable returns ((bytes32 launchId,address launchWallet,address token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens,address runtime,bytes32 launchKey))`,
  "function predictTokenAddress(string name,string symbol,address launchWallet,bytes32 creatorSalt) view returns (address token,bytes32 effectiveGraffiti)",
]) ] as const;
/** V1's selector and parameter tuple remain unchanged for historical releases. */
export const moduleNativeLaunchV2Abi = [...moduleNativeLaunchAbi.filter(item => item.type !== "function" || item.name !== "launch"), ...parseAbi([
  `function launch((string name,string symbol,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,bytes32 creatorSalt,${MODULE_NATIVE_METADATA_TYPE} metadata,address[] creatorWallets,uint16[] creatorSharesBps,${MODULE_NATIVE_SELECTION_TYPE} modules,uint256[] moduleFunding,uint256 initialBuyNative,uint256 minimumInitialTokenOut,uint256 deadline,bytes32 expectedRecipeHash) parameters) payable returns ((bytes32 launchId,address launchWallet,address token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens,address runtime,bytes32 launchKey))`,
])] as const;
export function moduleNativeLaunchAbiFor(release: Pick<ModuleModeRelease, "sourceVersion">) {
  return release.sourceVersion === "module-native-v2" ? moduleNativeLaunchV2Abi : moduleNativeLaunchAbi;
}
export const moduleNativeRouterAbi = parseAbi([
  "function swap(address token,bool isBuy,int256 amountSpecified,uint256 limit,address recipient,uint256 deadline) payable returns (uint256 nativeAmount,uint256 tokenAmount)",
  "event NativeTradeCompleted(bytes32 indexed poolId,address indexed actor,address indexed recipient,bool isBuy,int256 amountSpecified,uint256 nativeAmount,uint256 tokenAmount)",
]);
export const moduleNativeReadAbi = parseAbi([
  "function poolManager() view returns (address)", "function positionManager() view returns (address)",
  "function tokenFactory() view returns (address)", "function feeHook() view returns (address)",
  "function swapRouter() view returns (address)", "function swapRouterFactory() view returns (address)",
  "function positionPlanner() view returns (address)", "function launchPolicy() view returns (address)",
  "function positionForwarderFactory() view returns (address)", "function minInitialBuyNative() view returns (uint256)",
  "function registry() view returns (address)", "function runtimeFactory() view returns (address)",
  "function ledger() view returns (address)", "function runtime() view returns (address)",
  "function engine() view returns (address)", "function engineCodeHash() view returns (bytes32)",
  "function vault() view returns (address)", "function source() view returns (address)", "function hook() view returns (address)",
  "function runtimeOf(address engine) view returns (address)", "function routerOf(address source) view returns (address)",
  "function poolConfig(bytes32 poolId) view returns (address registrar,address launchWallet,address router,bytes32 routerCodeHash,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,bytes32 recipeHash,bytes32 launchKey)",
  "function getRevision(bytes32 packageId) view returns ((bytes32 familyId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas,bool enabled))",
  "function creator() view returns (address)", "function name() view returns (string)", "function symbol() view returns (string)",
  "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)", "function allowance(address owner,address spender) view returns (uint256)",
  "function feeComponents(bytes32 poolId,bool isBuy) view returns (uint16 creatorBps,uint16 platformBps,uint16 poolProtocolPips,uint24 poolLpPips)",
]);
export const moduleNativeReadV2Abi = [...moduleNativeReadAbi.filter(item => item.name !== "poolConfig"), ...parseAbi([
  "function ECONOMICS_POLICY_ID() view returns (bytes32)",
  "function PROTOCOL_FEE_BPS() view returns (uint16)",
  "function AUTHOR_POOL_FEE_BPS() view returns (uint16)",
  "function familyFeeEligibility(bytes32 familyId) view returns (bool eligible,bytes32 reviewDigest)",
  `function previewRecipe(uint16 buyFee,uint16 sellFee,${MODULE_NATIVE_SELECTION_TYPE} modules) view returns (bytes32 recipeHash,bytes32[] families)`,
  "function poolConfig(bytes32 poolId) view returns (address registrar,address launchWallet,address router,bytes32 routerCodeHash,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,bytes32 recipeHash,bytes32 launchKey,uint16 platformFeeBps)",
  "function platformFeeBps(bytes32 poolId) view returns (uint16)",
  "function quoteGrossFees(bytes32 poolId,bool isBuy,uint256 amount) view returns (uint256 creator,uint256 platform)",
  "function quoteExactOutputFees(bytes32 poolId,bool isBuy,uint256 amount) view returns (uint256 creator,uint256 platform)",
  "function eligibilitySnapshot(bytes32 poolId) view returns (bool[] selectionEligible,bytes32[] selectionReviewDigests)",
  "event NativeEconomicsBound(bytes32 indexed poolId,bytes32 indexed economicsPolicyId,uint16 protocolFeeBps,uint16 authorPoolFeeBps,bytes32[] eligibleFamilies,bool[] selectionEligible,bytes32[] selectionReviewDigests)",
])] as const;
export function moduleNativeReadAbiFor(release: Pick<ModuleModeRelease, "sourceVersion">) {
  return release.sourceVersion === "module-native-v2" ? moduleNativeReadV2Abi : moduleNativeReadAbi;
}
export const moduleNativeApprovalAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
]);
export const moduleNativePoolParameters = parseAbiParameters("address,address,uint24,int24,address");
