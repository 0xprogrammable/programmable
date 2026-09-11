// Exact host ABI shared with product module-engine/abi.ts; resources below are read from actual engines.
import { parseAbi, parseAbiParameters } from "viem";
export const ENGINE_CONTEXT = "(address host,bytes32 launchId,address token,address creator,address quoteAsset,address feeCollector)";
export const ENGINE_OPERATION = "(bytes32 operationId,address actor,address recipient,address inputAsset,uint256 inputAmount,address outputAsset,uint256 minimumOutput,uint256 deadline,uint256 nonce,bytes data)";
export const ENGINE_PERMISSION = "(bytes32 operationId,uint8 inputRoles,uint8 outputRoles,uint8 authorization)";
export const ENGINE_REVISION = "(bytes32 familyId,bytes32 creationCodeHash,bytes32 runtimeTemplateHash,bytes32 manifestHash,address fixedQuoteAsset,bytes32 fixedConfigurationHash,bytes32 initialOperationId,uint32 executionGas,uint8 moneyRights,uint8 coinRights,bool enabled)";
export const ENGINE_LAUNCH = "(bytes32 launchId,bytes32 revisionId,address creator,address token,address quoteAsset,address engine,bytes32 engineCodeHash,bytes32 constructorHash,bytes32 initCodeHash,bytes32 configurationHash,bytes32 planHash,bytes32 resourcesHash,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps)";
export const ENGINE_LAUNCH_PARAMETERS = `(string name,string symbol,bytes32 creatorSalt,bytes32 revisionId,address quoteAsset,bytes configuration,bytes creationCode,bytes runtimeTemplate,bytes32 engineSalt,bytes launchData,(string description,string website,string image,bytes extraData) metadata,address[] creatorWallets,uint16[] creatorSharesBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,${ENGINE_OPERATION} initialOperation)`;
export const MODULE_ENGINE_PARAMETERS_MAX_BYTES_V1 = 113984;
export const moduleEngineConstructorParameters = parseAbiParameters(`${ENGINE_CONTEXT} context,bytes configuration`);
export const moduleEnginePlanParameters = parseAbiParameters(`uint256 chainId,address host,address creator,${ENGINE_LAUNCH_PARAMETERS} parameters`);
export const moduleEngineHostAbi = parseAbi([
    "function SOURCE_VERSION() view returns (bytes32)", "function tokenFactory() view returns (address)",
    "function launchPolicy() view returns (address)", "function registry() view returns (address)", "function ledger() view returns (address)",
    `function getRevision(bytes32 revisionId) view returns (${ENGINE_REVISION} revision,uint32[] runtimeOffsets,uint32[] constructorOffsets,bytes32[] eligibleFamilies)`,
    `function permission(bytes32 revisionId,bytes32 operationId) view returns (${ENGINE_PERMISSION} grant)`,
    `function approveRevision(bytes32 revisionId,${ENGINE_REVISION} revision,uint32[] runtimeOffsets,uint32[] constructorOffsets,${ENGINE_PERMISSION}[] permissions,bytes32[] eligibleFamilies)`,
    `function getLaunch(bytes32 launchId) view returns (${ENGINE_LAUNCH} launched)`,
    "function launchIdOf(address token) view returns (bytes32)", "function engineLaunchId(address engine) view returns (bytes32)",
    "function nonces(bytes32 launchId,address actor) view returns (uint256)",
    "function feeTerms(bytes32 launchId,bool buy) view returns (uint16 platformBps,uint16 creatorBps)",
    "function predictTokenAddress(string name,string symbol,address creator,bytes32 salt) view returns (address token,bytes32 graffiti)",
    `function launch(${ENGINE_LAUNCH_PARAMETERS} parameters) payable returns (${ENGINE_LAUNCH} launched)`,
    `function execute(bytes32 launchId,${ENGINE_OPERATION} operation) payable returns (bytes result)`,
    `event EngineRevisionApproved(bytes32 indexed revisionId,bytes32 indexed familyId,${ENGINE_REVISION} revision)`,
    "event EngineLaunchBound(bytes32 indexed launchId,address indexed token,address indexed engine,address creator,address quoteAsset,bytes32 revisionId,bytes32 constructorHash,bytes32 initCodeHash,bytes32 runtimeCodeHash,bytes32 configurationHash,bytes32 resourcesHash,bytes32 economicsPolicyId,bytes32 planHash)",
    "event EngineLaunchParametersBound(bytes32 indexed launchId,bytes encodedParameters)",
    "event EngineOperationExecuted(bytes32 indexed launchId,bytes32 indexed operationId,address indexed actor,address recipient,uint256 nonce,address inputAsset,uint256 inputAmount,address outputAsset,uint256 outputAmount,bytes32 resultHash)",
] as readonly string[]);
export const moduleEngineReadAbi = parseAbi([
    "function hook() view returns (address)", "function poolManager() view returns (address)", "function registry() view returns (address)",
    "function ECONOMICS_POLICY_ID() view returns (bytes32)", "function PROTOCOL_FEE_BPS() view returns (uint16)", "function AUTHOR_POOL_FEE_BPS() view returns (uint16)",
    "function platformFeeBps(bytes32 launchId) view returns (uint16)", "function owner() view returns (address)",
    "function families(bytes32 familyId) view returns (address author,address wallet)",
    "function familyFeeEligibility(bytes32 familyId) view returns (bool eligible,bytes32 reviewDigest)",
    "function creator() view returns (address)", "function contextHash() view returns (bytes32)",
    "function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)",
    "function balanceOf(address actor) view returns (uint256)", "function allowance(address actor,address spender) view returns (uint256)",
    "function credit(address actor) view returns (uint256)", "function totalLiability() view returns (uint256)", "function unlockTime() view returns (uint256)",
    "function requests(bytes32 requestId) view returns (address payer,address beneficiary,uint256 amount,uint256 refundAfter,bytes32 obligationHash,uint8 status)",
    "function poolId() view returns (bytes32)", "function quoteDecimals() view returns (uint8)",
]);
export const moduleEngineTradeLimitsParameters = parseAbiParameters("(uint256 minimumEthFees,uint160 sqrtPriceLimitX96,bytes conversionRoute) limits");
export const moduleEngineResourcesAbi = parseAbi([
    "function name() view returns (string)", "function graffiti() view returns (bytes32)",
    "function getUERC20Address(string name,string symbol,uint8 decimals,address creator,bytes32 graffiti) view returns (address)",
    "function configurationHash(bytes32 launchId) view returns (bytes32)",
    "function moduleCount(bytes32 launchId) view returns (uint256)", "function moduleFamilyAt(bytes32 launchId,uint256 index) view returns (bytes32)",
    "function creatorRecipients(bytes32 launchId) view returns (address[] wallets,uint16[] sharesBps,uint256 adminRevision)",
    "function poolKey() view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
    "function positionManager() view returns (address)", "function positionPlanner() view returns (address)",
    "function positionForwarderFactory() view returns (address)", "function converter() view returns (address)",
    "function converterCodeHash() view returns (bytes32)", "function poolManagerCodeHash() view returns (bytes32)",
    "function positionManagerCodeHash() view returns (bytes32)", "function positionPlannerCodeHash() view returns (bytes32)",
    "function positionForwarderFactoryCodeHash() view returns (bytes32)",
    "function positionTokenId() view returns (uint256)", "function positionRecipient() view returns (address)",
    "function initialAbsoluteTick() view returns (int24)", "function lockedTokenDust() view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)", "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
    "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,uint256 info)",
    "function initialized() view returns (bool)",
    "event PoolRegistered(bytes32 indexed poolId,bytes32 indexed configurationHash,address[] creatorWallets,uint16[] creatorSharesBps,bytes32[] moduleFamilies)",
    "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
]);
export const MODULE_ENGINE_INDEX_ABI_V1 = [...moduleEngineHostAbi, ...moduleEngineReadAbi, ...moduleEngineResourcesAbi];
export const anyQuoteConfigurationParameters = parseAbiParameters("(bytes32 schemaId,address poolManager,bytes32 poolManagerCodeHash,address sharedHook,address quoteAsset,int24 initialTick,uint64 validUntil,bytes32 priceEvidenceHash) configuration");
/** Separate source profile; these names never reinterpret the existing native ledger reads. */
export const MODULE_ENGINE_ANY_QUOTE_INDEX_ABI_V1 = [...MODULE_ENGINE_INDEX_ABI_V1, ...parseAbi([
    "function host() view returns (address)", "function sharedHook() view returns (address)",
    "function nativeRouteGuard() view returns (address)", "function NATIVE_ROUTE_GUARD_CODE_HASH() view returns (bytes32)",
    "function quotePoolManager() view returns (address)", "function quotePoolManagerCodeHash() view returns (bytes32)",
    "function UNIVERSAL_ROUTER() view returns (address)", "function UNIVERSAL_ROUTER_CODE_HASH() view returns (bytes32)",
    "function quoteFeeProfileId() view returns (bytes32)",
    "function quoteAsset(bytes32 launchId) view returns (address)",
    "function poolIdOf(bytes32 launchId) view returns (bytes32)", "function poolIdOfLaunch(bytes32 launchId) view returns (bytes32)",
    "function poolConfig(bytes32 poolId) view returns ((bytes32 launchId,bytes32 revisionId,bytes32 familyId,bytes32 configurationHash,address token,address quoteAsset,address initializer,int24 initialTick,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps))",
    "function initialTick() view returns (int24)", "function tickLower() view returns (int24)", "function tickUpper() view returns (int24)",
    "function lockedLiquidity() view returns (uint128)",
    "event SharedQuotePoolBound(bytes32 indexed poolId,bytes32 indexed launchId,address indexed token,address quoteAsset,address engine,bytes32 revisionId,bytes32 familyId,bytes32 configurationHash,int24 initialTick,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps)",
    "event QuotePoolSwap(bytes32 indexed poolId,bytes32 indexed launchId,address indexed swapSender,bool buy,bool exactInput,uint256 grossQuote,uint256 platformQuote,uint256 creatorQuote,int128 coreAmount0,int128 coreAmount1)",
    "event QuoteLaunchRegistered(bytes32 indexed launchId,address indexed asset,bytes32 configurationHash,address[] creatorWallets,uint16[] creatorSharesBps)",
    "event QuoteFeesAccrued(bytes32 indexed launchId,address indexed asset,uint256 platform,uint256 creator,uint256 credited)",
    "event QuoteRewardCredited(bytes32 indexed launchId,address indexed asset,address indexed beneficiary,uint256 amount)",
    "event QuoteFeesClaimed(address indexed asset,address indexed beneficiary,address indexed recipient,uint256 amount)",
])];

export { anyQuoteNativeFeeRouteAbi } from "../any-quote/native-fee-route";
import { anyQuoteNativeFeeRouteAbi } from "../any-quote/native-fee-route";
import { moduleEngineAnyQuoteEthLedgerAbi } from "../abi";
export const MODULE_ENGINE_ANY_QUOTE_ETH_INDEX_ABI_V1 = [...MODULE_ENGINE_ANY_QUOTE_INDEX_ABI_V1,
    ...anyQuoteNativeFeeRouteAbi, ...moduleEngineAnyQuoteEthLedgerAbi,
    ...parseAbi(["function sharedHookCodeHash() view returns (bytes32)"]),
];
