import { createApp } from "./app.js";
import { store } from "./store.js";
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

const app = createApp({
  store,
  paymentGateway: resolveGateway(),
  notificationGateway: resolveNotificationGateway(),
});

export default app;
