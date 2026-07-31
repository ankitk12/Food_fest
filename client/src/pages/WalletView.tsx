/**
 * WalletView — Reward Points balance.
 *
 * Displays the user's reward points balance and their equivalent rupee value.
 * Users earn 10% of every order total as reward points; points are redeemed as
 * a discount at checkout (2 points = ₹1).
 */

import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getWallet } from "../api/client.js";
import type { Wallet } from "../../../types/index.js";

export function WalletView(): JSX.Element {
  const params = useParams<{ customerId: string }>();
  const customerId = params.customerId ?? "";

  const [wallet, setWallet] = useState<Wallet | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getWallet(customerId)
      .then((w) => {
        if (!active) return;
        setWallet(w);
        setError(undefined);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load rewards.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [customerId]);

  const balance = wallet?.foodCoins ?? 0;
  const rupeeValue = (balance * 0.50).toFixed(2);

  return (
    <main className="wallet">
      <h1>Your Rewards</h1>

      {loading && !wallet ? (
        <p role="status">Loading rewards…</p>
      ) : (
        <div className="wallet-balance-card">
          <p className="wallet-balance">
            Reward Points:{" "}
            <strong data-testid="wallet-balance">{balance}</strong>
          </p>
          <p className="wallet-value">
            Worth: <strong>₹{rupeeValue}</strong>
          </p>
          <p className="wallet-info">
            Earn 10% reward points on every order. 2 points = ₹1, redeemable at
            checkout.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="wallet-error">
          {error}
        </p>
      )}
    </main>
  );
}

export default WalletView;
