/**
 * Repository interfaces and Store-backed implementations for all database entities.
 *
 * Designed to match `OrderRepo` (see order-repo.ts), providing async data access
 * seams for Customer, Wallet, and FoodItem models:
 *   - Store*Repo: backed by in-memory Store (dev, unit tests, JSON file backend)
 *   - Prisma*Repo: direct Prisma database queries (see prisma-repos.ts)
 */

import type { Coupon, Customer, FoodItem, Wallet } from "../../types/index.js";
import type { Store } from "./store.js";

// --- Customer Repository ---------------------------------------------------

export interface CustomerRepo {
  get(mobile: string): Promise<Customer | undefined>;
  save(customer: Customer): Promise<void>;
  list(): Promise<Customer[]>;
}

export class StoreCustomerRepo implements CustomerRepo {
  constructor(private readonly store: Store) {}

  async get(mobile: string): Promise<Customer | undefined> {
    return this.store.getCustomer(mobile);
  }

  async save(customer: Customer): Promise<void> {
    this.store.saveCustomer(customer);
  }

  async list(): Promise<Customer[]> {
    return this.store.getCustomers();
  }
}

// --- Wallet Repository -----------------------------------------------------

export interface WalletRepo {
  get(customerId: string): Promise<Wallet | undefined>;
  save(wallet: Wallet): Promise<void>;
  addCoins(customerId: string, amount: number): Promise<Wallet>;
  deductCoins(customerId: string, amount: number): Promise<Wallet>;
}

export class StoreWalletRepo implements WalletRepo {
  constructor(private readonly store: Store) {}

  async get(customerId: string): Promise<Wallet | undefined> {
    return this.store.getWallet(customerId);
  }

  async save(wallet: Wallet): Promise<void> {
    this.store.saveWallet(wallet);
  }

  async addCoins(customerId: string, amount: number): Promise<Wallet> {
    const wallet = this.store.getWallet(customerId);
    wallet.foodCoins += amount;
    this.store.saveWallet(wallet);
    return wallet;
  }

  async deductCoins(customerId: string, amount: number): Promise<Wallet> {
    const wallet = this.store.getWallet(customerId);
    if (wallet.foodCoins < amount) {
      throw new Error(`Insufficient FoodCoins: balance ${wallet.foodCoins}, requested ${amount}`);
    }
    wallet.foodCoins -= amount;
    this.store.saveWallet(wallet);
    return wallet;
  }
}

// --- Food Item / Catalogue Repository -------------------------------------

export interface FoodItemRepo {
  list(): Promise<FoodItem[]>;
  get(id: string): Promise<FoodItem | undefined>;
  save(item: FoodItem): Promise<void>;
  delete(id: string): Promise<void>;
  updateStock(id: string, availableQuantity: number): Promise<void>;
  updatePrice(id: string, price: number): Promise<void>;
}

export class StoreFoodItemRepo implements FoodItemRepo {
  constructor(private readonly store: Store) {}

  async list(): Promise<FoodItem[]> {
    return this.store.getFoodItems();
  }

  async get(id: string): Promise<FoodItem | undefined> {
    return this.store.getFoodItem(id);
  }

  async save(item: FoodItem): Promise<void> {
    this.store.createFoodItem(item);
  }

  async delete(id: string): Promise<void> {
    this.store.deleteFoodItem(id);
  }

  async updateStock(id: string, availableQuantity: number): Promise<void> {
    this.store.setAvailableQuantity(id, availableQuantity);
  }

  async updatePrice(id: string, price: number): Promise<void> {
    this.store.setPrice(id, price);
  }
}

// --- Coupon Repository -----------------------------------------------------

export interface CouponRepo {
  list(): Promise<Coupon[]>;
  get(code: string): Promise<Coupon | undefined>;
  save(coupon: Coupon): Promise<void>;
  delete(code: string): Promise<void>;
}

export class StoreCouponRepo implements CouponRepo {
  constructor(private readonly store: Store) {}

  async list(): Promise<Coupon[]> {
    return this.store.getCoupons();
  }

  async get(code: string): Promise<Coupon | undefined> {
    return this.store.getCoupon(code);
  }

  async save(coupon: Coupon): Promise<void> {
    this.store.saveCoupon(coupon);
  }

  async delete(code: string): Promise<void> {
    this.store.deleteCoupon(code);
  }
}
