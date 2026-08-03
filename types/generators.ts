/**
 * Reusable fast-check generators (arbitraries) for ByteBites.
 *
 * These generators are shared across property-based tests for the pure domain
 * modules and the API layer. They intelligently constrain values to the valid
 * input space and deliberately include boundary values so edge-case acceptance
 * criteria are exercised:
 *   - FoodItem rating in 0..5 including the bounds 0 and 5
 *   - available quantity including 0 (unavailable)
 *   - strictly positive prices
 *   - carts including empty and large
 *   - order sets spanning multiple dates and paid/unpaid states
 *   - wallet balances including zero
 *   - referral scenarios
 */

import fc from "fast-check";
import type {
  CartItem,
  Coupon,
  FoodItem,
  Metrics,
  Order,
  OrderStatus,
  PaymentMethod,
  Stall,
  Wallet,
} from "./index.js";
import {
  ORDER_STATUS_SEQUENCE,
} from "./index.js";

// --- Primitive helpers -----------------------------------------------------

/** Non-empty identifier string. */
export const idArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((s) => s.trim().length > 0);

/** Non-empty display name. */
export const nameArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 24 })
  .filter((s) => s.trim().length > 0);

/** Startup rating in the inclusive range 0..5, including the bounds. */
export const ratingArb: fc.Arbitrary<number> = fc.oneof(
  fc.constant(0),
  fc.constant(5),
  fc.float({ min: 0, max: 5, noNaN: true })
);

/** Available quantity >= 0, including the boundary value 0 (unavailable). */
export const availableQuantityArb: fc.Arbitrary<number> = fc.nat({ max: 200 });

/** Strictly positive price in INR (paise-friendly, up to 2 decimals). */
export const priceArb: fc.Arbitrary<number> = fc
  .integer({ min: 1, max: 500000 })
  .map((paise) => paise / 100);

export const orderStatusArb: fc.Arbitrary<OrderStatus> = fc.constantFrom(
  ...ORDER_STATUS_SEQUENCE
);

// --- FoodItem --------------------------------------------------------------

export interface FoodItemArbOptions {
  stallId?: string;
  /** When true, forces availableQuantity to 0 (unavailable item). */
  unavailable?: boolean;
}

export function foodItemArb(
  options: FoodItemArbOptions = {}
): fc.Arbitrary<FoodItem> {
  const stallIdArb = options.stallId ? fc.constant(options.stallId) : idArb;
  const quantityArb = options.unavailable
    ? fc.constant(0)
    : availableQuantityArb;
  return fc.record<FoodItem>({
    id: idArb,
    name: nameArb,
    imageUrl: fc.webUrl(),
    description: fc.string({ minLength: 0, maxLength: 80 }),
    rating: ratingArb,
    availableQuantity: quantityArb,
    price: priceArb,
    stallId: stallIdArb,
  });
}

/** A non-empty menu of food items (optionally scoped to a single stall). */
export function menuArb(
  options: FoodItemArbOptions = {}
): fc.Arbitrary<FoodItem[]> {
  return fc.array(foodItemArb(options), { minLength: 1, maxLength: 15 });
}

// --- CartItem & carts ------------------------------------------------------

export const cartItemArb: fc.Arbitrary<CartItem> = fc.record<CartItem>({
  itemId: idArb,
  name: nameArb,
  unitPrice: priceArb,
  quantity: fc.integer({ min: 1, max: 50 }),
});

/** A cart that may be empty or large. */
export const cartArb: fc.Arbitrary<CartItem[]> = fc.array(cartItemArb, {
  minLength: 0,
  maxLength: 30,
});

/** A guaranteed non-empty cart (for checkout scenarios). */
export const nonEmptyCartArb: fc.Arbitrary<CartItem[]> = fc.array(cartItemArb, {
  minLength: 1,
  maxLength: 30,
});



// --- Stalls ----------------------------------------------------------------

export const stallArb: fc.Arbitrary<Stall> = fc.record<Stall>({
  id: idArb,
  name: nameArb,
  qrSlug: idArb,
});

/** A set of stalls with distinct ids. */
export const stallsArb: fc.Arbitrary<Stall[]> = fc
  .array(stallArb, { minLength: 1, maxLength: 6 })
  .map((stalls) => {
    const seen = new Set<string>();
    return stalls.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  });

// --- Orders (spanning dates and paid states) -------------------------------

/** ISO timestamp within a window of days around "now". */
function isoTimestampArb(dayOffsetRange = 3): fc.Arbitrary<string> {
  return fc
    .integer({ min: -dayOffsetRange, max: dayOffsetRange })
    .chain((dayOffset) =>
      fc
        .integer({ min: 0, max: 24 * 60 * 60 * 1000 - 1 })
        .map((msIntoDay) => {
          const base = new Date();
          base.setHours(0, 0, 0, 0);
          const ts = base.getTime() + dayOffset * 24 * 60 * 60 * 1000 + msIntoDay;
          return new Date(ts).toISOString();
        })
    );
}

/** Timestamp guaranteed to be on the server's current local day. */
export function todayIsoTimestampArb(): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max: 24 * 60 * 60 * 1000 - 1 }).map((msIntoDay) => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    return new Date(base.getTime() + msIntoDay).toISOString();
  });
}

export const paymentMethodArb: fc.Arbitrary<PaymentMethod> = fc.constantFrom(
  "UPI",
  "cash",
  "other"
);

export interface OrderArbOptions {
  /** Force a specific paid state; otherwise randomized. */
  paid?: boolean;
  /** Force ordering onto the current day; otherwise spans dates. */
  today?: boolean;
  /** Restrict to a specific stall id. */
  stallId?: string;
  /** Restrict item ids/names to a fixed catalog for trending grouping. */
  catalog?: Array<{ itemId: string; name: string }>;
}

export function orderArb(options: OrderArbOptions = {}): fc.Arbitrary<Order> {
  const itemsArb = options.catalog
    ? fc.array(
        fc
          .constantFrom(...options.catalog)
          .chain((entry) =>
            fc
              .record({
                unitPrice: priceArb,
                quantity: fc.integer({ min: 1, max: 10 }),
              })
              .map<CartItem>((rest) => ({
                itemId: entry.itemId,
                name: entry.name,
                ...rest,
              }))
          ),
        { minLength: 1, maxLength: 8 }
      )
    : nonEmptyCartArb;

  const createdAtArb = options.today
    ? todayIsoTimestampArb()
    : isoTimestampArb();
  const paidArb =
    options.paid === undefined ? fc.boolean() : fc.constant(options.paid);
  const stallIdArb = options.stallId ? fc.constant(options.stallId) : idArb;

  return fc
    .record({
      token: idArb,
      stallId: stallIdArb,
      items: itemsArb,
      status: orderStatusArb,
      paid: paidArb,
      paymentMethod: paymentMethodArb,
      gatewayRef: fc.option(idArb, { nil: undefined }),
      customerId: idArb,
      createdAt: createdAtArb,
    })
    .map<Order>((o) => ({
      ...o,
      total: o.items.reduce(
        (sum, it) => sum + it.unitPrice * it.quantity,
        0
      ),
    }));
}

/** A set of orders spanning multiple dates and paid/unpaid states. */
export function orderSetArb(
  options: OrderArbOptions = {}
): fc.Arbitrary<Order[]> {
  return fc.array(orderArb(options), { minLength: 0, maxLength: 20 });
}

// --- Wallets ---------------------------------------------------------------

/** A wallet balance including the boundary value 0. */
export const walletBalanceArb: fc.Arbitrary<number> = fc.nat({ max: 100000 });

export const walletArb: fc.Arbitrary<Wallet> = fc.record<Wallet>({
  customerId: idArb,
  foodCoins: walletBalanceArb,
});

// --- Ratings & metrics -----------------------------------------------------

/** Rating inputs (0..5) for satisfaction-score computation. */
export const ratingsArb: fc.Arbitrary<number[]> = fc.array(ratingArb, {
  minLength: 0,
  maxLength: 50,
});

export const metricsArb: fc.Arbitrary<Metrics> = fc.record<Metrics>({
  totalOrdersToday: fc.nat({ max: 10000 }),
  revenueGenerated: fc.float({ min: 0, max: 1_000_000, noNaN: true }),
  digitalPaymentPercentage: fc.float({ min: 0, max: 100, noNaN: true }),
  bestSellingProduct: fc.option(nameArb, { nil: null }),
  customerSatisfactionScore: fc.float({ min: 0, max: 5, noNaN: true }),
});

// --- Coupons ---------------------------------------------------------------

export const couponArb: fc.Arbitrary<Coupon> = fc.record<Coupon>({
  code: fc.string({ minLength: 3, maxLength: 10 }).map((s) => s.toUpperCase()),
  discountPercent: fc.integer({ min: 1, max: 50 }),
  minOrderValue: fc.integer({ min: 0, max: 1000 }),
  active: fc.boolean(),
});
