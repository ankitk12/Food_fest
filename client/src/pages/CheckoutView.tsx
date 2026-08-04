/**
 * CheckoutView — trigger payment with optional reward points redemption.
 *
 * Users can toggle "Use reward points" to apply their available points as a
 * discount (2 points = ₹1). The discounted amount is shown before payment.
 */

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiClientError, checkout, getConfig, getCoupons } from "../api/client.js";
import type { CheckoutResponse } from "../api/client.js";
import type { Coupon } from "../../../types/index.js";
import { useCart } from "../cart/CartContext.js";
import { useCustomer } from "../customer/CustomerContext.js";
import { toCartItems, cartLineTotal } from "../cart/cart.js";
import { orderPath } from "../routes.js";
import { ROUTES } from "../routes.js";
import { formatINR } from "../format.js";
import { DEMO_STALL_ID } from "../demo.js";
import { CustomerForm } from "./ProfileView.js";

type CheckoutState =
  | { status: "idle" }
  | { status: "paying" }
  | { status: "success"; result: CheckoutResponse; mobile: string; method: "UPI" | "cash" }
  | { status: "failed"; message: string };

/**
 * Merchant UPI identity used to build the payment intent / QR. Fetched at
 * runtime from the server (`GET /api/config`), which reads it from its
 * environment (e.g. Vercel Project Environment Variables: `MERCHANT_VPA`,
 * `MERCHANT_NAME`). These demo defaults are used until the config loads.
 */
const DEFAULT_MERCHANT: MerchantConfig = {
  vpa: "invest-a-bite@upi",
  name: "Invest-A-Bite",
};

interface MerchantConfig {
  vpa: string;
  name: string;
}

/** Build the shared UPI intent query string (pa, pn, am, cu, tn). */
function buildUpiParams(amount: number, merchant: MerchantConfig): string {
  const params = new URLSearchParams({
    pa: merchant.vpa,
    pn: merchant.name,
    am: amount.toFixed(2),
    cu: "INR",
    tn: `${merchant.name} order`,
  });
  return params.toString();
}

/**
 * Build a UPI deep-link for a given app scheme. The generic `upi://pay` scheme
 * opens the OS app chooser (used for the QR and "Other"), while the
 * app-specific schemes below open that app directly.
 */
function buildUpiUri(
  amount: number,
  merchant: MerchantConfig,
  scheme = "upi://pay"
): string {
  return `${scheme}?${buildUpiParams(amount, merchant)}`;
}

/**
 * The UPI apps offered as quick-launch buttons. Each carries its own deep-link
 * scheme so tapping it opens that app directly (on a device with it installed)
 * instead of the generic chooser:
 *   - Google Pay → `tez://upi/pay`
 *   - PhonePe    → `phonepe://pay`
 *   - Paytm      → `paytmmp://pay`
 *   - Other      → `upi://pay` (system chooser)
 */
const UPI_APPS: ReadonlyArray<{ label: string; emoji: string; scheme: string }> = [
  { label: "Google Pay", emoji: "🟢", scheme: "tez://upi/pay" },
  { label: "PhonePe", emoji: "🟣", scheme: "phonepe://pay" },
  { label: "Paytm", emoji: "🔵", scheme: "paytmmp://pay" },
  { label: "Other UPI app", emoji: "🏦", scheme: "upi://pay" },
];

export function CheckoutView(): JSX.Element {
  const { cart, total, clearCart } = useCart();
  const { customer } = useCustomer();
  const navigate = useNavigate();
  const [state, setState] = useState<CheckoutState>({ status: "idle" });
  // Available coupons fetched from the server on mount.
  const [availableCoupons, setAvailableCoupons] = useState<Coupon[]>([]);
  // The coupon code the customer has typed or selected.
  const [couponInput, setCouponInput] = useState("");
  // The coupon that has been validated and applied.
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  // When true, the UPI payment screen (QR + app buttons) is shown before the
  // customer confirms they've paid.
  const [showUpi, setShowUpi] = useState(false);
  // Merchant UPI identity, loaded from the server's runtime config.
  const [merchant, setMerchant] = useState<MerchantConfig>(DEFAULT_MERCHANT);
  // Delivery: collect at stall (default) or deliver to a desk (needs location).
  const [deliveryType, setDeliveryType] = useState<"stall" | "desk">("stall");
  const [deskLocation, setDeskLocation] = useState("");
  const [floorNo, setFloorNo] = useState("");
  // Preferred time to collect / receive the order.
  const [pickupTime, setPickupTime] = useState("");

  useEffect(() => {
    getConfig()
      .then((cfg) => setMerchant({ vpa: cfg.merchantVpa, name: cfg.merchantName }))
      .catch(() => setMerchant(DEFAULT_MERCHANT));
  }, []);

  // Fetch all active coupons so we can display them to the customer.
  useEffect(() => {
    getCoupons()
      .then(setAvailableCoupons)
      .catch(() => setAvailableCoupons([]));
  }, []);

  // Calculate discount from applied coupon.
  const couponDiscount = appliedCoupon
    ? Math.round((total * appliedCoupon.discountPercent) / 100 * 100) / 100
    : 0;
  const amountToPay = Math.max(0, total - couponDiscount);

  // Try to apply the typed coupon code.
  function handleApplyCoupon(): void {
    const code = couponInput.trim().toUpperCase();
    if (!code) return;
    const coupon = availableCoupons.find((c) => c.code === code && c.active);
    if (!coupon) {
      setCouponError(`"${code}" is not a valid coupon code.`);
      setAppliedCoupon(null);
      return;
    }
    if (total < coupon.minOrderValue) {
      setCouponError(`Minimum order value of ${formatINR(coupon.minOrderValue)} required for ${code}.`);
      setAppliedCoupon(null);
      return;
    }
    setAppliedCoupon(coupon);
    setCouponError(null);
  }

  // Quick-apply a coupon by clicking on a coupon card.
  function handleSelectCoupon(coupon: Coupon): void {
    setCouponInput(coupon.code);
    if (total < coupon.minOrderValue) {
      setCouponError(`Minimum order value of ${formatINR(coupon.minOrderValue)} required for ${coupon.code}.`);
      setAppliedCoupon(null);
      return;
    }
    setAppliedCoupon(coupon);
    setCouponError(null);
  }

  function handleRemoveCoupon(): void {
    setAppliedCoupon(null);
    setCouponInput("");
    setCouponError(null);
  }

  // Desk delivery needs a location + floor before the order can be placed.
  const deliveryValid =
    deliveryType === "stall" ||
    (deskLocation.trim() !== "" && floorNo.trim() !== "");

  async function handlePay(method: "UPI" | "cash"): Promise<void> {
    if (!customer || !deliveryValid) return;
    const stallId = DEMO_STALL_ID;
    setState({ status: "paying" });
    try {
      const result = await checkout({
        stallId,
        customerId: customer.mobile,
        items: toCartItems(cart),
        paymentMethod: method,
        deliveryType,
        ...(deliveryType === "desk"
          ? { deskLocation: deskLocation.trim(), floorNo: floorNo.trim() }
          : {}),
        ...(pickupTime.trim() ? { pickupTime: pickupTime.trim() } : {}),
        ...(appliedCoupon ? { couponCode: appliedCoupon.code } : {}),
      });
      clearCart();
      setShowUpi(false);
      setState({ status: "success", result, mobile: customer.mobile, method });
      navigate(ROUTES.orderHistory);
    } catch (err: unknown) {
      let message: string;
      if (err instanceof ApiClientError) {
        if (err.code === "PAYMENT_FAILED") {
          message = "Payment failed. Your cart is safe — please try again.";
        } else if (
          err.code === "INSUFFICIENT_STOCK" ||
          err.code === "ITEM_UNAVAILABLE"
        ) {
          message = err.message;
        } else {
          message = err.message;
        }
      } else {
        message =
          err instanceof Error
            ? err.message
            : "Payment failed. Your cart is safe — please try again.";
      }
      setState({ status: "failed", message });
    }
  }

  if (state.status === "success") {
    const { token, coinsEarned, notified, discount: appliedDiscount, total: paidTotal } =
      state.result;
    const isCash = state.method === "cash";
    return (
      <main className="checkout">
        <h1>Order placed</h1>
        <p className="checkout-cash-note" data-testid="checkout-payment-note">
          {isCash ? (
            <>
              Please pay {formatINR(paidTotal)} in cash at the counter.
            </>
          ) : (
            <>
              Complete the {formatINR(paidTotal)} UPI payment using the QR / your
              UPI app.
            </>
          )}{" "}
          Your payment is marked <strong>pending</strong> until staff confirm it.
        </p>
        <p className="checkout-token-label">Your order token:</p>
        <p className="checkout-token" data-testid="order-token">
          <strong>{token}</strong>
        </p>
        <p className="checkout-coins">You earned {coinsEarned} reward points!</p>
        {appliedDiscount > 0 && (
          <p className="checkout-discount-applied">
            Discount applied: {formatINR(appliedDiscount)}
          </p>
        )}
        {notified && (
          <p className="checkout-notified" data-testid="checkout-notified">
            A confirmation has been sent to {state.mobile} on WhatsApp.
          </p>
        )}
        <Link className="checkout-track-link" to={orderPath(token)}>
          Track your order
        </Link>
      </main>
    );
  }

  if (cart.length === 0) {
    return (
      <main className="checkout">
        <h1>Checkout</h1>
        <p>Your cart is empty.</p>
        <Link to={ROUTES.marketplace}>Browse the marketplace</Link>
      </main>
    );
  }

  // Gate: require a mobile-number identity before payment.
  if (!customer) {
    return (
      <main className="checkout">
        <h1>Checkout</h1>
        <p className="checkout-total" data-testid="checkout-total">
          Amount to pay: <strong>{formatINR(total)}</strong>
        </p>
        <p className="checkout-identity-prompt" data-testid="checkout-identity-prompt">
          Please enter your mobile number to continue to payment.
        </p>
        <CustomerForm
          heading="Enter your mobile to checkout"
          lead="We'll send your order confirmation to this number on WhatsApp."
        />
      </main>
    );
  }

  return (
    <main className="checkout">
      <h1>Checkout</h1>

      <ul className="checkout-items" data-testid="checkout-items">
        {cart.map((line) => (
          <li
            key={line.itemId}
            className="checkout-item"
            data-testid={`checkout-item-${line.itemId}`}
          >
            <span className="checkout-item-name">
              {line.quantity}× {line.name}
              {line.addCheese && (
                <span className="checkout-item-addon"> + Cheese</span>
              )}
              {line.jain && <span className="checkout-item-addon"> · Jain</span>}
            </span>
            <span className="checkout-item-total">
              {formatINR(cartLineTotal(line))}
            </span>
          </li>
        ))}
      </ul>

      <div className="checkout-summary">
        <p className="checkout-total" data-testid="checkout-total">
          Subtotal: <strong>{formatINR(total)}</strong>
        </p>

        {/* --- Available Coupons --- */}
        {availableCoupons.length > 0 && (
          <div className="checkout-coupons" data-testid="checkout-coupons">
            <p className="checkout-coupons-label">Available coupons:</p>
            <div className="checkout-coupon-cards">
              {availableCoupons.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  className={`checkout-coupon-card${appliedCoupon?.code === c.code ? " checkout-coupon-card--applied" : ""}`}
                  onClick={() => handleSelectCoupon(c)}
                  data-testid={`coupon-card-${c.code}`}
                >
                  <span className="checkout-coupon-badge">{c.discountPercent}%<br/>OFF</span>
                  <span className="checkout-coupon-body">
                    <span className="checkout-coupon-code">{c.code}</span>
                    <span className="checkout-coupon-desc">
                      Min order {formatINR(c.minOrderValue)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* --- Coupon Input --- */}
        <div className="checkout-coupon-input-row">
          <input
            type="text"
            className="checkout-coupon-input"
            data-testid="checkout-coupon-input"
            placeholder="Enter coupon code"
            value={couponInput}
            onChange={(e) => { setCouponInput(e.target.value.toUpperCase()); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleApplyCoupon(); }}
          />
          {appliedCoupon ? (
            <button
              type="button"
              className="checkout-coupon-remove"
              data-testid="checkout-coupon-remove"
              onClick={handleRemoveCoupon}
            >
              Remove
            </button>
          ) : (
            <button
              type="button"
              className="checkout-coupon-apply"
              data-testid="checkout-coupon-apply"
              onClick={handleApplyCoupon}
              disabled={!couponInput.trim()}
            >
              Apply
            </button>
          )}
        </div>

        {couponError && (
          <p className="checkout-coupon-error" role="alert" data-testid="coupon-error">
            {couponError}
          </p>
        )}

        {appliedCoupon && (
          <p className="checkout-discount" data-testid="coupon-applied">
            🎉 <strong>{appliedCoupon.code}</strong> ({appliedCoupon.discountPercent}% off):{" "}
            −{formatINR(couponDiscount)}
          </p>
        )}

        <p className="checkout-final-amount" data-testid="checkout-amount">
          Amount to pay: <strong>{formatINR(amountToPay)}</strong>
        </p>
      </div>

      <p className="checkout-customer" data-testid="checkout-customer">
        Ordering as {customer.name || customer.mobile} ({customer.mobile}).
      </p>

      <fieldset className="checkout-delivery" data-testid="checkout-delivery">
        <legend>How would you like to receive your order?</legend>
        <label className="checkout-delivery-option">
          <input
            type="radio"
            name="deliveryType"
            value="stall"
            checked={deliveryType === "stall"}
            onChange={() => setDeliveryType("stall")}
          />
          <span>Collect at stall</span>
        </label>
        <label className="checkout-delivery-option">
          <input
            type="radio"
            name="deliveryType"
            value="desk"
            checked={deliveryType === "desk"}
            onChange={() => setDeliveryType("desk")}
          />
          <span>Delivery at desk</span>
        </label>

        {deliveryType === "desk" && (
          <div className="checkout-desk-fields" data-testid="checkout-desk-fields">
            <div className="checkout-desk-field">
              <span>Floor no *</span>
              <div
                className="floor-options"
                role="group"
                aria-label="Floor number"
                data-testid="checkout-floor-no"
              >
                {["1", "2", "6"].map((f) => (
                  <button
                    type="button"
                    key={f}
                    className={`floor-option${floorNo === f ? " floor-option--active" : ""}`}
                    aria-pressed={floorNo === f}
                    data-testid={`floor-option-${f}`}
                    onClick={() => setFloorNo(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <label className="checkout-desk-field">
              <span>Desk location *</span>
              <input
                type="text"
                data-testid="checkout-desk-location"
                placeholder="e.g. Sales wing, Desk 12"
                value={deskLocation}
                onChange={(e) => setDeskLocation(e.target.value)}
              />
            </label>
            {!deliveryValid && (
              <p className="checkout-desk-hint" role="note">
                Select a floor and enter a desk location to continue.
              </p>
            )}
          </div>
        )}

        <label className="checkout-time-field" data-testid="checkout-time-field">
          <span>
            {deliveryType === "desk"
              ? "Preferred delivery time"
              : "Preferred pickup time"}
          </span>
          <input
            type="time"
            className="checkout-time-input"
            data-testid="checkout-pickup-time"
            value={pickupTime}
            onChange={(e) => setPickupTime(e.target.value)}
          />
        </label>
      </fieldset>

      {state.status === "failed" && (
        <p role="alert" className="checkout-error" data-testid="payment-error">
          {state.message}
        </p>
      )}

      {showUpi ? (
        <UpiPayPanel
          amount={amountToPay}
          merchant={merchant}
          paying={state.status === "paying"}
          onConfirm={() => void handlePay("UPI")}
          onBack={() => setShowUpi(false)}
        />
      ) : (
        <fieldset className="checkout-pay-methods" data-testid="checkout-pay-methods">
          <legend>Choose how to pay</legend>
          <button
            type="button"
            className="checkout-pay checkout-pay--upi"
            onClick={() => setShowUpi(true)}
            disabled={state.status === "paying" || !deliveryValid}
          >
            Pay with UPI
          </button>
          <button
            type="button"
            className="checkout-pay checkout-pay--cash"
            onClick={() => void handlePay("cash")}
            disabled={state.status === "paying" || !deliveryValid}
          >
            {state.status === "paying" ? "Processing…" : "Pay with Cash"}
          </button>
        </fieldset>
      )}
    </main>
  );
}

interface UpiPayPanelProps {
  amount: number;
  merchant: MerchantConfig;
  paying: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

/**
 * UpiPayPanel — the UPI payment screen: a scannable QR encoding the payment
 * intent for `amount`, quick-launch buttons for popular UPI apps, and a
 * "payment done" confirmation that finalizes the order.
 */
function UpiPayPanel({ amount, merchant, paying, onConfirm, onBack }: UpiPayPanelProps): JSX.Element {
  const upiUri = buildUpiUri(amount, merchant);
  // The QR image is rendered by a public QR service from the UPI intent string.
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
    upiUri
  )}`;

  return (
    <section className="upi-pay" data-testid="upi-pay-panel">
      <h2 className="upi-pay-title">Pay {formatINR(amount)} via UPI</h2>
      <p className="upi-pay-hint">
        Scan the QR with any UPI app, or tap your app below.
      </p>

      <div className="upi-pay-qr">
        <img
          src={qrSrc}
          width={240}
          height={240}
          alt={`UPI QR code to pay ${formatINR(amount)} to ${merchant.name}`}
          data-testid="upi-qr"
        />
        <p className="upi-pay-vpa">{merchant.vpa}</p>
      </div>

      <div className="upi-pay-apps" data-testid="upi-apps">
        {UPI_APPS.map((app) => (
          <a
            key={app.label}
            className="upi-pay-app"
            href={buildUpiUri(amount, merchant, app.scheme)}
            rel="noreferrer"
          >
            <span aria-hidden="true">{app.emoji}</span> {app.label}
          </a>
        ))}
      </div>

      <div className="checkout-pay-methods">
        <button
          type="button"
          className="checkout-pay"
          data-testid="upi-confirm"
          onClick={onConfirm}
          disabled={paying}
        >
          {paying ? "Processing…" : "I've paid — confirm order"}
        </button>
        <button
          type="button"
          className="checkout-pay checkout-pay--cash"
          onClick={onBack}
          disabled={paying}
        >
          Back
        </button>
      </div>
    </section>
  );
}

export default CheckoutView;
