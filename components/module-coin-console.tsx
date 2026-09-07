"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { moduleModeSubmissionIsUncertain, switchModuleModeNetwork, useModuleModeOperation } from "@/components/module-mode-wallet-state";
import { ModuleSchemaField } from "@/components/module-mode-fields";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { configurationFromForm, defaultSchemaValue, parseExactUnits, type FormValue } from "@/lib/module-mode/builder";
import { createModuleNativeClient, ModuleNativeTransactionRevertedError, prepareModuleNativeManagementTransaction, waitForModuleNativeReceipt, type PreparedModuleNativeManagement, type ModuleNativeReceiptResult } from "@/lib/module-mode/native-client";
import { ModuleNativeAuthorWalletControls, ModuleNativeAuthorWalletReview, ModuleNativeAuthorWalletResult } from "./module-native-author-wallet";
import { parseModuleModeAvailability, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { moduleHash } from "@/lib/module-mode/release";
import { managementActionProblem, moduleManagementChainMatches, readModuleManagementSnapshot,
  type ManagementValue, type ModuleManagedInstance, type ModuleManagementIntent, type ModuleManagementSnapshot } from "@/lib/module-mode/management";
import type { ManagementAction, ManagementRead } from "@/lib/module-mode/management-manifest";
import { beginModuleModeOperation, clearModuleModeOperation, moduleModeOperationPath, moduleModeOperationSnapshot, parseModuleModeOperation, rememberModuleModeTransactionHash, type ModuleModeOperation } from "@/lib/module-mode-operation-store";
import { fetchModuleModeOperationRelease, recoverModuleModeOperation } from "@/lib/module-mode-operation-recovery";
import styles from "./module-coin-console.module.css";

type Phase = "idle" | "preparing" | "review" | "wallet" | "pending" | "unconfirmed" | "checking" | "mined" | "reverted";
type Prepare = (intent: ModuleManagementIntent) => void;
type ConsolePrepared = PreparedModuleNativeManagement;
const native = (value: bigint | null) => value === null ? "—" : formatUnits(value, 18);
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
function errorMessage(error: unknown) {
  const message = error && typeof error === "object" && "shortMessage" in error ? error.shortMessage : error instanceof Error ? error.message : "The request could not be completed. Refresh and try again.";
  return String(message).slice(0, 600);
}
function timestamp(value: bigint) {
  if (value > 8_640_000_000_000n || value < -8_640_000_000_000n) return `${value.toString()} Unix seconds`;
  return new Date(Number(value) * 1000).toISOString().replace("T", " ").replace(/:\d{2}\.\d{3}Z$/u, " UTC");
}
function displayValue(read: ManagementRead, value: ManagementValue | undefined) {
  if (value === null) return "Connect your wallet";
  if (value === undefined) return "Unavailable";
  if (read.display === "native" && typeof value === "bigint") return `${native(value)} ETH`;
  if (read.display === "timestamp" && typeof value === "bigint") return timestamp(value);
  if (read.display === "boolean" && typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function ModuleCoinConsole({ token, releaseDigest }: { token: Address; releaseDigest?: string }) {
  const wallet = useWallet();
  // A different wallet or coin owns an independent view; old asynchronous work cannot replace its state.
  return <ModuleCoinConsoleAccount key={`${wallet.wallet?.account.toLowerCase() ?? "disconnected"}:${token.toLowerCase()}:${releaseDigest?.toLowerCase() ?? "current"}`} token={token} releaseDigest={releaseDigest} wallet={wallet} />;
}

function ModuleCoinConsoleAccount({ token, releaseDigest, wallet }: { token: Address; releaseDigest?: string; wallet: ReturnType<typeof useWallet> }) {
  const [client] = useState(createModuleNativeClient);
  const [availability, setAvailability] = useState<ModuleModeAvailability | null>(null);
  const [snapshot, setSnapshot] = useState<ModuleManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<ConsolePrepared | null>(null);
  const [hash, setHash] = useState<Hex | null>(null);
  const [authorReceipt, setAuthorReceipt] = useState<ModuleNativeReceiptResult["authorWalletChange"]>();
  const [flowOperationId, setFlowOperationId] = useState<Hex | null>(null);
  const mounted = useRef(true);
  const reviewTrigger = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const operation = useRef<{ recordId: Hex | null } | null>(null);
  const account = wallet.wallet?.account ?? null;
  const saved = useModuleModeOperation(account ?? undefined);
  const activeOperation = useRef<ModuleModeOperation | null>(null);
  const actor = account?.toLowerCase() as Address | undefined;
  const walletReady = !!account && wallet.authenticated && wallet.sessionReady;
  const onChain = moduleManagementChainMatches(wallet.wallet?.chainId);
  const preparedMatchesCoin = prepared?.token.toLowerCase() === token.toLowerCase()
    && prepared?.account.toLowerCase() === actor
    && (releaseDigest === undefined || prepared?.releaseDigest.toLowerCase() === releaseDigest.toLowerCase());

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  const currentRecord = () => {
    const raw = moduleModeOperationSnapshot(account ?? undefined);
    if (raw !== null && account) return parseModuleModeOperation(raw, account);
    return activeOperation.current?.account.toLowerCase() === actor ? activeOperation.current : null;
  };
  const ownsFlow = (record: ModuleModeOperation) => {
    if (!mounted.current || record.account.toLowerCase() !== actor) return false;
    try { return currentRecord()?.id === record.id; } catch { return false; }
  };

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const current = ++generation.current;
    const currentRead = () => mounted.current && current === generation.current;
    try {
      const expectedDigest = releaseDigest === undefined ? undefined : moduleHash(releaseDigest, "moduleManagement.releaseDigest");
      const response = await fetch(`/api/module-mode${expectedDigest ? `?releaseDigest=${expectedDigest}` : ""}`, { cache: "no-store", credentials: "same-origin", redirect: "error" });
      if (!response.ok || response.redirected || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") throw new Error("Module management could not be loaded. Try refreshing.");
      const next = parseModuleModeAvailability(await response.json());
      if (expectedDigest && next.release?.releaseDigest.toLowerCase() !== expectedDigest) throw new Error("This coin’s original module version could not be verified. Refresh to check again.");
      if (!currentRead()) return;
      setAvailability(next); setError("");
      if (!next.release) { setSnapshot(null); return; }
      const state = await readModuleManagementSnapshot({ client, release: next.release, catalog: next.catalog, token, actor });
      if (currentRead()) setSnapshot(state);
    } catch (caught) {
      if (currentRead()) { setAvailability(null); setSnapshot(null); setError(errorMessage(caught)); }
    } finally { if (currentRead()) setLoading(false); }
  }, [client, token, actor, releaseDigest]);
  useEffect(() => {
    // Schedule the initial subscription read so a replaced wallet/route can cancel before it starts.
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [refresh]);

  const prepare = async (intent: ModuleManagementIntent) => {
    if (operation.current || saved.blocked || ["wallet", "pending", "unconfirmed", "checking"].includes(phase)) return;
    if (!walletReady || !onChain || !account || !availability?.release) { setError("Connect your wallet on Robinhood Chain before reviewing an action."); return; }
    reviewTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const work = { recordId: null }; operation.current = work;
    setError(""); setPrepared(null); setHash(null); setAuthorReceipt(undefined); setFlowOperationId(null); setPhase("preparing");
    try {
      const block = await client.getBlock({ blockTag: "latest" });
      if (!mounted.current) return;
      const result = await prepareModuleNativeManagementTransaction({ client, release: availability.release, catalog: availability.catalog,
        token, actor: account, intent, deadline: block.timestamp + 300n });
      if (mounted.current && operation.current === work) { setPrepared(result); setPhase("review"); }
    } catch (caught) { if (mounted.current && operation.current === work) { setError(errorMessage(caught)); setPhase("idle"); } }
    finally { if (operation.current === work) operation.current = null; }
  };
  const confirm = async () => {
    if (!prepared || !preparedMatchesCoin || phase !== "review" || operation.current || saved.blocked) return;
    const work: { recordId: Hex | null } = { recordId: null }; operation.current = work;
    setError(""); setPhase("wallet");
    let submittedHash: Hex | null = null;
    let durableOperation: ModuleModeOperation | null = null;
    let providerCalled = false;
    try {
      durableOperation = await beginModuleModeOperation(prepared);
      work.recordId = durableOperation.id;
      activeOperation.current = durableOperation;
      if (!ownsFlow(durableOperation)) { await clearModuleModeOperation(durableOperation); return; }
      setFlowOperationId(durableOperation.id);
      // The provider revalidates the branded operation and owns the shared wallet request lock.
      providerCalled = true;
      const sentHash: Hex = await wallet.sendModuleModeTransaction(prepared);
      submittedHash = sentHash;
      if (ownsFlow(durableOperation)) { setHash(sentHash); setPhase("pending"); }
      try { durableOperation = await rememberModuleModeTransactionHash(durableOperation, sentHash); activeOperation.current = durableOperation; } catch { /* The original durable record still prevents a resend. */ }
      const result = await waitForModuleNativeReceipt({ client, prepared, transactionHash: sentHash });
      await clearModuleModeOperation(durableOperation);
      const current = ownsFlow(durableOperation);
      if (activeOperation.current?.id === durableOperation.id) activeOperation.current = null;
      if (current) { setAuthorReceipt(result.authorWalletChange); setPhase("mined"); setPrepared(null); setLoading(true); await refresh(); }
    } catch (caught) {
      const current = mounted.current && (!durableOperation || ownsFlow(durableOperation));
      if (current) setError(errorMessage(caught));
      // Uncertain wallet/RPC responses retain the prepared request only for receipt verification.
      if (caught instanceof ModuleNativeTransactionRevertedError && caught.transactionHash === submittedHash) {
        if (durableOperation) { try { await clearModuleModeOperation(durableOperation); if (activeOperation.current?.id === durableOperation.id) activeOperation.current = null; } catch { /* Retain the record until storage is available. */ } }
        if (current) { setPhase("reverted"); setPrepared(null); }
      }
      else if (submittedHash) { if (current) setPhase("pending"); }
      else if (moduleModeSubmissionIsUncertain(caught, providerCalled)) { if (current) setPhase("unconfirmed"); }
      else {
        if (durableOperation) { try { await clearModuleModeOperation(durableOperation); if (activeOperation.current?.id === durableOperation.id) activeOperation.current = null; } catch { /* Failed cleanup must continue to block another send. */ } }
        if (current) { setPhase("idle"); setPrepared(null); }
      }
    } finally { if (operation.current === work) operation.current = null; }
  };
  const checkReceipt = async (transactionHash: Hex) => {
    let record: ModuleModeOperation | null;
    try { record = currentRecord(); } catch (caught) { setError(errorMessage(caught)); return; }
    if (!record || record.sourceKind === "module-engine-v1" || record.account.toLowerCase() !== actor || record.kind !== "manage" || record.token.toLowerCase() !== token.toLowerCase() || operation.current?.recordId === record.id) return;
    const preparedForRecord = prepared && preparedMatchesCoin && flowOperationId === record.id && activeOperation.current?.id === record.id ? prepared : null;
    const work = { recordId: record.id }; operation.current = work; activeOperation.current = record;
    if (!preparedForRecord) setPrepared(null);
    setError(""); setPhase("checking"); setFlowOperationId(record.id);
    try {
      let result: ModuleNativeReceiptResult;
      if (preparedForRecord) result = await waitForModuleNativeReceipt({ client, prepared: preparedForRecord, transactionHash });
      else {
        const originalRelease = await fetchModuleModeOperationRelease(record.releaseDigest);
        result = await recoverModuleModeOperation({ client, operation: record, release: originalRelease, transactionHash });
      }
      await clearModuleModeOperation(record);
      const current = mounted.current && (!currentRecord() || ownsFlow(record));
      if (activeOperation.current?.id === record.id) activeOperation.current = null;
      if (current) { setAuthorReceipt(result.authorWalletChange); setHash(transactionHash); setPhase("mined"); setPrepared(null); setLoading(true); await refresh(); }
    } catch (caught) {
      const current = ownsFlow(record);
      if (current) setError(errorMessage(caught));
      if (caught instanceof ModuleNativeTransactionRevertedError && caught.transactionHash === transactionHash) {
        try { await clearModuleModeOperation(record); if (activeOperation.current?.id === record.id) activeOperation.current = null; } catch { /* Keep the record available for another read. */ }
        if (current) { setHash(transactionHash); setPhase("reverted"); setPrepared(null); }
      } else if (current) setPhase(hash || record.transactionHash ? "pending" : "unconfirmed");
    } finally { if (operation.current === work) operation.current = null; }
  };
  const currentSnapshot = snapshot && snapshot.actor === (actor ?? null) ? snapshot : null;
  const recoveryHere = saved.operation?.sourceKind !== "module-engine-v1" && saved.operation?.account.toLowerCase() === actor && saved.operation?.kind === "manage" && saved.operation.token.toLowerCase() === token.toLowerCase();
  const currentFlow = !saved.operation || saved.operation.id === flowOperationId;
  const displayPhase = saved.blocked && (!currentFlow || !["preparing", "wallet", "checking", "pending", "unconfirmed"].includes(phase)) ? "unconfirmed" : phase;
  return <ModuleCoinConsoleView token={token} snapshot={currentSnapshot} loading={loading}
    unavailable={!loading && !error && availability?.release === null} walletReady={walletReady} onChain={onChain}
    phase={displayPhase} prepared={preparedMatchesCoin && currentFlow ? prepared : null} hash={recoveryHere ? saved.operation?.transactionHash ?? (currentFlow ? hash : null) : currentFlow && !saved.blocked ? hash : null} error={saved.error || (currentFlow ? error : "")}
    recoveryOperation={saved.operation && !recoveryHere ? saved.operation : undefined} recoveryBlocked={saved.blocked}
    recoveryOperationId={saved.operation?.id ?? flowOperationId ?? undefined}
    authorReceipt={currentFlow && !saved.blocked ? authorReceipt : undefined}
    authorControlsContent={currentSnapshot && availability?.release ? <ModuleNativeAuthorWalletControls key={`${availability.release.releaseDigest}:${currentSnapshot.blockHash}:${actor}`} client={client} release={availability.release} catalog={availability.catalog} token={token} actor={actor ?? null}
      disabled={saved.blocked || loading || !walletReady || !onChain || !["idle", "mined", "reverted"].includes(displayPhase)} onPrepare={intent => { void prepare(intent); }} /> : undefined}
    onPrepare={intent => { void prepare(intent); }} onConfirm={() => { void confirm(); }}
    onCheckReceipt={transactionHash => { void checkReceipt(transactionHash); }}
    onCancel={() => { if (phase === "review") { setPrepared(null); setPhase("idle"); window.setTimeout(() => reviewTrigger.current?.focus(), 0); } }} onRefresh={() => { setLoading(true); void refresh(); }}
    onWallet={wallet.openWallet} onSwitch={() => { setError(""); void switchModuleModeNetwork(wallet.switchNetwork).catch(caught => setError(errorMessage(caught))); }} />;
}

export interface ModuleCoinConsoleViewProps {
  token: Address; snapshot: ModuleManagementSnapshot | null; loading: boolean; unavailable: boolean;
  walletReady: boolean; onChain: boolean; phase: Phase; prepared: ConsolePrepared | null;
  hash: Hex | null; error: string;
  onPrepare: Prepare; onConfirm: () => void; onCancel: () => void; onRefresh: () => void;
  onCheckReceipt: (transactionHash: Hex) => void;
  onWallet: () => void; onSwitch: () => void;
  recoveryOperation?: ModuleModeOperation;
  recoveryBlocked?: boolean;
  recoveryOperationId?: Hex;
  authorControlsContent?: ReactNode;
  authorReceipt?: ModuleNativeReceiptResult["authorWalletChange"];
}

/** Separate presentation lets browser QA supply clearly labelled fixtures without a production bypass. */
export function ModuleCoinConsoleView(props: ModuleCoinConsoleViewProps) {
  const { snapshot, loading, phase, prepared } = props;
  const busy = props.recoveryBlocked || ["preparing", "wallet", "pending", "unconfirmed", "checking"].includes(phase);
  const disabled = busy || loading || !props.walletReady || !props.onChain || phase === "review";
  return <section className={styles.console} aria-labelledby="module-coin-console-title">
    <div className={styles.topline}>
      <Link href="/launch/modules" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Module Mode</Link>
      <button type="button" className={styles.quietButton} onClick={props.onRefresh} disabled={loading || phase === "wallet"}><RefreshCw size={16} aria-hidden="true" />{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    <header className={styles.heading}>
      <span className={styles.eyebrow}>Coin controls · Robinhood Chain</span>
      <h1 id="module-coin-console-title">{snapshot ? `Manage ${snapshot.name}` : "Manage your coin"}</h1>
      <p>Fund your modules, claim ETH and manage fee recipients.</p>
      <a className={styles.tokenLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/token/${props.token}`} target="_blank" rel="noreferrer">{snapshot?.symbol ? `${snapshot.symbol} · ` : ""}{shortAddress(props.token)}<ArrowUpRight size={14} aria-hidden="true" /></a>
    </header>

    {!props.walletReady ? <div className={styles.walletBar}><p>Connect your wallet to see your claims and available actions.</p><button className={styles.primaryButton} type="button" onClick={props.onWallet}>Connect wallet</button></div>
      : !props.onChain ? <div className={styles.walletBar}><p>Switch to Robinhood Chain to manage this coin.</p><button className={styles.primaryButton} type="button" onClick={props.onSwitch}>Switch network</button></div> : null}
    <div className={styles.liveRegion} role="status" aria-live="polite">{loading ? "Loading verified coin state." : phase === "preparing" ? "Checking the action and current wallet permissions." : phase === "wallet" ? "Confirm the transaction in your wallet." : phase === "pending" || phase === "unconfirmed" ? "Transaction confirmation has not been verified." : phase === "checking" ? "Checking the transaction confirmation." : phase === "mined" ? "Transaction mined." : phase === "reverted" ? "The transaction reverted. Its changes were not applied." : ""}</div>
    {props.error ? <div className={styles.error} role="alert">{props.error}</div> : null}
    {props.unavailable ? <section className={styles.empty}><h2>Module management is not available yet</h2><p>Controls will become available when the Module Mode release is ready. Refresh to check again.</p><Link href="/docs/developers/module-mode" className={styles.textLink}>Read the Module Mode guide</Link></section> : null}
    {loading && !snapshot ? <section className={styles.empty} aria-busy="true"><h2>Loading coin controls</h2><p>Checking this coin and your available balances.</p></section> : null}

    {prepared && phase === "review" && !props.recoveryBlocked ? <PreparedReview prepared={prepared} onConfirm={props.onConfirm} onCancel={props.onCancel} /> : null}
    {props.authorReceipt && phase === "mined" && !prepared ? <ModuleNativeAuthorWalletResult result={props.authorReceipt} /> : null}
    {props.recoveryOperation ? <section className={styles.receipt} aria-label="Previous transaction"><strong>Previous transaction needs confirmation</strong><p>Check the previous transaction before starting another action.</p><Link className={styles.secondaryButton} href={moduleModeOperationPath(props.recoveryOperation)}>Open transaction recovery</Link></section>
      : props.hash || phase === "unconfirmed" ? <ReceiptStatus key={`${props.recoveryOperationId ?? "local"}:${props.hash ?? "unknown"}:${phase === "mined"}`} phase={phase} hash={props.hash} onCheckReceipt={props.onCheckReceipt} /> : null}

    {snapshot ? <div className={styles.layout}>
      <section className={styles.modules} aria-labelledby="coin-modules-heading">
        <div className={styles.sectionHeading}><h2 id="coin-modules-heading">Your modules</h2><span>{snapshot.instances.length}</span></div>
        {snapshot.instances.length === 0 ? <div className={styles.plain}><h3>Plain coin</h3><p>This coin has no extra modules. Your creator fee controls are available below.</p></div> : snapshot.instances.map(instance => <InstancePanel key={`${instance.instanceId}:${snapshot.actor}`} instance={instance} snapshot={snapshot} disabled={disabled} onPrepare={props.onPrepare} />)}
        <FeeRecipients key={`${snapshot.launch.poolId}:${snapshot.fees.adminRevision}:${snapshot.fees.wallets.join(":")}:${snapshot.actor}`} snapshot={snapshot} disabled={disabled} onPrepare={props.onPrepare} />
        {props.authorControlsContent}
      </section>
      <aside className={styles.sidebar} aria-labelledby="fee-claims-heading">
        <span className={styles.eyebrow}>Your fee balance</span><h2 id="fee-claims-heading">{native(snapshot.fees.claimable)} <span>ETH</span></h2>
        <p>Available fees across your Module Mode coins. Previously earned fees stay with your wallet when a coin changes hands.</p>
        <ClaimForm key={`fees:${snapshot.actor}`} label="Claim fee balance" actor={snapshot.actor} balance={snapshot.fees.claimable} disabled={disabled} onClaim={recipient => props.onPrepare({ kind: "claim-fees", recipient })} />
        <dl className={styles.facts}><div><dt>Earned from this coin</dt><dd>{native(snapshot.fees.contributedByCoin)} ETH</dd></div><div><dt>Fees already claimed</dt><dd>{native(snapshot.fees.claimed)} ETH</dd></div></dl>
        <p className={styles.small}>Balances were read at block {snapshot.blockNumber.toString()}. Refresh before acting on a recent change.</p>
      </aside>
    </div> : null}
  </section>;
}

function PreparedReview({ prepared, onConfirm, onCancel }: { prepared: ConsolePrepared; onConfirm: () => void; onCancel: () => void }) {
  const review = useRef<HTMLElement>(null);
  useEffect(() => { review.current?.focus(); review.current?.scrollIntoView({ behavior: "instant", block: "nearest" }); }, []);
  return <section className={styles.review} tabIndex={-1} ref={review} aria-labelledby="management-review-heading">
    <span className={styles.eyebrow}>Review transaction</span><h2 id="management-review-heading">{prepared.authorWalletChange ? "Change author reward wallet" : "Confirm the change"}</h2>
    {prepared.authorWalletChange ? <ModuleNativeAuthorWalletReview change={prepared.authorWalletChange} /> : <p>{prepared.transaction.description}</p>}
    <dl className={styles.facts}>
      <div><dt>Wallet</dt><dd>{prepared.transaction.from}</dd></div><div><dt>ETH sent</dt><dd>{native(BigInt(prepared.transaction.value))} ETH</dd></div>
      <div><dt>{prepared.authorWalletChange ? "Preview valid until" : "Valid until"}</dt><dd>{timestamp(prepared.expiresAt)}</dd></div><div><dt>Network cost</dt><dd>Shown by your wallet</dd></div>
    </dl>
    <details className={styles.details}><summary>Contract details</summary><dl className={styles.facts}><div><dt>Contract</dt><dd>{prepared.transaction.to}</dd></div><div><dt>Action selector</dt><dd>{prepared.transaction.data.slice(0, 10)}</dd></div></dl></details>
    <div className={styles.actions}><button className={styles.primaryButton} type="button" onClick={onConfirm}>Confirm in wallet</button><button className={styles.secondaryButton} type="button" onClick={onCancel}>Cancel</button></div>
  </section>;
}

function ReceiptStatus({ phase, hash, onCheckReceipt }: { phase: Phase; hash: Hex | null; onCheckReceipt: (hash: Hex) => void }) {
  const [candidate, setCandidate] = useState(hash ?? ""); const [error, setError] = useState("");
  const inputId = useId(); const input = useRef<HTMLInputElement>(null);
  const unresolved = ["pending", "unconfirmed", "checking"].includes(phase);
  const check = (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (!/^0x[a-fA-F0-9]{64}$/.test(candidate)) { setError("Enter the transaction hash from your wallet activity."); input.current?.focus(); return; }
    onCheckReceipt(candidate as Hex);
  };
  return <section className={styles.receipt} aria-label="Transaction status">
    <strong>{phase === "mined" ? "Transaction mined" : phase === "reverted" ? "Transaction reverted" : "Confirmation not verified"}</strong>
    {hash ? <a href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer">View transaction<ArrowUpRight size={14} aria-hidden="true" /></a> : null}
    {unresolved ? <><p>Your request is saved in this browser so you can return after a reload. Checking confirmation only reads the chain and never sends another transaction.</p>
      <form onSubmit={check} className={styles.receiptForm}>
        <label className={styles.field}>Transaction hash<input ref={input} value={candidate} onChange={event => setCandidate(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" aria-invalid={!!error} aria-describedby={error ? inputId : undefined} /></label>
        {error ? <p id={inputId} className={styles.fieldError} role="alert">{error}</p> : null}
        <button className={styles.secondaryButton} type="submit" disabled={phase === "checking"}>{phase === "checking" ? "Checking confirmation…" : "Check confirmation"}</button>
      </form></> : phase === "reverted" ? <p>The transaction was mined with a revert. Its changes were not applied.</p> : <p>This confirms mining. Finality and indexing are separate checks.</p>}
  </section>;
}

function InstancePanel({ instance, snapshot, disabled, onPrepare }: { instance: ModuleManagedInstance; snapshot: ModuleManagementSnapshot; disabled: boolean; onPrepare: Prepare }) {
  const [funding, setFunding] = useState(""); const [formError, setFormError] = useState("");
  const fundInput = useRef<HTMLInputElement>(null);
  const budget = instance.manifest?.budget;
  const showBudget = budget?.fundable || instance.available > 0n || (instance.claimable ?? 0n) > 0n || (instance.claimed ?? 0n) > 0n;
  const fund = (event: FormEvent) => {
    event.preventDefault(); setFormError("");
    try { const amountWei = parseExactUnits(funding, 18); if (BigInt(amountWei) <= 0n) throw new Error("Enter an ETH amount above zero."); onPrepare({ kind: "fund", instanceId: instance.instanceId, amountWei }); }
    catch (error) { setFormError(errorMessage(error)); fundInput.current?.focus(); }
  };
  return <article className={styles.module}>
    <div className={styles.moduleTitle}><h3>{instance.title}</h3><a className={styles.textLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/address/${instance.module}`} target="_blank" rel="noreferrer">Contract<ArrowUpRight size={14} aria-hidden="true" /></a></div>
    {instance.problem ? <div className={styles.notice}><p>Management controls are not available for this module yet. Its existing ETH claims remain available.</p><details><summary>Why these controls are unavailable</summary>{instance.problem}</details></div> : null}
    {instance.manifest?.reads.length ? <dl className={styles.readGrid}>{instance.manifest.reads.map(read => <div key={read.id}><dt>{read.label}</dt><dd>{displayValue(read, instance.reads[read.id])}</dd></div>)}</dl> : null}
    {showBudget ? <section className={styles.budget} aria-label={`${instance.title} budget`}>
      <div className={styles.budgetLine}><span>Budget remaining</span><strong>{native(instance.available)} ETH</strong></div>
      <div className={styles.budgetLine}><span>Your available claim</span><strong>{native(instance.claimable)} ETH</strong></div>
      <div className={styles.budgetLine}><span>Already claimed by you</span><strong>{native(instance.claimed)} ETH</strong></div>
      <ClaimForm actor={snapshot.actor} balance={instance.claimable} disabled={disabled} onClaim={recipient => onPrepare({ kind: "claim", instanceId: instance.instanceId, recipient })} />
      {budget?.fundable && !instance.problem ? <details className={styles.details}><summary>Add ETH budget</summary><p className={styles.small}>{budget.explanation}</p><form onSubmit={fund}>
        <label className={styles.field}>ETH amount<input ref={fundInput} value={funding} onChange={event => setFunding(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0.01" aria-invalid={!!formError} aria-describedby={formError ? `fund-error-${instance.index}` : undefined} /></label>
        {formError ? <p id={`fund-error-${instance.index}`} className={styles.fieldError} role="alert">{formError}</p> : null}<button className={styles.secondaryButton} type="submit" disabled={disabled}>Review funding</button>
      </form></details> : null}
    </section> : null}
    {!instance.problem ? instance.manifest?.actions.map(action => <ProgramAction key={action.id} action={action} instance={instance} snapshot={snapshot} disabled={disabled} onPrepare={onPrepare} />) : null}
  </article>;
}

function ClaimForm({ actor, balance, disabled, onClaim, label = "Claim ETH" }: { actor: Address | null; balance: bigint | null; disabled: boolean; onClaim: (recipient: Address) => void; label?: string }) {
  const [recipient, setRecipient] = useState(actor ?? ""); const [error, setError] = useState("");
  const errorId = useId(); const recipientInput = useRef<HTMLInputElement>(null); const recipientDetails = useRef<HTMLDetailsElement>(null);
  return <form className={styles.claimForm} onSubmit={event => { event.preventDefault(); setError(""); if (!isAddress(recipient) || /^0x0{40}$/i.test(recipient)) { setError("Enter a valid nonzero recipient wallet."); if (recipientDetails.current) recipientDetails.current.open = true; recipientInput.current?.focus(); return; } onClaim(recipient); }}>
    <button className={styles.primaryButton} disabled={disabled || !actor || (balance ?? 0n) === 0n} type="submit">{label}</button>
    {(balance ?? 0n) > 0n ? <details className={styles.details} ref={recipientDetails}><summary>Send to another wallet</summary><label className={styles.field}>Recipient wallet<input ref={recipientInput} value={recipient} onChange={event => setRecipient(event.target.value)} spellCheck={false} autoComplete="off" aria-invalid={!!error} aria-describedby={error ? errorId : undefined} /></label><p className={styles.small}>Only your existing claim is sent to this wallet.</p></details> : null}
    {error ? <p id={errorId} className={styles.fieldError} role="alert">{error}</p> : null}
  </form>;
}

function ProgramAction({ action, instance, snapshot, disabled, onPrepare }: { action: ManagementAction; instance: ModuleManagedInstance; snapshot: ModuleManagementSnapshot; disabled: boolean; onPrepare: Prepare }) {
  const [value, setValue] = useState<FormValue>(() => defaultSchemaValue(action.inputSchema));
  const [formError, setFormError] = useState("");
  const problem = managementActionProblem(action, instance, snapshot);
  return <form className={styles.programAction} onSubmit={event => {
    event.preventDefault(); setFormError("");
    try { onPrepare({ kind: "program", instanceId: instance.instanceId, actionId: action.id, inputs: configurationFromForm(action.inputSchema, value) }); }
    catch (caught) { setFormError(errorMessage(caught)); }
  }}>
    <h4>{action.label}</h4><p className={styles.small}>{action.description}</p>
    <ModuleSchemaField schema={action.inputSchema} value={value} onChange={setValue} path={`/manage/${instance.index}/${action.id}`} context={{ roles: { ...(snapshot.actor ? { connectedWallet: snapshot.actor } : {}), launchWallet: snapshot.launch.launchWallet } }} />
    {formError ? <p className={styles.fieldError} role="alert">{formError}</p> : null}
    <button className={styles.secondaryButton} type="submit" disabled={disabled || !!problem}>Review {action.label.toLowerCase()}</button>{problem ? <p className={styles.small}>{problem}</p> : null}
  </form>;
}

function FeeRecipients({ snapshot, disabled, onPrepare }: { snapshot: ModuleManagementSnapshot; disabled: boolean; onPrepare: Prepare }) {
  const [wallets, setWallets] = useState<string[]>(snapshot.fees.wallets);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<number[]>([]); const errorId = useId(); const fields = useRef<(HTMLInputElement | null)[]>([]);
  const actor = snapshot.actor?.toLowerCase();
  const admin = !!actor && [snapshot.fees.treasury, snapshot.fees.administrator].some(wallet => wallet.toLowerCase() === actor);
  const ownSlots = snapshot.fees.wallets.map((wallet, index) => wallet.toLowerCase() === actor ? index : -1).filter(index => index >= 0);
  const submit = (event: FormEvent, index?: number) => {
    event.preventDefault(); setError(""); setInvalid([]);
    const selected = index === undefined ? wallets.map((_, i) => i) : [index];
    const errors = selected.filter(i => !isAddress(wallets[i]) || /^0x0{40}$/i.test(wallets[i]));
    if (errors.length) { setError("Enter a valid nonzero wallet for each recipient."); setInvalid(errors); fields.current[errors[0]]?.focus(); return; }
    onPrepare(index === undefined ? { kind: "replace-creators", recipients: wallets as Address[] } : { kind: "rotate-creator", index, recipient: wallets[index] as Address });
  };
  return <section className={styles.recipients} aria-labelledby="creator-recipient-heading"><h2 id="creator-recipient-heading">Creator fee recipients</h2><p className={styles.small}>These wallets receive future creator fees. Their shares stay fixed. Existing claims and module reward wallets are unaffected by a change.</p>
    <dl className={styles.recipientList}>{snapshot.fees.wallets.map((wallet, index) => <div key={index}><dt>Recipient {index + 1}<span>{formatUnits(BigInt(snapshot.fees.sharesBps[index]), 2)}%</span></dt><dd>{wallet}{wallet.toLowerCase() === actor ? <span className={styles.you}>Your wallet</span> : null}</dd></div>)}</dl>
    {admin ? <details className={styles.details}><summary>Replace creator fee recipients</summary><form onSubmit={event => submit(event)}><p className={styles.small}>Your connected wallet has the existing administrator role. This change applies to future fees only.</p>{wallets.map((wallet, index) => <label className={styles.field} key={index}>Recipient {index + 1} · {formatUnits(BigInt(snapshot.fees.sharesBps[index]), 2)}%<input ref={element => { fields.current[index] = element; }} value={wallet} onChange={event => setWallets(values => values.map((value, i) => i === index ? event.target.value : value))} spellCheck={false} autoComplete="off" aria-invalid={invalid.includes(index)} aria-describedby={invalid.includes(index) ? errorId : undefined} /></label>)}<button className={styles.secondaryButton} disabled={disabled} type="submit">Review recipient change</button></form></details>
      : ownSlots.map(index => <details className={styles.details} key={index}><summary>Change my fee wallet{ownSlots.length > 1 ? ` · recipient ${index + 1}` : ""}</summary><form onSubmit={event => submit(event, index)}><label className={styles.field}>New fee wallet<input ref={element => { fields.current[index] = element; }} value={wallets[index]} onChange={event => setWallets(values => values.map((value, i) => i === index ? event.target.value : value))} spellCheck={false} autoComplete="off" aria-invalid={invalid.includes(index)} aria-describedby={invalid.includes(index) ? errorId : undefined} /></label><button className={styles.secondaryButton} disabled={disabled} type="submit">Review wallet change</button></form></details>)}
    {error ? <p id={errorId} className={styles.fieldError} role="alert">{error}</p> : null}
  </section>;
}
