/**
 * Property-based and unit tests for mobile-number normalization/validation.
 *
 * Validates that formatting noise is stripped to a canonical form and that
 * plausible-length phone numbers (10–15 digits, optional leading "+") validate
 * while implausible ones are rejected.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeMobile, isValidMobile } from "./mobile.js";

describe("normalizeMobile", () => {
  it("strips spaces, dashes, parentheses, and dots", () => {
    expect(normalizeMobile(" 98765-43210 ")).toBe("9876543210");
    expect(normalizeMobile("(987) 654-3210")).toBe("9876543210");
    expect(normalizeMobile("987.654.3210")).toBe("9876543210");
  });

  it("preserves a single leading +", () => {
    expect(normalizeMobile("+91 98765 43210")).toBe("+919876543210");
  });

  it("normalizes non-string input to empty string", () => {
    expect(normalizeMobile(undefined)).toBe("");
    expect(normalizeMobile(null)).toBe("");
    expect(normalizeMobile(12345)).toBe("");
  });

  it("is idempotent: normalizing a normalized value is a no-op", () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const once = normalizeMobile(raw);
        expect(normalizeMobile(once)).toBe(once);
      })
    );
  });
});

describe("isValidMobile (India only)", () => {
  it("accepts 10-digit Indian numbers starting 6–9, with optional +91/91/0 prefix", () => {
    const indianArb = fc
      .tuple(
        fc.integer({ min: 6, max: 9 }),
        fc
          .array(fc.integer({ min: 0, max: 9 }), { minLength: 9, maxLength: 9 })
          .map((ds) => ds.join(""))
      )
      .map(([first, rest]) => `${first}${rest}`);

    fc.assert(
      fc.property(
        indianArb,
        fc.constantFrom("", "+91", "91", "0"),
        (national, prefix) => {
          expect(isValidMobile(`${prefix}${national}`)).toBe(true);
        }
      )
    );
  });

  it("rejects numbers whose national part does not start with 6–9", () => {
    expect(isValidMobile("1234567890")).toBe(false);
    expect(isValidMobile("5487894587")).toBe(false); // starts with 5
    expect(isValidMobile("+915487894587")).toBe(false);
  });

  it("rejects too-short and too-long numbers", () => {
    expect(isValidMobile("12345")).toBe(false); // 5 digits
    expect(isValidMobile("98765")).toBe(false); // 5 digits
    expect(isValidMobile("98765432101")).toBe(false); // 11 digits, no valid prefix
    expect(isValidMobile("1234567890123456")).toBe(false); // 16 digits
    expect(isValidMobile("")).toBe(false);
    expect(isValidMobile("not-a-number")).toBe(false);
  });

  it("validates Indian numbers regardless of surrounding formatting", () => {
    expect(isValidMobile(" +91 98765-43210 ")).toBe(true);
    expect(isValidMobile("(987) 654-3210")).toBe(true); // → 9876543210
    expect(isValidMobile("098765 43210")).toBe(true); // trunk 0 prefix
  });
});
