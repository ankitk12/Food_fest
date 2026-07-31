/**
 * Unit tests for the redesigned Invest-A-Bite HomePage.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 5.1, 6.1
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HomePage } from "./HomePage.js";

function renderHome(): void {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <HomePage />
    </MemoryRouter>
  );
}

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

  it("renders the price range '₹15–80' (Req 3.4)", () => {
    renderHome();
    expect(screen.getByText("₹15–80")).toBeInTheDocument();
  });

  it("renders '▲ Market open' status (Req 3.5)", () => {
    renderHome();
    expect(screen.getByText("▲ Market open")).toBeInTheDocument();
  });

  it("renders the TickerMarquee with food price ticker label (Req 4.1)", () => {
    renderHome();
    expect(screen.getByLabelText("Food price ticker")).toBeInTheDocument();
  });

  it("renders menu section headings (Req 6.1)", () => {
    renderHome();
    expect(screen.getByText("Blue-Chip Mojitos")).toBeInTheDocument();
    expect(screen.getByText("High-Yield Shots")).toBeInTheDocument();
    expect(screen.getByText("Hot Assets")).toBeInTheDocument();
    expect(screen.getByText("Cool Dividends")).toBeInTheDocument();
    expect(screen.getByText("Chaat Portfolio")).toBeInTheDocument();
  });

  it("renders gallery items from the food image gallery (Req 5.1)", () => {
    renderHome();
    // Gallery renders food images with alt text matching the reference set
    expect(screen.getByAltText("Momos")).toBeInTheDocument();
    expect(screen.getByAltText("Basket Chaat")).toBeInTheDocument();
    expect(screen.getByAltText("Mint Mojito")).toBeInTheDocument();
    // The old "Pani Puri" gallery label should no longer be present
    expect(screen.queryByText(/Pani Puri/)).toBeNull();
  });
});
