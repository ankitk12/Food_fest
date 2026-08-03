/**
 * Unit tests for the Marketplace page.
 *
 * Covers rendering all food items from the full catalogue and the error state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { FoodItem } from "../../../types/index.js";
import * as api from "../api/client.js";
import { ROUTES } from "../routes.js";
import { CartProvider } from "../cart/CartContext.js";
import { Marketplace } from "./Marketplace.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>(
    "../api/client.js"
  );
  return { ...actual, getAllItems: vi.fn() };
});

const getAllItemsMock = vi.mocked(api.getAllItems);

function renderMarketplace(): void {
  render(
    <CartProvider>
      <MemoryRouter initialEntries={[ROUTES.marketplace]}>
        <Routes>
          <Route path={ROUTES.marketplace} element={<Marketplace />} />
        </Routes>
      </MemoryRouter>
    </CartProvider>
  );
}

const sampleItem: FoodItem = {
  id: "item-1",
  name: "Paneer Tikka",
  imageUrl: "https://example.com/p.jpg",
  description: "Char-grilled cottage cheese.",
  rating: 4.6,
  availableQuantity: 40,
  price: 180,
  stallId: "stall-1",
};

beforeEach(() => {
  getAllItemsMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Marketplace error view", () => {
  it("shows an error message when getAllItems rejects", async () => {
    getAllItemsMock.mockRejectedValueOnce(new Error("Network error"));

    renderMarketplace();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/something went wrong/i);
  });
});

describe("Marketplace menu rendering", () => {
  it("renders a food item card for each menu item", async () => {
    getAllItemsMock.mockResolvedValueOnce([sampleItem]);

    renderMarketplace();

    expect(await screen.findByTestId("food-card-item-1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to Cart" })
    ).toBeInTheDocument();
  });
});
