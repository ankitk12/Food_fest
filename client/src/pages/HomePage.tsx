/**
 * HomePage — the Invest-A-Bite landing page.
 *
 * Renders the hero section, scrolling ticker, and the live ordering section
 * (browse the catalogue and add items straight to the cart — no separate
 * marketplace page). The menu is polled so admin stock changes show up without
 * a manual refresh. Uses useScrollReveal for scroll-triggered animations on
 * sections with [data-reveal] attributes.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1
 */

import { useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useScrollReveal } from "../hooks/useScrollReveal.js";
import { HeroSection } from "./HeroSection.js";
import { TickerMarquee } from "./TickerMarquee.js";
import type { TickerItem } from "./TickerMarquee.js";
import type { Coupon, FoodItem } from "../../../types/index.js";
import { getAllItems, getCoupons } from "../api/client.js";
import { ROUTES } from "../routes.js";
import { useCart } from "../cart/CartContext.js";
import { usePolling } from "../hooks/usePolling.js";
import { FoodItemCard } from "./FoodItemCard.js";
import { formatINR } from "../format.js";

export function HomePage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useScrollReveal(containerRef);

  const { addItem, toggleCheese, toggleJain, cart, increment, decrement, removeItem } =
    useCart();

  const fetchMenu = useCallback(() => getAllItems(), []);
  const { data: items, error, loading } = usePolling<FoodItem[]>(fetchMenu);

  // Available offers (active coupons) shown to the customer before ordering.
  const fetchCoupons = useCallback(() => getCoupons(), []);
  const { data: coupons } = usePolling<Coupon[]>(fetchCoupons);
  const offers = (coupons ?? []).filter((c) => c.active);

  const menuItems = items ?? [];

  // Ticker items mirror the live menu: each catalogue item shows its name and
  // current price in the scrolling marquee (empty until the menu loads).
  const tickerItems = useMemo<TickerItem[]>(
    () => menuItems.map((item) => ({ name: item.name, price: item.price })),
    [menuItems]
  );
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0
  );

  return (
    <main className="home" ref={containerRef}>
      <HeroSection items={menuItems} offers={offers} />
      <TickerMarquee items={tickerItems} />

      <section className="home-order" style={{ padding: "48px 6vw 96px" }}>
        <header className="home-order-header">
          <h2 className="home-order-title">Order Now</h2>
          <p className="home-order-subtitle">
            Fresh off the board — add items straight to your cart.
          </p>
        </header>



        {/* <div className="reward-info-banner">
          <h3>🎁 Earn Rewards on Every Order!</h3>
          <ul className="reward-info-list">
            <li><strong>Earn:</strong> Get 10% reward points on every order total</li>
            <li><strong>Use:</strong> Redeem points at checkout — 2 points = ₹1 off</li>
            <li><strong>Example:</strong> Order ₹100 → earn 10 points → use them for ₹5 off next time</li>
          </ul>
        </div> */}

        {loading && !items && !error && <p role="status">Loading menu…</p>}

        {error && !items && (
          <div role="alert" className="marketplace-error">
            <p>We couldn&apos;t load the menu. Retrying…</p>
          </div>
        )}

        {items && menuItems.length === 0 && (
          <p>No items are available right now.</p>
        )}

        {menuItems.length > 0 && (
          <ul className="food-card-list">
            {menuItems.map((item) => {
              const line = cart.find((l) => l.itemId === item.id);
              return (
                <li key={item.id}>
                  <FoodItemCard
                    item={item}
                    onAddToCart={addItem}
                    cartQuantity={line?.quantity ?? 0}
                    addCheese={line?.addCheese ?? false}
                    onToggleCheese={toggleCheese}
                    jain={line?.jain ?? false}
                    onToggleJain={toggleJain}
                    onIncrement={increment}
                    onDecrement={decrement}
                    onRemove={removeItem}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {cartCount > 0 && (
        <div className="cart-bar" role="region" aria-label="Cart summary">
          <div className="cart-bar-info">
            <span className="cart-bar-count" data-testid="cart-bar-count">
              {cartCount} {cartCount === 1 ? "item" : "items"}
            </span>
            <span className="cart-bar-total">{formatINR(cartTotal)}</span>
          </div>
          <Link to={ROUTES.checkout} className="cart-bar-checkout">
            Checkout →
          </Link>
        </div>
      )}
    </main>
  );
}

export default HomePage;
