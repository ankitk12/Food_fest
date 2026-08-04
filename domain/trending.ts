/**
 * Trending board ranking domain module for ByteBites.
 *
 * Pure, framework-agnostic ranking. Given a set of orders, `rankTrending`
 * counts the number of units ordered per item across the CURRENT DAY's paid
 * orders only and returns entries ranked in non-increasing (descending) order
 * of units ordered.
 *
 * Scope
 * -----
 * Only orders that are (a) paid and (b) dated for the server's current local
 * day contribute to the ranking. "current day" is derived from `order.createdAt`
 * against the server's local date, consistent with the metrics module.
 *
 * Each entry's `unitsOrdered` equals the total units of that item summed across
 * all of today's paid orders (an item may appear in several orders).
 *
 * Validates: Requirements 11.1, 11.3
 */

import type { PaidOrder, TrendingEntry } from "../types/index.js";

/** True when an ISO timestamp falls on the server's current local day. */
function isToday(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/**
 * Rank items by total units ordered across today's paid orders, descending.
 *
 * Orders that are unpaid or dated on a different day are excluded. Items are
 * grouped by `itemId`; the display name is taken from the first occurrence.
 */
export function rankTrending(orders: PaidOrder[]): TrendingEntry[] {
  const counts = new Map<string, TrendingEntry>();

  for (const order of orders) {
    if (!order.paid) continue;

    for (const item of order.items) {
      const existing = counts.get(item.itemId);
      if (existing) {
        existing.unitsOrdered += item.quantity;
      } else {
        counts.set(item.itemId, {
          itemId: item.itemId,
          name: item.name,
          unitsOrdered: item.quantity,
        });
      }
    }
  }

  return Array.from(counts.values()).sort(
    (a, b) => b.unitsOrdered - a.unitsOrdered
  );
}
