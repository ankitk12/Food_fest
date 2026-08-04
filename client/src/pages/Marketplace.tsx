/**
 * Marketplace — the food-item browsing page.
 *
 * Displays ALL food items across all stalls so users can browse the full
 * catalogue. The menu is polled periodically so that stock changes made by the
 * admin (e.g. marking items out of stock) are reflected without requiring a
 * page refresh.
 */

import { useCallback } from "react";
import { Link } from "react-router-dom";
import type { FoodItem } from "../../../types/index.js";
import { getAllItems } from "../api/client.js";
import { ROUTES } from "../routes.js";
import { useCart } from "../cart/CartContext.js";
import { usePolling } from "../hooks/usePolling.js";
import { FoodItemCard } from "./FoodItemCard.js";
import { formatINR } from "../format.js";

export function Marketplace(): JSX.Element {
  const { addItem, toggleCheese, toggleJain, cart, increment, decrement, removeItem } =
    useCart();

  const fetchMenu = useCallback(() => getAllItems(), []);
  const { data: items, error, loading } = usePolling<FoodItem[]>(fetchMenu);

  if (loading && !items && !error) {
    return (
      <main className="marketplace">
        <p role="status">Loading menu…</p>
      </main>
    );
  }

  if (error && !items) {
    return (
      <main className="marketplace">
        <div role="alert" className="marketplace-error">
          <h1>Something went wrong</h1>
          <p>We couldn&apos;t load the menu. Retrying…</p>
        </div>
      </main>
    );
  }

  const menuItems = items ?? [];
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce(
    (sum, line) => sum + line.unitPrice * line.quantity,
    0
  );

  return (
    <main className="marketplace">
      <header className="marketplace-header">
        <h1>Marketplace</h1>
        <Link to={ROUTES.cart} className="marketplace-cart-link">
          Cart ({cartCount})
        </Link>
      </header>

      {/* <div className="reward-info-banner">
        <h3>🎁 Earn Rewards on Every Order!</h3>
        <ul className="reward-info-list">
          <li><strong>Earn:</strong> Get 10% reward points on every order total</li>
          <li><strong>Use:</strong> Redeem points at checkout — 2 points = ₹1 off</li>
          <li><strong>Example:</strong> Order ₹100 → earn 10 points → use them for ₹5 off next time</li>
        </ul>
      </div> */}

      {menuItems.length === 0 ? (
        <p>No items are available right now.</p>
      ) : (
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

export default Marketplace;
