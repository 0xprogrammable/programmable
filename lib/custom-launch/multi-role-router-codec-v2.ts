// Reused canonical additive V2 codec. Source: programmable-open-hook-v2-internal/src/launch/multi-role-router-v2.ts.
import {
  concatHex,
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";

/** Additive, pure V2 codecs. No deployed address, signer, policy or live route is selected here. */
export const MULTI_ROLE_ROUTER_ABI_V2 = parseAbi([
  "function launchAndStampV2((uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value) permit,(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bytes32 hookRuntimeCodeHash,(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 roleMask,uint8 scope)[] components) stampRequest,bytes routePayload,bytes signature) payable returns (bytes32 stampHash)",
]);
export const MULTI_ROLE_LAUNCH_AND_STAMP_SELECTOR_V2 = toFunctionSelector(MULTI_ROLE_ROUTER_ABI_V2[0]);
export const MULTI_ROLE_CUSTOM_GRAPH_ROUTE_ABI_V2 = parseAbiParameters(
  "(bytes32 routeNamespace,bytes32 routeNonce,bytes32 topologyHash,bytes32 graphCommitment,(bytes32 targetIdHash,bytes32 applicantSalt,uint256 deploymentValue,uint256 initializerValue,bytes initCode,bytes initializerCalldata)[] targets,(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)[] expectedOutputs,bytes32 expectedGraphDeploymentHash) route",
);
export const MULTI_ROLE_ROUTER_TYPE_STRINGS_V2 = Object.freeze({
  expectedGraphOutput: "ProgrammableExpectedGraphOutputV2(uint8 targetIndex,bytes32 targetIdHash,address account,bytes32 runtimeCodeHash)",
  component: "ProgrammableLaunchComponentV2(uint8 resultIndex,address account,bytes32 runtimeCodeHash,uint8 roleMask,uint8 scope)",
  poolKey: "ProgrammablePoolKeyV2(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
  stampRequest: "ProgrammableStampRequestV2(bytes32 launchId,address token,bytes32 tokenRuntimeCodeHash,bytes32 poolKeyHash,bytes32 hookRuntimeCodeHash,bytes32 componentSetHash)",
  expectedGraphResult: "ProgrammableExpectedGraphResultV2(bytes32 expectedOutputsHash,bytes32 graphDeploymentHash)",
  permit: "ProgrammableLaunchPermitV2(uint256 chainId,address router,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 nonce,uint64 validAfter,uint64 deadline,uint256 value)",
  launchStamp: "ProgrammableLaunchStampV2(uint256 chainId,address router,bytes32 launchId,address launchWallet,uint8 kind,bytes32 routePayloadHash,bytes32 expectedResultHash,bytes32 stampRequestHash,bytes32 permitDigest,address poolManager,bytes32 poolId)",
});
export const MULTI_ROLE_ROUTER_TYPEHASHES_V2 = Object.freeze(Object.fromEntries(
  Object.entries(MULTI_ROLE_ROUTER_TYPE_STRINGS_V2).map(([name, value]) => [name, keccak256(stringToHex(value))]),
)) as Readonly<Record<keyof typeof MULTI_ROLE_ROUTER_TYPE_STRINGS_V2, Hex>>;

export interface MultiRolePoolKeyV2 {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Address;
}
export interface MultiRoleComponentV2 {
  readonly resultIndex: number;
  readonly account: Address;
  readonly runtimeCodeHash: Hex;
  /** Bit 0 is Token, bit 1 is Hook; zero is an auxiliary component. */
  readonly roleMask: 0 | 1 | 2 | 3;
  readonly scope: 1;
}
export interface MultiRoleStampRequestV2 {
  readonly launchId: Hex;
  readonly token: Address;
  readonly tokenRuntimeCodeHash: Hex;
  readonly poolKey: MultiRolePoolKeyV2;
  readonly hookRuntimeCodeHash: Hex;
  readonly components: readonly MultiRoleComponentV2[];
}
export interface MultiRoleLaunchPermitV2 {
  readonly chainId: bigint;
  readonly router: Address;
  readonly launchWallet: Address;
  readonly kind: 1;
  readonly routePayloadHash: Hex;
  readonly expectedResultHash: Hex;
  readonly stampRequestHash: Hex;
  readonly nonce: Hex;
  readonly validAfter: bigint;
  readonly deadline: bigint;
  readonly value: bigint;
}
export interface MultiRoleGraphTargetV2 {
  readonly targetIdHash: Hex;
  readonly applicantSalt: Hex;
  readonly deploymentValue: bigint;
  readonly initializerValue: bigint;
  readonly initCode: Hex;
  readonly initializerCalldata: Hex;
}
export interface MultiRoleExpectedGraphOutputV2 {
  readonly targetIndex: number;
  readonly targetIdHash: Hex;
  readonly account: Address;
  readonly runtimeCodeHash: Hex;
}
export interface MultiRoleCustomGraphRouteV2 {
  readonly routeNamespace: Hex;
  readonly routeNonce: Hex;
  readonly topologyHash: Hex;
  /** This remains the graph factory's V1 commitment, not a Router V2 hash. */
  readonly graphCommitment: Hex;
  readonly targets: readonly MultiRoleGraphTargetV2[];
  readonly expectedOutputs: readonly MultiRoleExpectedGraphOutputV2[];
  /** This remains the graph factory's V1 deployment accumulator. */
  readonly expectedGraphDeploymentHash: Hex;
}
export interface MultiRoleLaunchCallV2 {
  readonly permit: MultiRoleLaunchPermitV2;
  readonly stampRequest: MultiRoleStampRequestV2;
  readonly routePayload: Hex;
  /** Empty bytes are supported for an unsigned preparation; no signature is produced here. */
  readonly signature: Hex;
}

const MAX_TARGETS = 16;
const MAX_ROUTE_BYTES = 1_048_576;
const MAX_SIGNATURE_BYTES = 16_384;
const MAX_CALLDATA_BYTES = MAX_ROUTE_BYTES + MAX_SIGNATURE_BYTES + 16_384;
const UINT256_MAX = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const EIP712_DOMAIN_TYPEHASH = keccak256(stringToHex(
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
));

export function computePoolKeyHashV2(value: MultiRolePoolKeyV2): Hex {
  const key = poolKey(value);
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,address,address,uint24,int24,address"), [
    MULTI_ROLE_ROUTER_TYPEHASHES_V2.poolKey, key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks,
  ]));
}

/** Uniswap's actual PoolId has no Programmable typehash and is unchanged. */
export function computeMultiRolePoolIdV2(value: MultiRolePoolKeyV2): Hex {
  const key = poolKey(value);
  return keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"), [
    key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks,
  ]));
}

export function computeComponentSetHashV2(values: readonly MultiRoleComponentV2[]): Hex {
  let previous = -1n;
  return packedHash(array(values, 0, MAX_TARGETS, "components").map(value => {
    const entry = component(value);
    if (BigInt(entry.account) <= previous) throw new TypeError("V2 components must be sorted and distinct");
    previous = BigInt(entry.account);
    return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8,address,bytes32,uint8,uint8"), [
      MULTI_ROLE_ROUTER_TYPEHASHES_V2.component, entry.resultIndex, entry.account, entry.runtimeCodeHash,
      entry.roleMask, entry.scope,
    ]));
  }));
}

export function computeStampRequestHashV2(value: MultiRoleStampRequestV2): Hex {
  const request = stampRequest(value);
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,address,bytes32,bytes32,bytes32,bytes32"), [
    MULTI_ROLE_ROUTER_TYPEHASHES_V2.stampRequest, request.launchId, request.token, request.tokenRuntimeCodeHash,
    computePoolKeyHashV2(request.poolKey), request.hookRuntimeCodeHash, computeComponentSetHashV2(request.components),
  ]));
}

export function computeExpectedGraphResultHashV2(
  values: readonly MultiRoleExpectedGraphOutputV2[], graphDeploymentHash: Hex,
): Hex {
  const hashes = array(values, 0, MAX_TARGETS, "expected outputs").map(value => {
    const output = expectedOutput(value);
    return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint8,bytes32,address,bytes32"), [
      MULTI_ROLE_ROUTER_TYPEHASHES_V2.expectedGraphOutput, output.targetIndex, output.targetIdHash,
      output.account, output.runtimeCodeHash,
    ]));
  });
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32"), [
    MULTI_ROLE_ROUTER_TYPEHASHES_V2.expectedGraphResult, packedHash(hashes), bytes32(graphDeploymentHash),
  ]));
}

export function permitStructHashV2(value: MultiRoleLaunchPermitV2): Hex {
  const permit = launchPermit(value);
  return keccak256(encodeAbiParameters(parseAbiParameters(
    "bytes32,uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256",
  ), [MULTI_ROLE_ROUTER_TYPEHASHES_V2.permit, permit.chainId, permit.router, permit.launchWallet, permit.kind,
    permit.routePayloadHash, permit.expectedResultHash, permit.stampRequestHash, permit.nonce,
    permit.validAfter, permit.deadline, permit.value]));
}

export function routerDomainSeparatorV2(chainId: bigint, router: Address): Hex {
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32,bytes32,bytes32,uint256,address"), [
    EIP712_DOMAIN_TYPEHASH, keccak256(stringToHex("ProgrammableLaunchStampRouter")),
    keccak256(stringToHex("2")), uint(chainId, 256), address(router),
  ]));
}

export function permitDigestV2(value: MultiRoleLaunchPermitV2): Hex {
  const permit = launchPermit(value);
  return keccak256(concatHex([
    "0x1901", routerDomainSeparatorV2(permit.chainId, permit.router), permitStructHashV2(permit),
  ]));
}

export function assertPermitDigestV2(permit: MultiRoleLaunchPermitV2, expectedDigest: Hex): void {
  if (permitDigestV2(permit) !== bytes32(expectedDigest)) throw new TypeError("V2 permit digest mismatch");
}

export function computeLaunchStampHashV2(input: Readonly<{
  permit: MultiRoleLaunchPermitV2; launchId: Hex; poolManager: Address; poolId: Hex;
}>): Hex {
  const permit = launchPermit(input.permit);
  return keccak256(encodeAbiParameters(parseAbiParameters(
    "bytes32,uint256,address,bytes32,address,uint8,bytes32,bytes32,bytes32,bytes32,address,bytes32",
  ), [MULTI_ROLE_ROUTER_TYPEHASHES_V2.launchStamp, permit.chainId, permit.router, bytes32(input.launchId),
    permit.launchWallet, permit.kind, permit.routePayloadHash, permit.expectedResultHash, permit.stampRequestHash,
    permitDigestV2(permit), address(input.poolManager), bytes32(input.poolId)]));
}

export function encodeCustomGraphRouteV2(value: MultiRoleCustomGraphRouteV2): Hex {
  return encodeAbiParameters(MULTI_ROLE_CUSTOM_GRAPH_ROUTE_ABI_V2, [graphRoute(value)]);
}

export function decodeCustomGraphRouteV2(value: Hex): MultiRoleCustomGraphRouteV2 {
  const encoded = byteString(value, MAX_ROUTE_BYTES);
  const [decoded] = decodeAbiParameters(MULTI_ROLE_CUSTOM_GRAPH_ROUTE_ABI_V2, encoded);
  const route = graphRoute(decoded);
  if (encodeCustomGraphRouteV2(route) !== encoded) throw new TypeError("Noncanonical V2 graph route bytes");
  return route;
}

/**
 * Checks byte commitments and graph role consistency only. The caller must
 * independently bind deployed roots, factory commitments, source/fee proofs,
 * current pool state, wallet authority and the permit signature before release.
 */
export function encodeLaunchAndStampV2(value: MultiRoleLaunchCallV2): Hex {
  const call = launchCall(value);
  return encodeFunctionData({ abi: MULTI_ROLE_ROUTER_ABI_V2, functionName: "launchAndStampV2",
    args: [call.permit, call.stampRequest, call.routePayload, call.signature] });
}

export function decodeLaunchAndStampV2(value: Hex): MultiRoleLaunchCallV2 {
  const encoded = byteString(value, MAX_CALLDATA_BYTES);
  const decoded = decodeFunctionData({ abi: MULTI_ROLE_ROUTER_ABI_V2, data: encoded });
  if (decoded.functionName !== "launchAndStampV2") throw new TypeError("V2 Router selector mismatch");
  const [permit, request, payload, signature] = decoded.args;
  const call = launchCall({ permit, stampRequest: request, routePayload: payload, signature });
  if (encodeLaunchAndStampV2(call) !== encoded) throw new TypeError("Noncanonical V2 Router calldata");
  return call;
}

function launchCall(value: unknown): MultiRoleLaunchCallV2 {
  const input = record(value, ["permit", "stampRequest", "routePayload", "signature"]);
  const permit = launchPermit(input.permit);
  const request = stampRequest(input.stampRequest);
  const routePayload = byteString(input.routePayload, MAX_ROUTE_BYTES);
  const route = decodeCustomGraphRouteV2(routePayload);
  const signature = byteString(input.signature, MAX_SIGNATURE_BYTES);
  if (permit.nonce === ZERO_BYTES32 || request.launchId === ZERO_BYTES32
    || route.routeNonce !== permit.nonce || route.routeNamespace === ZERO_BYTES32
    || route.topologyHash === ZERO_BYTES32 || route.graphCommitment === ZERO_BYTES32
    || route.expectedGraphDeploymentHash === ZERO_BYTES32) {
    throw new TypeError("V2 graph authorization identity is invalid");
  }
  if (permit.routePayloadHash !== keccak256(routePayload)
    || permit.stampRequestHash !== computeStampRequestHashV2(request)
    || permit.expectedResultHash !== computeExpectedGraphResultHashV2(route.expectedOutputs, route.expectedGraphDeploymentHash)
    || permit.value !== route.targets.reduce((sum, target) => sum + target.deploymentValue + target.initializerValue, 0n)) {
    throw new TypeError("V2 launch commitments do not match their exact preimages");
  }
  if (request.components.length !== route.targets.length) throw new TypeError("V2 component inventory is incomplete");
  let previous = -1n;
  const indices = new Set<number>();
  let tokenFound = false;
  let hookFound = false;
  for (const entry of request.components) {
    const output = route.expectedOutputs[entry.resultIndex];
    if (BigInt(entry.account) <= previous || indices.has(entry.resultIndex) || output === undefined
      || entry.account !== output.account || entry.runtimeCodeHash !== output.runtimeCodeHash) {
      throw new TypeError("V2 components must uniquely bind sorted graph outputs");
    }
    previous = BigInt(entry.account);
    indices.add(entry.resultIndex);
    const isToken = entry.account === request.token;
    const isHook = entry.account === request.poolKey.hooks;
    const exactMask = (isToken ? 1 : 0) | (isHook ? 2 : 0);
    if (entry.roleMask !== exactMask
      || (isToken && entry.runtimeCodeHash !== request.tokenRuntimeCodeHash)
      || (isHook && entry.runtimeCodeHash !== request.hookRuntimeCodeHash)) {
      throw new TypeError("V2 component roles must match their canonical addresses and runtimes");
    }
    tokenFound ||= isToken;
    hookFound ||= isHook;
  }
  if (!tokenFound || !hookFound) throw new TypeError("V2 token and hook roles are missing");
  if (request.token !== request.poolKey.currency0 && request.token !== request.poolKey.currency1) {
    throw new TypeError("V2 canonical token is not in the PoolKey");
  }
  return Object.freeze({ permit, stampRequest: request, routePayload, signature });
}

function poolKey(value: unknown): MultiRolePoolKeyV2 {
  const input = record(value, ["currency0", "currency1", "fee", "tickSpacing", "hooks"]);
  const result = Object.freeze({ currency0: address(input.currency0, true), currency1: address(input.currency1, true),
    fee: integer(input.fee, 0, 0xff_ffff), tickSpacing: integer(input.tickSpacing, -0x80_0000, 0x7f_ffff),
    hooks: address(input.hooks) });
  if (BigInt(result.currency0) >= BigInt(result.currency1)) throw new TypeError("PoolKey currencies must be sorted and distinct");
  return result;
}

function component(value: unknown): MultiRoleComponentV2 {
  const input = record(value, ["resultIndex", "account", "runtimeCodeHash", "roleMask", "scope"]);
  if (input.scope !== 1) throw new TypeError("V2 graph components require Exclusive scope");
  return Object.freeze({ resultIndex: integer(input.resultIndex, 0, 255), account: address(input.account),
    runtimeCodeHash: bytes32(input.runtimeCodeHash), roleMask: integer(input.roleMask, 0, 3) as 0 | 1 | 2 | 3, scope: 1 });
}

function stampRequest(value: unknown): MultiRoleStampRequestV2 {
  const input = record(value, ["launchId", "token", "tokenRuntimeCodeHash", "poolKey", "hookRuntimeCodeHash", "components"]);
  return Object.freeze({ launchId: bytes32(input.launchId), token: address(input.token),
    tokenRuntimeCodeHash: bytes32(input.tokenRuntimeCodeHash), poolKey: poolKey(input.poolKey),
    hookRuntimeCodeHash: bytes32(input.hookRuntimeCodeHash),
    components: Object.freeze(array(input.components, 1, MAX_TARGETS, "components").map(component)) });
}

function launchPermit(value: unknown): MultiRoleLaunchPermitV2 {
  const input = record(value, ["chainId", "router", "launchWallet", "kind", "routePayloadHash", "expectedResultHash",
    "stampRequestHash", "nonce", "validAfter", "deadline", "value"]);
  if (input.kind !== 1) throw new TypeError("V2 Router supports only CustomGraph permits");
  const result = Object.freeze({ chainId: uint(input.chainId, 256), router: address(input.router),
    launchWallet: address(input.launchWallet), kind: 1 as const, routePayloadHash: bytes32(input.routePayloadHash),
    expectedResultHash: bytes32(input.expectedResultHash), stampRequestHash: bytes32(input.stampRequestHash),
    nonce: bytes32(input.nonce), validAfter: uint(input.validAfter, 64), deadline: uint(input.deadline, 64),
    value: uint(input.value, 256) });
  if (result.chainId === 0n || result.deadline < result.validAfter || result.deadline - result.validAfter > 3_600n) {
    throw new TypeError("V2 permit chain or lifetime is invalid");
  }
  return result;
}

function graphRoute(value: unknown): MultiRoleCustomGraphRouteV2 {
  const input = record(value, ["routeNamespace", "routeNonce", "topologyHash", "graphCommitment", "targets",
    "expectedOutputs", "expectedGraphDeploymentHash"]);
  let totalBytes = 0;
  let totalValue = 0n;
  const ids = new Set<string>();
  const targets = array(input.targets, 1, MAX_TARGETS, "targets").map(value => {
    const target = record(value, ["targetIdHash", "applicantSalt", "deploymentValue", "initializerValue", "initCode", "initializerCalldata"]);
    const result = Object.freeze({ targetIdHash: bytes32(target.targetIdHash), applicantSalt: bytes32(target.applicantSalt),
      deploymentValue: uint(target.deploymentValue, 256), initializerValue: uint(target.initializerValue, 256),
      initCode: byteString(target.initCode, 49_152), initializerCalldata: byteString(target.initializerCalldata, 131_072) });
    totalBytes += (result.initCode.length + result.initializerCalldata.length - 4) / 2;
    totalValue += result.deploymentValue + result.initializerValue;
    if (result.initCode === "0x" || ids.has(result.targetIdHash)) throw new TypeError("V2 graph target identity or initcode is invalid");
    ids.add(result.targetIdHash);
    return result;
  });
  if (totalBytes > 524_288 || totalValue > UINT256_MAX) throw new TypeError("V2 graph byte or value budget exceeded");
  const accounts = new Set<string>();
  const outputs = array(input.expectedOutputs, targets.length, targets.length, "expected outputs").map((value, index) => {
    const output = expectedOutput(value);
    if (output.targetIndex !== index || output.targetIdHash !== targets[index]!.targetIdHash
      || output.runtimeCodeHash === ZERO_BYTES32 || accounts.has(output.account)) {
      throw new TypeError("V2 graph output identity is duplicated or out of order");
    }
    accounts.add(output.account);
    return output;
  });
  return Object.freeze({ routeNamespace: bytes32(input.routeNamespace), routeNonce: bytes32(input.routeNonce),
    topologyHash: bytes32(input.topologyHash), graphCommitment: bytes32(input.graphCommitment),
    targets: Object.freeze(targets), expectedOutputs: Object.freeze(outputs),
    expectedGraphDeploymentHash: bytes32(input.expectedGraphDeploymentHash) });
}

function expectedOutput(value: unknown): MultiRoleExpectedGraphOutputV2 {
  const input = record(value, ["targetIndex", "targetIdHash", "account", "runtimeCodeHash"]);
  return Object.freeze({ targetIndex: integer(input.targetIndex, 0, 255), targetIdHash: bytes32(input.targetIdHash),
    account: address(input.account), runtimeCodeHash: bytes32(input.runtimeCodeHash) });
}

function packedHash(values: readonly Hex[]): Hex { return keccak256(concatHex(values)); }
function bytes32(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) throw new TypeError("Expected bytes32");
  return value.toLowerCase() as Hex;
}
function byteString(value: unknown, maximumBytes: number): Hex {
  if (typeof value !== "string" || value.length > maximumBytes * 2 + 2 || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)) {
    throw new TypeError("Invalid or oversized byte string");
  }
  return value.toLowerCase() as Hex;
}
function address(value: unknown, allowZero = false): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/u.test(value) || (!allowZero && value.toLowerCase() === ZERO_ADDRESS)) {
    throw new TypeError("Invalid address");
  }
  return value.toLowerCase() as Address;
}
function uint(value: unknown, bits: 64 | 256): bigint {
  if (typeof value !== "bigint" || value < 0n || value >= (1n << BigInt(bits))) throw new TypeError(`Invalid uint${bits}`);
  return value;
}
function integer(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError("Integer outside ABI bounds");
  }
  return value;
}
function array(value: unknown, minimum: number, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum
    || Object.keys(value).length !== value.length) throw new TypeError(`Invalid ${label} count`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new TypeError(`Invalid sparse ${label}`);
  }
  return value;
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError("Expected a plain V2 object");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new TypeError("V2 object fields do not match the exact schema");
  }
  return input;
}
