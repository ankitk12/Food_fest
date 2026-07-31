/**
 * Footer — persistent footer rendered at the bottom of every page.
 *
 * Displays the Invest-A-Bite brand name (left) and operational tagline (right),
 * matching the reference design layout.
 */

export function Footer(): JSX.Element {
  return (
    <footer
      className="ia-footer"
      style={{
        borderTop: "3px solid rgba(246, 239, 226, 0.14)",
        padding: "40px 6vw 56px",
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: "24px",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontFamily: "'Anton', 'Arial Black', sans-serif",
          fontSize: "30px",
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          color: "#F6EFE2",
        }}
      >
        Invest-A<span style={{ color: "#FFB43A" }}>-</span>Bite
      </span>
      <span
        style={{
          fontSize: "15px",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "rgba(246, 239, 226, 0.5)",
        }}
      >
        Fresh all day · Cash &amp; UPI
      </span>
    </footer>
  );
}

export default Footer;
