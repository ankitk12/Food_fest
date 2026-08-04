/**
 * Tests for JSON-file persistence of the Store.
 *
 * A file-backed Store must survive a "restart": mutating one Store and then
 * constructing a fresh Store over the same file must recover orders, wallets,
 * customers, and item-stock overrides. Tests use a unique temp file
 * (cleaned up afterwards) so they never touch or depend on the real shared
 * data file, and the default (no-persistence) Store must never write to disk.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import type { Customer, Order } from "../../types/index.js";
import { runWithRetry, JsonFilePersistence } from "./persistence.js";

const tempDirs: string[] = [];

let shouldFsWriteFail = false;
let fsWriteAttempts = 0;

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    writeFileSync: (...args: any[]) => {
      if (shouldFsWriteFail) {
        fsWriteAttempts++;
        throw new Error("Disk write failed");
      }
      return actual.writeFileSync(...args);
    },
  };
});

function tempDataFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "bytebites-persist-"));
  tempDirs.push(dir);
  return join(dir, "db.json");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const SAMPLE_ORDER: Order = {
  token: "T-persist-1",
  stallId: "stall-tandoori",
  items: [{ itemId: "item-x", name: "X", unitPrice: 100, quantity: 2 }],
  total: 200,
  status: "Craving Funded",
  paid: true,
  paymentMethod: "UPI",
  gatewayRef: "MOCK-1",
  customerId: "9876543210",
  createdAt: new Date().toISOString(),
};

describe("JSON-file persistence round-trip", () => {
  it("recovers orders, wallets, and customers from a fresh Store over the same file", () => {
    const dataFile = tempDataFile();

    // First Store: persist a variety of runtime state.
    const store = new Store(undefined, { persist: true, dataFile });
    store.saveOrder(SAMPLE_ORDER);
    store.saveWallet({ customerId: "9876543210", foodCoins: 42 });
    const customer: Customer = { mobile: "9876543210", name: "Asha" };
    store.saveCustomer(customer);

    expect(existsSync(dataFile)).toBe(true);

    // Second Store over the SAME file simulates a server restart.
    const reloaded = new Store(undefined, { persist: true, dataFile });

    expect(reloaded.getOrder("T-persist-1")).toEqual(SAMPLE_ORDER);
    expect(reloaded.getWallet("9876543210").foodCoins).toBe(42);
    expect(reloaded.getCustomer("9876543210")).toEqual(customer);
  });

  it("recovers a runtime-created item and its stock overrides after a restart", () => {
    const dataFile = tempDataFile();

    // The catalogue starts empty, so create an item at runtime first.
    const store = new Store(undefined, { persist: true, dataFile });
    const item = store.createFoodItem({
      name: "Persisted Item",
      imageUrl: "https://example.com/item.jpg",
      description: "A runtime-created item.",
      rating: 4.5,
      availableQuantity: 10,
      price: 50,
      stallId: "stall-tandoori",
    });
    store.setAvailableQuantity(item.id, 3);

    const reloaded = new Store(undefined, { persist: true, dataFile });
    expect(reloaded.getFoodItem(item.id)?.name).toBe("Persisted Item");
    expect(reloaded.getFoodItem(item.id)?.availableQuantity).toBe(3);
  });

  it("persists the last write (no lost updates)", () => {
    const dataFile = tempDataFile();

    const store = new Store(undefined, { persist: true, dataFile });
    store.saveWallet({ customerId: "c", foodCoins: 1 });
    store.saveWallet({ customerId: "c", foodCoins: 2 });
    store.saveWallet({ customerId: "c", foodCoins: 3 });

    const reloaded = new Store(undefined, { persist: true, dataFile });
    expect(reloaded.getWallet("c").foodCoins).toBe(3);
  });

  it("starts empty when the data file does not exist yet", () => {
    const dataFile = tempDataFile();
    const store = new Store(undefined, { persist: true, dataFile });
    expect(store.getOrders()).toHaveLength(0);
    expect(store.getCustomers()).toHaveLength(0);
  });
});

describe("default Store does not persist", () => {
  it("writes nothing to disk (in-memory only)", () => {
    const dataFile = tempDataFile();
    // A default Store must not touch any file, even one we name here.
    const store = new Store();
    store.saveOrder(SAMPLE_ORDER);
    store.saveCustomer({ mobile: "9876543210", name: "Asha" });
    // The temp file was never created because the store has no persistence.
    expect(existsSync(dataFile)).toBe(false);
  });
});

describe("Database / Save Retry Mechanism", () => {
  it("runWithRetry succeeds on first attempt", async () => {
    let calls = 0;
    const result = await runWithRetry(async () => {
      calls++;
      return "success";
    });
    expect(result).toBe("success");
    expect(calls).toBe(1);
  });

  it("runWithRetry succeeds on third attempt after two failures", async () => {
    let calls = 0;
    const result = await runWithRetry(async () => {
      calls++;
      if (calls < 3) {
        throw new Error("Temporary error");
      }
      return "success";
    });
    expect(result).toBe("success");
    expect(calls).toBe(3);
  });

  it("runWithRetry fails after third attempt", async () => {
    let calls = 0;
    await expect(
      runWithRetry(async () => {
        calls++;
        throw new Error("Persistent error");
      })
    ).rejects.toThrow("Persistent error");
    expect(calls).toBe(3);
  });

  it("JsonFilePersistence.save retries 3 times on write failure", () => {
    const dataFile = join(tmpdir(), "failing-db.json");
    const adapter = new JsonFilePersistence(dataFile);
    
    shouldFsWriteFail = true;
    fsWriteAttempts = 0;

    try {
      expect(() => adapter.save({
        orders: [],
        wallets: [],
        customers: [],
        coupons: [],
        combos: [],
        itemQuantities: {},
        itemPrices: {},
        customItems: [],
        deletedItemIds: [],
      })).toThrow("Disk write failed");
    } finally {
      shouldFsWriteFail = false;
    }

    expect(fsWriteAttempts).toBe(3);
  });
});

