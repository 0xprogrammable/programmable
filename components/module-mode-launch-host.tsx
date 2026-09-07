"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatUnits, toHex, type Address, type Hex } from "viem";

import { ModuleModeBuilder, type ModuleModeLaunchAction } from "@/components/module-mode-builder";
import { assertModuleModeWalletUnchanged, isModuleModeWalletRejection, moduleModeSubmissionIsUncertain, moduleModeWalletStep, switchModuleModeNetwork, uploadModuleModeImage, type ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { useWallet } from "@/components/wallet-provider";
import styles from "@/components/module-mode-builder.module.css";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { formatNativeWei, PREVIEW_MODULE_CATALOG, type ModuleModeDraft } from "@/lib/module-mode/builder";
import { moduleNativeCatalogDigest, parseModuleModeAvailability, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { createModuleNativeClient, ModuleNativeTransactionRevertedError, prepareModuleNativeLaunch, waitForModuleNativeReceipt, type ModuleNativeImageBinding, type ModuleNativeReceiptResult, type PreparedModuleNativeLaunch } from "@/lib/module-mode/native-client";
import { browserWalletRequestIsPending, subscribeToBrowserWalletRequest } from "@/lib/wallet-request-lock";

type LaunchFlow = {
  phase: "idle" | "uploading" | "preparing" | "signing" | "pending" | "mined" | "reverted" | "receipt-unavailable" | "error" | "uncertain";
  prepared?: PreparedModuleNativeLaunch;
  draft?: ModuleModeDraft;
  transactionHash?: Hex;
  receipt?: ModuleNativeReceiptResult;
  message?: string;
};

function useModuleWalletRequestPending(account: string | undefined) {
  const subscribe = useCallback((listener: () => void) => subscribeToBrowserWalletRequest(account, "4663", listener), [account]);
  const snapshot = useCallback(() => browserWalletRequestIsPending(account, "4663"), [account]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

async function fetchAvailability(signal?: AbortSignal): Promise<ModuleModeAvailability> {
  const response = await fetch("/api/module-mode", { cache: "no-store", credentials: "same-origin", redirect: "error", signal });
  if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    throw new Error("Wallet launch availability could not be checked. Your draft is kept.");
  }
  return parseModuleModeAvailability(await response.json());
}

function conciseError(error: unknown) {
  const source = error as { shortMessage?: unknown; message?: unknown } | null;
  const message = typeof source?.shortMessage === "string" ? source.shortMessage : typeof source?.message === "string" ? source.message : "The launch could not be completed. Try again.";
  return message.length <= 360 ? message.replace(/^Module Mode: /, "") : "The launch could not be completed. Try again.";
}

function utcDeadline(timestamp: bigint) { return `${new Date(Number(timestamp) * 1_000).toISOString().replace("T", " ").slice(0, 19)} UTC`; }

function assertDraftAvailability(draft: ModuleModeDraft, current: ModuleModeAvailability) {
  if (!current.release) throw new Error("Launching is temporarily unavailable. Try again later.");
  if (draft.modules.some((module) => {
    const entry = current.catalog.find((candidate) => candidate.id === module.id && candidate.status === "available");
    return !entry || moduleNativeCatalogDigest(entry) !== module.catalogDigest;
  })) throw new Error("A selected module changed. Edit your coin to review its current settings.");
  if (BigInt(draft.initialBuyWei) < BigInt(current.release.minimumInitialBuyNative)) {
    throw new Error(`The minimum initial buy is now ${formatNativeWei(current.release.minimumInitialBuyNative)} ETH. Update your initial buy.`);
  }
}

export function ModuleModeLaunchHost() {
  const { wallet, authenticated, sessionReady, authReady, connecting, openingWallet, switchingNetwork, disconnecting, openWallet, switchNetwork, getAccessToken, sendModuleModeTransaction } = useWallet();
  const client = useMemo(() => createModuleNativeClient(), []);
  const [availability, setAvailability] = useState<ModuleModeAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [flow, setFlow] = useState<LaunchFlow>({ phase: "idle" });
  const [receiptChecking, setReceiptChecking] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestPending = useModuleWalletRequestPending(wallet?.account);
  const operation = useRef(0);
  const busy = useRef(false);
  const submitted = useRef<Hex | "uncertain" | null>(null);
  const mounted = useRef(true);
  const uploadedImages = useRef(new Map<string, ModuleNativeImageBinding>());
  const salts = useRef(new Map<string, Hex>());
  const walletRef = useRef<ModuleModeWalletSnapshot>({ account: wallet?.account, chainId: wallet?.chainId, authenticated, sessionReady });
  useEffect(() => { walletRef.current = { account: wallet?.account, chainId: wallet?.chainId, authenticated, sessionReady }; }, [wallet?.account, wallet?.chainId, authenticated, sessionReady]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current += 1; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchAvailability(controller.signal).then((next) => {
      if (!controller.signal.aborted) { setAvailability(next); setAvailabilityError(false); setAvailabilityLoading(false); }
    }).catch(() => {
      if (!controller.signal.aborted) { setAvailability(null); setAvailabilityError(true); setAvailabilityLoading(false); }
    });
    return () => controller.abort();
  }, [refreshKey]);

  const release = availability?.release ?? null;
  const catalog = useMemo(() => availability ? release ? availability.catalog.filter((entry) => entry.status === "available") : availability.catalog : PREVIEW_MODULE_CATALOG, [availability, release]);
  const walletStep = moduleModeWalletStep({ account: wallet?.account, chainId: wallet?.chainId, authenticated, sessionReady });
  const walletAccount = wallet?.account;
  const configurationContext = useMemo(() => walletAccount ? { roles: { creator: walletAccount, launchWallet: walletAccount } } : {}, [walletAccount]);
  const working = ["uploading", "preparing", "signing"].includes(flow.phase);
  const hasSubmission = Boolean(flow.transactionHash && flow.phase !== "reverted") || flow.phase === "uncertain";

  async function observeReceipt(prepared: PreparedModuleNativeLaunch, transactionHash: Hex) {
    setReceiptChecking(true);
    try {
      const receipt = await waitForModuleNativeReceipt({ client, prepared, transactionHash });
      if (mounted.current) setFlow((current) => current.transactionHash === transactionHash ? { ...current, phase: "mined", receipt, message: undefined } : current);
    } catch (error) {
      const reverted = error instanceof ModuleNativeTransactionRevertedError && error.transactionHash === transactionHash;
      if (mounted.current) setFlow((current) => current.transactionHash === transactionHash ? { ...current, phase: reverted ? "reverted" : "receipt-unavailable", message: reverted ? "The transaction reverted. No coin was created. Gas may still have been charged." : "Confirmation is taking longer than usual. View the transaction or check its confirmation again." } : current);
    } finally { if (mounted.current) setReceiptChecking(false); }
  }

  async function continueLaunch(draft: ModuleModeDraft, attachments: { tokenImage?: Blob }) {
    if (busy.current || requestPending || hasSubmission || (submitted.current && flow.phase !== "reverted")) return;
    if (flow.phase === "reverted") submitted.current = null;
    if (!release) throw new Error("Wallet launching is not available. You can keep or export this draft.");
    if (walletStep === "connect") { openWallet(); return; }
    if (walletStep === "switch") { await switchModuleModeNetwork(switchNetwork); return; }
    if (!wallet) return;
    const account = wallet.account as Address;
    const requestId = ++operation.current;
    const assertCurrentSession = () => {
      if (!mounted.current || operation.current !== requestId) throw new Error("The preparation was cancelled. Your draft is kept.");
      assertModuleModeWalletUnchanged(walletRef.current, account);
    };
    busy.current = true;
    let walletAttempted = false;
    let activePreparation: PreparedModuleNativeLaunch | undefined;
    try {
      assertCurrentSession();
      setFlow({ phase: "preparing", draft });
      const current = await fetchAvailability();
      assertCurrentSession();
      setAvailability(current);
      assertDraftAvailability(draft, current);

      const imageKey = draft.token.image.kind === "local" ? `${account.toLowerCase()}:${draft.token.image.sha256}` : null;
      let image = imageKey ? uploadedImages.current.get(imageKey) : undefined;
      if (!image) {
        setFlow({ phase: draft.token.image.kind === "local" ? "uploading" : "preparing", draft });
        image = await uploadModuleModeImage({ image: draft.token.image, blob: attachments.tokenImage, getAccessToken, assertCurrentSession });
        if (imageKey) uploadedImages.current.set(imageKey, image);
      }
      assertCurrentSession();
      setFlow({ phase: "preparing", draft });
      const saltKey = `${account.toLowerCase()}:${draft.draftId}`;
      let creatorSalt = salts.current.get(saltKey);
      if (!creatorSalt) { creatorSalt = toHex(crypto.getRandomValues(new Uint8Array(32))); salts.current.set(saltKey, creatorSalt); }
      const prepared = await prepareModuleNativeLaunch({ client, availability: current, draft, account, image, creatorSalt, slippageBps: 100 });
      assertCurrentSession();
      activePreparation = prepared;
      // Refresh availability after preparation, then retain the wallet provider's exact transaction revalidation.
      const latest = await fetchAvailability();
      assertCurrentSession();
      setAvailability(latest);
      assertDraftAvailability(draft, latest);
      if (latest.release?.releaseDigest !== prepared.releaseDigest) throw new Error("Launch availability changed. Try again to use the current version.");
      if (prepared.expiresAt <= BigInt(Math.floor(Date.now() / 1_000))) throw new Error("The quote expired. Try again for a fresh quote.");
      setFlow({ phase: "signing", prepared, draft });
      assertCurrentSession();
      walletAttempted = true;
      const transactionHash = await sendModuleModeTransaction(prepared);
      submitted.current = transactionHash;
      // A returned hash remains evidence even if the wallet changes while its dialog is open.
      if (mounted.current) {
        setFlow({ phase: "pending", prepared, draft, transactionHash });
        void observeReceipt(prepared, transactionHash);
      }
    } catch (error) {
      if (!mounted.current) return;
      const uncertain = moduleModeSubmissionIsUncertain(error, walletAttempted);
      if (uncertain) submitted.current = "uncertain";
      setFlow({ phase: uncertain ? "uncertain" : "error", draft, ...(uncertain && activePreparation ? { prepared: activePreparation } : {}), message: uncertain ? "Check your wallet activity to see whether the transaction was sent. This page will not send it again." : isModuleModeWalletRejection(error) ? "Wallet request cancelled." : conciseError(error) });
    } finally { busy.current = false; }
  }

  let actionLabel = walletStep === "connect" ? "Connect wallet" : walletStep === "switch" ? "Switch to Robinhood" : "Launch coin";
  let actionTitle = "Launch coin";
  let actionDescription = "Confirm the launch and gas cost in your wallet.";
  if (walletStep === "connect") actionDescription = "Connect a wallet to launch your coin.";
  else if (walletStep === "switch") actionDescription = "Switch your wallet to Robinhood to continue.";
  if (flow.phase === "uploading") { actionLabel = "Uploading image…"; actionTitle = "Uploading image"; actionDescription = "Your wallet opens when the launch is ready."; }
  if (flow.phase === "preparing") { actionLabel = "Preparing launch…"; actionTitle = "Preparing launch"; actionDescription = "Your wallet opens when the launch is ready."; }
  if (flow.phase === "signing") { actionLabel = "Confirm in wallet"; actionTitle = "Confirm in your wallet"; actionDescription = "Your wallet shows the total, including gas."; }
  if (flow.phase === "reverted") { actionLabel = "Try again"; actionTitle = "Launch failed"; actionDescription = "Try again or edit your coin."; }
  const launchAction: ModuleModeLaunchAction | undefined = release || hasSubmission ? {
    label: actionLabel, title: actionTitle, description: actionDescription,
    disabled: availabilityLoading || (walletStep !== "connect" && !authReady) || connecting || openingWallet || switchingNetwork || disconnecting || requestPending || hasSubmission,
    busy: working,
    lockDraft: working || requestPending || hasSubmission,
    onContinue: continueLaunch,
  } : undefined;

  function refreshAvailability() {
    setAvailabilityLoading(true); setAvailabilityError(false); setRefreshKey((key) => key + 1);
  }

  return <ModuleModeBuilder
    catalog={catalog}
    configurationContext={configurationContext}
    launchAction={launchAction}
    minimumInitialBuyWei={release?.minimumInitialBuyNative}
    previewDescription={availabilityError ? "Wallet launch availability could not be checked. You can keep configuring and export this draft; no token has been created." : "Wallet launching is not available yet. You can configure and export this draft; no token has been created."}
    onEdit={() => { operation.current += 1; if (flow.phase === "reverted") submitted.current = null; setFlow({ phase: "idle" }); }}
    statusContent={availabilityLoading || availabilityError || (requestPending && !working && !hasSubmission) ? <div className={styles.launchAvailability}>
      <p role="status">{availabilityLoading ? "Loading…" : availabilityError ? "Launching is unavailable. Check again to continue." : "Finish the open wallet request to continue."}</p>
      {availabilityError && !hasSubmission ? <button className={styles.textButton} type="button" onClick={refreshAvailability}><RefreshCw size={14} aria-hidden="true" /> Check again</button> : null}
    </div> : undefined}
    reviewContent={<>
      {flow.message ? <p className={styles.launchError} role="alert">{flow.message}</p> : null}
      {flow.prepared && flow.draft && flow.phase === "signing" ? <LaunchTransactionDetails prepared={flow.prepared} draft={flow.draft} /> : null}
      {flow.phase === "reverted" && flow.transactionHash ? <a className={styles.transactionLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${flow.transactionHash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} aria-hidden="true" /></a> : null}
    </>}
    resultContent={hasSubmission ? <ModuleModeLaunchResult
      phase={flow.phase === "mined" ? "mined" : flow.phase === "uncertain" ? "uncertain" : flow.phase === "receipt-unavailable" ? "receipt-unavailable" : "pending"}
      token={flow.receipt?.token}
      symbol={flow.draft?.token.symbol}
      transactionHash={flow.transactionHash}
      message={flow.message}
      checking={receiptChecking}
      onCheck={flow.prepared && flow.transactionHash ? () => void observeReceipt(flow.prepared!, flow.transactionHash!) : undefined}
    /> : undefined}
  />;
}

export function ModuleModeLaunchResult({ phase, token, symbol, transactionHash, message, checking = false, onCheck }: {
  phase: "pending" | "mined" | "receipt-unavailable" | "uncertain";
  token?: Address;
  symbol?: string;
  transactionHash?: Hex;
  message?: string;
  checking?: boolean;
  onCheck?: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  const addressInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const launched = phase === "mined" && Boolean(token);
  useEffect(() => { heading.current?.focus(); }, [phase]);
  async function copyAddress() {
    if (!token) return;
    try { await navigator.clipboard.writeText(token); setCopyStatus("Address copied"); }
    catch { addressInput.current?.focus(); addressInput.current?.select(); setCopyStatus("Select and copy the address below."); }
  }
  return <div className={styles.launchResult}>
    <div className={styles.resultHeading}>
      {launched ? <span className={styles.successIcon}><Check size={24} aria-hidden="true" /></span> : phase === "pending" ? <LoaderCircle className={styles.progressIcon} size={24} aria-hidden="true" /> : null}
      <h2 ref={heading} tabIndex={-1}>{launched ? "Coin launched" : phase === "uncertain" ? "Check your wallet" : "Confirming launch"}</h2>
    </div>
    <p role="status">{launched ? `${symbol ? `$${symbol} is on Robinhood. ` : ""}Explore updates after final confirmation.` : message ?? "Your transaction was sent. Keep this page open for confirmation."}</p>
    {launched && token ? <>
      <div className={styles.contractAddress}><label htmlFor="module-launched-address">Contract address</label><input ref={addressInput} id="module-launched-address" value={token} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} /></div>
      <div className={styles.resultLinks}><Link className={styles.primaryButton} href={`/token/${token}?chain=4663`}>View token <ArrowUpRight size={16} aria-hidden="true" /></Link><button className={styles.secondaryButton} type="button" onClick={() => void copyAddress()}><Copy size={16} aria-hidden="true" />{copyStatus === "Address copied" ? "Copied" : "Copy address"}</button></div>
      <p className={copyStatus === "Select and copy the address below." ? styles.help : styles.liveRegion} role="status">{copyStatus}</p>
    </> : null}
    {transactionHash ? <a className={styles.transactionLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} aria-hidden="true" /><span className={styles.liveRegion}> (opens in a new tab)</span></a> : null}
    {phase === "receipt-unavailable" && onCheck ? <button className={styles.textButton} disabled={checking} type="button" onClick={onCheck}><RefreshCw size={14} aria-hidden="true" />{checking ? "Checking…" : "Check confirmation"}</button> : null}
  </div>;
}

function LaunchTransactionDetails({ prepared, draft }: { prepared: PreparedModuleNativeLaunch; draft: ModuleModeDraft }) {
  return <details className={styles.transactionDetails}><summary>Transaction details</summary>
    <dl className={styles.reviewRows}>
      <div><dt>Estimated initial tokens</dt><dd>{formatUnits(prepared.quotedTokenOut, 18)} {draft.token.symbol}</dd></div>
      <div><dt>Minimum you receive</dt><dd>{formatUnits(prepared.minimumTokenOut, 18)} {draft.token.symbol}<span>1% slippage limit</span></dd></div>
    </dl>
    <dl>
      <div><dt>From</dt><dd>{prepared.account}</dd></div>
      <div><dt>Launch contract</dt><dd>{prepared.transaction.to}</dd></div>
      <div><dt>Expected token address</dt><dd>{prepared.predictedToken}</dd></div>
      <div><dt>Estimated gas units</dt><dd>{prepared.gasEstimate.toString()}</dd></div>
      <div><dt>Simulation block</dt><dd>{prepared.blockNumber.toString()}</dd></div>
      <div><dt>Transaction deadline</dt><dd>{utcDeadline(prepared.expiresAt)}</dd></div>
    </dl>
  </details>;
}
