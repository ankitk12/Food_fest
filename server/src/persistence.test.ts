/**
 * Tests for JSON-file persistence of the Store.
 *
 * A file-backed Store must survive a "restart": mutating one Store and then
 * constructing a fresh Store over the same file must recover orders, wallets,
 * referrals, customers, and item-stock overrides. Tests use a unique temp file
 * (cleaned up afterwards) so they never touch or depend on the real shared
 * data file, and the default (no-persistence) Store must never write to disk.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "./store.js";
import type { Customer, Order, Referral } from "../../types/index.js";

const tempDirs: string[] = [];

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
  spinUsed: false,
};

describe("JSON-file persistence round-trip", () => {
  it("recovers orders, wallets, referrals, and customers from a fresh Store over the same file", () => {
    const dataFile = tempDataFile();

    // First Store: persist a variety of runtime state.
    const store = new Store(undefined, { persist: true, dataFile });
    store.saveOrder(SAMPLE_ORDER);
    store.saveWallet({ customerId: "9876543210", foodCoins: 42 });
    const referral: Referral = {
      customerId: "9876543210",
      link: "https://bytebites.app/join?ref=9876543210",
      creditedReferredIds: ["8887776665"],
    };
    store.saveReferral(referral);
    const customer: Customer = { mobile: "9876543210", name: "Asha" };
    store.saveCustomer(customer);

    expect(existsSync(dataFile)).toBe(true);

    // Second Store over the SAME file simulates a server restart.
    const reloaded = new Store(undefined, { persist: true, dataFile });

    expect(reloaded.getOrder("T-persist-1")).toEqual(SAMPLE_ORDER);
    expect(reloaded.getWallet("9876543210").foodCoins).toBe(42);
    expect(reloaded.getReferral("9876543210")).toEqual(referral);
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
      spice: "mild",
      flavor: "sweet",
      portion: "light",
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
