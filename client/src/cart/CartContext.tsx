/**
 * CartContext — a lightweight React context/store over the pure cart module.
 *
 * Holds the current cart in state and exposes the cart actions (add, set
 * quantity, remove) plus derived totals. All mutations delegate to the pure
 * helpers in `cart.ts`, so the components stay thin and the business rules
 * (increment-by-one, clamping) live in one tested place.
 *
 * The provider also tracks the id of the most recently clamped line so the
 * CartView can surface an over-quantity notice (Req 3.5).
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { FoodItem } from "../../../types/index.js";
import {
  addToCart as addToCartPure,
  setCheese as setCheesePure,
  cartTotal,
  emptyCart,
  removeItem as removeItemPure,
  setQuantity as setQuantityPure,
  type Cart,
} from "./cart.js";

export interface CartContextValue {
  cart: Cart;
  /** Order total in INR (sum of line totals). */
  total: number;
  /** Add one unit of the given food item to the cart (optionally with cheese). */
  addItem: (item: FoodItem, addCheese?: boolean) => void;
  /** Toggle the extra-cheese add-on on an existing cart line. */
  toggleCheese: (itemId: string, addCheese: boolean) => void;
  /** Set an explicit quantity for a line, clamping to availability. */
  setItemQuantity: (itemId: string, quantity: number) => void;
  /** Increase a line's quantity by one (clamped to availability). */
  increment: (itemId: string) => void;
  /** Decrease a line's quantity by one (never below one). */
  decrement: (itemId: string) => void;
  /** Remove a line from the cart entirely. */
  removeItem: (itemId: string) => void;
  /** Clear all items from the cart. */
  clearCart: () => void;
  /** The item id whose last quantity change was clamped, or null. */
  clampedItemId: string | null;
  /** Clear the clamp notice. */
  dismissClampNotice: () => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }): JSX.Element {
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [clampedItemId, setClampedItemId] = useState<string | null>(null);

  const addItem = useCallback((item: FoodItem, addCheese = false) => {
    setCart((current) => addToCartPure(current, item, addCheese));
  }, []);

  const toggleCheese = useCallback((itemId: string, addCheese: boolean) => {
    setCart((current) => setCheesePure(current, itemId, addCheese));
  }, []);

  const applyQuantity = useCallback((itemId: string, quantity: number) => {
    setCart((current) => {
      const { cart: next, clamped } = setQuantityPure(current, itemId, quantity);
      setClampedItemId(clamped ? itemId : null);
      return next;
    });
  }, []);

  const setItemQuantity = useCallback(
    (itemId: string, quantity: number) => applyQuantity(itemId, quantity),
    [applyQuantity]
  );

  const increment = useCallback(
    (itemId: string) => {
      setCart((current) => {
        const line = current.find((l) => l.itemId === itemId);
        if (!line) return current;
        const { cart: next, clamped } = setQuantityPure(
          current,
          itemId,
          line.quantity + 1
        );
        setClampedItemId(clamped ? itemId : null);
        return next;
      });
    },
    []
  );

  const decrement = useCallback((itemId: string) => {
    setCart((current) => {
      const line = current.find((l) => l.itemId === itemId);
      if (!line) return current;
      const { cart: next } = setQuantityPure(
        current,
        itemId,
        line.quantity - 1
      );
      setClampedItemId(null);
      return next;
    });
  }, []);

  const removeItem = useCallback((itemId: string) => {
    setCart((current) => removeItemPure(current, itemId));
    setClampedItemId((id) => (id === itemId ? null : id));
  }, []);

  const clearCart = useCallback(() => {
    setCart(emptyCart);
    setClampedItemId(null);
  }, []);

  const dismissClampNotice = useCallback(() => setClampedItemId(null), []);

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      total: cartTotal(cart),
      addItem,
      toggleCheese,
      setItemQuantity,
      increment,
      decrement,
      removeItem,
      clearCart,
      clampedItemId,
      dismissClampNotice,
    }),
    [
      cart,
      addItem,
      toggleCheese,
      setItemQuantity,
      increment,
      decrement,
      removeItem,
      clearCart,
      clampedItemId,
      dismissClampNotice,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

/** Access the cart context; throws if used outside a <CartProvider>. */
export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return ctx;
}
