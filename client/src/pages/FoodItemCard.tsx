/**
 * FoodItemCard — renders a single marketplace food item (Req 2.1, 2.2, 2.3, 2.5).
 *
 * Displays the item image, description, startup rating (0..5 with a star
 * representation), available quantity, and price in Indian Rupees. When the
 * item is sold out (availableQuantity === 0) the card is marked unavailable and
 * the "Add to Cart" button is disabled (Req 2.3).
 *
 * When the item is already in the cart, quantity controls (+/-) are shown
 * directly on the card so users can adjust quantity without navigating away.
 * Decreasing to 0 removes the item from the cart.
 */

import type { FoodItem } from "../../../types/index.js";
import { formatINR } from "../format.js";

export interface FoodItemCardProps {
  item: FoodItem;
  onAddToCart: (item: FoodItem) => void;
  /** Current quantity of this item in the cart (0 if not in cart). */
  cartQuantity?: number;
  /** Increment the quantity of this item in the cart. */
  onIncrement?: (itemId: string) => void;
  /** Decrement the quantity of this item in the cart. */
  onDecrement?: (itemId: string) => void;
  /** Remove this item from the cart entirely. */
  onRemove?: (itemId: string) => void;
}

export function FoodItemCard({
  item,
  onAddToCart,
  cartQuantity = 0,
  onIncrement,
  onDecrement,
  onRemove,
}: FoodItemCardProps): JSX.Element {
  const unavailable = item.availableQuantity === 0;
  const inCart = cartQuantity > 0;

  function handleDecrement(): void {
    if (cartQuantity <= 1) {
      onRemove?.(item.id);
    } else {
      onDecrement?.(item.id);
    }
  }

  return (
    <article
      className={`food-card${unavailable ? " food-card-unavailable" : ""}`}
      data-testid={`food-card-${item.id}`}
      aria-label={item.name}
    >
      <img
        className="food-card-image"
        data-testid="food-card-image"
        src={item.imageUrl}
        alt={item.name}
      />
      <h3 className="food-card-name">{item.name}</h3>
      <p className="food-card-description" data-testid="food-card-description">
        {item.description}
      </p>

      <p className="food-card-availability" data-testid="food-card-availability">
        {unavailable ? (
          <span className="food-card-unavailable-label">Unavailable</span>
        ) : (
          <span>{item.availableQuantity} available</span>
        )}
      </p>

      <p className="food-card-price" data-testid="food-card-price">
        {formatINR(item.price)}
      </p>

      {inCart ? (
        <div className="food-card-quantity-controls" data-testid="food-card-qty-controls">
          <button
            type="button"
            className="food-card-qty-btn food-card-qty-minus"
            onClick={handleDecrement}
            aria-label={`Decrease quantity of ${item.name}`}
          >
            −
          </button>
          <span className="food-card-qty-value" data-testid="food-card-qty">
            {cartQuantity}
          </span>
          <button
            type="button"
            className="food-card-qty-btn food-card-qty-plus"
            onClick={() => onIncrement?.(item.id)}
            disabled={cartQuantity >= item.availableQuantity}
            aria-label={`Increase quantity of ${item.name}`}
          >
            +
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="food-card-add"
          disabled={unavailable}
          aria-disabled={unavailable}
          onClick={() => onAddToCart(item)}
        >
          Add to Cart
        </button>
      )}
    </article>
  );
}

export default FoodItemCard;
