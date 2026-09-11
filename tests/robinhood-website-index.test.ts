import { describe, expect, it, vi } from "vitest";

import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import {
  launchList,
  parseSnapshot,
  type Checkpoint,
  type RobinhoodSnapshot,
} from "@/lib/server/robinhood-index/model";
import type { IndexStore } from "@/lib/server/robinhood-index/store";
import {
  IndexBlockIncomplete,
  IndexRangeTooWide,
  syncRobinhoodIndex,
  type IndexSource,
} from "@/lib/server/robinhood-index/sync";

const NOW = Date.parse("2026-09-05T00:00:00.000Z");
const ROUTER = address(0xabc);
const BINDING = hash(0xdef);
const OPTIONS = { rangeSize: 100n, now: () => NOW };

function hash(value: number | bigint): string {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function address(value: number): string {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function point(number: number | bigint, fork = 0): Checkpoint {
  return { number: String(number), hash: hash(BigInt(number) + 1_000_000n * BigInt(fork + 1)) };
}

function launch(id: number, block: number | bigint, overrides: Partial<RobinhoodLaunch> = {}): RobinhoodLaunch {
  return {
    routerAddress: ROUTER,
    launchId: hash(id),
    tokenAddress: address(1_000 + id),
    hookAddress: address(2_000 + id),
    creator: address(3_000),
    poolManager: address(4_000),
    poolId: hash(5_000 + id),
    stampHash: hash(6_000 + id),
    transactionHash: hash(7_000 + id),
    blockNumber: String(block),
    blockHash: point(block).hash,
    logIndex: id,
    launchedAt: new Date(NOW - 60_000).toISOString(),
    name: `Token ${id}`,
    symbol: `T${id}`,
    decimals: 18,
    ...overrides,
  };
}

function snapshot(items: RobinhoodLaunch[] = [], overrides: Partial<RobinhoodSnapshot> = {}): RobinhoodSnapshot {
  return {
    version: 1,
    chainId: 4663,
    routerAddress: ROUTER,
    binding: BINDING,
    startBlock: "100",
    cursor: point(299),
    checkpoints: [point(199), point(299)],
    finalizedBlock: "299",
    updatedAt: new Date(NOW).toISOString(),
    items,
    ...overrides,
  };
}

function memoryStore(initial: RobinhoodSnapshot | null = null) {
  let current = initial ? structuredClone(parseSnapshot(initial)) : null;
  let revision = initial ? 1 : 0;
  let etag: string | null = initial ? `v${revision}` : null;
  const writes: { snapshot: RobinhoodSnapshot; etag: string | null }[] = [];
  const store: IndexStore = {
    async read() {
      return current && etag ? { snapshot: structuredClone(current), etag } : null;
    },
    async write(value, expectedEtag) {
      writes.push({ snapshot: structuredClone(value), etag: expectedEtag });
      if (expectedEtag !== etag) throw new Error("Compare-and-swap conflict");
      current = structuredClone(parseSnapshot(value));
      etag = `v${++revision}`;
    },
  };
  return {
    store,
    writes,
    saved: () => structuredClone(current),
    replace(value: RobinhoodSnapshot) {
      current = structuredClone(parseSnapshot(value));
      etag = `v${++revision}`;
    },
  };
}

function indexSource(rows: RobinhoodLaunch[], finalized = 299n) {
  return {
    routerAddress: ROUTER,
    binding: BINDING,
    startBlock: 100n,
    finalized: point(finalized),
    block: vi.fn<IndexSource["block"]>(async (number) => point(number)),
    launches: vi.fn<IndexSource["launches"]>(async (from, to) => rows.filter((row) =>
      BigInt(row.blockNumber) >= from && BigInt(row.blockNumber) <= to)),
  } satisfies IndexSource;
}

describe("Robinhood website index synchronization", () => {
  it("persists the completed prefix and retries the entire range that failed verification", async () => {
    const rows = [launch(1, 120), launch(2, 220), launch(3, 320)];
    const source = indexSource(rows, 399n);
    const memory = memoryStore();
    source.launches.mockImplementationOnce(async () => [rows[0]]);
    source.launches.mockRejectedValueOnce(new Error("Stamp verification RPC failed"));

    const partial = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(partial).toMatchObject({ status: "partial", ranges: 1, indexedThrough: "199", launches: 1 });
    expect(source.launches.mock.calls.map(([from, to]) => [from, to])).toEqual([[100n, 199n], [200n, 299n]]);
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0].etag).toBeNull();
    expect(memory.saved()).toMatchObject({ cursor: point(199), finalizedBlock: "399", items: [rows[0]] });

    source.launches.mockClear();
    const retry = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(retry).toMatchObject({ status: "ready", indexedThrough: "399", launches: 3 });
    expect(source.launches.mock.calls[0].slice(0, 2)).toEqual([136n, 235n]);
    expect(memory.saved()?.items).toEqual(rows);
    expect(memory.writes[1].etag).toBe("v1");
  });

  it.each(["RPC", "stamp verification"])("does not advance or replace saved rows after a %s error", async (failure) => {
    const original = snapshot([launch(1, 150), launch(2, 190)], {
      cursor: point(199), checkpoints: [point(199)], finalizedBlock: "199",
    });
    const memory = memoryStore(original);
    const source = indexSource([launch(3, 220)]);
    if (failure === "RPC") {
      source.block.mockImplementation(async (number) => {
        if (number === 235n) throw new Error("RPC unavailable");
        return point(number);
      });
    } else {
      source.launches.mockRejectedValue(new Error("Could not verify the complete range"));
    }

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "partial", ranges: 0, indexedThrough: "199", launches: 2 });
    expect(memory.writes).toEqual([]);
    expect(memory.saved()).toEqual(original);
  });

  it("discards a range if its ending block changes while launches are being verified", async () => {
    const source = indexSource([launch(1, 150)], 399n);
    const memory = memoryStore();
    let reads = 0;
    source.block.mockImplementation(async (number) => {
      if (number === 199n) return point(number, reads++ === 0 ? 0 : 1);
      return point(number);
    });

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "partial", ranges: 0, indexedThrough: null, launches: 0 });
    expect(source.launches).toHaveBeenCalledOnce();
    expect(memory.writes).toEqual([]);
    expect(memory.saved()).toBeNull();
  });

  it("does not publish any completed ranges when the finalized boundary changes before writing", async () => {
    const source = indexSource([launch(1, 150), launch(2, 250)]);
    const memory = memoryStore();
    let boundaryReads = 0;
    source.block.mockImplementation(async (number) => {
      if (number === 299n) return point(number, ++boundaryReads <= 2 ? 0 : 1);
      return point(number);
    });

    await expect(syncRobinhoodIndex(source, memory.store, OPTIONS)).rejects.toThrow("Finalized boundary changed");

    expect(source.launches).toHaveBeenCalledTimes(2);
    expect(memory.writes).toEqual([]);
    expect(memory.saved()).toBeNull();
  });

  it("follows new finalized blocks and deduplicates launches replayed by the overlap", async () => {
    const rows = [launch(1, 190)];
    const source = indexSource(rows, 199n);
    const memory = memoryStore();
    await syncRobinhoodIndex(source, memory.store, OPTIONS);

    rows.push(launch(2, 220), launch(3, 280));
    source.finalized = point(299);
    source.launches.mockClear();
    const follow = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(follow).toMatchObject({ status: "ready", indexedThrough: "299", launches: 3 });
    expect(source.launches.mock.calls.map(([from, to]) => [from, to])).toEqual([[136n, 235n], [236n, 299n]]);
    expect(source.launches.mock.calls[0][2]).toEqual([rows[0]]);
    expect(memory.saved()?.items).toEqual(rows);

    source.launches.mockClear();
    await syncRobinhoodIndex(source, memory.store, OPTIONS);
    expect(source.launches.mock.calls.map(([from, to]) => [from, to])).toEqual([[236n, 299n]]);
    expect(memory.saved()?.items).toEqual(rows);
    expect(new Set(memory.saved()?.items.map((row) => row.launchId)).size).toBe(3);
  });

  it("continues overlapping scans with small RPC ranges without losing completed coverage", async () => {
    const rows = [launch(1, 190), launch(2, 220)];
    const memory = memoryStore(snapshot([rows[0]], {
      cursor: point(199), checkpoints: [point(199)], finalizedBlock: "199",
    }));
    const source = indexSource(rows, 249n);

    const result = await syncRobinhoodIndex(source, memory.store, { ...OPTIONS, rangeSize: 10n });

    expect(result).toMatchObject({ status: "ready", indexedThrough: "249", launches: 2 });
    expect(memory.saved()?.items).toEqual(rows);
    for (const [from, to] of source.launches.mock.calls) {
      expect(to - from + 1n).toBeLessThanOrEqual(10n);
    }
  });

  it("preserves verified launches when a successful overlap response omits their logs", async () => {
    const original = launch(1, 250);
    const memory = memoryStore(snapshot([original]));
    const source = indexSource([], 399n);

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(source.launches.mock.calls[0].slice(0, 2)).toEqual([236n, 335n]);
    expect(result).toMatchObject({ status: "ready", indexedThrough: "399", launches: 1 });
    expect(memory.saved()?.items).toEqual([original]);
  });

  it.each([
    { blockHash: point(250, 1).hash },
    { logIndex: 7 },
  ])("rejects a changed launch location without a canonical reorg: %j", async (changed) => {
    const original = snapshot([launch(1, 250)]);
    const memory = memoryStore(original);
    const source = indexSource([launch(1, 250, changed)], 399n);

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "partial", ranges: 0, indexedThrough: "299", launches: 1 });
    expect(memory.writes).toEqual([]);
    expect(memory.saved()).toEqual(original);
  });

  it("retains verified pending launches when a canonical block retry omits their logs", async () => {
    const accepted = launch(1, 190);
    const pending = launch(2, 250);
    const memory = memoryStore(snapshot([accepted], {
      cursor: point(199), checkpoints: [point(199)],
      pending: { block: point(250), items: [pending] },
    }));
    const source = indexSource([], 399n);

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "ready", indexedThrough: "399", launches: 2 });
    expect(memory.saved()).toMatchObject({ pending: null, items: [accepted, pending] });
  });

  it("keeps default RPC ranges within the provider's 10,000-block inclusive limit", async () => {
    const source = indexSource([], 20_100n);
    const memory = memoryStore();

    const result = await syncRobinhoodIndex(source, memory.store, { now: () => NOW });

    expect(result).toMatchObject({ status: "ready", indexedThrough: "20100" });
    const ranges = source.launches.mock.calls.map(([from, to]) => [from, to]);
    expect(ranges[0][0]).toBe(100n);
    expect(ranges.at(-1)?.[1]).toBe(20_100n);
    for (const [index, [from, to]] of ranges.entries()) {
      expect(to - from + 1n).toBeLessThanOrEqual(10_000n);
      if (index > 0) expect(from).toBe(ranges[index - 1][1] + 1n);
    }
  });

  it("halves an overlapping follow range without moving the saved cursor backwards or skipping new blocks", async () => {
    const rows = [launch(1, 190), launch(2, 220)];
    const memory = memoryStore(snapshot([rows[0]], {
      cursor: point(199), checkpoints: [point(199)], finalizedBlock: "199",
    }));
    const source = indexSource(rows, 249n);
    const completed: [bigint, bigint][] = [];
    source.launches.mockImplementation(async (from, to) => {
      if (to - from + 1n > 25n) throw new IndexRangeTooWide();
      completed.push([from, to]);
      return rows.filter((row) => BigInt(row.blockNumber) >= from && BigInt(row.blockNumber) <= to);
    });

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "ready", indexedThrough: "249", launches: 2 });
    expect(source.launches.mock.calls[0].slice(0, 2)).toEqual([136n, 235n]);
    expect(memory.saved()?.items).toEqual(rows);
    for (let block = 200n; block <= 249n; block += 1n) {
      expect(completed.filter(([from, to]) => from <= block && block <= to)).toHaveLength(1);
    }
    for (const [from, to] of completed) expect(to - from + 1n).toBeLessThanOrEqual(25n);
  });

  it("stops reducing at one block, preserves the completed prefix and never skips the failing block", async () => {
    const rows = [launch(1, 150), launch(2, 220)];
    const source = indexSource(rows);
    const memory = memoryStore();
    source.launches.mockImplementation(async (from, to) => {
      if (from <= 200n && to >= 200n) throw new IndexRangeTooWide();
      return rows.filter((row) => BigInt(row.blockNumber) >= from && BigInt(row.blockNumber) <= to);
    });

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "partial", ranges: 1, indexedThrough: "199", launches: 1 });
    expect(source.launches.mock.calls.at(-1)?.slice(0, 2)).toEqual([200n, 200n]);
    expect(source.launches.mock.calls.length).toBeLessThan(20);
    expect(source.launches.mock.calls.every(([from]) => from <= 200n)).toBe(true);
    expect(memory.saved()).toMatchObject({ cursor: point(199), items: [rows[0]] });
    expect(memory.writes).toHaveLength(1);
  });

  it("makes forward progress when adaptive one-block ranges would otherwise consume the whole pass replaying overlap", async () => {
    const rows = [launch(1, 190), launch(2, 205)];
    const memory = memoryStore(snapshot([rows[0]], {
      cursor: point(199), checkpoints: [point(199)], finalizedBlock: "199",
    }));
    const source = indexSource(rows, 209n);
    source.launches.mockImplementation(async (from, to) => {
      if (from !== to) throw new IndexRangeTooWide();
      return rows.filter((row) => BigInt(row.blockNumber) === from);
    });

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "ready", indexedThrough: "209", launches: 2 });
    expect(memory.saved()?.items).toEqual(rows);
  });

  it("resumes a dense single block across passes and publishes its launches only after the block is complete", async () => {
    const retained = launch(1, 150);
    const dense = Array.from({ length: 7 }, (_, index) => launch(index + 2, 200));
    const memory = memoryStore(snapshot([retained], {
      cursor: point(199), checkpoints: [point(199)], finalizedBlock: "199",
    }));
    const source = indexSource([retained, ...dense], 249n);
    const knownAtResume: RobinhoodLaunch[][] = [];
    let blockPass = 0;
    source.launches.mockImplementation(async (from, to, known) => {
      if (from <= 200n && to >= 200n) {
        if (from !== to) throw new IndexRangeTooWide();
        knownAtResume.push([...known]);
        blockPass += 1;
        if (blockPass < 3) throw new IndexBlockIncomplete(dense.slice(0, blockPass * 3));
        return dense;
      }
      return [retained].filter((row) => BigInt(row.blockNumber) >= from && BigInt(row.blockNumber) <= to);
    });

    for (const count of [3, 6]) {
      const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);
      expect(result).toMatchObject({ status: "syncing", indexedThrough: "199", launches: 1 });
      expect(memory.saved()?.pending).toEqual({ block: point(200), items: dense.slice(0, count) });
      const visible = launchList(memory.saved(), 1, "", NOW);
      expect(visible).toMatchObject({ status: "syncing", items: [retained], page: { totalItems: 1 } });
      expect(launchList(memory.saved(), 1, dense[0].tokenAddress, NOW).items).toEqual([]);
    }
    expect(knownAtResume).toEqual([[retained], [retained, ...dense.slice(0, 3)]]);

    const completed = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(knownAtResume[2]).toEqual([retained, ...dense.slice(0, 6)]);
    expect(completed).toMatchObject({ status: "ready", indexedThrough: "249", launches: 8 });
    expect(memory.saved()?.pending).toBeNull();
    expect(memory.saved()?.items).toEqual([retained, ...dense]);
    expect(launchList(memory.saved(), 1, "", NOW).page.totalItems).toBe(8);
    expect(memory.writes).toHaveLength(3);
  });

  it("retains disjoint verified pending subsets across repeated incomplete responses from the same canonical block", async () => {
    const accepted = launch(1, 190);
    const dense = Array.from({ length: 7 }, (_, index) => launch(index + 2, 250));
    const memory = memoryStore(snapshot([accepted], {
      cursor: point(249), checkpoints: [point(249)], finalizedBlock: "249",
    }));
    const source = indexSource([accepted, ...dense]);
    let pass = 0;
    source.launches.mockImplementation(async (from, to) => {
      if (from <= 250n && to >= 250n) {
        if (from !== to) throw new IndexRangeTooWide();
        pass += 1;
        if (pass === 1) throw new IndexBlockIncomplete(dense.slice(0, 3));
        if (pass === 2) throw new IndexBlockIncomplete(dense.slice(3, 6));
        return dense.slice(3);
      }
      return [accepted].filter((row) => BigInt(row.blockNumber) >= from && BigInt(row.blockNumber) <= to);
    });

    for (const count of [3, 6]) {
      const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);
      expect(result).toMatchObject({ status: "syncing", indexedThrough: "249", launches: 1 });
      expect(memory.saved()?.pending).toEqual({ block: point(250), items: dense.slice(0, count) });
      expect(launchList(memory.saved(), 1, "", NOW).items).toEqual([accepted]);
    }

    const completed = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(completed).toMatchObject({ status: "ready", indexedThrough: "299", launches: 8 });
    expect(memory.saved()).toMatchObject({ pending: null, items: [accepted, ...dense] });
    expect(memory.writes).toHaveLength(3);
  });

  it.each([
    { logIndex: 99 },
    { blockHash: point(250, 1).hash },
  ])("rejects a conflicting pending launch position without writing the store: %j", async (changed) => {
    const accepted = launch(1, 190);
    const pending = launch(2, 250);
    const original = snapshot([accepted], {
      cursor: point(249), checkpoints: [point(249)],
      pending: { block: point(250), items: [pending] },
    });
    const memory = memoryStore(original);
    const source = indexSource([]);
    source.launches.mockRejectedValue(new IndexBlockIncomplete([
      { ...pending, ...changed }, launch(3, 250),
    ]));

    await expect(syncRobinhoodIndex(source, memory.store, OPTIONS)).rejects.toThrow("Launch location changed without a reorg");

    expect(source.launches.mock.calls[0].slice(0, 2)).toEqual([250n, 250n]);
    expect(memory.writes).toEqual([]);
    expect(memory.saved()).toEqual(original);
  });

  it("discards pending launches when their block changes even if the completed cursor is still canonical", async () => {
    const retained = launch(1, 150);
    const orphan = launch(2, 200);
    const replacement = launch(3, 200, { blockHash: point(200, 1).hash });
    const memory = memoryStore(snapshot([retained], {
      cursor: point(199), checkpoints: [point(199)], finalizedBlock: "249",
      pending: { block: point(200), items: [orphan] },
    }));
    const source = indexSource([retained, replacement], 249n);
    source.finalized = point(249, 1);
    source.block.mockImplementation(async (number) => point(number, number >= 200n ? 1 : 0));

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "ready", indexedThrough: "249", launches: 2 });
    for (const [, , known] of source.launches.mock.calls) expect(known).not.toContainEqual(orphan);
    expect(memory.saved()?.pending).toBeNull();
    expect(memory.saved()?.items).toEqual([retained, replacement]);
  });

  it("removes pending and orphaned published launches on a cursor reorg before retrying verification", async () => {
    const retained = launch(1, 150);
    const orphan = launch(2, 250);
    const pending = launch(3, 300);
    const memory = memoryStore(snapshot([retained, orphan], {
      finalizedBlock: "399", pending: { block: point(300), items: [pending] },
    }));
    const source = indexSource([], 399n);
    source.finalized = point(399, 1);
    source.block.mockImplementation(async (number) => point(number, number > 199n ? 1 : 0));
    source.launches.mockRejectedValue(new Error("Replacement range unavailable"));

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "partial", rewound: true, indexedThrough: "199", launches: 1 });
    expect(source.launches.mock.calls[0][2]).toEqual([retained]);
    expect(memory.saved()).toMatchObject({ cursor: point(199), pending: null, items: [retained] });
    expect(launchList(memory.saved(), 1, "", NOW).items).toEqual([retained]);
  });

  it("saves completed progress when a pass reaches its range limit", async () => {
    const rows = [launch(1, 150), launch(2, 250)];
    const source = indexSource(rows);
    const memory = memoryStore();

    const result = await syncRobinhoodIndex(source, memory.store, { ...OPTIONS, maxRanges: 1 });

    expect(result).toMatchObject({ status: "syncing", ranges: 1, indexedThrough: "199" });
    expect(source.launches).toHaveBeenCalledOnce();
    expect(memory.saved()).toMatchObject({ cursor: point(199), finalizedBlock: "299", items: [rows[0]] });
  });

  it("rewinds to a canonical checkpoint and removes launches from the orphaned branch", async () => {
    const retained = launch(1, 150);
    const orphan = launch(2, 250);
    const replacement = launch(3, 260, { blockHash: point(260, 1).hash });
    const memory = memoryStore(snapshot([retained, orphan]));
    const source = indexSource([retained, replacement], 399n);
    source.finalized = point(399, 1);
    source.block.mockImplementation(async (number) => point(number, number > 199n ? 1 : 0));

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "ready", rewound: true, indexedThrough: "399", launches: 2 });
    expect(source.launches.mock.calls[0][2]).toEqual([retained]);
    expect(memory.saved()?.items).toEqual([retained, replacement]);
    expect(memory.saved()?.checkpoints).not.toContainEqual(point(299));
  });

  it("persists removal of orphaned launches even when the first replacement range fails", async () => {
    const retained = launch(1, 150);
    const memory = memoryStore(snapshot([retained, launch(2, 250)]));
    const source = indexSource([], 399n);
    source.finalized = point(399, 1);
    source.block.mockImplementation(async (number) => point(number, number > 199n ? 1 : 0));
    source.launches.mockRejectedValue(new Error("Backfill RPC unavailable"));

    const result = await syncRobinhoodIndex(source, memory.store, OPTIONS);

    expect(result).toMatchObject({ status: "partial", rewound: true, ranges: 0, indexedThrough: "199", launches: 1 });
    expect(memory.saved()).toMatchObject({ cursor: point(199), checkpoints: [point(199)], items: [retained] });
    expect(memory.writes).toHaveLength(1);
  });

  it("propagates a compare-and-swap conflict and preserves the newer writer's snapshot", async () => {
    const old = snapshot([launch(1, 150)], { cursor: point(199), checkpoints: [point(199)], finalizedBlock: "199" });
    const newer = snapshot([launch(1, 150), launch(2, 250)], {
      cursor: point(399), checkpoints: [point(199), point(399)], finalizedBlock: "399",
    });
    const memory = memoryStore(old);
    const source = indexSource([launch(1, 150), launch(2, 250)]);
    source.launches.mockImplementationOnce(async () => {
      memory.replace(newer);
      return [launch(1, 150)];
    });

    await expect(syncRobinhoodIndex(source, memory.store, OPTIONS)).rejects.toThrow("Compare-and-swap conflict");

    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0].etag).toBe("v1");
    expect(memory.saved()).toEqual(newer);
  });

  it("does not reuse a stored index for a different canonical binding", async () => {
    const memory = memoryStore(snapshot([launch(1, 150)]));
    const source = indexSource([]);
    source.binding = hash(99);

    await expect(syncRobinhoodIndex(source, memory.store, OPTIONS)).rejects.toThrow("index migration required");

    expect(source.block).not.toHaveBeenCalled();
    expect(source.launches).not.toHaveBeenCalled();
    expect(memory.writes).toEqual([]);
  });
});

describe("Robinhood website launch list", () => {
  it("lists a verified stamped launch even when all optional metadata is unavailable", async () => {
    const row = launch(1, 150, { name: null, symbol: null, decimals: null, launchedAt: null });
    const memory = memoryStore();
    await syncRobinhoodIndex(indexSource([row]), memory.store, OPTIONS);

    const result = launchList(memory.saved(), 1, row.tokenAddress, NOW);

    expect(result.status).toBe("ready");
    expect(result.items).toEqual([row]);
    expect(result.page.totalItems).toBe(1);
  });

  it("searches names, symbols and contract addresses case-insensitively before pagination", () => {
    const rows = Array.from({ length: 60 }, (_, index) => launch(index + 1, 100 + index));
    rows[0] = { ...rows[0], name: "Robinhood Test", symbol: "RHCT" };
    const saved = snapshot(rows);

    for (const query of ["  rObInHoOd TeSt  ", "rhct", rows[0].tokenAddress.toUpperCase(), rows[0].hookAddress!]) {
      const result = launchList(saved, 1, query, NOW);
      expect(result.items).toEqual([rows[0]]);
      expect(result.page).toMatchObject({ totalItems: 1, totalPages: 1, hasMore: false });
    }
    expect(launchList(saved, 1, "does not exist", NOW)).toMatchObject({
      status: "ready", items: [], page: { number: 1, totalItems: 0, totalPages: 0, hasMore: false },
    });
  });

  it("paginates newest-first without mutating the stored order and clamps page bounds", () => {
    const rows = Array.from({ length: 55 }, (_, index) => launch(index + 1, 100 + index));
    const saved = snapshot(rows);
    const first = launchList(saved, 1, "", NOW);
    const second = launchList(saved, 2, "", NOW);

    expect(first.items.map((row) => row.launchId)).toEqual(rows.slice(5).toReversed().map((row) => row.launchId));
    expect(first.page).toEqual({ number: 1, size: 50, totalItems: 55, totalPages: 2, hasMore: true });
    expect(second.items).toEqual(rows.slice(0, 5).toReversed());
    expect(second.page).toEqual({ number: 2, size: 50, totalItems: 55, totalPages: 2, hasMore: false });
    expect(launchList(saved, 999, "", NOW)).toEqual(second);
    expect(launchList(saved, -1, "", NOW)).toEqual(first);
    expect(saved.items).toEqual(rows);
    expect(saved.items[0].launchId).toBe(hash(1));
  });

  it("orders large block numbers exactly, using log order to break ties", () => {
    const block = 9_007_199_254_740_992n;
    const rows = [launch(1, block), launch(2, block + 1n), launch(3, block, { logIndex: 7 })];
    const saved = parseSnapshot(snapshot(rows, {
      cursor: point(block + 1n), checkpoints: [point(block + 1n)], finalizedBlock: String(block + 1n),
    }));

    expect(launchList(saved, 1, "", NOW).items).toEqual([rows[1], rows[2], rows[0]]);
    expect(launchList(saved, 1, "", NOW, { sort: "oldest" }).items).toEqual([rows[0], rows[2], rows[1]]);
  });

  it.each(["highest", "lowest"] as const)("sorts the entire catalog by %s market cap before pagination", (sort) => {
    const rows = Array.from({ length: 60 }, (_, index) => launch(index + 1, 100 + index));
    const saved = snapshot(rows);
    const caps = new Map(rows.map((row, index) => [row.tokenAddress, (60 - index) * 100]));
    const ordered = sort === "highest" ? rows : rows.toReversed();
    const first = launchList(saved, 1, "", NOW, { sort }, caps);
    const second = launchList(saved, 2, "", NOW, { sort }, caps);
    expect(first.items).toEqual(ordered.slice(0, 50));
    expect(first.page).toMatchObject({ totalItems: 60, totalPages: 2, hasMore: true });
    expect(second.items).toEqual(ordered.slice(50));
    expect(launchList(saved, 99, "", NOW, { sort }, caps)).toEqual(second);
    expect(launchList(saved, 1, rows[59].tokenAddress, NOW, { sort }, caps).items).toEqual([rows[59]]);
    expect(saved.items).toEqual(rows);
  });

  it.each(["highest", "lowest", "newest", "oldest"] as const)("keeps the verified Programmable token first for %s, every page and search", (sort) => {
    const pinned = launch(70, 170, { tokenAddress: "0xC60bA256B44334A0Cd2C7242E98B88f031abB006" });
    const hidden = launch(71, 171, { tokenAddress: "0x15FCA474B23CAFE775120B1FAfbCFF0E7a827af2" });
    const rows = Array.from({ length: 55 }, (_, index) => launch(index + 1, 100 + index));
    const saved = snapshot([...rows, pinned, hidden]);
    const caps = new Map([...rows, pinned, hidden].map((row, index) => [row.tokenAddress.toLowerCase(), index]));
    const ascending = sort === "lowest" || sort === "oldest";
    const ordered = ascending ? rows : rows.toReversed();
    const first = launchList(saved, 1, "", NOW, { sort }, caps);
    const second = launchList(saved, 2, "", NOW, { sort }, caps);
    expect(first.items).toEqual([pinned, ...ordered.slice(0, 49)]);
    expect(second.items).toEqual([pinned, ...ordered.slice(49)]);
    expect(first.page).toMatchObject({ totalItems: 56, totalPages: 2 });
    expect(launchList(saved, 1, rows[3].tokenAddress, NOW, { sort }, caps).items).toEqual([pinned, rows[3]]);
    expect(launchList(saved, 1, hidden.tokenAddress, NOW, { sort }, caps).items).toEqual([pinned]);
    expect(saved.items).toEqual([...rows, pinned, hidden]);
  });

  it.each(["highest", "lowest", "newest", "oldest"] as const)("applies %s to V4 search matches while keeping the main token pinned", (sort) => {
    const pinned = launch(70, 170, { symbol: "V4", tokenAddress: "0xC60bA256B44334A0Cd2C7242E98B88f031abB006" });
    const matches = Array.from({ length: 20 }, (_, index) => launch(index + 1, 100 + index, { symbol: "V4" }));
    const unrelated = launch(71, 171, { name: "Another token", symbol: "OTHER" });
    const caps = new Map(matches.map((row, index) => [row.tokenAddress, 20 - index]));
    caps.set(unrelated.tokenAddress, 1_000_000);
    const ordered = sort === "highest" || sort === "oldest" ? matches : matches.toReversed();
    const result = launchList(snapshot([...matches, unrelated, pinned]), 1, " v4 ", NOW, { sort }, caps);
    expect(result.items).toEqual([pinned, ...ordered]);
    expect(result.page.totalItems).toBe(21);
  });

  it.each([
    { tokenAddress: "0x15fca474b23cafe775120b1fafbcff0e7a827af2", name: "Robinhood Clean Room", symbol: "RHCR" },
    { tokenAddress: "0xb36271399c031ce270e0d1eed5f26dcd08367119", name: "Any Quote LP Internal Test", symbol: "AQLPTEST" },
  ])("hides only the exact $symbol canary without removing canonical records or other matching metadata", ({ tokenAddress, name, symbol }) => {
    const hidden = launch(1, 100, { tokenAddress, name, symbol });
    const other = launch(2, 101, { name, symbol });
    const saved = snapshot([hidden, other]);
    expect(launchList(saved, 1, "", NOW).items).toEqual([other]);
    expect(saved.items).toHaveLength(2);
  });

  it.each(["highest", "lowest"] as const)("keeps unknown caps last for %s, preserves zero and breaks ties by launch order", (sort) => {
    const rows = Array.from({ length: 6 }, (_, index) => launch(index + 1, 100 + index));
    const caps = new Map([[rows[0].tokenAddress, 0], [rows[1].tokenAddress, 5], [rows[2].tokenAddress, 5],
      [rows[3].tokenAddress, -1], [rows[4].tokenAddress, NaN]]);
    const known = sort === "highest" ? [rows[2], rows[1], rows[0]] : [rows[0], rows[2], rows[1]];
    expect(launchList(snapshot(rows), 1, "", NOW, { sort }, caps).items).toEqual([...known, rows[5], rows[4], rows[3]]);
  });

  it("distinguishes unavailable, syncing, ready and stale while retaining indexed rows", () => {
    const row = launch(1, 150);
    const saved = snapshot([row]);
    const syncing = snapshot([row], { finalizedBlock: "399" });

    expect(launchList(null, 1, "", NOW)).toMatchObject({ chainId: 4663, status: "unavailable", updatedAt: null, items: [] });
    expect(launchList(saved, 1, "", NOW).status).toBe("ready");
    expect(launchList(syncing, 1, "", NOW).status).toBe("syncing");
    expect(launchList(saved, 1, "", NOW + 300_000).status).toBe("ready");
    for (const value of [saved, syncing]) {
      expect(launchList(value, 1, "", NOW + 300_001)).toMatchObject({
        status: "stale", updatedAt: saved.updatedAt, items: [row],
      });
    }
  });
});

describe("Robinhood persisted snapshot validation", () => {
  const invalid: { reason: string; change: (value: RobinhoodSnapshot) => unknown; error: string }[] = [
    { reason: "another chain", change: (value) => ({ ...value, chainId: 1 }), error: "Invalid Robinhood index" },
    { reason: "a malformed Router address", change: (value) => ({ ...value, routerAddress: "0x123" }), error: "Invalid Robinhood index" },
    { reason: "a launch from another Router", change: (value) => ({ ...value, items: [{ ...value.items[0], routerAddress: address(99) }] }), error: "Invalid Robinhood launch" },
    { reason: "a malformed token address", change: (value) => ({ ...value, items: [{ ...value.items[0], tokenAddress: "not-an-address" }] }), error: "Invalid Robinhood launch" },
    { reason: "an invalid stamp hash", change: (value) => ({ ...value, items: [{ ...value.items[0], stampHash: "0x123" }] }), error: "Invalid Robinhood launch" },
    { reason: "a launch after the cursor", change: (value) => ({ ...value, items: [launch(1, 300)] }), error: "Invalid Robinhood launch" },
    { reason: "a launch before Router deployment", change: (value) => ({ ...value, items: [launch(1, 99)] }), error: "Invalid Robinhood launch" },
    { reason: "rows without a completed cursor", change: (value) => ({ ...value, cursor: null, checkpoints: [] }), error: "Invalid Robinhood launch" },
    { reason: "a cursor above finalized", change: (value) => ({ ...value, cursor: point(300) }), error: "Invalid Robinhood checkpoint" },
    { reason: "a checkpoint above the cursor", change: (value) => ({ ...value, checkpoints: [point(300)] }), error: "Invalid Robinhood checkpoint" },
  ];

  it.each(invalid)("rejects $reason", ({ change, error }) => {
    expect(() => parseSnapshot(change(snapshot([launch(1, 150)])))).toThrow(error);
  });

  it.each(["launchId", "tokenAddress"] as const)("rejects duplicate %s values even with different casing", (field) => {
    const original = launch(0xabc, 150);
    const duplicate = launch(0xdef, 160, { [field]: original[field].toUpperCase() });

    expect(() => parseSnapshot(snapshot([original, duplicate]))).toThrow("Duplicate Robinhood launch");
  });
});
