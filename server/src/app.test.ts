/**
 * Tests for the stall menu API endpoint (`GET /api/stalls/:stallId/menu`).
 *
 * Includes:
 *   - Property 7 (stall menu isolation): a property-based test driven by
 *     generated stalls and food items via a seeded Store.
 *   - A concrete unit test for the unknown-stall 404 error view.
 *
 * The app is built through `createApp` around a `Store` seeded with generated
 * data and a deterministic `MockGateway`, and exercised over HTTP with
 * supertest.
 *
 * Validates: Requirements 4.1, 4.3
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import request from "supertest";
import { createApp } from "./app.js";
import { Store } from "./store.js";
import { foodItemArb, nameArb } from "../../types/generators.js";
import type { FoodItem, Stall } from "../../types/index.js";

/** Build a test app around a store seeded with the given stalls and items. */
function buildApp(stalls: Stall[], foodItems: FoodItem[]) {
  const store = new Store({ stalls, foodItems });
  return createApp({ store });
}

/**
 * URL-safe, non-empty stall identifier. Stall ids travel in the request path
 * (`/api/stalls/:stallId/menu`), so pathological values like "." or ".." would
 * be collapsed by HTTP path normalization — an artifact of the transport, not
 * the menu-isolation logic under test. Constraining to `[a-z0-9-]` keeps the
 * property meaningful over arbitrary stall/item sets without that noise.
 */
const safeIdArb: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-".split("")),
    { minLength: 1, maxLength: 12 }
  )
  .map((chars) => chars.join(""));

/** A set of stalls with distinct, URL-safe ids. */
const safeStallsArb: fc.Arbitrary<Stall[]> = fc
  .array(
    fc.record<Stall>({ id: safeIdArb, name: nameArb, qrSlug: safeIdArb }),
    { minLength: 1, maxLength: 6 }
  )
  .map((stalls) => {
    const seen = new Set<string>();
    return stalls.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  });

/**
 * Generate a set of stalls together with a set of food items whose stallIds
 * are drawn from those stalls, so the menu grouping is meaningful. Item ids are
 * de-duplicated to keep the store's item map well-formed.
 */
const stallsWithItemsArb: fc.Arbitrary<{
  stalls: Stall[];
  foodItems: FoodItem[];
}> = safeStallsArb.chain((stalls) => {
  const stallIds = stalls.map((s) => s.id);
  const itemForSomeStall = fc
    .constantFrom(...stallIds)
    .chain((stallId) => foodItemArb({ stallId }));
  return fc
    .array(itemForSomeStall, { minLength: 0, maxLength: 30 })
    .map((items) => {
      // De-duplicate item ids so each item is uniquely keyed in the store.
      const seen = new Set<string>();
      const foodItems = items.filter((it) => {
        if (seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
      });
      return { stalls, foodItems };
    });
});

// Feature: bytebites, Property 7: Stall menu contains only that stall's items
describe("Property 7: Stall menu contains only that stall's items", () => {
  it("returns only items whose stallId equals the requested stall", async () => {
    await fc.assert(
      fc.asyncProperty(stallsWithItemsArb, async ({ stalls, foodItems }) => {
        const app = buildApp(stalls, foodItems);

        for (const stall of stalls) {
          const res = await request(app).get(
            `/api/stalls/${encodeURIComponent(stall.id)}/menu`
          );

          expect(res.status).toBe(200);
          const menu = res.body as FoodItem[];

          // Every returned item belongs to the requested stall.
          for (const item of menu) {
            expect(item.stallId).toBe(stall.id);
          }

          // Completeness: the menu contains exactly this stall's items.
          const expectedIds = foodItems
            .filter((it) => it.stallId === stall.id)
            .map((it) => it.id)
            .sort();
          const actualIds = menu.map((it) => it.id).sort();
          expect(actualIds).toEqual(expectedIds);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe("GET /api/stalls/:stallId/menu — unknown stall error view", () => {
  it("returns 404 with { error, code } for a non-existent stall id", async () => {
    // Seed with a single known stall and no items; request a different id.
    const store = new Store({
      stalls: [{ id: "stall-known", name: "Known Stall", qrSlug: "known" }],
      foodItems: [],
    });
    const app = createApp({ store });

    const res = await request(app).get(
      "/api/stalls/stall-does-not-exist/menu"
    );

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: "Stall not found",
      code: "STALL_NOT_FOUND",
    });
  });
});
