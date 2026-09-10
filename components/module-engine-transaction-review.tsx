"use client";

import { decodeAbiParameters, decodeFunctionData, formatUnits, keccak256, parseAbiParameters, type Address } from "viem";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ModuleModeWalletSnapshot } from "@/components/module-mode-wallet-state";
import { ENGINE_OPERATIONS, isModuleEngineFeeTransaction, type ModuleEngineReceiptResult, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { moduleEngineHostAbi, moduleEngineTradeLimitsParameters } from "@/lib/module-engine/abi";
import { moduleEngineUtcTimestamp } from "@/lib/module-engine/presentation";
import { ModuleEngineFeeChangeReview } from "./module-engine-fee-controls";
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
function approximateFdv(value: { numerator: string; denominator: string }) {
  try {
    const cents = BigInt(value.numerator) * 100n / BigInt(value.denominator);
    const dollars = Number(formatUnits(cents, 2));
    return Number.isFinite(dollars) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(dollars) : "Unavailable";
  } catch { return "Unavailable"; }
}
export function ModuleEngineTransactionReview({ prepared, busy, disabled, onConfirm, onEdit, children, quoteAsset, quoteDecimals, quoteSymbol, anyQuote = false, tradeFees = false, genericAction = false, showLaunchInputs = false }: { prepared: PreparedModuleEngineTransaction; busy: boolean; disabled?: boolean; onConfirm: () => void; onEdit: () => void; children?: ReactNode; quoteAsset?: Address; quoteDecimals?: number; quoteSymbol?: string; anyQuote?: boolean; tradeFees?: boolean; genericAction?: boolean; showLaunchInputs?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [expiredPreparation, setExpiredPreparation] = useState<PreparedModuleEngineTransaction | null>(null);
  useEffect(() => { heading.current?.focus(); }, [prepared]);
  useEffect(() => {
    if (!anyQuote) return;
    const timer = setTimeout(() => setExpiredPreparation(prepared), Math.max(0, Number(prepared.expiresAt) * 1_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [anyQuote, prepared]);
  const expired = anyQuote && expiredPreparation === prepared;
  const operation = prepared.kind === "execute" ? prepared.operation : prepared.kind === "launch" ? prepared.initialOperation : null;
  const action = anyQuote && prepared.kind === "launch" && operation && BigInt(operation.operationId) !== 0n ? "buy" : operation && !genericAction ? Object.entries(ENGINE_OPERATIONS).find(([, id]) => id === operation.operationId)?.[0] as keyof typeof operationLabels | undefined : undefined;
  const primaryToken = prepared.kind === "launch" ? prepared.predictedToken : prepared.kind === "execute" || prepared.kind === "swap" || anyQuote && prepared.kind === "approve" ? prepared.token : undefined;
  const quote = prepared.kind === "launch" || prepared.kind === "swap" ? prepared.quoteAsset : quoteAsset;
  const decimals = prepared.kind === "launch" || prepared.kind === "swap" ? prepared.quoteDecimals : quoteDecimals;
  let invalidDetails = false;
  const actionRows: { label: string; value: string }[] = [], referenceRows: { label: string; value: string }[] = [];
  try {
    if (showLaunchInputs && prepared.kind === "launch") {
      const decoded = decodeFunctionData({ abi: moduleEngineHostAbi, data: prepared.transaction.data });
      if (decoded.functionName !== "launch") throw new Error("Expected launch transaction.");
      const inputs = decoded.args?.[0] as { creatorSalt?: unknown; engineSalt?: unknown; launchData?: unknown } | undefined;
      if (typeof inputs?.creatorSalt !== "string" || typeof inputs.engineSalt !== "string" || typeof inputs.launchData !== "string") throw new Error("Invalid launch inputs.");
      referenceRows.push({ label: "Creator salt", value: inputs.creatorSalt }, { label: "Engine salt", value: inputs.engineSalt }, { label: "Initialization data", value: inputs.launchData });
    }
    if (operation && action === "request") {
      const [beneficiary, refundAfter, reference] = decodeAbiParameters(parseAbiParameters("address,uint256,bytes32"), operation.data);
      actionRows.push({ label: "Beneficiary wallet", value: beneficiary }, { label: "Refund opens", value: moduleEngineUtcTimestamp(refundAfter) });
      referenceRows.push({ label: "Obligation fingerprint", value: reference });
    } else if (operation && !anyQuote && (action === "buy" || action === "sell")) {
      const [limits] = decodeAbiParameters(moduleEngineTradeLimitsParameters, operation.data);
      actionRows.push({ label: "Minimum ETH from fee conversion", value: `${formatUnits(limits.minimumEthFees, 18)} ETH` });
    } else if (operation && (action === "fulfill" || action === "refund")) {
      const [requestId] = decodeAbiParameters(parseAbiParameters("bytes32"), operation.data);
      actionRows.push({ label: "Request", value: requestId });
      if (action === "fulfill") { const [, reference] = decodeAbiParameters(parseAbiParameters("bytes32,bytes32"), operation.data); referenceRows.push({ label: "Fulfillment fingerprint", value: reference }); }
    }
  } catch { invalidDetails = true; }
  function amount(value: bigint, asset: Address) {
    if (BigInt(asset) === 0n) return `${formatUnits(value, 18)} ETH`;
    if (asset.toLowerCase() === quote?.toLowerCase() && decimals !== undefined) return `${formatUnits(value, decimals)} ${quoteSymbol || `quote ${value === 10n ** BigInt(decimals) ? "token" : "tokens"}`}`;
    if (asset.toLowerCase() === primaryToken?.toLowerCase()) return `${formatUnits(value, 18)} ${value === 10n ** 18n ? "token" : "tokens"}`;
    return `${value} token base units`;
  }
  return <section className={`${styles.formPanel} ${engineStyles.review}`} aria-labelledby="engine-review-title">
    <h2 ref={heading} id="engine-review-title" tabIndex={-1}>Review {prepared.kind === "launch" ? "launch" : prepared.kind === "swap" ? prepared.buy ? "buy" : "sell" : prepared.kind === "approve" ? "token approval" : prepared.kind === "claim" ? anyQuote ? "reward claim" : "ETH claim" : prepared.kind === "rotate-author" ? "author fee wallet" : prepared.kind === "rotate-platform" ? "module fee wallet" : isModuleEngineFeeTransaction(prepared) ? "creator fee recipients" : "action"}</h2>
    {children}
    {isModuleEngineFeeTransaction(prepared) ? <ModuleEngineFeeChangeReview prepared={prepared} /> : null}
    <dl className={styles.reviewRows}>
      <div><dt>Network</dt><dd>Robinhood Chain · 4663</dd></div>
      <div><dt>Wallet</dt><dd>{prepared.account}</dd></div>
      <div><dt>Contract</dt><dd>{prepared.transaction.to}</dd></div>
      <div><dt>ETH sent</dt><dd>{formatUnits(BigInt(prepared.transaction.value), 18)} ETH, plus network gas</dd></div>
      {prepared.kind === "launch" ? <><div><dt>New token</dt><dd>{prepared.predictedToken}</dd></div><div><dt>{anyQuote ? "Pool pair token" : "Quote asset"}</dt><dd>{quoteSymbol ? `${quoteSymbol} · ` : ""}{prepared.quoteAsset}</dd></div>{tradeFees ? <><div><dt>{anyQuote ? "Fixed module fee" : showLaunchInputs ? "Registered platform fee" : "Platform trade fee"}</dt><dd>{(prepared.platformFeeBps / 100).toFixed(2)}%{anyQuote ? " on buys and sells, in the pool pair token" : ""}</dd></div><div><dt>{showLaunchInputs ? "Registered creator fees" : "Creator trade fees"}</dt><dd>{prepared.buyCreatorFeeBps / 100}% buy · {prepared.sellCreatorFeeBps / 100}% sell{anyQuote ? ", fixed at launch" : ""}</dd></div></> : null}{anyQuote ? <><div><dt>Supply</dt><dd>1,000,000,000 coins</dd></div><div><dt>Liquidity</dt><dd>Permanently locked, funded with the new coins</dd></div></> : null}</> : null}
      {prepared.kind === "launch" && prepared.anyQuote ? <><div><dt>Approx. starting FDV</dt><dd>{approximateFdv(prepared.anyQuote.actualFdvUsd)}</dd></div><div><dt>Initial buy</dt><dd>{prepared.anyQuote.initialBuyWei > 0n ? `${formatUnits(prepared.anyQuote.initialBuyWei, 18)} ETH` : "None"}</dd></div>{prepared.anyQuote.initialBuyWei > 0n ? <div><dt>Estimated initial coins</dt><dd>{formatUnits(prepared.anyQuote.outputAmount, 18)} tokens</dd></div> : null}</> : null}
      {prepared.kind === "approve" ? <><div><dt>Token</dt><dd>{prepared.token}</dd></div><div><dt>{prepared.allowanceKind === "permit2" ? "Allowance manager" : "Spender"}</dt><dd>{prepared.spender}</dd></div>{prepared.allowanceKind === "permit2" ? <><div><dt>Authorized swap router</dt><dd>{prepared.permit2Spender}</dd></div><div><dt>Allowance expires</dt><dd>{prepared.expiration ? moduleEngineUtcTimestamp(prepared.expiration) : "Unavailable"}</dd></div></> : null}<div><dt>Exact allowance</dt><dd>{amount(prepared.amount, prepared.token)}</dd></div></> : null}
      {prepared.kind === "claim" ? <><div><dt>Claim recipient</dt><dd>{prepared.recipient}</dd></div><div><dt>Accrued amount</dt><dd>At least {formatUnits(prepared.minimumAmount, prepared.feeDecimals ?? (anyQuote ? decimals ?? 18 : 18))} {anyQuote ? quoteSymbol || "pool pair tokens" : "ETH"}</dd></div>{anyQuote ? <div><dt>Reward token</dt><dd>{prepared.feeAsset ?? quote}</dd></div> : null}</> : null}
      {prepared.kind === "swap" ? <><div><dt>Action</dt><dd>{prepared.buy ? "Buy with ETH" : "Sell to ETH"}</dd></div><div><dt>Recipient</dt><dd>{prepared.recipient}</dd></div><div><dt>You send</dt><dd>{formatUnits(prepared.inputAmount, 18)} {prepared.buy ? "ETH" : "tokens"}</dd></div><div><dt>Estimated received</dt><dd>{formatUnits(prepared.outputAmount, 18)} {prepared.buy ? "tokens" : "ETH"}</dd></div><div><dt>Minimum received</dt><dd>{formatUnits(prepared.minimumOutput, 18)} {prepared.buy ? "tokens" : "ETH"}</dd></div><div><dt>Pool pair token</dt><dd>{quoteSymbol ? `${quoteSymbol} · ` : ""}{prepared.quoteAsset}</dd></div></> : null}
      {operation && BigInt(operation.operationId) !== 0n ? <><div><dt>Action</dt><dd>{action ? operationLabels[action] : "Template action"}</dd></div>{action !== "request" ? <div><dt>Recipient</dt><dd>{operation.recipient}</dd></div> : null}<div><dt>You send</dt><dd>{operation.inputAmount === 0n ? "No tokens" : amount(operation.inputAmount, operation.inputAsset)}</dd></div><div><dt>Minimum received</dt><dd>{operation.minimumOutput === 0n ? genericAction ? "No minimum output required" : "No token payout in this action" : amount(operation.minimumOutput, operation.outputAsset)}</dd></div>{actionRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</> : null}
    </dl>
    {anyQuote && (prepared.kind === "launch" || prepared.kind === "swap") ? <p className={styles.help}>The module fee is 0.3% per buy and sell. Creator fees are separate. Both accrue in the pool pair token. The received amount includes ETH conversion costs; network gas is separate.</p> : null}
    {anyQuote && prepared.kind === "approve" ? <p className={styles.help}>{prepared.amount === 0n ? "This resets the previous allowance." : "This approves the exact sell amount."} Review the trade again after approval is confirmed.</p> : null}
    {genericAction && operation ? <div className={engineStyles.notice}><p>Review this action against the template author’s instructions. The website has checked the host transaction and its asset permissions; it does not decode the action data.</p><p>Action data</p><code className={engineStyles.calldata}>{operation.data}</code></div> : null}
    {invalidDetails ? <p role="alert">The action details could not be read. Return to the form and prepare again.</p> : null}
    {expired ? <p role="status" className={engineStyles.notice}>{prepared.kind === "launch" || prepared.kind === "swap" ? "This quote expired. Go back to prepare a current price and route before signing." : "This review expired. Go back to refresh the transaction before signing."}</p> : null}
    <details className={engineStyles.details}><summary>Transaction data and contract details</summary><dl className={styles.reviewRows}>{prepared.kind === "launch" ? <div><dt>Execution contract</dt><dd>{prepared.engine}</dd></div> : null}{prepared.kind === "approve" ? <div><dt>Allowance in base units</dt><dd>{prepared.amount.toString()}</dd></div> : null}{operation && BigInt(operation.operationId) !== 0n ? <><div><dt>Operation ID</dt><dd>{operation.operationId}</dd></div><div><dt>Input asset / base units</dt><dd>{operation.inputAsset} · {operation.inputAmount.toString()}</dd></div><div><dt>Output asset / minimum base units</dt><dd>{operation.outputAsset} · {operation.minimumOutput.toString()}</dd></div><div><dt>Account nonce</dt><dd>{operation.nonce.toString()}</dd></div></> : null}{referenceRows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}<div><dt>Release</dt><dd>{prepared.releaseDigest}</dd></div><div><dt>Calldata hash</dt><dd>{keccak256(prepared.transaction.data)}</dd></div><div><dt>{isModuleEngineFeeTransaction(prepared) ? "Preview valid until" : "Valid until"}</dt><dd>{moduleEngineUtcTimestamp(prepared.expiresAt)}</dd></div><div><dt>Simulated block</dt><dd>{prepared.blockNumber.toString()}</dd></div><div><dt>Gas estimate</dt><dd>{prepared.gasEstimate.toString()}</dd></div></dl><code className={engineStyles.calldata}>{prepared.transaction.data}</code></details>
    <p className={styles.help}>Your wallet opens after you confirm this review. Contract identity, funding and current permissions are checked again before submission.</p>
    <div className={styles.reviewActions}><button type="button" className={styles.secondaryButton} disabled={busy} onClick={onEdit}>Back to edit</button><button type="button" className={styles.primaryButton} disabled={busy || disabled || invalidDetails || expired} onClick={onConfirm}>{busy ? "Checking transaction…" : "Confirm in wallet"}</button></div>
  </section>;
}
