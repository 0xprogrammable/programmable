"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { formatUnits, isAddress, type Address, type Hex } from "viem";
import { useWallet } from "@/components/wallet-provider";
import { ModuleSchemaField } from "@/components/module-mode-fields";
import { ROBINHOOD_BLOCK_EXPLORER_URL } from "@/lib/chains";
import { configurationFromForm, defaultSchemaValue, parseExactUnits, type FormValue } from "@/lib/module-mode/builder";
import { createModuleNativeClient, ModuleNativeTransactionRevertedError, prepareModuleNativeManagementTransaction, waitForModuleNativeReceipt,
  prepareModuleNativeSwap, prepareModuleNativeApproval, type PreparedModuleNativeManagement, type PreparedModuleNativeSwap, type PreparedModuleNativeApproval } from "@/lib/module-mode/native-client";
import { parseModuleModeAvailability, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { managementActionProblem, moduleManagementChainMatches, readModuleManagementSnapshot,
  type ManagementValue, type ModuleManagedInstance, type ModuleManagementIntent, type ModuleManagementSnapshot } from "@/lib/module-mode/management";
import type { ManagementAction, ManagementRead } from "@/lib/module-mode/management-manifest";
import styles from "./module-coin-console.module.css";

type Phase = "idle" | "preparing" | "review" | "wallet" | "pending" | "unconfirmed" | "checking" | "mined" | "reverted";
type Prepare = (intent: ModuleManagementIntent) => void;
type ConsolePrepared = PreparedModuleNativeManagement | PreparedModuleNativeSwap | PreparedModuleNativeApproval;
export type ModuleConsoleTradeIntent = { isBuy: boolean; amount: string; slippageBps: number };
const native = (value: bigint | null) => value === null ? "—" : formatUnits(value, 18);
const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
function errorMessage(error: unknown) {
  const message = error && typeof error === "object" && "shortMessage" in error ? error.shortMessage : error instanceof Error ? error.message : "The request could not be completed. Refresh and try again.";
  return String(message).slice(0, 600);
}
function timestamp(value: bigint) {
  if (value > 8_640_000_000_000n || value < -8_640_000_000_000n) return `${value.toString()} Unix seconds`;
  return new Date(Number(value) * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
function displayValue(read: ManagementRead, value: ManagementValue | undefined) {
  if (value === null) return "Connect your wallet";
  if (value === undefined) return "Unavailable";
  if (read.display === "native" && typeof value === "bigint") return `${native(value)} ETH`;
  if (read.display === "timestamp" && typeof value === "bigint") return timestamp(value);
  if (read.display === "boolean" && typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function ModuleCoinConsole({ token }: { token: Address }) {
  const wallet = useWallet();
  const [client] = useState(createModuleNativeClient);
  const [availability, setAvailability] = useState<ModuleModeAvailability | null>(null);
  const [snapshot, setSnapshot] = useState<ModuleManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<ConsolePrepared | null>(null);
  const [hash, setHash] = useState<Hex | null>(null);
  const generation = useRef(0);
  const operation = useRef(false);
  const account = wallet.wallet?.account ?? null;
  const actor = account?.toLowerCase() as Address | undefined;
  const walletReady = !!account && wallet.authenticated && wallet.sessionReady;
  const onChain = moduleManagementChainMatches(wallet.wallet?.chainId);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    try {
      const response = await fetch("/api/module-mode", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("Module management could not be loaded. Try refreshing.");
      const next = parseModuleModeAvailability(await response.json());
      if (current !== generation.current) return;
      setAvailability(next); setError("");
      if (!next.release) { setSnapshot(null); return; }
      const state = await readModuleManagementSnapshot({ client, release: next.release, catalog: next.catalog, token, actor });
      if (current === generation.current) setSnapshot(state);
    } catch (caught) {
      if (current === generation.current) { setSnapshot(null); setError(errorMessage(caught)); }
    } finally { if (current === generation.current) setLoading(false); }
  }, [client, token, actor]);
  useEffect(() => {
    // Schedule the initial subscription read so a replaced wallet/route can cancel before it starts.
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => { window.clearTimeout(timer); generation.current += 1; };
  }, [refresh]);

  const prepare = async (intent: ModuleManagementIntent) => {
    if (operation.current || ["wallet", "pending", "unconfirmed", "checking"].includes(phase)) return;
    if (!walletReady || !onChain || !account || !availability?.release) { setError("Connect your wallet on Robinhood Chain before reviewing an action."); return; }
    operation.current = true; setError(""); setPrepared(null); setHash(null); setPhase("preparing");
    try {
      const block = await client.getBlock({ blockTag: "latest" });
      const result = await prepareModuleNativeManagementTransaction({ client, release: availability.release, catalog: availability.catalog,
        token, actor: account, intent, deadline: block.timestamp + 300n });
      setPrepared(result); setPhase("review");
    } catch (caught) { setError(errorMessage(caught)); setPhase("idle"); }
    finally { operation.current = false; }
  };
  const prepareTrade = async (intent: ModuleConsoleTradeIntent) => {
    if (operation.current || ["wallet", "pending", "unconfirmed", "checking"].includes(phase)) return;
    if (!walletReady || !onChain || !account || !availability?.release) { setError("Connect your wallet on Robinhood Chain before reviewing a trade."); return; }
    operation.current = true; setError(""); setPrepared(null); setHash(null); setPhase("preparing");
    try {
      const amount = BigInt(parseExactUnits(intent.amount, 18));
      if (amount <= 0n) throw new Error("Enter an amount above zero.");
      const result = await prepareModuleNativeSwap({ client, availability, account, token, isBuy: intent.isBuy,
        amountSpecified: -amount, recipient: account, slippageBps: intent.slippageBps, deadlineSeconds: 300 });
      const transaction = result.kind === "approval-required"
        ? await prepareModuleNativeApproval({ client, availability, account, token, amount: result.amount, deadlineSeconds: 300 }) : result;
      setPrepared(transaction); setPhase("review");
    } catch (caught) { setError(errorMessage(caught)); setPhase("idle"); }
    finally { operation.current = false; }
  };
  const confirm = async () => {
    if (!prepared || phase !== "review" || operation.current) return;
    operation.current = true; setError(""); setPhase("wallet");
    let submittedHash: Hex | null = null;
    try {
      // The provider revalidates the branded operation and owns the shared wallet request lock.
      const sentHash: Hex = await wallet.sendModuleModeTransaction(prepared);
      submittedHash = sentHash; setHash(sentHash); setPhase("pending");
      await waitForModuleNativeReceipt({ client, prepared, transactionHash: sentHash });
      setPhase("mined"); setPrepared(null); setLoading(true); await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      // Uncertain wallet/RPC responses retain the prepared request only for receipt verification.
      if (caught instanceof ModuleNativeTransactionRevertedError) { setPhase("reverted"); setPrepared(null); }
      else if (submittedHash) setPhase("pending");
      else if (caught && typeof caught === "object" && "walletRequestAttempted" in caught && caught.walletRequestAttempted
        && !("walletRequestRejected" in caught && caught.walletRequestRejected)) setPhase("unconfirmed");
      else { setPhase("idle"); setPrepared(null); }
    } finally { operation.current = false; }
  };
  const checkReceipt = async (transactionHash: Hex) => {
    if (!prepared || operation.current || !["pending", "unconfirmed"].includes(phase)) return;
    operation.current = true; setError(""); setHash(transactionHash); setPhase("checking");
    try {
      await waitForModuleNativeReceipt({ client, prepared, transactionHash });
      setPhase("mined"); setPrepared(null); setLoading(true); await refresh();
    } catch (caught) {
      setError(errorMessage(caught));
      if (caught instanceof ModuleNativeTransactionRevertedError) { setPhase("reverted"); setPrepared(null); }
      else setPhase("pending");
    } finally { operation.current = false; }
  };
  const currentSnapshot = snapshot && snapshot.actor === (actor ?? null) ? snapshot : null;
  return <ModuleCoinConsoleView token={token} snapshot={currentSnapshot} loading={loading}
    unavailable={!loading && !error && availability?.release === null} walletReady={walletReady} onChain={onChain}
    phase={phase} prepared={prepared} hash={hash} error={error}
    onPrepare={intent => { void prepare(intent); }} onConfirm={() => { void confirm(); }}
    onPrepareTrade={intent => { void prepareTrade(intent); }}
    onCheckReceipt={transactionHash => { void checkReceipt(transactionHash); }}
    onCancel={() => { if (phase === "review") { setPrepared(null); setPhase("idle"); } }} onRefresh={() => { setLoading(true); void refresh(); }}
    onWallet={wallet.openWallet} onSwitch={() => { void wallet.switchNetwork("0x1237").catch(caught => setError(errorMessage(caught))); }} />;
}

export interface ModuleCoinConsoleViewProps {
  token: Address; snapshot: ModuleManagementSnapshot | null; loading: boolean; unavailable: boolean;
  walletReady: boolean; onChain: boolean; phase: Phase; prepared: ConsolePrepared | null;
  hash: Hex | null; error: string;
  onPrepare: Prepare; onConfirm: () => void; onCancel: () => void; onRefresh: () => void;
  onPrepareTrade: (intent: ModuleConsoleTradeIntent) => void;
  onCheckReceipt: (transactionHash: Hex) => void;
  onWallet: () => void; onSwitch: () => void;
}

/** Separate presentation lets browser QA supply clearly labelled fixtures without a production bypass. */
export function ModuleCoinConsoleView(props: ModuleCoinConsoleViewProps) {
  const { snapshot, loading, phase, prepared } = props;
  const busy = ["preparing", "wallet", "pending", "unconfirmed", "checking"].includes(phase);
  const disabled = busy || loading || !props.walletReady || !props.onChain || phase === "review";
  return <main className={styles.console}>
    <div className={styles.topline}>
      <Link href="/launch/modules" className={styles.back}><ArrowLeft size={16} aria-hidden="true" />Module Mode</Link>
      <button type="button" className={styles.quietButton} onClick={props.onRefresh} disabled={loading || phase === "wallet"}><RefreshCw size={16} aria-hidden="true" />{loading ? "Refreshing…" : "Refresh"}</button>
    </div>
    <header className={styles.heading}>
      <span className={styles.eyebrow}>Coin controls · Robinhood Chain</span>
      <h1>{snapshot ? `Manage ${snapshot.name}` : "Manage your coin"}</h1>
      <p>Fund your modules, claim ETH and manage creator fee recipients.</p>
      <a className={styles.tokenLink} href={`${ROBINHOOD_BLOCK_EXPLORER_URL}/token/${props.token}`} target="_blank" rel="noreferrer">{snapshot?.symbol ? `${snapshot.symbol} · ` : ""}{shortAddress(props.token)}<ArrowUpRight size={14} aria-hidden="true" /></a>
    </header>

    {!props.walletReady ? <div className={styles.walletBar}><p>Connect your wallet to see your claims and available actions.</p><button className={styles.primaryButton} type="button" onClick={props.onWallet}>Connect wallet</button></div>
      : !props.onChain ? <div className={styles.walletBar}><p>Switch to Robinhood Chain to manage this coin.</p><button className={styles.primaryButton} type="button" onClick={props.onSwitch}>Switch network</button></div> : null}
    <div className={styles.liveRegion} role="status" aria-live="polite">{loading ? "Loading verified coin state." : phase === "preparing" ? "Checking the action and current wallet permissions." : phase === "wallet" ? "Confirm the transaction in your wallet." : phase === "pending" || phase === "unconfirmed" ? "Transaction confirmation has not been verified." : phase === "checking" ? "Checking the transaction confirmation." : phase === "mined" ? "Transaction mined." : phase === "reverted" ? "The transaction reverted. Its changes were not applied." : ""}</div>
    {props.error ? <div className={styles.error} role="alert">{props.error}</div> : null}
    {props.unavailable ? <section className={styles.empty}><h2>Module management is not available yet</h2><p>Controls will become available when the Module Mode release is ready. Refresh to check again.</p><Link href="/docs/developers/module-mode" className={styles.textLink}>Read the Module Mode guide</Link></section> : null}
    {loading && !snapshot ? <section className={styles.empty} aria-busy="true"><h2>Loading coin controls</h2><p>Checking this coin and your available balances.</p></section> : null}

    {prepared && phase === "review" ? <PreparedReview prepared={prepared} symbol={snapshot?.symbol ?? "tokens"} onConfirm={props.onConfirm} onCancel={props.onCancel} /> : null}
    {props.hash || phase === "unconfirmed" ? <ReceiptStatus key={`${props.hash ?? "unknown"}:${phase === "mined"}`} phase={phase} hash={props.hash} onCheckReceipt={props.onCheckReceipt} /> : null}

    {snapshot ? <div className={styles.layout}>
      <section className={styles.modules} aria-labelledby="coin-modules-heading">
        <TradePanel symbol={snapshot.symbol} disabled={disabled} onPrepare={props.onPrepareTrade} />
        <div className={styles.sectionHeading}><h2 id="coin-modules-heading">Your modules</h2><span>{snapshot.instances.length}</span></div>
        {snapshot.instances.length === 0 ? <div className={styles.plain}><h3>Plain coin</h3><p>This coin has no extra modules. Your creator fee controls are available below.</p></div> : snapshot.instances.map(instance => <InstancePanel key={`${instance.instanceId}:${snapshot.actor}`} instance={instance} snapshot={snapshot} disabled={disabled} onPrepare={props.onPrepare} />)}
        <FeeRecipients key={`${snapshot.launch.poolId}:${snapshot.fees.adminRevision}:${snapshot.fees.wallets.join(":")}:${snapshot.actor}`} snapshot={snapshot} disabled={disabled} onPrepare={props.onPrepare} />
      </section>
      <aside className={styles.sidebar} aria-labelledby="fee-claims-heading">
        <span className={styles.eyebrow}>Your fee balance</span><h2 id="fee-claims-heading">{native(snapshot.fees.claimable)} <span>ETH</span></h2>
        <p>Available fees across your Module Mode coins. Previously earned fees stay with your wallet when a coin changes hands.</p>
        <ClaimForm key={`fees:${snapshot.actor}`} label="Claim fee balance" actor={snapshot.actor} balance={snapshot.fees.claimable} disabled={disabled} onClaim={recipient => props.onPrepare({ kind: "claim-fees", recipient })} />
        <dl className={styles.facts}><div><dt>Earned from this coin</dt><dd>{native(snapshot.fees.contributedByCoin)} ETH</dd></div><div><dt>Fees already claimed</dt><dd>{native(snapshot.fees.claimed)} ETH</dd></div></dl>
        <p className={styles.small}>Balances were read at block {snapshot.blockNumber.toString()}. Refresh before acting on a recent change.</p>
      </aside>
    </div> : null}
  </main>;
}

function PreparedReview({ prepared, symbol, onConfirm, onCancel }: { prepared: ConsolePrepared; symbol: string; onConfirm: () => void; onCancel: () => void }) {
  const review = useRef<HTMLElement>(null);
  useEffect(() => { review.current?.focus(); review.current?.scrollIntoView({ behavior: "instant", block: "nearest" }); }, []);
  return <section className={styles.review} tabIndex={-1} ref={review} aria-labelledby="management-review-heading">
    <span className={styles.eyebrow}>Review transaction</span><h2 id="management-review-heading">{prepared.kind === "swap" ? `Review ${prepared.isBuy ? "buy" : "sell"}` : prepared.kind === "approve" ? "Approve tokens for sale" : "Confirm the change"}</h2>
    <p>{prepared.transaction.description}</p>
    {prepared.kind === "swap" ? <>
      <dl className={styles.facts}>
        <div><dt>You pay</dt><dd>{prepared.isBuy ? `${native(prepared.nativeAmount)} ETH` : `${native(prepared.tokenAmount)} ${symbol}`}</dd></div>
        <div><dt>Estimated received</dt><dd>{prepared.isBuy ? `${native(prepared.tokenAmount)} ${symbol}` : `${native(prepared.nativeAmount)} ETH`}</dd></div>
        <div><dt>Minimum received</dt><dd>{native(prepared.limit)} {prepared.isBuy ? symbol : "ETH"}</dd></div>
        <div><dt>Trade fees</dt><dd>{prepared.feeComponents.creatorBps / 100}% creator + {prepared.feeComponents.platformBps / 100}% platform{prepared.feeComponents.poolProtocolPips ? ` + ${prepared.feeComponents.poolProtocolPips / 10_000}% pool protocol` : ""}</dd></div>
      </dl><p className={styles.small}>The estimate includes trade fees. Execution reverts if the minimum received cannot be met.</p>
    </> : prepared.kind === "approve" ? <p>Allow the fixed Module Mode router to spend {native(prepared.amount)} {symbol}. After confirmation, review your sell separately. This approval does not sell your tokens.</p> : null}
    <dl className={styles.facts}>
      <div><dt>Wallet</dt><dd>{prepared.transaction.from}</dd></div><div><dt>ETH sent</dt><dd>{native(BigInt(prepared.transaction.value))} ETH</dd></div>
      <div><dt>Valid until</dt><dd>{timestamp(prepared.expiresAt)}</dd></div><div><dt>Network cost</dt><dd>Shown by your wallet</dd></div>
    </dl>
    <details className={styles.details}><summary>Contract details</summary><dl className={styles.facts}><div><dt>Contract</dt><dd>{prepared.transaction.to}</dd></div><div><dt>Action selector</dt><dd>{prepared.transaction.data.slice(0, 10)}</dd></div></dl></details>
    <div className={styles.actions}><button className={styles.primaryButton} type="button" onClick={onConfirm}>Confirm in wallet</button><button className={styles.secondaryButton} type="button" onClick={onCancel}>Cancel</button></div>
  </section>;
}

function TradePanel({ symbol, disabled, onPrepare }: { symbol: string; disabled: boolean; onPrepare: (intent: ModuleConsoleTradeIntent) => void }) {
  const [isBuy, setIsBuy] = useState(true); const [amount, setAmount] = useState(""); const [slippage, setSlippage] = useState("0.5");
  const [error, setError] = useState(""); const errorId = useId(); const amountInput = useRef<HTMLInputElement>(null);
  const prepare = (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      if (BigInt(parseExactUnits(amount, 18)) <= 0n) throw new Error("Enter an amount above zero.");
      const slippageBps = Number(parseExactUnits(slippage, 2));
      if (slippageBps > 500) throw new Error("Choose slippage between 0% and 5%.");
      onPrepare({ isBuy, amount, slippageBps });
    } catch (caught) { setError(errorMessage(caught)); amountInput.current?.focus(); }
  };
  return <section id="trade" className={styles.trade} aria-labelledby="module-trade-heading">
    <h2 id="module-trade-heading">Trade {symbol}</h2>
    <div className={styles.tradeSides} role="group" aria-label="Trade side">
      <button type="button" className={isBuy ? styles.primaryButton : styles.secondaryButton} aria-pressed={isBuy} disabled={disabled} onClick={() => { setIsBuy(true); setAmount(""); setError(""); }}>Buy</button>
      <button type="button" className={!isBuy ? styles.primaryButton : styles.secondaryButton} aria-pressed={!isBuy} disabled={disabled} onClick={() => { setIsBuy(false); setAmount(""); setError(""); }}>Sell</button>
    </div>
    <form onSubmit={prepare}>
      <label className={styles.field}>You pay · {isBuy ? "ETH" : symbol}<input ref={amountInput} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder={isBuy ? "0.01" : "100"} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} /></label>
      <details className={styles.details}><summary>Slippage · {slippage || "0"}%</summary><label className={styles.field}>Maximum slippage (%)<input value={slippage} onChange={event => setSlippage(event.target.value)} inputMode="decimal" autoComplete="off" /></label><p className={styles.small}>Sets your minimum received amount. The trade reverts if the price moves beyond this limit.</p></details>
      {error ? <p id={errorId} className={styles.fieldError} role="alert">{error}</p> : null}
      <button className={styles.primaryButton} type="submit" disabled={disabled}>Review {isBuy ? "buy" : "sell"}</button>
      <p className={styles.small}>{isBuy ? "Review the estimated tokens, minimum received and fees before confirming." : "A token approval may be needed first. You review the sale after the approval is confirmed."}</p>
    </form>
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
    {unresolved ? <><p>Check your wallet activity before doing anything else. Checking confirmation only reads the chain and never sends another transaction.</p>
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
