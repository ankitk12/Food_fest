/**
 * Central route path definitions for the ByteBites client.
 *
 * Keeping the route paths in one place lets pages, the router, and tests share
 * a single source of truth. Path builders are provided for parameterized
 * routes so callers never hand-concatenate segments.
 */

export const ROUTES = {
  home: "/",
  marketplace: "/marketplace",
  stall: "/stalls/:stallId",
  cart: "/cart",
  checkout: "/checkout",
  order: "/orders/:token",
  metrics: "/metrics",
  wallet: "/wallet/:customerId",
  trending: "/trending",
  investor: "/investor",
  profile: "/profile",
  orderHistory: "/order-history",
  admin: "/admin",
  stock: "/admin/stock",
  summary: "/admin/summary",
} as const;

/** Build the marketplace menu path for a specific stall. */
export function stallPath(stallId: string): string {
  return `/stalls/${encodeURIComponent(stallId)}`;
}

/** Build the order-tracking path for a specific order token. */
export function orderPath(token: string): string {
  return `/orders/${encodeURIComponent(token)}`;
}

/** Build the wallet path for a specific customer. */
export function walletPath(customerId: string): string {
  return `/wallet/${encodeURIComponent(customerId)}`;
}
