/**
 * Example-based unit tests for the in-memory Store.
 *
 * Covers seed integrity (stalls present, empty food catalogue by default),
 * per-stall menu isolation for an explicitly-seeded store, and deterministic
 * reset (mutate then reset restores the seed).
 *
 * Validates: Requirements 4.1
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Store, seedStalls } from "./store.js";
import type { FoodItem } from "../../types/index.js";

/** Build a valid sample food item for the given stall (test helper). */
function sampleItem(id: string, stallId: string): FoodItem {
  return {
    id,
    name: `Item ${id}`,
    imageUrl: "https://example.com/item.jpg",
    description: "A sample item.",
    rating: 4.5,
    availableQuantity: 10,
    price: 50,
    stallId,
    spice: "mild",
    flavor: "sweet",
    portion: "light",
  };
}

describe("Store seeding", () => {
  let store: Store;

  beforeEach(() => {
    store = new Store();
  });

  it("seeds a non-empty set of stalls", () => {
    const stalls = store.getStalls();
    expect(stalls.length).toBeGreaterThan(0);
    // Stall ids are unique.
    const ids = stalls.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("starts with an empty food catalogue by default", () => {
    // The catalogue ships with no static items; the admin adds items at runtime.
    expect(store.getFoodItems()).toHaveLength(0);
  });

  it("returns only a stall's own items from getMenu", () => {
    const stalls = seedStalls();
    const seeded = new Store({
      stalls,
      foodItems: [
        sampleItem("item-a1", stalls[0].id),
        sampleItem("item-a2", stalls[0].id),
        sampleItem("item-b1", stalls[1].id),
      ],
    });

    for (const stall of seeded.getStalls()) {
      for (const item of seeded.getMenu(stall.id)) {
        expect(item.stallId).toBe(stall.id);
      }
    }
    expect(seeded.getMenu(stalls[0].id)).toHaveLength(2);
    expect(seeded.getMenu(stalls[1].id)).toHaveLength(1);
  });

  it("reports known and unknown stalls via hasStall", () => {
    const known = store.getStalls()[0].id;
    expect(store.hasStall(known)).toBe(true);
    expect(store.hasStall("stall-does-not-exist")).toBe(false);
  });
});

describe("Store deterministic reset", () => {
  it("restores the seed state after mutations", () => {
    const stalls = seedStalls();
    const store = new Store({
      stalls,
      foodItems: [sampleItem("item-seed", stalls[0].id)],
    });
    const seedStallsSnapshot = store.getStalls();
    const seedItems = store.getFoodItems();

    // Mutate: add an order, credit a wallet, add a referral, change stock.
    store.saveOrder({
      token: "T-1",
      stallId: seedStallsSnapshot[0].id,
      items: [{ itemId: "x", name: "X", unitPrice: 10, quantity: 1 }],
      total: 10,
      status: "Craving Funded",
      paid: true,
      paymentMethod: "UPI",
      customerId: "cust-1",
      createdAt: new Date().toISOString(),
      spinUsed: false,
    });
    store.saveWallet({ customerId: "cust-1", foodCoins: 99 });
    store.saveReferral({
      customerId: "cust-1",
      link: "https://bytebites.demo/r/cust-1",
      creditedReferredIds: ["cust-2"],
    });
    const someItem = seedItems[0];
    store.setAvailableQuantity(someItem.id, 0);

    expect(store.getOrders().length).toBe(1);

    store.reset();

    // Runtime state cleared.
    expect(store.getOrders().length).toBe(0);
    expect(store.getReferrals().length).toBe(0);
    expect(store.getWallet("cust-1").foodCoins).toBe(0);

    // Seed collections restored to their original snapshot.
    expect(store.getStalls()).toEqual(seedStallsSnapshot);
    expect(store.getFoodItems()).toEqual(seedItems);
    // The mutated stock is back to the seed value.
    expect(store.getFoodItem(someItem.id)?.availableQuantity).toBe(
      someItem.availableQuantity
    );
  });

  it("does not leak internal state through returned copies", () => {
    const store = new Store();
    const stalls = store.getStalls();
    stalls[0].name = "MUTATED";
    // The store's own copy is unaffected by mutating the returned array.
    expect(store.getStalls()[0].name).not.toBe("MUTATED");
  });
});
