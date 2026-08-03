/**
 * Property-based and unit tests for the wallet API endpoints
 * (`GET /api/wallet/:customerId`, `POST /api/wallet/:customerId/redeem`).
 *
 * These tests exercise the redemption HTTP flow against an app built via
 * `createApp` around a seeded `Store` and a deterministic `MockGateway`. They
 * complement the pure-domain redemption properties (22, 23) at the API layer:
 * a valid redemption persists the deducted balance, and an over-redemption is
 * rejected with an insufficient-balance code leaving the balance unchanged.
 *
 * Validates: Requirements 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import request from "supertest";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { walletBalanceArb } from "../../types/generators.js";

const safeIdArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
    { minLength: 1, maxLength: 12 }
  )
  .map((chars) => chars.join(""));

function buildAppWithWallet(customerId: string, balance: number) {
  const store = new Store({ stalls: [], foodItems: [] });
  store.saveWallet({ customerId, foodCoins: balance });
  const app = createApp({ store });
  return { app, store };
}

describe("GET /api/wallet/:customerId", () => {
  it("returns the stored FoodCoins balance", async () => {
    const { app } = buildAppWithWallet("cust-1", 42);
    const res = await request(app).get("/api/wallet/cust-1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ customerId: "cust-1", foodCoins: 42 });
  });

  it("auto-creates a zero-balance wallet for an unknown customer", async () => {
    const store = new Store({ stalls: [], foodItems: [] });
    const app = createApp({ store });
    const res = await request(app).get("/api/wallet/new-cust");
    expect(res.status).toBe(200);
    expect(res.body.foodCoins).toBe(0);
  });
});

describe("POST /api/wallet/:customerId/redeem — valid redemption", () => {
  it("deducts exactly the redeemed amount for any amount within the balance", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeIdArb,
        walletBalanceArb.filter((b) => b > 0),
        async (customerId, balance) => {
          const { app, store } = buildAppWithWallet(customerId, balance);
          const amount = Math.max(1, Math.floor(balance / 2));

          const res = await request(app)
            .post(`/api/wallet/${customerId}/redeem`)
            .send({ amount });

          expect(res.status).toBe(200);
          expect(res.body.foodCoins).toBe(balance - amount);
          expect(store.getWallet(customerId).foodCoins).toBe(balance - amount);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("POST /api/wallet/:customerId/redeem — over-redemption", () => {
  it("rejects with INSUFFICIENT_BALANCE and leaves the balance unchanged", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeIdArb,
        walletBalanceArb,
        async (customerId, balance) => {
          const { app, store } = buildAppWithWallet(customerId, balance);
          const amount = balance + 1; // strictly greater than balance

          const res = await request(app)
            .post(`/api/wallet/${customerId}/redeem`)
            .send({ amount });

          expect(res.status).toBe(402);
          expect(res.body.code).toBe("INSUFFICIENT_BALANCE");
          expect(store.getWallet(customerId).foodCoins).toBe(balance);
        }
      ),
      { numRuns: 100 }
    );
  });
});
