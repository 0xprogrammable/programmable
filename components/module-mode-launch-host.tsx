"use client";

import Link from "next/link";
import { ArrowUpRight, Check, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { formatUnits, toHex, type Address, type Hex } from "viem";

import { ModuleModeBuilder, type ModuleModeLaunchAction } from "@/components/module-mode-builder";
import { assertModuleModeWalletUnchanged, isModuleModeWalletRejection, moduleModeSubmissionIsUncertain, moduleModeWalletStep, uploadModuleModeImage, type ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { useWallet } from "@/components/wallet-provider";
import styles from "@/components/module-mode-builder.module.css";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { formatNativeWei, PREVIEW_MODULE_CATALOG, type ModuleModeDraft } from "@/lib/module-mode/builder";
import { moduleNativeCatalogDigest, parseModuleModeAvailability, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { createModuleNativeClient, ModuleNativeTransactionRevertedError, prepareModuleNativeLaunch, waitForModuleNativeReceipt, type ModuleNativeImageBinding, type ModuleNativeReceiptResult, type PreparedModuleNativeLaunch } from "@/lib/module-mode/native-client";
import { browserWalletRequestIsPending, subscribeToBrowserWalletRequest } from "@/lib/wallet-request-lock";

type LaunchFlow = {
  phase: "idle" | "uploading" | "preparing" | "prepared" | "signing" | "pending" | "mined" | "reverted" | "receipt-unavailable" | "error" | "uncertain";
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
  const message = typeof source?.shortMessage === "string" ? source.shortMessage : typeof source?.message === "string" ? source.message : "The launch could not be verified. Your draft is kept; prepare again when ready.";
  return message.length <= 360 ? message.replace(/^Module Mode: /, "") : "The launch could not be verified. Your draft is kept; prepare again when ready.";
}

function shortAddress(address: string) { return `${address.slice(0, 8)}…${address.slice(-6)}`; }
function utcDeadline(timestamp: bigint) { return `${new Date(Number(timestamp) * 1_000).toISOString().replace("T", " ").slice(0, 19)} UTC`; }

export function ModuleModeLaunchHost() {
  const { wallet, authenticated, sessionReady, authReady, connecting, openingWallet, switchingNetwork, disconnecting, openWallet, switchNetwork, getAccessToken, sendModuleModeTransaction } = useWallet();
  const client = useMemo(createModuleNativeClient, []);
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
  const preparedMatchesWallet = flow.prepared?.account.toLowerCase() === wallet?.account.toLowerCase() && walletStep === "prepare";
  const configurationContext = useMemo(() => wallet?.account ? { roles: { creator: wallet.account, launchWallet: wallet.account } } : {}, [wallet?.account]);
  const working = ["uploading", "preparing", "signing"].includes(flow.phase);
  const hasSubmission = Boolean(flow.transactionHash && flow.phase !== "reverted") || flow.phase === "uncertain";

  async function observeReceipt(prepared: PreparedModuleNativeLaunch, transactionHash: Hex) {
    setReceiptChecking(true);
    try {
      const receipt = await waitForModuleNativeReceipt({ client, prepared, transactionHash });
      if (mounted.current) setFlow((current) => current.transactionHash === transactionHash ? { ...current, phase: "mined", receipt, message: undefined } : current);
    } catch (error) {
      const reverted = error instanceof ModuleNativeTransactionRevertedError && error.transactionHash === transactionHash;
      if (mounted.current) setFlow((current) => current.transactionHash === transactionHash ? { ...current, phase: reverted ? "reverted" : "receipt-unavailable", message: reverted ? "This transaction reverted. The launch did not complete, and network gas may have been charged. You can edit the draft or prepare it again." : conciseError(error) } : current);
    } finally { if (mounted.current) setReceiptChecking(false); }
  }

  async function continueLaunch(draft: ModuleModeDraft, attachments: { tokenImage?: Blob }) {
    if (busy.current || requestPending || hasSubmission || (submitted.current && flow.phase !== "reverted")) return;
    if (flow.phase === "reverted") submitted.current = null;
    if (!release) throw new Error("Wallet launching is not available. You can keep or export this draft.");
    if (walletStep === "connect") { openWallet(); return; }
    if (walletStep === "switch") { await switchNetwork("0x1237"); return; }
    if (!wallet) return;
    const account = wallet.account as Address;
    const requestId = ++operation.current;
    const assertCurrentSession = () => {
      if (!mounted.current || operation.current !== requestId) throw new Error("The preparation was cancelled. Your draft is kept.");
      assertModuleModeWalletUnchanged(walletRef.current, account);
    };
    busy.current = true;
    let walletAttempted = false;
    try {
      assertCurrentSession();
      const ready = flow.phase === "prepared" && preparedMatchesWallet && flow.prepared?.draftId === draft.draftId ? flow.prepared : null;
      setFlow({ phase: ready ? "signing" : "preparing", draft, ...(ready ? { prepared: ready } : {}) });
      const current = await fetchAvailability();
      assertCurrentSession();
      setAvailability(current);
      if (!current.release) throw new Error("Wallet launching is currently unavailable. Your draft is kept.");
      if (draft.modules.some((module) => {
        const entry = current.catalog.find((candidate) => candidate.id === module.id && candidate.status === "available");
        return !entry || moduleNativeCatalogDigest(entry) !== module.catalogDigest;
      })) throw new Error("The module catalog changed. Edit and review your draft before preparing again.");
      if (BigInt(draft.initialBuyWei) < BigInt(current.release.minimumInitialBuyNative)) throw new Error(`The minimum initial buy is now ${formatNativeWei(current.release.minimumInitialBuyNative)} ETH. Edit your draft before preparing again.`);
      if (ready) {
        if (current.release.releaseDigest !== ready.releaseDigest) throw new Error("Launch availability changed. Edit and review your draft before preparing again.");
        if (ready.expiresAt <= BigInt(Math.floor(Date.now() / 1_000))) throw new Error("This preparation expired. Prepare again to check the current amounts before signing.");
        assertCurrentSession();
        walletAttempted = true;
        const transactionHash = await sendModuleModeTransaction(ready);
        submitted.current = transactionHash;
        // Keep returned transaction evidence even if the wallet changes while its dialog is open.
        if (mounted.current) {
          setFlow({ phase: "pending", prepared: ready, draft, transactionHash });
          void observeReceipt(ready, transactionHash);
        }
        return;
      }

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
      setFlow({ phase: "prepared", prepared, draft });
    } catch (error) {
      if (!mounted.current) return;
      const uncertain = moduleModeSubmissionIsUncertain(error, walletAttempted);
      if (uncertain) submitted.current = "uncertain";
      setFlow({ phase: uncertain ? "uncertain" : "error", draft, ...(uncertain && flow.prepared ? { prepared: flow.prepared } : {}), message: uncertain ? "We could not confirm whether your wallet sent the transaction. Check its activity before starting another launch. This draft will not be sent again from this page." : isModuleModeWalletRejection(error) ? "You cancelled the wallet request. Your draft is kept; prepare again when you are ready." : conciseError(error) });
    } finally { busy.current = false; }
  }

  let actionLabel = walletStep === "connect" ? "Connect wallet" : walletStep === "switch" ? "Switch to Robinhood" : "Prepare launch";
  let actionTitle = "Prepare your launch.";
  let actionDescription = "We check the live contracts and simulate your initial buy. You will review the result before opening your wallet.";
  if (walletStep === "connect") actionDescription = "Connect the wallet that will create this coin, then prepare your launch.";
  else if (walletStep === "switch") actionDescription = "Switch your connected wallet to Robinhood, then prepare your launch.";
  if (flow.phase === "uploading") { actionLabel = "Publishing image…"; actionTitle = "Preparing token metadata."; actionDescription = "Your selected image is being published for this token."; }
  if (flow.phase === "preparing") { actionLabel = "Checking launch…"; actionTitle = "Checking your launch."; actionDescription = "Checking the active modules, launch minimum and initial buy against the current chain state."; }
  if (flow.phase === "prepared" && preparedMatchesWallet) { actionLabel = "Confirm in wallet"; actionTitle = "Simulation passed."; actionDescription = "Review the amounts below, then confirm this exact launch in your wallet. The wallet will show the network gas cost."; }
  if (flow.phase === "signing") { actionLabel = "Waiting for wallet…"; actionTitle = "Confirm in your wallet."; actionDescription = "The launch is checked again before your wallet opens. Keep this page open until the transaction status appears."; }
  if (flow.phase === "pending" || flow.phase === "receipt-unavailable") { actionLabel = "Transaction sent"; actionTitle = "Your launch transaction was sent."; actionDescription = "The transaction is being checked on Robinhood. Do not launch this draft again while its result is unresolved."; }
  if (flow.phase === "mined") { actionLabel = "Included onchain"; actionTitle = "Your launch was included onchain."; actionDescription = "The transaction and launch record match your request. Finality and profile indexing are still separate checks."; }
  if (flow.phase === "reverted") { actionLabel = "Prepare again"; actionTitle = "The launch transaction reverted."; actionDescription = "Prepare a new transaction to check current conditions before trying again."; }
  if (flow.phase === "uncertain") { actionLabel = "Check wallet activity"; actionTitle = "Wallet result needs checking."; actionDescription = "No automatic retry will be made."; }
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
    statusContent={availabilityLoading || availabilityError || requestPending || release ? <div className={styles.launchAvailability}>
      <p role="status">{availabilityLoading ? "Checking wallet launch availability…" : availabilityError ? "Preview available. Wallet launching could not be checked." : requestPending ? "A wallet request is already open. Finish it before continuing here." : walletStep === "prepare" ? `Connected: ${shortAddress(wallet!.account)} · Robinhood` : "Wallet launching is available on Robinhood."}</p>
      {availabilityError && !hasSubmission ? <button className={styles.textButton} type="button" onClick={refreshAvailability}><RefreshCw size={14} aria-hidden="true" /> Check again</button> : null}
    </div> : undefined}
    reviewContent={<>
      {flow.message ? <p className={styles.launchError} role="alert">{flow.message}</p> : null}
      {flow.phase === "prepared" && !preparedMatchesWallet ? <p className={styles.launchError} role="status">Your wallet changed. Prepare again with the current wallet before signing.</p> : null}
      {flow.prepared && flow.draft && (preparedMatchesWallet || Boolean(flow.transactionHash)) ? <LaunchTransactionDetails prepared={flow.prepared} draft={flow.draft} /> : null}
      {flow.transactionHash ? <div className={styles.transactionResult}>
        <div className={styles.resultHeading}>{flow.phase === "mined" ? <Check size={18} aria-hidden="true" /> : flow.phase === "reverted" ? null : <LoaderCircle className={receiptChecking ? styles.progressIcon : undefined} size={18} aria-hidden="true" />}<strong>{flow.phase === "mined" ? "Included on Robinhood" : flow.phase === "reverted" ? "Transaction reverted" : receiptChecking ? "Waiting for confirmation" : "Transaction status needs checking"}</strong></div>
        <a className={styles.transactionLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${flow.transactionHash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} aria-hidden="true" /><span className={styles.liveRegion}> (opens in a new tab)</span></a>
        {flow.phase === "receipt-unavailable" && flow.prepared ? <button className={styles.textButton} disabled={receiptChecking} type="button" onClick={() => void observeReceipt(flow.prepared!, flow.transactionHash!)}><RefreshCw size={14} aria-hidden="true" /> Check transaction again</button> : null}
        {flow.receipt?.token ? <><p>The launch record was verified at block {flow.receipt.blockNumber.toString()}. It is not yet confirmed as finalized or visible in your profile.</p><div className={styles.resultLinks}><Link className={styles.secondaryButton} href={`/token/${flow.receipt.token}?chain=4663`}>View token <ArrowUpRight size={14} aria-hidden="true" /></Link><Link className={styles.textButton} href={`/launch/modules/manage/${flow.receipt.token}`}>Manage modules <ArrowUpRight size={14} aria-hidden="true" /></Link><Link className={styles.textButton} href="/profile">Your profile <ArrowUpRight size={14} aria-hidden="true" /></Link></div></> : null}
      </div> : null}
    </>}
  />;
}

function LaunchTransactionDetails({ prepared, draft }: { prepared: PreparedModuleNativeLaunch; draft: ModuleModeDraft }) {
  return <div className={styles.transactionReview}>
    <dl className={styles.reviewRows}>
      <div><dt>Total ETH value</dt><dd>{formatNativeWei(draft.totalNativeValueWei)} ETH<span>Initial buy + additional program budgets. Gas is separate.</span></dd></div>
      <div><dt>Estimated initial tokens</dt><dd>{formatUnits(prepared.quotedTokenOut, 18)} {draft.token.symbol}</dd></div>
      <div><dt>Minimum you receive</dt><dd>{formatUnits(prepared.minimumTokenOut, 18)} {draft.token.symbol}<span>1% slippage limit</span></dd></div>
    </dl>
    <details className={styles.transactionDetails}><summary>Transaction details</summary><dl>
      <div><dt>From</dt><dd>{prepared.account}</dd></div>
      <div><dt>Launch contract</dt><dd>{prepared.transaction.to}</dd></div>
      <div><dt>Expected token address</dt><dd>{prepared.predictedToken}</dd></div>
      <div><dt>Estimated gas units</dt><dd>{prepared.gasEstimate.toString()}</dd></div>
      <div><dt>Simulation block</dt><dd>{prepared.blockNumber.toString()}</dd></div>
      <div><dt>Transaction deadline</dt><dd>{utcDeadline(prepared.expiresAt)}</dd></div>
    </dl></details>
  </div>;
}
