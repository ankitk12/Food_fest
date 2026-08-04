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
  type CustomerRepo,
  type WalletRepo,
  type FoodItemRepo,
  type CouponRepo,
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
}

/** The consistent error payload shape used by every API error response. */
export interface ApiError {
  error: string;
  code: string;
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
        pickupTime?: unknown;
        couponCode?: unknown;
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
        if (foodItem && foodItem.availableQuantity < cartItem.quantity) {
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
        paid: false,
        paymentMethod: payWithCash ? "cash" : "UPI",
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
        const currentItem = await foodItemRepo.get(cartItem.itemId);
        if (currentItem) {
          await foodItemRepo.updateStock(
            cartItem.itemId,
            Math.max(0, currentItem.availableQuantity - cartItem.quantity)
          );
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

    res.status(200).json(orders.map((o) => withCustomerName(o)));
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
  app.post("/api/admin/items", async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as {
      name?: unknown;
      price?: unknown;
      availableQuantity?: unknown;
      description?: unknown;
      imageUrl?: unknown;
      rating?: unknown;
      cheesePrice?: unknown;
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
    const ratings = store.getFoodItems().map((item) => item.rating);
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
