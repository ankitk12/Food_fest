/**
 * Prisma/Postgres persistence for the ByteBites Store.
 *
 * The Store persists a single serializable snapshot of its mutable runtime
 * state. This adapter stores that snapshot as one JSON-backed row in Postgres
 * (the `Snapshot` model), so the switch from a JSON file to Postgres keeps the
 * exact same snapshot semantics.
 *
 * Bridging sync ↔ async: the `PersistenceAdapter` interface the Store uses is
 * synchronous (`load()` / `save()`), while Prisma is async. This adapter
 * resolves that by:
 *   - `init()` (called once at startup, before the Store is constructed) loads
 *     the snapshot into an in-memory cache.
 *   - `load()` synchronously returns that cached snapshot.
 *   - `save()` synchronously updates the cache and enqueues an async upsert on a
 *     serialized write chain, so overlapping mutations never race or lose the
 *     last write. Write failures are logged, not thrown, so a transient DB blip
 *     never crashes a request (the in-memory Store remains authoritative).
 */

import { PrismaClient } from "@prisma/client";
import {
  emptySnapshot,
  type PersistenceAdapter,
  type StoreSnapshot,
} from "./persistence.js";

/** The fixed primary key of the single snapshot row. */
const SNAPSHOT_ID = "singleton";

export class PrismaPersistence implements PersistenceAdapter {
  private readonly prisma: PrismaClient;
  private latest: StoreSnapshot | null = null;
  /** Serializes write-through upserts so the last write always wins. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? new PrismaClient();
  }

  /**
   * Connect and load the persisted snapshot into the in-memory cache. Must be
   * awaited before constructing the Store so the synchronous `load()` can
   * return the restored state. Missing/partial rows merge onto an empty
   * snapshot so older shapes still load cleanly.
   */
  async init(): Promise<void> {
    const row = await this.prisma.snapshot.findUnique({
      where: { id: SNAPSHOT_ID },
    });
    if (row && row.data) {
      this.latest = {
        ...emptySnapshot(),
        ...(row.data as Partial<StoreSnapshot>),
      } as StoreSnapshot;
    }
  }

  load(): StoreSnapshot | null {
    return this.latest;
  }

  save(snapshot: StoreSnapshot): void {
    this.latest = snapshot;
    // Prisma's Json input type; the snapshot is plain JSON-serializable data.
    const data = snapshot as unknown as object;
    this.writeChain = this.writeChain
      .then(() =>
        this.prisma.snapshot
          .upsert({
            where: { id: SNAPSHOT_ID },
            create: { id: SNAPSHOT_ID, data },
            update: { data },
          })
          .then(() => undefined)
      )
      .catch((err: unknown) => {
        console.error("Failed to persist snapshot to Postgres:", err);
      });
  }

  /** Flush any pending write and close the connection (graceful shutdown). */
  async disconnect(): Promise<void> {
    await this.writeChain;
    await this.prisma.$disconnect();
  }
}
