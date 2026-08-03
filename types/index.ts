/**
 * Shared type definitions for ByteBites.
 *
 * These types mirror the Data Models section of the design document exactly.
 * They are framework-agnostic and shared across the pure domain modules,
 * the Express API, and the React client.
 */

// --- Enumerated string unions ---------------------------------------------

export type OrderStatus = "Craving Funded" | "Flavor Processing" | "Taste Ready for Pickup" | "Happiness Disbursed";

export type PaymentMethod = "UPI" | "cash" | "other";

/**
 * How the customer receives their order:
 *   - "stall" — collect at the stall counter (default)
 *   - "desk"  — delivered to a desk; requires a desk location + floor number
 */
export type DeliveryType = "stall" | "desk";

// --- Core marketplace models ----------------------------------------------

export interface FoodItem {
  id: string;
  name: string;
  imageUrl: string;
  description: string;
  rating: number; // 0..5 (startup rating)
  availableQuantity: number;
  price: number; // INR, > 0
  stallId: string;
}

export interface CartItem {
  itemId: string;
  name: string;
  unitPrice: number; // INR
  quantity: number; // >= 1
}

export interface Stall {
  id: string;
  name: string;
  qrSlug: string; // used in QR link
}

// --- Customer identity -----------------------------------------------------

/**
 * A customer identified by their mobile number. The normalized mobile number
 * is the canonical customer identifier (`customerId`) used across orders,
 * wallets, and referrals. `mobile` holds the canonical (normalized) form.
 */
export interface Customer {
  mobile: string; // normalized canonical mobile number — the identity key
  name: string;
  email?: string;
}

// --- Ordering models -------------------------------------------------------

export interface Order {
  token: string; // unique Order_Token
  stallId: string;
  items: CartItem[];
  total: number; // INR
  status: OrderStatus;
  paid: boolean;
  paymentMethod: PaymentMethod;
  gatewayRef?: string;
  customerId: string;
  createdAt: string; // ISO timestamp
  pointsUsed?: number; // FoodCoins (reward points) redeemed against this order at checkout
  discount?: number; // INR discount applied from redeemed reward points or coupon at checkout
  couponCode?: string; // Coupon code applied at checkout (e.g. "SAVE10")
  deliveryType?: DeliveryType; // how the order is received (defaults to "stall")
  deskLocation?: string; // desk/table location, when deliveryType is "desk"
  floorNo?: string; // floor number, when deliveryType is "desk"
}

/**
 * A successfully paid order, used by trending and metrics computations.
 * This is the subset shape the pure domain modules operate over.
 */
export type PaidOrder = Order;

// --- Fintech models --------------------------------------------------------

export interface Wallet {
  customerId: string;
  foodCoins: number; // >= 0, integer
}

// --- Coupon models ---------------------------------------------------------

export interface Coupon {
  code: string; // e.g. "SAVE10" (unique)
  discountPercent: number; // e.g. 10 for 10%
  minOrderValue: number; // e.g. 200 INR
  active: boolean;
}

// --- Trending & metrics models --------------------------------------------

export interface TrendingEntry {
  itemId: string;
  name: string;
  unitsOrdered: number;
}

export interface Metrics {
  totalOrdersToday: number;
  revenueGenerated: number; // sum of paid order totals today
  digitalPaymentPercentage: number; // % of paid orders via gateway, 0..100
  bestSellingProduct: string | null;
  customerSatisfactionScore: number; // 0..5
}

// --- Convenient value tuples for enumerations ------------------------------

export const ORDER_STATUS_SEQUENCE: readonly OrderStatus[] = [
  "Craving Funded",
  "Flavor Processing",
  "Taste Ready for Pickup",
  "Happiness Disbursed",
] as const;
