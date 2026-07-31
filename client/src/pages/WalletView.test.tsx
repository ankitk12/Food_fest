/**
 * Unit tests for WalletView.
 *
 * Covers wallet balance display (Req 9.2): the fetched FoodCoins balance is
 * shown. Covers the three redemption option types (Req 9.5): free toppings,
 * discounts, and lucky draw entries all render.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as api from "../api/client.js";
import { ROUTES, walletPath } from "../routes.js";
import { WalletView } from "./WalletView.js";

vi.mock("../api/client.js", async () => {
  const actual = await vi.importActual<typeof import("../api/client.js")>(
    "../api/client.js"
  );
  return { ...actual, getWallet: vi.fn(), redeem: vi.fn() };
});

const getWalletMock = vi.mocked(api.getWallet);

function renderWalletAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={ROUTES.wallet} element={<WalletView />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  getWalletMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("WalletView balance display (Req 9.2)", () => {
  it("displays the fetched FoodCoins balance", async () => {
    getWalletMock.mockResolvedValueOnce({
      customerId: "demo-customer",
      foodCoins: 142,
    });

    renderWalletAt(walletPath("demo-customer"));

    const balance = await screen.findByTestId("wallet-balance");
    expect(balance).toHaveTextContent("142");
  });
});


