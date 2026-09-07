import { vi } from "vitest";
import { concatHex, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getCreate2Address, keccak256, parseAbi, parseAbiParameters, sha256, toHex, type Address, type Hex } from "viem";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import { MODULE_MODE_ECONOMICS_POLICY_V2, MODULE_MODE_FINALITY_POLICY } from "@/lib/module-mode/release";
import { ENGINE_CONTEXT, moduleEngineConstructorParameters, moduleEngineHostAbi, moduleEnginePlanParameters } from "@/lib/module-engine/abi";
import { computeModuleEngineHostManifestHash, computeModuleEngineReleaseDigest, ENGINE_ZERO_ADDRESS as ZERO, ENGINE_ZERO_HASH as ZERO_HASH, MODULE_ENGINE_CONTRACTS, MODULE_ENGINE_PROFILE, MODULE_ENGINE_RELEASE_SCHEMA, MODULE_ENGINE_SOURCE_ID, MODULE_ENGINE_SOURCE_VERSION, type ModuleEngineRelease, type ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { ENGINE_OPERATIONS, predictModuleEngineAddress, type ModuleEngineClient, type ModuleEngineLaunchRecord } from "@/lib/module-engine/client";
export const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}` as Address;
export const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
export const CODE = "0x60006000" as Hex, CODE_HASH = keccak256(CODE), ACCOUNT = addr(90), QUOTE = addr(91), TOKEN = getCreate2Address({ from: addr(3), salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), ["Escrow", "ESC", 18, addr(1), hash(98)])), bytecodeHash: CODE_HASH }).toLowerCase() as Address, ENGINE = addr(93);
const abi = parseAbi(["function contextHash() view returns (bytes32)", "function initialize(bytes) returns (bytes32)", "function execute((bytes32 operationId,address actor,address recipient,address inputAsset,uint256 inputAmount,address outputAsset,uint256 minimumOutput,uint256 deadline,uint256 nonce,bytes data)) payable returns (bytes)"]);
export function fixture() {
  const identity = { schemaVersion: MODULE_ENGINE_RELEASE_SCHEMA, sourceVersion: MODULE_ENGINE_SOURCE_VERSION, engineProfile: MODULE_ENGINE_PROFILE, chainId: 4663 as const, sourceCommit: "a".repeat(40), startBlock: "1", tokenCreationCodeHash: CODE_HASH, economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2, finalityPolicy: MODULE_MODE_FINALITY_POLICY,
    contracts: Object.fromEntries(MODULE_ENGINE_CONTRACTS.map((key, i) => [key, { address: addr(i + 1), runtimeCodeHash: CODE_HASH }])) as ModuleEngineRelease["contracts"] };
  const release: ModuleEngineRelease = { ...identity, releaseDigest: computeModuleEngineReleaseDigest(identity), enabled: true, status: "active", deploymentEvidenceDigest: hash(1), sourceVerificationDigest: hash(2), lifecycleEvidenceDigest: hash(3) };
  const schema = { type: "record" as const, required: ["unlockTime"], fields: { unlockTime: { type: "uint" as const, bits: 256, min: "1" } } };
  const manifest: ModuleEngineTemplate["manifest"] = { domain: "programmable.module-engine.host-manifest.v1", manifest: { release: { ...identity, releaseDigest: release.releaseDigest }, configurationCodec: "programmable.engine-abi@1", catalogDefinition: { id: "escrow-v1", title: "Timed escrow", summary: "Funded quote escrow", detail: "Withdraw after the chosen time.", version: "1", interface: "escrow-v1", source: { path: "src/Escrow.sol", sha256: "a".repeat(64) }, schema, defaults: { unlockTime: "2000000000" }, configurationAbi: [{ path: ["unlockTime"], type: "uint256" }], constraints: [] },
    revision: { packageId: hash(10), familyId: hash(11), fixedQuoteAsset: ZERO, fixedConfigurationHash: ZERO_HASH, initialOperationId: ZERO_HASH, executionGas: 500_000, moneyRights: 2, coinRights: 0, eligibleFamilies: [], operationPermissions: [{ operationId: ENGINE_OPERATIONS.deposit, inputRoles: 2, outputRoles: 0, authorization: 0 }, { operationId: ENGINE_OPERATIONS.withdraw, inputRoles: 0, outputRoles: 2, authorization: 0 }] },
    source: { requestDigest: hash(20), artifactDigest: hash(21), sourceManifestHash: hash(22), configurationSchemaHash: hash(23), compiler: { version: "0.8.26", binarySha256: `sha256:${"a".repeat(64)}`, imageDigest: `sha256:${"b".repeat(64)}`, settingsHash: hash(24), completeInputHash: hash(25), reproducible: true }, engine: { componentId: "engine", sourcePath: "src/Escrow.sol", contractName: "Escrow", abi, abiHash: sha256(toHex(nativeCanonicalJson({ domain: "programmable.modules.abi.v1", value: abi }))), creationBytecode: CODE, creationCodeHash: CODE_HASH, runtimeTemplate: CODE, runtimeTemplateHash: CODE_HASH, immutableReferences: [], immutableRuntimeOffsets: [], immutableConstructorOffsets: [], externalSelectors: [] } } } };
  const template: ModuleEngineTemplate = { status: "available", manifest, manifestHash: computeModuleEngineHostManifestHash(manifest), reviewDigest: hash(26) };
  const host = release.contracts.host.address, timestamp = BigInt(Math.floor(Date.now() / 1000)), blockHash = hash(100), configurationHash = keccak256("0x1234");
  const launchId = keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,address,bytes32,bytes32"), [4663n, host, TOKEN, hash(10), configurationHash]));
  const launch: ModuleEngineLaunchRecord = { launchId, revisionId: hash(10), creator: ACCOUNT, token: TOKEN, quoteAsset: QUOTE, engine: ENGINE, engineCodeHash: CODE_HASH, constructorHash: hash(31), initCodeHash: hash(32), configurationHash, planHash: hash(34), resourcesHash: hash(35), buyCreatorFeeBps: 0, sellCreatorFeeBps: 0 };
  const state = { nonce: 0n, allowance: 10n ** 30n, balance: 10n ** 30n, enabled: true, wrongSource: false, wrongManifest: false, authorization: 0, timestamp, launch, claimable: 9n, claimed: 4n, requestStatus: 1, refundAfter: timestamp + 600n };
  const readContract = vi.fn(async ({ address, functionName, args = [] }: { address: Address; functionName: string; args?: readonly unknown[] }) => {
    if (functionName === "SOURCE_VERSION") return state.wrongSource ? hash(888) : MODULE_ENGINE_SOURCE_ID;
    if (functionName === "ECONOMICS_POLICY_ID") return MODULE_MODE_ECONOMICS_POLICY_V2;
    if (functionName === "PROTOCOL_FEE_BPS") return 10;
    if (functionName === "AUTHOR_POOL_FEE_BPS") return 20;
    if (functionName === "owner") return addr(99);
    if (address === host && ["tokenFactory", "launchPolicy", "registry", "ledger"].includes(functionName)) return release.contracts[functionName as keyof typeof release.contracts].address;
    if (functionName === "hook") return host;
    if (["registry", "poolManager"].includes(functionName)) return release.contracts[functionName as keyof typeof release.contracts].address;
    if (functionName === "getRevision") { const r = manifest.manifest.revision; return [{ familyId: r.familyId, creationCodeHash: CODE_HASH, runtimeTemplateHash: CODE_HASH, manifestHash: state.wrongManifest ? hash(800) : template.manifestHash, fixedQuoteAsset: r.fixedQuoteAsset, fixedConfigurationHash: r.fixedConfigurationHash, initialOperationId: r.initialOperationId, executionGas: r.executionGas, moneyRights: r.moneyRights, coinRights: 0, enabled: state.enabled }, [], [], []]; }
    if (functionName === "permission") { const p = manifest.manifest.revision.operationPermissions.find(p => p.operationId === args[1]); return p ? { ...p, authorization: p.operationId === ENGINE_OPERATIONS.deposit ? state.authorization : p.authorization } : { operationId: ZERO_HASH, inputRoles: 0, outputRoles: 0, authorization: 0 }; }
    if (functionName === "nonces") return state.nonce;
    if (functionName === "allowance") return state.allowance;
    if (functionName === "balanceOf") return state.balance;
    if (functionName === "claimable") return state.claimable;
    if (functionName === "claimedBy") return state.claimed;
    if (functionName === "contributionByPool") { if (args[0] !== state.launch.launchId) throw new Error("Wrong ledger key"); return 2n; }
    if (functionName === "treasury" || functionName === "rewardAdmin") return addr(99);
    if (functionName === "creatorRecipients") return [[ACCOUNT], [10_000], 0n];
    if (functionName === "feeTerms") return [10, 0];
    if (functionName === "credit") return 1000n;
    if (functionName === "unlockTime") return timestamp + 60n;
    if (functionName === "totalLiability") return 1000n;
    if (functionName === "minimumWindow") return 30n;
    if (functionName === "maximumWindow") return 86400n;
    if (functionName === "requests") return [addr(89), addr(88), 1000n, state.refundAfter, hash(87), state.requestStatus];
    if (functionName === "decimals") return address === QUOTE ? 6 : 18;
    if (functionName === "totalSupply") return 10n ** 27n;
    if (functionName === "creator") return host;
    if (functionName === "name") return "Escrow";
    if (functionName === "symbol") return "ESC";
    if (functionName === "graffiti") return hash(98);
    if (functionName === "getUERC20Address") return getCreate2Address({ from: release.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), args as [string,string,number,Address,Hex])), bytecodeHash: CODE_HASH });
    if (functionName === "launchIdOf" || functionName === "engineLaunchId") return state.launch.launchId;
    if (functionName === "getLaunch") return state.launch;
    if (functionName === "contextHash") return keccak256(encodeAbiParameters(parseAbiParameters(ENGINE_CONTEXT), [{ host, launchId: state.launch.launchId, token: state.launch.token, creator: ACCOUNT, quoteAsset: QUOTE, feeCollector: host }]));
    if (functionName === "predictTokenAddress") { const [name, symbol, creator, salt] = args as [string, string, Address, Hex]; const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), ["programmable.module-engine.token.v1", creator, salt])); return [getCreate2Address({ from: release.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [name, symbol, 18, host, graffiti])), bytecodeHash: CODE_HASH }), graffiti]; }
    throw new Error(`Unmocked ${functionName}`);
  });
  const client = { getChainId: vi.fn(async () => 4663), getBlock: vi.fn(async () => ({ number: 100n, hash: blockHash, timestamp: state.timestamp })), getCode: vi.fn(async () => CODE), readContract,
    call: vi.fn(async ({ data }: { data: Hex }) => {
      const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data });
      if (decoded.functionName === "execute") return { data: encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "execute", result: "0x1234" }) };
      if (decoded.functionName === "launch") {
        const p = decoded.args![0] as Record<string, unknown>; const token = (await readContract({ address: host, functionName: "predictTokenAddress", args: [p.name, p.symbol, ACCOUNT, p.creatorSalt] }) as [Address, Hex])[0];
        const configHash = keccak256(p.configuration as Hex), id = keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,address,bytes32,bytes32"), [4663n, host, token, hash(10), configHash]));
        const constructor = encodeAbiParameters(moduleEngineConstructorParameters, [{ host, launchId: id, token, creator: ACCOUNT, quoteAsset: QUOTE, feeCollector: host }, p.configuration as Hex]), initCodeHash = keccak256(concatHex([CODE, constructor]));
        const result = { ...launch, launchId: id, token, configurationHash: configHash, constructorHash: keccak256(constructor), initCodeHash, engine: predictModuleEngineAddress(host, ACCOUNT, p.engineSalt as Hex, id, initCodeHash), planHash: keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, host, ACCOUNT, p as never])) };
        return { data: encodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "launch", result }) };
      }
      throw new Error("Unknown simulation");
    }), estimateGas: vi.fn(async () => 500_000n), getTransaction: vi.fn(), waitForTransactionReceipt: vi.fn() } as unknown as ModuleEngineClient;
  const availability = { schemaVersion: "programmable.module-engine.availability.v1" as const, release, templates: [template], reason: null };
  const intent = { operationId: ENGINE_OPERATIONS.deposit, recipient: ACCOUNT, inputAsset: QUOTE, inputAmount: 5_000_000n, outputAsset: ZERO, minimumOutput: 0n, data: "0x" as Hex };
  const launchInput = { client, availability, templateId: "escrow-v1", account: ACCOUNT, quoteAsset: QUOTE, name: "Escrow", symbol: "ESC", description: "Funded escrow", configuration: { unlockTime: "2000000000" }, creatorSalt: hash(50), engineSalt: hash(51), creatorWallets: [ACCOUNT], creatorSharesBps: [10_000], buyCreatorFeeBps: 0, sellCreatorFeeBps: 0 };
  return { client, state, release, template, availability, launch, intent, launchInput, blockHash, host };
}
