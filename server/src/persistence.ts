/**
 * JSON-file persistence for the ByteBites Store.
 *
 * The festival demo keeps its canonical state in an in-memory `Store`, but for
 * a production-like deployment that state must survive a server restart. This
 * module provides a small persistence seam:
 *
 *   - `PersistenceAdapter` — the interface the `Store` writes through on every
 *     mutation and loads from on construction.
 *   - `JsonFilePersistence` — a synchronous JSON-file implementation. Sync fs
 *     writes keep the behaviour simple and deterministic and guarantee the last
 *     write is never lost (each mutation flushes the full snapshot to disk).
 *   - `NoopPersistence` — an in-memory no-op used by tests so they never touch
 *     (or depend on) a real shared file.
 *
 * Only the mutable runtime state is persisted (orders, wallets, referrals,
 * customers, and item stock levels); the stall/item catalogue is re-seeded from
 * the seed factories on construction.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Combo,
  Coupon,
  Customer,
  FoodItem,
  Order,
  Wallet,
} from "../../types/index.js";

/**
 * The serializable snapshot of the Store's mutable runtime state. Item stock
 * overrides are keyed by itemId so re-seeded items can have their quantities
 * restored after a reload.
 */
export interface StoreSnapshot {
  orders: Order[];
  wallets: Wallet[];
  customers: Customer[];
  coupons?: Coupon[];
  /** Combo bundles created by the admin (clubbed items sold at a set price). */
  combos?: Combo[];
  /** Overridden available quantities keyed by itemId (post-seed mutations). */
  itemQuantities: Record<string, number>;
  /** Overridden prices (INR) keyed by itemId (post-seed admin edits). */
  itemPrices: Record<string, number>;
  /**
   * Food items created at runtime by the admin (not part of the fixed seed
   * catalogue). Persisted in full so they are re-added to the store on reload
   * and survive a server restart.
   */
  customItems: FoodItem[];
  /**
   * Ids of food items the admin has deleted. Persisted so a deletion of a
   * seeded item stays deleted across a restart (the seed catalogue is otherwise
   * re-created on every construction).
   */
  deletedItemIds: string[];
}

/** Build an empty snapshot. */
export function emptySnapshot(): StoreSnapshot {
  return {
    orders: [],
    wallets: [],
    customers: [],
    coupons: [],
    combos: [],
    itemQuantities: {},
    itemPrices: {},
    customItems: [],
    deletedItemIds: [],
  };
}

/**
 * The seam the Store uses to persist and restore its mutable state. `load`
 * returns the last-saved snapshot (or `null` when none exists); `save`
 * write-through persists the full snapshot.
 */
export interface PersistenceAdapter {
  load(): StoreSnapshot | null;
  save(snapshot: StoreSnapshot): void;
  /**
   * Await any pending asynchronous write so the latest `save` is durably
   * committed. Optional: synchronous adapters (JSON file, no-op) are already
   * durable on return and don't implement it.
   */
  flush?(): Promise<void>;
}

/**
 * A no-op persistence adapter for tests and ephemeral runs: nothing is written
 * to disk and `load` always reports "no prior state". This is the default so
 * that constructing a bare `new Store()` never touches a real file.
 */
export class NoopPersistence implements PersistenceAdapter {
  load(): StoreSnapshot | null {
    return null;
  }

  save(_snapshot: StoreSnapshot): void {
    // Intentionally does nothing.
  }
}

/**
 * A synchronous JSON-file persistence adapter. On `load` it reads and parses the
 * file when present; on `save` it writes the full snapshot as pretty-printed
 * JSON, creating the parent directory if needed. Synchronous writes keep the
 * last write durable without debounce/flush bookkeeping.
 */
export class JsonFilePersistence implements PersistenceAdapter {
  constructor(private readonly filePath: string) {}

  load(): StoreSnapshot | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const raw = readFileSync(this.filePath, "utf8");
      if (raw.trim().length === 0) return null;
      const parsed = JSON.parse(raw) as Partial<StoreSnapshot>;
      // Merge onto an empty snapshot so older/partial files still load cleanly.
      return { ...emptySnapshot(), ...parsed } as StoreSnapshot;
    } catch {
      // A corrupt/unreadable file must not crash startup; start from empty.
      return null;
    }
  }

  save(snapshot: StoreSnapshot): void {
    let lastError: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        mkdirSync(dirname(this.filePath), { recursive: true });
        writeFileSync(this.filePath, JSON.stringify(snapshot, null, 2), "utf8");
        return;
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
}

/**
 * Run an async function with up to maxAttempts retry operations (defaults to 3).
 */
export async function runWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: any;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

