/**
 * OrderRepo — the async data-access seam for orders.
 *
 * Orders are the one entity that must be strongly consistent across concurrent
 * (serverless) instances: a customer places an order on one instance and staff
 * read it on another. The in-memory Store + full-snapshot persistence can't
 * guarantee that (each cold-started instance has its own copy, and a snapshot
 * write replaces the whole Order table), so order routes go through this repo
 * instead.
 *
 *   - `StoreOrderRepo` — default, backed by the in-memory Store (dev, tests,
 *     and the JSON-file backend). Behaviour is unchanged from before.
 *   - `PrismaOrderRepo` (see prisma-persistence.ts) — reads/writes the Order
 *     table directly, per request, so orders are always live and never clobbered.
 */

import type { Order } from "../../types/index.js";
import type { Store } from "./store.js";

export interface OrderRepo {
  /** All orders (unordered; callers sort/filter as needed). */
  list(): Promise<Order[]>;
  /** A single order by token, or undefined when unknown. */
  get(token: string): Promise<Order | undefined>;
  /** Insert or replace an order (keyed by token). */
  save(order: Order): Promise<void>;
  /** The set of tokens already in use, for unique token issuance. */
  usedTokens(): Promise<Set<string>>;
}

/** Order repo backed by the in-memory Store (dev / tests / JSON backend). */
export class StoreOrderRepo implements OrderRepo {
  constructor(private readonly store: Store) { }

  async list(): Promise<Order[]> {
    return this.store.getOrders();
  }

  async get(token: string): Promise<Order | undefined> {
    return this.store.getOrder(token);
  }

  async save(order: Order): Promise<void> {
    this.store.saveOrder(order);
  }

  async usedTokens(): Promise<Set<string>> {
    return this.store.getOrderTokens();
  }
}
