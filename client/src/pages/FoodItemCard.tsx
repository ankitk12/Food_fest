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

import { useState } from "react";
import type { FoodItem } from "../../../types/index.js";
import { formatINR } from "../format.js";
import { cheesePriceOf } from "../cart/cart.js";

export interface FoodItemCardProps {
  item: FoodItem;
  onAddToCart: (item: FoodItem, addCheese?: boolean, jain?: boolean) => void;
  /** Current quantity of this item in the cart (0 if not in cart). */
  cartQuantity?: number;
  /** Whether the cheese add-on is currently on for this item's cart line. */
  addCheese?: boolean;
  /** Toggle the cheese add-on for this item's existing cart line. */
  onToggleCheese?: (itemId: string, addCheese: boolean) => void;
  /** Whether the Jain option is currently on for this item's cart line. */
  jain?: boolean;
  /** Toggle the Jain option for this item's existing cart line. */
  onToggleJain?: (itemId: string, jain: boolean) => void;
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
  addCheese = false,
  onToggleCheese,
  jain = false,
  onToggleJain,
  onIncrement,
  onDecrement,
  onRemove,
}: FoodItemCardProps): JSX.Element {
  const unavailable = item.availableQuantity === 0;
  const inCart = cartQuantity > 0;
  // The cheese add-on price is configured per item by the admin; 0 means the
  // item offers no cheese option.
  const cheesePrice = cheesePriceOf(item);
  const cheeseOffered = cheesePrice > 0;
  const jainOffered = item.jainAvailable === true;
  // Choices for a not-yet-added item; once in cart the cart line is the source
  // of truth (via the `addCheese` / `jain` props).
  const [pendingCheese, setPendingCheese] = useState(false);
  const [pendingJain, setPendingJain] = useState(false);
  const cheeseOn = inCart ? addCheese : pendingCheese;
  const jainOn = inCart ? jain : pendingJain;

  function handleCheeseChange(next: boolean): void {
    if (inCart) onToggleCheese?.(item.id, next);
    else setPendingCheese(next);
  }

  function handleJainChange(next: boolean): void {
    if (inCart) onToggleJain?.(item.id, next);
    else setPendingJain(next);
  }

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
          ''
        )}
      </p>

      <p className="food-card-price" data-testid="food-card-price">
        {formatINR(item.price)}
      </p>

      {!unavailable && cheeseOffered && (
        <label className="food-card-addon" data-testid={`food-card-cheese-${item.id}`}>
          <input
            type="checkbox"
            checked={cheeseOn}
            onChange={(e) => handleCheeseChange(e.target.checked)}
          />
          <span>Add cheese (+{formatINR(cheesePrice)})</span>
        </label>
      )}

      {!unavailable && jainOffered && (
        <label className="food-card-addon" data-testid={`food-card-jain-${item.id}`}>
          <input
            type="checkbox"
            checked={jainOn}
            onChange={(e) => handleJainChange(e.target.checked)}
          />
          <span>Jain</span>
        </label>
      )}

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
          onClick={() => {
            onAddToCart(item, pendingCheese, pendingJain);
            setPendingCheese(false);
            setPendingJain(false);
          }}
        >
          Add to Cart
        </button>
      )}
    </article>
  );
}

export default FoodItemCard;
