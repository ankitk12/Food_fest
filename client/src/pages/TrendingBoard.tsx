/**
 * TrendingBoard — most-ordered items ranked for today (Req 11.1, 11.2, 11.3).
 *
 * Polls `getTrending` on the shared ~3s interval (via `usePolling`) and renders
 * the items in descending order by units ordered (Req 11.1), each with its
 * ordered quantity (Req 11.3). The server returns the already-ranked list from
 * the pure `rankTrending` domain function; the poll cadence keeps the ranking
 * fresh within the 5-second window after a newly paid order (Req 11.2).
 */

import { useCallback } from "react";
import type { TrendingEntry } from "../../../types/index.js";
import { getTrending } from "../api/client.js";
import { usePolling } from "../hooks/usePolling.js";

export function TrendingBoard(): JSX.Element {
  const fetchTrending = useCallback(() => getTrending(), []);
  const { data, error, loading } = usePolling<TrendingEntry[]>(fetchTrending, { intervalMs: 0 });

  return (
    <main className="trending-board">
      <h1>Trending Foods</h1>

      {error && !data && (
        <p role="alert" className="trending-error">
          We couldn&apos;t load the trending list. Retrying…
        </p>
      )}

      {loading && !data && !error && (
        <p role="status">Loading trending foods…</p>
      )}

      {data &&
        (data.length === 0 ? (
          <p>No orders yet today — check back soon.</p>
        ) : (
          <ol className="trending-list">
            {data.map((entry, index) => (
              <li
                key={entry.itemId}
                className="trending-entry"
                data-testid={`trending-entry-${entry.itemId}`}
              >
                <span className="trending-rank">#{index + 1}</span>
                <span className="trending-name">{entry.name}</span>
                <span
                  className="trending-units"
                  data-testid="trending-units"
                >
                  {entry.unitsOrdered} ordered
                </span>
              </li>
            ))}
          </ol>
        ))}
    </main>
  );
}

export default TrendingBoard;
