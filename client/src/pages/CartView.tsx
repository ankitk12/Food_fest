/**
 * CartView — review and adjust the cart before checkout (Req 3.1-3.5).
 *
 * Renders each line item with its name, unit price, quantity, and line total
 * (via the pure cart module, which delegates to the pricing domain), plus the
 * order total (Req 3.1, 3.2). Quantity increase/decrease and remove controls
 * mutate the shared cart context (Req 3.3, 3.4). When an increase would exceed
 * the item's available quantity the quantity is clamped and an over-quantity
 * notice is shown (Req 3.5).
 */

import { Link } from "react-router-dom";
import { ROUTES } from "../routes.js";
import { useCart } from "../cart/CartContext.js";
import { cartLineTotal } from "../cart/cart.js";
import { formatINR } from "../format.js";

export function CartView(): JSX.Element {
  const {
    cart,
    total,
    increment,
    decrement,
    removeItem,
    clampedItemId,
  } = useCart();

  if (cart.length === 0) {
    return (
      <main className="cart">
        <h1>Your Cart</h1>
        <p>Your cart is empty.</p>
        <Link to={ROUTES.marketplace}>Browse the marketplace</Link>
      </main>
    );
  }

  return (
    <main className="cart">
      <h1>Your Cart</h1>

      <ul className="cart-lines">
        {cart.map((line) => (
          <li
            key={line.itemId}
            className="cart-line"
            data-testid={`cart-line-${line.itemId}`}
          >
            <span className="cart-line-name">
              {line.name}
              {line.addCheese && (
                <span className="cart-line-addon"> + Cheese</span>
              )}
              {line.jain && <span className="cart-line-addon"> · Jain</span>}
            </span>
            <span className="cart-line-unit-price">
              {formatINR(line.unitPrice)}
            </span>

            <span className="cart-line-quantity-controls">
              <button
                type="button"
                aria-label={`Decrease quantity of ${line.name}`}
                onClick={() => decrement(line.itemId)}
                disabled={line.quantity <= 1}
              >
                −
              </button>
              <span
                className="cart-line-quantity"
                data-testid={`cart-quantity-${line.itemId}`}
              >
                {line.quantity}
              </span>
              <button
                type="button"
                aria-label={`Increase quantity of ${line.name}`}
                onClick={() => increment(line.itemId)}
              >
                +
              </button>
            </span>

            <span
              className="cart-line-total"
              data-testid={`cart-line-total-${line.itemId}`}
            >
              {formatINR(cartLineTotal(line))}
            </span>

            <button
              type="button"
              className="cart-line-remove"
              aria-label={`Remove ${line.name}`}
              onClick={() => removeItem(line.itemId)}
            >
              Remove
            </button>

            {clampedItemId === line.itemId && (
              <p role="alert" className="cart-line-notice">
                Only {line.availableQuantity} available — quantity limited to{" "}
                {line.availableQuantity}.
              </p>
            )}
          </li>
        ))}
      </ul>

      <p className="cart-total" data-testid="cart-order-total">
        Order total: <strong>{formatINR(total)}</strong>
      </p>

      <Link to={ROUTES.checkout} className="cart-checkout-link">
        Proceed to checkout
      </Link>
    </main>
  );
}

export default CartView;
