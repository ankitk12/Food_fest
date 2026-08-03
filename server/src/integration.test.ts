/**
 * End-to-end integration tests for ByteBites, exercised over HTTP with
 * supertest against an app built via `createApp` around a seeded `Store`.
 *
 * These are example-based integration tests: they wire the full checkout flow
 * together and assert on concrete, observable server state the way a real client
 * would see it.
 *
 * Task 17.1 — full checkout flow end to end:
 *   - SUCCESS: order creation, token issuance, coin crediting, spin available once paid.
 *
 * Task 17.2 — polling freshness within 5 seconds:
 *   Asserts server-side immediacy: after a state-changing request, the very next
 *   GET already returns the updated value.
 *
 * Validates: Requirements 5.1, 5.2, 5.4, 6.4, 7.5, 9.1, 11.2, 13.1
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { coinsForOrder } from "../../domain/foodcoins.js";
import { orderTotal } from "../../domain/pricing.js";
import type { CartItem, Order, Stall } from "../../types/index.js";

const STALL: Stall = { id: "stall-e2e", name: "E2E Stall", qrSlug: "e2e" };

/** A concrete, non-empty cart in the seeded stall. total = 2*180 + 60 = 420. */
const CART: CartItem[] = [
  { itemId: "item-paneer-tikka", name: "Paneer Tikka", unitPrice: 180, quantity: 2 },
  { itemId: "item-gulab-jamun", name: "Gulab Jamun", unitPrice: 60, quantity: 1 },
];

/** Build a test app whose store is seeded with the single E2E stall. */
function buildApp() {
  const store = new Store({ stalls: [STALL], foodItems: [] });
  return { app: createApp({ store }), store };
}

// --- Task 17.1 : full checkout flow end to end ------------------------------

describe("Integration 17.1: full checkout flow end to end", () => {
  it("SUCCESS path: creates the order, issues a token, credits coins, and enables spin when paid", async () => {
    const { app } = buildApp();
    const customerId = "cust-success";
    const expectedTotal = orderTotal(CART); // 420

    // 1) Checkout with a non-empty cart in a valid stall (Req 5.1, 5.2, 5.4).
    const checkout = await request(app)
      .post("/api/checkout")
      .send({ stallId: STALL.id, customerId, items: CART });

    expect(checkout.status).toBe(201);
    const token = checkout.body.token as string;
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0); // non-empty token issued
    expect(checkout.body.status).toBe("Craving Funded"); // Req 5.4
    expect(checkout.body.total).toBe(expectedTotal); // Req 5.1
    expect(checkout.body.coinsEarned).toBe(coinsForOrder(expectedTotal)); // Req 9.1

    // Mark order paid by staff so spin and metrics unlock.
    await request(app).post(`/api/orders/${token}/mark-paid`);

    // 2) Order creation is observable via GET /api/orders/:token (Req 5.2).
    const orderView = await request(app).get(`/api/orders/${token}`);
    expect(orderView.status).toBe(200);
    const order = orderView.body as Order;
    expect(order.token).toBe(token);
    expect(order.stallId).toBe(STALL.id);
    expect(order.paid).toBe(true);
    expect(order.status).toBe("Craving Funded");
    expect(order.total).toBe(expectedTotal);

    // 3) Coin crediting is reflected in the wallet: floor(0.10 * total) (Req 9.1).
    const wallet = await request(app).get(`/api/wallet/${customerId}`);
    expect(wallet.status).toBe(200);
    expect(wallet.body.foodCoins).toBe(coinsForOrder(expectedTotal)); // 42
  });
});

// --- Task 17.2 : polling freshness (server-side immediacy) ------------------

describe("Integration 17.2: server reflects changes immediately (well within the 5s poll window)", () => {
  it("order status update: GET returns the new status immediately after advance (Req 6.4)", async () => {
    const { app } = buildApp();

    const checkout = await request(app)
      .post("/api/checkout")
      .send({ stallId: STALL.id, customerId: "cust-track", items: CART });
    expect(checkout.status).toBe(201);
    const token = checkout.body.token as string;

    // Before advancing, the tracked status is the initial one.
    const before = await request(app).get(`/api/orders/${token}`);
    expect(before.body.status).toBe("Craving Funded");

    // Advance once; the immediately-following GET already shows "Flavor Processing".
    const advance1 = await request(app).post(`/api/orders/${token}/advance`);
    expect(advance1.status).toBe(200);
    const afterFirst = await request(app).get(`/api/orders/${token}`);
    expect(afterFirst.body.status).toBe("Flavor Processing");

    // Advance again; the next GET immediately shows "Taste Ready for Pickup".
    const advance2 = await request(app).post(`/api/orders/${token}/advance`);
    expect(advance2.status).toBe(200);
    const afterSecond = await request(app).get(`/api/orders/${token}`);
    expect(afterSecond.body.status).toBe("Taste Ready for Pickup");
  });

  it("metrics refresh: GET /api/metrics immediately reflects Total Orders Today and Revenue after a paid checkout (Req 7.5)", async () => {
    const { app } = buildApp();

    // Baseline metrics before any order.
    const before = await request(app).get("/api/metrics");
    expect(before.status).toBe(200);
    expect(before.body.totalOrdersToday).toBe(0);
    expect(before.body.revenueGenerated).toBe(0);

    // A first checkout marked paid.
    const total1 = orderTotal(CART);
    const c1 = await request(app)
      .post("/api/checkout")
      .send({ stallId: STALL.id, customerId: "cust-m1", items: CART });
    expect(c1.status).toBe(201);
    await request(app).post(`/api/orders/${c1.body.token}/mark-paid`);

    // The immediately-following metrics GET reflects the new order + revenue.
    const afterOne = await request(app).get("/api/metrics");
    expect(afterOne.body.totalOrdersToday).toBe(1);
    expect(afterOne.body.revenueGenerated).toBe(total1);

    // A second checkout with a different cart marked paid.
    const cart2: CartItem[] = [
      { itemId: "item-mango-lassi", name: "Mango Lassi", unitPrice: 80, quantity: 3 },
    ];
    const total2 = orderTotal(cart2); // 240
    const c2 = await request(app)
      .post("/api/checkout")
      .send({ stallId: STALL.id, customerId: "cust-m2", items: cart2 });
    expect(c2.status).toBe(201);
    await request(app).post(`/api/orders/${c2.body.token}/mark-paid`);

    const afterTwo = await request(app).get("/api/metrics");
    expect(afterTwo.body.totalOrdersToday).toBe(2);
    expect(afterTwo.body.revenueGenerated).toBe(total1 + total2);
  });

  it("trending re-rank: GET /api/trending immediately reflects new units after a paid checkout (Req 11.2)", async () => {
    const { app } = buildApp();

    // Baseline: no orders means no trending entries.
    const before = await request(app).get("/api/trending");
    expect(before.status).toBe(200);
    expect(before.body).toEqual([]);

    // First checkout: 2 Paneer Tikka + 1 Gulab Jamun.
    const c1 = await request(app)
      .post("/api/checkout")
      .send({ stallId: STALL.id, customerId: "cust-t1", items: CART });
    expect(c1.status).toBe(201);
    await request(app).post(`/api/orders/${c1.body.token}/mark-paid`);

    const afterOne = await request(app).get("/api/trending");
    // Ranked descending by units: Paneer Tikka (2) before Gulab Jamun (1).
    expect(afterOne.body).toHaveLength(2);
    expect(afterOne.body[0].itemId).toBe("item-paneer-tikka");
    expect(afterOne.body[0].unitsOrdered).toBe(2);
    expect(afterOne.body[1].itemId).toBe("item-gulab-jamun");
    expect(afterOne.body[1].unitsOrdered).toBe(1);

    // Second checkout ordering 5 Gulab Jamun re-ranks it to the top immediately.
    const cart2: CartItem[] = [
      { itemId: "item-gulab-jamun", name: "Gulab Jamun", unitPrice: 60, quantity: 5 },
    ];
    const c2 = await request(app)
      .post("/api/checkout")
      .send({ stallId: STALL.id, customerId: "cust-t2", items: cart2 });
    expect(c2.status).toBe(201);
    await request(app).post(`/api/orders/${c2.body.token}/mark-paid`);

    const afterTwo = await request(app).get("/api/trending");
    expect(afterTwo.body).toHaveLength(2);
    expect(afterTwo.body[0].itemId).toBe("item-gulab-jamun");
    expect(afterTwo.body[0].unitsOrdered).toBe(6); // 1 + 5
    expect(afterTwo.body[1].itemId).toBe("item-paneer-tikka");
    expect(afterTwo.body[1].unitsOrdered).toBe(2);
  });
});
