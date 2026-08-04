/**
 * Configured Express app for the ByteBites server.
 *
 * This module builds the app with its persistence backend and exports it as
 * the default export, so it can serve as both:
 *   - the Vercel serverless entry (the platform imports this `app`), and
 *   - the app that local dev (`index.ts`) wraps with `app.listen`.
 *
 * Persistence backend (chosen at cold start):
 *   - `DATABASE_URL` set → Prisma/Postgres with direct DB Repositories.
 *   - otherwise → the local JSON file (zero-dependency demo default).
 */

import { createApp } from "./app.js";
import { Store, DEFAULT_DATA_FILE, seedStalls, seedFoodItems } from "./store.js";
import type { OrderRepo } from "./order-repo.js";

/**
 * Build the Store and repositories for the configured backend.
 */
async function buildBackend(): Promise<{
  store: Store;
  orderRepo?: OrderRepo;
  customerRepo?: import("./repos.js").CustomerRepo;
  walletRepo?: import("./repos.js").WalletRepo;
  foodItemRepo?: import("./repos.js").FoodItemRepo;
  couponRepo?: import("./repos.js").CouponRepo;
}> {
  if (process.env.DATABASE_URL) {
    const { PrismaPersistence } = await import("./prisma-persistence.js");
    const persistence = new PrismaPersistence();
    await persistence.init();

    let foodItems = await persistence.loadFoodCatalog();
    if (foodItems.length === 0) {
      foodItems = seedFoodItems();
      await persistence.seedFoodCatalog(foodItems);
      console.log(`Seeded ${foodItems.length} food items into the catalogue table`);
    }

    console.log("Persistence: Prisma/Postgres (direct DB repos for all entities)");
    const store = new Store({ stalls: seedStalls(), foodItems }, { persistence });
    return {
      store,
      orderRepo: persistence.createOrderRepo(),
      customerRepo: persistence.createCustomerRepo(),
      walletRepo: persistence.createWalletRepo(),
      foodItemRepo: persistence.createFoodItemRepo(),
      couponRepo: persistence.createCouponRepo(),
    };
  }

  console.log("Persistence: JSON file (set DATABASE_URL to use Postgres)");
  const store = new Store(undefined, {
    persist: true,
    dataFile: process.env.BYTEBITES_DATA_FILE ?? DEFAULT_DATA_FILE,
  });
  return { store };
}

const { store, orderRepo, customerRepo, walletRepo, foodItemRepo, couponRepo } =
  await buildBackend();

const app = createApp({
  store,
  ...(orderRepo ? { orderRepo } : {}),
  ...(customerRepo ? { customerRepo } : {}),
  ...(walletRepo ? { walletRepo } : {}),
  ...(foodItemRepo ? { foodItemRepo } : {}),
  ...(couponRepo ? { couponRepo } : {}),
});

export default app;
