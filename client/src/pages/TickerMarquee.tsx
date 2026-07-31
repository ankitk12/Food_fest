/**
 * TickerMarquee — horizontally scrolling food price ticker styled as a stock ticker.
 *
 * Displays food items and their prices in a continuous right-to-left loop.
 * The item list is repeated an even number of times in the DOM so the track
 * always overfills the (full-bleed) viewport, avoiding blank gaps where only a
 * couple items would otherwise show. The animation shifts by exactly one half
 * (translateX(0) → translateX(-50%)), so the two identical halves loop seamlessly.
 *
 * Accessibility:
 *   - `aria-label="Food price ticker"` on the outer container
 *   - When `prefers-reduced-motion` is active, the CSS media query disables animation
 *     and the ticker displays statically.
 *
 * Hover behavior: animation pauses via CSS `:hover` on the container changing
 * `animation-play-state` on the track element.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

export interface TickerItem {
  name: string;
  price: number;
}

export interface TickerMarqueeProps {
  items: TickerItem[];
}

export function TickerMarquee({ items }: TickerMarqueeProps): JSX.Element | null {
  if (items.length === 0) {
    return null;
  }

  // Repeat items so the track always overfills the (full-bleed) viewport,
  // then the animation shifts by exactly one half for a seamless loop.
  // Using an even repeat count keeps the two halves identical.
  const REPEAT = 4;
  const duplicatedItems = Array.from({ length: REPEAT }, () => items).flat();

  return (
    <div
      className="ia-ticker"
      aria-label="Food price ticker"
      style={{
        overflow: "hidden",
        backgroundColor: "#7BE495",
        padding: "10px 0",
      }}
    >
      <div
        className="ia-ticker-track"
        style={{
          display: "flex",
          width: "max-content",
          whiteSpace: "nowrap",
          animation: "ia-marquee 28s linear infinite",
        }}
      >
        {duplicatedItems.map((item, index) => (
          <span
            key={`${item.name}-${index}`}
            className="ia-ticker-item"
            style={{
              fontFamily: "'Anton', 'Arial Black', sans-serif",
              fontSize: "26px",
              letterSpacing: "0.01em",
              color: "#0B1712",
              paddingRight: "1.5rem",
              flexShrink: 0,
            }}
          >
            ▲ {item.name} ₹{item.price}
          </span>
        ))}
      </div>
    </div>
  );
}

export default TickerMarquee;
