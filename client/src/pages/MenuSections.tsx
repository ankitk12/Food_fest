/**
 * MenuSections — Investment portfolio-style food menu.
 *
 * Renders food categories in a responsive multi-column grid matching
 * the reference design: 4-column desktop, heading with accent line,
 * item rows with dotted separator, and Chaat Portfolio as a full-width
 * bonus card.
 */

interface MenuItem {
  name: string;
  price: number;
  subtitle?: string;
}

interface MenuSection {
  title: string;
  accentColor: string;
  items: MenuItem[];
  isBonus?: boolean;
  bonusText?: string;
}

interface MenuSectionsProps {
  sections: MenuSection[];
}

export function MenuSections({ sections }: MenuSectionsProps): JSX.Element {
  return (
    <section
      className="ia-menu-grid"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
        gap: "44px 56px",
      }}
    >
      {sections.map((section) =>
        section.isBonus ? (
          <BonusSection key={section.title} section={section} />
        ) : (
          <RegularSection key={section.title} section={section} />
        )
      )}
    </section>
  );
}

function RegularSection({ section }: { section: MenuSection }): JSX.Element {
  return (
    <div
      data-reveal
      style={{ display: "flex", flexDirection: "column", gap: "16px" }}
    >
      {/* Heading with accent line */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--ia-font-display)",
            fontSize: "30px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: section.accentColor,
            whiteSpace: "nowrap",
          }}
        >
          {section.title}
        </h2>
        <div
          style={{
            flex: 1,
            height: "2px",
            background: section.accentColor.replace(")", ",0.35)").replace("rgb", "rgba").startsWith("rgba")
              ? section.accentColor
              : hexToRgba(section.accentColor, 0.35),
          }}
        />
      </div>

      {/* Menu item rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {section.items.map((item) => (
          <MenuItemRow key={item.name} item={item} />
        ))}
      </div>
    </div>
  );
}

function BonusSection({ section }: { section: MenuSection }): JSX.Element {
  return (
    <div
      data-reveal
      style={{
        gridColumn: "1 / -1",
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        padding: "30px 34px",
        borderRadius: "24px",
        background: "rgba(246, 239, 226, 0.055)",
        border: `2px solid ${hexToRgba(section.accentColor, 0.28)}`,
      }}
    >
      {/* Heading with accent line */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--ia-font-display)",
            fontSize: "30px",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: section.accentColor,
            whiteSpace: "nowrap",
          }}
        >
          {section.title}
        </h2>
        <div
          style={{
            flex: 1,
            height: "2px",
            background: hexToRgba(section.accentColor, 0.35),
          }}
        />
      </div>

      {/* 2-column grid for items */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "12px 40px",
        }}
      >
        {section.items.map((item) => (
          <MenuItemRow key={item.name} item={item} />
        ))}
      </div>

      {/* Bonus badge */}
      {section.bonusText && (
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <span
            style={{
              padding: "7px 14px",
              borderRadius: "999px",
              background: "#FFB43A",
              color: "#0F1D17",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Bonus
          </span>
          <span
            style={{
              fontSize: "19px",
              fontWeight: 500,
              color: "rgba(246, 239, 226, 0.9)",
            }}
          >
            {section.bonusText}
          </span>
        </div>
      )}
    </div>
  );
}

function MenuItemRow({ item }: { item: MenuItem }): JSX.Element {
  return (
    <div
      className="ia-menu-item-row"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: "16px",
        padding: "6px 10px",
        borderRadius: "12px",
        transition: "background 0.25s ease, transform 0.25s ease",
        cursor: "default",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(246,239,226,0.06)";
        e.currentTarget.style.transform = "translateX(6px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.transform = "translateX(0)";
      }}
    >
      <span style={{ fontSize: "22px", fontWeight: 500, whiteSpace: "nowrap" }}>
        {item.name}
        {item.subtitle && (
          <span style={{ fontSize: "17px", color: "rgba(246,239,226,0.6)", marginLeft: "6px" }}>
            {item.subtitle}
          </span>
        )}
      </span>
      <div
        style={{
          flex: 1,
          borderBottom: "2px dotted rgba(246,239,226,0.28)",
          transform: "translateY(-6px)",
        }}
      />
      <span
        style={{
          fontFamily: "var(--ia-font-display)",
          fontSize: "26px",
          whiteSpace: "nowrap",
        }}
      >
        ₹{item.price}
      </span>
    </div>
  );
}

/** Convert a hex color to rgba with the given alpha */
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
