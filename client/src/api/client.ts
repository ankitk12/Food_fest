/**
 * Typed API client for the ByteBites backend.
 *
 * Thin wrappers over `fetch` for each Express endpoint (see the design's API
 * Endpoints table). The client is server-authoritative: it sends inputs and
 * renders whatever state the server returns. The base URL defaults to "/api"
 * (same-origin, proxied in dev) but is configurable via `configureApiBaseUrl`
 * for tests or alternate deployments.
 *
 * All functions return parsed JSON on success and throw `ApiClientError` on a
 * non-2xx response, surfacing the server's consistent `{ error, code }` shape.
 */

import type {
  CartItem,
  Combo,
  Coupon,
  Customer,
  FoodItem,
  Metrics,
  TrendingEntry,
  Wallet,
  OrderStatus,
} from "../../../types/index.js";

// --- Base URL configuration ------------------------------------------------

let baseUrl = "/api";

/** Override the API base URL (e.g. in tests or non-same-origin deployments). */
export function configureApiBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, "");
}

/** Reset base URL to default "/api". Useful between test cases. */
export function resetApiBaseUrl(): void {
  baseUrl = "/api";
}

/** The currently configured API base URL. */
export function getApiBaseUrl(): string {
  return baseUrl;
}

// --- Error type ------------------------------------------------------------

/** Error thrown for non-2xx responses, carrying the server error payload. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

// --- Response payload shapes ----------------------------------------------

export interface CheckoutRequest {
  stallId: string;
  customerId: string;
  customerName?: string;
  items: CartItem[];
  /** Number of reward points to redeem (optional). 2 points = ₹1 discount. */
  redeemPoints?: number;
  /**
   * How the customer is paying. "UPI" runs the digital payment gateway; "cash"
   * is collected at the counter and skips the gateway. Defaults to "UPI".
   */
  paymentMethod?: "UPI" | "cash";
  /** How the order is received: collect at stall (default) or desk delivery. */
  deliveryType?: "stall" | "desk";
  /** Desk/table location — required when `deliveryType` is "desk". */
  deskLocation?: string;
  /** Floor number — required when `deliveryType` is "desk". */
  floorNo?: string;
  /** Preferred delivery/collection time (e.g. "13:30"). */
  pickupTime?: string;
  /** Coupon code to apply for a percentage discount (e.g. "SAVE10"). */
  couponCode?: string;
  /** Razorpay order id from create-order (present for verified online payments). */
  razorpay_order_id?: string;
  /** Razorpay payment id returned by the checkout modal on success. */
  razorpay_payment_id?: string;
  /** Razorpay signature returned by the checkout modal; verified server-side. */
  razorpay_signature?: string;
}

export interface CheckoutResponse {
  token: string;
  status: OrderStatus;
  coinsEarned: number;
  total: number;
  /** Discount applied from redeemed reward points (in rupees). */
  discount: number;
  /** Whether the WhatsApp order-confirmation notification was sent. */
  notified: boolean;
}

/** Request body for registering/upserting a customer. */
export interface CustomerRequest {
  mobile: string;
  name: string;
  email?: string;
}

export interface OrderResponse {
  token: string;
  stallId: string;
  items: CartItem[];
  total: number;
  status: OrderStatus;
  paid: boolean;
  paymentMethod: "UPI" | "cash" | "other";
  gatewayRef?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  customerId: string;
  /** The customer's registered name (empty string when unknown). */
  customerName?: string;
  createdAt: string;
  deliveryType?: "stall" | "desk";
  deskLocation?: string;
  floorNo?: string;
  pickupTime?: string;
}

export interface RedeemResponse extends Wallet { }

// --- Core request helper ---------------------------------------------------

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });

  if (!response.ok) {
    let message = response.statusText;
    let code = "HTTP_ERROR";
    try {
      const body = (await response.json()) as {
        error?: string;
        code?: string;
      };
      if (typeof body.error === "string") message = body.error;
      if (typeof body.code === "string") code = body.code;
    } catch {
      // Non-JSON error body; keep the status text.
    }
    throw new ApiClientError(response.status, message, code);
  }

  // 204 No Content or empty body guard.
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: "POST", body: JSON.stringify(body) });
}

// --- Endpoint functions ----------------------------------------------------

/** GET /api/stalls/:stallId/menu — items for a stall (throws 404 if unknown). */
export function getMenu(stallId: string): Promise<FoodItem[]> {
  return request<FoodItem[]>(
    `/stalls/${encodeURIComponent(stallId)}/menu`
  );
}

/** GET /api/menu — all food items across all stalls. */
export function getAllItems(): Promise<FoodItem[]> {
  return request<FoodItem[]>("/menu");
}

/** Public runtime configuration exposed by the server (read from its env). */
export interface AppConfig {
  /** Merchant UPI VPA used to build the checkout QR / payment intent. */
  merchantVpa: string;
  /** Merchant display name shown in the UPI payment intent / QR. */
  merchantName: string;
  /** Public Razorpay key id; empty string when the gateway is not configured. */
  razorpayKeyId?: string;
  /** Whether the "Pay Online" (Razorpay) method is offered at checkout. */
  paymentOnlineEnabled?: boolean;
  /** Whether the "Pay with UPI" (QR) method is offered at checkout. */
  paymentUpiEnabled?: boolean;
  /** Whether the "Pay with Cash" method is offered at checkout. */
  paymentCashEnabled?: boolean;
}

/** GET /api/config — non-secret runtime config (e.g. merchant UPI identity). */
export function getConfig(): Promise<AppConfig> {
  return request<AppConfig>("/config");
}

/** POST /api/checkout — initiate payment and create an order on success. */
export function checkout(req: CheckoutRequest): Promise<CheckoutResponse> {
  return postJson<CheckoutResponse>("/checkout", req);
}

// --- Razorpay online payment ----------------------------------------------

/** Response from POST /api/create-order. */
export interface CreateRazorpayOrderResponse {
  orderId: string;
  amount: number;
  currency: string;
  /** Public Razorpay key id used to open the checkout modal. */
  keyId: string;
}

/** POST /api/create-order — create a Razorpay order for `amount` (paise). */
export function createRazorpayOrder(req: {
  amount: number;
  currency?: string;
  receipt?: string;
}): Promise<CreateRazorpayOrderResponse> {
  return postJson<CreateRazorpayOrderResponse>("/create-order", req);
}

/** POST /api/verify-payment — verify the Razorpay signature (server-side). */
export function verifyRazorpayPayment(req: {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}): Promise<{ verified: boolean }> {
  return postJson<{ verified: boolean }>("/verify-payment", req);
}

/**
 * POST /api/customers — register/upsert a customer keyed by mobile number.
 * Returns the saved customer. An invalid mobile throws `ApiClientError` with
 * code `INVALID_MOBILE`.
 */
export function registerCustomer(req: CustomerRequest): Promise<Customer> {
  return postJson<Customer>("/customers", req);
}

/**
 * GET /api/customers/:mobile — fetch a customer by mobile number. Throws
 * `ApiClientError` with code `CUSTOMER_NOT_FOUND` for an unknown mobile.
 */
export function getCustomer(mobile: string): Promise<Customer> {
  return request<Customer>(`/customers/${encodeURIComponent(mobile)}`);
}

/**
 * GET /api/admin/orders — list all orders for the seller/admin view,
 * most-recent first. Optionally filtered to a single stall via `stallId`.
 */
export function getAdminOrders(stallId?: string): Promise<OrderResponse[]> {
  const query = stallId ? `?stallId=${encodeURIComponent(stallId)}` : "";
  return request<OrderResponse[]>(`/admin/orders${query}`);
}

/** GET /api/admin/items — list all food items for stock management. */
export function getAdminItems(): Promise<FoodItem[]> {
  return request<FoodItem[]>("/admin/items");
}

/** Request body for creating a new food item via the admin add-item form. */
export interface CreateItemRequest {
  name: string;
  price: number;
  availableQuantity?: number;
  description?: string;
  imageUrl?: string;
  rating?: number;
  /** Extra-cheese add-on price (₹). 0 or omitted means no cheese option. */
  cheesePrice?: number;
  /** Whether a Jain version of this item is available. */
  jainAvailable?: boolean;
  /** Sort position in the menu (lower shows first). Omitted = unsorted. */
  displayOrder?: number;
}

/** POST /api/admin/items — create a new food item; returns the created item. */
export function createItem(req: CreateItemRequest): Promise<FoodItem> {
  return postJson<FoodItem>("/admin/items", req);
}

/** Fields that can be edited on an existing item (all optional). */
export type UpdateItemRequest = Partial<CreateItemRequest>;

/**
 * PATCH /api/admin/items/:itemId — update an existing food item's fields.
 * Only the provided fields are changed. Returns the updated item.
 */
export function updateItem(
  itemId: string,
  patch: UpdateItemRequest
): Promise<FoodItem> {
  return request<FoodItem>(`/admin/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/**
 * DELETE /api/admin/items/:itemId — delete a food item. Resolves on success
 * (204 No Content); throws `ApiClientError` with code `ITEM_NOT_FOUND` when the
 * item is unknown.
 */
export function deleteItem(itemId: string): Promise<void> {
  return request<void>(`/admin/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

/** Overall business summary across all paid orders. */
export interface AdminSummary {
  totalOrders: number;
  totalCollection: number;
  totalRewardPointsUsed: number;
  /** Total INR discount given from redeemed reward points across all orders. */
  totalDiscount: number;
}

/** GET /api/admin/summary — overall totals across all paid orders. */
export function getAdminSummary(): Promise<AdminSummary> {
  return request<AdminSummary>("/admin/summary");
}

/** PATCH /api/admin/items/:itemId/stock — update item stock level. */
export function updateItemStock(
  itemId: string,
  availableQuantity: number
): Promise<FoodItem> {
  return request<FoodItem>(
    `/admin/items/${encodeURIComponent(itemId)}/stock`,
    { method: "PATCH", body: JSON.stringify({ availableQuantity }) }
  );
}

/** PATCH /api/admin/items/:itemId/price — update item price (INR). */
export function updateItemPrice(
  itemId: string,
  price: number
): Promise<FoodItem> {
  return request<FoodItem>(
    `/admin/items/${encodeURIComponent(itemId)}/price`,
    { method: "PATCH", body: JSON.stringify({ price }) }
  );
}

/** GET /api/admin/orders/:token — a single order for the admin view. */
export function getAdminOrder(token: string): Promise<OrderResponse> {
  return request<OrderResponse>(`/admin/orders/${encodeURIComponent(token)}`);
}

/** GET /api/orders/:token — current order state for tracking. */
export function getOrder(token: string): Promise<OrderResponse> {
  return request<OrderResponse>(`/orders/${encodeURIComponent(token)}`);
}

/** GET /api/customers/:mobile/orders — all orders for a customer, most-recent first. */
export function getCustomerOrders(mobile: string): Promise<OrderResponse[]> {
  return request<OrderResponse[]>(
    `/customers/${encodeURIComponent(mobile)}/orders`
  );
}

/** POST /api/orders/:token/advance — operator advances the order status. */
export function advanceOrder(token: string): Promise<OrderResponse> {
  return postJson<OrderResponse>(
    `/orders/${encodeURIComponent(token)}/advance`,
    {}
  );
}

/**
 * POST /api/orders/:token/mark-paid — mark an order's payment as received
 * (e.g. staff confirming a cash payment collected at the counter).
 */
export function markOrderPaid(token: string): Promise<OrderResponse> {
  return postJson<OrderResponse>(
    `/orders/${encodeURIComponent(token)}/mark-paid`,
    {}
  );
}

/** GET /api/metrics — current day's startup metrics. */
export function getMetrics(): Promise<Metrics> {
  return request<Metrics>("/metrics");
}

/** GET /api/trending — items ranked by units ordered today. */
export function getTrending(): Promise<TrendingEntry[]> {
  return request<TrendingEntry[]>("/trending");
}

/** GET /api/wallet/:customerId — FoodCoins balance. */
export function getWallet(customerId: string): Promise<Wallet> {
  return request<Wallet>(`/wallet/${encodeURIComponent(customerId)}`);
}

/** POST /api/wallet/:customerId/redeem — redeem FoodCoins. */
export function redeem(
  customerId: string,
  amount: number
): Promise<RedeemResponse> {
  return postJson<RedeemResponse>(
    `/wallet/${encodeURIComponent(customerId)}/redeem`,
    { amount }
  );
}

// --- Coupons ---------------------------------------------------------------

/** GET /api/coupons — all active coupon codes (public). */
export function getCoupons(): Promise<Coupon[]> {
  return request<Coupon[]>("/coupons");
}

/** GET /api/admin/coupons — all coupons for admin. */
export function getAdminCoupons(): Promise<Coupon[]> {
  return request<Coupon[]>("/admin/coupons");
}

/** POST /api/admin/coupons — create or update a coupon. */
export function createAdminCoupon(
  coupon: Omit<Coupon, "active"> & { active?: boolean }
): Promise<Coupon> {
  return postJson<Coupon>("/admin/coupons", coupon);
}

/** DELETE /api/admin/coupons/:code — delete a coupon. */
export function deleteAdminCoupon(code: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(`/admin/coupons/${encodeURIComponent(code)}`, {
    method: "DELETE",
  });
}

// --- Combos ----------------------------------------------------------------

/** Request body for creating a combo bundle via the admin form. */
export interface CreateComboRequest {
  name: string;
  itemIds: string[];
  price: number;
  imageUrl?: string;
}

/** GET /api/combos — all active combos (public). */
export function getCombos(): Promise<Combo[]> {
  return request<Combo[]>("/combos");
}

/** GET /api/admin/combos — all combos for admin. */
export function getAdminCombos(): Promise<Combo[]> {
  return request<Combo[]>("/admin/combos");
}

/** POST /api/admin/combos — create a combo bundle. */
export function createAdminCombo(combo: CreateComboRequest): Promise<Combo> {
  return postJson<Combo>("/admin/combos", combo);
}

/** DELETE /api/admin/combos/:id — delete a combo. */
export function deleteAdminCombo(id: string): Promise<{ deleted: string }> {
  return request<{ deleted: string }>(`/admin/combos/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
