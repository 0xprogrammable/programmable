"use client";

import { decodeAbiParameters, formatUnits, keccak256, parseAbiParameters, type Address } from "viem";
import { useEffect, useRef, type ReactNode } from "react";
import type { ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { ENGINE_OPERATIONS, type ModuleEngineReceiptResult, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { moduleEngineTradeLimitsParameters } from "@/lib/module-engine/abi";
import { moduleEngineUtcTimestamp } from "@/lib/module-engine/presentation";
import styles from "@/components/module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

/** The host supplies the existing wallet, session checks, account lock and durable recovery path. */
export interface ModuleEngineWalletActions {
  wallet: ModuleModeWalletSnapshot;
  onConnect: () => Promise<void> | void;
  onSwitch: () => Promise<void> | void;
  onSubmit: (prepared: PreparedModuleEngineTransaction) => Promise<ModuleEngineReceiptResult>;
  blocked?: boolean;
  blockedReason?: string;
}
const operationLabels = { buy: "Buy tokens", sell: "Sell tokens", deposit: "Deposit quote tokens", withdraw: "Withdraw your deposit", request: "Fund a settlement request", fulfill: "Fulfill the request", refund: "Refund the request" };
export function ModuleEngineTransactionReview({ prepared, busy, disabled, onConfirm, onEdit, children, quoteAsset, quoteDecimals, tradeFees = false }: { prepared: PreparedModuleEngineTransaction; busy: boolean; disabled?: boolean; onConfirm: () => void; onEdit: () => void; children?: ReactNode; quoteAsset?: Address; quoteDecimals?: number; tradeFees?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [prepared]);
  const operation = prepared.kind === "execute" ? prepared.operation : prepared.kind === "launch" ? prepared.initialOperation : null;
  const action = operation ? Object.entries(ENGINE_OPERATIONS).find(([, id]) => id === operation.operationId)?.[0] as keyof typeof operationLabels | undefined : undefined;
  const primaryToken = prepared.kind === "launch" ? prepared.predictedToken : prepared.kind === "execute" ? prepared.token : undefined;
  const quote = prepared.kind === "launch" ? prepared.quoteAsset : quoteAsset;
  const decimals = prepared.kind === "launch" ? prepared.quoteDecimals : quoteDecimals;
  let invalidDetails = false;
  const actionRows: { label: string; value: string }[] = [], referenceRows: { label: string; value: string }[] = [];
  try {
    if (operation && action === "request") {
      const [beneficiary, refundAfter, reference] = decodeAbiParameters(parseAbiParameters("address,uint256,bytes32"), operation.data);
      actionRows.push({ label: "Beneficiary wallet", value: beneficiary }, { label: "Refund opens", value: moduleEngineUtcTimestamp(refundAfter) });
      referenceRows.push({ label: "Obligation fingerprint", value: reference });
    } else if (operation && (action === "buy" || action === "sell")) {
      const [limits] = decodeAbiParameters(moduleEngineTradeLimitsParameters, operation.data);
      actionRows.push({ label: "Minimum ETH from fee conversion", value: `${formatUnits(limits.minimumEthFees, 18)} ETH` });
    } else if (operation && (action === "fulfill" || action === "refund")) {
      const [requestId] = decodeAbiParameters(parseAbiParameters("bytes32"), operation.data);
      actionRows.push({ label: "Request", value: requestId });
      if (action === "fulfill") { const [, reference] = decodeAbiParameters(parseAbiParameters("bytes32,bytes32"), operation.data); referenceRows.push({ label: "Fulfillment fingerprint", value: reference }); }
    }
  } catch { invalidDetails = true; }
  function amount(value: bigint, asset: Address) {
    if (asset.toLowerCase() === quote?.toLowerCase() && decimals !== undefined) return `${formatUnits(value, decimals)} quote ${value === 10n ** BigInt(decimals) ? "token" : "tokens"}`;
    if (asset.toLowerCase() === primaryToken?.toLowerCase()) return `${formatUnits(value, 18)} ${value === 10n ** 18n ? "token" : "tokens"}`;
    return `${value} token base units`;
  }
  return <section className={`${styles.formPanel} ${engineStyles.review}`} aria-labelledby="engine-review-title">
    <h2 ref={heading} id="engine-review-title" tabIndex={-1}>Review {prepared.kind === "launch" ? "launch" : prepared.kind === "approve" ? "token approval" : prepared.kind === "claim" ? "ETH claim" : "action"}</h2>
    {children}
    <dl className={styles.reviewRows}>
      <div><dt>Network</dt><dd>Robinhood Chain · 4663</dd></div>
      <div><dt>Wallet</dt><dd>{prepared.account}</dd></div>
      <div><dt>Contract</dt><dd>{prepared.transaction.to}</dd></div>
      <div><dt>ETH sent</dt><dd>{formatUnits(BigInt(prepared.transaction.value), 18)} ETH, plus network gas</dd></div>
      {prepared.kind === "launch" ? <><div><dt>New token</dt><dd>{prepared.predictedToken}</dd></div><div><dt>Quote asset</dt><dd>{prepared.quoteAsset}</dd></div>{tradeFees ? <><div><dt>Platform trade fee</dt><dd>{(prepared.platformFeeBps / 100).toFixed(2)}%</dd></div><div><dt>Creator trade fees</dt><dd>{prepared.buyCreatorFeeBps / 100}% buy · {prepared.sellCreatorFeeBps / 100}% sell</dd></div></> : null}</> : null}
      {prepared.kind === "approve" ? <><div><dt>Token</dt><dd>{prepared.token}</dd></div><div><dt>Spender</dt><dd>{prepared.spender}</dd></div><div><dt>Exact allowance</dt><dd>{amount(prepared.amount, prepared.token)}</dd></div></> : null}
      {prepared.kind === "claim" ? <><div><dt>Claim recipient</dt><dd>{prepared.recipient}</dd></div><div><dt>Accrued amount</dt><dd>At least {formatUnits(prepared.minimumAmount, 18)} ETH</dd></div></> : null}
      {operation && BigInt(operation.operationId) !== 0n ? <><div><dt>Action</dt><dd>{action ? operationLabels[action] : "Template action"}</dd></div>{action !== "request" ? <div><dt>Recipient</dt><dd>{operation.recipient}</dd></div> : null}<div><dt>You send</dt><dd>{operation.inputAmount === 0n ? "No tokens" : amount(operation.inputAmount, operation.inputAsset)}</dd></div><div><dt>Minimum received</dt><dd>{operation.minimumOutput === 0n ? "No token payout in this action" : amount(operation.minimumOutput, operation.outputAsset)}</dd></div>{actionRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</> : null}
    </dl>
    {invalidDetails ? <p role="alert">The action details could not be read. Return to the form and prepare again.</p> : null}
    <details className={engineStyles.details}><summary>Transaction data and contract details</summary><dl className={styles.reviewRows}>{prepared.kind === "launch" ? <div><dt>Execution contract</dt><dd>{prepared.engine}</dd></div> : null}{prepared.kind === "approve" ? <div><dt>Allowance in base units</dt><dd>{prepared.amount.toString()}</dd></div> : null}{operation && BigInt(operation.operationId) !== 0n ? <><div><dt>Operation ID</dt><dd>{operation.operationId}</dd></div><div><dt>Input asset / base units</dt><dd>{operation.inputAsset} · {operation.inputAmount.toString()}</dd></div><div><dt>Output asset / minimum base units</dt><dd>{operation.outputAsset} · {operation.minimumOutput.toString()}</dd></div><div><dt>Account nonce</dt><dd>{operation.nonce.toString()}</dd></div>{referenceRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</> : null}<div><dt>Release</dt><dd>{prepared.releaseDigest}</dd></div><div><dt>Calldata hash</dt><dd>{keccak256(prepared.transaction.data)}</dd></div><div><dt>Valid until</dt><dd>{moduleEngineUtcTimestamp(prepared.expiresAt)}</dd></div><div><dt>Simulated block</dt><dd>{prepared.blockNumber.toString()}</dd></div><div><dt>Gas estimate</dt><dd>{prepared.gasEstimate.toString()}</dd></div></dl><code className={engineStyles.calldata}>{prepared.transaction.data}</code></details>
    <p className={styles.help}>Your wallet opens after you confirm this review. Contract identity, funding and current permissions are checked again before submission.</p>
    <div className={styles.reviewActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={onEdit}>Back to edit</button><button type="button" className={styles.primaryButton} disabled={busy || disabled || invalidDetails} onClick={onConfirm}>{busy ? "Checking transaction…" : "Confirm in wallet"}</button></div>
  </section>;
}
