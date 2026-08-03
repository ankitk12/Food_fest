/**
 * Unit tests for AdminOrdersView.
 *
 * Covers:
 *  - Listing orders from GET /api/admin/orders (token, stall, customer, status).
 *  - Advancing an order via POST (advanceOrder) and refreshing the list.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import * as api from "../api/client.js";
import type { OrderResponse } from "../api/client.js";
import { CustomerProvider, CUSTOMER_STORAGE_KEY } from "../customer/CustomerContext.js";
import { ADMIN_MOBILE } from "../constants.js";
import { AdminOrdersView } from "./AdminOrdersView.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>(
    "../api/client.js"
  );
  return { ...actual, getAdminOrders: vi.fn(), advanceOrder: vi.fn() };
});

const getAdminOrdersMock = vi.mocked(api.getAdminOrders);
const advanceOrderMock = vi.mocked(api.advanceOrder);

const order: OrderResponse = {
  token: "BB-ABC-1",
  stallId: "stall-tandoori",
  items: [
    { itemId: "item-1", name: "Paneer Tikka", unitPrice: 180, quantity: 2 },
  ],
  total: 360,
  status: "Craving Funded",
  paid: true,
  paymentMethod: "UPI",
  customerId: "+919876543210",
  customerName: "Asha Rao",
  createdAt: "2024-01-01T10:00:00.000Z",
};

function renderAdmin(): void {
  render(
    <CustomerProvider>
      <MemoryRouter>
        <AdminOrdersView />
      </MemoryRouter>
    </CustomerProvider>
  );
}

beforeEach(() => {
  getAdminOrdersMock.mockReset();
  advanceOrderMock.mockReset();
  // Set admin identity so the view is accessible.
  window.localStorage.setItem(
    CUSTOMER_STORAGE_KEY,
    JSON.stringify({ mobile: ADMIN_MOBILE, name: "Admin" })
  );
});

afterEach(() => {
  window.localStorage.clear();
  cleanup();
});

describe("AdminOrdersView listing", () => {
  it("lists orders with token, customer, and status", async () => {
    getAdminOrdersMock.mockResolvedValue([order]);

    renderAdmin();

    const row = await screen.findByTestId("admin-order-BB-ABC-1");
    expect(row).toHaveTextContent("BB-ABC-1");
    expect(row).toHaveTextContent("+919876543210");
    // The customer's registered name is shown alongside the number.
    expect(row).toHaveTextContent("Asha Rao");
    expect(screen.getByTestId("admin-status-BB-ABC-1")).toHaveTextContent(
      "Craving Funded"
    );
    // The unauthenticated demo note is present.
    expect(screen.getByTestId("admin-note")).toBeInTheDocument();
  });
});

describe("AdminOrdersView advance", () => {
  it("advances an order via POST and refreshes the list", async () => {
    getAdminOrdersMock
      .mockResolvedValueOnce([order])
      .mockResolvedValue([{ ...order, status: "Flavor Processing" }]);
    advanceOrderMock.mockResolvedValueOnce({ ...order, status: "Flavor Processing" });

    renderAdmin();

    fireEvent.click(await screen.findByTestId("admin-advance-BB-ABC-1"));

    await waitFor(() =>
      expect(advanceOrderMock).toHaveBeenCalledWith("BB-ABC-1")
    );
    await waitFor(() =>
      expect(screen.getByTestId("admin-status-BB-ABC-1")).toHaveTextContent(
        "Flavor Processing"
      )
    );
  });

  it("disables the advance action once an order is Happiness Disbursed", async () => {
    getAdminOrdersMock.mockResolvedValue([
      { ...order, status: "Happiness Disbursed" },
    ]);

    renderAdmin();

    expect(await screen.findByTestId("admin-advance-BB-ABC-1")).toBeDisabled();
  });
});
