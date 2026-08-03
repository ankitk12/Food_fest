/**
 * Unit tests for the redesigned Invest-A-Bite HomePage.
 *
 * The HomePage now embeds direct ordering (live menu + cart), so tests provide
 * a CartProvider and a mocked catalogue.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { FoodItem } from "../../../types/index.js";
import * as api from "../api/client.js";
import { CartProvider } from "../cart/CartContext.js";
import { HomePage } from "./HomePage.js";

const sampleItem1: FoodItem = {
  id: "item-1",
  name: "Masala Chai",
  imageUrl: "https://example.com/c.jpg",
  description: "Hot spiced tea.",
  rating: 4.8,
  availableQuantity: 50,
  price: 15,
  stallId: "stall-1",
};

const sampleItem2: FoodItem = {
  id: "item-2",
  name: "Paneer Tikka",
  imageUrl: "https://example.com/p.jpg",
  description: "Char-grilled cottage cheese.",
  rating: 4.6,
  availableQuantity: 40,
  price: 80,
  stallId: "stall-1",
};

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>(
    "../api/client.js"
  );
  return { ...actual, getAllItems: vi.fn() };
});

const getAllItemsMock = vi.mocked(api.getAllItems);

function renderHome(): void {
  render(
    <CartProvider>
      <MemoryRouter initialEntries={["/"]}>
        <HomePage />
      </MemoryRouter>
    </CartProvider>
  );
}

beforeEach(() => {
  getAllItemsMock.mockReset();
  getAllItemsMock.mockResolvedValue([sampleItem1, sampleItem2]);
});

afterEach(() => {
  cleanup();
});

describe("HomePage — Invest-A-Bite redesign", () => {
  it("renders the HeroSection with 'Now trading' badge (Req 3.1)", () => {
    renderHome();
    expect(screen.getByText("Now trading")).toBeInTheDocument();
  });

  it("renders the Invest-A-Bite title (Req 3.2)", () => {
    renderHome();
    expect(
      screen.getByRole("heading", { name: /Invest.*A.*Bite/i })
    ).toBeInTheDocument();
  });

  it("renders the tagline (Req 3.3)", () => {
    renderHome();
    expect(
      screen.getByText("High returns on every bite. Zero risk, all flavour.")
    ).toBeInTheDocument();
  });

  it("renders the price range '₹15–80' dynamically based on lowest and highest prices (Req 3.4)", async () => {
    renderHome();
    expect(await screen.findByText("₹15–80")).toBeInTheDocument();
  });

  it("renders custom dynamic price range when items have different lowest and highest prices", async () => {
    getAllItemsMock.mockResolvedValue([
      { ...sampleItem1, price: 25 },
      { ...sampleItem2, price: 150 },
    ]);
    renderHome();
    expect(await screen.findByText("₹25–150")).toBeInTheDocument();
  });

  it("renders single price when lowest and highest price are equal", async () => {
    getAllItemsMock.mockResolvedValue([
      { ...sampleItem1, price: 50 },
      { ...sampleItem2, price: 50 },
    ]);
    renderHome();
    expect(await screen.findByText("₹50")).toBeInTheDocument();
  });

  it("renders '▲ Market open' status (Req 3.5)", () => {
    renderHome();
    expect(screen.getByText("▲ Market open")).toBeInTheDocument();
  });

  it("renders the TickerMarquee, driven by the live menu (Req 4.1)", async () => {
    renderHome();
    // The ticker reflects the loaded menu, so it appears after the fetch.
    expect(
      await screen.findByLabelText("Food price ticker")
    ).toBeInTheDocument();
  });

  it("renders the direct ordering section", () => {
    renderHome();
    expect(
      screen.getByRole("heading", { name: "Order Now" })
    ).toBeInTheDocument();
  });
});
