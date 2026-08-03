/**
 * Tests for the admin/seller order-management API
 * (`GET /api/admin/orders`, `GET /api/admin/orders/:token`).
 *
 * Admin listing returns all orders most-recent first, is filterable by stall,
 * and a single order is fetchable by token (404 for unknown). These endpoints
 * are intentionally unauthenticated for the demo (see the security note in
 * app.ts).
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import type { FoodItem, Order, Stall } from "../../types/index.js";

const STALL_A: Stall = { id: "stall-a", name: "A", qrSlug: "a" };
const STALL_B: Stall = { id: "stall-b", name: "B", qrSlug: "b" };

const ITEM_A: FoodItem = {
  id: "item-a",
  name: "Alpha Bowl",
  imageUrl: "https://example.com/a.jpg",
  description: "Tasty",
  rating: 4.5,
  availableQuantity: 10,
  price: 180,
  stallId: "stall-a",
};

function makeOrder(token: string, stallId: string, createdAt: string): Order {
  return {
    token,
    stallId,
    items: [{ itemId: "i", name: "I", unitPrice: 10, quantity: 1 }],
    total: 10,
    status: "Craving Funded",
    paid: true,
    paymentMethod: "UPI",
    customerId: "9876543210",
    createdAt,
  };
}

function buildApp() {
  const store = new Store({ stalls: [STALL_A, STALL_B], foodItems: [] });
  const app = createApp({ store });
  return { app, store };
}

describe("GET /api/admin/orders", () => {
  it("lists all orders most-recent first", async () => {
    const { app, store } = buildApp();
    store.saveOrder(makeOrder("T-1", STALL_A.id, "2024-01-01T10:00:00.000Z"));
    store.saveOrder(makeOrder("T-2", STALL_B.id, "2024-01-01T12:00:00.000Z"));
    store.saveOrder(makeOrder("T-3", STALL_A.id, "2024-01-01T11:00:00.000Z"));

    const res = await request(app).get("/api/admin/orders");
    expect(res.status).toBe(200);
    const tokens = (res.body as Order[]).map((o) => o.token);
    // Descending by createdAt: T-2 (12:00), T-3 (11:00), T-1 (10:00).
    expect(tokens).toEqual(["T-2", "T-3", "T-1"]);
  });

  it("filters by stallId", async () => {
    const { app, store } = buildApp();
    store.saveOrder(makeOrder("T-1", STALL_A.id, "2024-01-01T10:00:00.000Z"));
    store.saveOrder(makeOrder("T-2", STALL_B.id, "2024-01-01T12:00:00.000Z"));
    store.saveOrder(makeOrder("T-3", STALL_A.id, "2024-01-01T11:00:00.000Z"));

    const res = await request(app).get("/api/admin/orders?stallId=stall-a");
    expect(res.status).toBe(200);
    const orders = res.body as Order[];
    expect(orders.map((o) => o.token)).toEqual(["T-3", "T-1"]);
    for (const o of orders) expect(o.stallId).toBe(STALL_A.id);
  });

  it("returns an empty list when there are no orders", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/admin/orders");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("enriches each order with the customer's registered name", async () => {
    const { app, store } = buildApp();
    store.saveCustomer({ mobile: "9876543210", name: "Asha Rao" });
    store.saveOrder(makeOrder("T-1", STALL_A.id, "2024-01-01T10:00:00.000Z"));
    // An order for an unregistered customer gets an empty name.
    store.saveOrder({
      ...makeOrder("T-2", STALL_A.id, "2024-01-01T11:00:00.000Z"),
      customerId: "9999999999",
    });

    const res = await request(app).get("/api/admin/orders");
    expect(res.status).toBe(200);
    const byToken = Object.fromEntries(
      (res.body as Array<{ token: string; customerName: string }>).map((o) => [
        o.token,
        o.customerName,
      ])
    );
    expect(byToken["T-1"]).toBe("Asha Rao");
    expect(byToken["T-2"]).toBe("");
  });
});

describe("GET /api/admin/orders/:token", () => {
  it("fetches a single order by token", async () => {
    const { app, store } = buildApp();
    const order = makeOrder("T-9", STALL_A.id, "2024-01-01T10:00:00.000Z");
    store.saveOrder(order);

    const res = await request(app).get("/api/admin/orders/T-9");
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("T-9");
  });

  it("returns 404 ORDER_NOT_FOUND for an unknown token", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/admin/orders/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ORDER_NOT_FOUND");
  });

  it("an admin can advance an order via the existing advance endpoint", async () => {
    const { app, store } = buildApp();
    store.saveOrder(makeOrder("T-adv", STALL_A.id, "2024-01-01T10:00:00.000Z"));

    const res = await request(app).post("/api/orders/T-adv/advance");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("Flavor Processing");
  });
});

describe("PATCH /api/admin/items/:itemId/price", () => {
  function buildAppWithItem() {
    const store = new Store({ stalls: [STALL_A], foodItems: [ITEM_A] });
    const app = createApp({ store });
    return { app, store };
  }

  it("updates the item price and returns the updated item", async () => {
    const { app, store } = buildAppWithItem();

    const res = await request(app)
      .patch("/api/admin/items/item-a/price")
      .send({ price: 220 });

    expect(res.status).toBe(200);
    expect(res.body.price).toBe(220);
    // The change is reflected in the store (and the customer-facing menu).
    expect(store.getFoodItem("item-a")?.price).toBe(220);
    expect(store.getMenu("stall-a")[0].price).toBe(220);
  });

  it("rejects a non-positive price with 400 INVALID_PRICE", async () => {
    const { app, store } = buildAppWithItem();

    const res = await request(app)
      .patch("/api/admin/items/item-a/price")
      .send({ price: 0 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PRICE");
    // Price unchanged.
    expect(store.getFoodItem("item-a")?.price).toBe(180);
  });

  it("rejects a non-numeric price with 400 INVALID_PRICE", async () => {
    const { app } = buildAppWithItem();

    const res = await request(app)
      .patch("/api/admin/items/item-a/price")
      .send({ price: "expensive" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_PRICE");
  });

  it("returns 404 ITEM_NOT_FOUND for an unknown item", async () => {
    const { app } = buildAppWithItem();

    const res = await request(app)
      .patch("/api/admin/items/nope/price")
      .send({ price: 100 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ITEM_NOT_FOUND");
  });
});

describe("GET /api/admin/summary", () => {
  it("returns zeroed totals when there are no orders", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/admin/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalOrders: 0,
      totalCollection: 0,
      totalRewardPointsUsed: 0,
      totalDiscount: 0,
    });
  });

  it("aggregates order count, collection, reward points used, and discount across paid orders", async () => {
    const { app, store } = buildApp();
    store.saveOrder({
      ...makeOrder("S-1", STALL_A.id, "2024-01-01T10:00:00.000Z"),
      total: 200,
      pointsUsed: 10,
      discount: 5,
    });
    store.saveOrder({
      ...makeOrder("S-2", STALL_B.id, "2024-01-01T11:00:00.000Z"),
      total: 350,
      pointsUsed: 5,
      discount: 2.5,
    });
    // An order with no pointsUsed/discount fields contributes 0 to both.
    store.saveOrder({
      ...makeOrder("S-3", STALL_A.id, "2024-01-01T12:00:00.000Z"),
      total: 100,
    });

    const res = await request(app).get("/api/admin/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalOrders: 3,
      totalCollection: 650,
      totalRewardPointsUsed: 15,
      totalDiscount: 7.5,
    });
  });

  it("excludes unpaid orders from the totals", async () => {
    const { app, store } = buildApp();
    store.saveOrder({
      ...makeOrder("S-1", STALL_A.id, "2024-01-01T10:00:00.000Z"),
      total: 200,
      pointsUsed: 10,
      discount: 5,
    });
    store.saveOrder({
      ...makeOrder("S-2", STALL_B.id, "2024-01-01T11:00:00.000Z"),
      total: 999,
      pointsUsed: 50,
      discount: 25,
      paid: false,
    });

    const res = await request(app).get("/api/admin/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalOrders: 1,
      totalCollection: 200,
      totalRewardPointsUsed: 10,
      totalDiscount: 5,
    });
  });
});
