/**
 * HeroSection — Invest-A-Bite landing hero.
 *
 * Renders the brand identity area with animated background orbs,
 * "NOW TRADING" badge, title, tagline, price range, and market status.
 */
export function HeroSection(): JSX.Element {
  return (
    <section
      className="ia-hero"
      style={{
        position: "relative",
        overflow: "hidden",
        padding: "15px 6vw 15px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: "30px",
        textAlign: "left",
      }}
    >
      {/* Green orb — top-right */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "-120px",
          right: "-140px",
          width: "680px",
          height: "680px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(123, 228, 149, 0.3), transparent 70%)",
          animation: "ia-glow 9s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />

      {/* Amber orb — bottom-left */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: "-100px",
          left: "-130px",
          width: "620px",
          height: "620px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(255, 180, 58, 0.25), transparent 70%)",
          animation: "ia-glow 11s ease-in-out infinite",
          pointerEvents: "none",
        }}
      />

      {/* Badge row — mint pill + secondary label */}
      <div
        className="ia-hero-badge"
        style={{
          display: "flex",
          gap: "18px",
          alignItems: "center",
          flexWrap: "wrap",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Solid mint pill */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            background: "#7BE495",
            color: "#0F1D17",
            padding: "9px 18px",
            borderRadius: "999px",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            fontFamily: "var(--ia-font-body)",
            fontSize: "14px",
            fontWeight: 600,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "9px",
              height: "9px",
              borderRadius: "50%",
              background: "#0F1D17",
              display: "inline-block",
              animation: "ia-blink 1.6s ease-in-out infinite",
            }}
          />
          Now trading
        </span>

        {/* Secondary muted label */}
        <span
          style={{
            fontFamily: "var(--ia-font-body)",
            fontSize: "14px",
            fontWeight: 600,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--ia-text-muted)",
          }}
        >
          Food stall · Fresh all day
        </span>
      </div>

      {/* Title */}
      <h1
        className="ia-hero-title"
        style={{
          fontFamily: "var(--ia-font-display)",
          fontSize: "clamp(56px, 11vw, 168px)",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          lineHeight: 0.92,
          margin: "0 0 0.5rem",
          position: "relative",
          zIndex: 1,
          color: "var(--ia-text)",
        }}
      >
        Invest-A<span style={{ color: "#FFB43A" }}>-</span>Bite
      </h1>

      {/* Tagline */}
      <p
        className="ia-hero-tagline"
        style={{
          fontSize: "clamp(20px, 2.4vw, 34px)",
          color: "#7BE495",
          margin: "0 0 2rem",
          position: "relative",
          zIndex: 1,
          fontWeight: 400,
        }}
      >
        High returns on every bite. Zero risk, all flavour.
      </p>

      {/* Board price + market status — single horizontal row */}
      <div
        className="ia-hero-board"
        style={{
          display: "flex",
          gap: "36px",
          alignItems: "baseline",
          flexWrap: "wrap",
          position: "relative",
          zIndex: 1,
        }}
      >
        {/* Price range */}
        <div className="ia-hero-price">
          <p
            style={{
              fontSize: "16px",
              color: "var(--ia-text-muted)",
              margin: "0 0 0.25rem",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Today's board
          </p>
          <span
            style={{
              fontFamily: "var(--ia-font-display)",
              fontSize: "clamp(38px, 5vw, 62px)",
              color: "var(--ia-text)",
              letterSpacing: "0.02em",
            }}
          >
            ₹15–80
          </span>
        </div>

        {/* Market status */}
        <p
          className="ia-hero-status"
          style={{
            color: "#7BE495",
            fontWeight: 700,
            fontSize: "16px",
            margin: 0,
          }}
        >
          ▲ Market open
        </p>
      </div>
    </section>
  );
}
