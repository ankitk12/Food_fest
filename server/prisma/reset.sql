-- Reset persisted state: clears all runtime tables so the server re-seeds a
-- fresh catalogue (no orders/customers/edits) on next start.
TRUNCATE TABLE "Order", "Wallet", "Referral", "Customer", "ItemState", "FoodItem";
