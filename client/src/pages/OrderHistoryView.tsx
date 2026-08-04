/**
 * OrderHistoryView — displays all past orders for the logged-in customer
 * in an attractive card-based layout.
 *
 * Each order card shows: order token, status badge, items ordered, total amount,
 * FoodCoins earned, spin reward (if any), and date placed. Cards use the
 * ByteBites warm theme with subtle shadows and accent colors.
 */

import { useCallback } from "react";
import { Link } from "react-router-dom";
import { getCustomerOrders, getCombos, getAllItems } from "../api/client.js";
import type { OrderResponse } from "../api/client.js";
import type { Combo, FoodItem } from "../../../types/index.js";
import { useCustomer } from "../customer/CustomerContext.js";
import { usePolling } from "../hooks/usePolling.js";
import { orderPath, ROUTES } from "../routes.js";
import { formatINR } from "../format.js";

/** Compute reward points earned from an order total (10% of total, floored). */
function pointsEarnedFromTotal(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.floor(total * 0.10);
}

/** Map order status to a display label with emoji. */
function statusLabel(status: string): string {
  switch (status) {
    case "Craving Funded":
      return "💰 Craving Funded";
    case "Flavor Processing":
      return "👨‍🍳 Flavor Processing";
    case "Taste Ready for Pickup":
      return "📦 Taste Ready for Pickup";
    case "Happiness Disbursed":
      return "✅ Happiness Disbursed";
    default:
      return status;
  }
}

/** Map order status to a colour class for the badge. */
function statusBadgeClass(status: string): string {
  switch (status) {
    case "Happiness Disbursed":
      return "order-card-badge--disbursed";
    case "Taste Ready for Pickup":
      return "order-card-badge--ready";
    case "Flavor Processing":
      return "order-card-badge--preparing";
    default:
      return "order-card-badge--received";
  }
}

export function OrderHistoryView(): JSX.Element {
  const { customer } = useCustomer();

  const fetchOrders = useCallback(
    () => (customer ? getCustomerOrders(customer.mobile) : Promise.resolve([])),
    [customer]
  );

  const { data: orders, error, loading } = usePolling<OrderResponse[]>(
    fetchOrders,
    { enabled: !!customer, intervalMs: 60000 }
  );

  // Live combos + menu, used to resolve a combo line's clubbed items for
  // display (e.g. older orders that didn't store the item names).
  const { data: combos } = usePolling<Combo[]>(useCallback(() => getCombos(), []));
  const { data: menu } = usePolling<FoodItem[]>(useCallback(() => getAllItems(), []));
  const combosById = new Map((combos ?? []).map((c) => [c.id, c]));
  const itemNameById = new Map((menu ?? []).map((i) => [i.id, i.name]));

  /** Resolve the clubbed item names for a combo order line. */
  function comboItemsFor(item: OrderResponse["items"][number]): string[] {
    if (item.comboItemNames && item.comboItemNames.length > 0) {
      return item.comboItemNames;
    }
    const ids =
      item.comboItemIds && item.comboItemIds.length > 0
        ? item.comboItemIds
        : combosById.get(item.itemId)?.itemIds ?? [];
    return ids.map((id) => itemNameById.get(id) ?? id);
  }

  if (!customer) {
    return (
      <main className="order-history">
        <div className="order-history-empty-state">
          <span className="order-history-empty-icon">🔐</span>
          <h1>Order History</h1>
          <p>Please sign in to view your order history.</p>
          <Link to={ROUTES.profile} className="order-history-cta">
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="order-history">
      <h1 className="order-history-title">Your Orders</h1>

      {error && (
        <p role="alert" className="order-history-error">
          We couldn&apos;t load your orders. Retrying…
        </p>
      )}

      {loading && !orders && !error && (
        <p role="status" className="order-history-loading">Loading your orders…</p>
      )}

      {orders && orders.length === 0 && (
        <div className="order-history-empty-state">
          <span className="order-history-empty-icon">📦</span>
          <p>You haven&apos;t placed any orders yet.</p>
          <Link to={ROUTES.marketplace} className="order-history-cta">
            Browse the marketplace
          </Link>
        </div>
      )}

      {orders && orders.length > 0 && (
        <div className="order-history-grid" data-testid="order-history-list">
          {orders.map((order) => {
            const coins = pointsEarnedFromTotal(order.total);
            return (
              <article
                key={order.token}
                className="order-card"
                data-testid="order-history-item"
              >
                <div className="order-card-top">
                  <span
                    className={`order-card-badge ${statusBadgeClass(order.status)}`}
                    data-testid="order-history-status"
                  >
                    {statusLabel(order.status)}
                  </span>
                  <time className="order-card-date" dateTime={order.createdAt}>
                    {new Date(order.createdAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </time>
                </div>

                <div className="order-card-token">
                  🎫 <strong>{order.token}</strong>
                </div>

                <ul className="order-card-items">
                  {order.items.map((item) => {
                    const comboNames = comboItemsFor(item);
                    const isCombo =
                      (item.comboItemIds && item.comboItemIds.length > 0) ||
                      combosById.has(item.itemId);
                    return (
                      <li key={item.itemId} className="order-card-item-line">
                        <span className="order-card-item-name">
                          {isCombo && (
                            <span className="cart-line-combo-tag">Combo</span>
                          )}
                          {item.name}
                          {comboNames.length > 0 && (
                            <span className="cart-line-combo-items">
                              {comboNames.join(" + ")}
                            </span>
                          )}
                        </span>
                        <span className="order-card-item-qty">×{item.quantity}</span>
                      </li>
                    );
                  })}
                </ul>

                <div className="order-card-footer">
                  <div className="order-card-total">
                    {formatINR(order.total)}
                  </div>

                  <div className="order-card-rewards">
                    {coins > 0 ? (
                      <span className="order-card-coins" title="Reward points earned">
                        🪙 +{coins} points
                      </span>
                    ) : (
                      <span className="order-card-no-reward">—</span>
                    )}
                  </div>
                </div>

                <Link
                  to={orderPath(order.token)}
                  className="order-card-track-btn"
                >
                  Track order →
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

export default OrderHistoryView;
