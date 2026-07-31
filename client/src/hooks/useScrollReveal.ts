/**
 * useScrollReveal — a React hook that observes all elements with a
 * `[data-reveal]` attribute inside the given container and triggers the
 * `ia-rise` animation by adding the `.ia-revealed` class when they scroll
 * into view.
 *
 * IntersectionObserver configuration:
 *   - root: null (viewport)
 *   - rootMargin: "0px 0px -12% 0px" (trigger 12% before element leaves bottom)
 *   - threshold: 0
 *
 * Behavior:
 *   - On intersection, adds `.ia-revealed` and unobserves the element
 *     (idempotent — once revealed, stays revealed).
 *   - If `IntersectionObserver` is not supported, immediately reveals all
 *     `[data-reveal]` elements so content is never hidden.
 *   - Cleans up the observer on unmount.
 */

import { useEffect } from "react";

const REVEAL_SELECTOR = "[data-reveal]";
const REVEALED_CLASS = "ia-revealed";

const observerOptions: IntersectionObserverInit = {
  root: null,
  rootMargin: "0px 0px -12% 0px",
  threshold: 0,
};

export function useScrollReveal(
  containerRef: React.RefObject<HTMLElement>
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const elements = container.querySelectorAll<HTMLElement>(REVEAL_SELECTOR);
    if (elements.length === 0) return;

    // Fallback: if IntersectionObserver is not available, reveal everything
    // immediately so content is never hidden from the user.
    if (typeof IntersectionObserver === "undefined") {
      elements.forEach((el) => el.classList.add(REVEALED_CLASS));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add(REVEALED_CLASS);
          observer.unobserve(entry.target);
        }
      }
    }, observerOptions);

    elements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, [containerRef]);
}
