/**
 * Prisma/Postgres persistence for the ByteBites Store, mapped to per-entity
 * relational tables (Customer, Wallet, Referral, Order, ItemState, CustomItem)
 * rather than a single JSON blob.
 *
 * The Store's `PersistenceAdapter` seam is synchronous while Prisma is async, so:
 *   - `init()` (awaited once at startup, before the Store is built) reads every
 *     table and reconstructs the in-memory `StoreSnapshot`.
 *   - `load()` synchronously returns that reconstructed snapshot.
 *   - `save()` synchronously updates the cache and enqueues an async
 *     write-through on a serialized chain. Because the Store always emits the
 *     complete snapshot, each write replaces the table contents inside a single
 *     transaction (data volumes are tiny for the festival demo). Failures are
 *     logged, not thrown, so a transient DB blip never fails a request.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import {
  emptySnapshot,
  type PersistenceAdapter,
  type StoreSnapshot,
} from "./persistence.js";
import type { OrderRepo } from "./order-repo.js";
import type {
  CartItem,
  FoodItem,
  Order,
  OrderStatus,
  PaymentMethod,
  SpinReward,
} from "../../types/index.js";

export class PrismaPersistence implements PersistenceAdapter {
  private readonly prisma: PrismaClient;
  private latest: StoreSnapshot | null = null;
  /** Serializes write-through transactions so the last write always wins. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma ?? new PrismaClient();
  }

  /**
   * Read every table and reconstruct the snapshot into the in-memory cache.
   * Must be awaited before the Store is constructed so the synchronous
   * `load()` can return the restored state.
   */
  async init(): Promise<void> {
    // NB: orders are intentionally NOT loaded into the snapshot. They are owned
    // by `PrismaOrderRepo`, which reads/writes the Order table directly per
    // request so orders stay consistent across concurrent serverless instances.
    const [customers, wallets, referrals, itemStates] = await Promise.all([
      this.prisma.customer.findMany(),
      this.prisma.wallet.findMany(),
      this.prisma.referral.findMany(),
      this.prisma.itemState.findMany(),
    ]);

    const snapshot: StoreSnapshot = {
      ...emptySnapshot(),
      customers: customers.map((c) => ({
        mobile: c.mobile,
        name: c.name,
        ...(c.email ? { email: c.email } : {}),
      })),
      wallets: wallets.map((w) => ({
        customerId: w.customerId,
        foodCoins: w.foodCoins,
      })),
      referrals: referrals.map((r) => ({
        customerId: r.customerId,
        link: r.link,
        creditedReferredIds: r.creditedReferredIds,
      })),
      // orders omitted on purpose — see note above (owned by PrismaOrderRepo).
      itemQuantities: Object.fromEntries(
        itemStates.map((i) => [i.itemId, i.quantity])
      ),
      itemPrices: Object.fromEntries(
        itemStates.map((i) => [i.itemId, i.price])
      ),
      // Custom items live in the FoodItem catalogue table (loaded as the seed
      // catalogue at startup), so there is nothing to restore separately here.
    };

    this.latest = snapshot;
  }

  load(): StoreSnapshot | null {
    return this.latest;
  }

  save(snapshot: StoreSnapshot): void {
    this.latest = snapshot;
    this.writeChain = this.writeChain
      .then(() => this.persistAll(snapshot))
      .catch((err: unknown) => {
        console.error("Failed to persist state to Postgres:", err);
      });
  }

  /** Replace all table contents with the given snapshot in one transaction. */
  private async persistAll(s: StoreSnapshot): Promise<void> {
    const itemIds = new Set<string>([
      ...Object.keys(s.itemQuantities),
      ...Object.keys(s.itemPrices),
    ]);
    const itemStateData = Array.from(itemIds).map((itemId) => ({
      itemId,
      quantity: s.itemQuantities[itemId] ?? 0,
      price: s.itemPrices[itemId] ?? 0,
    }));

    await this.prisma.$transaction([
      // Clear everything first (no FK relations between these tables). The
      // Order table is deliberately excluded: orders are managed row-by-row by
      // PrismaOrderRepo, so a snapshot write must never touch (or clobber) them.
      this.prisma.customer.deleteMany(),
      this.prisma.wallet.deleteMany(),
      this.prisma.referral.deleteMany(),
      this.prisma.itemState.deleteMany(),
      // Recreate from the current snapshot.
      this.prisma.customer.createMany({
        data: s.customers.map((c) => ({
          mobile: c.mobile,
          name: c.name,
          email: c.email ?? null,
        })),
      }),
      this.prisma.wallet.createMany({
        data: s.wallets.map((w) => ({
          customerId: w.customerId,
          foodCoins: w.foodCoins,
        })),
      }),
      this.prisma.referral.createMany({
        data: s.referrals.map((r) => ({
          customerId: r.customerId,
          link: r.link,
          creditedReferredIds: r.creditedReferredIds,
        })),
      }),
      this.prisma.itemState.createMany({ data: itemStateData }),
      // Custom items are persisted into the FoodItem catalogue table itself, so
      // they are a first-class part of the catalogue on the next cold start.
      ...s.customItems.map((i) =>
        this.prisma.foodItem.upsert({
          where: { id: i.id },
          create: { ...i },
          update: { ...i },
        })
      ),
      // Deleted items (seeded or custom) are removed from the catalogue table
      // so the deletion survives a restart.
      ...(s.deletedItemIds.length > 0
        ? [
            this.prisma.foodItem.deleteMany({
              where: { id: { in: s.deletedItemIds } },
            }),
          ]
        : []),
    ]);
  }

  /**
   * Load the base food catalogue (seed items) from the `FoodItem` table.
   * Returns an empty array when the table has not been bootstrapped yet.
   */
  async loadFoodCatalog(): Promise<FoodItem[]> {
    const rows = await this.prisma.foodItem.findMany();
    return rows.map((r) => rowToFoodItem(r));
  }

  /** One-time bootstrap of the `FoodItem` catalogue from the built-in defaults. */
  async seedFoodCatalog(items: FoodItem[]): Promise<void> {
    if (items.length === 0) return;
    await this.prisma.foodItem.createMany({ data: items.map((i) => ({ ...i })) });
  }

  /**
   * Build an order repository that reads/writes the Order table directly using
   * this instance's Prisma client (shares the same connection/pool).
   */
  createOrderRepo(): OrderRepo {
    return new PrismaOrderRepo(this.prisma);
  }

  /** Flush any pending write and close the connection (graceful shutdown). */
  async disconnect(): Promise<void> {
    await this.writeChain;
    await this.prisma.$disconnect();
  }
}

/**
 * Direct, per-request Order table access. Unlike the snapshot persistence, this
 * upserts/reads individual rows so orders placed on one serverless instance are
 * immediately visible on another and are never clobbered by a snapshot write.
 */
export class PrismaOrderRepo implements OrderRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<Order[]> {
    const rows = await this.prisma.order.findMany();
    return rows.map((o) => rowToOrder(o));
  }

  async get(token: string): Promise<Order | undefined> {
    const row = await this.prisma.order.findUnique({ where: { token } });
    return row ? rowToOrder(row) : undefined;
  }

  async save(order: Order): Promise<void> {
    const data = orderToRow(order);
    await this.prisma.order.upsert({
      where: { token: order.token },
      create: data,
      update: data,
    });
  }

  async usedTokens(): Promise<Set<string>> {
    const rows = await this.prisma.order.findMany({ select: { token: true } });
    return new Set(rows.map((r) => r.token));
  }
}

// --- Row <-> domain mapping helpers ---------------------------------------

interface OrderRow {
  token: string;
  stallId: string;
  items: unknown;
  total: number;
  status: string;
  paid: boolean;
  paymentMethod: string;
  gatewayRef: string | null;
  customerId: string;
  createdAt: string;
  spinUsed: boolean;
  spinReward: string | null;
  pointsUsed: number | null;
  discount: number | null;
  deliveryType: string | null;
  deskLocation: string | null;
  floorNo: string | null;
}

function orderToRow(o: Order): Prisma.OrderCreateManyInput {
  return {
    token: o.token,
    stallId: o.stallId,
    items: o.items as unknown as Prisma.InputJsonValue,
    total: o.total,
    status: o.status,
    paid: o.paid,
    paymentMethod: o.paymentMethod,
    gatewayRef: o.gatewayRef ?? null,
    customerId: o.customerId,
    createdAt: o.createdAt,
    spinUsed: o.spinUsed,
    spinReward: o.spinReward ?? null,
    pointsUsed: o.pointsUsed ?? null,
    discount: o.discount ?? null,
    deliveryType: o.deliveryType ?? null,
    deskLocation: o.deskLocation ?? null,
    floorNo: o.floorNo ?? null,
  };
}

function rowToOrder(row: OrderRow): Order {
  return {
    token: row.token,
    stallId: row.stallId,
    items: (row.items as CartItem[]) ?? [],
    total: row.total,
    status: row.status as OrderStatus,
    paid: row.paid,
    paymentMethod: row.paymentMethod as PaymentMethod,
    ...(row.gatewayRef ? { gatewayRef: row.gatewayRef } : {}),
    customerId: row.customerId,
    createdAt: row.createdAt,
    spinUsed: row.spinUsed,
    ...(row.spinReward ? { spinReward: row.spinReward as SpinReward } : {}),
    ...(row.pointsUsed !== null ? { pointsUsed: row.pointsUsed } : {}),
    ...(row.discount !== null ? { discount: row.discount } : {}),
    ...(row.deliveryType
      ? { deliveryType: row.deliveryType as Order["deliveryType"] }
      : {}),
    ...(row.deskLocation ? { deskLocation: row.deskLocation } : {}),
    ...(row.floorNo ? { floorNo: row.floorNo } : {}),
  };
}

function rowToFoodItem(row: {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  rating: number;
  availableQuantity: number;
  price: number;
  stallId: string;
  spice: string;
  flavor: string;
  portion: string;
}): FoodItem {
  return {
    id: row.id,
    name: row.name,
    imageUrl: row.imageUrl,
    description: row.description,
    rating: row.rating,
    availableQuantity: row.availableQuantity,
    price: row.price,
    stallId: row.stallId,
    spice: row.spice as FoodItem["spice"],
    flavor: row.flavor as FoodItem["flavor"],
    portion: row.portion as FoodItem["portion"],
  };
}
