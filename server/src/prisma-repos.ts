/**
 * Direct Prisma Database Implementations for all Repositories.
 *
 * Provides real-time, per-request read/write access to PostgreSQL tables:
 *   - Customer table -> PrismaCustomerRepo
 *   - Wallet table -> PrismaWalletRepo
 *   - Referral table -> PrismaReferralRepo
 *   - FoodItem & ItemState tables -> PrismaFoodItemRepo
 */

import type { PrismaClient } from "@prisma/client";
import type { Coupon, Customer, FoodItem, Wallet } from "../../types/index.js";
import type { CouponRepo, CustomerRepo, FoodItemRepo, WalletRepo } from "./repos.js";

// --- Row <-> Domain Helpers ------------------------------------------------

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

// --- Prisma Customer Repository --------------------------------------------

export class PrismaCustomerRepo implements CustomerRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async get(mobile: string): Promise<Customer | undefined> {
    const row = await this.prisma.customer.findUnique({ where: { mobile } });
    if (!row) return undefined;
    return {
      mobile: row.mobile,
      name: row.name,
      ...(row.email ? { email: row.email } : {}),
    };
  }

  async save(customer: Customer): Promise<void> {
    await this.prisma.customer.upsert({
      where: { mobile: customer.mobile },
      create: {
        mobile: customer.mobile,
        name: customer.name,
        email: customer.email ?? null,
      },
      update: {
        name: customer.name,
        email: customer.email ?? null,
      },
    });
  }

  async list(): Promise<Customer[]> {
    const rows = await this.prisma.customer.findMany();
    return rows.map((row) => ({
      mobile: row.mobile,
      name: row.name,
      ...(row.email ? { email: row.email } : {}),
    }));
  }
}

// --- Prisma Wallet Repository ----------------------------------------------

export class PrismaWalletRepo implements WalletRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async get(customerId: string): Promise<Wallet | undefined> {
    const row = await this.prisma.wallet.findUnique({ where: { customerId } });
    if (!row) return undefined;
    return { customerId: row.customerId, foodCoins: row.foodCoins };
  }

  async save(wallet: Wallet): Promise<void> {
    await this.prisma.wallet.upsert({
      where: { customerId: wallet.customerId },
      create: { customerId: wallet.customerId, foodCoins: wallet.foodCoins },
      update: { foodCoins: wallet.foodCoins },
    });
  }

  async addCoins(customerId: string, amount: number): Promise<Wallet> {
    const row = await this.prisma.wallet.upsert({
      where: { customerId },
      create: { customerId, foodCoins: amount },
      update: { foodCoins: { increment: amount } },
    });
    return { customerId: row.customerId, foodCoins: row.foodCoins };
  }

  async deductCoins(customerId: string, amount: number): Promise<Wallet> {
    const current = await this.get(customerId);
    const available = current ? current.foodCoins : 0;
    if (available < amount) {
      throw new Error(`Insufficient FoodCoins: balance ${available}, requested ${amount}`);
    }
    const row = await this.prisma.wallet.update({
      where: { customerId },
      data: { foodCoins: { decrement: amount } },
    });
    return { customerId: row.customerId, foodCoins: row.foodCoins };
  }
}

// --- Prisma Food Item Repository -------------------------------------------

export class PrismaFoodItemRepo implements FoodItemRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<FoodItem[]> {
    const [foodItems, itemStates] = await Promise.all([
      this.prisma.foodItem.findMany(),
      this.prisma.itemState.findMany(),
    ]);

    const stateMap = new Map(itemStates.map((s) => [s.itemId, s]));

    return foodItems.map((item) => {
      const state = stateMap.get(item.id);
      return rowToFoodItem({
        ...item,
        availableQuantity: state ? state.quantity : item.availableQuantity,
        price: state ? state.price : item.price,
      });
    });
  }

  async get(id: string): Promise<FoodItem | undefined> {
    const [item, state] = await Promise.all([
      this.prisma.foodItem.findUnique({ where: { id } }),
      this.prisma.itemState.findUnique({ where: { itemId: id } }),
    ]);

    if (!item) return undefined;
    return rowToFoodItem({
      ...item,
      availableQuantity: state ? state.quantity : item.availableQuantity,
      price: state ? state.price : item.price,
    });
  }

  async save(item: FoodItem): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.foodItem.upsert({
        where: { id: item.id },
        create: { ...item },
        update: { ...item },
      }),
      this.prisma.itemState.upsert({
        where: { itemId: item.id },
        create: {
          itemId: item.id,
          quantity: item.availableQuantity,
          price: item.price,
        },
        update: {
          quantity: item.availableQuantity,
          price: item.price,
        },
      }),
    ]);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.foodItem.deleteMany({ where: { id } }),
      this.prisma.itemState.deleteMany({ where: { itemId: id } }),
    ]);
  }

  async updateStock(id: string, availableQuantity: number): Promise<void> {
    const item = await this.prisma.foodItem.findUnique({ where: { id } });
    const currentPrice = item ? item.price : 0;
    await this.prisma.itemState.upsert({
      where: { itemId: id },
      create: { itemId: id, quantity: availableQuantity, price: currentPrice },
      update: { quantity: availableQuantity },
    });
  }

  async updatePrice(id: string, price: number): Promise<void> {
    const item = await this.prisma.foodItem.findUnique({ where: { id } });
    const currentQty = item ? item.availableQuantity : 0;
    await this.prisma.itemState.upsert({
      where: { itemId: id },
      create: { itemId: id, quantity: currentQty, price },
      update: { price },
    });
  }
}

// --- Prisma Coupon Repository ----------------------------------------------

export class PrismaCouponRepo implements CouponRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<Coupon[]> {
    const rows = await this.prisma.coupon.findMany();
    return rows.map((r) => ({
      code: r.code,
      discountPercent: r.discountPercent,
      minOrderValue: r.minOrderValue,
      active: r.active,
    }));
  }

  async get(code: string): Promise<Coupon | undefined> {
    const row = await this.prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!row) return undefined;
    return {
      code: row.code,
      discountPercent: row.discountPercent,
      minOrderValue: row.minOrderValue,
      active: row.active,
    };
  }

  async save(coupon: Coupon): Promise<void> {
    await this.prisma.coupon.upsert({
      where: { code: coupon.code.toUpperCase() },
      create: {
        code: coupon.code.toUpperCase(),
        discountPercent: coupon.discountPercent,
        minOrderValue: coupon.minOrderValue,
        active: coupon.active,
      },
      update: {
        discountPercent: coupon.discountPercent,
        minOrderValue: coupon.minOrderValue,
        active: coupon.active,
      },
    });
  }

  async delete(code: string): Promise<void> {
    await this.prisma.coupon.deleteMany({
      where: { code: code.toUpperCase() },
    });
  }
}
