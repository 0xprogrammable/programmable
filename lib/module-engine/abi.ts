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
export const moduleEngineLedgerAbi = [...managementCoreAbi, ...parseAbi(["event FeesClaimed(address indexed beneficiary,address indexed recipient,address indexed caller,uint256 amount)"])] as const;
