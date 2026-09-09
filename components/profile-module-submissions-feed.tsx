"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useWallet } from "@/components/wallet-provider";
import { ProfileModuleSubmissions } from "@/components/profile-module-submissions";
import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { readWalletModuleSubmissions, type WalletModuleSubmissions } from "@/lib/profile/module-submissions";
import styles from "./profile-modules.module.css";

type Props = { account: string; refreshNonce: number };
type Tokens = {
  getAccessToken: () => Promise<string | null>;
  getIdentityToken: () => Promise<string | null>;
};

/** Mount private state only for the active authenticated wallet. Logout unmounts and clears it. */
export function ProfileModuleSubmissionsFeed({ account, refreshNonce }: Props) {
  const { wallet, authenticated, sessionReady, getAccessToken, getIdentityToken, openWallet } = useWallet();
  if (!sessionReady) return <ProfileModuleSubmissions data={{ status: "loading" }} />;
  if (!authenticated || wallet?.account.toLowerCase() !== account.toLowerCase()) return <div className={styles.empty}>
    <p className={styles.notice} role="status">Connect this wallet to view its submissions.</p>
    <button type="button" className={styles.buildLink} onClick={openWallet}>Connect wallet</button>
  </div>;
  return <AuthenticatedSubmissions key={account.toLowerCase()} account={account.toLowerCase()} refreshNonce={refreshNonce}
    getAccessToken={getAccessToken} getIdentityToken={getIdentityToken} />;
}

function AuthenticatedSubmissions({ account, refreshNonce, getAccessToken, getIdentityToken }: Props & Tokens) {
  const [cursors, setCursors] = useState<readonly (string | null)[]>([null]);
  const [page, setPage] = useState(0);
  const cursor = cursors[page] ?? null;
  const [result, setResult] = useState<{ cursor: string | null; data: WalletModuleSubmissions } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const refresh = useLiveDataRefresh({ intervalMs: 60_000 });
  const data = result?.cursor === cursor ? result.data : null;

  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (!disposed) { setFailed(true); setLoading(false); }
    }, 12_000);
    queueMicrotask(() => { if (!disposed) { setLoading(true); setFailed(false); } });
    const load = async () => {
      // Read access after identity refresh so both credentials describe the same session.
      const identityToken = await getIdentityToken().catch(() => null);
      const accessToken = await getAccessToken();
      if (controller.signal.aborted) return;
      if (!accessToken) throw new Error("Session required.");
      const query = new URLSearchParams({ walletAddress: account });
      if (cursor !== null) query.set("cursor", cursor);
      const response = await fetch(`/api/profile/module-submissions?${query}`, {
        cache: "no-store", signal: controller.signal,
        headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`,
          ...(identityToken ? { "X-Privy-Identity-Token": identityToken } : {}) },
      });
      if (!response.ok) throw new Error("Submissions unavailable.");
      const next = readWalletModuleSubmissions(await response.json(), account);
      if (next.nextCursor !== null && cursors.slice(0, page + 1).includes(next.nextCursor)) throw new Error("Invalid submissions page.");
      if (!disposed && !controller.signal.aborted) { setResult({ cursor, data: next }); setFailed(false); }
    };
    void load().catch(() => { if (!disposed && !controller.signal.aborted) setFailed(true); })
      .finally(() => { window.clearTimeout(timeout); if (!disposed && !controller.signal.aborted) setLoading(false); });
    return () => { disposed = true; window.clearTimeout(timeout); controller.abort(); };
  }, [account, cursor, cursors, page, getAccessToken, getIdentityToken, refresh, refreshNonce, retry]);

  const items = data?.submissions.map(item => ({
    id: item.submissionId, packageId: item.packageId, familySalt: item.familySalt,
    title: item.name, version: item.version, author: item.author, rewardWallet: item.rewardWallet,
    submittedAt: item.createdAt, updatedAt: item.review?.updatedAt,
    reviewState: item.review?.state ?? null,
    reviewRevision: item.review?.revision, reviewAttempt: item.review?.attempt,
    feedback: item.review?.latestDecision?.reason,
  })) ?? [];

  return <div aria-busy={loading}>
    <ProfileModuleSubmissions
      data={failed ? { status: "error" } : !data ? { status: "loading" } : { status: "ready", items }}
      onRetry={() => setRetry(value => value + 1)} />
    {(page > 0 || data?.nextCursor) ? <nav className={styles.pagination} aria-label="Submission pages">
      <button type="button" aria-label="Previous submission page" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={18} aria-hidden="true" /></button>
      <span aria-live="polite" aria-atomic="true">Page {page + 1}</span>
      <button type="button" aria-label="Next submission page" disabled={loading || failed || !data?.nextCursor} onClick={() => {
        if (!data?.nextCursor) return;
        setCursors([...cursors.slice(0, page + 1), data.nextCursor]);
        setPage(value => value + 1);
      }}><ChevronRight size={18} aria-hidden="true" /></button>
    </nav> : null}
  </div>;
}
