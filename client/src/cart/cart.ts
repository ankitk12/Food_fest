/**
 * Pure cart module for ByteBites.
 *
 * Framework-agnostic helpers that manage cart state as a plain, immutable
 * array of cart lines. Keeping this logic pure (no React, no network) lets the
 * marketplace/cart property tests target the functions directly and keeps the
 * components thin — they simply render the derived state and forward user
 * actions to these helpers.
 *
 * Monetary math (line totals, order total) is delegated to the shared pricing
 * domain module so the client and server agree on every rupee, and quantity
 * clamping reuses the domain `clampQuantity` rule (Req 3.5).
 *
 * Validates: Requirements 2.4, 3.1, 3.2, 3.3, 3.4, 3.5
 */

import type { CartItem, FoodItem } from "../../../types/index.js";
import {
  clampQuantity,
  lineTotal,
  orderTotal,
} from "../../../domain/pricing.js";

/** The cheese add-on price for an item (₹), or 0 when the item offers none. */
export function cheesePriceOf(item: Pick<FoodItem, "cheesePrice">): number {
  const p = item.cheesePrice ?? 0;
  return Number.isFinite(p) && p > 0 ? p : 0;
}

/**
 * A cart line extends the shared `CartItem` with the item's currently
 * available quantity so the cart can clamp increases without re-fetching the
 * menu. When sending the cart to checkout, callers project each line back to a
 * plain `CartItem` via {@link toCartItems}.
 */
export interface CartLine extends CartItem {
  availableQuantity: number;
}

/** A cart is an ordered list of distinct cart lines (one per item id). */
export type Cart = CartLine[];

/** Result of a quantity change, signalling whether a clamp notice is needed. */
export interface QuantityChangeResult {
  cart: Cart;
  clamped: boolean;
}

/** An empty cart. */
export function emptyCart(): Cart {
  return [];
}

/**
 * Add one unit of the given food item to the cart (Req 2.4).
 *
 * If the item is already present, its quantity increases by exactly one and
 * all other lines are left unchanged; otherwise a new line is appended with a
 * quantity of one. The line's `availableQuantity` is refreshed to the item's
 * current availability so later clamping uses up-to-date stock. Adding always
 * increases the count by one — availability is gated at the UI (the Add to
 * Cart button is disabled for sold-out items), and over-quantity limiting is
 * handled separately by {@link setQuantity} (Req 3.5).
 */
export function addToCart(cart: Cart, item: FoodItem, addCheese = false): Cart {
  const existing = cart.find((line) => line.itemId === item.id);
  if (existing) {
    return cart.map((line) =>
      line.itemId === item.id
        ? {
            ...line,
            quantity: line.quantity + 1,
            availableQuantity: item.availableQuantity,
          }
        : line
    );
  }
  const cheesePrice = cheesePriceOf(item);
  const withCheese = addCheese && cheesePrice > 0;
  return [
    ...cart,
    {
      itemId: item.id,
      name: item.name,
      unitPrice: item.price + (withCheese ? cheesePrice : 0),
      quantity: 1,
      availableQuantity: item.availableQuantity,
      ...(cheesePrice > 0 ? { cheesePrice } : {}),
      ...(withCheese ? { addCheese: true } : {}),
    },
  ];
}

/**
 * Toggle the extra-cheese add-on on an existing cart line, adjusting the line's
 * unit price by the add-on cost. No-op when the item is not in the cart.
 */
export function setCheese(cart: Cart, itemId: string, addCheese: boolean): Cart {
  return cart.map((line) => {
    if (line.itemId !== itemId) return line;
    const cheesePrice = line.cheesePrice ?? 0;
    const base = line.unitPrice - (line.addCheese ? cheesePrice : 0);
    const on = addCheese && cheesePrice > 0;
    const next: CartLine = {
      ...line,
      unitPrice: base + (on ? cheesePrice : 0),
    };
    if (on) next.addCheese = true;
    else delete next.addCheese;
    return next;
  });
}

/**
 * Set the quantity of a cart line, clamping to the item's available quantity
 * and reporting whether a notice should be shown (Req 3.5).
 *
 * The requested quantity is limited to at least one (a line always holds a
 * whole unit) and at most the line's available quantity. When the request
 * exceeds availability the returned `clamped` flag is true so the UI can show
 * an over-quantity notice. An unknown item id leaves the cart unchanged.
 */
export function setQuantity(
  cart: Cart,
  itemId: string,
  requested: number
): QuantityChangeResult {
  const line = cart.find((l) => l.itemId === itemId);
  if (!line) return { cart, clamped: false };

  const { quantity, clamped } = clampQuantity(requested, line.availableQuantity);
  const finalQuantity = Math.max(1, quantity);

  return {
    cart: cart.map((l) =>
      l.itemId === itemId ? { ...l, quantity: finalQuantity } : l
    ),
    clamped,
  };
}

/**
 * Remove a line from the cart entirely (Req 3.4). Lines other than the removed
 * item are preserved in order.
 */
export function removeItem(cart: Cart, itemId: string): Cart {
  return cart.filter((line) => line.itemId !== itemId);
}

/** The line total (unit price × quantity) for a single cart line. */
export function cartLineTotal(line: CartLine): number {
  return lineTotal(line.unitPrice, line.quantity);
}

/** The order total: the sum of every line total (Req 3.2). */
export function cartTotal(cart: Cart): number {
  return orderTotal(cart);
}

/** The total number of units across all lines (for a cart badge/count). */
export function cartItemCount(cart: Cart): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

/** Project the cart to plain `CartItem`s for the checkout request payload. */
export function toCartItems(cart: Cart): CartItem[] {
  return cart.map(({ itemId, name, unitPrice, quantity }) => ({
    itemId,
    name,
    unitPrice,
    quantity,
  }));
}
