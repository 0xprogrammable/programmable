import type { RobinhoodLaunch, RobinhoodModuleLaunch } from "@/lib/robinhood-launches";
import { parseSnapshot, parseModuleModeSnapshot, type Checkpoint, type RobinhoodSnapshot, type ModuleModeSnapshot } from "./model";
import type { IndexStore } from "./store";

export type IndexSource = {
  routerAddress: string;
  binding: string;
  startBlock: bigint;
  finalized: Checkpoint;
  block(number: bigint): Promise<Checkpoint>;
  launches(from: bigint, to: bigint, known: readonly RobinhoodLaunch[]): Promise<RobinhoodLaunch[]>;
};

export type ModuleModeIndexSource = Omit<IndexSource, "routerAddress" | "binding" | "launches"> & {
  sourceKind: "module-native-v1";
  sourceAddress: string;
  releaseDigest: string;
  launches(from: bigint, to: bigint, known: readonly RobinhoodLaunch[]): Promise<RobinhoodModuleLaunch[]>;
};
type SyncOptions = { rangeSize?: bigint; maxRanges?: number; budgetMs?: number; now?: () => number };
type RangeSnapshot = Pick<RobinhoodSnapshot, "cursor" | "checkpoints" | "pending" | "finalizedBlock" | "updatedAt" | "items">;
type RangeStore = {
  read(): Promise<{ snapshot: RangeSnapshot; etag: string } | null>;
  write(snapshot: RangeSnapshot, etag: string | null): Promise<void>;
};

export class IndexRangeTooWide extends Error {}
export class IndexBlockIncomplete extends Error {
  constructor(readonly items: RobinhoodLaunch[]) { super("Block verification continues on next pass"); }
}

function mergeVerifiedLaunches(known: RobinhoodLaunch[], discovered: RobinhoodLaunch[]) {
  const byLaunchId = new Map<string, RobinhoodLaunch>();
  for (const row of [...known, ...discovered]) {
    const existing = byLaunchId.get(row.launchId.toLowerCase());
    if (existing && (existing.blockHash.toLowerCase() !== row.blockHash.toLowerCase()
      || existing.blockNumber !== row.blockNumber || existing.logIndex !== row.logIndex)) {
      throw new Error("Launch location changed without a reorg");
    }
    byLaunchId.set(row.launchId.toLowerCase(), row);
  }
  return [...byLaunchId.values()];
}

// Only the background job uses the source. A failed range is retried from its
// beginning; neither an RPC error nor partial verification advances the cursor.
export async function syncRobinhoodIndex(source: IndexSource, store: IndexStore, options: SyncOptions = {}) {
  const saved = await store.read();
  const initial: RobinhoodSnapshot = saved?.snapshot ?? {
    version: 1, chainId: 4663, routerAddress: source.routerAddress, binding: source.binding,
    startBlock: source.startBlock.toString(), cursor: null, checkpoints: [],
    finalizedBlock: source.finalized.number, updatedAt: new Date((options.now ?? Date.now)()).toISOString(), items: [],
  };
  if (initial.binding !== source.binding || initial.routerAddress.toLowerCase() !== source.routerAddress.toLowerCase()
    || initial.startBlock !== source.startBlock.toString()) throw new Error("Canonical Router changed; index migration required");
  return syncRange(source, { read: async () => saved, write: (snapshot, etag) => store.write(parseSnapshot(snapshot), etag) },
    initial, parseSnapshot, options);
}

/** Each source advances independently, while the shared Blob write remains atomic and version-fenced. */
export async function syncModuleModeIndex(source: ModuleModeIndexSource, store: IndexStore, options: SyncOptions = {}) {
  const saved = await store.read();
  // Existing canonical Custom provenance initializes the shared envelope; never manufacture a Router binding.
  if (!saved) throw new Error("Canonical Robinhood index must be initialized before adding Module Mode");
  parseSnapshot(saved.snapshot);
  const initial: ModuleModeSnapshot = saved.snapshot.moduleMode ?? {
    version: 1, sourceKind: "module-native-v1", chainId: 4663, sourceAddress: source.sourceAddress,
    releaseDigest: source.releaseDigest, startBlock: source.startBlock.toString(), cursor: null, checkpoints: [],
    finalizedBlock: source.finalized.number, updatedAt: new Date((options.now ?? Date.now)()).toISOString(), items: [],
  };
  if (source.sourceKind !== "module-native-v1" || initial.sourceAddress.toLowerCase() !== source.sourceAddress.toLowerCase()
    || initial.releaseDigest.toLowerCase() !== source.releaseDigest.toLowerCase()
    || initial.startBlock !== source.startBlock.toString()) throw new Error("Module Mode source changed; index migration required");
  return syncRange(source, {
    read: async () => ({ snapshot: initial, etag: saved.etag }),
    write: async (snapshot, etag) => {
      const merged = parseSnapshot({ ...saved.snapshot, moduleMode: parseModuleModeSnapshot(snapshot) });
      await store.write(merged, etag);
    },
  }, initial, parseModuleModeSnapshot, options);
}

async function syncRange(source: Pick<IndexSource, "startBlock" | "finalized" | "block" | "launches">,
  store: RangeStore, initial: RangeSnapshot, parse: (value: unknown) => RangeSnapshot, options: SyncOptions) {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.budgetMs ?? 45_000);
  const saved = await store.read();
  let snapshot = saved?.snapshot ?? initial;
  const boundary = BigInt(source.finalized.number);
  let rewound = false;
  let progress = false;
  if (snapshot.cursor) {
    const canonical = BigInt(snapshot.cursor.number) <= boundary
      ? await source.block(BigInt(snapshot.cursor.number)) : null;
    if (!canonical || canonical.hash.toLowerCase() !== snapshot.cursor.hash.toLowerCase()) {
      let ancestor: Checkpoint | null = null;
      for (const point of snapshot.checkpoints.toReversed()) {
        if (BigInt(point.number) > boundary) continue;
        if ((await source.block(BigInt(point.number))).hash.toLowerCase() === point.hash.toLowerCase()) {
          ancestor = point;
          break;
        }
      }
      snapshot = { ...snapshot, cursor: ancestor, pending: null,
        checkpoints: snapshot.checkpoints.filter((point) => ancestor && BigInt(point.number) <= BigInt(ancestor.number)),
        items: snapshot.items.filter((row) => ancestor && BigInt(row.blockNumber) <= BigInt(ancestor.number)),
      };
      rewound = true;
    }
  }
  let rangeSize = options.rangeSize ?? 10_000n;
  if (rangeSize < 1n) throw new Error("Invalid range size");
  // Re-read up to 64 blocks, without moving a cursor backwards when an operator
  // uses smaller RPC ranges.
  const overlap = rangeSize - 1n < 63n ? rangeSize - 1n : 63n;
  let from = snapshot.cursor ? BigInt(snapshot.cursor.number) - overlap : source.startBlock;
  if (from < source.startBlock) from = source.startBlock;
  if (snapshot.pending) {
    if (BigInt(snapshot.pending.block.number) > boundary
      || (await source.block(BigInt(snapshot.pending.block.number))).hash !== snapshot.pending.block.hash) {
      snapshot = { ...snapshot, pending: null };
      progress = true;
    } else from = BigInt(snapshot.pending.block.number);
  }
  let ranges = 0;
  let failed = false;
  let reductions = 0;
  while (from <= boundary && ranges < (options.maxRanges ?? 48) && now() < deadline) {
    const to = snapshot.pending ? from : from + rangeSize - 1n < boundary ? from + rangeSize - 1n : boundary;
    try {
      const end = await source.block(to);
      const rows = await source.launches(from, to, [...snapshot.items, ...(snapshot.pending?.items ?? [])]);
      if ((await source.block(to)).hash.toLowerCase() !== end.hash.toLowerCase()) throw new Error("Range changed");
      // Previously verified rows are removed only by the explicit reorg rewind.
      // An incomplete-but-successful overlap response cannot erase their origin.
      const accepted = [...snapshot.items, ...(snapshot.pending?.items ?? [])];
      const items = mergeVerifiedLaunches(accepted, rows);
      const cursor = snapshot.cursor && BigInt(snapshot.cursor.number) > to ? snapshot.cursor : end;
      snapshot = parse({ ...snapshot, cursor, pending: null,
        finalizedBlock: source.finalized.number,
        checkpoints: [...snapshot.checkpoints.filter((point) => point.number !== end.number), end]
          .sort((a, b) => BigInt(a.number) < BigInt(b.number) ? -1 : 1).slice(-16),
        updatedAt: new Date(now()).toISOString(), items,
      });
      ranges += 1;
      from = to + 1n;
    } catch (error) {
      if (error instanceof IndexBlockIncomplete && from === to) {
        const end = await source.block(to);
        const items = mergeVerifiedLaunches(snapshot.pending?.items ?? [], error.items);
        snapshot = parse({ ...snapshot, finalizedBlock: source.finalized.number,
          pending: { block: end, items }, updatedAt: new Date(now()).toISOString() });
        progress = true;
        break;
      }
      if (error instanceof IndexRangeTooWide && to > from && reductions < 16) {
        rangeSize = (to - from + 1n) / 2n;
        // The old cursor's canonical hash was already checked. If replay itself
        // consumes the provider budget, resume there instead of replaying the
        // same earlier overlap forever; every new block is still scanned.
        if (snapshot.cursor && from + rangeSize - 1n < BigInt(snapshot.cursor.number)) {
          from = BigInt(snapshot.cursor.number);
        }
        reductions += 1;
        continue;
      }
      failed = true;
      break;
    }
  }
  if ((await source.block(boundary)).hash.toLowerCase() !== source.finalized.hash.toLowerCase()) {
    throw new Error("Finalized boundary changed");
  }
  if (ranges > 0 || rewound || progress) {
    // Compare-and-swap: a concurrent job must not overwrite a newer checkpoint.
    await store.write(snapshot, saved?.etag ?? null);
  }
  return { status: failed ? "partial" : !snapshot.pending && snapshot.cursor?.number === source.finalized.number ? "ready" : "syncing",
    ranges, launches: snapshot.items.length, indexedThrough: snapshot.cursor?.number ?? null,
    finalizedBlock: source.finalized.number, rewound };
}
