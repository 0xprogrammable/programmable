"use client";

import { useMemo, useState } from "react";
import { decodeAbiParameters, formatUnits, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep } from "@/components/module-mode-wallet-state";
import { parseExactUnits, utcDateTimeToSeconds } from "@/lib/module-mode/builder";
import { moduleAddress, moduleHash } from "@/lib/module-mode/release";
import type { ModuleEngineRelease, ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { createModuleEngineClient, ENGINE_OPERATIONS, moduleEngineDepositIntent, moduleEngineSettlementPaymentIntent, moduleEngineSettlementRequestIntent, moduleEngineTradeIntent, moduleEngineWithdrawalIntent, prepareModuleEngineApproval, prepareModuleEngineClaim, prepareModuleEngineOperation, quoteModuleEngineTrade, readModuleEngineAdministration, readModuleEngineQuoteAsset, type ModuleEngineAdministration, type ModuleEngineApprovalRequired, type ModuleEngineClient, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { ModuleEngineTransactionReview, type ModuleEngineWalletActions } from "./module-engine-transaction-review";
import styles from "@/components/module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

export interface ModuleEngineConsoleProps extends ModuleEngineWalletActions { release: ModuleEngineRelease; template: ModuleEngineTemplate; token: Address; client?: ModuleEngineClient }
type Action = "buy" | "sell" | "deposit" | "withdraw" | "request" | "fulfill" | "refund";
const labels: Record<Action, string> = { buy: "Buy tokens", sell: "Sell tokens", deposit: "Deposit quote tokens", withdraw: "Withdraw your deposit", request: "Create a funded request", fulfill: "Fulfill this request", refund: "Refund this request" };
export function ModuleEngineConsole({ release, template, token, client: suppliedClient, wallet, onConnect, onSwitch, onSubmit, blocked, blockedReason }: ModuleEngineConsoleProps) {
  const client = useMemo(() => suppliedClient ?? createModuleEngineClient(), [suppliedClient]);
  const [snapshot, setSnapshot] = useState<ModuleEngineAdministration | null>(null); const [action, setAction] = useState<Action | null>(null);
  const [amount, setAmount] = useState(""); const [recipient, setRecipient] = useState(""); const [requestId, setRequestId] = useState(""); const [refundTime, setRefundTime] = useState(""); const [reference, setReference] = useState("");
  const [routes, setRoutes] = useState<{ label: string; data: Hex }[]>([]); const [route, setRoute] = useState("");
  const [prepared, setPrepared] = useState<PreparedModuleEngineTransaction | null>(null); const [approval, setApproval] = useState<ModuleEngineApprovalRequired | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const step = moduleModeWalletStep(wallet), profile = template.manifest.manifest.catalogDefinition.interface;
  const current = snapshot?.actor.toLowerCase() === wallet.account?.toLowerCase() && snapshot?.launch.token.toLowerCase() === token.toLowerCase() ? snapshot : null;
  const expectedActions: Action[] = profile === "quote-v1" ? ["buy", "sell"] : profile === "escrow-v1" ? ["deposit", "withdraw"] : profile === "settlement-v1" ? ["request", "fulfill", "refund"] : [];
  const actions = expectedActions.filter(key => current?.permissions.some(p => p.operationId === ENGINE_OPERATIONS[key] && (p.authorization === 0 || current.actor === current.launch.creator)));
  const selected = action && actions.includes(action) ? action : actions[0];
  const request = current?.settlement?.request;
  const canPrepare = Boolean(current && selected && (selected !== "fulfill" || current.settlement?.canFulfill) && (selected !== "refund" || current.settlement?.canRefund) && (selected !== "withdraw" || current.escrow && current.escrow.credit > 0n && current.timestamp >= current.escrow.unlockTime));
  const humanError = (caught: unknown) => caught instanceof Error ? caught.message : "The engine state could not be verified.";
  function edit(change: () => void) { change(); setPrepared(null); setApproval(null); setError(null); }
  async function refresh() {
    if (!wallet.account) return; setBusy(true); setError(null);
    try { const account = moduleAddress(wallet.account, "account"); const state = await readModuleEngineAdministration({ client, release, template, token, account, ...(requestId.trim() ? { requestId: moduleHash(requestId.trim(), "request ID") } : {}) }); setSnapshot(state); if (profile === "quote-v1") { const quote = await readModuleEngineQuoteAsset({ client, release, template, quoteAsset: state.launch.quoteAsset, account, existingToken: token }); setRoutes(quote.routes); setRoute(quote.routes[0]?.data ?? ""); } }
    catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function prepareAction() {
    if (!current || !selected || !wallet.account) return; setBusy(true); setError(null); setNotice(null);
    try {
      const account = moduleAddress(wallet.account, "account"); assertModuleModeWalletUnchanged(wallet, account);
      const quoteAsset = current.launch.quoteAsset, target = recipient.trim() ? moduleAddress(recipient.trim(), "recipient") : account;
      let result;
      if (selected === "buy" || selected === "sell") {
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
  async function prepareClaim() {
    if (!wallet.account) return; setBusy(true); setError(null);
    try { const account = moduleAddress(wallet.account, "account"); setPrepared(await prepareModuleEngineClaim({ client, release, token, account, recipient: account })); } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function prepareApproval() {
    if (!approval || !wallet.account) return; setBusy(true); setError(null);
    try { setPrepared(await prepareModuleEngineApproval({ client, release, account: moduleAddress(wallet.account, "account"), token: approval.token, amount: approval.currentAllowance > 0n ? 0n : approval.amount })); } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!prepared) return; setBusy(true); setError(null);
    try {
      assertModuleModeWalletUnchanged(wallet, prepared.account); if (prepared.releaseDigest !== release.releaseDigest) throw new Error("The selected source release changed. Review again.");
      const result = await onSubmit(prepared);
      if (prepared.kind === "execute" && prepared.operation.operationId === ENGINE_OPERATIONS.request) { const [id] = decodeAbiParameters(parseAbiParameters("bytes32"), prepared.result); setRequestId(id); }
      setPrepared(null); setApproval(null); setSnapshot(null); setNotice(`Transaction mined: ${result.transactionHash}. Refresh the engine state to read the updated balances. Finality is still pending.`);
    } catch (caught) { setError(humanError(caught)); } finally { setBusy(false); }
  }
  return <section className={`${styles.page} ${engineStyles.root}`} aria-labelledby="engine-console-title">
    <header className={styles.heading}><div className={styles.titleRow}><h1 id="engine-console-title">{template.manifest.manifest.catalogDefinition.title}</h1></div><p>Manage this engine and claim the ETH fees owed to your wallet.</p><code className={engineStyles.inlineCode}>{token}</code></header>
    <div className={engineStyles.actions}>{step === "connect" ? <button className={styles.primaryButton} onClick={() => void onConnect()}>Connect wallet</button> : step === "switch" ? <button className={styles.primaryButton} onClick={() => void onSwitch()}>Switch to Robinhood Chain</button> : <button className={styles.secondaryButton} onClick={() => void refresh()} disabled={busy}>{busy ? "Checking engine…" : "Refresh engine state"}</button>}</div>
    {profile === "settlement-v1" ? <div className={styles.field}><label htmlFor="engine-request-id">Existing request ID <span>Optional</span></label><input id="engine-request-id" value={requestId} placeholder="0x…" spellCheck={false} onChange={event => edit(() => { setRequestId(event.target.value); setSnapshot(null); })} /><p className={styles.help}>Refresh after entering an ID to read its beneficiary, amount, status and refund time.</p></div> : null}
    {current ? <div className={engineStyles.stack}>
      <section className={styles.formPanel}><h2>Engine state</h2><dl className={styles.reviewRows}><div><dt>Quote asset</dt><dd>{current.launch.quoteAsset}</dd></div><div><dt>Creator</dt><dd>{current.launch.creator}</dd></div><div><dt>Verified block</dt><dd>{current.blockNumber.toString()}</dd></div>
        {current.escrow ? <><div><dt>Your deposited balance</dt><dd>{formatUnits(current.escrow.credit, current.quoteDecimals)} quote tokens</dd></div><div><dt>Withdrawals open</dt><dd>{new Date(Number(current.escrow.unlockTime) * 1000).toISOString().replace("T", " ")}</dd></div></> : null}
        {request ? <><div><dt>Request status</dt><dd>{["", "Pending", "Fulfilled", "Refunded"][request.status]}</dd></div><div><dt>Payer</dt><dd>{request.payer}</dd></div><div><dt>Beneficiary</dt><dd>{request.beneficiary}</dd></div><div><dt>Funded amount</dt><dd>{formatUnits(request.amount, current.quoteDecimals)} quote tokens</dd></div><div><dt>Refund available</dt><dd>{new Date(Number(request.refundAfter) * 1000).toISOString().replace("T", " ")}</dd></div><div><dt>Obligation hash</dt><dd>{request.obligationHash}</dd></div></> : null}
      </dl>{current.settlement ? <p className={styles.help}>The creator attests fulfillment before the refund time. The recorded evidence is an attestation, not an independent oracle proof. After the refund time, only the payer can reclaim the funds.</p> : null}</section>
      {selected ? <form className={styles.formPanel} onSubmit={event => { event.preventDefault(); void prepareAction(); }}><fieldset className={styles.formFields} disabled={busy || Boolean(prepared)}><h2>Operation</h2><div className={styles.field}><label htmlFor="engine-operation">Action</label><select id="engine-operation" value={selected} onChange={event => edit(() => { setAction(event.target.value as Action); setReference(""); setRecipient(""); })}>{actions.map(key => <option key={key} value={key}>{labels[key]}</option>)}</select></div>
        {!["fulfill", "refund"].includes(selected) ? <div className={styles.field}><label htmlFor="engine-operation-amount">{selected === "sell" ? "Token" : "Quote"} amount</label><input id="engine-operation-amount" inputMode="decimal" value={amount} onChange={event => edit(() => setAmount(event.target.value))} required /></div> : null}
        {!["deposit", "fulfill", "refund"].includes(selected) ? <div className={styles.field}><label htmlFor="engine-operation-recipient">{selected === "request" ? "Fixed beneficiary wallet" : "Recipient wallet"}</label><input id="engine-operation-recipient" value={recipient} placeholder={selected === "request" ? "0x…" : wallet.account} spellCheck={false} onChange={event => edit(() => setRecipient(event.target.value))} /></div> : null}
        {selected === "request" ? <div className={styles.field}><label htmlFor="engine-operation-refund-time">Refund available at (UTC)</label><input id="engine-operation-refund-time" type="datetime-local" value={refundTime} onChange={event => edit(() => setRefundTime(event.target.value))} required /><p className={styles.help}>The allowed window is {current.settlement?.minimumWindow.toString()}–{current.settlement?.maximumWindow.toString()} seconds from the transaction.</p></div> : null}
        {selected === "request" || selected === "fulfill" ? <div className={styles.field}><label htmlFor="engine-operation-reference">{selected === "request" ? "Obligation reference" : "Fulfillment reference"}</label><textarea id="engine-operation-reference" value={reference} onChange={event => edit(() => setReference(event.target.value))} required /><p className={styles.help}>The UTF-8 reference is hashed and permanently bound to this action.</p></div> : null}
        {selected === "buy" || selected === "sell" ? <><div className={styles.field}><label htmlFor="engine-operation-route">Fee conversion route <span>Fixed by template</span></label><input id="engine-operation-route" readOnly value={routes.find(item => item.data === route)?.label ?? "No fixed route is available"} /></div><p className={styles.help}>Platform: {(current.fees.buyPlatformBps / 100).toFixed(2)}%. Creator: {selected === "buy" ? current.fees.buyCreatorBps / 100 : current.fees.sellCreatorBps / 100}%. The review uses a current contract simulation and 1% slippage limits for output and ETH fee conversion.</p></> : null}
      </fieldset><div className={engineStyles.actions}><button type="submit" className={styles.primaryButton} disabled={busy || blocked || !canPrepare || Boolean(prepared)}>Review {selected === "fulfill" ? "fulfillment" : selected === "refund" ? "refund" : "operation"}</button></div>{!canPrepare ? <p className={styles.help}>This action is not currently authorized for your wallet or its time condition has not been reached. Refresh to check again.</p> : null}</form> : null}
      <section className={styles.formPanel}><h2>ETH fee claims</h2><dl className={styles.reviewRows}><div><dt>Claimable by your wallet</dt><dd>{formatUnits(current.fees.claimable, 18)} ETH</dd></div><div><dt>Already claimed</dt><dd>{formatUnits(current.fees.claimed, 18)} ETH</dd></div><div><dt>Accrued from this launch</dt><dd>{formatUnits(current.fees.contributionByLaunch, 18)} ETH</dd></div></dl><p className={styles.help}>Creator, author and platform allocations accrue to their entitled wallets. This claim withdraws your wallet’s total balance in this engine ledger to your wallet.</p><div className={engineStyles.actions}><button type="button" className={styles.secondaryButton} disabled={busy || blocked || current.fees.claimable === 0n || Boolean(prepared)} onClick={() => void prepareClaim()}>Review ETH claim</button></div></section>
    </div> : <p className={styles.help}>Load the bound engine to read your current operation rights and fee balances.</p>}
    {approval && !prepared ? <div className={engineStyles.notice} role="status"><p>The host needs an exact token allowance of {approval.amount.toString()} base units.</p><button type="button" className={styles.secondaryButton} disabled={busy || blocked} onClick={() => void prepareApproval()}>{approval.currentAllowance > 0n ? "Review allowance reset" : "Review exact approval"}</button></div> : null}
    {prepared ? <ModuleEngineTransactionReview prepared={prepared} busy={busy} disabled={blocked || step !== "prepare"} onConfirm={() => void confirm()} onEdit={() => setPrepared(null)} /> : null}
    {blocked ? <p className={engineStyles.notice} role="status">{blockedReason ?? "Resolve the pending operation before sending another transaction."}</p> : null}
    {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}{notice ? <p className={engineStyles.notice} role="status">{notice}</p> : null}
  </section>;
}
