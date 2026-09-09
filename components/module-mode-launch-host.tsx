"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { formatUnits, toHex, type Address, type Hex } from "viem";

import { ModuleModeBuilder, type ModuleModeLaunchAction } from "@/components/module-mode-builder";
import { ModuleBuilderLoading } from "@/components/module-builder-loading";
import { assertModuleModeWalletUnchanged, isModuleModeWalletRejection, moduleModeSubmissionIsUncertain, moduleModeWalletStep, switchModuleModeNetwork, uploadModuleModeImage, useModuleModeOperation, type ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { useWallet } from "@/components/wallet-provider";
import styles from "@/components/module-mode-builder.module.css";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { formatNativeWei, PREVIEW_MODULE_CATALOG, type ModuleModeDraft } from "@/lib/module-mode/builder";
import { moduleNativeCatalogDigest, parseModuleModeAvailability, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { createModuleNativeClient, ModuleNativeTransactionRevertedError, prepareModuleNativeLaunch, waitForModuleNativeReceipt, type ModuleNativeImageBinding, type ModuleNativeReceiptResult, type PreparedModuleNativeLaunch } from "@/lib/module-mode/native-client";
import { browserWalletRequestIsPending, subscribeToBrowserWalletRequest } from "@/lib/wallet-request-lock";
import { beginModuleModeOperation, clearModuleModeOperation, moduleModeOperationPath, rememberModuleModeTransactionHash, type ModuleModeOperation } from "@/lib/module-mode-operation-store";
import { moduleModeReleaseQuery, type ModuleModeLaunchVersion } from "@/lib/module-mode/release-selection";
import { fetchModuleModeOperationRelease, recoverModuleModeOperation } from "@/lib/module-mode-operation-recovery";

type LaunchFlow = {
  phase: "idle" | "uploading" | "preparing" | "signing" | "pending" | "mined" | "reverted" | "receipt-unavailable" | "error" | "uncertain";
  prepared?: PreparedModuleNativeLaunch;
  draft?: ModuleModeDraft;
  transactionHash?: Hex;
  receipt?: ModuleNativeReceiptResult;
  message?: string;
  operation?: ModuleModeOperation;
};

export function useModuleWalletRequestPending(account: string | undefined) {
  const subscribe = useCallback((listener: () => void) => subscribeToBrowserWalletRequest(account, "4663", listener), [account]);
  const snapshot = useCallback(() => browserWalletRequestIsPending(account, "4663"), [account]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

async function fetchAvailability(releaseDigest?: string, signal?: AbortSignal): Promise<ModuleModeAvailability> {
  const response = await fetch(`/api/module-mode${moduleModeReleaseQuery({ releaseDigest: releaseDigest as Hex | undefined })}`, { cache: "no-store", credentials: "same-origin", redirect: "error", signal });
  if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") {
    throw new Error("Wallet launch availability could not be checked. Your draft is kept.");
  }
  const availability = parseModuleModeAvailability(await response.json());
  if (releaseDigest && availability.release && availability.release.releaseDigest !== releaseDigest) throw new Error("The requested launch version could not be verified.");
  return availability;
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

export function ModuleModeLaunchHost({ releaseDigest, versions = [] }: { releaseDigest?: string; versions?: readonly ModuleModeLaunchVersion[] }) {
  const router = useRouter();
  const [changingVersion, startVersionChange] = useTransition();
  const requestedRelease = useRef(releaseDigest);
  requestedRelease.current = releaseDigest;
  const [loadedSelection, setLoadedSelection] = useState<string | null>(null);
  const { wallet, authenticated, sessionReady, authReady, connecting, openingWallet, switchingNetwork, disconnecting, openWallet, switchNetwork, getAccessToken, sendModuleModeTransaction } = useWallet();
  const client = useMemo(() => createModuleNativeClient(), []);
  const [availability, setAvailability] = useState<ModuleModeAvailability | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [flow, setFlow] = useState<LaunchFlow>({ phase: "idle" });
  const [receiptChecking, setReceiptChecking] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestPending = useModuleWalletRequestPending(wallet?.account);
  const saved = useModuleModeOperation(wallet?.account);
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
    void fetchAvailability(releaseDigest, controller.signal).then((next) => {
      if (!controller.signal.aborted) { setAvailability(next); setAvailabilityError(false); setAvailabilityLoading(false); setLoadedSelection(releaseDigest ?? "current"); }
    }).catch(() => {
      if (!controller.signal.aborted) { setAvailability(null); setAvailabilityError(true); setAvailabilityLoading(false); setLoadedSelection(releaseDigest ?? "current"); }
    });
    return () => controller.abort();
  }, [refreshKey, releaseDigest]);

  const selectionPending = loadedSelection !== (releaseDigest ?? "current") || changingVersion;
  const release = selectionPending ? null : availability?.release ?? null;
  const catalog = useMemo(() => availability ? release ? availability.catalog.filter((entry) => entry.status === "available") : availability.catalog : PREVIEW_MODULE_CATALOG, [availability, release]);
  const walletStep = moduleModeWalletStep({ account: wallet?.account, chainId: wallet?.chainId, authenticated, sessionReady });
  const walletAccount = wallet?.account;
  const configurationContext = useMemo(() => walletAccount ? { roles: { creator: walletAccount, launchWallet: walletAccount } } : {}, [walletAccount]);
  const working = ["uploading", "preparing", "signing"].includes(flow.phase);
  const hasSubmission = Boolean(flow.transactionHash && flow.phase !== "reverted") || flow.phase === "uncertain" || saved.blocked;
  const recoveryOperation = ["reverted", "error"].includes(flow.phase) ? saved.operation : flow.operation ?? saved.operation;

  async function observeReceipt(prepared: PreparedModuleNativeLaunch, transactionHash: Hex, record?: ModuleModeOperation) {
    setReceiptChecking(true);
    try {
      const receipt = await waitForModuleNativeReceipt({ client, prepared, transactionHash });
      if (record) await clearModuleModeOperation(record);
      if (mounted.current) setFlow((current) => current.transactionHash === transactionHash ? { ...current, phase: "mined", receipt, message: undefined } : current);
    } catch (error) {
      const reverted = error instanceof ModuleNativeTransactionRevertedError && error.transactionHash === transactionHash;
      if (reverted && record) { try { await clearModuleModeOperation(record); } catch { /* Keep the durable record until it can be checked again. */ } }
      if (mounted.current) setFlow((current) => current.transactionHash === transactionHash ? { ...current, phase: reverted ? "reverted" : "receipt-unavailable", message: reverted ? "The transaction reverted. No coin was created. Gas may still have been charged." : "Confirmation is taking longer than usual. View the transaction or check its confirmation again." } : current);
    } finally { if (mounted.current) setReceiptChecking(false); }
  }

  async function checkRecoveredReceipt(transactionHash: Hex) {
    const record = recoveryOperation;
    if (!record || record.sourceKind === "module-engine-v1" || record.kind !== "launch" || busy.current || receiptChecking) return;
    busy.current = true; setReceiptChecking(true);
    try {
      const originalRelease = await fetchModuleModeOperationRelease(record.releaseDigest);
      const receipt = await recoverModuleModeOperation({ client, operation: record, release: originalRelease, transactionHash });
      await clearModuleModeOperation(record);
      if (mounted.current) setFlow(current => ({ ...current, operation: record, phase: "mined", transactionHash, receipt, message: undefined }));
    } catch (error) {
      const reverted = error instanceof ModuleNativeTransactionRevertedError && error.transactionHash === transactionHash;
      if (reverted) { try { await clearModuleModeOperation(record); } catch { /* Retain the record if browser storage is unavailable. */ } }
      if (mounted.current) setFlow(current => ({ ...current, operation: record, phase: reverted ? "reverted" : record.transactionHash ? "receipt-unavailable" : "uncertain",
        ...(reverted ? { transactionHash } : {}), message: reverted ? "The transaction reverted. No coin was created. Gas may still have been charged." : conciseError(error) }));
    } finally { busy.current = false; if (mounted.current) setReceiptChecking(false); }
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
      if (!mounted.current || operation.current !== requestId || requestedRelease.current !== releaseDigest) throw new Error("The preparation was cancelled. Your draft is kept.");
      assertModuleModeWalletUnchanged(walletRef.current, account);
    };
    busy.current = true;
    let walletAttempted = false;
    let activePreparation: PreparedModuleNativeLaunch | undefined;
    let durableOperation: ModuleModeOperation | undefined;
    try {
      assertCurrentSession();
      setFlow({ phase: "preparing", draft });
      const current = await fetchAvailability(releaseDigest);
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
      const latest = await fetchAvailability(releaseDigest);
      assertCurrentSession();
      setAvailability(latest);
      assertDraftAvailability(draft, latest);
      if (latest.release?.releaseDigest !== prepared.releaseDigest) throw new Error("Launch availability changed. Try again to use the current version.");
      if (prepared.expiresAt <= BigInt(Math.floor(Date.now() / 1_000))) throw new Error("The quote expired. Try again for a fresh quote.");
      assertCurrentSession();
      durableOperation = await beginModuleModeOperation(prepared);
      assertCurrentSession();
      setFlow({ phase: "signing", prepared, draft, operation: durableOperation });
      walletAttempted = true;
      const transactionHash = await sendModuleModeTransaction(prepared);
      submitted.current = transactionHash;
      try { durableOperation = await rememberModuleModeTransactionHash(durableOperation, transactionHash); } catch { /* The original durable record still blocks a resend. */ }
      // A returned hash remains evidence even if the wallet changes while its dialog is open.
      if (mounted.current) {
        setFlow({ phase: "pending", prepared, draft, transactionHash, operation: durableOperation });
        void observeReceipt(prepared, transactionHash, durableOperation);
      }
    } catch (error) {
      const uncertain = moduleModeSubmissionIsUncertain(error, walletAttempted);
      if (!uncertain && durableOperation) { try { await clearModuleModeOperation(durableOperation); } catch { /* An unreadable record must continue to block new submissions. */ } }
      if (!mounted.current) return;
      if (uncertain) submitted.current = "uncertain";
      setFlow({ phase: uncertain ? "uncertain" : "error", draft, ...(uncertain && activePreparation ? { prepared: activePreparation } : {}), ...(durableOperation && uncertain ? { operation: durableOperation } : {}), message: uncertain ? "Check your wallet activity to see whether the transaction was sent. Your saved request will remain here after you reload." : isModuleModeWalletRejection(error) ? "Wallet request cancelled." : conciseError(error) });
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
    disabled: availabilityLoading || selectionPending || (walletStep !== "connect" && !authReady) || connecting || openingWallet || switchingNetwork || disconnecting || requestPending || hasSubmission,
    busy: working,
    lockDraft: working || requestPending || hasSubmission,
    onContinue: continueLaunch,
  } : undefined;

  function refreshAvailability() {
    setAvailabilityLoading(true); setAvailabilityError(false); setRefreshKey((key) => key + 1);
  }

  if (loadedSelection === null && !hasSubmission) return <ModuleBuilderLoading />;

  return <ModuleModeBuilder
    release={release}
    versionContent={versions.length > 1 ? <div className={styles.field}><label htmlFor="module-launch-version">Module version</label><select id="module-launch-version" value={releaseDigest ?? availability?.release?.releaseDigest ?? versions[0]?.releaseDigest} disabled={working || requestPending || hasSubmission || changingVersion} onChange={event => {
      const version = versions.find(candidate => candidate.releaseDigest === event.target.value);
      if (!version || working || requestPending || hasSubmission) return;
      operation.current += 1; setFlow({ phase: "idle" });
      startVersionChange(() => router.push(`/launch/modules${moduleModeReleaseQuery({ releaseDigest: version.releaseDigest, ...(version.sourceKind ? { sourceKind: version.sourceKind } : {}) })}`, { scroll: false }));
    }}>{releaseDigest && !versions.some(version => version.releaseDigest === releaseDigest) ? <option value={releaseDigest}>Selected version unavailable</option> : null}{versions.map(version => <option key={version.releaseDigest} value={version.releaseDigest}>{version.label}</option>)}</select><p className={styles.help}>Choose an earlier version to use its supported modules. Review its fees before launching.</p></div> : undefined}
    catalog={catalog}
    configurationContext={configurationContext}
    launchAction={launchAction}
    minimumInitialBuyWei={release?.minimumInitialBuyNative}
    previewDescription={availabilityError ? "Wallet launch availability could not be checked. You can keep configuring and export this draft; no token has been created." : "Wallet launching is not available yet. You can configure and export this draft; no token has been created."}
    onEdit={() => { if (hasSubmission) return; operation.current += 1; if (flow.phase === "reverted") submitted.current = null; setFlow({ phase: "idle" }); }}
    statusContent={availabilityLoading || selectionPending || availabilityError || (requestPending && !working && !hasSubmission) ? <div className={styles.launchAvailability}>
      <p role="status">{availabilityLoading || selectionPending ? "Loading…" : availabilityError ? "Launching is unavailable. Check again to continue." : "Finish the open wallet request to continue."}</p>
      {availabilityError && !hasSubmission ? <button className={styles.textButton} type="button" onClick={refreshAvailability}><RefreshCw size={14} aria-hidden="true" /> Check again</button> : null}
    </div> : undefined}
    reviewContent={<>
      {flow.message ? <p className={styles.launchError} role="alert">{flow.message}</p> : null}
      {flow.prepared && flow.draft && flow.phase === "signing" ? <LaunchTransactionDetails prepared={flow.prepared} draft={flow.draft} /> : null}
      {flow.phase === "reverted" && flow.transactionHash ? <a className={styles.transactionLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${flow.transactionHash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} aria-hidden="true" /></a> : null}
    </>}
    resultContent={hasSubmission && !working ? saved.error || (recoveryOperation && (recoveryOperation.sourceKind === "module-engine-v1" || recoveryOperation.kind !== "launch")) ? <div className={styles.launchResult}>
      <h2>Previous transaction needs confirmation</h2><p role="status">{saved.error ?? "Open your coin controls to check the previous transaction before launching another coin."}</p>
      {recoveryOperation ? <Link className={styles.secondaryButton} href={moduleModeOperationPath(recoveryOperation)}>Open transaction recovery</Link> : null}
    </div> : <ModuleModeLaunchResult
      phase={flow.phase === "mined" ? "mined" : flow.phase === "uncertain" || (!flow.transactionHash && recoveryOperation && !recoveryOperation.transactionHash) ? "uncertain" : flow.phase === "receipt-unavailable" || (recoveryOperation?.transactionHash && !flow.transactionHash) ? "receipt-unavailable" : "pending"}
      token={flow.receipt?.token}
      symbol={flow.draft?.token.symbol}
      transactionHash={flow.transactionHash ?? recoveryOperation?.transactionHash ?? undefined}
      message={flow.message}
      checking={receiptChecking}
      onCheck={flow.prepared && flow.transactionHash && flow.operation?.id === recoveryOperation?.id ? () => void observeReceipt(flow.prepared!, flow.transactionHash!, flow.operation) : recoveryOperation?.transactionHash ? () => void checkRecoveredReceipt(recoveryOperation.transactionHash!) : undefined}
      onRecover={recoveryOperation?.kind === "launch" && recoveryOperation.sourceKind !== "module-engine-v1" ? transactionHash => void checkRecoveredReceipt(transactionHash) : undefined}
    /> : undefined}
  />;
}

export function ModuleModeLaunchResult({ phase, token, symbol, transactionHash, message, checking = false, onCheck, onRecover }: {
  phase: "pending" | "mined" | "receipt-unavailable" | "uncertain";
  token?: Address;
  symbol?: string;
  transactionHash?: Hex;
  message?: string;
  checking?: boolean;
  onCheck?: () => void;
  onRecover?: (transactionHash: Hex) => void;
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
    <p role="status">{launched ? `${symbol ? `$${symbol} is on Robinhood. ` : ""}Explore updates after final confirmation.` : message ?? (phase === "uncertain" ? "Your previous wallet request is saved. Check its transaction hash in your wallet activity to continue." : "Your transaction was sent. You can return here to check its confirmation.")}</p>
    {launched && token ? <>
      <div className={styles.contractAddress}><label htmlFor="module-launched-address">Contract address</label><input ref={addressInput} id="module-launched-address" value={token} readOnly spellCheck={false} onFocus={(event) => event.currentTarget.select()} /></div>
      <div className={styles.resultLinks}><Link className={styles.primaryButton} href={`/token/${token}?chain=4663`}>View token <ArrowUpRight size={16} aria-hidden="true" /></Link><button className={styles.secondaryButton} type="button" onClick={() => void copyAddress()}><Copy size={16} aria-hidden="true" />{copyStatus === "Address copied" ? "Copied" : "Copy address"}</button></div>
      <p className={copyStatus === "Select and copy the address below." ? styles.help : styles.liveRegion} role="status">{copyStatus}</p>
    </> : null}
    {transactionHash ? <a className={styles.transactionLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${transactionHash}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={14} aria-hidden="true" /><span className={styles.liveRegion}> (opens in a new tab)</span></a> : null}
    {phase === "receipt-unavailable" && onCheck ? <button className={styles.textButton} disabled={checking} type="button" onClick={onCheck}><RefreshCw size={14} aria-hidden="true" />{checking ? "Checking…" : "Check confirmation"}</button> : null}
    {phase !== "mined" && onRecover ? <LaunchReceiptRecovery key={transactionHash ?? "unknown"} hash={transactionHash} checking={checking} onRecover={onRecover} /> : null}
  </div>;
}

export function LaunchReceiptRecovery({ hash, checking, onRecover }: { hash?: Hex; checking: boolean; onRecover: (transactionHash: Hex) => void }) {
  const [candidate, setCandidate] = useState(""); const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null); const id = useId();
  function check(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!/^0x[a-fA-F0-9]{64}$/.test(candidate)) { setError("Enter the transaction hash from your wallet activity."); input.current?.focus(); return; }
    onRecover(candidate as Hex);
  }
  return <details className={styles.transactionDetails} open={!hash}><summary>{hash ? "Check a replacement transaction" : "Find the wallet transaction"}</summary>
    <p className={styles.help}>Checking confirmation only reads Robinhood Chain. It never sends another transaction.</p>
    <form onSubmit={check}>
      <div className={styles.contractAddress}><label htmlFor={id}>Transaction hash from your wallet</label><input id={id} ref={input} value={candidate} onChange={event => setCandidate(event.target.value)} autoComplete="off" spellCheck={false} placeholder="0x…" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} /></div>
      {error ? <p className={styles.fieldError} id={`${id}-error`} role="alert">{error}</p> : null}
      <div className={styles.reviewActions}><button className={styles.secondaryButton} type="submit" disabled={checking}>{checking ? "Checking confirmation…" : "Check wallet transaction"}</button></div>
    </form>
  </details>;
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
