import { decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, type Abi, type Address, type Hex } from "viem";
import { moduleAddress as address, moduleBytes as bytes, moduleEqual as equal, moduleHash as hash, moduleInteger as integer, moduleRecord as record, moduleUint as uint, rejectModuleEvidence as fail } from "../../module-mode/release";
import { nativeCanonicalJson } from "./json-v1";
import type { ModuleEngineReleaseIdentity } from "./release-v1";
const BLOCK_KEYS = ["chainId", "blockNumber", "blockHash"];
export type EngineBlock = Readonly<{
    chainId: 4663;
    blockNumber: string;
    blockHash: Hex;
}>;
type Block = EngineBlock;
export const same = (a: unknown, b: unknown, label: string) => equal(nativeCanonicalJson(a), nativeCanonicalJson(b), label);
export function plain(value: unknown): unknown {
    if (typeof value === "bigint")
        return value.toString();
    if (typeof value === "string" && /^0x[0-9a-fA-F]*$/u.test(value))
        return value.toLowerCase();
    if (Array.isArray(value))
        return value.map(plain);
    if (value !== null && typeof value === "object")
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
    return value;
}
export function canonicalEngineLog(value: unknown, block: EngineBlock, transactionHash: Hex) {
    const log = bound(value, ["transactionHash", "logIndex", "address", "topics", "data", "removed"], block, "engine.log");
    equal(log.transactionHash, transactionHash, "engine.log.transaction");
    equal(log.removed, false, "engine.log.removed");
    const topics = list(log.topics, "engine.log.topics", 4).map(v => { const t = bytes(v, "engine.log.topic", 32); if (t.length !== 66)
        fail("engine.log.topic"); return t; });
    return { ...block, transactionHash, logIndex: integer(log.logIndex, "engine.log.index"), address: address(log.address, "engine.log.address"), topics,
        data: bytes(log.data, "engine.log.data", 262144), removed: false as const };
}
export type EngineLog = ReturnType<typeof canonicalEngineLog>;
export function engineEvent(logs: readonly EngineLog[], abi: Abi, source: Address, name: string, firstSubject?: Hex) {
    const event = abi.find(item => item.type === "event" && item.name === name);
    if (!event || event.type !== "event")
        fail("engine.event.abi");
    const topic = encodeEventTopics({ abi, eventName: name })[0];
    const found = logs.filter(log => log.address === source && log.topics[0] === topic && (firstSubject === undefined || log.topics[1] === firstSubject));
    if (found.length !== 1)
        fail("engine.event.missing-or-duplicate");
    const log = found[0]!;
    const decoded = decodeEventLog({ abi: [event], eventName: name, topics: log.topics as [
            Hex,
            ...Hex[]
        ], data: log.data, strict: true });
    const args = decoded.args as Record<string, unknown>;
    same(log.topics, encodeEventTopics({ abi: [event], eventName: name, args }), "engine.event.canonical-topics");
    const inputs = event.inputs.filter(input => !input.indexed);
    equal(log.data, encodeAbiParameters(inputs, inputs.map(input => args[input.name!])), "engine.event.canonical-data");
    return { args: plain(args) as Record<string, unknown>, logIndex: log.logIndex, log };
}
export function engineReadSet(value: unknown, block: EngineBlock, abi: Abi) {
    const r = bound(value, ["reads"], block, "engine.state");
    const reads = list(r.reads, "engine.state.reads", 256).map(value => {
        const r = record(value, ["address", "functionName", "args", "result"], "engine.read");
        const functionName = text(r.functionName, "engine.read.function", 128);
        const args = list(r.args, "engine.read.args", 6);
        if (args.some(arg => typeof arg !== "string" && typeof arg !== "number" && typeof arg !== "boolean"))
            fail("engine.read.args");
        encodeFunctionData({ abi, functionName, args });
        return { address: address(r.address, "engine.read.address"), functionName, args, result: bytes(r.result, "engine.read.result", 131072) };
    });
    const consumed = new Set<number>();
    return {
        take(account: Address, functionName: string, args: readonly unknown[] = []): unknown {
            const found = reads.map((value, index) => ({ value, index })).filter(({ value }) => value.address === account && value.functionName === functionName && nativeCanonicalJson(value.args) === nativeCanonicalJson(plain(args)));
            if (found.length !== 1 || consumed.has(found[0]!.index))
                fail(`engine.read.${functionName}.inventory`);
            const { value, index } = found[0]!;
            consumed.add(index);
            const result = decodeFunctionResult({ abi, functionName, data: value.result });
            equal(value.result, encodeFunctionResult({ abi, functionName, result }), "engine.read.canonical-result");
            return plain(result);
        },
        done() { if (consumed.size !== reads.length)
            fail("engine.read.unused"); },
    };
}
export function bound(value: unknown, keys: readonly string[], block: Block, label: string) {
    const result = record(value, [...BLOCK_KEYS, ...keys], label);
    equal(result.chainId, block.chainId, `${label}.chainId`);
    equal(uint(result.blockNumber, `${label}.blockNumber`, true), block.blockNumber, `${label}.blockNumber`);
    equal(hash(result.blockHash, `${label}.blockHash`), block.blockHash, `${label}.blockHash`);
    return result;
}
export function list(value: unknown, label: string, maximum: number): unknown[] {
    if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length
        || Reflect.ownKeys(value).length !== value.length + 1)
        fail(`${label}.array`);
    for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !("value" in descriptor))
            fail(`${label}.array`);
    }
    return value;
}
export function text(value: unknown, label: string, maxBytes: number): string {
    if (typeof value !== "string" || !value || new TextEncoder().encode(value).length > maxBytes)
        fail(`${label}.text`);
    return value;
}
export function finality(value: unknown, source: ModuleEngineReleaseIdentity, block: Block, transactionHash: Hex) {
    const proof = record(value, ["status", "policy", "verificationDigest", "sourceReleaseDigest", "l2", "l1Posting", "l1Finalized", "providers"], "verification");
    equal(proof.status, "verified", "verification.status");
    equal(proof.policy, source.finalityPolicy, "verification.policy");
    equal(hash(proof.sourceReleaseDigest, "verification.sourceReleaseDigest"), source.releaseDigest, "verification.sourceReleaseDigest");
    const l2 = bound(proof.l2, ["transactionHash"], block, "verification.l2");
    equal(hash(l2.transactionHash, "verification.l2.transactionHash"), transactionHash, "verification.l2.transactionHash");
    const posting = record(proof.l1Posting, ["chainId", "blockNumber", "blockHash", "transactionHash", "batchNumber"], "verification.l1Posting");
    equal(posting.chainId, 1, "verification.l1Posting.chainId");
    const postingNumber = uint(posting.blockNumber, "verification.l1Posting.blockNumber", true);
    const postingHash = hash(posting.blockHash, "verification.l1Posting.blockHash");
    const l1 = record(proof.l1Finalized, ["chainId", "blockNumber", "blockHash", "tag"], "verification.l1Finalized");
    equal(l1.chainId, 1, "verification.l1Finalized.chainId");
    equal(l1.tag, "finalized", "verification.l1Finalized.tag");
    const number = uint(l1.blockNumber, "verification.l1Finalized.blockNumber", true);
    const blockHash = hash(l1.blockHash, "verification.l1Finalized.blockHash");
    if (BigInt(postingNumber) > BigInt(number) || (postingNumber === number && postingHash !== blockHash))
        fail("verification.posting-after-finality");
    const providers = list(proof.providers, "verification.providers", 4).map((raw) => {
        const p = record(raw, ["id", "trustDomain", "chainId", "blockNumber", "blockHash"], "verification.provider");
        const id = text(p.id, "verification.provider.id", 128);
        const trustDomain = text(p.trustDomain, "verification.provider.trustDomain", 128).toLowerCase();
        if (!/^[a-z0-9][a-z0-9.-]*$/u.test(trustDomain))
            fail("verification.provider.trustDomain");
        if (p.chainId !== 1 && p.chainId !== 4663)
            fail("verification.provider.chainId");
        const expected = p.chainId === 1 ? { number, blockHash } : { number: block.blockNumber, blockHash: block.blockHash };
        equal(uint(p.blockNumber, "verification.provider.blockNumber", true), expected.number, "verification.provider.blockNumber");
        equal(hash(p.blockHash, "verification.provider.blockHash"), expected.blockHash, "verification.provider.blockHash");
        return Object.freeze({ id, trustDomain, chainId: p.chainId, blockNumber: expected.number, blockHash: expected.blockHash });
    });
    for (const chain of [1, 4663]) {
        const pair = providers.filter((p) => p.chainId === chain);
        if (pair.length !== 2 || pair[0]!.id === pair[1]!.id || pair[0]!.trustDomain === pair[1]!.trustDomain)
            fail("verification.provider-quorum");
    }
    return Object.freeze({ verificationDigest: hash(proof.verificationDigest, "verification.verificationDigest"),
        ethereumBlockNumber: number, ethereumBlockHash: blockHash, batchNumber: uint(posting.batchNumber, "verification.batchNumber"),
        postingTransactionHash: hash(posting.transactionHash, "verification.postingTransactionHash"), providers: Object.freeze(providers) });
}
