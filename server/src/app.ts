/**
 * Express application factory for ByteBites.
 *
 * The app is created via a factory that accepts its collaborators (the
 * in-memory `Store` and a `PaymentGateway`) rather than reaching for module
 * singletons. This keeps the API testable — tests can build an app around a
 * store seeded with generated data and a deterministic `MockGateway` — and
 * reusable as later endpoint tasks register additional routes here.
 *
 * All API error responses use a consistent JSON shape `{ error, code }` with
 * an appropriate HTTP status code (see the design's Error Handling section).
 *
 * Validates: Requirements 4.1, 4.3
 */

import express, { type Express, type Request, type Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  CartItem,
  Customer,
  FoodItem,
  Order,
} from "../../types/index.js";
import type { Store } from "./store.js";
import { StoreOrderRepo, type OrderRepo } from "./order-repo.js";
import { orderTotal } from "../../domain/pricing.js";
import { coinsForOrder, applyRedemption } from "../../domain/foodcoins.js";
import { issueToken } from "../../domain/tokens.js";
import { nextStatus } from "../../domain/order-status.js";
import { computeMetrics } from "../../domain/metrics.js";
import { rankTrending } from "../../domain/trending.js";
import { normalizeMobile, isValidMobile } from "../../domain/mobile.js";

import {
  StoreCustomerRepo,
  StoreWalletRepo,
  StoreFoodItemRepo,
  StoreCouponRepo,
  StoreComboRepo,
  type CustomerRepo,
  type WalletRepo,
  type FoodItemRepo,
  type CouponRepo,
  type ComboRepo,
} from "./repos.js";

/** Collaborators required to build the app. */
export interface AppDependencies {
  store: Store;
  /**
   * Order data access. Defaults to a Store-backed repo (in-memory / JSON
   * backend). The Prisma/Postgres backend injects a repo that reads/writes the
   * Order table directly so orders stay consistent across serverless instances.
   */
  orderRepo?: OrderRepo;
  customerRepo?: CustomerRepo;
  walletRepo?: WalletRepo;
  foodItemRepo?: FoodItemRepo;
  couponRepo?: CouponRepo;
  comboRepo?: ComboRepo;
}

/** The consistent error payload shape used by every API error response. */
export interface ApiError {
  error: string;
  code: string;
}

/**
 * Order the menu for display: items with an admin-set `displayOrder` come
 * first (ascending), then items without one, each group broken alphabetically
 * by name. Returns a new sorted array (does not mutate the input).
 */
function sortByDisplayOrder(items: FoodItem[]): FoodItem[] {
  return [...items].sort((a, b) => {
    const ao = a.displayOrder ?? Number.POSITIVE_INFINITY;
    const bo = b.displayOrder ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Parse a boolean-ish environment flag. Unset falls back to `defaultValue`;
 * "false"/"0"/"no"/"off" (any case) are false; anything else is true.
 */
function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return defaultValue;
  return !["false", "0", "no", "off"].includes(raw.trim().toLowerCase());
}

/**
 * Verify a Razorpay payment signature: HMAC-SHA256(orderId + "|" + paymentId)
 * keyed with RAZORPAY_KEY_SECRET, compared (timing-safe) against the signature
 * returned by Razorpay Checkout. Returns false if the secret is unset or any
 * field is missing/mismatched. The KEY_SECRET is read from the environment and
 * never leaves the server.
 */
function verifyRazorpaySignature(
  orderId: string,
  paymentId: string,
  signature: string
): boolean {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  const expected = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const actualBuf = Buffer.from(signature, "utf8");
  return (
    expectedBuf.length === actualBuf.length &&
    timingSafeEqual(expectedBuf, actualBuf)
  );
}

/**
 * Build a configured Express app around the provided store.
 * Each endpoint task registers its routes on the app created here.
 */
export function createApp(deps: AppDependencies): Express {
  const { store } = deps;
  const orderRepo: OrderRepo = deps.orderRepo ?? new StoreOrderRepo(store);
  const customerRepo: CustomerRepo = deps.customerRepo ?? new StoreCustomerRepo(store);
  const walletRepo: WalletRepo = deps.walletRepo ?? new StoreWalletRepo(store);
  const foodItemRepo: FoodItemRepo = deps.foodItemRepo ?? new StoreFoodItemRepo(store);
  const couponRepo: CouponRepo = deps.couponRepo ?? new StoreCouponRepo(store);
  const comboRepo: ComboRepo = deps.comboRepo ?? new StoreComboRepo(store);
  const app = express();

  app.use(express.json());

  /**
   * Enrich an order with the customer's registered name (looked up by the
   * customerId mobile) so the admin views show a name alongside the number.
   * The name is an empty string when the customer has no registered name.
   */
  const withCustomerName = async (
    order: Order
  ): Promise<Order & { customerName: string }> => {
    // Read the customer directly from the DB (via the repo) rather than the
    // in-memory store, so a name registered on another serverless instance is
    // still resolved here.
    const customer = await customerRepo.get(order.customerId);
    return { ...order, customerName: customer?.name ?? "" };
  };

  // --- GET /api/stalls/:stallId/menu -------------------------------------
  //
  // Returns only the requested stall's items (Requirement 4.1). When the stall
  // is unknown, responds 404 with the consistent `{ error, code }` shape
  // (Requirement 4.3).
  app.get(
    "/api/stalls/:stallId/menu",
    async (req: Request, res: Response): Promise<void> => {
      const { stallId } = req.params;

      if (!store.hasStall(stallId)) {
        const body: ApiError = {
          error: "Stall not found",
          code: "STALL_NOT_FOUND",
        };
        res.status(404).json(body);
        return;
      }

      // Read the live catalogue/stock directly from the database.
      const menu = (await foodItemRepo.list()).filter(
        (item) => item.stallId === stallId
      );
      res.status(200).json(sortByDisplayOrder(menu));
    }
  );

  // --- GET /api/menu ------------------------------------------------------
  //
  // Returns ALL food items across ALL stalls. Used by the marketplace to
  // display the full catalogue to users. Reads live stock directly from the DB.
  app.get("/api/menu", async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(sortByDisplayOrder(await foodItemRepo.list()));
  });

  // --- GET /api/config ----------------------------------------------------
  //
  // Public, non-secret runtime configuration for the client. Values are read
  // from the environment (e.g. Vercel Project Environment Variables) at request
  // time, so they can be changed from the dashboard without rebuilding the
  // client. Currently exposes the merchant UPI identity used to build the
  // checkout QR / payment intent, with demo defaults when unset.
  app.get("/api/config", (_req: Request, res: Response): void => {
    const razorpayKeyId = process.env.RAZORPAY_KEY_ID ?? "";
    res.status(200).json({
      merchantVpa: process.env.MERCHANT_VPA ?? "invest-a-bite@upi",
      merchantName: process.env.MERCHANT_NAME ?? "Invest-A-Bite",
      // Public Razorpay key id (safe to expose); empty when the gateway is not
      // configured, which the client uses to hide the online-pay option.
      razorpayKeyId,
      // Which payment methods to offer at checkout, toggled via env. Online pay
      // additionally requires Razorpay to be configured (a key id present).
      paymentOnlineEnabled:
        envFlag("PAYMENT_ONLINE_ENABLED", true) && razorpayKeyId !== "",
      paymentUpiEnabled: envFlag("PAYMENT_UPI_ENABLED", true),
      paymentCashEnabled: envFlag("PAYMENT_CASH_ENABLED", true),
    });
  });

  // --- POST /api/create-order ---------------------------------------------
  //
  // Create a Razorpay order for the Standard Checkout flow. Accepts the amount
  // in paise (>= 100), an optional currency (default INR) and receipt, calls
  // the Razorpay Orders API with HTTP Basic auth (key id : key secret, read
  // from the environment — the secret never reaches the client), and returns
  // the order id + amount + currency + public key id for the checkout modal.
  app.post("/api/create-order", async (req: Request, res: Response): Promise<void> => {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      res.status(500).json({
        error: "Payment gateway is not configured",
        code: "GATEWAY_NOT_CONFIGURED",
      });
      return;
    }

    const body = (req.body ?? {}) as {
      amount?: unknown;
      currency?: unknown;
      receipt?: unknown;
    };

    const amount =
      typeof body.amount === "number" && Number.isFinite(body.amount)
        ? Math.round(body.amount)
        : NaN;
    if (!Number.isFinite(amount) || amount < 100) {
      res.status(400).json({
        error: "amount must be an integer of at least 100 paise",
        code: "INVALID_AMOUNT",
      });
      return;
    }

    const currency =
      typeof body.currency === "string" && body.currency.trim() !== ""
        ? body.currency.trim()
        : "INR";
    const receipt =
      typeof body.receipt === "string" && body.receipt.trim() !== ""
        ? body.receipt.trim()
        : `rcpt_${Date.now()}`;

    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({ amount, currency, receipt }),
      });

      if (rzpRes.status === 401) {
        res.status(401).json({
          error: "Payment gateway authentication failed",
          code: "GATEWAY_AUTH_FAILED",
        });
        return;
      }
      if (!rzpRes.ok) {
        const detail = await rzpRes.text();
        console.error("Razorpay create-order failed:", rzpRes.status, detail);
        res.status(500).json({
          error: "Failed to create payment order",
          code: "GATEWAY_ERROR",
        });
        return;
      }

      const order = (await rzpRes.json()) as {
        id: string;
        amount: number;
        currency: string;
      };
      res.status(201).json({
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        keyId,
      });
    } catch (err) {
      console.error("Razorpay create-order error:", err);
      res.status(500).json({
        error: "Failed to create payment order",
        code: "GATEWAY_ERROR",
      });
    }
  });

  // --- POST /api/verify-payment -------------------------------------------
  //
  // Verify a Razorpay payment signature (HMAC-SHA256 of "orderId|paymentId"
  // keyed with the secret). Returns { verified: true } only when the signature
  // matches; a mismatch is 400 (never marks anything paid) and missing fields
  // are 400. Order finalization (marking paid) happens in /api/checkout, which
  // re-verifies authoritatively — this endpoint is the standalone verifier.
  app.post("/api/verify-payment", (req: Request, res: Response): void => {
    if (!process.env.RAZORPAY_KEY_SECRET) {
      res.status(500).json({
        error: "Payment gateway is not configured",
        code: "GATEWAY_NOT_CONFIGURED",
      });
      return;
    }
    const body = (req.body ?? {}) as {
      razorpay_order_id?: unknown;
      razorpay_payment_id?: unknown;
      razorpay_signature?: unknown;
    };
    const orderId =
      typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
    const paymentId =
      typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature =
      typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";

    if (!orderId || !paymentId || !signature) {
      res.status(400).json({
        error: "Missing payment verification fields",
        code: "MISSING_FIELDS",
      });
      return;
    }

    if (!verifyRazorpaySignature(orderId, paymentId, signature)) {
      res.status(400).json({
        error: "Payment signature verification failed",
        code: "SIGNATURE_MISMATCH",
      });
      return;
    }

    res.status(200).json({ verified: true });
  });

  // --- POST /api/customers ------------------------------------------------
  //
  // Register or upsert a customer keyed by their mobile number. The mobile
  // number is normalized to a canonical form and validated as a plausible
  // phone number (10–15 digits, optional leading "+"); an invalid mobile is
  // rejected with 400 `{ error, code: "INVALID_MOBILE" }`. The normalized
  // mobile becomes the customer's identity (customerId) across the system.
  app.post("/api/customers", (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as {
      mobile?: unknown;
      name?: unknown;
      email?: unknown;
    };

    if (!isValidMobile(body.mobile)) {
      const errBody: ApiError = {
        error:
          "A valid mobile number is required",
        code: "INVALID_MOBILE",
      };
      res.status(400).json(errBody);
      return;
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      const errBody: ApiError = {
        error: "Name is required",
        code: "INVALID_NAME",
      };
      res.status(400).json(errBody);
      return;
    }

    const mobile = normalizeMobile(body.mobile);
    const email = typeof body.email === "string" ? body.email : undefined;

    const customer: Customer = { mobile, name, ...(email ? { email } : {}) };
    store.saveCustomer(customer);
    res.status(201).json(customer);
  });

  // --- GET /api/customers/:mobile -----------------------------------------
  //
  // Fetch a customer by (raw or normalized) mobile number. The path value is
  // normalized before lookup so any formatting maps to the same customer. An
  // unknown mobile yields 404 `{ error, code: "CUSTOMER_NOT_FOUND" }`.
  app.get("/api/customers/:mobile", (req: Request, res: Response): void => {
    const mobile = normalizeMobile(req.params.mobile);
    const customer = store.getCustomer(mobile);
    if (!customer) {
      const errBody: ApiError = {
        error: "Customer not found",
        code: "CUSTOMER_NOT_FOUND",
      };
      res.status(404).json(errBody);
      return;
    }
    res.status(200).json(customer);
  });

  // --- POST /api/checkout -------------------------------------------------
  //
  // Confirms checkout for a non-empty cart. The order total is recomputed
  // server-side from the cart's unit prices and quantities via the pricing
  // domain (never trusting a client-supplied total). An empty cart is rejected
  // with 400 BEFORE any gateway call (see Error Handling). On a successful
  // payment the server creates an order (status "Craving Funded", associated
  // with the originating stall), issues a unique token, credits FoodCoins to
  // the customer's wallet, and marks the single spin available. It then sends
  // an order confirmation to the customer's mobile via the notification
  // gateway; a notification failure does NOT fail the order (the response
  // carries a `notified` flag). A failed payment creates no order and returns a
  // failure response so the client can retain the cart.
  //
  // The customerId is the customer's mobile number, normalized to a canonical
  // form; a checkout for an unregistered mobile still succeeds and auto-creates
  // a minimal customer record.
  //
  // Validates: Requirements 5.1, 5.2, 5.3, 5.4, 9.1
  app.post(
    "/api/checkout",
    async (req: Request, res: Response): Promise<void> => {
      const body = (req.body ?? {}) as {
        stallId?: unknown;
        customerId?: unknown;
        items?: unknown;
        redeemPoints?: unknown;
        paymentMethod?: unknown;
        deliveryType?: unknown;
        deskLocation?: unknown;
        floorNo?: unknown;
        pickupTime?: unknown;
        couponCode?: unknown;
        razorpay_order_id?: unknown;
        razorpay_payment_id?: unknown;
        razorpay_signature?: unknown;
      };

      const items = Array.isArray(body.items) ? (body.items as CartItem[]) : [];
      const stallId = typeof body.stallId === "string" ? body.stallId : "";
      // Payment method: "cash" is collected at the counter (no gateway); any
      // other value defaults to the digital UPI gateway flow.
      const payWithCash = body.paymentMethod === "cash";
      // Delivery type: "desk" delivers to a desk (needs a location + floor);
      // anything else defaults to collecting at the stall counter.
      const deliverToDesk = body.deliveryType === "desk";
      const deskLocation =
        typeof body.deskLocation === "string" ? body.deskLocation.trim() : "";
      const floorNo =
        typeof body.floorNo === "string" ? body.floorNo.trim() : "";
      const pickupTime =
        typeof body.pickupTime === "string" ? body.pickupTime.trim() : "";
      const redeemPoints =
        typeof body.redeemPoints === "number" && body.redeemPoints > 0
          ? Math.floor(body.redeemPoints)
          : 0;
      const couponCodeRaw =
        typeof body.couponCode === "string" ? body.couponCode.trim().toUpperCase() : null;
      // The customer identity is their mobile number, normalized to a canonical
      // form so wallet/referral/order association all key off the same value.
      // A checkout for an unregistered mobile still works — a minimal customer
      // is auto-created below. Only genuine mobile numbers are normalized;
      // any other (legacy/opaque) customer id is used as-is so it is never
      // altered or lost.
      const rawCustomerId =
        typeof body.customerId === "string" ? body.customerId : "";
      const customerId = isValidMobile(rawCustomerId)
        ? normalizeMobile(rawCustomerId)
        : rawCustomerId.trim();

      // Reject an empty cart before contacting the gateway (Req 5.1 guard).
      if (items.length === 0) {
        const errBody: ApiError = {
          error: "Cannot checkout with an empty cart",
          code: "EMPTY_CART",
        };
        res.status(400).json(errBody);
        return;
      }

      // Razorpay (online) payment: when the client supplies the payment proof,
      // the signature is verified server-side. A valid signature marks the
      // order as paid; an invalid one is rejected (no order is created).
      const rzpOrderId =
        typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
      const rzpPaymentId =
        typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
      const rzpSignature =
        typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
      const hasGatewayProof = rzpOrderId !== "" && rzpPaymentId !== "";
      if (hasGatewayProof) {
        if (!verifyRazorpaySignature(rzpOrderId, rzpPaymentId, rzpSignature)) {
          const errBody: ApiError = {
            error: "Payment signature verification failed",
            code: "PAYMENT_VERIFICATION_FAILED",
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // Desk delivery requires a location and floor number.
      if (deliverToDesk && (deskLocation === "" || floorNo === "")) {
        const errBody: ApiError = {
          error: "Desk delivery requires a desk location and floor number",
          code: "INVALID_DELIVERY",
        };
        res.status(400).json(errBody);
        return;
      }

      // Validate stock: reject if any item is out of stock or quantity exceeds
      // available stock. This prevents orders for items the admin has marked
      // out of stock, even if the user's client hasn't refreshed yet.
      for (const cartItem of items) {
        // A combo line validates each of its clubbed items; a normal line
        // validates just its own item.
        const idsToCheck =
          cartItem.comboItemIds && cartItem.comboItemIds.length > 0
            ? cartItem.comboItemIds
            : [cartItem.itemId];
        for (const id of idsToCheck) {
          const foodItem = await foodItemRepo.get(id);
          if (foodItem && foodItem.availableQuantity < cartItem.quantity) {
            const errBody: ApiError = {
              error:
                foodItem.availableQuantity === 0
                  ? `"${foodItem.name}" is out of stock`
                  : `"${foodItem.name}" only has ${foodItem.availableQuantity} available (you requested ${cartItem.quantity})`,
              code: "INSUFFICIENT_STOCK",
            };
            res.status(400).json(errBody);
            return;
          }
        }
      }

      // Recompute the total server-side; the client total is never trusted.
      const subtotal = orderTotal(items);

      // Apply reward points discount if requested (2 points = ₹1).
      let discount = 0;
      let pointsUsed = 0;
      let appliedCouponCode: string | undefined;

      if (couponCodeRaw) {
        // Coupon takes priority over FoodCoins if both are provided.
        const coupon = await couponRepo.get(couponCodeRaw);
        if (!coupon || !coupon.active) {
          res.status(400).json({ error: "Invalid or expired coupon code", code: "COUPON_INVALID" });
          return;
        }
        if (subtotal < coupon.minOrderValue) {
          res.status(400).json({
            error: `Minimum order value of ₹${coupon.minOrderValue} required for coupon ${coupon.code}`,
            code: "MIN_ORDER_NOT_MET",
          });
          return;
        }
        discount = Math.round((subtotal * coupon.discountPercent) / 100 * 100) / 100;
        discount = Math.min(discount, subtotal);
        appliedCouponCode = coupon.code;
      } else if (redeemPoints > 0) {
        const wallet = await walletRepo.get(customerId);
        const usable = Math.min(redeemPoints, wallet?.foodCoins ?? 0);
        discount = usable * 0.50; // 2 points = ₹1
        // Don't discount more than the order total.
        discount = Math.min(discount, subtotal);
        pointsUsed = Math.ceil(discount * 2); // exact points consumed
      }
      const total = Math.max(0, subtotal - discount);

      // Deduct redeemed reward points from the wallet.
      if (pointsUsed > 0) {
        await walletRepo.deductCoins(customerId, pointsUsed);
      }

      // Success: issue a unique token against the store's existing tokens,
      // create the order in "Craving Funded" state associated with the stall,
      // credit FoodCoins, and mark the spin available (Req 5.2, 5.4, 9.1).
      const token = issueToken(await orderRepo.usedTokens());
      const order: Order = {
        token,
        stallId,
        items,
        total,
        status: "Craving Funded",
        // A verified Razorpay payment marks the order paid immediately; cash /
        // manual-UPI orders stay pending until staff confirm receipt.
        paid: hasGatewayProof,
        paymentMethod: payWithCash ? "cash" : "UPI",
        ...(hasGatewayProof
          ? {
              gatewayRef: rzpPaymentId,
              razorpayOrderId: rzpOrderId,
              razorpayPaymentId: rzpPaymentId,
              razorpaySignature: rzpSignature,
            }
          : {}),
        customerId,
        createdAt: new Date().toISOString(),
        pointsUsed,
        discount,
        ...(appliedCouponCode ? { couponCode: appliedCouponCode } : {}),
        deliveryType: deliverToDesk ? "desk" : "stall",
        ...(deliverToDesk ? { deskLocation, floorNo } : {}),
        ...(pickupTime ? { pickupTime } : {}),
      };
      await orderRepo.save(order);

      // Deduct ordered quantities from stock so availability updates in
      // real-time for other users. Written directly to the DB (awaited) so the
      // change is durable immediately, not on a background write.
      for (const cartItem of items) {
        // A combo line deducts each clubbed item; a normal line deducts itself.
        const idsToDeduct =
          cartItem.comboItemIds && cartItem.comboItemIds.length > 0
            ? cartItem.comboItemIds
            : [cartItem.itemId];
        for (const id of idsToDeduct) {
          const currentItem = await foodItemRepo.get(id);
          if (currentItem) {
            await foodItemRepo.updateStock(
              id,
              Math.max(0, currentItem.availableQuantity - cartItem.quantity)
            );
          }
        }
      }

      const coinsEarned = coinsForOrder(total);
      if (coinsEarned > 0) {
        await walletRepo.addCoins(customerId, coinsEarned);
      }

      // Auto-create a minimal customer for a checkout by an unregistered mobile
      // so the identity exists for later lookups (checkout does not require a
      // prior registration). Existing customers are left untouched.
      if (
        isValidMobile(customerId) &&
        !(await customerRepo.get(customerId))
      ) {
        await customerRepo.save({ mobile: customerId, name: "" });
      }

      res.status(201).json({
        token,
        status: order.status,
        coinsEarned,
        total,
        discount,
      });
    }
  );

  // --- GET /api/orders/:token ---------------------------------------------
  //
  // Returns the stored order so the customer can track its current status. The
  // status displayed is exactly the order's stored Order_Status. Unknown
  // tokens yield a 404 with the consistent `{ error, code }` shape.
  //
  // Validates: Requirements 6.3
  app.get("/api/orders/:token", async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;
    const order = await orderRepo.get(token);
    if (!order) {
      const errBody: ApiError = {
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      };
      res.status(404).json(errBody);
      return;
    }
    res.status(200).json(order);
  });

  // --- POST /api/orders/:token/advance ------------------------------------
  //
  // Advances the order to the next status via the order-status domain.
  // Advancing an order already at "Happiness Disbursed" is a no-op (it stays).
  // Unknown tokens yield a 404.
  //
  // Validates: Requirements 6.2, 6.3
  app.post(
    "/api/orders/:token/advance",
    async (req: Request, res: Response): Promise<void> => {
      const { token } = req.params;
      const order = await orderRepo.get(token);
      if (!order) {
        const errBody: ApiError = {
          error: "Order not found",
          code: "ORDER_NOT_FOUND",
        };
        res.status(404).json(errBody);
        return;
      }

      order.status = nextStatus(order.status);
      await orderRepo.save(order);

      res.status(200).json(order);
    }
  );

  // --- POST /api/orders/:token/mark-paid ----------------------------------
  //
  // Marks an order's payment as received (e.g. staff confirming a cash payment
  // collected at the counter). Idempotent: marking an already-paid order simply
  // returns it unchanged. Unknown tokens yield a 404.
  //
  // SECURITY NOTE: like the /api/admin/* routes, this is unauthenticated for
  // the festival demo and MUST be placed behind staff authentication in
  // production.
  app.post(
    "/api/orders/:token/mark-paid",
    async (req: Request, res: Response): Promise<void> => {
      const { token } = req.params;
      const order = await orderRepo.get(token);
      if (!order) {
        const errBody: ApiError = {
          error: "Order not found",
          code: "ORDER_NOT_FOUND",
        };
        res.status(404).json(errBody);
        return;
      }

      order.paid = true;
      await orderRepo.save(order);

      res.status(200).json(order);
    }
  );

  // --- Admin / seller order-management API --------------------------------
  //
  // SECURITY NOTE: These `/api/admin/*` endpoints are UNAUTHENTICATED for the
  // festival demo — anyone who can reach the server can list and inspect all
  // orders across every stall. In production these MUST be placed behind seller
  // authentication and authorization (e.g. a seller session/JWT scoped to the
  // seller's own stall(s)) before exposing customer order data. Do not ship
  // these open to the internet as-is.

  // --- GET /api/customers/:mobile/orders ----------------------------------
  //
  // Returns all orders for a given customer (identified by mobile number),
  // most-recent first by createdAt. Returns an empty array if the customer has
  // no orders.
  app.get(
    "/api/customers/:mobile/orders",
    async (req: Request, res: Response): Promise<void> => {
      const { mobile } = req.params;
      const orders = (await orderRepo.list())
        .filter((o) => o.customerId === mobile)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      res.status(200).json(orders);
    }
  );

  // --- GET /api/admin/orders ----------------------------------------------
  //
  // Lists all orders for a seller/admin, most-recent first (by createdAt).
  // Optionally filterable to a single stall via `?stallId=`. Each order is
  // enriched with the customer's registered name (looked up by the customerId
  // mobile) so the admin sees a name alongside the number.
  app.get("/api/admin/orders", async (req: Request, res: Response): Promise<void> => {
    const stallId =
      typeof req.query.stallId === "string" ? req.query.stallId : undefined;

    let orders = await orderRepo.list();
    if (stallId) {
      orders = orders.filter((o) => o.stallId === stallId);
    }
    // Most-recent first. createdAt is an ISO timestamp so lexicographic
    // descending order is chronological descending order.
    orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.status(200).json(await Promise.all(orders.map((o) => withCustomerName(o))));
  });

  // --- GET /api/admin/orders/:token ---------------------------------------
  //
  // Fetch a single order by token for the admin view. Unknown tokens yield a
  // 404 with the consistent `{ error, code }` shape. (Same UNAUTHENTICATED
  // caveat as GET /api/admin/orders above.)
  app.get("/api/admin/orders/:token", async (req: Request, res: Response): Promise<void> => {
    const order = await orderRepo.get(req.params.token);
    if (!order) {
      const errBody: ApiError = {
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      };
      res.status(404).json(errBody);
      return;
    }
    res.status(200).json(await withCustomerName(order));
  });

  // --- GET /api/admin/items -----------------------------------------------
  //
  // Lists all food items across all stalls for stock management. Reads the
  // live catalogue and stock levels directly from the database.
  app.get("/api/admin/items", async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(sortByDisplayOrder(await foodItemRepo.list()));
  });

  // --- POST /api/admin/items ----------------------------------------------
  //
  // Creates a new food item for a stall (an admin "add item" action). Validates
  // the required fields (name, positive price, existing stallId, non-negative
  // availableQuantity) and applies sensible defaults for the optional
  // presentation/recommender attributes. Returns 201 with the created item
  // (including its server-generated id).
  //
  // SECURITY NOTE: like the other /api/admin/* routes, this is unauthenticated
  // for the festival demo and MUST be placed behind seller authentication in
  // production.
  app.post("/api/admin/items", async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      name?: unknown;
      price?: unknown;
      availableQuantity?: unknown;
      description?: unknown;
      imageUrl?: unknown;
      rating?: unknown;
      cheesePrice?: unknown;
      jainAvailable?: unknown;
      displayOrder?: unknown;
      spice?: unknown;
      flavor?: unknown;
      portion?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      const errBody: ApiError = {
        error: "name is required",
        code: "INVALID_ITEM",
      };
      res.status(400).json(errBody);
      return;
    }

    if (
      typeof body.price !== "number" ||
      !Number.isFinite(body.price) ||
      body.price <= 0
    ) {
      const errBody: ApiError = {
        error: "price must be a positive number",
        code: "INVALID_PRICE",
      };
      res.status(400).json(errBody);
      return;
    }

    // New items are assigned to the default (first) stall; the admin UI no
    // longer chooses a stall. A stall is still required by the data model so
    // the item shows up in the marketplace/menus.
    const stallId = store.getStalls()[0]?.id ?? "";

    // availableQuantity is optional; defaults to 0 (out of stock). When
    // provided it must be a non-negative number.
    let availableQuantity = 0;
    if (body.availableQuantity !== undefined) {
      if (
        typeof body.availableQuantity !== "number" ||
        !Number.isFinite(body.availableQuantity) ||
        body.availableQuantity < 0
      ) {
        const errBody: ApiError = {
          error: "availableQuantity must be a non-negative number",
          code: "INVALID_QUANTITY",
        };
        res.status(400).json(errBody);
        return;
      }
      availableQuantity = Math.floor(body.availableQuantity);
    }

    const rating =
      typeof body.rating === "number" &&
      Number.isFinite(body.rating) &&
      body.rating >= 0 &&
      body.rating <= 5
        ? body.rating
        : 4.5;

    const cheesePrice =
      typeof body.cheesePrice === "number" &&
      Number.isFinite(body.cheesePrice) &&
      body.cheesePrice > 0
        ? body.cheesePrice
        : 0;

    const created = store.createFoodItem({
      name,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
      description: typeof body.description === "string" ? body.description : "",
      rating,
      availableQuantity,
      price: body.price,
      stallId,
      cheesePrice,
      jainAvailable: body.jainAvailable === true,
      ...(typeof body.displayOrder === "number" &&
      Number.isFinite(body.displayOrder)
        ? { displayOrder: Math.floor(body.displayOrder) }
        : {}),
    });

    // Also write directly to the catalogue table (awaited) so the new item is
    // durable immediately, and flush any pending snapshot write.
    await foodItemRepo.save(created);
    await store.flush();

    res.status(201).json(created);
  });

  // --- PATCH /api/admin/items/:itemId -------------------------------------
  //
  // Updates an existing food item's editable fields (an admin "edit item"
  // action). Every field is optional; only the provided, valid fields are
  // changed. Validates types/ranges the same way the create route does and
  // rejects an unknown item (404) or an unknown target stall (404). Returns the
  // updated item.
  //
  // SECURITY NOTE: like the other /api/admin/* routes, this is unauthenticated
  // for the festival demo and MUST be placed behind seller authentication in
  // production.
  app.patch("/api/admin/items/:itemId", async (req: Request, res: Response): Promise<void> => {
    const { itemId } = req.params;
    const body = (req.body ?? {}) as {
      name?: unknown;
      price?: unknown;
      availableQuantity?: unknown;
      description?: unknown;
      imageUrl?: unknown;
      rating?: unknown;
      cheesePrice?: unknown;
      jainAvailable?: unknown;
      displayOrder?: unknown;
      spice?: unknown;
      flavor?: unknown;
      portion?: unknown;
    };

    const existing = store.getFoodItem(itemId);
    if (!existing) {
      const errBody: ApiError = {
        error: "Item not found",
        code: "ITEM_NOT_FOUND",
      };
      res.status(404).json(errBody);
      return;
    }

    const patch: Partial<Omit<FoodItem, "id">> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        const errBody: ApiError = {
          error: "name must be a non-empty string",
          code: "INVALID_ITEM",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.name = body.name.trim();
    }

    if (body.price !== undefined) {
      if (
        typeof body.price !== "number" ||
        !Number.isFinite(body.price) ||
        body.price <= 0
      ) {
        const errBody: ApiError = {
          error: "price must be a positive number",
          code: "INVALID_PRICE",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.price = body.price;
    }

    if (body.availableQuantity !== undefined) {
      if (
        typeof body.availableQuantity !== "number" ||
        !Number.isFinite(body.availableQuantity) ||
        body.availableQuantity < 0
      ) {
        const errBody: ApiError = {
          error: "availableQuantity must be a non-negative number",
          code: "INVALID_QUANTITY",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.availableQuantity = Math.floor(body.availableQuantity);
    }

    if (body.rating !== undefined) {
      if (
        typeof body.rating !== "number" ||
        !Number.isFinite(body.rating) ||
        body.rating < 0 ||
        body.rating > 5
      ) {
        const errBody: ApiError = {
          error: "rating must be a number between 0 and 5",
          code: "INVALID_RATING",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.rating = body.rating;
    }

    if (body.cheesePrice !== undefined) {
      if (
        typeof body.cheesePrice !== "number" ||
        !Number.isFinite(body.cheesePrice) ||
        body.cheesePrice < 0
      ) {
        const errBody: ApiError = {
          error: "cheesePrice must be a non-negative number",
          code: "INVALID_ITEM",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.cheesePrice = body.cheesePrice;
    }

    if (typeof body.jainAvailable === "boolean") {
      patch.jainAvailable = body.jainAvailable;
    }

    if (body.displayOrder !== undefined) {
      if (
        typeof body.displayOrder !== "number" ||
        !Number.isFinite(body.displayOrder) ||
        body.displayOrder < 0
      ) {
        const errBody: ApiError = {
          error: "displayOrder must be a non-negative number",
          code: "INVALID_ITEM",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.displayOrder = Math.floor(body.displayOrder);
    }

    if (typeof body.description === "string") {
      patch.description = body.description;
    }
    if (typeof body.imageUrl === "string") {
      patch.imageUrl = body.imageUrl;
    }

    const updated = store.updateFoodItem(itemId, patch);
    // Persist the edit directly to the catalogue table (awaited) so it's
    // durable immediately, then flush any pending snapshot write.
    if (updated) await foodItemRepo.save(updated);
    await store.flush();
    res.status(200).json(updated);
  });

  // --- PATCH /api/admin/items/:itemId/stock -------------------------------
  //
  // Updates the available quantity of a food item. Accepts a JSON body with
  // `{ availableQuantity: number }`. Setting to 0 marks the item out of stock.
  app.patch(
    "/api/admin/items/:itemId/stock",
    async (req: Request, res: Response): Promise<void> => {
      const { itemId } = req.params;
      const body = req.body as { availableQuantity?: unknown };

      if (
        body.availableQuantity === undefined ||
        typeof body.availableQuantity !== "number" ||
        !Number.isFinite(body.availableQuantity) ||
        body.availableQuantity < 0
      ) {
        const errBody: ApiError = {
          error: "availableQuantity must be a non-negative number",
          code: "INVALID_QUANTITY",
        };
        res.status(400).json(errBody);
        return;
      }

      const item = store.getFoodItem(itemId);
      if (!item) {
        const errBody: ApiError = {
          error: "Item not found",
          code: "ITEM_NOT_FOUND",
        };
        res.status(404).json(errBody);
        return;
      }

      await foodItemRepo.updateStock(itemId, body.availableQuantity);
      store.setAvailableQuantity(itemId, body.availableQuantity);
      const updated = store.getFoodItem(itemId)!;
      res.status(200).json(updated);
    }
  );

  // --- PATCH /api/admin/items/:itemId/price -------------------------------
  //
  // Updates the price (INR) of a food item. Accepts a JSON body with
  // `{ price: number }`; the price must be a positive, finite number.
  //
  // SECURITY NOTE: like the other /api/admin/* routes, this is unauthenticated
  // for the festival demo and MUST be placed behind seller authentication in
  // production.
  app.patch(
    "/api/admin/items/:itemId/price",
    async (req: Request, res: Response): Promise<void> => {
      const { itemId } = req.params;
      const body = req.body as { price?: unknown };

      if (
        body.price === undefined ||
        typeof body.price !== "number" ||
        !Number.isFinite(body.price) ||
        body.price <= 0
      ) {
        const errBody: ApiError = {
          error: "price must be a positive number",
          code: "INVALID_PRICE",
        };
        res.status(400).json(errBody);
        return;
      }

      const item = (await foodItemRepo.get(itemId)) ?? store.getFoodItem(itemId);
      if (!item) {
        const errBody: ApiError = {
          error: "Item not found",
          code: "ITEM_NOT_FOUND",
        };
        res.status(404).json(errBody);
        return;
      }

      await foodItemRepo.updatePrice(itemId, body.price);
      store.setPrice(itemId, body.price);
      const updated = store.getFoodItem(itemId)!;
      res.status(200).json(updated);
    }
  );

  // --- DELETE /api/admin/items/:itemId ------------------------------------
  //
  // Deletes a food item (an admin "delete item" action). Responds 404 with the
  // consistent `{ error, code }` shape when the item is unknown, otherwise 204
  // No Content. The deletion is persisted so it survives a restart.
  //
  // SECURITY NOTE: like the other /api/admin/* routes, this is unauthenticated
  // for the festival demo and MUST be placed behind seller authentication in
  // production.
  app.delete("/api/admin/items/:itemId", async (req: Request, res: Response): Promise<void> => {
    const { itemId } = req.params;
    await foodItemRepo.delete(itemId);
    const deleted = store.deleteFoodItem(itemId);
    if (!deleted) {
      const errBody: ApiError = {
        error: "Item not found",
        code: "ITEM_NOT_FOUND",
      };
      res.status(404).json(errBody);
      return;
    }
    res.status(204).end();
  });

  // --- GET /api/admin/summary ---------------------------------------------
  //
  // Returns an overall business summary across all paid orders:
  //   - totalOrders: count of paid orders
  //   - totalCollection: sum of paid order totals (INR actually collected)
  //   - totalRewardPointsUsed: sum of FoodCoins redeemed across all orders
  //   - totalDiscount: sum of INR discounts given from redeemed reward points
  //
  // SECURITY NOTE: like the other /api/admin/* routes, this is unauthenticated
  // for the festival demo and MUST be placed behind seller authentication in
  // production.
  app.get("/api/admin/summary", async (_req: Request, res: Response): Promise<void> => {
    const paidOrders = (await orderRepo.list()).filter((o) => o.paid);
    const totalOrders = paidOrders.length;
    const totalCollection = paidOrders.reduce((sum, o) => sum + o.total, 0);
    const totalRewardPointsUsed = paidOrders.reduce(
      (sum, o) => sum + (o.pointsUsed ?? 0),
      0
    );
    const totalDiscount = paidOrders.reduce(
      (sum, o) => sum + (o.discount ?? 0),
      0
    );
    res.status(200).json({
      totalOrders,
      totalCollection,
      totalRewardPointsUsed,
      totalDiscount,
    });
  });

  // --- GET /api/coupons ---------------------------------------------------
  //
  // Returns all active coupons. Public endpoint — the checkout page fetches
  // this to display available coupons to the customer.
  app.get("/api/coupons", async (_req: Request, res: Response): Promise<void> => {
    const coupons = await couponRepo.list();
    res.status(200).json(coupons.filter((c) => c.active));
  });

  // --- GET /api/admin/coupons ---------------------------------------------
  //
  // Returns all coupons (active + inactive) for the admin panel.
  app.get("/api/admin/coupons", async (_req: Request, res: Response): Promise<void> => {
    const coupons = await couponRepo.list();
    res.status(200).json(coupons);
  });

  // --- POST /api/admin/coupons --------------------------------------------
  //
  // Create or update a coupon code.
  app.post(
    "/api/admin/coupons",
    async (req: Request, res: Response): Promise<void> => {
      const body = (req.body ?? {}) as {
        code?: unknown;
        discountPercent?: unknown;
        minOrderValue?: unknown;
        active?: unknown;
      };
      const code =
        typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
      const discountPercent =
        typeof body.discountPercent === "number" ? body.discountPercent : null;
      const minOrderValue =
        typeof body.minOrderValue === "number" ? body.minOrderValue : null;

      if (!code) {
        res.status(400).json({ error: "code is required", code: "VALIDATION_ERROR" });
        return;
      }
      if (discountPercent === null || discountPercent <= 0 || discountPercent > 100) {
        res.status(400).json({ error: "discountPercent must be between 1 and 100", code: "VALIDATION_ERROR" });
        return;
      }
      if (minOrderValue === null || minOrderValue < 0) {
        res.status(400).json({ error: "minOrderValue must be >= 0", code: "VALIDATION_ERROR" });
        return;
      }

      const coupon = {
        code,
        discountPercent,
        minOrderValue,
        active: body.active !== false, // default to true
      };
      await couponRepo.save(coupon);
      res.status(201).json(coupon);
    }
  );

  // --- DELETE /api/admin/coupons/:code ------------------------------------
  //
  // Delete a coupon by code.
  app.delete(
    "/api/admin/coupons/:code",
    async (req: Request, res: Response): Promise<void> => {
      const code = req.params.code?.toUpperCase() ?? "";
      if (!code) {
        res.status(400).json({ error: "code is required", code: "VALIDATION_ERROR" });
        return;
      }
      const existing = await couponRepo.get(code);
      if (!existing) {
        res.status(404).json({ error: "Coupon not found", code: "NOT_FOUND" });
        return;
      }
      await couponRepo.delete(code);
      res.status(200).json({ deleted: code });
    }
  );

  // --- GET /api/combos ----------------------------------------------------
  //
  // Returns all active combos. Public endpoint — the home page fetches this to
  // show combo bundles to customers.
  app.get("/api/combos", async (_req: Request, res: Response): Promise<void> => {
    const combos = await comboRepo.list();
    res.status(200).json(combos.filter((c) => c.active));
  });

  // --- GET /api/admin/combos ----------------------------------------------
  //
  // Returns all combos (active + inactive) for the admin panel.
  app.get("/api/admin/combos", async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(await comboRepo.list());
  });

  // --- POST /api/admin/combos ---------------------------------------------
  //
  // Create a combo bundle: a name, the clubbed item ids, and a combo price.
  //
  // SECURITY NOTE: like the other /api/admin/* routes, this is unauthenticated
  // for the festival demo and MUST be placed behind seller authentication in
  // production.
  app.post("/api/admin/combos", async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      name?: unknown;
      itemIds?: unknown;
      price?: unknown;
      imageUrl?: unknown;
    };

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name === "") {
      res.status(400).json({ error: "name is required", code: "INVALID_COMBO" });
      return;
    }

    const itemIds =
      Array.isArray(body.itemIds)
        ? body.itemIds.filter((id): id is string => typeof id === "string" && id.trim() !== "")
        : [];
    if (itemIds.length < 2) {
      res.status(400).json({
        error: "A combo must club at least two items",
        code: "INVALID_COMBO",
      });
      return;
    }

    // Validate that every clubbed item exists.
    for (const id of itemIds) {
      const item = await foodItemRepo.get(id);
      if (!item) {
        res.status(400).json({
          error: `Unknown item in combo: ${id}`,
          code: "INVALID_COMBO",
        });
        return;
      }
    }

    if (
      typeof body.price !== "number" ||
      !Number.isFinite(body.price) ||
      body.price <= 0
    ) {
      res.status(400).json({ error: "price must be a positive number", code: "INVALID_PRICE" });
      return;
    }

    const id = `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const combo = {
      id,
      name,
      itemIds,
      price: body.price,
      active: true,
      ...(typeof body.imageUrl === "string" && body.imageUrl.trim() !== ""
        ? { imageUrl: body.imageUrl.trim() }
        : {}),
    };
    await comboRepo.save(combo);
    await store.flush();
    res.status(201).json(combo);
  });

  // --- DELETE /api/admin/combos/:id ---------------------------------------
  //
  // Delete a combo by id.
  app.delete("/api/admin/combos/:id", async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id ?? "";
    if (!id) {
      res.status(400).json({ error: "id is required", code: "VALIDATION_ERROR" });
      return;
    }
    const existing = await comboRepo.get(id);
    if (!existing) {
      res.status(404).json({ error: "Combo not found", code: "NOT_FOUND" });
      return;
    }
    await comboRepo.delete(id);
    await store.flush();
    res.status(200).json({ deleted: id });
  });

  // --- GET /api/wallet/:customerId ----------------------------------------
  //
  // Returns the customer's wallet (FoodCoins balance). The store auto-creates a
  // zero-balance wallet on first access, so every customer has a concrete
  // wallet to read.
  //
  // Validates: Requirements 9.2
  app.get("/api/wallet/:customerId", (req: Request, res: Response): void => {
    const { customerId } = req.params;
    res.status(200).json(store.getWallet(customerId));
  });

  // --- POST /api/wallet/:customerId/redeem --------------------------------
  //
  // Redeems FoodCoins against the customer's balance via the foodcoins domain.
  // A redemption within the balance succeeds and the new balance is persisted;
  // an over-redemption is rejected with 402 and the consistent `{ error, code }`
  // shape (code "INSUFFICIENT_BALANCE"), leaving the balance unchanged.
  //
  // Validates: Requirements 9.3, 9.4, 9.5
  app.post(
    "/api/wallet/:customerId/redeem",
    (req: Request, res: Response): void => {
      const { customerId } = req.params;
      const body = (req.body ?? {}) as { amount?: unknown };
      const amount = typeof body.amount === "number" ? body.amount : NaN;

      if (!Number.isFinite(amount) || amount <= 0) {
        const errBody: ApiError = {
          error: "Redemption amount must be a positive number",
          code: "INVALID_AMOUNT",
        };
        res.status(400).json(errBody);
        return;
      }

      const wallet = store.getWallet(customerId);
      const result = applyRedemption(wallet.foodCoins, amount);

      if (!result.ok) {
        const errBody: ApiError = {
          error: "Insufficient FoodCoins balance for this redemption",
          code: "INSUFFICIENT_BALANCE",
        };
        res.status(402).json(errBody);
        return;
      }

      wallet.foodCoins = result.balance;
      store.saveWallet(wallet);
      res.status(200).json(wallet);
    }
  );



  // --- GET /api/metrics ----------------------------------------------------
  //
  // Delegates to the metrics domain over all stored orders. The satisfaction
  // score is derived from the startup ratings of the seeded food items (the
  // store's canonical rating source); when the store holds no items the
  // ratings set is empty and the score is 0, consistent with the domain.
  //
  // Validates: Requirements 7.1
  app.get("/api/metrics", async (_req: Request, res: Response): Promise<void> => {
    const orders = await orderRepo.list();
    const ratings = (await foodItemRepo.list()).map((item) => item.rating);
    res.status(200).json(computeMetrics(orders, ratings));
  });

  // --- GET /api/trending ---------------------------------------------------
  //
  // Delegates to the trending domain over all stored orders (which ranks
  // today's paid orders in descending order of units).
  //
  // Validates: Requirements 11.1
  app.get("/api/trending", async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(rankTrending(await orderRepo.list()));
  });

  return app;
}
