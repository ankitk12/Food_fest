/**
 * MetricsDashboard — live startup metrics (Req 7.1, 7.5).
 *
 * Polls `getMetrics` on the shared ~3s interval (via `usePolling`) and renders
 * all five startup metrics: Total Orders Today, Revenue Generated, Digital
 * Payment Percentage, Best Selling Product, and Customer Satisfaction Score
 * (Req 7.1). Because the poll cadence is well inside the 5-second freshness
 * window, Total Orders Today and Revenue Generated refresh within 5 seconds of
 * a newly paid order (Req 7.5).
 *
 * The dashboard is server-authoritative: it renders whatever the server's
 * `computeMetrics` result contains, formatting revenue in Indian Rupees and
 * the digital-payment share as a percentage.
 */

import { useCallback } from "react";
import type { Metrics } from "../../../types/index.js";
import { getMetrics } from "../api/client.js";
import { usePolling } from "../hooks/usePolling.js";
import { formatINR } from "../format.js";

export function MetricsDashboard(): JSX.Element {
  const fetchMetrics = useCallback(() => getMetrics(), []);
  const { data, error, loading } = usePolling<Metrics>(fetchMetrics, { intervalMs: 0 });

  return (
    <main className="metrics-dashboard">
      <h1>Startup Metrics</h1>

      {error && !data && (
        <p role="alert" className="metrics-error">
          We couldn&apos;t load the metrics. Retrying…
        </p>
      )}

      {loading && !data && !error && <p role="status">Loading metrics…</p>}

      {data && (
        <dl className="metrics-grid">
          <div className="metric" data-testid="metric-total-orders">
            <dt>Total Orders Today</dt>
            <dd>{data.totalOrdersToday}</dd>
          </div>

          <div className="metric" data-testid="metric-revenue">
            <dt>Revenue Generated</dt>
            <dd>{formatINR(data.revenueGenerated)}</dd>
          </div>

          <div className="metric" data-testid="metric-digital-payment">
            <dt>Digital Payment Percentage</dt>
            <dd>{data.digitalPaymentPercentage}%</dd>
          </div>

          <div className="metric" data-testid="metric-best-selling">
            <dt>Best Selling Product</dt>
            <dd>{data.bestSellingProduct ?? "—"}</dd>
          </div>

          <div className="metric" data-testid="metric-satisfaction">
            <dt>Customer Satisfaction Score</dt>
            <dd>{data.customerSatisfactionScore} / 5</dd>
          </div>
        </dl>
      )}
    </main>
  );
}

export default MetricsDashboard;
