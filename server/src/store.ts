/**
 * In-memory Store for ByteBites.
 *
 * The festival demo intentionally avoids an external database. This module
 * provides a single in-memory store, seeded with a handful of stalls and a set
 * of food items across those stalls, plus accessors/mutators for stalls,
 * menus (items by stall), orders, wallets, and referrals.
 *
 * A deterministic `reset()` restores the seed state so tests and demo runs
 * always start from the same known snapshot.
 *
 * Server-authoritative design: the store holds the canonical order, wallet,
 * referral, and customer state; the client only renders what the server
 * exposes.
 *
 * Persistence: the Store can optionally write its mutable runtime state
 * (orders, wallets, referrals, customers, and item stock) through a
 * `PersistenceAdapter` on every mutation and reload it on construction, so data
 * survives a server restart. The default (used by tests) is no persistence
 * (in-memory only); the production `store` singleton persists to a JSON file.
 *
 * Validates: Requirements 4.1, 4.2
 */

import type {
  CartItem,
  Combo,
  Coupon,
  Customer,
  FoodItem,
  Metrics,
  Order,
  OrderStatus,
  Stall,
  Wallet,
} from "../../types/index.js";
import {
  JsonFilePersistence,
  NoopPersistence,
  type PersistenceAdapter,
  type StoreSnapshot,
} from "./persistence.js";

// --- Seed data -------------------------------------------------------------

/**
 * Build a fresh copy of the seed stalls. A factory (rather than a shared
 * constant) guarantees every reset produces independent objects that later
 * mutations cannot leak back into the seed definition.
 */
export function seedStalls(): Stall[] {
  return [
    { id: "stall-tandoori", name: "Tandoori Tech", qrSlug: "tandoori-tech" },
    { id: "stall-wok", name: "Wok & Roll", qrSlug: "wok-and-roll" },
    { id: "stall-sweet", name: "Sweet Bytes", qrSlug: "sweet-bytes" },
  ];
}

/** Build a fresh copy of default seed coupons. */
export function seedCoupons(): Coupon[] {
  return [
  ];
}

/**
 * Build a fresh copy of the seed food items.
 *
 * The catalogue no longer ships with any static/demo items: it starts empty and
 * is populated entirely at runtime by the admin (via the "Add New Item" flow in
 * Stock Management), with those items persisted in full so they survive a
 * restart.
 */
export function seedFoodItems(): FoodItem[] {
  return [];
}

// --- Deep-copy helper ------------------------------------------------------

/**
 * Structured deep clone used when seeding and when returning collections, so
 * callers cannot mutate the store's internal state by reference. Falls back to
 * JSON round-tripping when `structuredClone` is unavailable.
 */
function deepClone<T>(value: T): T {
  const sc = (globalThis as { structuredClone?: <U>(v: U) => U })
    .structuredClone;
  if (typeof sc === "function") return sc(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

// --- Store -----------------------------------------------------------------

/**
 * Optional seed override for constructing a Store with a custom set of stalls
 * and/or food items. Used by tests (e.g. property-based menu isolation tests)
 * that need to drive the store from generated data rather than the fixed demo
 * seed. When a field is omitted, the default demo seed for that collection is
 * used. `reset()` restores whichever seed the Store was constructed with, so
 * the default demo behavior is preserved for callers that pass no override.
 */
export interface StoreSeed {
  stalls?: Stall[];
  foodItems?: FoodItem[];
}

/**
 * Options controlling how a Store persists its mutable runtime state.
 *
 *   - Omit both fields (the test/default) → no persistence (in-memory only).
 *   - `{ persist: true, dataFile }` → JSON-file persistence at `dataFile`.
 *   - `{ persistence }` → an injected adapter (advanced/testing).
 *
 * Tests should leave persistence off (the default) so they never write to or
 * depend on a real shared file; the production `store` singleton opts in.
 */
export interface StoreOptions {
  /** When true, persist to a JSON file (see `dataFile`). Defaults to false. */
  persist?: boolean;
  /** JSON file path used when `persist` is true. */
  dataFile?: string;
  /** An explicit persistence adapter, overriding `persist`/`dataFile`. */
  persistence?: PersistenceAdapter;
}

/** Default JSON data-file path; overridable via `BYTEBITES_DATA_FILE`. */
export const DEFAULT_DATA_FILE = "server/data/bytebites-db.json";

/** Resolve a persistence adapter from the given options. */
function resolvePersistence(options: StoreOptions): PersistenceAdapter {
  if (options.persistence) return options.persistence;
  if (options.persist) {
    return new JsonFilePersistence(options.dataFile ?? DEFAULT_DATA_FILE);
  }
  return new NoopPersistence();
}

export class Store {
  private stalls: Map<string, Stall> = new Map();
  private foodItems: Map<string, FoodItem> = new Map();
  private orders: Map<string, Order> = new Map();
  private wallets: Map<string, Wallet> = new Map();
  private customers: Map<string, Customer> = new Map();
  private coupons: Map<string, Coupon> = new Map();
  private combos: Map<string, Combo> = new Map();

  /**
   * Ids of food items created at runtime (not part of the seed catalogue), so
   * they can be persisted in full and re-added after a reload. Cleared by
   * `reset()` along with the rest of the runtime state.
   */
  private customItemIds: Set<string> = new Set();

  /**
   * Ids of food items the admin has deleted at runtime. Tracked so a deletion
   * of a seeded item is re-applied after the seed catalogue is re-created on
   * reload, keeping deletions durable. Cleared by `reset()`.
   */
  private deletedItemIds: Set<string> = new Set();

  /** The seed this store was constructed with; `reset()` restores to it. */
  private readonly seed: StoreSeed | undefined;

  /** Where mutable runtime state is written through / loaded from. */
  private readonly persistence: PersistenceAdapter;

  /**
   * When true, mutations are NOT written through — used internally while
   * hydrating from a loaded snapshot so restoring state does not re-persist
   * (and does not recurse) during construction.
   */
  private hydrating = false;

  constructor(seed?: StoreSeed, options: StoreOptions = {}) {
    this.seed = seed;
    this.persistence = resolvePersistence(options);
    this.reset();
    // After seeding the catalogue, restore any previously persisted runtime
    // state so data survives a restart.
    this.hydrate();
  }

  /**
   * Load persisted runtime state (if any) on top of the freshly seeded
   * catalogue. Applied with write-through suppressed so hydration itself does
   * not re-persist. Safe when persistence is a no-op (nothing to load).
   */
  private hydrate(): void {
    const snapshot = this.persistence.load();
    if (!snapshot) return;
    this.hydrating = true;
    try {
      // Re-add any runtime-created items BEFORE applying stock/price overrides
      // so those overrides can target custom items too.
      for (const item of snapshot.customItems ?? []) {
        this.foodItems.set(item.id, deepClone(item));
        this.customItemIds.add(item.id);
      }
      // Re-apply deletions on top of the freshly seeded catalogue so a deleted
      // item (seeded or custom) stays gone after a restart.
      for (const deletedId of snapshot.deletedItemIds ?? []) {
        this.foodItems.delete(deletedId);
        this.customItemIds.delete(deletedId);
        this.deletedItemIds.add(deletedId);
      }
      for (const order of snapshot.orders) this.orders.set(order.token, order);
      for (const wallet of snapshot.wallets) {
        this.wallets.set(wallet.customerId, wallet);
      }
      for (const customer of snapshot.customers) {
        this.customers.set(customer.mobile, customer);
      }
      // Restore persisted coupons (overwriting the seed defaults so admin
      // additions / deletions survive a restart).
      for (const coupon of snapshot.coupons ?? []) {
        this.coupons.set(coupon.code, coupon);
      }
      // Restore persisted combos created by the admin.
      for (const combo of snapshot.combos ?? []) {
        this.combos.set(combo.id, combo);
      }
      for (const [itemId, quantity] of Object.entries(
        snapshot.itemQuantities
      )) {
        this.setAvailableQuantity(itemId, quantity);
      }
      for (const [itemId, price] of Object.entries(
        snapshot.itemPrices ?? {}
      )) {
        this.setPrice(itemId, price);
      }
    } finally {
      this.hydrating = false;
    }
  }

  /**
   * Build a serializable snapshot of the current mutable runtime state and
   * write it through the persistence adapter. A no-op while hydrating.
   */
  private persist(): void {
    if (this.hydrating) return;
    const snapshot: StoreSnapshot = {
      orders: this.getOrders(),
      wallets: Array.from(this.wallets.values()).map((w) => deepClone(w)),
      customers: this.getCustomers(),
      coupons: Array.from(this.coupons.values()).map((c) => deepClone(c)),
      combos: Array.from(this.combos.values()).map((c) => deepClone(c)),
      itemQuantities: Object.fromEntries(
        Array.from(this.foodItems.values()).map((i) => [
          i.id,
          i.availableQuantity,
        ])
      ),
      itemPrices: Object.fromEntries(
        Array.from(this.foodItems.values()).map((i) => [i.id, i.price])
      ),
      customItems: Array.from(this.customItemIds)
        .map((id) => this.foodItems.get(id))
        .filter((i): i is FoodItem => i !== undefined)
        .map((i) => deepClone(i)),
      deletedItemIds: Array.from(this.deletedItemIds),
    };
    this.persistence.save(snapshot);
  }

  /**
   * Await any pending write-through so the most recent mutation is durably
   * committed before returning. A no-op for synchronous backends (JSON file,
   * no-op) which are already durable on return.
   */
  async flush(): Promise<void> {
    await this.persistence.flush?.();
  }

  /**
   * Restore the deterministic seed state. Clears all runtime state (orders,
   * wallets, and any mutations to stalls/items) and repopulates
   * stalls and food items from the seed. When constructed without an override
   * the default demo seed factories are used; when constructed with a custom
   * `StoreSeed`, that snapshot is restored instead. Safe to call between demo
   * runs and before each test.
   */
  reset(): void {
    this.stalls.clear();
    this.foodItems.clear();
    this.orders.clear();
    this.wallets.clear();
    this.customers.clear();
    this.coupons.clear();
    this.combos.clear();
    this.customItemIds.clear();
    this.deletedItemIds.clear();

    const stalls = this.seed?.stalls ?? seedStalls();
    const foodItems = this.seed?.foodItems ?? seedFoodItems();
    const coupons = seedCoupons();

    for (const stall of stalls) {
      this.stalls.set(stall.id, deepClone(stall));
    }
    for (const item of foodItems) {
      this.foodItems.set(item.id, deepClone(item));
    }
    for (const coupon of coupons) {
      this.coupons.set(coupon.code, deepClone(coupon));
    }
  }

  // --- Stalls --------------------------------------------------------------

  /** All stalls (defensive copies). */
  getStalls(): Stall[] {
    return Array.from(this.stalls.values()).map((s) => deepClone(s));
  }

  /** A single stall by id, or undefined when unknown. */
  getStall(stallId: string): Stall | undefined {
    const stall = this.stalls.get(stallId);
    return stall ? deepClone(stall) : undefined;
  }

  /** True when a stall with the given id exists. */
  hasStall(stallId: string): boolean {
    return this.stalls.has(stallId);
  }

  // --- Menus (food items) --------------------------------------------------

  /** All food items across all stalls (defensive copies). */
  getFoodItems(): FoodItem[] {
    return Array.from(this.foodItems.values()).map((i) => deepClone(i));
  }

  /** A single food item by id, or undefined when unknown. */
  getFoodItem(itemId: string): FoodItem | undefined {
    const item = this.foodItems.get(itemId);
    return item ? deepClone(item) : undefined;
  }

  /**
   * The menu for a given stall: only the items whose `stallId` matches
   * (Requirement 4.1). Returns an empty array for an unknown stall; callers
   * that need a not-found distinction should check `hasStall` first.
   */
  getMenu(stallId: string): FoodItem[] {
    return Array.from(this.foodItems.values())
      .filter((item) => item.stallId === stallId)
      .map((item) => deepClone(item));
  }

  /** Insert or replace a food item. */
  upsertFoodItem(item: FoodItem): void {
    this.foodItems.set(item.id, deepClone(item));
  }

  /**
   * Create a brand-new food item at runtime (an admin "add item" action) and
   * register it as a custom item so it is persisted in full and survives a
   * restart. A unique id is derived from the item name (slugified) with a short
   * suffix appended when needed to avoid collisions with existing ids. Returns
   * the stored item (a defensive copy).
   */
  createFoodItem(input: Omit<FoodItem, "id">): FoodItem {
    const id = this.generateItemId(input.name);
    const item: FoodItem = { ...input, id };
    this.foodItems.set(id, deepClone(item));
    this.customItemIds.add(id);
    // A newly created item is live again; clear any prior deletion for this id.
    this.deletedItemIds.delete(id);
    this.persist();
    return deepClone(item);
  }

  /**
   * Delete a food item at runtime (an admin "delete item" action). Removes it
   * from the live catalogue and records the deletion so it stays gone after a
   * restart, even for seeded items (which are otherwise re-created on reload).
   * Returns true when an item was removed, false when the id was unknown.
   */
  deleteFoodItem(itemId: string): boolean {
    const existed = this.foodItems.delete(itemId);
    if (!existed) return false;
    this.customItemIds.delete(itemId);
    this.deletedItemIds.add(itemId);
    this.persist();
    return true;
  }

  /**
   * Update an existing food item's editable fields (an admin "edit item"
   * action). Only the provided fields are changed; `id` is never altered. The
   * price is floored at 0.01 and the available quantity at 0 (and floored to an
   * integer) to keep them valid. The edited record is persisted in full (via
   * the same mechanism as runtime-created items) so it survives a restart,
   * overriding the seed on reload. Returns the updated item, or `undefined`
   * when the item is unknown.
   */
  updateFoodItem(
    itemId: string,
    patch: Partial<Omit<FoodItem, "id">>
  ): FoodItem | undefined {
    const existing = this.foodItems.get(itemId);
    if (!existing) return undefined;

    const updated: FoodItem = { ...existing, ...patch, id: existing.id };
    updated.price = Math.max(0.01, updated.price);
    updated.availableQuantity = Math.max(0, Math.floor(updated.availableQuantity));

    this.foodItems.set(itemId, deepClone(updated));
    // Persist the full edited record so non-stock/price edits (name, image,
    // attributes, …) also survive a restart. Reusing the custom-item channel
    // means the edited record is re-applied on top of the seed during hydrate.
    this.customItemIds.add(itemId);
    this.persist();
    return deepClone(updated);
  }

  /** Derive a unique `item-<slug>` id from a name, disambiguating collisions. */
  private generateItemId(name: string): string {
    const slug =
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "item";
    let candidate = `item-${slug}`;
    let n = 2;
    while (this.foodItems.has(candidate)) {
      candidate = `item-${slug}-${n}`;
      n += 1;
    }
    return candidate;
  }

  /**
   * Set the available quantity of an item (e.g. after a purchase). No-op when
   * the item is unknown; the clamped-to-zero floor prevents negative stock.
   */
  setAvailableQuantity(itemId: string, quantity: number): void {
    const item = this.foodItems.get(itemId);
    if (!item) return;
    item.availableQuantity = Math.max(0, Math.floor(quantity));
    this.persist();
  }

  /**
   * Set the price (INR) of an item (e.g. an admin price change). No-op when
   * the item is unknown; the price is floored at 0.01 rupee so it stays a
   * positive amount. The change is persisted so it survives a restart.
   */
  setPrice(itemId: string, price: number): void {
    const item = this.foodItems.get(itemId);
    if (!item) return;
    item.price = Math.max(0.01, price);
    this.persist();
  }

  // --- Orders --------------------------------------------------------------

  /** All orders (defensive copies). */
  getOrders(): Order[] {
    return Array.from(this.orders.values()).map((o) => deepClone(o));
  }

  /** A single order by its token, or undefined when unknown. */
  getOrder(token: string): Order | undefined {
    const order = this.orders.get(token);
    return order ? deepClone(order) : undefined;
  }

  /** The set of order tokens already in use (for unique token issuance). */
  getOrderTokens(): Set<string> {
    return new Set(this.orders.keys());
  }

  /** Insert or replace an order keyed by its token. */
  saveOrder(order: Order): void {
    this.orders.set(order.token, deepClone(order));
    this.persist();
  }

  // --- Wallets -------------------------------------------------------------

  /**
   * The wallet for a customer, creating a zero-balance wallet on first access
   * so callers always receive a concrete wallet to read or credit.
   */
  getWallet(customerId: string): Wallet {
    let wallet = this.wallets.get(customerId);
    if (!wallet) {
      wallet = { customerId, foodCoins: 0 };
      this.wallets.set(customerId, wallet);
    }
    return deepClone(wallet);
  }

  /** Insert or replace a wallet keyed by its customerId. */
  saveWallet(wallet: Wallet): void {
    this.wallets.set(wallet.customerId, deepClone(wallet));
    this.persist();
  }

  // --- Customers -----------------------------------------------------------

  /**
   * The customer record for a normalized mobile number, or undefined when no
   * customer has registered under it yet. Callers should pass an already
   * normalized mobile (the canonical customer id).
   */
  getCustomer(mobile: string): Customer | undefined {
    const customer = this.customers.get(mobile);
    return customer ? deepClone(customer) : undefined;
  }

  /** All customer records (defensive copies). */
  getCustomers(): Customer[] {
    return Array.from(this.customers.values()).map((c) => deepClone(c));
  }

  /** Insert or replace a customer keyed by its normalized mobile number. */
  saveCustomer(customer: Customer): void {
    this.customers.set(customer.mobile, deepClone(customer));
    this.persist();
  }

  // --- Coupons --------------------------------------------------------------

  /** All coupons (defensive copies). */
  getCoupons(): Coupon[] {
    return Array.from(this.coupons.values()).map((c) => deepClone(c));
  }

  /** A single coupon by code (case-insensitive), or undefined when unknown. */
  getCoupon(code: string): Coupon | undefined {
    const coupon = this.coupons.get(code.toUpperCase());
    return coupon ? deepClone(coupon) : undefined;
  }

  /** Insert or replace a coupon. Code is normalized to upper-case. */
  saveCoupon(coupon: Coupon): void {
    this.coupons.set(coupon.code.toUpperCase(), deepClone({ ...coupon, code: coupon.code.toUpperCase() }));
    this.persist();
  }

  /** Remove a coupon by code. No-op when unknown. */
  deleteCoupon(code: string): void {
    this.coupons.delete(code.toUpperCase());
    this.persist();
  }

  // --- Combos ---------------------------------------------------------------

  /** All combos (defensive copies). */
  getCombos(): Combo[] {
    return Array.from(this.combos.values()).map((c) => deepClone(c));
  }

  /** A single combo by id, or undefined when unknown. */
  getCombo(id: string): Combo | undefined {
    const combo = this.combos.get(id);
    return combo ? deepClone(combo) : undefined;
  }

  /** Insert or replace a combo. */
  saveCombo(combo: Combo): void {
    this.combos.set(combo.id, deepClone(combo));
    this.persist();
  }

  /** Remove a combo by id. No-op when unknown. */
  deleteCombo(id: string): void {
    this.combos.delete(id);
    this.persist();
  }
}

/**
 * A shared singleton store instance for the running server. It persists its
 * mutable runtime state (orders, wallets, referrals, customers, item stock) to
 * a JSON file so data survives a restart; the file path defaults to
 * `server/data/bytebites-db.json` and is overridable via the
 * `BYTEBITES_DATA_FILE` environment variable.
 *
 * Tests should construct their own in-memory `new Store()` (persistence off by
 * default) for isolation rather than relying on this shared, file-backed
 * instance.
 */
export const store = new Store(undefined, {
  persist: true,
  dataFile: process.env.BYTEBITES_DATA_FILE ?? DEFAULT_DATA_FILE,
});
