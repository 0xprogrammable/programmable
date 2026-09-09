"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { useViewChain } from "@/components/view-chain";
import { isRobinhoodUnavailableRoute } from
  "@/components/view-chain-unavailable";

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const { hydrated, viewChainId } = useViewChain();
  const contentRef = useRef<HTMLDivElement>(null);
  const routeUsesChainBoundary = isRobinhoodUnavailableRoute(pathname);
  const focusContext = `${pathname}\u0000${
    routeUsesChainBoundary ? (hydrated ? viewChainId : "pending") : "route"
  }`;
  const previousFocusContext = useRef(focusContext);
  const previousHydrated = useRef(hydrated);
  const isDocsPath = pathname.startsWith("/docs");

  useEffect(() => {
    const resolvedInitialChain = !previousHydrated.current && hydrated;
    previousHydrated.current = hydrated;
    if (resolvedInitialChain) {
      previousFocusContext.current = focusContext;
      return;
    }
    if (previousFocusContext.current === focusContext) return;
    previousFocusContext.current = focusContext;
    if (pathname.startsWith("/docs") && window.location.hash) return;
    const heading = contentRef.current?.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.tabIndex = -1;
      heading.dataset.routeAnnouncementFocus = "true";
      heading.addEventListener(
        "blur",
        () => delete heading.dataset.routeAnnouncementFocus,
        { once: true },
      );
      heading.focus({ preventScroll: true });
      return;
    }
    document.querySelector<HTMLElement>("#main-content")?.focus({
      preventScroll: true,
    });
  }, [focusContext, hydrated, pathname]);

  return (
    <div
      className={`route-transition${isDocsPath ? " route-transition-docs" : ""}`}
      ref={contentRef}
    >
      {children}
    </div>
  );
}
