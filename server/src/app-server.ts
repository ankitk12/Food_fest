/**
 * Configured Express app for the ByteBites server.
 *
 * This module builds the app with its persistence backend and gateways and
 * exports it as the default export, so it can serve as both:
 *   - the Vercel serverless entry (the platform imports this `app`), and
 *   - the app that local dev (`index.ts`) wraps with `app.listen`.
 *
 * Persistence backend (chosen at cold start):
 *   - `DATABASE_URL` set → Prisma/Postgres (state stored as a JSON snapshot
 *     row). Required for serverless/Vercel where the filesystem is ephemeral.
 *   - otherwise → the local JSON file (zero-dependency demo default).
 *
 * The snapshot is loaded (via a top-level await) before the Store is built, so
 * all runtime state survives a restart / cold start.
 */

import { createApp } from "./app.js";
import { Store, DEFAULT_DATA_FILE, seedStalls, seedFoodItems } from "./store.js";
import type { OrderRepo } from "./order-repo.js";
import { MockGateway } from "./gateways/mock-gateway.js";
import { PaytmGateway } from "./gateways/paytm-gateway.js";
import { MockNotificationGateway } from "./notifications/mock-notification-gateway.js";
import { MetaWhatsAppGateway } from "./notifications/whatsapp-gateway.js";
import type {
  NotificationGateway,
  PaymentGateway,
} from "../../types/index.js";

function resolveGateway(): PaymentGateway {
  if (process.env.PAYMENT_GATEWAY === "paytm") {
    return PaytmGateway.fromEnv();
  }
  return new MockGateway({ mode: "success" });
}

function resolveNotificationGateway(): NotificationGateway {
  if (process.env.NOTIFICATION_GATEWAY === "whatsapp") {
    return MetaWhatsAppGateway.fromEnv();
  }
  return new MockNotificationGateway();
}

/**
 * Build the Store and order repository for the configured backend.
 *
 * On the Prisma/Postgres backend, orders are owned by a direct-DB `OrderRepo`
 * (not the in-memory snapshot), so they stay consistent across concurrent
 * serverless instances. The JSON-file backend uses the default Store-backed
 * repo (single-process dev).
 */
async function buildBackend(): Promise<{ store: Store; orderRepo?: OrderRepo }> {
  if (process.env.DATABASE_URL) {
    // Prisma is imported only when a database is configured, so the JSON-file
    // path never depends on the generated Prisma client.
    const { PrismaPersistence } = await import("./prisma-persistence.js");
    const persistence = new PrismaPersistence();
    await persistence.init();

    // Render the base food catalogue from the database. Bootstrap the table
    // from the built-in defaults the first time (when it's empty).
    let foodItems = await persistence.loadFoodCatalog();
    if (foodItems.length === 0) {
      foodItems = seedFoodItems();
      await persistence.seedFoodCatalog(foodItems);
      console.log(`Seeded ${foodItems.length} food items into the catalogue table`);
    }

    console.log("Persistence: Prisma/Postgres (orders via direct-DB repo)");
    const store = new Store({ stalls: seedStalls(), foodItems }, { persistence });
    return { store, orderRepo: persistence.createOrderRepo() };
  }

  console.log("Persistence: JSON file (set DATABASE_URL to use Postgres)");
  const store = new Store(undefined, {
    persist: true,
    dataFile: process.env.BYTEBITES_DATA_FILE ?? DEFAULT_DATA_FILE,
  });
  return { store };
}

// Top-level await: build the backend (loading any persisted snapshot) before
// the app is exported, so the first request already sees restored state.
const { store, orderRepo } = await buildBackend();

const app = createApp({
  store,
  ...(orderRepo ? { orderRepo } : {}),
  paymentGateway: resolveGateway(),
  notificationGateway: resolveNotificationGateway(),
});

export default app;
