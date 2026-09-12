"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Hex } from "viem";
import { ModuleModeLaunchHost } from "./module-mode-launch-host";
import { ModuleEngineHost } from "./module-engine-host";
import type { ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import type { ModuleEngineAvailability } from "@/lib/module-engine/catalog";
import { availableAnyQuoteLibraryEntry, moduleLaunchSelectionKey, moduleLaunchSelectionPath, type ModuleLaunchWorkspaceRequests } from "@/lib/module-mode/launch-workspace";
import { parseModuleModeReleaseSelection, type ModuleModeLaunchVersion, type ModuleModeReleaseSelection } from "@/lib/module-mode/release-selection";

type Snapshot = { source: "native"; value: ModuleModeAvailability } | { source: "engine"; value: ModuleEngineAvailability };

/** Keep the coin setup on screen while verified catalogs and version discovery arrive independently. */
export function ModuleLaunchWorkspace({ initialSelection, reviewedAnyQuoteDigest, requests }: {
  initialSelection: ModuleModeReleaseSelection;
  reviewedAnyQuoteDigest: Hex;
  requests: ModuleLaunchWorkspaceRequests;
}) {
  const initialKey = moduleLaunchSelectionKey(initialSelection);
  const [chosenSelection, setChosenSelection] = useState({ routeKey: initialKey, value: initialSelection });
  // A genuine route change wins over local picker navigation without an extra render pass.
  const selection = chosenSelection.routeKey === initialKey ? chosenSelection.value : initialSelection;
  const [snapshots, setSnapshots] = useState<ReadonlyMap<string, Snapshot>>(() => new Map());
  const [versions, setVersions] = useState<readonly ModuleModeLaunchVersion[]>([]);
  const requestMap = useMemo(() => {
    const entries = new Map<string, { source: "native"; request: Promise<ModuleModeAvailability> } | { source: "engine"; request: Promise<ModuleEngineAvailability> }>([
      [moduleLaunchSelectionKey({}), { source: "native", request: requests.native }],
      [moduleLaunchSelectionKey({ sourceKind: "module-engine-v1", releaseDigest: reviewedAnyQuoteDigest }), { source: "engine", request: requests.anyQuote }],
    ]);
    if (requests.selectedNative) entries.set(initialKey, { source: "native", request: requests.selectedNative });
    if (requests.selectedEngine) entries.set(initialKey, { source: "engine", request: requests.selectedEngine });
    return entries;
  }, [requests, reviewedAnyQuoteDigest, initialKey]);

  useEffect(() => {
    let active = true;
    for (const [key, source] of requestMap) {
      void source.request.then(value => {
        if (!active) return;
        const snapshot = source.source === "native" ? { source: "native" as const, value: value as ModuleModeAvailability }
          : { source: "engine" as const, value: value as ModuleEngineAvailability };
        setSnapshots(current => new Map(current).set(key, snapshot));
      }).catch(() => { /* The selected host exposes the retry; failed discovery adds no cards. */ });
    }
    void requests.versions.then(next => { if (active) setVersions(next); }).catch(() => { /* Current setup does not depend on historical discovery. */ });
    return () => { active = false; };
  }, [requestMap, requests.versions]);

  useEffect(() => {
    const restoreSelection = () => {
      if (window.location.pathname !== "/launch/modules") return;
      try { setChosenSelection({ routeKey: initialKey, value: parseModuleModeReleaseSelection(new URLSearchParams(window.location.search)) }); }
      catch { /* Invalid URLs remain the route validator's responsibility. */ }
    };
    window.addEventListener("popstate", restoreSelection);
    return () => window.removeEventListener("popstate", restoreSelection);
  }, [initialKey]);

  const navigate = useCallback((next: ModuleModeReleaseSelection) => {
    const path = moduleLaunchSelectionPath(next);
    if (`${window.location.pathname}${window.location.search}` !== path) window.history.pushState(null, "", path);
    setChosenSelection({ routeKey: initialKey, value: next });
  }, [initialKey]);

  const selectedKey = moduleLaunchSelectionKey(selection);
  const selectedSnapshot = snapshots.get(selectedKey);
  const selectedRequest = requestMap.get(selectedKey);
  const nativeSnapshot = snapshots.get(moduleLaunchSelectionKey({}));
  const anyQuoteSnapshot = snapshots.get(moduleLaunchSelectionKey({ sourceKind: "module-engine-v1", releaseDigest: reviewedAnyQuoteDigest }));
  const anyQuote = useMemo(() => availableAnyQuoteLibraryEntry(anyQuoteSnapshot?.value, reviewedAnyQuoteDigest), [anyQuoteSnapshot, reviewedAnyQuoteDigest]);

  if (selection.sourceKind === "module-engine-v1") return <ModuleEngineHost releaseDigest={selection.releaseDigest}
    versions={versions} onNavigateSelection={navigate}
    initialAvailability={selectedSnapshot?.source === "engine" ? selectedSnapshot.value : undefined}
    availabilityRequest={selectedRequest?.source === "engine" ? selectedRequest.request : undefined}
    nativeCatalog={nativeSnapshot?.source === "native" ? nativeSnapshot.value.catalog : []}
    nativeRelease={nativeSnapshot?.source === "native" ? nativeSnapshot.value.release : undefined} />;
  return <ModuleModeLaunchHost releaseDigest={selection.releaseDigest} versions={versions} onNavigateSelection={navigate}
    initialAvailability={selectedSnapshot?.source === "native" ? selectedSnapshot.value : undefined}
    availabilityRequest={selectedRequest?.source === "native" ? selectedRequest.request : undefined}
    anyQuoteReleaseDigest={anyQuote?.releaseDigest} anyQuoteModule={anyQuote?.entry} />;
}
