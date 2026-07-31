/**
 * HomePage — the Invest-A-Bite landing page.
 *
 * Renders the hero section, scrolling ticker, food image gallery, and
 * investment-themed menu sections. Uses useScrollReveal for scroll-triggered
 * animations on sections with [data-reveal] attributes.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 5.1, 6.1
 */

import { useRef } from "react";
import { useScrollReveal } from "../hooks/useScrollReveal.js";
import { HeroSection } from "./HeroSection.js";
import { TickerMarquee } from "./TickerMarquee.js";
import type { TickerItem } from "./TickerMarquee.js";
import { FoodImageGallery } from "./FoodImageGallery.js";
import { MenuSections } from "./MenuSections.js";

// --- Ticker items: food items with prices for the scrolling marquee ---
const tickerItems: TickerItem[] = [
  { name: "Mint Mojito", price: 50 },
  { name: "Green Apple Mojito", price: 60 },
  { name: "Jamun Shot", price: 35 },
  { name: "Kiwi Shot", price: 40 },
  { name: "Googhra", price: 60 },
  { name: "Momos", price: 60 },
  { name: "Monaco Chaat", price: 60 },
  { name: "Basket Chaat", price: 60 },
  { name: "Chhas", price: 15 },
  { name: "Meetha Paan", price: 30 },
];

// --- Gallery items: food images matching reference design (3 cards) ---
const galleryItems = [
  {
    name: "Momos",
    imageUrl: "https://images.unsplash.com/photo-1625220194771-7ebdea0b70b9?auto=format&fit=crop&w=800&q=80",
    category: "Momos",
    accentColor: "#FFB43A",
  },
  {
    name: "Pani Puri",
    imageUrl: "https://images.unsplash.com/photo-1586357507341-3fbe59f2a5d9?auto=format&fit=crop&w=800&q=80",
    category: "Pani Puri",
    accentColor: "#7BE495",
  },
  {
    name: "Mint Mojito",
    imageUrl: "https://images.unsplash.com/photo-1551538827-9c037cb4f32a?auto=format&fit=crop&w=800&q=80",
    category: "Mint Mojito",
    accentColor: "#C79BFF",
  },
];

// --- Menu sections: investment-themed food categories ---
const menuSections = [
  {
    title: "Blue-Chip Mojitos",
    accentColor: "#FFB43A",
    items: [
      { name: "Mint Mojito", price: 50 },
      { name: "Green Apple Mojito", price: 60 },
    ],
  },
  {
    title: "High-Yield Shots",
    accentColor: "#C79BFF",
    items: [
      { name: "Jamun Shot", price: 35 },
      { name: "Kiwi Shot", price: 40 },
    ],
  },
  {
    title: "Hot Assets",
    accentColor: "#FFB43A",
    items: [
      { name: "Googhra", price: 60, subtitle: "3 pcs" },
      { name: "Momos", price: 60, subtitle: "4 pcs" },
    ],
  },
  {
    title: "Cool Dividends",
    accentColor: "#7BE495",
    items: [
      { name: "Chhas", price: 15 },
      { name: "Meetha Paan", price: 30 },
    ],
  },
  {
    title: "Chaat Portfolio",
    accentColor: "#FFB43A",
    isBonus: true,
    bonusText: "Add cheese to any chaat — +₹20",
    items: [
      { name: "Monaco Chaat", price: 60 },
      { name: "Basket Chaat", price: 60 },
    ],
  },
];

export function HomePage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useScrollReveal(containerRef);

  return (
    <main className="home" ref={containerRef}>
      <HeroSection />
      <TickerMarquee items={tickerItems} />
      <div style={{ padding: "26px 6vw 0" }}>
        <FoodImageGallery items={galleryItems} />
      </div>
      <div style={{ padding: "64px 6vw 84px" }}>
        <MenuSections sections={menuSections} />
      </div>
    </main>
  );
}

export default HomePage;
