/**
 * SiteHeader — sticky top navigation with a mobile sidebar drawer.
 *
 * On desktop: horizontal nav links in the header bar.
 * On mobile: a hamburger button that opens a slide-in sidebar with all nav links.
 */

import { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { ROUTES, walletPath } from "../routes.js";
import { useCart } from "../cart/CartContext.js";
import { useCustomer } from "../customer/CustomerContext.js";
import { ADMIN_MOBILES } from "../constants.js";

export function SiteHeader(): JSX.Element {
  const { cart } = useCart();
  const { customer } = useCustomer();
  const count = cart.reduce((sum, line) => sum + line.quantity, 0);
  const walletTarget = customer ? walletPath(customer.mobile) : ROUTES.profile;
  const isAdmin = customer?.mobile ? ADMIN_MOBILES.includes(customer.mobile) : false;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on navigation
  function closeSidebar(): void {
    setSidebarOpen(false);
  }

  return (
    <>
      <header className="site-header">
        <div className="site-header-inner">
          <button
            type="button"
            className="site-hamburger"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>

          <Link to={ROUTES.home} className="site-brand" aria-label="Invest-A-Bite home">
            <span className="site-brand-mark">🍽</span>
            <span className="site-brand-name">Invest-A-Bite</span>
          </Link>

          {/* Desktop nav — hidden on mobile */}
          <nav className="site-nav site-nav-desktop" aria-label="Primary">
            {!isAdmin && (
              <NavLink to={ROUTES.home} end className="site-nav-link">
                Order
              </NavLink>
            )}
            {!isAdmin && (
              <NavLink to={ROUTES.orderHistory} className="site-nav-link">
                Order History
              </NavLink>
            )}
            <NavLink to={ROUTES.trending} className="site-nav-link">
              Trending
            </NavLink>
            {/* {!isAdmin && (
              <NavLink to={walletTarget} className="site-nav-link">
                Rewards
              </NavLink>
            )} */}
            {isAdmin && (
              <NavLink to={ROUTES.admin} className="site-nav-link">
                Orders
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to={ROUTES.stock} className="site-nav-link">
                Stock
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to={ROUTES.summary} className="site-nav-link">
                Summary
              </NavLink>
            )}
          </nav>

          <div className="site-header-actions">
            <NavLink to={ROUTES.profile} className="site-nav-profile">
              {customer ? customer.name || customer.mobile : "Sign in"}
            </NavLink>
            {!isAdmin && (
              <Link to={ROUTES.cart} className="site-cart-link" aria-label={`Cart, ${count} items`}>
                🛒
                <span className="site-cart-count" data-testid="site-cart-count">
                  {count}
                </span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={closeSidebar} aria-hidden="true" />
      )}

      {/* Mobile sidebar drawer */}
      <aside className={`sidebar ${sidebarOpen ? "sidebar--open" : ""}`} aria-label="Navigation menu">
        <div className="sidebar-header">
          <span className="sidebar-brand">🍽 Invest-A-Bite</span>
          <button
            type="button"
            className="sidebar-close"
            aria-label="Close menu"
            onClick={closeSidebar}
          >
            ✕
          </button>
        </div>

        {customer && (
          <div className="sidebar-user">
            <span className="sidebar-user-name">{customer.name || customer.mobile}</span>
            <span className="sidebar-user-mobile">{customer.mobile}</span>
          </div>
        )}

        <nav className="sidebar-nav">
          {!isAdmin && (
            <NavLink to={ROUTES.home} end className="sidebar-nav-link" onClick={closeSidebar}>
              🛍️ Order
            </NavLink>
          )}
          {!isAdmin && (
            <NavLink to={ROUTES.orderHistory} className="sidebar-nav-link" onClick={closeSidebar}>
              📋 Order History
            </NavLink>
          )}
          <NavLink to={ROUTES.trending} className="sidebar-nav-link" onClick={closeSidebar}>
            🔥 Trending
          </NavLink>
          {!isAdmin && (
            <NavLink to={walletTarget} className="sidebar-nav-link" onClick={closeSidebar}>
              🎁 Rewards
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to={ROUTES.admin} className="sidebar-nav-link" onClick={closeSidebar}>
              📊 Orders
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to={ROUTES.stock} className="sidebar-nav-link" onClick={closeSidebar}>
              📦 Stock
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to={ROUTES.summary} className="sidebar-nav-link" onClick={closeSidebar}>
              📈 Summary
            </NavLink>
          )}
          {!isAdmin && (
            <NavLink to={ROUTES.cart} className="sidebar-nav-link" onClick={closeSidebar}>
              🛒 Cart ({count})
            </NavLink>
          )}
          <NavLink to={ROUTES.profile} className="sidebar-nav-link" onClick={closeSidebar}>
            👤 Profile
          </NavLink>
        </nav>
      </aside>
    </>
  );
}

export default SiteHeader;
