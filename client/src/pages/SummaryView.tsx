/**
 * SummaryView — admin-only business summary page.
 *
 * Shows overall totals across all paid orders: total orders, total amount
 * collected, and total reward points (FoodCoins) redeemed. Only accessible to
 * the admin user (see ADMIN_MOBILE). Polled on the shared interval so figures
 * stay fresh as new orders come in.
 */

import { useCallback } from "react";
import { Link } from "react-router-dom";
import { getAdminSummary } from "../api/client.js";
import type { AdminSummary } from "../api/client.js";
import { useCustomer } from "../customer/CustomerContext.js";
import { usePolling } from "../hooks/usePolling.js";
import { ADMIN_MOBILE } from "../constants.js";
import { ROUTES } from "../routes.js";
import { formatINR } from "../format.js";

export function SummaryView(): JSX.Element {
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

  return <SummaryPanel />;
}

function SummaryPanel(): JSX.Element {
  const fetchSummary = useCallback(() => getAdminSummary(), []);
  const { data, error, loading } = usePolling<AdminSummary>(fetchSummary, { intervalMs: 0 });

  return (
    <main className="admin">
      <header className="admin-header">
        <h1>Business Summary</h1>
        <p className="admin-note">Overall totals across all paid orders.</p>
      </header>

      {error && !data && (
        <p role="alert" className="admin-error">
          Couldn&apos;t load the summary. Retrying…
        </p>
      )}

      {loading && !data && !error && <p role="status">Loading summary…</p>}

      {data && (
        <div className="summary-grid" data-testid="summary-grid">
          <article className="summary-card" data-testid="summary-total-orders">
            <span className="summary-card-label">Total Orders</span>
            <span className="summary-card-value">{data.totalOrders}</span>
          </article>

          <article className="summary-card" data-testid="summary-total-collection">
            <span className="summary-card-label">Total Amount Collected</span>
            <span className="summary-card-value">
              {formatINR(data.totalCollection)}
            </span>
          </article>

          <article className="summary-card" data-testid="summary-reward-points">
            <span className="summary-card-label">Total Reward Points Used</span>
            <span className="summary-card-value">
              {data.totalRewardPointsUsed}
            </span>
          </article>

          <article className="summary-card" data-testid="summary-total-discount">
            <span className="summary-card-label">Total Discount Given</span>
            <span className="summary-card-value">
              {formatINR(data.totalDiscount)}
            </span>
          </article>
        </div>
      )}
    </main>
  );
}

export default SummaryView;
