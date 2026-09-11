import { anyQuoteNativeFeeRouteAbi } from "./any-quote/native-fee-route";
import { parseAbi, parseAbiParameters } from "viem";
import { managementCoreAbi } from "@/lib/module-mode/management";

export const ENGINE_CONTEXT = "(address host,bytes32 launchId,address token,address creator,address quoteAsset,address feeCollector)";
export const ENGINE_OPERATION = "(bytes32 operationId,address actor,address recipient,address inputAsset,uint256 inputAmount,address outputAsset,uint256 minimumOutput,uint256 deadline,uint256 nonce,bytes data)";
export const ENGINE_PERMISSION = "(bytes32 operationId,uint8 inputRoles,uint8 outputRoles,uint8 authorization)";
export const ENGINE_REVISION = "(bytes32 familyId,bytes32 creationCodeHash,bytes32 runtimeTemplateHash,bytes32 manifestHash,address fixedQuoteAsset,bytes32 fixedConfigurationHash,bytes32 initialOperationId,uint32 executionGas,uint8 moneyRights,uint8 coinRights,bool enabled)";
export const ENGINE_LAUNCH = "(bytes32 launchId,bytes32 revisionId,address creator,address token,address quoteAsset,address engine,bytes32 engineCodeHash,bytes32 constructorHash,bytes32 initCodeHash,bytes32 configurationHash,bytes32 planHash,bytes32 resourcesHash,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps)";
export const ENGINE_LAUNCH_PARAMETERS = `(string name,string symbol,bytes32 creatorSalt,bytes32 revisionId,address quoteAsset,bytes configuration,bytes creationCode,bytes runtimeTemplate,bytes32 engineSalt,bytes launchData,(string description,string website,string image,bytes extraData) metadata,address[] creatorWallets,uint16[] creatorSharesBps,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,${ENGINE_OPERATION} initialOperation)`;
export const moduleEngineConstructorParameters = parseAbiParameters(`${ENGINE_CONTEXT} context,bytes configuration`);
export const moduleEngineLaunchParameters = parseAbiParameters(`${ENGINE_LAUNCH_PARAMETERS} parameters`);
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
  "function fixedConfigurationHash(bytes32 launchId) view returns (bytes32)",
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
  "function name() view returns (string)", "function graffiti() view returns (bytes32)",
  "function getUERC20Address(string name,string symbol,uint8 decimals,address creator,bytes32 graffiti) view returns (address)",
  "function totalSupply() view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)",
  "function balanceOf(address actor) view returns (uint256)", "function allowance(address actor,address spender) view returns (uint256)",
  "function credit(address actor) view returns (uint256)", "function totalLiability() view returns (uint256)", "function unlockTime() view returns (uint256)",
  "function requests(bytes32 requestId) view returns (address payer,address beneficiary,uint256 amount,uint256 refundAfter,bytes32 obligationHash,uint8 status)",
  "function minimumWindow() view returns (uint256)", "function maximumWindow() view returns (uint256)",
  "function poolId() view returns (bytes32)", "function quoteDecimals() view returns (uint8)",
]);
export const moduleEngineTradeLimitsParameters = parseAbiParameters("(uint256 minimumEthFees,uint160 sqrtPriceLimitX96,bytes conversionRoute) limits");
export const moduleEngineLedgerAbi = [...managementCoreAbi, ...parseAbi([
  "event FeesClaimed(address indexed beneficiary,address indexed recipient,address indexed caller,uint256 amount)",
  "event CreatorWalletChanged(bytes32 indexed poolId,uint256 indexed index,address indexed previousWallet,address newWallet,uint256 effectiveCreatorFeesReceived)",
  "event CreatorRecipientsReplaced(bytes32 indexed poolId,address indexed administrator,uint256 indexed adminRevision,address[] wallets,uint256 effectiveCreatorFeesReceived)",
])] as const;
export const moduleEngineAuthorWalletAbi = parseAbi([
  "function families(bytes32 familyId) view returns (address author,address wallet)",
  "function changeAuthorWallet(bytes32 familyId,address rewardWallet)",
  "event AuthorWalletChanged(bytes32 indexed familyId,address indexed previousWallet,address indexed wallet)",
]);

/** Shared-quote source ABI. These selectors are deliberately separate from native Host/Ledger V1. */
export const moduleEngineAnyQuoteHostAbi = [...moduleEngineHostAbi.filter(item => !(item.type === "function" && item.name === "feeTerms")), ...parseAbi([
  "function sharedHook() view returns (address)",
  "function nativeRouteGuard() view returns (address)",
  "function NATIVE_ROUTE_GUARD_CODE_HASH() view returns (bytes32)",
  "function quotePoolManager() view returns (address)",
  "function quotePoolManagerCodeHash() view returns (bytes32)",
  "function UNIVERSAL_ROUTER() view returns (address)",
  "function UNIVERSAL_ROUTER_CODE_HASH() view returns (bytes32)",
  "function quoteFeeProfileId() view returns (bytes32)",
  "function poolIdOf(bytes32 launchId) view returns (bytes32)",
])] as const;
export const moduleEngineAnyQuoteHookAbi = parseAbi([
  "function host() view returns (address)", "function ledger() view returns (address)", "function poolManager() view returns (address)",
  "function poolKey(bytes32 poolId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks))",
  "function poolConfig(bytes32 poolId) view returns ((bytes32 launchId,bytes32 revisionId,bytes32 familyId,bytes32 configurationHash,address token,address quoteAsset,address initializer,int24 initialTick,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps))",
  "function previewGrossFees(bytes32 poolId,bool buy,uint256 grossQuote) view returns (uint256 platformQuote,uint256 creatorQuote,uint16 nextPlatformRemainder,uint16 nextCreatorRemainder)",
  "event QuotePoolSwap(bytes32 indexed poolId,bytes32 indexed launchId,address indexed swapSender,bool buy,bool exactInput,uint256 grossQuote,uint256 platformQuote,uint256 creatorQuote,int128 coreAmount0,int128 coreAmount1)",
  "event SharedQuotePoolBound(bytes32 indexed poolId,bytes32 indexed launchId,address indexed token,address quoteAsset,address engine,bytes32 revisionId,bytes32 familyId,bytes32 configurationHash,int24 initialTick,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps)",
]);
export const moduleEngineAnyQuoteLedgerAbi = parseAbi([
  "function host() view returns (address)", "function hook() view returns (address)", "function poolManager() view returns (address)",
  "function ECONOMICS_POLICY_ID() view returns (bytes32)", "function platformFeeBps(bytes32 launchId) view returns (uint16)",
  "function treasury() view returns (address)", "function rewardAdmin() view returns (address)",
  "function quoteAsset(bytes32 launchId) view returns (address)", "function configurationHash(bytes32 launchId) view returns (bytes32)",
  "function claimableQuote(address asset,address beneficiary) view returns (uint256)",
  "function claimedBy(address asset,address beneficiary) view returns (uint256)",
  "function contributionByLaunch(bytes32 launchId,address beneficiary) view returns (uint256)",
  "function claimQuoteTo(address asset,address recipient) returns (uint256)",
  "function claimQuoteFor(address asset,address beneficiary) returns (uint256)",
  "function changePlatformWallet(address next)",
  "event PlatformWalletChanged(address indexed previous,address indexed current,address indexed administrator)",
  "function creatorRecipients(bytes32 launchId) view returns (address[] wallets,uint16[] sharesBps,uint256 adminRevision)",
  "function changeCreatorWallet(bytes32 launchId,uint256 index,address next)",
  "function replaceCreatorWallets(bytes32 launchId,address[] next,uint256 expectedRevision,uint256 deadline)",
  "event QuoteFeesClaimed(address indexed asset,address indexed beneficiary,address indexed recipient,uint256 amount)",
  "event CreatorWalletChanged(bytes32 indexed launchId,uint256 indexed index,address previous,address current,uint256 effectiveCreatorReceived)",
  "event CreatorRecipientsReplaced(bytes32 indexed launchId,address indexed administrator,uint256 indexed revision,address[] wallets,uint256 effectiveCreatorReceived)",
]);
export const moduleEnginePermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);

export const moduleEngineAnyQuoteEthHostAbi = [...moduleEngineAnyQuoteHostAbi, ...parseAbi(["function sharedHookCodeHash() view returns (bytes32)"])];
export const moduleEngineAnyQuoteEthLedgerAbi = [
  ...moduleEngineAnyQuoteLedgerAbi.filter(item => !["claimableQuote", "claimedBy", "claimQuoteTo", "claimQuoteFor", "QuoteFeesClaimed"].includes(item.name)),
  ...parseAbi([
    "function claimableEth(address beneficiary) view returns (uint256)", "function claimedBy(address beneficiary) view returns (uint256)",
    "function claimEthTo(address recipient) returns (uint256)", "function claimEthFor(address beneficiary) returns (uint256)",
    "function totalReceived() view returns (uint256)", "function totalCredited() view returns (uint256)", "function totalClaimed() view returns (uint256)",
    "function accounting(bytes32 launchId) view returns (uint256 platformReceived,uint256 creatorReceived,uint256 credited)",
    "function outstandingClaims() view returns (uint256)",
    "event EthLaunchRegistered(bytes32 indexed launchId,address indexed quoteAsset,bytes32 configurationHash,address[] creatorWallets,uint16[] creatorSharesBps)",
    "event EthFeesAccrued(bytes32 indexed launchId,address indexed quoteAsset,uint256 platformEth,uint256 creatorEth,uint256 creditedEth)",
    "event EthRewardCredited(bytes32 indexed launchId,address indexed quoteAsset,address indexed beneficiary,uint256 amount)",
    "event EthFeesClaimed(address indexed beneficiary,address indexed recipient,uint256 amount)",
  ]),
] as const;

export const moduleEngineAnyQuoteEthHookAbi = [...moduleEngineAnyQuoteHookAbi, ...anyQuoteNativeFeeRouteAbi] as const;
