// Engine review wire, kept byte-compatible with the protected backend engine-build.v1 profile.
import type { Hex as ModuleDigestV1 } from "viem";
import type { ReviewSubject as ModuleReviewSubjectV1 } from "./review-contract";
import type { ModuleEngineConfigurationArgument as ModuleEngineConfigurationArgumentV1 } from "../module-engine/catalog";
type JsonValue = unknown;

export const MODULE_ENGINE_PLAN_SCHEMA_V1 = "programmable.modules.engine-build-plan.v1" as const;
export const MODULE_ENGINE_BUILD_SCHEMA_V1 = "programmable.modules.engine-build.v1" as const;
export const MODULE_ENGINE_PROFILE_V1 = "programmable.module-engine-solidity@1" as const;
export const MODULE_ENGINE_CONFIGURATION_CODEC_V1 = "programmable.engine-abi@1" as const;
export const MODULE_ENGINE_CONTEXT_ABI_V1 = [
  { name: "host", type: "address" }, { name: "launchId", type: "bytes32" },
  { name: "token", type: "address" }, { name: "creator", type: "address" },
  { name: "quoteAsset", type: "address" }, { name: "feeCollector", type: "address" },
] as const;
export const MODULE_ENGINE_CONSTRUCTOR_ABI_V1 = [
  { name: "context", type: "tuple", components: MODULE_ENGINE_CONTEXT_ABI_V1 },
  { name: "configuration", type: "bytes" },
] as const;
export interface ModuleEngineContextV1 {
  host: `0x${string}`; launchId: ModuleDigestV1; token: `0x${string}`;
  creator: `0x${string}`; quoteAsset: `0x${string}`; feeCollector: `0x${string}`;
}
export interface ModuleEngineReadAssertionV1 {
  readonly callData: `0x${string}`;
  readonly expectedData: `0x${string}`;
}
/** Operator-selected executable vectors, not contributor-supplied host commands. */
export interface ModuleEngineOperationV1 {
  readonly id: string;
  readonly actor: "creator" | "user";
  readonly operationId: ModuleDigestV1;
  readonly recipient: `0x${string}`;
  readonly inputAsset: `0x${string}`;
  readonly inputAmount: string;
  readonly outputAsset: `0x${string}`;
  readonly minimumOutput: string;
  readonly data: `0x${string}`;
  readonly expectedOutcome: "success" | "revert";
  readonly expectedResult: `0x${string}`;
  readonly assertions: readonly ModuleEngineReadAssertionV1[];
  /** Monotonic operator-selected EVM time; no wall-clock waits or host commands. */
  readonly timestamp?: number;
}
export interface ModuleEnginePermissionV1 {
  readonly operationId: ModuleDigestV1;
  readonly inputRoles: number;
  readonly outputRoles: number;
  readonly authorization: 0 | 1;
}
export interface ModuleEngineTestEconomicsV1 {
  readonly platformBps: 10 | 30;
  readonly buyCreatorBps: number;
  readonly sellCreatorBps: number;
}
export interface ModuleEngineCaseV1 {
  readonly id: string;
  readonly parameters: JsonValue;
  readonly token: `0x${string}`;
  readonly quoteAsset: `0x${string}`;
  readonly launchData: `0x${string}`;
  readonly expectedResourcesHash: ModuleDigestV1;
  readonly expectedDeployment: "success" | "revert";
  readonly operations: readonly ModuleEngineOperationV1[];
  readonly rawConfigBytes?: `0x${string}`;
  /** Expose this case's exact configuration hash through the Host admission getter. */
  readonly fixedConfiguration?: boolean;
}
export interface ModuleEngineBuildPlanV1 {
  readonly schemaVersion: typeof MODULE_ENGINE_PLAN_SCHEMA_V1;
  readonly submissionId: string;
  readonly requestDigest: ModuleDigestV1;
  readonly engineComponentId: string;
  readonly configurationCodec: typeof MODULE_ENGINE_CONFIGURATION_CODEC_V1;
  readonly configurationAbi: readonly ModuleEngineConfigurationArgumentV1[];
  /** Compiler immutable ID to an aligned, full word of the canonical constructor arguments. */
  readonly immutableBindings: readonly { id: string; constructorOffset: number }[];
  readonly operationPermissions: readonly ModuleEnginePermissionV1[];
  readonly moneyRights: number;
  readonly coinRights: 0;
  readonly testEconomics: ModuleEngineTestEconomicsV1;
  readonly executionGas: number;
  readonly cases: readonly ModuleEngineCaseV1[];
}
export interface ModuleEngineContractArtifactV1 {
  readonly componentId: string;
  readonly sourcePath: string;
  readonly contractName: string;
  readonly abi: readonly unknown[];
  readonly abiHash: ModuleDigestV1;
  readonly creationBytecode: `0x${string}`;
  readonly creationCodeHash: ModuleDigestV1;
  readonly runtimeTemplate: `0x${string}`;
  readonly runtimeTemplateHash: ModuleDigestV1;
  readonly immutableReferences: readonly { id: string; ranges: readonly { start: number; length: 32 }[] }[];
  readonly immutableRuntimeOffsets: readonly number[];
  readonly immutableConstructorOffsets: readonly number[];
  readonly externalSelectors: readonly string[];
}
export interface ModuleEngineCompiledCaseV1 extends ModuleEngineCaseV1 {
  readonly context: ModuleEngineContextV1;
  readonly contextHash: ModuleDigestV1;
  readonly configBytes: `0x${string}`;
  readonly configHash: ModuleDigestV1;
  readonly constructorArgs: `0x${string}`;
  readonly constructorHash: ModuleDigestV1;
  readonly initCodeHash: ModuleDigestV1;
  readonly runtimeBytecode: `0x${string}`;
  readonly runtimeCodeHash: ModuleDigestV1;
}
export interface ModuleEngineTestRequestV1 {
  readonly schemaVersion: "programmable.modules.engine-tests.v1";
  readonly packageId: ModuleDigestV1;
  readonly requestDigest: ModuleDigestV1;
  readonly planDigest: ModuleDigestV1;
  readonly executionGas: number;
  readonly operationPermissions: readonly ModuleEnginePermissionV1[];
  readonly testEconomics: ModuleEngineTestEconomicsV1;
  readonly engine: ModuleEngineContractArtifactV1;
  readonly cases: readonly ModuleEngineCompiledCaseV1[];
}
export interface ModuleEngineTestResultV1 {
  readonly schemaVersion: "programmable.modules.engine-test-results.v1";
  readonly requestDigest: ModuleDigestV1;
  readonly planDigest: ModuleDigestV1;
  readonly harnessDigest: ModuleDigestV1;
  readonly execution: "isolated-docker-anvil";
  readonly cases: readonly {
    readonly id: string;
    readonly constructorHash: ModuleDigestV1;
    readonly runtimeCodeHash: ModuleDigestV1;
    readonly deploymentMatched: boolean;
    readonly codeHashMatched: boolean | null;
    readonly contextMatched: boolean | null;
    readonly resourcesMatched: boolean | null;
    readonly unauthorizedInitializeReverted: boolean | null;
    readonly unauthorizedExecuteReverted: boolean | null;
    readonly operations: readonly {
      readonly id: string;
      readonly outcomeMatched: boolean;
      readonly resultMatched: boolean;
      readonly stateMatched: boolean;
      readonly inputOutputBound: boolean;
      readonly replayReverted: boolean;
      readonly feesBacked: boolean;
    }[];
  }[];
  readonly allRequiredChecksPassed: boolean;
}
export interface ModuleEngineTestExecutorV1 {
  execute(request: ModuleEngineTestRequestV1): Promise<ModuleEngineTestResultV1>;
}
export interface ModuleEngineBuildArtifactV1 {
  readonly schemaVersion: typeof MODULE_ENGINE_BUILD_SCHEMA_V1;
  readonly authority: "programmable.module-review.engine-build.v1";
  readonly subject: ModuleReviewSubjectV1;
  readonly packageId: ModuleDigestV1;
  readonly familyId: ModuleDigestV1;
  readonly rewardWallet: string;
  readonly sourceManifestHash: ModuleDigestV1;
  readonly planDigest: ModuleDigestV1;
  readonly configurationSchemaHash: ModuleDigestV1;
  readonly configurationCodec: typeof MODULE_ENGINE_CONFIGURATION_CODEC_V1;
  readonly configurationAbi: readonly ModuleEngineConfigurationArgumentV1[];
  readonly compiler: {
    readonly version: string;
    readonly binarySha256: string;
    readonly imageDigest: string;
    readonly settingsHash: ModuleDigestV1;
    readonly completeInputHash: ModuleDigestV1;
    readonly reproducible: true;
  };
  readonly engine: ModuleEngineContractArtifactV1;
  readonly executionGas: number;
  readonly operationPermissions: readonly ModuleEnginePermissionV1[];
  readonly moneyRights: number;
  readonly coinRights: 0;
  readonly testEconomics: ModuleEngineTestEconomicsV1;
  readonly cases: readonly ModuleEngineCompiledCaseV1[];
  readonly tests: ModuleEngineTestResultV1;
  readonly reviewRequired: readonly string[];
  readonly approved: false;
  readonly registryApproved: false;
  readonly available: false;
  readonly artifactDigest: ModuleDigestV1;
}
