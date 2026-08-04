/**
 * AdminOrdersView — admin order dashboard with sub-tabs.
 *
 * Orders are segregated into 3 categories:
 *   - New Orders: status "Craving Funded"
 *   - Processing: status "Flavor Processing" or "Taste Ready for Pickup"
 *   - Completed: status "Happiness Disbursed"
 */

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  advanceOrder,
  getAdminOrders,
  getAllItems,
  registerCustomer,
  checkout,
  markOrderPaid,
  ApiClientError,
} from "../api/client.js";
import type { OrderResponse } from "../api/client.js";
import { ORDER_STATUS_SEQUENCE } from "../../../types/index.js";
import type { OrderStatus, FoodItem, CartItem } from "../../../types/index.js";
import { usePolling } from "../hooks/usePolling.js";
import { useCustomer } from "../customer/CustomerContext.js";
import { ADMIN_MOBILE } from "../constants.js";
import { ROUTES } from "../routes.js";
import { formatINR } from "../format.js";
import { isValidMobile } from "../../../domain/mobile.js";
import { DEMO_STALL_ID } from "../demo.js";

type AdminTab = "new" | "processing" | "completed" | "place";

/** Summarize a list of cart items as "2× Paneer Tikka, 1× Naan". */
function itemsSummary(items: OrderResponse["items"]): string {
  if (items.length === 0) return "—";
  return items
    .map((i) => {
      const isCombo = i.comboItemIds && i.comboItemIds.length > 0;
      const tags = [i.addCheese ? "+Cheese" : "", i.jain ? "Jain" : ""]
        .filter(Boolean)
        .join(", ");
      if (isCombo) {
        const contents =
          i.comboItemNames && i.comboItemNames.length > 0
            ? ` [${i.comboItemNames.join(" + ")}]`
            : "";
        return `${i.quantity}× 🍱 ${i.name} (Combo)${contents}`;
      }
      return `${i.quantity}× ${i.name}${tags ? ` (${tags})` : ""}`;
    })
    .join(", ");
}

/** The next status in the lifecycle, or null when already at the final status. */
function nextStatusOf(status: OrderStatus): OrderStatus | null {
  const idx = ORDER_STATUS_SEQUENCE.indexOf(status);
  if (idx === -1 || idx >= ORDER_STATUS_SEQUENCE.length - 1) return null;
  return ORDER_STATUS_SEQUENCE[idx + 1];
}

/** Format an ISO timestamp for display. */
function formatCreatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function AdminOrdersView(): JSX.Element {
  const { customer } = useCustomer();

  if (!customer || customer.mobile !== ADMIN_MOBILE) {
    return (
      <main className="admin">
        <h1>Access Denied</h1>
        <p>You do not have permission to view this page.</p>
        <Link to={ROUTES.home}>Go to Home</Link>
      </main>
    );
  }

  return <AdminOrdersPanel />;
}

function AdminOrdersPanel(): JSX.Element {
  const [activeTab, setActiveTab] = useState<AdminTab>("new");

  const fetchOrders = useCallback(() => getAdminOrders(), []);
  const { data, error, loading, refresh } =
    usePolling<OrderResponse[]>(fetchOrders);

  const [advancingToken, setAdvancingToken] = useState<string | null>(null);
  const [advanceError, setAdvanceError] = useState<string | undefined>(undefined);
  const [markingToken, setMarkingToken] = useState<string | null>(null);

  const handleMarkPaid = useCallback(
    async (token: string): Promise<void> => {
      setMarkingToken(token);
      try {
        await markOrderPaid(token);
        refresh();
      } catch {
        setAdvanceError("We couldn't update that payment. Please try again.");
      } finally {
        setMarkingToken(null);
      }
    },
    [refresh]
  );

  const handleAdvance = useCallback(
    async (token: string): Promise<void> => {
      setAdvancingToken(token);
      setAdvanceError(undefined);
      try {
        await advanceOrder(token);
        refresh();
      } catch {
        setAdvanceError("We couldn't advance that order. Please try again.");
      } finally {
        setAdvancingToken(null);
      }
    },
    [refresh]
  );

  const orders = data ?? [];

  // Filter orders by tab
  const newOrders = orders.filter((o) => o.status === "Craving Funded");
  const processingOrders = orders.filter(
    (o) => o.status === "Flavor Processing" || o.status === "Taste Ready for Pickup"
  );
  const completedOrders = orders.filter((o) => o.status === "Happiness Disbursed");

  const displayedOrders =
    activeTab === "new"
      ? newOrders
      : activeTab === "processing"
        ? processingOrders
        : completedOrders;

  return (
    <main className="admin">
      <header className="admin-header">
        <h1>Order Management</h1>
        <p className="admin-note" data-testid="admin-note">
          Staff view — order and payment actions are unauthenticated in this demo.
        </p>
      </header>

      {/* Sub-tabs */}
      <div className="admin-tabs">
        <button
          type="button"
          className={`admin-tab ${activeTab === "new" ? "admin-tab--active" : ""}`}
          onClick={() => setActiveTab("new")}
        >
          New Orders
          {newOrders.length > 0 && (
            <span className="admin-tab-badge">{newOrders.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "processing" ? "admin-tab--active" : ""}`}
          onClick={() => setActiveTab("processing")}
        >
          Processing
          {processingOrders.length > 0 && (
            <span className="admin-tab-badge">{processingOrders.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "completed" ? "admin-tab--active" : ""}`}
          onClick={() => setActiveTab("completed")}
        >
          Completed
          {completedOrders.length > 0 && (
            <span className="admin-tab-badge">{completedOrders.length}</span>
          )}
        </button>
        <button
          type="button"
          className={`admin-tab ${activeTab === "place" ? "admin-tab--active" : ""}`}
          data-testid="admin-tab-place"
          onClick={() => setActiveTab("place")}
        >
          + Place Order
        </button>
      </div>

      {activeTab === "place" && (
        <PlaceOrderPanel onPlaced={refresh} />
      )}

      {activeTab !== "place" && error && !data && (
        <p role="alert" className="admin-error">
          We couldn&apos;t load orders. Retrying…
        </p>
      )}

      {advanceError && (
        <p role="alert" className="admin-advance-error" data-testid="admin-advance-error">
          {advanceError}
        </p>
      )}

      {activeTab !== "place" && loading && !data && !error && (
        <p role="status">Loading orders…</p>
      )}

      {activeTab !== "place" && data && displayedOrders.length === 0 && (
        <p className="admin-empty-tab" data-testid="admin-empty">
          No {activeTab === "new" ? "new" : activeTab === "processing" ? "processing" : "completed"} orders.
        </p>
      )}

      {activeTab !== "place" && data && displayedOrders.length > 0 && (
        <div className="admin-order-cards">
          {displayedOrders.map((order) => {
            const atEnd = order.status === "Happiness Disbursed";
            const busy = advancingToken === order.token;
            const nextStatus = nextStatusOf(order.status);
            return (
              <div
                key={order.token}
                className="admin-order-card"
                data-testid={`admin-order-${order.token}`}
              >
                <div className="admin-order-card-header">
                  <span className="admin-order-card-token">{order.token}</span>
                  <span className="admin-order-card-time">
                    {formatCreatedAt(order.createdAt)}
                  </span>
                </div>

                <div className="admin-order-card-customer">
                  👤 {order.customerName ? `${order.customerName} · ` : ""}
                  {order.customerId}
                </div>

                <div
                  className="admin-order-card-delivery"
                  data-testid={`admin-delivery-${order.token}`}
                >
                  {order.deliveryType === "desk"
                    ? `🛎️ Desk delivery — ${
                        order.floorNo ? `Floor ${order.floorNo}` : ""
                      }, ${order.deskLocation ?? ""}`
                    : "🏪 Collect at stall"}
                  {order.pickupTime ? ` · ⏰ ${order.pickupTime}` : ""}
                </div>

                <div className="admin-order-card-items">
                  {itemsSummary(order.items)}
                </div>

                <div
                  className="admin-order-payment"
                  data-testid={`admin-payment-${order.token}`}
                >
                  <span
                    className={`admin-pay-method admin-pay-method--${
                      order.paymentMethod === "cash" ? "cash" : "upi"
                    }`}
                  >
                    {order.paymentMethod === "cash" ? "💵 Cash" : "📱 UPI"}
                  </span>
                  <span
                    className={`admin-pay-status admin-pay-status--${
                      order.paid ? "received" : "pending"
                    }`}
                  >
                    {order.paid ? "Received" : "Pending"}
                  </span>
                </div>

                {!order.paid && (
                  <button
                    type="button"
                    className="admin-mark-paid"
                    data-testid={`admin-mark-paid-${order.token}`}
                    onClick={() => void handleMarkPaid(order.token)}
                    disabled={markingToken === order.token}
                  >
                    {markingToken === order.token
                      ? "Updating…"
                      : "Mark payment received"}
                  </button>
                )}

                <div className="admin-order-card-footer">
                  <span className="admin-order-card-total">
                    {formatINR(order.total)}
                  </span>
                  <span
                    className="admin-status"
                    data-testid={`admin-status-${order.token}`}
                  >
                    {order.status}
                  </span>
                </div>

                {!atEnd && nextStatus && (
                  <button
                    type="button"
                    className="admin-advance"
                    data-testid={`admin-advance-${order.token}`}
                    onClick={() => void handleAdvance(order.token)}
                    disabled={busy}
                  >
                    {busy ? "Advancing…" : `${nextStatus} →`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

interface PlaceOrderPanelProps {
  /** Called after an order is successfully placed, to refresh the list. */
  onPlaced: () => void;
}

/**
 * PlaceOrderPanel — lets the admin place an order on a customer's behalf:
 * enter the customer's mobile + name, add menu items with quantities, and
 * submit. Registers/updates the customer, then runs checkout for them.
 */
function PlaceOrderPanel({ onPlaced }: PlaceOrderPanelProps): JSX.Element {
  const fetchMenu = useCallback(() => getAllItems(), []);
  const { data: items, loading } = usePolling<FoodItem[]>(fetchMenu);

  const [mobile, setMobile] = useState("");
  const [name, setName] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placedToken, setPlacedToken] = useState<string | null>(null);

  const menu = items ?? [];

  function setQty(itemId: string, qty: number): void {
    setQuantities((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[itemId];
      else next[itemId] = qty;
      return next;
    });
  }

  const selected: CartItem[] = menu
    .filter((item) => (quantities[item.id] ?? 0) > 0)
    .map((item) => ({
      itemId: item.id,
      name: item.name,
      unitPrice: item.price,
      quantity: quantities[item.id],
    }));

  const total = selected.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const mobileValid = isValidMobile(mobile);
  const canPlace = mobileValid && name.trim() !== "" && selected.length > 0;

  async function handlePlace(): Promise<void> {
    if (!canPlace || submitting) return;
    setSubmitting(true);
    setError(null);
    setPlacedToken(null);
    try {
      // Attach the customer's name to their mobile identity, then check out.
      await registerCustomer({ mobile, name: name.trim() });
      const res = await checkout({
        stallId: DEMO_STALL_ID,
        customerId: mobile,
        items: selected,
      });
      setPlacedToken(res.token);
      setQuantities({});
      setMobile("");
      setName("");
      onPlaced();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Couldn't place the order. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="place-order" data-testid="place-order-panel">
      {placedToken && (
        <p role="status" className="place-order-success" data-testid="place-order-success">
          Order placed. Token: <strong>{placedToken}</strong>
        </p>
      )}

      <div className="place-order-customer">
        <label className="stock-add-field">
          <span>Customer mobile *</span>
          <input
            type="tel"
            inputMode="numeric"
            className="stock-card-input"
            data-testid="place-order-mobile"
            placeholder="10-digit mobile"
            maxLength={10}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
          />
        </label>
        <label className="stock-add-field">
          <span>Customer name *</span>
          <input
            type="text"
            className="stock-card-input"
            data-testid="place-order-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </div>

      {mobile !== "" && !mobileValid && (
        <p role="alert" className="admin-error">
          Enter a valid Indian mobile number (10 digits starting 6-9).
        </p>
      )}

      <h2 className="place-order-heading">Items</h2>
      {loading && menu.length === 0 && <p role="status">Loading menu…</p>}

      <ul className="place-order-items">
        {menu.map((item) => {
          const qty = quantities[item.id] ?? 0;
          const soldOut = item.availableQuantity === 0;
          return (
            <li key={item.id} className="place-order-item">
              <div className="place-order-item-info">
                <span className="place-order-item-name">{item.name}</span>
                <span className="place-order-item-price">{formatINR(item.price)}</span>
              </div>
              {soldOut ? (
                <span className="place-order-soldout">Out of stock</span>
              ) : (
                <div className="place-order-qty">
                  <button
                    type="button"
                    aria-label={`Decrease ${item.name}`}
                    onClick={() => setQty(item.id, qty - 1)}
                    disabled={qty === 0}
                  >
                    −
                  </button>
                  <span data-testid={`place-order-qty-${item.id}`}>{qty}</span>
                  <button
                    type="button"
                    aria-label={`Increase ${item.name}`}
                    onClick={() => setQty(item.id, Math.min(qty + 1, item.availableQuantity))}
                    disabled={qty >= item.availableQuantity}
                  >
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="admin-error" data-testid="place-order-error">
          {error}
        </p>
      )}

      <div className="place-order-footer">
        <span className="place-order-total">Total: {formatINR(total)}</span>
        <button
          type="button"
          className="checkout-pay"
          data-testid="place-order-submit"
          onClick={() => void handlePlace()}
          disabled={!canPlace || submitting}
        >
          {submitting ? "Placing…" : "Place Order"}
        </button>
      </div>
    </section>
  );
}

export default AdminOrdersView;
