/**
 * OrderTracker — live order-status tracking for an Order_Token (Req 6.3, 6.4).
 *
 * Reads the `:token` route param and polls `getOrder` on the shared ~3s
 * interval (via `usePolling`), rendering the current Order_Status. The four
 * status values — "Craving Funded", "Flavor Processing",
 * "Taste Ready for Pickup", and "Happiness Disbursed" — are surfaced verbatim
 * from the server-authoritative order state, so the displayed status always
 * matches the stored status (Req 6.3) and refreshes well inside the 5-second
 * freshness window (Req 6.4).
 *
 * The status is presented as a horizontal progress bar of all lifecycle steps,
 * with completed steps checked, the current step highlighted as active, and
 * upcoming steps dimmed. This is a read-only customer view — advancing the
 * order is an operator action performed from the admin Orders page.
 */

import { useCallback } from "react";
import { useParams } from "react-router-dom";
import { getOrder } from "../api/client.js";
import type { OrderResponse } from "../api/client.js";
import { usePolling } from "../hooks/usePolling.js";
import { ORDER_STATUS_SEQUENCE } from "../../../types/index.js";

export function OrderTracker(): JSX.Element {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";

  const fetchOrder = useCallback(() => getOrder(token), [token]);

  const { data, error, loading } = usePolling<OrderResponse>(fetchOrder, {
    enabled: token !== "",
  });

  const currentIndex = data
    ? ORDER_STATUS_SEQUENCE.indexOf(data.status)
    : -1;

  return (
    <main className="order-tracker">
      <h1>Order Tracking</h1>
      <p className="order-tracker-token">
        Token: <strong data-testid="order-tracker-token">{token}</strong>
      </p>

      {error && (
        <p role="alert" className="order-tracker-error">
          We couldn&apos;t load your order status. Retrying…
        </p>
      )}

      {loading && !data && !error && <p role="status">Loading order status…</p>}

      {data && (
        <>
          <p className="order-tracker-status">
            Status: <strong data-testid="order-status">{data.status}</strong>
          </p>

          <ol className="order-steps" data-testid="order-steps" aria-label="Order progress">
            {ORDER_STATUS_SEQUENCE.map((status, index) => {
              const state =
                index < currentIndex
                  ? "done"
                  : index === currentIndex
                    ? "active"
                    : "upcoming";
              return (
                <li
                  key={status}
                  className={`order-step order-step--${state}`}
                  aria-current={state === "active" ? "step" : undefined}
                  data-testid={`order-step-${index}`}
                >
                  <span className="order-step-marker">
                    {state === "done" ? "✓" : index + 1}
                  </span>
                  <span className="order-step-label">{status}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}

export default OrderTracker;
