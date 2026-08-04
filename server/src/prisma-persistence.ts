/**
 * Prisma/Postgres persistence for the ByteBites Store, mapped to per-entity
 * relational tables (Customer, Wallet, Order, ItemState, CustomItem)
 * rather than a single JSON blob.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import {
  emptySnapshot,
  type PersistenceAdapter,
  type StoreSnapshot,
} from "./persistence.js";
import type { OrderRepo } from "./order-repo.js";
import { PrismaCouponRepo, PrismaCustomerRepo, PrismaWalletRepo, PrismaFoodItemRepo } from "./prisma-repos.js";
import type { CouponRepo, CustomerRepo, WalletRepo, FoodItemRepo } from "./repos.js";
import type {
  CartItem,
  FoodItem,
  Order,
  OrderStatus,
  PaymentMethod,
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
    const [customers, wallets, itemStates, coupons] = await Promise.all([
      this.prisma.customer.findMany(),
      this.prisma.wallet.findMany(),
      this.prisma.itemState.findMany(),
      this.prisma.coupon.findMany(),
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
      coupons: coupons.map((c) => ({
        code: c.code,
        discountPercent: c.discountPercent,
        minOrderValue: c.minOrderValue,
        active: c.active,
      })),
      itemQuantities: Object.fromEntries(
        itemStates.map((i) => [i.itemId, i.quantity])
      ),
      itemPrices: Object.fromEntries(
        itemStates.map((i) => [i.itemId, i.price])
      ),
    };

    this.latest = snapshot;
  }

  load(): StoreSnapshot | null {
    return this.latest;
  }

  save(snapshot: StoreSnapshot): void {
    this.latest = snapshot;
    // Write-through on a serialized chain so the last write always wins and a
    // transient DB error is logged rather than failing the request. Orders are
    // NOT part of this snapshot — they're persisted directly by PrismaOrderRepo.
    this.writeChain = this.writeChain
      .then(() => this.persistAll(snapshot))
      .catch((err: unknown) => {
        console.error("Failed to persist state to Postgres:", err);
      });
  }

  /** Upsert all snapshot items into PostgreSQL atomically without deleting tables. */
  private async persistAll(s: StoreSnapshot): Promise<void> {
    const itemIds = new Set<string>([
      ...Object.keys(s.itemQuantities),
      ...Object.keys(s.itemPrices),
    ]);

    const customerUpserts = s.customers.map((c) =>
      this.prisma.customer.upsert({
        where: { mobile: c.mobile },
        create: { mobile: c.mobile, name: c.name, email: c.email ?? null },
        update: { name: c.name, email: c.email ?? null },
      })
    );

    const walletUpserts = s.wallets.map((w) =>
      this.prisma.wallet.upsert({
        where: { customerId: w.customerId },
        create: { customerId: w.customerId, foodCoins: w.foodCoins },
        update: { foodCoins: w.foodCoins },
      })
    );

    const itemStateUpserts = Array.from(itemIds).map((itemId) => {
      const quantity = s.itemQuantities[itemId] ?? 0;
      const price = s.itemPrices[itemId] ?? 0;
      return this.prisma.itemState.upsert({
        where: { itemId },
        create: { itemId, quantity, price },
        update: { quantity, price },
      });
    });

    const customItemUpserts = s.customItems.map((i) =>
      this.prisma.foodItem.upsert({
        where: { id: i.id },
        create: { ...i },
        update: { ...i },
      })
    );

    const couponUpserts = (s.coupons ?? []).map((c) => {
      const code = c.code.toUpperCase();
      const fields = {
        discountPercent: c.discountPercent,
        minOrderValue: c.minOrderValue,
        active: c.active,
      };
      return this.prisma.coupon.upsert({
        where: { code },
        create: { code, ...fields },
        update: { ...fields },
      });
    });

    const itemDeletions =
      s.deletedItemIds.length > 0
        ? [
          this.prisma.foodItem.deleteMany({
            where: { id: { in: s.deletedItemIds } },
          }),
        ]
        : [];

    const operations = [
      ...customerUpserts,
      ...walletUpserts,
      ...itemStateUpserts,
      ...customItemUpserts,
      ...couponUpserts,
      ...itemDeletions,
    ];

    if (operations.length > 0) {
      await this.prisma.$transaction(operations);
    }
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

  createCustomerRepo(): CustomerRepo {
    return new PrismaCustomerRepo(this.prisma);
  }

  createWalletRepo(): WalletRepo {
    return new PrismaWalletRepo(this.prisma);
  }

  createFoodItemRepo(): FoodItemRepo {
    return new PrismaFoodItemRepo(this.prisma);
  }

  createCouponRepo(): CouponRepo {
    return new PrismaCouponRepo(this.prisma);
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
  constructor(private readonly prisma: PrismaClient) { }

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
  pointsUsed: number | null;
  discount: number | null;
  couponCode: string | null;
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
    pointsUsed: o.pointsUsed ?? null,
    discount: o.discount ?? null,
    couponCode: o.couponCode ?? null,
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
    ...(row.pointsUsed !== null ? { pointsUsed: row.pointsUsed } : {}),
    ...(row.discount !== null ? { discount: row.discount } : {}),
    ...(row.couponCode ? { couponCode: row.couponCode } : {}),
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
  };
}
