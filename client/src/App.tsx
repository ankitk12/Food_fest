/**
 * App — declares the ByteBites route table.
 *
 * The router is mounted by `main.tsx` inside a <BrowserRouter>; tests mount the
 * same <Routes> inside a <MemoryRouter>. A sticky top nav (SiteHeader) provides
 * brand + primary links on every page.
 *
 * Route map:
 *   /                        Home
 *   /marketplace             Marketplace
 *   /stalls/:stallId         Marketplace (QR stall context)
 *   /cart                    Cart
 *   /checkout                Checkout
 *   /orders/:token           Order tracking
 *   /metrics                 Metrics dashboard
 *   /ai-chef                 AI Chef
 *   /wallet/:customerId      Wallet
 *   /referral/:customerId    Referral
 *   /trending                Trending board
 *   /investor                Investor section
 *   /spin                    Spin & Win
 *   /profile                 Customer profile (mobile identity)
 *   /admin                   Admin order management
 */

import { Route, Routes } from "react-router-dom";
import { ROUTES } from "./routes.js";
import { HomePage } from "./pages/HomePage.js";
import { CartProvider } from "./cart/CartContext.js";
import { CustomerProvider } from "./customer/CustomerContext.js";
import { SiteHeader } from "./pages/SiteHeader.js";
import { Marketplace } from "./pages/Marketplace.js";
import { CartView } from "./pages/CartView.js";
import { CheckoutView } from "./pages/CheckoutView.js";
import { OrderTracker } from "./pages/OrderTracker.js";
import { WalletView } from "./pages/WalletView.js";
import { MetricsDashboard } from "./pages/MetricsDashboard.js";
import { TrendingBoard } from "./pages/TrendingBoard.js";
import { InvestorSection } from "./pages/InvestorSection.js";
import { ProfileView } from "./pages/ProfileView.js";
import { AdminOrdersView } from "./pages/AdminOrdersView.js";
import { OrderHistoryView } from "./pages/OrderHistoryView.js";
import { StockManagementView } from "./pages/StockManagementView.js";
import { SummaryView } from "./pages/SummaryView.js";
import { Footer } from "./pages/Footer.js";

export function App(): JSX.Element {
  return (
    <CustomerProvider>
      <CartProvider>
        <SiteHeader />
        <Routes>
          <Route path={ROUTES.home} element={<HomePage />} />
          <Route path={ROUTES.marketplace} element={<Marketplace />} />
          <Route path={ROUTES.stall} element={<Marketplace />} />
          <Route path={ROUTES.cart} element={<CartView />} />
          <Route path={ROUTES.checkout} element={<CheckoutView />} />
          <Route path={ROUTES.order} element={<OrderTracker />} />
          <Route path={ROUTES.metrics} element={<MetricsDashboard />} />
          <Route path={ROUTES.wallet} element={<WalletView />} />
          <Route path={ROUTES.trending} element={<TrendingBoard />} />
          <Route path={ROUTES.investor} element={<InvestorSection />} />
          <Route path={ROUTES.profile} element={<ProfileView />} />
          <Route path={ROUTES.orderHistory} element={<OrderHistoryView />} />
          <Route path={ROUTES.admin} element={<AdminOrdersView />} />
          <Route path={ROUTES.stock} element={<StockManagementView />} />
          <Route path={ROUTES.summary} element={<SummaryView />} />
        </Routes>
        <Footer />
      </CartProvider>
    </CustomerProvider>
  );
}

export default App;
