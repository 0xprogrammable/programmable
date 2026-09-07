"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { Address, Hex } from "viem";
import { ModuleEngineBuilder } from "@/components/module-engine-builder";
import { ModuleEngineConsole } from "@/components/module-engine-console";
import { ModuleEngineFeeChangeReceipt } from "@/components/module-engine-fee-controls";
import { LaunchReceiptRecovery, ModuleModeLaunchResult, useModuleWalletRequestPending } from "@/components/module-mode-launch-host";
import { assertModuleModeWalletUnchanged, submitModuleModeOperation, switchModuleModeNetwork, uploadModuleModeImage, useModuleModeOperation, type ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { useWallet } from "@/components/wallet-provider";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { assertModuleEngineOperationAvailability, fetchModuleEngineAvailability } from "@/lib/module-engine/availability-client";
import { MODULE_ENGINE_AVAILABILITY_SCHEMA, type ModuleEngineAvailability, type ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { createModuleEngineClient, ModuleEngineTransactionRevertedError, observeModuleEngineReceipt, readModuleEngineLaunch, type ModuleEngineReceiptResult, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import type { ModuleModeImage } from "@/lib/module-mode/builder";
import { moduleModeReleaseQuery, type ModuleModeLaunchVersion } from "@/lib/module-mode/release-selection";
import { clearModuleModeOperation, moduleModeOperationPath, type ModuleModeOperation } from "@/lib/module-mode-operation-store";
import { fetchModuleEngineOperationRelease, recoverModuleEngineOperation } from "@/lib/module-mode-operation-recovery";
import styles from "@/components/module-mode-builder.module.css";
import engineStyles from "@/components/module-engine-ui.module.css";

type Flow = {
  phase: "idle" | "checking" | "signing" | "pending" | "mined" | "receipt-unavailable" | "reverted" | "error";
  account?: string;
  operation?: ModuleModeOperation;
  transactionHash?: Hex;
  receipt?: ModuleEngineReceiptResult;
  recovered?: boolean;
  message?: string;
};
const empty: ModuleEngineAvailability = { schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA, release: null, templates: [], reason: null };
function errorMessage(error: unknown) {
  const candidate = error as { shortMessage?: unknown; message?: unknown } | null;
  const message = typeof candidate?.shortMessage === "string" ? candidate.shortMessage : typeof candidate?.message === "string" ? candidate.message : "The request could not be completed. Try again.";
  return message.length < 420 ? message.replace(/^Module engine: /u, "") : "The request could not be completed. Try again.";
}

/** Shared wallet, source authority and durable operation recovery for each reviewed template. */
export function ModuleEngineHost({ releaseDigest, token, versions = [] }: { releaseDigest?: Hex; token?: Address; versions?: readonly ModuleModeLaunchVersion[] }) {
  const router = useRouter();
  const [changingVersion, startVersionChange] = useTransition();
  const { wallet, authenticated, sessionReady, authReady, connecting, openingWallet, switchingNetwork, disconnecting, openWallet, switchNetwork, getAccessToken, sendModuleModeTransaction } = useWallet();
  const walletSnapshot: ModuleModeWalletSnapshot = { account: wallet?.account, chainId: wallet?.chainId, authenticated, sessionReady };
  const walletRef = useRef(walletSnapshot);
  useEffect(() => { walletRef.current = walletSnapshot; });
  const client = useMemo(() => createModuleEngineClient(), []);
  const saved = useModuleModeOperation(wallet?.account);
  const requestPending = useModuleWalletRequestPending(wallet?.account);
  const [availability, setAvailability] = useState<ModuleEngineAvailability>(empty);
  const [management, setManagement] = useState<{ token: Address; digest: Hex; template: ModuleEngineTemplate } | null>(null);
  const [loadedSelection, setLoadedSelection] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [storedFlow, setFlow] = useState<Flow>({ phase: "idle" });
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const busy = useRef(false), mounted = useRef(true), generation = useRef(0);
  const selection = `${releaseDigest ?? "current"}:${token ?? "launch"}`;
  const requestedSelection = useRef(selection);
  useEffect(() => { requestedSelection.current = selection; generation.current += 1; }, [selection]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const current = await fetchModuleEngineAvailability(releaseDigest, controller.signal);
        let bound: typeof management = null;
        if (token && current.release) {
          const launch = await readModuleEngineLaunch({ client, release: current.release, token });
          const template = current.templates.find(item => item.manifest.manifest.revision.packageId === launch.revisionId);
          if (!template) throw new Error("The template bound to this coin is temporarily unavailable. Check again later.");
          bound = { token, digest: current.release.releaseDigest, template };
        }
        if (controller.signal.aborted) return;
        setAvailability(current); setManagement(bound); setLoadError(null); setLoadedSelection(selection);
      } catch (error) {
        if (controller.signal.aborted) return;
        // Keep an already-mounted draft and its last displayed metadata; submission stays disabled.
        setLoadError(errorMessage(error)); setLoadedSelection(selection);
      }
    })();
    return () => controller.abort();
  }, [client, releaseDigest, token, selection, refreshKey]);

  const loading = loadedSelection !== selection || changingVersion;
  const release = availability.release;
  const boundManagement = !loading && management !== null && management.token === token && management.digest === release?.releaseDigest ? management : null;
  const flow: Flow = storedFlow.account?.toLowerCase() === wallet?.account?.toLowerCase()
    && (!saved.operation || !storedFlow.operation || saved.operation.id === storedFlow.operation.id) ? storedFlow : { phase: "idle" };
  // A newer durable record, including one from another tab, always owns recovery for this account.
  const recovery = saved.operation ?? flow.operation;
  const unresolved = saved.blocked || ["signing", "pending", "receipt-unavailable"].includes(flow.phase);
  const working = ["checking", "signing", "pending"].includes(flow.phase) || checkingReceipt;
  const blocked = loading || Boolean(loadError) || !release || working || unresolved || requestPending
    || connecting || openingWallet || switchingNetwork || disconnecting || (Boolean(wallet?.account) && !authReady);
  const blockedReason = loadError ?? (loading ? "Checking this template version…" : saved.error ?? (unresolved ? "Resolve the saved transaction below before sending another request." : working ? "Checking your transaction…" : requestPending ? "Complete the open wallet request before continuing." : undefined));

  async function submit(prepared: PreparedModuleEngineTransaction): Promise<ModuleEngineReceiptResult> {
    if (busy.current || blocked) throw new Error(blockedReason ?? "This request is not available yet.");
    if (token ? prepared.kind === "launch" || (prepared.kind !== "approve" && prepared.token.toLowerCase() !== token.toLowerCase()) : prepared.kind !== "launch" && prepared.kind !== "approve") {
      throw new Error("The prepared transaction belongs to different coin controls.");
    }
    const currentGeneration = ++generation.current;
    const assertSession = () => {
      if (!mounted.current || currentGeneration !== generation.current || requestedSelection.current !== selection) throw new Error("The selected version changed. Review the transaction again.");
      assertModuleModeWalletUnchanged(walletRef.current, prepared.account);
    };
    busy.current = true;
    let submission: Awaited<ReturnType<typeof submitModuleModeOperation>> | undefined;
    try {
      assertSession(); setFlow({ phase: "checking", account: prepared.account });
      const current = await fetchModuleEngineAvailability(prepared.releaseDigest);
      assertSession(); assertModuleEngineOperationAvailability(prepared, availability, current);
      if (prepared.expiresAt <= BigInt(Math.floor(Date.now() / 1_000))) throw new Error("The quote expired. Review again for a fresh transaction.");
      setFlow({ phase: "signing", account: prepared.account });
      submission = await submitModuleModeOperation(prepared, value => {
        try { assertSession(); }
        catch (error) { throw Object.assign(new Error(errorMessage(error)), { walletRequestAttempted: false }); }
        return sendModuleModeTransaction(value);
      });
      // A returned hash is retained even if the wallet changes while its dialog is open.
      if (mounted.current) setFlow({ phase: "pending", account: prepared.account, ...submission });
      const receipt = await observeModuleEngineReceipt(prepared, submission.transactionHash);
      await clearModuleModeOperation(submission.operation);
      if (mounted.current) setFlow({ phase: "mined", account: prepared.account, ...submission, receipt });
      return receipt;
    } catch (error) {
      const reverted = Boolean(submission && error instanceof ModuleEngineTransactionRevertedError && error.transactionHash === submission.transactionHash);
      if (reverted && submission) { try { await clearModuleModeOperation(submission.operation); } catch { /* Keep protection when durable storage cannot be updated. */ } }
      if (mounted.current) setFlow({ phase: reverted ? "reverted" : submission ? "receipt-unavailable" : "error", account: prepared.account, ...submission,
        message: reverted ? "The transaction reverted. Your funds were not transferred by this operation. Network gas may still have been charged." : submission ? "Confirmation is taking longer than usual. Check the saved transaction below." : errorMessage(error) });
      throw error;
    } finally { busy.current = false; }
  }

  async function recover(hash: Hex) {
    const record = recovery;
    if (!record || record.sourceKind !== "module-engine-v1" || busy.current || checkingReceipt) return;
    busy.current = true; setCheckingReceipt(true);
    try {
      const original = await fetchModuleEngineOperationRelease(record.releaseDigest);
      const receipt = await recoverModuleEngineOperation({ client, operation: record, release: original, transactionHash: hash });
      await clearModuleModeOperation(record);
      if (mounted.current) setFlow({ phase: "mined", account: record.account, operation: record, transactionHash: hash, receipt, recovered: true });
    } catch (error) {
      const reverted = error instanceof ModuleEngineTransactionRevertedError && error.transactionHash === hash;
      if (reverted) { try { await clearModuleModeOperation(record); } catch { /* A remaining record can be verified again. */ } }
      if (mounted.current) setFlow({ phase: reverted ? "reverted" : "receipt-unavailable", account: record.account, operation: record,
        ...(reverted ? { transactionHash: hash } : record.transactionHash ? { transactionHash: record.transactionHash } : {}),
        message: reverted ? "The transaction reverted. Network gas may still have been charged." : errorMessage(error) });
    } finally { busy.current = false; if (mounted.current) setCheckingReceipt(false); }
  }

  async function uploadImage(image: Extract<ModuleModeImage, { kind: "local" }>, blob: Blob): Promise<string> {
    const account = walletRef.current.account;
    if (!account || blocked || busy.current) throw new Error("Connect your wallet and resolve any pending request before uploading.");
    const currentGeneration = generation.current;
    const assertSession = () => {
      if (!mounted.current || generation.current !== currentGeneration || requestedSelection.current !== selection) throw new Error("The image preparation was cancelled. Choose the image again.");
      assertModuleModeWalletUnchanged(walletRef.current, account);
    };
    const binding = await uploadModuleModeImage({ image, blob, getAccessToken, assertCurrentSession: assertSession });
    assertSession(); return binding.uri;
  }

  const versionContent = versions.length > 1 ? <div className={styles.field}><label htmlFor="engine-launch-version">Module version</label>
    <select id="engine-launch-version" value={releaseDigest ?? release?.releaseDigest ?? ""} disabled={working || unresolved || requestPending || changingVersion} onChange={event => {
      const version = versions.find(candidate => candidate.releaseDigest === event.target.value);
      if (!version || busy.current || unresolved || requestPending) return;
      generation.current += 1; setFlow({ phase: "idle" });
      startVersionChange(() => router.push(`/launch/modules${moduleModeReleaseQuery({ releaseDigest: version.releaseDigest, ...(version.sourceKind ? { sourceKind: version.sourceKind } : {}) })}`, { scroll: false }));
    }}>{!versions.some(version => version.releaseDigest === (releaseDigest ?? release?.releaseDigest)) ? <option value={releaseDigest ?? release?.releaseDigest ?? ""}>Selected version unavailable</option> : null}
      {versions.map(version => <option key={`${version.sourceKind ?? "native"}:${version.releaseDigest}`} value={version.releaseDigest}>{version.label}</option>)}
    </select><p className={styles.help}>Each version keeps its published templates and fee rules.</p></div> : undefined;
  const statusContent = <>
    {loading ? <p role="status">Checking this template version…</p> : null}
    {loadError || (!loading && !release) ? <div className={engineStyles.notice} role="status"><p>{loadError ?? availability.reason ?? "This template version is temporarily unavailable."}</p>
      <button className={styles.secondaryButton} type="button" disabled={working} onClick={() => setRefreshKey(value => value + 1)}>Check availability again</button>{" "}<Link href="/launch/modules">Create a coin with another version</Link></div> : null}
    {saved.error ? <p className={styles.fieldError} role="alert">{saved.error}</p> : null}
    {recovery && unresolved ? recovery.sourceKind !== "module-engine-v1" ? <div className={engineStyles.notice}><p>A saved transaction is waiting in another coin version.</p><Link className={styles.secondaryButton} href={moduleModeOperationPath(recovery)}>Open saved transaction</Link></div>
      : <section className={engineStyles.notice} aria-labelledby="engine-saved-request"><h2 id="engine-saved-request">{flow.phase === "signing" ? "Confirm in your wallet" : "Check your saved transaction"}</h2>
        <p role="status">{flow.message ?? "This request stays saved after a reload. Checking it never sends another transaction."}</p>
        <p className={styles.help}>Version {recovery.releaseDigest.slice(2, 10)} · Wallet {recovery.account}</p>
        {(flow.transactionHash ?? recovery.transactionHash) ? <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${flow.transactionHash ?? recovery.transactionHash}`} target="_blank" rel="noreferrer">View transaction<span className={styles.liveRegion}> (opens in a new tab)</span></a> : null}
        <LaunchReceiptRecovery key={flow.transactionHash ?? recovery.transactionHash ?? recovery.id} hash={flow.transactionHash ?? recovery.transactionHash ?? undefined} checking={working} onRecover={hash => void recover(hash)} />
        {(flow.transactionHash ?? recovery.transactionHash) ? <button className={styles.secondaryButton} type="button" disabled={working} onClick={() => void recover((flow.transactionHash ?? recovery.transactionHash) as Hex)}>{checkingReceipt ? "Checking confirmation…" : "Check confirmation"}</button> : null}
      </section> : flow.phase !== "idle" ? <div className={engineStyles.notice} role={flow.phase === "error" || flow.phase === "reverted" ? "alert" : "status"}>
        <p>{flow.message ?? (flow.phase === "mined" ? "Transaction confirmed on Robinhood. Finality and public indexing are still pending." : flow.phase === "signing" ? "Confirm this transaction in your wallet." : "Checking your transaction…")}</p>
        {flow.recovered && flow.receipt ? <ModuleEngineFeeChangeReceipt result={flow.receipt} /> : null}
        {flow.transactionHash ? <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${flow.transactionHash}`} target="_blank" rel="noreferrer">View transaction<span className={styles.liveRegion}> (opens in a new tab)</span></a> : null}
      </div> : null}
  </>;
  const actions = { wallet: walletSnapshot, onConnect: openWallet, onSwitch: () => switchModuleModeNetwork(switchNetwork), onSubmit: submit, blocked, blockedReason };
  if (!saved.blocked && flow.receipt?.kind === "launch" && flow.phase === "mined" && flow.receipt.token) return <section className={styles.page}>
    <ModuleModeLaunchResult phase="mined" token={flow.receipt.token} transactionHash={flow.receipt.transactionHash} />
    <Link className={styles.secondaryButton} href={`/launch/modules/manage/${flow.receipt.token}${moduleModeReleaseQuery({ sourceKind: "module-engine-v1", releaseDigest: flow.operation?.releaseDigest ?? release?.releaseDigest })}`}>Open coin controls</Link>
  </section>;
  if (token) return release && boundManagement ? <ModuleEngineConsole {...actions} token={token} release={release} template={boundManagement.template} client={client} statusContent={statusContent} />
    : <section className={styles.page}><header className={styles.heading}><h1>Coin controls</h1><p>Load the version bound to this coin to read its available actions.</p></header>{statusContent}</section>;
  return <ModuleEngineBuilder {...actions} availability={availability} client={client} statusContent={statusContent} versionContent={versionContent} onUploadImage={uploadImage} />;
}
