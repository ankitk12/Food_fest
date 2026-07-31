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
import type {
  CartItem,
  Customer,
  FoodItem,
  NotificationGateway,
  Order,
  PaymentGateway,
} from "../../types/index.js";
import type { Store } from "./store.js";
import { orderTotal } from "../../domain/pricing.js";
import { coinsForOrder, applyRedemption } from "../../domain/foodcoins.js";
import { issueToken } from "../../domain/tokens.js";
import { nextStatus } from "../../domain/order-status.js";
import { computeMetrics } from "../../domain/metrics.js";
import { rankTrending } from "../../domain/trending.js";
import { recommend } from "../../domain/ai-chef.js";
import { spin } from "../../domain/spin.js";
import { normalizeMobile, isValidMobile } from "../../domain/mobile.js";
import { MockNotificationGateway } from "./notifications/mock-notification-gateway.js";
import type { Preferences, Referral } from "../../types/index.js";

/** Collaborators required to build the app. */
export interface AppDependencies {
  store: Store;
  /**
   * Optional payment gateway. No longer used by checkout — the single-day
   * event collects UPI/cash off-platform and marks orders paid manually — but
   * kept for backwards compatibility with existing callers/tests.
   */
  paymentGateway?: PaymentGateway;
  /**
   * Notification gateway used to send an order confirmation after a successful
   * checkout. Injectable so tests use a deterministic mock; defaults to
   * `MockNotificationGateway`.
   */
  notificationGateway?: NotificationGateway;
  /**
   * Random number generator used by the Spin & Win endpoint to draw a reward.
   * Injectable so tests can force a specific reward deterministically; defaults
   * to `Math.random`.
   */
  rng?: () => number;
}

/**
 * The number of FoodCoins credited to a referring customer for each referred
 * customer's first successful order (Requirement 10.2).
 */
const REFERRAL_REWARD_COINS = 10;

/**
 * Build the unique referral link for a customer. The link is deterministic in
 * the customerId, which is itself unique per customer, guaranteeing a
 * non-empty link that is never shared between two distinct customers
 * (Requirement 10.1).
 */
function referralLinkFor(customerId: string): string {
  return `https://bytebites.app/join?ref=${encodeURIComponent(customerId)}`;
}

/** The consistent error payload shape used by every API error response. */
export interface ApiError {
  error: string;
  code: string;
}

/**
 * Build a configured Express app around the provided store and payment
 * gateway. Each endpoint task registers its routes on the app created here.
 */
export function createApp(deps: AppDependencies): Express {
  const { store } = deps;
  const notificationGateway =
    deps.notificationGateway ?? new MockNotificationGateway();
  const rng = deps.rng ?? Math.random;
  const app = express();

  app.use(express.json());

  /**
   * Enrich an order with the customer's registered name (looked up by the
   * customerId mobile) so the admin views show a name alongside the number.
   * The name is an empty string when the customer has no registered name.
   */
  const withCustomerName = (order: Order): Order & { customerName: string } => {
    const customer = store.getCustomer(order.customerId);
    return { ...order, customerName: customer?.name ?? "" };
  };

  // --- GET /api/stalls/:stallId/menu -------------------------------------
  //
  // Returns only the requested stall's items (Requirement 4.1). When the stall
  // is unknown, responds 404 with the consistent `{ error, code }` shape
  // (Requirement 4.3).
  app.get(
    "/api/stalls/:stallId/menu",
    (req: Request, res: Response): void => {
      const { stallId } = req.params;

      if (!store.hasStall(stallId)) {
        const body: ApiError = {
          error: "Stall not found",
          code: "STALL_NOT_FOUND",
        };
        res.status(404).json(body);
        return;
      }

      res.status(200).json(store.getMenu(stallId));
    }
  );

  // --- GET /api/menu ------------------------------------------------------
  //
  // Returns ALL food items across ALL stalls. Used by the marketplace to
  // display the full catalogue to users.
  app.get("/api/menu", (_req: Request, res: Response): void => {
    res.status(200).json(store.getFoodItems());
  });

  // --- GET /api/config ----------------------------------------------------
  //
  // Public, non-secret runtime configuration for the client. Values are read
  // from the environment (e.g. Vercel Project Environment Variables) at request
  // time, so they can be changed from the dashboard without rebuilding the
  // client. Currently exposes the merchant UPI identity used to build the
  // checkout QR / payment intent, with demo defaults when unset.
  app.get("/api/config", (_req: Request, res: Response): void => {
    res.status(200).json({
      merchantVpa: process.env.MERCHANT_VPA ?? "invest-a-bite@upi",
      merchantName: process.env.MERCHANT_NAME ?? "Invest-A-Bite",
    });
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

    const mobile = normalizeMobile(body.mobile);
    const name = typeof body.name === "string" ? body.name : "";
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
      const redeemPoints =
        typeof body.redeemPoints === "number" && body.redeemPoints > 0
          ? Math.floor(body.redeemPoints)
          : 0;
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
        const foodItem = store.getFoodItem(cartItem.itemId);
        if (!foodItem) {
          const errBody: ApiError = {
            error: `Item "${cartItem.name}" is no longer available`,
            code: "ITEM_UNAVAILABLE",
          };
          res.status(400).json(errBody);
          return;
        }
        if (foodItem.availableQuantity < cartItem.quantity) {
          const errBody: ApiError = {
            error:
              foodItem.availableQuantity === 0
                ? `"${cartItem.name}" is out of stock`
                : `"${cartItem.name}" only has ${foodItem.availableQuantity} available (you requested ${cartItem.quantity})`,
            code: "INSUFFICIENT_STOCK",
          };
          res.status(400).json(errBody);
          return;
        }
      }

      // Recompute the total server-side; the client total is never trusted.
      const subtotal = orderTotal(items);

      // Apply reward points discount if requested (2 points = ₹1).
      let discount = 0;
      let pointsUsed = 0;
      if (redeemPoints > 0) {
        const wallet = store.getWallet(customerId);
        const usable = Math.min(redeemPoints, wallet.foodCoins);
        discount = usable * 0.50; // 2 points = ₹1
        // Don't discount more than the order total.
        discount = Math.min(discount, subtotal);
        pointsUsed = Math.ceil(discount * 2); // exact points consumed
      }
      const total = Math.max(0, subtotal - discount);

      // No payment gateway is integrated (this app runs for a single-day
      // event). Both UPI (paid by the customer via the QR / their UPI app) and
      // cash are collected off-platform, so every order is created as PENDING
      // and later marked "received" by staff from the admin dashboard once the
      // money actually arrives. There is therefore no online failure path here.

      // Deduct redeemed reward points from the wallet.
      if (pointsUsed > 0) {
        const wallet = store.getWallet(customerId);
        wallet.foodCoins = Math.max(0, wallet.foodCoins - pointsUsed);
        store.saveWallet(wallet);
      }

      // Success: issue a unique token against the store's existing tokens,
      // create the order in "Craving Funded" state associated with the stall,
      // credit FoodCoins, and mark the spin available (Req 5.2, 5.4, 9.1).
      const token = issueToken(store.getOrderTokens());
      const order: Order = {
        token,
        stallId,
        items,
        total,
        status: "Craving Funded",
        // Pending until staff confirm the cash/UPI payment was received; no
        // gateway means we can't auto-verify payment.
        paid: false,
        paymentMethod: payWithCash ? "cash" : "UPI",
        customerId,
        createdAt: new Date().toISOString(),
        spinUsed: false,
        pointsUsed,
        discount,
        deliveryType: deliverToDesk ? "desk" : "stall",
        ...(deliverToDesk ? { deskLocation, floorNo } : {}),
      };
      store.saveOrder(order);

      // Deduct ordered quantities from stock so availability updates in
      // real-time for other users browsing the marketplace.
      for (const cartItem of items) {
        const currentItem = store.getFoodItem(cartItem.itemId);
        if (currentItem) {
          store.setAvailableQuantity(
            cartItem.itemId,
            currentItem.availableQuantity - cartItem.quantity
          );
        }
      }

      const coinsEarned = coinsForOrder(total);
      const wallet = store.getWallet(customerId);
      wallet.foodCoins += coinsEarned;
      store.saveWallet(wallet);

      // Auto-create a minimal customer for a checkout by an unregistered mobile
      // so the identity exists for later lookups (checkout does not require a
      // prior registration). Existing customers are left untouched.
      if (
        isValidMobile(customerId) &&
        store.getCustomer(customerId) === undefined
      ) {
        store.saveCustomer({ mobile: customerId, name: "" });
      }

      // Send an order confirmation to the customer's mobile. A notification
      // failure must NOT fail the order: any error is caught and surfaced as a
      // `notified` flag on the response while the checkout still succeeds.
      const stall = store.getStall(stallId);
      let notified = false;
      try {
        const result = await notificationGateway.sendOrderConfirmation({
          toMobile: customerId,
          token,
          total,
          items,
          stallName: stall?.name,
        });
        notified = result.sent;
      } catch {
        notified = false;
      }

      res.status(201).json({
        token,
        status: order.status,
        coinsEarned,
        spinAvailable: !order.spinUsed,
        total,
        discount,
        notified,
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
  app.get("/api/orders/:token", (req: Request, res: Response): void => {
    const { token } = req.params;
    const order = store.getOrder(token);
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
    (req: Request, res: Response): void => {
      const { token } = req.params;
      const order = store.getOrder(token);
      if (!order) {
        const errBody: ApiError = {
          error: "Order not found",
          code: "ORDER_NOT_FOUND",
        };
        res.status(404).json(errBody);
        return;
      }

      order.status = nextStatus(order.status);
      store.saveOrder(order);

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
    (req: Request, res: Response): void => {
      const { token } = req.params;
      const order = store.getOrder(token);
      if (!order) {
        const errBody: ApiError = {
          error: "Order not found",
          code: "ORDER_NOT_FOUND",
        };
        res.status(404).json(errBody);
        return;
      }

      order.paid = true;
      store.saveOrder(order);

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
    (req: Request, res: Response): void => {
      const { mobile } = req.params;
      const orders = store
        .getOrders()
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
  app.get("/api/admin/orders", (req: Request, res: Response): void => {
    const stallId =
      typeof req.query.stallId === "string" ? req.query.stallId : undefined;

    let orders = store.getOrders();
    if (stallId) {
      orders = orders.filter((o) => o.stallId === stallId);
    }
    // Most-recent first. createdAt is an ISO timestamp so lexicographic
    // descending order is chronological descending order.
    orders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.status(200).json(orders.map((o) => withCustomerName(o)));
  });

  // --- GET /api/admin/orders/:token ---------------------------------------
  //
  // Fetch a single order by token for the admin view. Unknown tokens yield a
  // 404 with the consistent `{ error, code }` shape. (Same UNAUTHENTICATED
  // caveat as GET /api/admin/orders above.)
  app.get("/api/admin/orders/:token", (req: Request, res: Response): void => {
    const order = store.getOrder(req.params.token);
    if (!order) {
      const errBody: ApiError = {
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      };
      res.status(404).json(errBody);
      return;
    }
    res.status(200).json(withCustomerName(order));
  });

  // --- GET /api/admin/items -----------------------------------------------
  //
  // Lists all food items across all stalls for stock management.
  app.get("/api/admin/items", (_req: Request, res: Response): void => {
    res.status(200).json(store.getFoodItems());
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
  app.post("/api/admin/items", (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as {
      name?: unknown;
      price?: unknown;
      availableQuantity?: unknown;
      description?: unknown;
      imageUrl?: unknown;
      rating?: unknown;
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

    const spice: FoodItem["spice"] =
      body.spice === "mild" || body.spice === "medium" || body.spice === "hot"
        ? body.spice
        : "medium";
    const flavor: FoodItem["flavor"] =
      body.flavor === "sweet" || body.flavor === "savory"
        ? body.flavor
        : "savory";
    const portion: FoodItem["portion"] =
      body.portion === "light" ||
      body.portion === "regular" ||
      body.portion === "hearty"
        ? body.portion
        : "regular";
    const rating =
      typeof body.rating === "number" &&
      Number.isFinite(body.rating) &&
      body.rating >= 0 &&
      body.rating <= 5
        ? body.rating
        : 4.5;

    const created = store.createFoodItem({
      name,
      imageUrl: typeof body.imageUrl === "string" ? body.imageUrl : "",
      description: typeof body.description === "string" ? body.description : "",
      rating,
      availableQuantity,
      price: body.price,
      stallId,
      spice,
      flavor,
      portion,
    });

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
  app.patch("/api/admin/items/:itemId", (req: Request, res: Response): void => {
    const { itemId } = req.params;
    const body = (req.body ?? {}) as {
      name?: unknown;
      price?: unknown;
      availableQuantity?: unknown;
      description?: unknown;
      imageUrl?: unknown;
      rating?: unknown;
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

    if (body.spice !== undefined) {
      if (body.spice !== "mild" && body.spice !== "medium" && body.spice !== "hot") {
        const errBody: ApiError = {
          error: "spice must be one of mild, medium, hot",
          code: "INVALID_ITEM",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.spice = body.spice;
    }

    if (body.flavor !== undefined) {
      if (body.flavor !== "sweet" && body.flavor !== "savory") {
        const errBody: ApiError = {
          error: "flavor must be one of sweet, savory",
          code: "INVALID_ITEM",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.flavor = body.flavor;
    }

    if (body.portion !== undefined) {
      if (
        body.portion !== "light" &&
        body.portion !== "regular" &&
        body.portion !== "hearty"
      ) {
        const errBody: ApiError = {
          error: "portion must be one of light, regular, hearty",
          code: "INVALID_ITEM",
        };
        res.status(400).json(errBody);
        return;
      }
      patch.portion = body.portion;
    }

    if (typeof body.description === "string") {
      patch.description = body.description;
    }
    if (typeof body.imageUrl === "string") {
      patch.imageUrl = body.imageUrl;
    }

    const updated = store.updateFoodItem(itemId, patch);
    res.status(200).json(updated);
  });

  // --- PATCH /api/admin/items/:itemId/stock -------------------------------
  //
  // Updates the available quantity of a food item. Accepts a JSON body with
  // `{ availableQuantity: number }`. Setting to 0 marks the item out of stock.
  app.patch(
    "/api/admin/items/:itemId/stock",
    (req: Request, res: Response): void => {
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
    (req: Request, res: Response): void => {
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

      const item = store.getFoodItem(itemId);
      if (!item) {
        const errBody: ApiError = {
          error: "Item not found",
          code: "ITEM_NOT_FOUND",
        };
        res.status(404).json(errBody);
        return;
      }

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
  app.delete("/api/admin/items/:itemId", (req: Request, res: Response): void => {
    const { itemId } = req.params;
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
  app.get("/api/admin/summary", (_req: Request, res: Response): void => {
    const paidOrders = store.getOrders().filter((o) => o.paid);
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

  // --- GET /api/referral/:customerId --------------------------------------
  //
  // Returns the customer's referral record, creating (and persisting) one with
  // a unique link on first access. The link is deterministic in the unique
  // customerId, so it is non-empty and never shared between customers
  // (Requirement 10.1).
  //
  // Validates: Requirements 10.1
  app.get(
    "/api/referral/:customerId",
    (req: Request, res: Response): void => {
      const { customerId } = req.params;
      let referral = store.getReferral(customerId);
      if (!referral) {
        referral = {
          customerId,
          link: referralLinkFor(customerId),
          creditedReferredIds: [],
        };
        store.saveReferral(referral);
      }
      res.status(200).json(referral);
    }
  );

  // --- POST /api/referral/claim -------------------------------------------
  //
  // Credits the referrer 10 FoodCoins for a referred customer's first
  // successful order. Crediting is idempotent per referred customer: the
  // referred id is recorded in the referrer's `creditedReferredIds` and a
  // repeat claim for the same referred customer credits nothing further
  // (Requirements 10.2, 10.3).
  //
  // Validates: Requirements 10.2, 10.3
  app.post("/api/referral/claim", (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as {
      referrerId?: unknown;
      referredId?: unknown;
    };
    const referrerId =
      typeof body.referrerId === "string" ? body.referrerId : "";
    const referredId =
      typeof body.referredId === "string" ? body.referredId : "";

    if (referrerId === "" || referredId === "") {
      const errBody: ApiError = {
        error: "referrerId and referredId are required",
        code: "INVALID_REFERRAL_CLAIM",
      };
      res.status(400).json(errBody);
      return;
    }

    // Load or create the referrer's referral record.
    let referral: Referral =
      store.getReferral(referrerId) ?? {
        customerId: referrerId,
        link: referralLinkFor(referrerId),
        creditedReferredIds: [],
      };

    // Idempotency: only credit the first time we see this referred customer.
    const alreadyCredited = referral.creditedReferredIds.includes(referredId);
    let credited = 0;
    if (!alreadyCredited) {
      referral = {
        ...referral,
        creditedReferredIds: [...referral.creditedReferredIds, referredId],
      };
      store.saveReferral(referral);

      const wallet = store.getWallet(referrerId);
      wallet.foodCoins += REFERRAL_REWARD_COINS;
      store.saveWallet(wallet);
      credited = REFERRAL_REWARD_COINS;
    }

    const wallet = store.getWallet(referrerId);
    res.status(200).json({
      referrerId,
      referredId,
      credited,
      alreadyCredited,
      balance: wallet.foodCoins,
    });
  });

  // --- GET /api/metrics ----------------------------------------------------
  //
  // Delegates to the metrics domain over all stored orders. The satisfaction
  // score is derived from the startup ratings of the seeded food items (the
  // store's canonical rating source); when the store holds no items the
  // ratings set is empty and the score is 0, consistent with the domain.
  //
  // Validates: Requirements 7.1
  app.get("/api/metrics", (_req: Request, res: Response): void => {
    const orders = store.getOrders();
    const ratings = store.getFoodItems().map((item) => item.rating);
    res.status(200).json(computeMetrics(orders, ratings));
  });

  // --- GET /api/trending ---------------------------------------------------
  //
  // Delegates to the trending domain over all stored orders (which ranks
  // today's paid orders in descending order of units).
  //
  // Validates: Requirements 11.1
  app.get("/api/trending", (_req: Request, res: Response): void => {
    res.status(200).json(rankTrending(store.getOrders()));
  });

  // --- POST /api/ai-chef/recommend ----------------------------------------
  //
  // Delegates to the ai-chef domain. The request body carries the three
  // preference inputs; the item pool is the store's food items, optionally
  // scoped to a stall via an optional `stallId`.
  //
  // Validates: Requirements 8.1
  app.post("/api/ai-chef/recommend", (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as {
      hunger?: unknown;
      spice?: unknown;
      taste?: unknown;
      stallId?: unknown;
    };

    const prefs: Preferences = {
      hunger: body.hunger as Preferences["hunger"],
      spice: body.spice as Preferences["spice"],
      taste: body.taste as Preferences["taste"],
    };

    const items =
      typeof body.stallId === "string"
        ? store.getMenu(body.stallId)
        : store.getFoodItems();

    res.status(200).json(recommend(prefs, items));
  });

  // --- POST /api/orders/:token/spin ---------------------------------------
  //
  // Performs the single Spin & Win draw for a paid order. Spins are only
  // available for paid orders (unpaid orders are rejected with 403); the first
  // spin on a paid order succeeds, draws a reward via the spin domain using the
  // injected rng, applies the reward's effect to the customer's account, and
  // marks the order's single spin used. Any further spin attempt on the same
  // order is rejected with 409 (Requirements 13.1, 13.3, 13.4).
  //
  // Reward effects applied to the account:
  //   - "double FoodCoins": doubles the customer's current FoodCoins balance.
  //   - "5% discount" / "free drink" / "lucky draw ticket": recorded on the
  //     order via `spinReward`; the wallet balance is unaffected.
  //
  // Validates: Requirements 13.1, 13.3, 13.4
  app.post("/api/orders/:token/spin", (req: Request, res: Response): void => {
    const { token } = req.params;
    const order = store.getOrder(token);
    if (!order) {
      const errBody: ApiError = {
        error: "Order not found",
        code: "ORDER_NOT_FOUND",
      };
      res.status(404).json(errBody);
      return;
    }

    // Unpaid orders cannot spin (Req 13.1).
    if (!order.paid) {
      const errBody: ApiError = {
        error: "Spin is only available for paid orders",
        code: "ORDER_NOT_PAID",
      };
      res.status(403).json(errBody);
      return;
    }

    // Exactly one spin per paid order (Req 13.4).
    if (order.spinUsed) {
      const errBody: ApiError = {
        error: "This order's spin has already been used",
        code: "SPIN_ALREADY_USED",
      };
      res.status(409).json(errBody);
      return;
    }

    // Draw the reward and apply its effect to the account (Req 13.3).
    const reward = spin(rng);
    const wallet = store.getWallet(order.customerId);
    if (reward === "double FoodCoins") {
      wallet.foodCoins *= 2;
      store.saveWallet(wallet);
    }

    order.spinUsed = true;
    order.spinReward = reward;
    store.saveOrder(order);

    res.status(200).json({
      token: order.token,
      reward,
      spinUsed: order.spinUsed,
      balance: store.getWallet(order.customerId).foodCoins,
    });
  });

  return app;
}
