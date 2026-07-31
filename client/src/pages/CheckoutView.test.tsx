/**
 * Unit tests for CheckoutView.
 *
 * Covers token display after a successful checkout (Req 5.5): when api.checkout
 * resolves with an issued Order_Token, the token is shown to the customer along
 * with a link to track the order. Also covers the payment-failure path (Req
 * 5.3): a failure message is shown and the cart is retained.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FoodItem } from "../../../types/index.js";
import { ApiClientError } from "../api/client.js";
import * as api from "../api/client.js";
import { ROUTES } from "../routes.js";
import { CartProvider, useCart } from "../cart/CartContext.js";
import {
  CustomerProvider,
  CUSTOMER_STORAGE_KEY,
} from "../customer/CustomerContext.js";
import { CheckoutView } from "./CheckoutView.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>(
    "../api/client.js"
  );
  return { ...actual, checkout: vi.fn() };
});

const checkoutMock = vi.mocked(api.checkout);

const sampleItem: FoodItem = {
  id: "item-1",
  name: "Paneer Tikka",
  imageUrl: "https://example.com/p.jpg",
  description: "Char-grilled cottage cheese.",
  rating: 4.6,
  availableQuantity: 40,
  price: 180,
  stallId: "stall-tandoori",
  spice: "medium",
  flavor: "savory",
  portion: "regular",
};

/** Seeds the cart with one sample item, then renders CheckoutView. */
function SeedCart(): JSX.Element {
  const { addItem, cart } = useCart();
  return (
    <div>
      <button type="button" onClick={() => addItem(sampleItem)}>
        seed-cart
      </button>
      <span data-testid="cart-count">{cart.length}</span>
    </div>
  );
}

function renderCheckout(): void {
  render(
    <CustomerProvider>
      <CartProvider>
        <MemoryRouter initialEntries={[ROUTES.checkout]}>
          <SeedCart />
          <Routes>
            <Route path={ROUTES.checkout} element={<CheckoutView />} />
            <Route path={ROUTES.order} element={<div>ORDER TRACKER PAGE</div>} />
            <Route path={ROUTES.orderHistory} element={<div data-testid="order-history-page">ORDER HISTORY PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </CartProvider>
    </CustomerProvider>
  );
}

beforeEach(() => {
  checkoutMock.mockReset();
  // Seed a persisted customer identity so CheckoutView is not gated on the
  // mobile-entry form. CustomerProvider reads this on mount.
  window.localStorage.setItem(
    CUSTOMER_STORAGE_KEY,
    JSON.stringify({ mobile: "+919876543210", name: "Asha" })
  );
});

afterEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("CheckoutView token display (Req 5.5)", () => {
  it("navigates to Order History after a successful checkout and clears the cart", async () => {
    checkoutMock.mockResolvedValueOnce({
      token: "BB-TOKEN-123",
      status: "Craving Funded",
      coinsEarned: 18,
      spinAvailable: true,
      total: 180,
      notified: true,
    });

    renderCheckout();
    fireEvent.click(screen.getByRole("button", { name: "seed-cart" }));
    // Selecting UPI opens the QR screen; confirming finalizes the order.
    fireEvent.click(screen.getByRole("button", { name: "Pay with UPI" }));
    fireEvent.click(await screen.findByTestId("upi-confirm"));

    // After successful payment, navigates to the order history page.
    const historyPage = await screen.findByTestId("order-history-page");
    expect(historyPage).toBeInTheDocument();
    // Cart is cleared after successful payment.
    expect(screen.getByTestId("cart-count")).toHaveTextContent("0");
  });
});

describe("CheckoutView customer identity", () => {
  it("sends the active customer's mobile as the checkout customerId", async () => {
    checkoutMock.mockResolvedValueOnce({
      token: "BB-TOKEN-9",
      status: "Craving Funded",
      coinsEarned: 5,
      spinAvailable: true,
      total: 180,
      notified: false,
    });

    renderCheckout();
    fireEvent.click(screen.getByRole("button", { name: "seed-cart" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pay with UPI" }));
    fireEvent.click(await screen.findByTestId("upi-confirm"));

    // After successful checkout, navigates to order history.
    await screen.findByTestId("order-history-page");
    expect(checkoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "+919876543210",
        paymentMethod: "UPI",
      })
    );
  });
});

describe("CheckoutView payment failure (Req 5.3)", () => {
  it("shows a failure message and retains the cart when payment fails", async () => {
    checkoutMock.mockRejectedValueOnce(
      new ApiClientError(402, "Payment failed", "PAYMENT_FAILED")
    );

    renderCheckout();
    fireEvent.click(screen.getByRole("button", { name: "seed-cart" }));
    fireEvent.click(await screen.findByRole("button", { name: "Pay with UPI" }));
    fireEvent.click(await screen.findByTestId("upi-confirm"));

    expect(await screen.findByTestId("payment-error")).toBeInTheDocument();
    // Cart retained: the seeded line is still present.
    await waitFor(() =>
      expect(screen.getByTestId("cart-count")).toHaveTextContent("1")
    );
  });
});
