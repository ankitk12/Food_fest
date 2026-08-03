/**
 * Tests for the customer API endpoints (`POST /api/customers`,
 * `GET /api/customers/:mobile`) and mobile-number identity across checkout.
 *
 * The mobile number is the canonical customer identity: it is normalized to a
 * canonical form, validated as a plausible phone number, and used as the
 * customerId for wallets/orders. These tests exercise registration, validation,
 * fetch, normalization equivalence, and checkout auto-creation over HTTP.
 */

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import type { CartItem, Stall } from "../../types/index.js";

const STALL: Stall = { id: "stall-c", name: "Customer Stall", qrSlug: "c" };
const CART: CartItem[] = [
  { itemId: "i1", name: "Item", unitPrice: 100, quantity: 1 },
];

function buildApp() {
  const store = new Store({ stalls: [STALL], foodItems: [] });
  const app = createApp({ store });
  return { app, store };
}

describe("POST /api/customers", () => {
  it("registers a customer with a valid mobile and returns the saved record", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/customers")
      .send({ mobile: "9876543210", name: "Asha", email: "asha@example.com" });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      mobile: "9876543210",
      name: "Asha",
      email: "asha@example.com",
    });
  });

  it("normalizes formatting to a canonical mobile identity", async () => {
    const { app, store } = buildApp();
    const res = await request(app)
      .post("/api/customers")
      .send({ mobile: "+91 98765-43210", name: "Ravi" });

    expect(res.status).toBe(201);
    expect(res.body.mobile).toBe("+919876543210");
    expect(store.getCustomer("+919876543210")).toBeDefined();
  });

  it("upserts: re-registering the same mobile updates the record", async () => {
    const { app, store } = buildApp();
    await request(app).post("/api/customers").send({ mobile: "9876543210", name: "Old" });
    const res = await request(app)
      .post("/api/customers")
      .send({ mobile: "9876543210", name: "New" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("New");
    expect(store.getCustomers()).toHaveLength(1);
  });

  it("rejects an invalid mobile with 400 INVALID_MOBILE", async () => {
    const { app } = buildApp();
    for (const bad of ["12345", "abcdefghij", "", "12345678901234567"]) {
      const res = await request(app)
        .post("/api/customers")
        .send({ mobile: bad, name: "X" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("INVALID_MOBILE");
    }
  });

  it("omits email when not provided", async () => {
    const { app } = buildApp();
    const res = await request(app)
      .post("/api/customers")
      .send({ mobile: "9998887776", name: "NoEmail" });
    expect(res.status).toBe(201);
    expect(res.body.email).toBeUndefined();
  });
});

describe("GET /api/customers/:mobile", () => {
  it("fetches a registered customer, matching regardless of formatting", async () => {
    const { app } = buildApp();
    await request(app)
      .post("/api/customers")
      .send({ mobile: "9876543210", name: "Asha" });

    // Fetch with formatting noise resolves to the same normalized identity.
    const res = await request(app).get("/api/customers/987-654-3210");
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Asha");
  });

  it("returns 404 CUSTOMER_NOT_FOUND for an unknown mobile", async () => {
    const { app } = buildApp();
    const res = await request(app).get("/api/customers/9999999999");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "Customer not found",
      code: "CUSTOMER_NOT_FOUND",
    });
  });
});

describe("checkout keys off the mobile identity", () => {
  it("auto-creates a minimal customer for an unregistered mobile on checkout", async () => {
    const { app, store } = buildApp();
    const mobile = "+91 98765 43210";

    const res = await request(app)
      .post("/api/checkout")
      .send({ stallId: STALL.id, customerId: mobile, items: CART });

    expect(res.status).toBe(201);
    // The order + wallet are keyed by the normalized mobile.
    const normalized = "+919876543210";
    expect(store.getCustomer(normalized)).toBeDefined();
    const order = store.getOrder(res.body.token as string);
    expect(order?.customerId).toBe(normalized);
    expect(store.getWallet(normalized).foodCoins).toBeGreaterThan(0);
  });
});
