/**
 * Mobile-number normalization and validation for ByteBites.
 *
 * The mobile number is the canonical customer identity across orders, wallets,
 * and referrals. This pure, framework-agnostic module provides a single place
 * to normalize a raw mobile string into a canonical form and to validate that
 * it is a plausible phone number, so every part of the system maps the same
 * physical number to the same customer.
 *
 * Normalization rules:
 *   - Strip spaces, dashes, parentheses, and dots (common formatting noise).
 *   - Preserve a single leading "+" (international dialling prefix) when present.
 *
 * Validity rules (India only):
 *   - The number must be a valid Indian mobile number: a 10-digit national
 *     number whose first digit is 6, 7, 8, or 9.
 *   - An optional Indian country code (`+91` / `91`) or a leading trunk `0`
 *     prefix is accepted and ignored when checking the 10-digit national part.
 */

/**
 * Normalize a raw mobile string into its canonical form: formatting characters
 * (spaces, dashes, parentheses, dots) are removed and a single optional leading
 * "+" is preserved. Non-string input normalizes to the empty string.
 */
export function normalizeMobile(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  // Keep digits only; drop every other character (spaces, dashes, etc.).
  const digits = trimmed.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
}

/**
 * Reduce a normalized number to its 10-digit Indian national part by removing
 * an Indian country code (`+91` / `91`) or a leading trunk `0`, but only when
 * the length indicates such a prefix is present (so a genuine 10-digit number
 * is never truncated).
 */
function toIndianNational(normalized: string): string {
  let digits = normalized.startsWith("+") ? normalized.slice(1) : normalized;
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2); // strip "91" country code
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1); // strip trunk "0"
  }
  return digits;
}

/**
 * True when `raw` is a valid Indian mobile number: a 10-digit national number
 * starting with 6–9, optionally prefixed with the Indian country code
 * (`+91` / `91`) or a trunk `0`.
 */
export function isValidMobile(raw: unknown): boolean {
  const national = toIndianNational(normalizeMobile(raw));
  return /^[6-9]\d{9}$/.test(national);
}
