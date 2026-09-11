"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { decodeAbiParameters, formatUnits, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep } from "@/components/module-mode-wallet-state";
import { parseExactUnits, utcDateTimeToSeconds } from "@/lib/module-mode/builder";
import { moduleAddress, moduleHash } from "@/lib/module-mode/release";
import type { ModuleEngineRelease, ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { moduleEngineUtcTimestamp } from "@/lib/module-engine/presentation";
import { isModuleEngineSharedQuoteRelease, isModuleEngineAnyQuoteRelease } from "@/lib/module-engine/profile";
import { quoteModuleEngineAnyQuoteTrade } from "@/lib/module-engine/any-quote/integration-client";
import { createModuleEngineClient, ENGINE_OPERATIONS, isModuleEngineFeeTransaction, prepareModuleEngineFeeChange, type ModuleEngineFeeChangeIntent, type ModuleEngineReceiptResult, moduleEngineDepositIntent, moduleEngineSettlementPaymentIntent, moduleEngineSettlementRequestIntent, moduleEngineTradeIntent, moduleEngineWithdrawalIntent, prepareModuleEngineApproval, prepareModuleEngineClaim, prepareModuleEngineOperation, quoteModuleEngineTrade, readModuleEngineAdministration, readModuleEngineQuoteAsset, type ModuleEngineAdministration, type ModuleEngineApprovalRequired, type ModuleEngineClient, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { ModuleEngineTransactionReview, type ModuleEngineWalletActions } from "./module-engine-transaction-review";
import { ModuleEngineFeeControls, ModuleEngineFeeChangeReceipt } from "./module-engine-fee-controls";
import { anyQuoteUserMessage } from "./module-engine-any-quote-asset";
import { ModuleEngineCustomOperationFields } from "./module-engine-custom-operation";
import { emptyModuleEngineCustomOperation, moduleEngineCustomOperationIntent } from "@/lib/module-engine/custom-operation";
import styles from "@/components/module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

export interface ModuleEngineConsoleProps extends ModuleEngineWalletActions { release: ModuleEngineRelease; template: ModuleEngineTemplate; token: Address; client?: ModuleEngineClient; statusContent?: ReactNode }
type Action = "buy" | "sell" | "deposit" | "withdraw" | "request" | "fulfill" | "refund";
const labels: Record<Action, string> = { buy: "Buy tokens", sell: "Sell tokens", deposit: "Deposit quote tokens", withdraw: "Withdraw your deposit", request: "Create a funded request", fulfill: "Fulfill this request", refund: "Refund this request" };
const humanError = (caught: unknown) => anyQuoteUserMessage(caught, caught instanceof Error ? caught.message.replace(/^Module engine: /, "") : "The current coin state could not be verified. Please try again.");
export function ModuleEngineConsole({ release, template, token, client: suppliedClient, wallet, onConnect, onSwitch, onSubmit, blocked, blockedReason, statusContent }: ModuleEngineConsoleProps) {
  const client = useMemo(() => suppliedClient ?? createModuleEngineClient(), [suppliedClient]);
  const [snapshot, setSnapshot] = useState<(ModuleEngineAdministration & { releaseDigest: Hex }) | null>(null); const [action, setAction] = useState<Action | null>(null);
  const [customOperationId, setCustomOperationId] = useState(""); const [customForm, setCustomForm] = useState(emptyModuleEngineCustomOperation); const [customReview, setCustomReview] = useState(false);
  const [amount, setAmount] = useState(""); const [recipient, setRecipient] = useState(""); const [requestId, setRequestId] = useState(""); const [refundTime, setRefundTime] = useState(""); const [reference, setReference] = useState("");
  const [routes, setRoutes] = useState<{ label: string; data: Hex }[]>([]); const [route, setRoute] = useState("");
  const [prepared, setPrepared] = useState<PreparedModuleEngineTransaction | null>(null); const [approval, setApproval] = useState<ModuleEngineApprovalRequired | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [feeReceipt, setFeeReceipt] = useState<{ account: Address; result: ModuleEngineReceiptResult } | null>(null);
  const feeReturnFocus = useRef<HTMLElement | null>(null);
  const errorFocus = useRef<HTMLParagraphElement>(null);
  const refreshRequest = useRef(0);
  useEffect(() => { if (error) errorFocus.current?.focus(); }, [error]);
  const step = moduleModeWalletStep(wallet), profile = template.manifest.manifest.catalogDefinition.interface;
  const quoteFees = isModuleEngineAnyQuoteRelease(release);
  const anyQuote = isModuleEngineSharedQuoteRelease(release) && profile === "quote-shared-v1";
  const current = snapshot?.releaseDigest === release.releaseDigest && snapshot?.actor.toLowerCase() === wallet.account?.toLowerCase() && snapshot?.launch.token.toLowerCase() === token.toLowerCase() ? snapshot : null;
  const expectedActions: Action[] = profile === "quote-v1" || anyQuote ? ["buy", "sell"] : profile === "escrow-v1" ? ["deposit", "withdraw"] : profile === "settlement-v1" ? ["request", "fulfill", "refund"] : [];
  const actions = anyQuote && current ? expectedActions : expectedActions.filter(key => current?.permissions.some(p => p.operationId === ENGINE_OPERATIONS[key] && (p.authorization === 0 || current.actor === current.launch.creator)));
  const customPermissions = anyQuote ? [] : current?.permissions.filter(permission => !expectedActions.some(key => ENGINE_OPERATIONS[key] === permission.operationId) && (permission.authorization === 0 || current.actor === current.launch.creator)) ?? [];
  const customPermission = customPermissions.find(permission => permission.operationId === customOperationId) ?? customPermissions[0];
  const selected = action && actions.includes(action) ? action : actions[0];
  const request = current?.settlement?.request;
  const canPrepare = Boolean(current && selected && (selected !== "fulfill" || current.settlement?.canFulfill) && (selected !== "refund" || current.settlement?.canRefund) && (selected !== "withdraw" || current.escrow && current.escrow.credit > 0n && current.timestamp >= current.escrow.unlockTime));
  function edit(change: () => void) { change(); setPrepared(null); setApproval(null); setError(null); }
  function backToEdit() { if (prepared && isModuleEngineFeeTransaction(prepared)) { setPrepared(null); requestAnimationFrame(() => feeReturnFocus.current?.focus()); return; } const id = prepared?.kind === "approve" ? "engine-operation-approval-review" : prepared?.kind === "claim" ? "engine-claim-review" : customReview ? "engine-custom-action-review" : "engine-action-review"; setPrepared(null); requestAnimationFrame(() => document.getElementById(id)?.focus()); }
  const refresh = useCallback(async () => {
    if (!wallet.account) return; setBusy(true); setError(null);
    const request = ++refreshRequest.current;
    try { const account = moduleAddress(wallet.account, "account"); const state = await readModuleEngineAdministration({ client, release, template, token, account, ...(requestId.trim() ? { requestId: moduleHash(requestId.trim(), "request ID") } : {}) }); if (request !== refreshRequest.current) return; setSnapshot({ ...state, releaseDigest: release.releaseDigest }); if (profile === "quote-v1") { const quote = await readModuleEngineQuoteAsset({ client, release, template, quoteAsset: state.launch.quoteAsset, account, existingToken: token }); if (request !== refreshRequest.current) return; setRoutes(quote.routes); setRoute(quote.routes[0]?.data ?? ""); } }
    catch (caught) { if (request === refreshRequest.current) setError(humanError(caught)); } finally { if (request === refreshRequest.current) setBusy(false); }
  }, [wallet.account, client, release, template, token, requestId, profile]);
  useEffect(() => {
    const timer = anyQuote && step === "prepare" ? setTimeout(() => void refresh(), 0) : undefined;
    return () => { clearTimeout(timer); refreshRequest.current += 1; };
  }, [anyQuote, step, refresh]);
  async function prepareAction() {
    if (!current || !selected || !wallet.account) return; setBusy(true); setError(null); setNotice(null); setCustomReview(false);
    try {
      const account = moduleAddress(wallet.account, "account"); assertModuleModeWalletUnchanged(wallet, account);
      const quoteAsset = current.launch.quoteAsset, target = recipient.trim() ? moduleAddress(recipient.trim(), "recipient") : account;
      if (!["fulfill", "refund"].includes(selected) && BigInt(parseExactUnits(amount, selected === "sell" || anyQuote ? 18 : current.quoteDecimals)) === 0n) throw new Error("Enter an amount greater than zero.");
      let result;
      if (anyQuote && (selected === "buy" || selected === "sell")) {
        const quote = await quoteModuleEngineAnyQuoteTrade({ client, release, template, account, token, buy: selected === "buy", inputAmount: BigInt(parseExactUnits(amount, 18)), recipient: target, slippageBps: 100 });
        if (quote.kind === "approval-required") result = quote;
        else result = quote.prepared;
      } else if (selected === "buy" || selected === "sell") {
        if (!route) throw new Error("Select an available quote-to-ETH route.");
        const intent = moduleEngineTradeIntent({ buy: selected === "buy", token, quoteAsset, recipient: target, inputAmount: BigInt(parseExactUnits(amount, selected === "buy" ? current.quoteDecimals : 18)), minimumOutput: 1n, minimumEthFees: 1n, conversionRoute: route as Hex });
        const quote = await quoteModuleEngineTrade({ client, release, template, account, token, intent, slippageBps: 100 });
        if (quote.kind === "approval-required") result = quote; else { result = quote.prepared; setNotice(`Simulation: ${formatUnits(quote.output, selected === "buy" ? 18 : current.quoteDecimals)} output. Minimum: ${formatUnits(quote.minimumOutput, selected === "buy" ? 18 : current.quoteDecimals)}. Fee conversion: at least ${formatUnits(quote.minimumEthFees, 18)} ETH. Slippage: 1%.`); }
      } else {
        let intent;
        if (selected === "deposit") intent = moduleEngineDepositIntent(quoteAsset, account, BigInt(parseExactUnits(amount, current.quoteDecimals)));
        else if (selected === "withdraw") intent = moduleEngineWithdrawalIntent(quoteAsset, target, BigInt(parseExactUnits(amount, current.quoteDecimals)));
        else if (selected === "request") { if (!reference.trim()) throw new Error("Enter an obligation reference."); intent = moduleEngineSettlementRequestIntent({ quoteAsset, actor: account, beneficiary: moduleAddress(recipient.trim(), "beneficiary"), amount: BigInt(parseExactUnits(amount, current.quoteDecimals)), refundAfter: BigInt(utcDateTimeToSeconds(refundTime)), obligationHash: keccak256(toHex(reference.trim())) }); }
        else { if (!request) throw new Error("Load the funded request first."); if (selected === "fulfill" && !reference.trim()) throw new Error("Enter a fulfillment reference."); intent = moduleEngineSettlementPaymentIntent({ quoteAsset, request, kind: selected, ...(selected === "fulfill" ? { evidenceHash: keccak256(toHex(reference.trim())) } : {}) }); }
        result = await prepareModuleEngineOperation({ client, release, template, account, token, intent });
      }
      if (result.kind === "approval-required") setApproval(result); else setPrepared(result);
    } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function prepareCustomAction() {
    if (!current || !customPermission || !wallet.account) return; setBusy(true); setError(null); setNotice(null);
    try {
      const account = moduleAddress(wallet.account, "account"); assertModuleModeWalletUnchanged(wallet, account);
      const intent = moduleEngineCustomOperationIntent({ permission: customPermission, form: customForm, account, token: current.launch.token, quoteAsset: current.launch.quoteAsset, quoteDecimals: current.quoteDecimals });
      const result = await prepareModuleEngineOperation({ client, release, template, account, token, intent });
      if (result.kind === "approval-required") setApproval(result); else { setCustomReview(true); setPrepared(result); }
    } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function prepareFeeChange(intent: ModuleEngineFeeChangeIntent) {
    if (!wallet.account) return; feeReturnFocus.current = document.activeElement as HTMLElement | null; setBusy(true); setError(null); setNotice(null);
    try { const account = moduleAddress(wallet.account, "account"); assertModuleModeWalletUnchanged(wallet, account); setPrepared(await prepareModuleEngineFeeChange({ client, release, template, token, account, intent })); }
    catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function prepareClaim() {
    if (!wallet.account) return; setBusy(true); setError(null);
    try { const account = moduleAddress(wallet.account, "account"); setPrepared(await prepareModuleEngineClaim({ client, release, token, account, recipient: account })); } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function prepareApproval() {
    if (!approval || !wallet.account) return; setBusy(true); setError(null);
    try { setPrepared(await prepareModuleEngineApproval({ ...approval, client, release, account: moduleAddress(wallet.account, "account"), amount: approval.currentAllowance > 0n && approval.allowanceKind !== "permit2" ? 0n : approval.amount })); } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!prepared) return; setBusy(true); setError(null);
    try {
      assertModuleModeWalletUnchanged(wallet, prepared.account); if (prepared.releaseDigest !== release.releaseDigest) throw new Error("The selected source release changed. Review again.");
      const result = await onSubmit(prepared);
      setFeeReceipt(result.feeChange ? { account: prepared.account, result } : null);
      if (profile === "settlement-v1" && !customReview && prepared.kind === "execute" && prepared.operation.operationId === ENGINE_OPERATIONS.request) { const [id] = decodeAbiParameters(parseAbiParameters("bytes32"), prepared.result); setRequestId(id); }
      setPrepared(null); setApproval(null); setSnapshot(null); setNotice(`Transaction mined: ${result.transactionHash}. Refresh balances to see the updated state. Finality is still pending.`);
      if (anyQuote) await refresh();
    } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  return <section className={`${styles.page} ${engineStyles.root}`} aria-labelledby="engine-console-title">
    <header className={styles.heading}><div className={styles.titleRow}><h1 id="engine-console-title">{template.manifest.manifest.catalogDefinition.title}</h1></div><p>{quoteFees ? "Buy and sell with ETH. Claim rewards in the pool pair token." : "Manage this coin and claim the ETH fees owed to your wallet."}</p><code className={engineStyles.inlineCode}>{token}</code></header>
    {statusContent}
    <div className={engineStyles.actions}>{step === "connect" ? <button className={styles.primaryButton} onClick={() => void onConnect()}>Connect wallet</button> : step === "switch" ? <button className={styles.primaryButton} onClick={() => void onSwitch()}>Switch to Robinhood Chain</button> : <button className={styles.secondaryButton} onClick={() => void refresh()} disabled={busy || Boolean(prepared)}>{busy ? "Checking balances…" : "Refresh balances"}</button>}</div>
    {profile === "settlement-v1" ? <div className={styles.field}><label htmlFor="engine-request-id">Existing request ID <span>Optional</span></label><input id="engine-request-id" disabled={busy || Boolean(prepared)} value={requestId} placeholder="0x…" spellCheck={false} onChange={event => edit(() => { setRequestId(event.target.value); setSnapshot(null); })} /><p className={styles.help}>Refresh after entering an ID to read its beneficiary, amount, status and refund time.</p></div> : null}
    {current ? <div className={engineStyles.stack} hidden={Boolean(prepared)}>
      <section className={styles.formPanel}><h2>Balances and permissions</h2><dl className={styles.reviewRows}><div><dt>Quote asset</dt><dd>{current.launch.quoteAsset}</dd></div><div><dt>Creator</dt><dd>{current.launch.creator}</dd></div><div><dt>Verified block</dt><dd>{current.blockNumber.toString()}</dd></div>
        {current.escrow ? <><div><dt>Your deposited balance</dt><dd>{formatUnits(current.escrow.credit, current.quoteDecimals)} quote tokens</dd></div><div><dt>Withdrawals open</dt><dd>{moduleEngineUtcTimestamp(current.escrow.unlockTime)}</dd></div></> : null}
        {request ? <><div><dt>Request status</dt><dd>{["", "Pending", "Fulfilled", "Refunded"][request.status]}</dd></div><div><dt>Payer</dt><dd>{request.payer}</dd></div><div><dt>Beneficiary</dt><dd>{request.beneficiary}</dd></div><div><dt>Funded amount</dt><dd>{formatUnits(request.amount, current.quoteDecimals)} quote tokens</dd></div><div><dt>Refund available</dt><dd>{moduleEngineUtcTimestamp(request.refundAfter)}</dd></div><div><dt>Obligation hash</dt><dd>{request.obligationHash}</dd></div></> : null}
      </dl>{current.settlement ? <p className={styles.help}>The creator confirms fulfillment before the refund time. The contract records their attestation; it does not independently verify delivery. After the refund time, only the payer can reclaim the funds.</p> : null}</section>
      {selected ? <form className={styles.formPanel} hidden={Boolean(prepared)} onSubmit={event => { event.preventDefault(); void prepareAction(); }}><fieldset className={styles.formFields} disabled={busy || Boolean(prepared)}><h2>{anyQuote ? "Trade" : "Coin controls"}</h2><div className={styles.field}><label htmlFor="engine-operation">Action</label><select id="engine-operation" value={selected} onChange={event => edit(() => { setAction(event.target.value as Action); setAmount(""); setReference(""); setRecipient(""); })}>{actions.map(key => <option key={key} value={key}>{anyQuote ? key === "buy" ? "Buy with ETH" : "Sell to ETH" : labels[key]}</option>)}</select></div>
        {!["fulfill", "refund"].includes(selected) ? <div className={styles.field}><label htmlFor="engine-operation-amount">{selected === "sell" ? "Token" : anyQuote ? "ETH" : "Quote"} amount</label><input id="engine-operation-amount" inputMode="decimal" value={amount} onChange={event => edit(() => setAmount(event.target.value))} required /></div> : null}
        {!["deposit", "fulfill", "refund"].includes(selected) ? <div className={styles.field}><label htmlFor="engine-operation-recipient">{selected === "request" ? "Fixed beneficiary wallet" : "Recipient wallet"}</label><input id="engine-operation-recipient" value={recipient} placeholder={selected === "request" ? "0x…" : wallet.account} spellCheck={false} onChange={event => edit(() => setRecipient(event.target.value))} /></div> : null}
        {selected === "request" ? <div className={styles.field}><label htmlFor="engine-operation-refund-time">Refund available at (UTC)</label><input id="engine-operation-refund-time" type="datetime-local" value={refundTime} onChange={event => edit(() => setRefundTime(event.target.value))} required /><p className={styles.help}>The allowed window is {current.settlement?.minimumWindow.toString()}–{current.settlement?.maximumWindow.toString()} seconds from the transaction.</p></div> : null}
        {selected === "request" || selected === "fulfill" ? <div className={styles.field}><label htmlFor="engine-operation-reference">{selected === "request" ? "Obligation reference" : "Fulfillment reference"}</label><textarea id="engine-operation-reference" value={reference} onChange={event => edit(() => setReference(event.target.value))} required /><p className={styles.help}>A fingerprint of this reference is recorded permanently with the action.</p></div> : null}
        {selected === "buy" || selected === "sell" ? anyQuote ? <p className={styles.help}>Module fee: 0.3%. Creator fee: {selected === "buy" ? current.fees.buyCreatorBps / 100 : current.fees.sellCreatorBps / 100}%. {quoteFees ? "Fees accrue in the pool pair token." : "Fees convert to ETH on every trade."} The review includes ETH conversion costs and a 1% slippage limit. Gas is separate.</p> : <><div className={styles.field}><label htmlFor="engine-operation-route">Fee conversion route <span>Fixed by template</span></label><input id="engine-operation-route" readOnly value={routes.find(item => item.data === route)?.label ?? "No fixed route is available"} /></div><p className={styles.help}>Platform: {(current.fees.buyPlatformBps / 100).toFixed(2)}%. Creator: {selected === "buy" ? current.fees.buyCreatorBps / 100 : current.fees.sellCreatorBps / 100}%. The review uses a current contract simulation and 1% slippage limits for output and ETH fee conversion.</p></> : null}
      </fieldset><div className={engineStyles.actions}><button id="engine-action-review" type="submit" className={styles.primaryButton} disabled={busy || blocked || !canPrepare || Boolean(prepared)}>Review {selected === "fulfill" ? "fulfillment" : selected === "refund" ? "refund" : selected === "deposit" ? "deposit" : selected === "withdraw" ? "withdrawal" : selected === "request" ? "request" : "trade"}</button></div>{!canPrepare ? <p className={styles.help}>This action is not currently authorized for your wallet or its time condition has not been reached. Refresh to check again.</p> : null}</form> : null}
      {customPermission ? <form className={styles.formPanel} onSubmit={event => { event.preventDefault(); void prepareCustomAction(); }}><fieldset className={styles.formFields} disabled={busy || Boolean(prepared)}><h2>Advanced actions</h2><div className={styles.field}><label htmlFor="engine-custom-operation">Reviewed action</label><select id="engine-custom-operation" value={customPermission.operationId} onChange={event => edit(() => { setCustomOperationId(event.target.value); setCustomForm(emptyModuleEngineCustomOperation()); })}>{customPermissions.map((permission, index) => <option key={permission.operationId} value={permission.operationId}>Operation {index + 1} · {permission.operationId.slice(0, 8)}…{permission.operationId.slice(-8)}</option>)}</select></div><ModuleEngineCustomOperationFields id="engine-custom-action" permission={customPermission} value={customForm} account={wallet.account} onChange={value => edit(() => setCustomForm(value))} /></fieldset><div className={engineStyles.actions}><button id="engine-custom-action-review" type="submit" className={styles.primaryButton} disabled={busy || blocked || Boolean(prepared)}>Review action</button></div></form> : null}
      <section className={styles.formPanel}><h2>{quoteFees ? "Pool pair rewards" : "ETH fee claims"}</h2><dl className={styles.reviewRows}><div><dt>Claimable by your wallet</dt><dd>{formatUnits(current.fees.claimable, quoteFees ? current.quoteDecimals : 18)} {quoteFees ? "pool pair tokens" : "ETH"}</dd></div><div><dt>Already claimed</dt><dd>{formatUnits(current.fees.claimed, quoteFees ? current.quoteDecimals : 18)} {quoteFees ? "pool pair tokens" : "ETH"}</dd></div><div><dt>Accrued from this launch</dt><dd>{formatUnits(current.fees.contributionByLaunch, quoteFees ? current.quoteDecimals : 18)} {quoteFees ? "pool pair tokens" : "ETH"}</dd></div>{quoteFees ? <div><dt>Reward token</dt><dd>{current.launch.quoteAsset}</dd></div> : null}</dl><p className={styles.help}>{quoteFees ? "The full 0.3% module fee accrues to its designated recipient. Separate creator fees accrue to the creator recipients. Claiming sends your balance of this pool pair token to your wallet." : "Creator, author and platform allocations accrue to their entitled wallets. This claim withdraws your wallet’s total fee balance in this ledger to your wallet."}</p><div className={engineStyles.actions}><button id="engine-claim-review" type="button" className={styles.secondaryButton} disabled={busy || blocked || current.fees.claimable === 0n || Boolean(prepared)} onClick={() => void prepareClaim()}>{quoteFees ? "Review reward claim" : "Review ETH claim"}</button></div></section>
      <ModuleEngineFeeControls key={token + ":" + release.releaseDigest + ":" + current.actor} client={client} release={release} template={template} token={token} account={current.actor} disabled={busy || blocked || step !== "prepare" || Boolean(prepared)} onPrepare={prepareFeeChange} />
    </div> : <p className={styles.help}>{anyQuote && busy ? "Loading your trades and rewards…" : "Refresh to load your available actions and fee balances."}</p>}
    {approval && !prepared ? <div className={engineStyles.notice} role="status"><p>Allow the {anyQuote ? "swap router" : "contract"} to use exactly {current ? formatUnits(approval.amount, approval.token.toLowerCase() === token.toLowerCase() ? 18 : current.quoteDecimals) : approval.amount.toString()} tokens for this action.</p><button id="engine-operation-approval-review" type="button" className={styles.secondaryButton} disabled={busy || blocked} onClick={() => void prepareApproval()}>{approval.currentAllowance > 0n && approval.allowanceKind !== "permit2" ? "Review allowance reset" : "Review exact approval"}</button></div> : null}
    {prepared ? <ModuleEngineTransactionReview prepared={prepared} busy={busy} disabled={blocked || step !== "prepare"} onConfirm={() => void confirm()} onEdit={backToEdit} quoteAsset={current?.launch.quoteAsset} quoteDecimals={current?.quoteDecimals} anyQuote={anyQuote} genericAction={customReview} /> : null}
    {!prepared && feeReceipt?.account === wallet.account?.toLowerCase() && feeReceipt?.result.launch?.token === token.toLowerCase() ? <ModuleEngineFeeChangeReceipt result={feeReceipt.result} /> : null}
    {blocked ? <p className={engineStyles.notice} role="status">{blockedReason ?? "Resolve the pending operation before sending another transaction."}</p> : null}
    {error ? <p ref={errorFocus} tabIndex={-1} className={styles.fieldError} role="alert">{error}</p> : null}{notice ? <p className={engineStyles.notice} role="status">{notice}</p> : null}
  </section>;
}
