/**
 * Shared type definitions for ByteBites.
 *
 * These types mirror the Data Models section of the design document exactly.
 * They are framework-agnostic and shared across the pure domain modules,
 * the Express API, and the React client.
 */

// --- Enumerated string unions ---------------------------------------------

export type Spice = "mild" | "medium" | "hot";
export type Flavor = "sweet" | "savory";
export type Portion = "light" | "regular" | "hearty"; // maps to hunger level

export type OrderStatus = "Craving Funded" | "Flavor Processing" | "Taste Ready for Pickup" | "Happiness Disbursed";

export type SpinReward =
  | "5% discount"
  | "free drink"
  | "double FoodCoins"
  | "lucky draw ticket";

export type PaymentMethod = "UPI" | "cash" | "other";

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
  spice: Spice;
  flavor: Flavor;
  portion: Portion; // maps to hunger level
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
  spinUsed: boolean;
  spinReward?: SpinReward; // the reward drawn for this order's single spin, once used
  pointsUsed?: number; // FoodCoins (reward points) redeemed against this order at checkout
  discount?: number; // INR discount applied from redeemed reward points at checkout
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

export interface Referral {
  customerId: string;
  link: string; // unique
  creditedReferredIds: string[]; // referred customers already rewarded (once each)
}

// --- AI Chef models --------------------------------------------------------

export interface Preferences {
  hunger: Portion;
  spice: Spice;
  taste: Flavor;
}

export interface RecommendedItem {
  item: FoodItem;
  confidence: number; // 0..100
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

// --- Payment gateway models ------------------------------------------------

export interface PaymentResult {
  success: boolean;
  gatewayRef?: string; // Paytm transaction reference when successful
  failureReason?: string;
}

export interface OrderContext {
  stallId: string;
  customerId: string;
  items: CartItem[];
}

export interface PaymentGateway {
  initiatePayment(
    amountInRupees: number,
    orderContext: OrderContext
  ): Promise<PaymentResult>;
}

// --- Notification gateway models -------------------------------------------

/** Parameters for an order-confirmation notification (e.g. WhatsApp). */
export interface OrderConfirmationParams {
  /** The customer's mobile number the confirmation is sent to. */
  toMobile: string;
  /** The order's unique pickup token. */
  token: string;
  /** The order total in INR. */
  total: number;
  /** The ordered line items. */
  items: CartItem[];
  /** The originating stall's display name, when available. */
  stallName?: string;
}

/** The outcome of attempting to send a notification. */
export interface NotificationResult {
  sent: boolean;
  /** A provider reference for a sent message (e.g. WhatsApp message id). */
  ref?: string;
  /** A human-readable reason when the send did not succeed. */
  error?: string;
}

/**
 * A pluggable notification gateway, mirroring the `PaymentGateway` pattern.
 * Implementations deliver an order-confirmation message to the customer.
 */
export interface NotificationGateway {
  sendOrderConfirmation(
    params: OrderConfirmationParams
  ): Promise<NotificationResult>;
}

// --- Convenient value tuples for enumerations ------------------------------

export const ORDER_STATUS_SEQUENCE: readonly OrderStatus[] = [
  "Craving Funded",
  "Flavor Processing",
  "Taste Ready for Pickup",
  "Happiness Disbursed",
] as const;

export const SPIN_REWARDS: readonly SpinReward[] = [
  "5% discount",
  "free drink",
  "double FoodCoins",
  "lucky draw ticket",
] as const;

export const SPICE_VALUES: readonly Spice[] = ["mild", "medium", "hot"] as const;
export const FLAVOR_VALUES: readonly Flavor[] = ["sweet", "savory"] as const;
export const PORTION_VALUES: readonly Portion[] = [
  "light",
  "regular",
  "hearty",
] as const;
