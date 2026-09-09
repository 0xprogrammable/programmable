"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

function readViewChainCookie(): ViewChainId | null {
  const encodedName = `${VIEW_CHAIN_COOKIE_NAME}=`;
  for (const cookiePart of document.cookie.split(";")) {
    const normalizedPart = cookiePart.trim();
    if (!normalizedPart.startsWith(encodedName)) continue;
    return tryParseViewChainId(normalizedPart.slice(encodedName.length));
  }
  return null;
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
    if (
      readViewChainCookie() !== viewChainId ||
      readStoredViewChain() !== viewChainId
    ) {
      persistViewChain(viewChainId);
    }
  }, [hydrated, viewChainId]);

  const setViewChainId = useCallback((nextViewChainId: ViewChainId) => {
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
