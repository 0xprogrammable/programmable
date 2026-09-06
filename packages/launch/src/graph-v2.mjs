import { keccak256 } from "viem";

import { canonicalIdentifier } from "./build.mjs";
import { canonicalizeJson } from "./canonical-json.mjs";
import { HOOK_PERMISSIONS, MAX_GRAPH_TARGETS } from "./constants.mjs";
import { assertExactKeys, compareUtf8, sha256Digest } from "./io.mjs";

export const CUSTOM_GRAPH_BUNDLE_SCHEMA_V2 = "programmable.custom-graph-bundle.v2";
export const PROJECT_METADATA_GRAPH_HASH_DOMAIN_V2 = "programmable.custom-graph-project-metadata.v2";
export const GRAPH_TOPOLOGY_HASH_DOMAIN_V2 = "programmable.create2-graph-topology.v2";

/**
 * Structural foundation only. This does not select a deployment root, predict an
 * address, authorize a profile, prove fee behavior, or construct a wallet request.
 * V1/V4.1 packing and transport continue to use their frozen graph contracts.
 */
export function parseCustomGraphBundleV2(value) {
  assertExactKeys(value, ["schemaVersion", "sourceBundleSha256", "targets", "pool"], "graph V2");
  if (value.schemaVersion !== CUSTOM_GRAPH_BUNDLE_SCHEMA_V2) {
    throw new TypeError("graph V2 schemaVersion is unsupported");
  }
  if (!Array.isArray(value.targets) || value.targets.length < 1 || value.targets.length > MAX_GRAPH_TARGETS) {
    throw new TypeError("graph V2 requires between 1 and 16 targets");
  }
  const parsed = value.targets.map(parseTarget);
  const byId = new Map();
  for (const target of parsed) {
    if (byId.has(target.targetId)) throw new TypeError(`duplicate graph target ${target.targetId}`);
    byId.set(target.targetId, target);
  }
  const targets = topologicalTargetOrder(byId);
  for (const target of targets) {
    for (const locator of [...target.constructorAddressLocators, ...target.initializerAddressLocators]) {
      if (!byId.has(locator.targetId)) {
        throw new TypeError(`target ${target.targetId} references unknown target ${locator.targetId}`);
      }
    }
  }
  const tokenTargets = targets.filter((target) => target.componentRoles.includes("token"));
  const hookTargets = targets.filter((target) => target.componentRoles.includes("hook"));
  if (tokenTargets.length !== 1 || hookTargets.length !== 1) {
    throw new TypeError("graph V2 requires exactly one token role and one hook role");
  }
  assertExactKeys(value.pool, ["tokenTargetId", "hookTargetId", "fee", "tickSpacing"], "graph V2 pool");
  const tokenTargetId = canonicalIdentifier(value.pool.tokenTargetId, "pool.tokenTargetId");
  const hookTargetId = canonicalIdentifier(value.pool.hookTargetId, "pool.hookTargetId");
  if (tokenTargetId !== tokenTargets[0].targetId || hookTargetId !== hookTargets[0].targetId) {
    throw new TypeError("graph V2 pool IDs do not match the declared token and hook roles");
  }
  if (!Number.isSafeInteger(value.pool.fee) || value.pool.fee < 0
    || (value.pool.fee > 1_000_000 && value.pool.fee !== 0x800000)) {
    throw new TypeError("graph V2 pool fee is outside Uniswap v4 bounds");
  }
  if (!Number.isSafeInteger(value.pool.tickSpacing)
    || value.pool.tickSpacing < 1 || value.pool.tickSpacing > 32_767) {
    throw new TypeError("graph V2 pool tickSpacing is outside Uniswap v4 bounds");
  }
  return deepFreeze({
    schemaVersion: CUSTOM_GRAPH_BUNDLE_SCHEMA_V2,
    sourceBundleSha256: canonicalSha256(value.sourceBundleSha256, "sourceBundleSha256"),
    targets,
    pool: { tokenTargetId, hookTargetId, fee: value.pool.fee, tickSpacing: value.pool.tickSpacing },
  });
}

/** Only the four canonical role arrays are accepted; unknown rights are never inferred. */
export function componentRoleMaskV2(roles) {
  if (!Array.isArray(roles) || roles.length > 2
    || (roles.length === 1 && roles[0] !== "token" && roles[0] !== "hook")
    || (roles.length === 2 && (roles[0] !== "token" || roles[1] !== "hook"))) {
    throw new TypeError("componentRoles must be [], [token], [hook], or [token, hook] in that order");
  }
  return (roles.includes("token") ? 1 : 0) | (roles.includes("hook") ? 2 : 0);
}

export function hashGraphBundleV2(value, projectMetadataHash) {
  const bundle = parseCustomGraphBundleV2(value);
  const unboundGraphBundleHash = sha256Digest(Buffer.from(canonicalizeJson(bundle), "utf8"));
  if (projectMetadataHash === undefined) {
    return { graphBundleHash: unboundGraphBundleHash, unboundGraphBundleHash };
  }
  const metadata = canonicalSha256(projectMetadataHash, "projectMetadataHash");
  return {
    graphBundleHash: sha256Digest(Buffer.concat([
      Buffer.from(PROJECT_METADATA_GRAPH_HASH_DOMAIN_V2, "utf8"), Buffer.from([0]),
      Buffer.from(canonicalizeJson({ graphBundleHash: unboundGraphBundleHash, projectMetadataHash: metadata }), "utf8"),
    ])),
    unboundGraphBundleHash,
  };
}

/**
 * V1 target-ID and locator frames retain their exact meaning. V2 topology adds
 * a 32-byte unsigned role mask to each target frame and versions both topology
 * domains. Fields are framed as uint32 big-endian byte length followed by bytes.
 */
export function topologyHashV2(value) {
  const bundle = parseCustomGraphBundleV2(value);
  return framedKeccak(GRAPH_TOPOLOGY_HASH_DOMAIN_V2, bundle.targets.map((target) =>
    hexBytes(framedKeccak("programmable.create2-graph-topology-target.v2", [
      hexBytes(targetIdHashV1(target.targetId)),
      uint256Bytes(componentRoleMaskV2(target.componentRoles)),
      ...target.constructorAddressLocators.map((locator) => locatorFrameV1("constructor", locator)),
      ...target.initializerAddressLocators.map((locator) => locatorFrameV1("initializer", locator)),
    ]))));
}

function parseTarget(value, index) {
  const label = `graph V2 target ${index}`;
  assertExactKeys(value, [
    "targetId", "applicantSalt", "creationBytecode", "constructorArguments", "initializerCalldata",
    "constructorAddressLocators", "initializerAddressLocators", "deploymentValueWei", "initializerValueWei",
    "expectedRuntimeCodeHash", "componentRoles", "declaredHookPermissions",
  ], label);
  const roleMask = componentRoleMaskV2(value.componentRoles);
  if (!(roleMask & 2) && value.declaredHookPermissions !== null) {
    throw new TypeError(`${label}.declaredHookPermissions must be null without the hook role`);
  }
  return {
    targetId: canonicalIdentifier(value.targetId, `${label}.targetId`),
    applicantSalt: canonicalHex32(value.applicantSalt, `${label}.applicantSalt`, true),
    creationBytecode: canonicalHex(value.creationBytecode, `${label}.creationBytecode`, false),
    constructorArguments: canonicalHex(value.constructorArguments, `${label}.constructorArguments`),
    initializerCalldata: canonicalHex(value.initializerCalldata, `${label}.initializerCalldata`),
    constructorAddressLocators: normalizeLocators(value.constructorAddressLocators, `${label}.constructorAddressLocators`),
    initializerAddressLocators: normalizeLocators(value.initializerAddressLocators, `${label}.initializerAddressLocators`),
    deploymentValueWei: canonicalUint256(value.deploymentValueWei, `${label}.deploymentValueWei`),
    initializerValueWei: canonicalUint256(value.initializerValueWei, `${label}.initializerValueWei`),
    expectedRuntimeCodeHash: canonicalHex32(value.expectedRuntimeCodeHash, `${label}.expectedRuntimeCodeHash`),
    componentRoles: [...value.componentRoles],
    declaredHookPermissions: roleMask & 2 ? normalizeHookPermissions(value.declaredHookPermissions) : null,
  };
}

function normalizeHookPermissions(value) {
  if (!Array.isArray(value) || value.length > HOOK_PERMISSIONS.length
    || value.some((permission) => !HOOK_PERMISSIONS.includes(permission))
    || new Set(value).size !== value.length) {
    throw new TypeError("declaredHookPermissions contains an unknown or duplicate permission");
  }
  return HOOK_PERMISSIONS.filter((permission) => value.includes(permission));
}

function normalizeLocators(value, label) {
  if (!Array.isArray(value) || value.length > 256) throw new TypeError(`${label} must be a bounded locator array`);
  const locators = value.map((locator, index) => {
    assertExactKeys(locator, ["targetId", "byteOffset", "encoding"], `${label}[${index}]`);
    if (!Number.isSafeInteger(locator.byteOffset) || locator.byteOffset < 0
      || !["abi-address-word", "packed-address-20"].includes(locator.encoding)) {
      throw new TypeError(`${label}[${index}] is invalid`);
    }
    return { targetId: canonicalIdentifier(locator.targetId, `${label}[${index}].targetId`),
      byteOffset: locator.byteOffset, encoding: locator.encoding };
  }).sort((a, b) => a.byteOffset - b.byteOffset
    || compareUtf8(a.targetId, b.targetId) || compareUtf8(a.encoding, b.encoding));
  let occupiedUntil = 0;
  for (const locator of locators) {
    if (locator.byteOffset < occupiedUntil) throw new TypeError(`${label} locators overlap`);
    occupiedUntil = locator.byteOffset + (locator.encoding === "abi-address-word" ? 32 : 20);
  }
  return locators;
}

function topologicalTargetOrder(byId) {
  const indegree = new Map([...byId.keys()].map((id) => [id, 0]));
  const dependents = new Map([...byId.keys()].map((id) => [id, new Set()]));
  for (const target of byId.values()) {
    const dependencies = new Set(target.constructorAddressLocators.map((locator) => locator.targetId));
    for (const id of dependencies) {
      if (id === target.targetId) throw new TypeError(`constructor for ${id} cannot reference itself`);
      if (!byId.has(id)) throw new TypeError(`constructor for ${target.targetId} references unknown target ${id}`);
      dependents.get(id).add(target.targetId);
    }
    indegree.set(target.targetId, dependencies.size);
  }
  const ready = [...indegree.keys()].filter((id) => indegree.get(id) === 0).sort(compareUtf8);
  const result = [];
  while (ready.length) {
    const id = ready.shift();
    result.push(byId.get(id));
    for (const dependent of dependents.get(id)) {
      const remaining = indegree.get(dependent) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) { ready.push(dependent); ready.sort(compareUtf8); }
    }
  }
  if (result.length !== byId.size) throw new TypeError("graph constructor dependencies contain a cycle");
  return result;
}

function targetIdHashV1(id) {
  return framedKeccak("programmable.create2-graph-target-id.v1", [Buffer.from(id, "utf8")]);
}

function locatorFrameV1(phase, locator) {
  return hexBytes(framedKeccak("programmable.create2-graph-address-locator.v1", [
    Buffer.from(phase, "utf8"), hexBytes(targetIdHashV1(locator.targetId)),
    uint256Bytes(locator.byteOffset), Buffer.from(locator.encoding, "utf8"),
  ]));
}

function framedKeccak(domain, fields) {
  const frames = [Buffer.from(domain, "utf8"), Buffer.from([0])];
  for (const field of fields) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(field.byteLength, 0);
    frames.push(length, field);
  }
  return keccak256(`0x${Buffer.concat(frames).toString("hex")}`);
}

function hexBytes(value) { return Buffer.from(value.slice(2), "hex"); }
function uint256Bytes(value) { return Buffer.from(BigInt(value).toString(16).padStart(64, "0"), "hex"); }

function canonicalHex(value, label, allowEmpty = true) {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)
    || (!allowEmpty && value === "0x")) throw new TypeError(`${label} must be even-length hex`);
  return value.toLowerCase();
}

function canonicalHex32(value, label, allowZero = false) {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)
    || (!allowZero && BigInt(value) === 0n)) throw new TypeError(`${label} must be ${allowZero ? "" : "nonzero "}bytes32`);
  return value.toLowerCase();
}

function canonicalSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-fA-F]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value.toLowerCase();
}

function canonicalUint256(value, label) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || BigInt(value) >= 1n << 256n) throw new TypeError(`${label} must be a canonical uint256 decimal string`);
  return value;
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
