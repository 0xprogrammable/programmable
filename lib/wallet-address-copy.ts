"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

type CopyFeedback = Readonly<{
  account: string;
  status: "copied" | "unavailable";
}>;

/** Clipboard feedback belongs to the exact account and request that produced it. */
export function useWalletAddressCopy(account: string | undefined) {
  const [feedback, setFeedback] = useState<CopyFeedback | null>(null);
  const requestIdRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useLayoutEffect(() => {
    requestIdRef.current += 1;
    return () => {
      requestIdRef.current += 1;
      clearTimeout(resetTimerRef.current);
    };
  }, [account]);

  const copyAddress = useCallback(async () => {
    if (!account) return;
    const requestId = ++requestIdRef.current;
    clearTimeout(resetTimerRef.current);
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(account);
      if (requestId !== requestIdRef.current) return;
      setFeedback({ account, status: "copied" });
      resetTimerRef.current = setTimeout(() => {
        if (requestId === requestIdRef.current) setFeedback(null);
      }, 1500);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setFeedback({ account, status: "unavailable" });
    }
  }, [account]);

  // Reset during the account transition, before React paints the new wallet.
  if (feedback !== null && feedback.account !== account) setFeedback(null);
  const current = feedback?.account === account ? feedback : null;
  return {
    copyAddress,
    copied: current?.status === "copied",
    copyUnavailable: current?.status === "unavailable",
  };
}
