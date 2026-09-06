import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { canonicalizeJson } from "../src/canonical-json.mjs";
import { hashGraphBundle, normalizeAndPredictSubmittedGraph } from "../src/graph.mjs";
import {
  CUSTOM_GRAPH_BUNDLE_SCHEMA_V2,
  componentRoleMaskV2,
  hashGraphBundleV2,
  parseCustomGraphBundleV2,
  topologyHashV2,
} from "../src/graph-v2.mjs";
import { sha256Digest } from "../src/io.mjs";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/custom-graph-v2-parity.json", import.meta.url)));
const schema = JSON.parse(readFileSync(new URL("../../../public/schemas/custom-launch/graph/v2/bundle.json", import.meta.url)));
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addKeyword({ keyword: "x-programmable-contract", schemaType: "object" });
const validateSchema = ajv.compile(schema);
const example = () => structuredClone(fixtures[0].input);

for (const fixture of fixtures) {
  test(`V2 client/backend golden: ${fixture.name}`, () => {
    assert.deepEqual(parseCustomGraphBundleV2(fixture.input), fixture.normalized);
    assert.deepEqual(hashGraphBundleV2(fixture.input, fixture.projectMetadataHash), {
      graphBundleHash: fixture.expected.graphBundleHash,
      unboundGraphBundleHash: fixture.expected.unboundGraphBundleHash,
    });
    assert.equal(topologyHashV2(fixture.input), fixture.expected.topologyHash);
    assert.equal(validateSchema(fixture.input), true, JSON.stringify(validateSchema.errors));
    assert.equal(validateSchema(fixture.normalized), true, JSON.stringify(validateSchema.errors));
  });
}

test("combined roles occupy one target and allow a self initializer", () => {
  const graph = parseCustomGraphBundleV2(example());
  assert.equal(graph.targets.length, 1);
  assert.equal(graph.pool.tokenTargetId, graph.pool.hookTargetId);
  assert.equal(componentRoleMaskV2(graph.targets[0].componentRoles), 3);
  assert.equal(graph.targets[0].initializerAddressLocators[0].targetId, graph.targets[0].targetId);
  assert.equal(Object.hasOwn(graph.targets[0], "componentKind"), false);
});

test("normalization is deterministic, immutable, and does not change the caller's input", () => {
  const graph = structuredClone(fixtures[1].input);
  const original = structuredClone(graph);
  const normalized = parseCustomGraphBundleV2(graph);
  assert.deepEqual(graph, original);
  assert.deepEqual(normalized.targets.map(({ targetId }) => targetId), ["vault", "combined"]);
  assert.equal(normalized.sourceBundleSha256, graph.sourceBundleSha256.toLowerCase());
  assert.deepEqual(normalized.targets[1].declaredHookPermissions, ["beforeInitialize", "beforeSwap", "afterSwap"]);
  assert.throws(() => normalized.targets[0].componentRoles.push("token"), TypeError);
  assert.throws(() => { normalized.targets[0].initializerAddressLocators[0].byteOffset = 8; }, TypeError);
  graph.targets.reverse();
  graph.targets[0].initializerAddressLocators.reverse();
  assert.deepEqual(parseCustomGraphBundleV2(graph), normalized);
  assert.deepEqual(hashGraphBundleV2(graph), hashGraphBundleV2(normalized));
});

test("V2 hashes bind normalized graph and metadata with the exact versioned wrapper", () => {
  const graph = parseCustomGraphBundleV2(example());
  const metadata = fixtures[0].projectMetadataHash.toLowerCase();
  const unbound = sha256Digest(Buffer.from(canonicalizeJson(graph), "utf8"));
  assert.deepEqual(hashGraphBundleV2(graph), { graphBundleHash: unbound, unboundGraphBundleHash: unbound });
  const framed = Buffer.concat([
    Buffer.from("programmable.custom-graph-project-metadata.v2"), Buffer.from([0]),
    Buffer.from(canonicalizeJson({ graphBundleHash: unbound, projectMetadataHash: metadata })),
  ]);
  assert.equal(hashGraphBundleV2(graph, metadata).graphBundleHash, sha256Digest(framed));
  assert.notEqual(hashGraphBundleV2(graph, metadata).graphBundleHash, hashGraphBundle(graph, metadata).graphBundleHash);
  assert.notEqual(hashGraphBundleV2(graph, `sha256:${"dd".repeat(32)}`).graphBundleHash,
    hashGraphBundleV2(graph, metadata).graphBundleHash);
  assert.throws(() => hashGraphBundleV2(graph, "sha256:invalid"));
});

test("role assignment and locator phase are bound into V2 topology", () => {
  const graph = structuredClone(fixtures[2].input);
  const before = topologyHashV2(graph);
  graph.targets[0].componentRoles = [];
  graph.targets[0].declaredHookPermissions = null;
  graph.targets[1].componentRoles = ["token", "hook"];
  graph.targets[1].declaredHookPermissions = ["beforeSwap"];
  graph.pool.hookTargetId = "token";
  assert.notEqual(topologyHashV2(graph), before);
  const dependency = structuredClone(fixtures[1].input);
  const locator = dependency.targets[0].constructorAddressLocators.pop();
  dependency.targets[0].initializerAddressLocators = [locator];
  assert.notEqual(topologyHashV2(dependency), fixtures[1].expected.topologyHash);
  const changedBytes = example();
  changedBytes.targets[0].creationBytecode = "0x60ff";
  assert.notEqual(hashGraphBundleV2(changedBytes).graphBundleHash, hashGraphBundleV2(example()).graphBundleHash);
  assert.equal(topologyHashV2(changedBytes), topologyHashV2(example()));
});

for (const [roles, mask] of [[[], 0], [["token"], 1], [["hook"], 2], [["token", "hook"], 3]]) {
  test(`role mask accepts only the canonical meaning ${JSON.stringify(roles)}`, () => {
    assert.equal(componentRoleMaskV2(roles), mask);
  });
}

for (const roles of [null, {}, "token", ["other"], ["hook", "token"], ["token", "token"],
  ["hook", "hook"], ["token", "hook", "admin"], ["admin"], [1], ["Token"]]) {
  test(`rejects unsupported role representation ${JSON.stringify(roles)}`, () => {
    assert.throws(() => componentRoleMaskV2(roles), /componentRoles/);
    const graph = example();
    graph.targets[0].componentRoles = roles;
    assert.throws(() => parseCustomGraphBundleV2(graph));
    assert.equal(validateSchema(graph), false);
  });
}

for (const permissions of [null, ["unknown"], ["constructor"], ["beforeSwap", "beforeSwap"], {}, "beforeSwap"]) {
  test(`hook role rejects malformed permissions ${JSON.stringify(permissions)}`, () => {
    const graph = example();
    graph.targets[0].declaredHookPermissions = permissions;
    assert.throws(() => parseCustomGraphBundleV2(graph), /declaredHookPermissions/);
    assert.equal(validateSchema(graph), false);
  });
}

test("token and auxiliary roles require null permissions; empty hook flags stay structural", () => {
  const graph = structuredClone(fixtures[2].input);
  graph.targets[1].declaredHookPermissions = [];
  assert.throws(() => parseCustomGraphBundleV2(graph), /must be null/);
  assert.equal(validateSchema(graph), false);
  const combined = example();
  combined.targets[0].declaredHookPermissions = [];
  assert.deepEqual(parseCustomGraphBundleV2(combined).targets[0].declaredHookPermissions, []);
});

test("global roles and pool IDs resolve independently and exactly once", () => {
  for (const roles of [[], ["token"], ["hook"]]) {
    const graph = example();
    graph.targets[0].componentRoles = roles;
    if (!roles.includes("hook")) graph.targets[0].declaredHookPermissions = null;
    assert.throws(() => parseCustomGraphBundleV2(graph), /exactly one token role/);
    assert.equal(validateSchema(graph), false);
  }
  const graph = example();
  const second = structuredClone(graph.targets[0]); second.targetId = "second";
  graph.targets.push(second);
  assert.throws(() => parseCustomGraphBundleV2(graph), /exactly one token role/);
  assert.equal(validateSchema(graph), false);
  for (const key of ["tokenTargetId", "hookTargetId"]) {
    const invalid = example(); invalid.pool[key] = "missing";
    assert.throws(() => parseCustomGraphBundleV2(invalid), /pool IDs/);
  }
});

test("constructor DAG rejects duplicate IDs, self dependencies, cycles and unknown references", () => {
  const duplicate = example(); duplicate.targets.push(structuredClone(duplicate.targets[0]));
  assert.throws(() => parseCustomGraphBundleV2(duplicate), /duplicate graph target/);
  const self = example(); self.targets[0].constructorAddressLocators = [
    { targetId: "combined", byteOffset: 0, encoding: "abi-address-word" },
  ];
  assert.throws(() => parseCustomGraphBundleV2(self), /cannot reference itself/);
  const cycle = structuredClone(fixtures[1].input);
  cycle.targets[1].constructorAddressLocators = [{ targetId: "combined", byteOffset: 0, encoding: "abi-address-word" }];
  assert.throws(() => parseCustomGraphBundleV2(cycle), /contain a cycle/);
  for (const phase of ["constructorAddressLocators", "initializerAddressLocators"]) {
    const unknown = example(); unknown.targets[0][phase] = [
      { targetId: "missing", byteOffset: 0, encoding: "abi-address-word" },
    ];
    assert.throws(() => parseCustomGraphBundleV2(unknown), /unknown target/);
  }
});

test("retains locator overlap, shape, numeric and cardinality bounds", () => {
  for (const locators of [
    [{ targetId: "combined", byteOffset: -1, encoding: "abi-address-word" }],
    [{ targetId: "combined", byteOffset: 0.5, encoding: "abi-address-word" }],
    [{ targetId: "combined", byteOffset: Number.MAX_SAFE_INTEGER + 1, encoding: "abi-address-word" }],
    [{ targetId: "combined", byteOffset: 0, encoding: "unknown" }],
    [{ targetId: "combined", byteOffset: 0, encoding: "abi-address-word", extra: true }],
    [{ targetId: "combined", byteOffset: 4, encoding: "abi-address-word" },
      { targetId: "combined", byteOffset: 20, encoding: "packed-address-20" }],
    Array.from({ length: 257 }, (_, i) => ({ targetId: "combined", byteOffset: i * 32, encoding: "abi-address-word" })),
  ]) {
    const graph = example(); graph.targets[0].initializerAddressLocators = locators;
    assert.throws(() => parseCustomGraphBundleV2(graph));
  }
});

test("retains physical target, uint256, byte syntax, hash, identifier and pool bounds", () => {
  const empty = example(); empty.targets = [];
  assert.throws(() => parseCustomGraphBundleV2(empty), /between 1 and 16/);
  const graph = example();
  for (let i = 1; i < 16; i++) {
    graph.targets.push({ ...structuredClone(graph.targets[0]), targetId: `aux-${i}`,
      componentRoles: [], declaredHookPermissions: null });
  }
  assert.equal(parseCustomGraphBundleV2(graph).targets.length, 16);
  graph.targets.push({ ...graph.targets[15], targetId: "aux-16" });
  assert.throws(() => parseCustomGraphBundleV2(graph), /between 1 and 16/);
  for (const [field, value] of [
    ["deploymentValueWei", "01"], ["initializerValueWei", (1n << 256n).toString()],
    ["creationBytecode", "0x"], ["constructorArguments", "0x1"], ["initializerCalldata", "nothex"],
    ["applicantSalt", "0x1"], ["expectedRuntimeCodeHash", `0x${"00".repeat(32)}`],
    ["targetId", "x".repeat(257)],
  ]) {
    const invalid = example(); invalid.targets[0][field] = value;
    assert.throws(() => parseCustomGraphBundleV2(invalid));
  }
  for (const [field, value] of [["fee", -1], ["fee", 1_000_001], ["fee", 0.5], ["tickSpacing", 0], ["tickSpacing", 32_768]]) {
    const invalid = example(); invalid.pool[field] = value;
    assert.throws(() => parseCustomGraphBundleV2(invalid));
  }
  const dynamic = example(); dynamic.pool.fee = 0x800000;
  assert.equal(parseCustomGraphBundleV2(dynamic).pool.fee, 0x800000);
});

test("version discrimination stays closed and V1 never accepts a V2 graph", () => {
  const graph = example();
  assert.throws(() => normalizeAndPredictSubmittedGraph(graph), /schemaVersion/);
  const old = example(); old.schemaVersion = "programmable.custom-graph-bundle.v1";
  assert.throws(() => parseCustomGraphBundleV2(old), /schemaVersion/);
  const mixed = example(); mixed.targets[0].componentKind = "hook";
  assert.throws(() => parseCustomGraphBundleV2(mixed), /must contain exactly/);
  assert.equal(validateSchema(mixed), false);
  const extra = example(); extra.profile = "bypass";
  assert.throws(() => hashGraphBundleV2(extra), /must contain exactly/);
  assert.equal(validateSchema(extra), false);
  assert.equal(schema.properties.schemaVersion.const, CUSTOM_GRAPH_BUNDLE_SCHEMA_V2);
  assert.equal(schema["x-programmable-contract"].status, "standalone-foundation-not-activated");
});
