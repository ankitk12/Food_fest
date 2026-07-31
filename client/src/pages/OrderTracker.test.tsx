/**
 * Unit tests for OrderTracker.
 *
 * Covers rendering the current status label from the order state (Req 6.3):
 * the status returned by the first (immediate) poll of getOrder is displayed.
 * The polling interval is not driven here — the initial resolved fetch is
 * sufficient to verify the displayed status matches the fetched status, and
 * avoids a hanging interval.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as api from "../api/client.js";
import type { OrderResponse } from "../api/client.js";
import { ROUTES, orderPath } from "../routes.js";
import { OrderTracker } from "./OrderTracker.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>(
    "../api/client.js"
  );
  return { ...actual, getOrder: vi.fn() };
});

const getOrderMock = vi.mocked(api.getOrder);

function order(status: OrderResponse["status"]): OrderResponse {
  return {
    token: "BB-TOKEN-123",
    stallId: "stall-tandoori",
    items: [],
    total: 180,
    status,
    paid: true,
    paymentMethod: "UPI",
    customerId: "demo-customer",
    createdAt: new Date().toISOString(),
    spinUsed: false,
  };
}

function renderTracker(): void {
  render(
    <MemoryRouter initialEntries={[orderPath("BB-TOKEN-123")]}>
      <Routes>
        <Route path={ROUTES.order} element={<OrderTracker />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  getOrderMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("OrderTracker status label (Req 6.3)", () => {
  it("renders the current status label from the fetched order", async () => {
    getOrderMock.mockResolvedValue(order("Flavor Processing"));

    renderTracker();

    const status = await screen.findByTestId("order-status");
    expect(status).toHaveTextContent("Flavor Processing");
  });

  it("renders the token from the route param", async () => {
    getOrderMock.mockResolvedValue(order("Craving Funded"));

    renderTracker();

    expect(await screen.findByTestId("order-status")).toHaveTextContent(
      "Craving Funded"
    );
    expect(screen.getByTestId("order-tracker-token")).toHaveTextContent(
      "BB-TOKEN-123"
    );
  });
});

describe("OrderTracker progress steps (read-only)", () => {
  it("renders all four lifecycle steps with the current one active", async () => {
    getOrderMock.mockResolvedValue(order("Flavor Processing"));

    renderTracker();

    await screen.findByTestId("order-status");

    // All four steps are rendered.
    expect(screen.getByTestId("order-step-0")).toHaveTextContent("Craving Funded");
    expect(screen.getByTestId("order-step-1")).toHaveTextContent("Flavor Processing");
    expect(screen.getByTestId("order-step-2")).toHaveTextContent(
      "Taste Ready for Pickup"
    );
    expect(screen.getByTestId("order-step-3")).toHaveTextContent(
      "Happiness Disbursed"
    );

    // The current status step is marked active (aria-current="step").
    expect(screen.getByTestId("order-step-1")).toHaveAttribute("aria-current", "step");
    expect(screen.getByTestId("order-step-0")).not.toHaveAttribute("aria-current");
  });

  it("does not render an advance control (read-only customer view)", async () => {
    getOrderMock.mockResolvedValue(order("Craving Funded"));

    renderTracker();

    await screen.findByTestId("order-status");
    expect(screen.queryByTestId("order-advance")).toBeNull();
  });
});
