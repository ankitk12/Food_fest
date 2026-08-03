import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  cartArb,
  foodItemArb,
  menuArb,
  nonEmptyCartArb,
  orderSetArb,
  ratingsArb,
  stallsArb,
  walletArb,
} from "./generators.js";
import {
  ORDER_STATUS_SEQUENCE,
} from "./index.js";

describe("shared generators", () => {
  it("FoodItem: rating in 0..5, quantity >= 0, positive price", () => {
    fc.assert(
      fc.property(foodItemArb(), (item) => {
        expect(item.rating).toBeGreaterThanOrEqual(0);
        expect(item.rating).toBeLessThanOrEqual(5);
        expect(item.availableQuantity).toBeGreaterThanOrEqual(0);
        expect(item.price).toBeGreaterThan(0);
      })
    );
  });

  it("FoodItem: unavailable option forces quantity 0", () => {
    fc.assert(
      fc.property(foodItemArb({ unavailable: true }), (item) => {
        expect(item.availableQuantity).toBe(0);
      })
    );
  });

  it("menu is always non-empty and scoped to a stall when requested", () => {
    fc.assert(
      fc.property(menuArb({ stallId: "stall-1" }), (menu) => {
        expect(menu.length).toBeGreaterThan(0);
        for (const item of menu) expect(item.stallId).toBe("stall-1");
      })
    );
  });

  it("carts may be empty or large; non-empty cart always has items", () => {
    fc.assert(
      fc.property(cartArb, (cart) => {
        expect(cart.length).toBeGreaterThanOrEqual(0);
        for (const line of cart) expect(line.quantity).toBeGreaterThanOrEqual(1);
      })
    );
    fc.assert(
      fc.property(nonEmptyCartArb, (cart) => {
        expect(cart.length).toBeGreaterThanOrEqual(1);
      })
    );
  });



  it("order sets: total equals sum of line totals, valid status", () => {
    fc.assert(
      fc.property(orderSetArb(), (orders) => {
        for (const order of orders) {
          const expected = order.items.reduce(
            (s, it) => s + it.unitPrice * it.quantity,
            0
          );
          expect(order.total).toBeCloseTo(expected, 6);
          expect(ORDER_STATUS_SEQUENCE).toContain(order.status);
        }
      })
    );
  });

  it("today-scoped orders are dated on the current local day", () => {
    fc.assert(
      fc.property(orderSetArb({ today: true }), (orders) => {
        const today = new Date();
        for (const order of orders) {
          const d = new Date(order.createdAt);
          expect(d.getFullYear()).toBe(today.getFullYear());
          expect(d.getMonth()).toBe(today.getMonth());
          expect(d.getDate()).toBe(today.getDate());
        }
      })
    );
  });

  it("wallet balances are non-negative integers", () => {
    fc.assert(
      fc.property(walletArb, (wallet) => {
        expect(Number.isInteger(wallet.foodCoins)).toBe(true);
        expect(wallet.foodCoins).toBeGreaterThanOrEqual(0);
      })
    );
  });

  it("stalls have distinct ids", () => {
    fc.assert(
      fc.property(stallsArb, (stalls) => {
        const ids = stalls.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
      })
    );
  });



  it("ratings are within 0..5", () => {
    fc.assert(
      fc.property(ratingsArb, (ratings) => {
        for (const r of ratings) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(5);
        }
      })
    );
  });
});
