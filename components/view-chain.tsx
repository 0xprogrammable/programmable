"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_VIEW_CHAIN_ID,
  VIEW_CHAIN_CHANGE_EVENT,
  VIEW_CHAIN_COOKIE_NAME,
  VIEW_CHAIN_STORAGE_KEY,
  serializeViewChainCookie,
  tryParseViewChainId,
  type ViewChainId,
} from "@/lib/view-chain";

export type { ViewChainId } from "@/lib/view-chain";
export {
  DEFAULT_VIEW_CHAIN_ID,
  VIEW_CHAIN_COOKIE_NAME,
} from "@/lib/view-chain";

type ViewChainContextValue = Readonly<{
  hydrated: boolean;
  viewChainId: ViewChainId;
  setViewChainId: (viewChainId: ViewChainId) => void;
}>;

const ViewChainContext = createContext<ViewChainContextValue | null>(null);
const VIEW_CHAIN_REVISION_COOKIE_NAME = `${VIEW_CHAIN_COOKIE_NAME}-revision`;
const VIEW_CHAIN_REVISION_STORAGE_KEY = `${VIEW_CHAIN_STORAGE_KEY}:revision`;

function readCookie(name: string): string | null {
  const encodedName = `${name}=`;
  for (const cookiePart of document.cookie.split(";")) {
    const normalizedPart = cookiePart.trim();
    if (!normalizedPart.startsWith(encodedName)) continue;
    return normalizedPart.slice(encodedName.length);
  }
  return null;
}

function readViewChainCookie(): ViewChainId | null {
  return tryParseViewChainId(readCookie(VIEW_CHAIN_COOKIE_NAME));
}

function readViewChainRevision(): string {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(VIEW_CHAIN_REVISION_STORAGE_KEY);
  } catch {
    // The cookie still detects choices when browser storage is blocked.
  }
  return JSON.stringify([readCookie(VIEW_CHAIN_REVISION_COOKIE_NAME), stored]);
}

function readStoredViewChain(): ViewChainId | null {
  try {
    return tryParseViewChainId(
      window.localStorage.getItem(VIEW_CHAIN_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function subscribeToViewChain(onStoreChange: () => void) {
  const syncFromStorage = (event: StorageEvent) => {
    if (event.key === VIEW_CHAIN_STORAGE_KEY) onStoreChange();
  };
  const syncFromSameTab = () => onStoreChange();

  window.addEventListener("storage", syncFromStorage);
  window.addEventListener(VIEW_CHAIN_CHANGE_EVENT, syncFromSameTab);

  return () => {
    window.removeEventListener("storage", syncFromStorage);
    window.removeEventListener(VIEW_CHAIN_CHANGE_EVENT, syncFromSameTab);
  };
}

function persistViewChain(viewChainId: ViewChainId) {
  // Cross-tab subscribers read the cookie first. Make it current before the
  // storage write can notify another browser process.
  document.cookie = serializeViewChainCookie(viewChainId);
  try {
    window.localStorage.setItem(VIEW_CHAIN_STORAGE_KEY, String(viewChainId));
  } catch {
    // A functional cookie remains available when browser storage is blocked.
  }

  window.dispatchEvent(
    new CustomEvent<ViewChainId>(VIEW_CHAIN_CHANGE_EVENT, {
      detail: viewChainId,
    }),
  );
}

export function ViewChainProvider({
  children,
  initialViewChainId = DEFAULT_VIEW_CHAIN_ID,
}: Readonly<{
  children: ReactNode;
  initialViewChainId?: ViewChainId;
}>) {
  const getViewChainSnapshot = useCallback(
    (): ViewChainId | null =>
      readViewChainCookie() ?? readStoredViewChain() ?? initialViewChainId,
    [initialViewChainId],
  );
  const getServerSnapshot = useCallback((): ViewChainId | null => null, []);
  const resolvedViewChainId = useSyncExternalStore(
    subscribeToViewChain,
    getViewChainSnapshot,
    getServerSnapshot,
  );
  const hydrated = resolvedViewChainId !== null;
  const viewChainId = resolvedViewChainId ?? initialViewChainId;

  useEffect(() => {
    if (!hydrated) return;
    // Another tab may have changed the preference since this render committed.
    const currentViewChainId = getViewChainSnapshot();
    if (currentViewChainId === null) return;
    if (
      readViewChainCookie() !== currentViewChainId ||
      readStoredViewChain() !== currentViewChainId
    ) {
      persistViewChain(currentViewChainId);
    }
  }, [getViewChainSnapshot, hydrated, viewChainId]);

  const setViewChainId = useCallback((nextViewChainId: ViewChainId) => {
    // Publish a distinct revision before the value. Pending route entry must
    // detect a newer choice even before its storage event or after a round trip.
    const revision = window.crypto.randomUUID();
    document.cookie = `${VIEW_CHAIN_REVISION_COOKIE_NAME}=${revision}; Path=/; SameSite=Lax`;
    try {
      window.localStorage.setItem(VIEW_CHAIN_REVISION_STORAGE_KEY, revision);
    } catch {
      // Keep the same cookie fallback as the browsing preference itself.
    }
    persistViewChain(nextViewChainId);
  }, []);

  const value = useMemo(
    () => ({ hydrated, viewChainId, setViewChainId }),
    [hydrated, setViewChainId, viewChainId],
  );

  return (
    <ViewChainContext.Provider value={value}>
      {children}
    </ViewChainContext.Provider>
  );
}

export function useViewChain(): ViewChainContextValue {
  const value = useContext(ViewChainContext);
  if (!value) {
    throw new Error("useViewChain must be used within ViewChainProvider");
  }
  return value;
}

function captureRouteEntry(chainId: ViewChainId | undefined) {
  if (typeof document === "undefined") return { chainId, revision: null, previousChain: null };
  return { chainId, revision: readViewChainRevision(), previousChain: readViewChainCookie() ?? readStoredViewChain() };
}

/** Apply a route's initial preference without replacing a more recent choice. */
export function useRouteViewChain(chainId: ViewChainId | undefined): ViewChainContextValue {
  const value = useViewChain();
  const { hydrated, setViewChainId } = value;
  // Capture before the first passive effect, which may run after a visible
  // background tab has already been superseded by a choice in another tab.
  const [entry, setEntry] = useState(() => captureRouteEntry(chainId));
  if (entry.chainId !== chainId) setEntry(captureRouteEntry(chainId));

  useEffect(() => {
    const { chainId: routeChainId, revision, previousChain } = entry;
    if (!hydrated || routeChainId === undefined || revision === null) return;
    const timer = window.setTimeout(() => {
      if (readViewChainRevision() !== revision) return;
      // Also respect a numeric preference written by an already open older tab.
      if (previousChain !== null && (readViewChainCookie() ?? readStoredViewChain()) !== previousChain) return;
      setViewChainId(routeChainId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [entry, hydrated, setViewChainId]);

  return value;
}
