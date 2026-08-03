/**
 * Tests for the pure cart module.
 *
 * Includes example-based unit tests for the cart helpers and the property test
 * for add-to-cart increment (Property 3). The pure functions are the cleanest
 * target for the increment property because they operate over arbitrary carts
 * without needing the DOM.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { FoodItem } from "../../../types/index.js";
import { foodItemArb, idArb, nameArb, priceArb } from "../../../types/generators.js";
import {
  addToCart,
  cartTotal,
  emptyCart,
  removeItem,
  setQuantity,
  type Cart,
  type CartLine,
} from "./cart.js";

/** Count total units of a given item id currently in the cart. */
function unitsOf(cart: Cart, itemId: string): number {
  return cart
    .filter((line) => line.itemId === itemId)
    .reduce((sum, line) => sum + line.quantity, 0);
}

/** An arbitrary cart with distinct item ids (a valid cart invariant). */
const cartArb: fc.Arbitrary<Cart> = fc
  .uniqueArray(
    fc.record<CartLine>({
      itemId: idArb,
      name: nameArb,
      unitPrice: priceArb,
      quantity: fc.integer({ min: 1, max: 20 }),
      availableQuantity: fc.integer({ min: 1, max: 200 }),
    }),
    { selector: (line) => line.itemId, maxLength: 15 }
  );

/** An available food item (availableQuantity >= 1). */
const availableFoodItemArb: fc.Arbitrary<FoodItem> = foodItemArb().map(
  (item) => ({
    ...item,
    availableQuantity: Math.max(1, item.availableQuantity),
  })
);

describe("cart helpers", () => {
  const item: FoodItem = {
    id: "item-1",
    name: "Paneer Tikka",
    imageUrl: "https://example.com/p.jpg",
    description: "Tasty",
    rating: 4.5,
    availableQuantity: 10,
    price: 180,
    stallId: "stall-1",
  };

  it("adds a new item with quantity one", () => {
    const cart = addToCart(emptyCart(), item);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({ itemId: "item-1", quantity: 1 });
  });

  it("increments quantity when adding an existing item", () => {
    const cart = addToCart(addToCart(emptyCart(), item), item);
    expect(cart).toHaveLength(1);
    expect(cart[0]?.quantity).toBe(2);
  });

  it("clamps set quantity to availability and flags the clamp", () => {
    const cart = addToCart(emptyCart(), { ...item, availableQuantity: 3 });
    const result = setQuantity(cart, "item-1", 5);
    expect(result.cart[0]?.quantity).toBe(3);
    expect(result.clamped).toBe(true);
  });

  it("does not flag a clamp when within availability", () => {
    const cart = addToCart(emptyCart(), { ...item, availableQuantity: 10 });
    const result = setQuantity(cart, "item-1", 4);
    expect(result.cart[0]?.quantity).toBe(4);
    expect(result.clamped).toBe(false);
  });

  it("removes an item from the cart", () => {
    const cart = addToCart(emptyCart(), item);
    expect(removeItem(cart, "item-1")).toHaveLength(0);
  });

  it("computes the order total as the sum of line totals", () => {
    let cart = addToCart(emptyCart(), item); // 180
    cart = addToCart(cart, item); // 360
    expect(cartTotal(cart)).toBe(360);
  });
});

// Feature: bytebites, Property 3: Adding an item increases its cart quantity by one
// Validates: Requirements 2.4
describe("Property 3: Adding an item increases its cart quantity by one", () => {
  it("adds exactly one unit of the item and leaves all other lines unchanged", () => {
    fc.assert(
      fc.property(cartArb, availableFoodItemArb, (cart, item) => {
        const before = unitsOf(cart, item.id);
        const next = addToCart(cart, item);

        // Exactly one more unit of the added item.
        expect(unitsOf(next, item.id)).toBe(before + 1);

        // Every other item's quantity is unchanged and still present.
        for (const line of cart) {
          if (line.itemId === item.id) continue;
          const nextLine = next.find((l) => l.itemId === line.itemId);
          expect(nextLine).toBeDefined();
          expect(nextLine?.quantity).toBe(line.quantity);
        }
      }),
      { numRuns: 200 }
    );
  });
});
