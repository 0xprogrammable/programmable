"use client";

import { formatUnits, keccak256 } from "viem";
import type { ReactNode } from "react";
import type { ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import type { ModuleEngineReceiptResult, PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
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
export function ModuleEngineTransactionReview({ prepared, busy, disabled, onConfirm, onEdit, children }: { prepared: PreparedModuleEngineTransaction; busy: boolean; disabled?: boolean; onConfirm: () => void; onEdit: () => void; children?: ReactNode }) {
  const operation = prepared.kind === "execute" ? prepared.operation : prepared.kind === "launch" ? prepared.initialOperation : null;
  return <section className={`${styles.formPanel} ${engineStyles.review}`} aria-labelledby="engine-review-title">
    <h2 id="engine-review-title" tabIndex={-1}>Review {prepared.kind === "launch" ? "launch" : prepared.kind === "approve" ? "token approval" : prepared.kind === "claim" ? "ETH claim" : "operation"}</h2>
    {children}
    <dl className={styles.reviewRows}>
      <div><dt>Network</dt><dd>Robinhood Chain · 4663</dd></div>
      <div><dt>Wallet</dt><dd>{prepared.account}</dd></div>
      <div><dt>Contract receiving the call</dt><dd>{prepared.transaction.to}</dd></div>
      <div><dt>ETH sent</dt><dd>{formatUnits(BigInt(prepared.transaction.value), 18)} ETH, plus network gas</dd></div>
      {prepared.kind === "launch" ? <><div><dt>New token</dt><dd>{prepared.predictedToken}</dd></div><div><dt>Engine</dt><dd>{prepared.engine}</dd></div><div><dt>Quote asset</dt><dd>{prepared.quoteAsset}</dd></div><div><dt>Platform trade fee</dt><dd>{(prepared.platformFeeBps / 100).toFixed(2)}%</dd></div><div><dt>Creator trade fees</dt><dd>{prepared.buyCreatorFeeBps / 100}% buy · {prepared.sellCreatorFeeBps / 100}% sell</dd></div></> : null}
      {prepared.kind === "approve" ? <><div><dt>Token</dt><dd>{prepared.token}</dd></div><div><dt>Spender</dt><dd>{prepared.spender}</dd></div><div><dt>Exact allowance</dt><dd>{prepared.amount.toString()} token base units</dd></div></> : null}
      {prepared.kind === "claim" ? <><div><dt>Claim recipient</dt><dd>{prepared.recipient}</dd></div><div><dt>Accrued amount</dt><dd>At least {formatUnits(prepared.minimumAmount, 18)} ETH</dd></div></> : null}
      {operation && BigInt(operation.operationId) !== 0n ? <><div><dt>Operation</dt><dd>{operation.operationId}</dd></div><div><dt>Recipient</dt><dd>{operation.recipient}</dd></div><div><dt>Input</dt><dd>{operation.inputAmount.toString()} base units · {operation.inputAsset}</dd></div><div><dt>Minimum output</dt><dd>{operation.minimumOutput.toString()} base units · {operation.outputAsset}</dd></div><div><dt>Account nonce</dt><dd>{operation.nonce.toString()}</dd></div></> : null}
    </dl>
    <details className={engineStyles.details}><summary>Transaction data and source binding</summary><dl className={styles.reviewRows}><div><dt>Release</dt><dd>{prepared.releaseDigest}</dd></div><div><dt>Calldata hash</dt><dd>{keccak256(prepared.transaction.data)}</dd></div><div><dt>Simulated block</dt><dd>{prepared.blockNumber.toString()}</dd></div><div><dt>Gas estimate</dt><dd>{prepared.gasEstimate.toString()}</dd></div></dl><code className={engineStyles.calldata}>{prepared.transaction.data}</code></details>
    <p className={styles.help}>Your wallet opens after you confirm this review. Contract identity, funding and current permissions are checked again before submission.</p>
    <div className={styles.reviewActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={onEdit}>Back to edit</button><button type="button" className={styles.primaryButton} disabled={busy || disabled} onClick={onConfirm}>{busy ? "Checking transaction…" : "Confirm in wallet"}</button></div>
  </section>;
}
