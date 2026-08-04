/**
 * Direct Prisma Database Implementations for all Repositories.
 *
 * Provides real-time, per-request read/write access to PostgreSQL tables:
 *   - Customer table -> PrismaCustomerRepo
 *   - Wallet table -> PrismaWalletRepo
 *   - Referral table -> PrismaReferralRepo
 *   - FoodItem table (stock/price included) -> PrismaFoodItemRepo
 */

import type { PrismaClient } from "@prisma/client";
import type { Combo, Coupon, Customer, FoodItem, Wallet } from "../../types/index.js";
import type { ComboRepo, CouponRepo, CustomerRepo, FoodItemRepo, WalletRepo } from "./repos.js";

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
  cheesePrice?: number | null;
  addonName?: string | null;
  jainAvailable?: boolean | null;
  displayOrder?: number | null;
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
    ...(row.cheesePrice != null ? { cheesePrice: row.cheesePrice } : {}),
    ...(row.addonName ? { addonName: row.addonName } : {}),
    ...(row.jainAvailable != null ? { jainAvailable: row.jainAvailable } : {}),
    ...(row.displayOrder != null ? { displayOrder: row.displayOrder } : {}),
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
    const foodItems = await this.prisma.foodItem.findMany();
    return foodItems.map((item) => rowToFoodItem(item));
  }

  async get(id: string): Promise<FoodItem | undefined> {
    const item = await this.prisma.foodItem.findUnique({ where: { id } });
    return item ? rowToFoodItem(item) : undefined;
  }

  async save(item: FoodItem): Promise<void> {
    // Stock and price live on the FoodItem row itself — no separate table.
    await this.prisma.foodItem.upsert({
      where: { id: item.id },
      create: { ...item },
      update: { ...item },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.foodItem.deleteMany({ where: { id } });
  }

  async updateStock(id: string, availableQuantity: number): Promise<void> {
    await this.prisma.foodItem.update({
      where: { id },
      data: { availableQuantity },
    });
  }

  async updatePrice(id: string, price: number): Promise<void> {
    await this.prisma.foodItem.update({
      where: { id },
      data: { price },
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

// --- Prisma Combo Repository -----------------------------------------------

export class PrismaComboRepo implements ComboRepo {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<Combo[]> {
    const rows = await this.prisma.combo.findMany();
    return rows.map((r) => rowToCombo(r));
  }

  async get(id: string): Promise<Combo | undefined> {
    const row = await this.prisma.combo.findUnique({ where: { id } });
    return row ? rowToCombo(row) : undefined;
  }

  async save(combo: Combo): Promise<void> {
    const data = {
      name: combo.name,
      itemIds: combo.itemIds,
      price: combo.price,
      active: combo.active,
      imageUrl: combo.imageUrl ?? null,
    };
    await this.prisma.combo.upsert({
      where: { id: combo.id },
      create: { id: combo.id, ...data },
      update: data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.combo.deleteMany({ where: { id } });
  }
}

function rowToCombo(row: {
  id: string;
  name: string;
  itemIds: string[];
  price: number;
  active: boolean;
  imageUrl?: string | null;
}): Combo {
  return {
    id: row.id,
    name: row.name,
    itemIds: row.itemIds,
    price: row.price,
    active: row.active,
    ...(row.imageUrl ? { imageUrl: row.imageUrl } : {}),
  };
}
