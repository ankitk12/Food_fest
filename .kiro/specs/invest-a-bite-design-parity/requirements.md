# Requirements Document

## Introduction

This feature brings the Invest-A-Bite React client (under `client/src`) into visual parity with the bundled
reference design (`client/invest-a-bite-website.html`). The work is confined to the marketing/landing surface
and shared branding: hero layout, gallery labels, full-bleed page layout, and the brand name shown in the
header, mobile sidebar, and document title. Backend/domain logic and e-commerce behavior (cart, checkout,
admin, wallet, referral) are out of scope beyond incidental styling/branding. Accessibility (visible focus,
contrast, reduced-motion) is preserved, and existing Vitest suites are kept green with tests/snapshots updated
where markup or copy changes. The reference HTML is a comparison artifact only and is never loaded by the app.

## Glossary

- **Landing_Page**: The `HomePage` component and the sections it composes (hero, ticker, gallery, menu).
- **Hero**: The `HeroSection` component rendered at the top of the Landing_Page.
- **Ticker**: The `TickerMarquee` component (scrolling price bar).
- **Gallery**: The `FoodImageGallery` component (three food image cards).
- **Menu**: The `MenuSections` component (investment-themed food categories and bonus card).
- **Site_Header**: The `SiteHeader` component (desktop nav bar and mobile sidebar drawer).
- **Footer**: The `Footer` component.
- **Document_Title**: The `<title>` element in `client/index.html`.
- **Brand_Name**: The human-readable product name displayed to users; target value is "Invest-A-Bite".
- **Reduced_Motion**: The browser condition `prefers-reduced-motion: reduce`.
- **Reference_Design**: The bundled `client/invest-a-bite-website.html` used as the parity source of truth.

## Requirements

### Requirement 1: Consistent Invest-A-Bite branding

**User Story:** As a visitor, I want the product name shown consistently as "Invest-A-Bite" across the app
chrome, so that the brand identity matches the reference design.

#### Acceptance Criteria

1. THE Site_Header SHALL display the Brand_Name "Invest-A-Bite" in the desktop brand element.
2. THE Site_Header SHALL display the Brand_Name "Invest-A-Bite" in the mobile sidebar brand element.
3. THE Document_Title SHALL contain the Brand_Name "Invest-A-Bite".
4. THE Site_Header SHALL expose an accessible brand link label that references "Invest-A-Bite".
5. THE Landing_Page, Site_Header, and Footer SHALL NOT display the legacy string "ByteBites".

### Requirement 2: Left-aligned editorial hero layout

**User Story:** As a visitor, I want the hero presented as a left-aligned editorial block, so that it matches
the reference header composition.

#### Acceptance Criteria

1. THE Hero SHALL render its content left-aligned in a vertical stack rather than centered.
2. THE Hero SHALL apply horizontal padding equivalent to `6vw` consistent with the full-bleed Reference_Design.
3. THE Hero SHALL NOT reserve full-viewport minimum height for its container.
4. THE Hero SHALL render two decorative glow orbs that are marked non-interactive and hidden from assistive technology.

### Requirement 3: Hero badge with mint pill and secondary label

**User Story:** As a visitor, I want the "Now trading" indicator shown as a solid mint pill with a secondary
descriptor, so that the badge row matches the reference.

#### Acceptance Criteria

1. THE Hero SHALL render a pill element containing the text "Now trading" with a mint background and dark text.
2. THE Hero SHALL render a blinking dot inside the pill that is hidden from assistive technology.
3. THE Hero SHALL render a secondary label with the text "Food stall · Fresh all day".
4. WHILE Reduced_Motion is active, THE Hero SHALL disable the blinking-dot animation while keeping the pill content visible.

### Requirement 4: Hero title with a single gold hyphen

**User Story:** As a visitor, I want the hero title rendered as "Invest-A-Bite" with one gold hyphen, so that
the title matches the reference exactly.

#### Acceptance Criteria

1. THE Hero SHALL render a single top-level heading whose accessible name resolves to "Invest-A-Bite".
2. THE Hero SHALL style exactly one hyphen character in the title with the gold accent color.
3. THE Hero SHALL render the title using the display font in uppercase.

### Requirement 5: Hero horizontal stats row

**User Story:** As a visitor, I want the board price and market status shown in a single horizontal row, so
that the hero stats match the reference layout.

#### Acceptance Criteria

1. THE Hero SHALL render a "Today's board" label together with the price range "₹15–80".
2. THE Hero SHALL render the market status text "▲ Market open" in the mint accent color.
3. THE Hero SHALL arrange the board price group and the market status as a single horizontal row.

### Requirement 6: Full-bleed landing layout

**User Story:** As a visitor, I want the gallery and menu to span the full width at `6vw` padding, so that the
landing layout matches the reference rather than a centered column.

#### Acceptance Criteria

1. THE Landing_Page SHALL render the Gallery without constraining it to a centered fixed-width column.
2. THE Landing_Page SHALL render the Menu without constraining it to a centered fixed-width column.
3. THE Gallery SHALL use a responsive grid whose minimum column width is at least 300px.
4. THE Menu SHALL use a responsive grid whose minimum column width is at least 340px.

### Requirement 7: Gallery labels match the reference set

**User Story:** As a visitor, I want the gallery to show the correct three food cards, so that the labels match
the reference.

#### Acceptance Criteria

1. THE Gallery SHALL render exactly three cards.
2. THE Gallery SHALL display the visible category labels "Momos", "Basket Chaat", and "Mint Mojito".
3. THE Gallery SHALL NOT display the label "Pani Puri".
4. THE Gallery SHALL render each card with its accent-colored border (gold for Momos, green for Basket Chaat, purple for Mint Mojito).

### Requirement 8: Ticker seamless-loop rendering

**User Story:** As a visitor, I want the price ticker to scroll seamlessly, so that it matches the reference
marquee behavior.

#### Acceptance Criteria

1. WHEN the Ticker receives a non-empty list of items, THE Ticker SHALL render each item twice to sustain a seamless loop.
2. WHEN the Ticker receives an empty list of items, THE Ticker SHALL render nothing.
3. THE Ticker SHALL format each item as "▲ {name} ₹{price}".
4. THE Ticker SHALL expose the accessible label "Food price ticker".

### Requirement 9: Menu section and row structure

**User Story:** As a visitor, I want each menu row to show the item and its price with a dotted leader, so that
the menu matches the reference layout.

#### Acceptance Criteria

1. THE Menu SHALL render each item row with the item name and the price formatted as "₹{price}".
2. THE Menu SHALL render a dotted leader line between each item name and its price.
3. THE Menu SHALL render each section heading in the display font with a trailing accent-colored rule.
4. THE Menu SHALL render the "Chaat Portfolio" section as a full-width bonus card that spans all grid columns.
5. WHEN a menu item row is hovered, THE Menu SHALL apply a background highlight and a horizontal translate offset.

### Requirement 10: Accessibility and reduced-motion preservation

**User Story:** As a visitor relying on assistive technology or reduced-motion settings, I want accessibility
preserved, so that the redesign remains usable.

#### Acceptance Criteria

1. WHILE Reduced_Motion is active, THE Landing_Page SHALL disable continuous animations while keeping all content visible.
2. THE Landing_Page SHALL retain visible focus indicators on interactive elements.
3. THE Landing_Page SHALL mark decorative elements as hidden from assistive technology.

### Requirement 11: Reference artifact isolation

**User Story:** As a developer, I want the reference bundle kept out of the running app, so that it stays a
comparison artifact only.

#### Acceptance Criteria

1. THE Landing_Page SHALL NOT import or load `client/invest-a-bite-website.html` at runtime.

### Requirement 12: Test and build integrity

**User Story:** As a developer, I want the existing test suite to stay green after the redesign, so that no
regressions are introduced.

#### Acceptance Criteria

1. WHERE markup, copy, or branding changes affect an existing test, THE test suite SHALL be updated to assert the new expected content.
2. WHEN the client test command is executed, THE test suite SHALL pass.
3. WHEN the client build command is executed, THE build SHALL complete without errors.
