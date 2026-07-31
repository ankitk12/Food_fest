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
import { Store, DEFAULT_DATA_FILE } from "./store.js";
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

/** Build the Store with the configured persistence backend. */
async function buildStore(): Promise<Store> {
  if (process.env.DATABASE_URL) {
    // Prisma is imported only when a database is configured, so the JSON-file
    // path never depends on the generated Prisma client.
    const { PrismaPersistence } = await import("./prisma-persistence.js");
    const persistence = new PrismaPersistence();
    await persistence.init();
    console.log("Persistence: Prisma/Postgres");
    return new Store(undefined, { persistence });
  }

  console.log("Persistence: JSON file (set DATABASE_URL to use Postgres)");
  return new Store(undefined, {
    persist: true,
    dataFile: process.env.BYTEBITES_DATA_FILE ?? DEFAULT_DATA_FILE,
  });
}

// Top-level await: build the store (loading any persisted snapshot) before the
// app is exported, so the first request already sees restored state.
const store = await buildStore();

const app = createApp({
  store,
  paymentGateway: resolveGateway(),
  notificationGateway: resolveNotificationGateway(),
});

export default app;
