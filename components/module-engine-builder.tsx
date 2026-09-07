"use client";

import { useMemo, useRef, useState } from "react";
import { formatUnits, keccak256, toHex, type Address, type Hex } from "viem";
import { ModuleSchemaField } from "@/components/module-mode-fields";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep } from "@/components/module-mode-wallet-state";
import { configurationFromForm, configurationToForm, defaultSchemaValue, parseExactUnits, utcDateTimeToSeconds, type FormValue } from "@/lib/module-mode/builder";
import { moduleAddress } from "@/lib/module-mode/release";
import { ENGINE_ZERO_ADDRESS, ENGINE_ZERO_HASH, parseModuleEngineAvailability, type ModuleEngineAvailability, type ModuleEngineCatalogDefinition } from "@/lib/module-engine/catalog";
import { createModuleEngineClient, ENGINE_OPERATIONS, moduleEngineDepositIntent, moduleEngineSettlementRequestIntent, moduleEngineTradeIntent, prepareModuleEngineApproval, prepareModuleEngineLaunch, readModuleEngineQuoteAsset, type ModuleEngineApprovalRequired, type ModuleEngineClient, type ModuleEngineOperationIntent, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { ModuleEngineTransactionReview, type ModuleEngineWalletActions } from "./module-engine-transaction-review";
import styles from "@/components/module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

export interface ModuleEngineBuilderProps extends ModuleEngineWalletActions { availability: ModuleEngineAvailability; client?: ModuleEngineClient }
export function moduleEngineInitialForm(definition: ModuleEngineCatalogDefinition): FormValue { try { return configurationToForm(definition.schema, definition.defaults, definition.fields); } catch { return defaultSchemaValue(definition.schema, definition.fields); } }
function freshSalt() { return toHex(crypto.getRandomValues(new Uint8Array(32))); }
function message(error: unknown) { return error instanceof Error ? error.message : "The engine request could not be prepared."; }

/** Configuration and wallet controls extend the existing Module Mode flow; no independent wallet is created. */
export function ModuleEngineBuilder({ availability: raw, client: suppliedClient, wallet, onConnect, onSwitch, onSubmit, blocked, blockedReason }: ModuleEngineBuilderProps) {
  const client = useMemo(() => suppliedClient ?? createModuleEngineClient(), [suppliedClient]);
  const parsed = useMemo(() => { try { return { availability: parseModuleEngineAvailability(raw), error: null }; } catch (error) { return { availability: null, error: message(error) }; } }, [raw]);
  const availability = parsed.availability;
  const [selected, setSelected] = useState(""); const [forms, setForms] = useState<Record<string, FormValue>>({});
  const [name, setName] = useState(""); const [symbol, setSymbol] = useState(""); const [description, setDescription] = useState(""); const [imageUri, setImageUri] = useState("");
  const [quote, setQuote] = useState(""); const [quoteState, setQuoteState] = useState<Awaited<ReturnType<typeof readModuleEngineQuoteAsset>> | null>(null);
  const [amount, setAmount] = useState(""); const [minimumTokens, setMinimumTokens] = useState(""); const [minimumEth, setMinimumEth] = useState(""); const [route, setRoute] = useState("");
  const [buyFee, setBuyFee] = useState("0"); const [sellFee, setSellFee] = useState("0"); const [beneficiary, setBeneficiary] = useState(""); const [refundTime, setRefundTime] = useState(""); const [obligation, setObligation] = useState("");
  const [prepared, setPrepared] = useState<PreparedModuleEngineTransaction | null>(null); const [approval, setApproval] = useState<ModuleEngineApprovalRequired | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const salts = useRef<{ creator: Hex; engine: Hex } | null>(null);
  const template = availability?.templates.find(item => item.manifest.manifest.catalogDefinition.id === selected) ?? availability?.templates[0];
  const definition = template?.manifest.manifest.catalogDefinition, revision = template?.manifest.manifest.revision;
  const fixedQuote = revision && revision.fixedQuoteAsset !== ENGINE_ZERO_ADDRESS ? revision.fixedQuoteAsset : null;
  const quoteAsset = fixedQuote ?? quote; const form = definition ? forms[definition.id] ?? moduleEngineInitialForm(definition) : {};
  const needsInitial = revision && revision.initialOperationId !== ENGINE_ZERO_HASH, spot = definition?.interface === "quote-v1";
  const quoteVerified = quoteState && quoteState.address.toLowerCase() === quoteAsset.toLowerCase();
  const step = moduleModeWalletStep(wallet);
  function edit(change: () => void) { change(); setPrepared(null); setApproval(null); setError(null); setNotice(null); }
  async function checkQuote() {
    if (!availability?.release || !template || !wallet.account) return; setBusy(true); setError(null);
    try { const account = moduleAddress(wallet.account, "account"); const current = await readModuleEngineQuoteAsset({ client, release: availability.release, template, quoteAsset: moduleAddress(quoteAsset, "quote asset"), account }); setQuoteState(current); setRoute(current.routes[0]?.data ?? ""); if (spot && current.routes.length === 0) throw new Error("This template has no valid fixed fee route for the selected quote asset."); }
    catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  async function prepare() {
    if (!availability?.release || !template || !definition || !revision || !wallet.account) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const account = moduleAddress(wallet.account, "account"); assertModuleModeWalletUnchanged(wallet, account);
      if (!quoteVerified || !quoteState) throw new Error("Check the quote asset before reviewing the launch.");
      salts.current ??= { creator: freshSalt(), engine: freshSalt() };
      const initialOperation = needsInitial ? ({ token, quoteAsset }: { token: Address; quoteAsset: Address }): ModuleEngineOperationIntent => {
        const inputAmount = BigInt(parseExactUnits(amount, quoteState.decimals));
        if (revision.initialOperationId === ENGINE_OPERATIONS.buy) return moduleEngineTradeIntent({ buy: true, token, quoteAsset, recipient: account, inputAmount, minimumOutput: BigInt(parseExactUnits(minimumTokens, 18)), minimumEthFees: BigInt(parseExactUnits(minimumEth, 18)), conversionRoute: route as Hex });
        if (revision.initialOperationId === ENGINE_OPERATIONS.deposit) return moduleEngineDepositIntent(quoteAsset, account, inputAmount);
        if (revision.initialOperationId === ENGINE_OPERATIONS.request) { if (!obligation.trim()) throw new Error("Describe the obligation reference."); return moduleEngineSettlementRequestIntent({ quoteAsset, actor: account, beneficiary: moduleAddress(beneficiary, "beneficiary"), amount: inputAmount, refundAfter: BigInt(utcDateTimeToSeconds(refundTime)), obligationHash: keccak256(toHex(obligation.trim())) }); }
        throw new Error("The required initial operation needs its reviewed operation interface.");
      } : undefined;
      const result = await prepareModuleEngineLaunch({ client, availability, templateId: definition.id, account, quoteAsset: quoteState.address, name, symbol, description, imageUri, configuration: configurationFromForm(definition.schema, form, definition.fields), creatorSalt: salts.current.creator, engineSalt: salts.current.engine, creatorWallets: [account], creatorSharesBps: [10_000], buyCreatorFeeBps: Number(buyFee) * 100, sellCreatorFeeBps: Number(sellFee) * 100, initialOperation });
      if (result.kind === "approval-required") setApproval(result); else setPrepared(result);
    } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  async function prepareApproval() {
    if (!approval || !availability?.release || !wallet.account) return; setBusy(true); setError(null);
    try { setPrepared(await prepareModuleEngineApproval({ client, release: availability.release, account: moduleAddress(wallet.account, "account"), token: approval.token, amount: approval.currentAllowance > 0n ? 0n : approval.amount })); } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  async function confirm() {
    if (!prepared) return; setBusy(true); setError(null);
    try { assertModuleModeWalletUnchanged(wallet, prepared.account); if (prepared.releaseDigest !== availability?.release?.releaseDigest) throw new Error("The source release changed. Review again."); const result = await onSubmit(prepared); setPrepared(null); setApproval(null); setNotice(result.kind === "approve" ? "Allowance confirmed onchain. Review the launch with the updated funding approval." : `Transaction mined: ${result.transactionHash}. Finality and public indexing are still pending.`); } catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  const connectedAction = step === "connect" ? onConnect : step === "switch" ? onSwitch : null;
  return <div className={`${styles.page} ${engineStyles.root}`}>
    <header className={styles.heading}><div className={styles.titleRow}><h1>Build with an engine</h1><span className={styles.network}>Robinhood Chain</span></div><p>Choose a reviewed engine, bind its quote asset, and configure your token.</p></header>
    {parsed.error || availability?.reason ? <p className={engineStyles.notice} role="status">{parsed.error ?? availability?.reason}</p> : null}
    {!template || !definition || !availability?.release ? <p className={engineStyles.notice}>No engine source is currently available for a new launch.</p> : <>
      <form className={styles.formPanel} onSubmit={event => { event.preventDefault(); void prepare(); }}>
        <fieldset className={styles.formFields} disabled={busy || Boolean(prepared)}>
          <section className={styles.formSection}><h2>Engine</h2><div className={styles.field}><label htmlFor="engine-template">Reviewed template</label><select id="engine-template" value={definition.id} onChange={event => edit(() => { setSelected(event.target.value); setQuoteState(null); salts.current = null; })}>{availability.templates.map(item => <option key={item.manifestHash} value={item.manifest.manifest.catalogDefinition.id}>{item.manifest.manifest.catalogDefinition.title}</option>)}</select><p className={styles.help}>{definition.detail}</p></div></section>
          <section className={styles.formSection}><h2>Token</h2><div className={styles.tokenFields}><div className={styles.field}><label htmlFor="engine-name">Name</label><input id="engine-name" autoComplete="off" value={name} onChange={event => edit(() => setName(event.target.value))} required /></div><div className={styles.field}><label htmlFor="engine-symbol">Symbol</label><input id="engine-symbol" autoComplete="off" value={symbol} maxLength={11} onChange={event => edit(() => setSymbol(event.target.value))} required /></div></div><div className={styles.field}><label htmlFor="engine-description">Description</label><textarea id="engine-description" value={description} onChange={event => edit(() => setDescription(event.target.value))} /></div><div className={styles.field}><label htmlFor="engine-image">Image URL <span>Optional</span></label><input id="engine-image" type="url" placeholder="https://…" value={imageUri} onChange={event => edit(() => setImageUri(event.target.value))} /><p className={styles.help}>Leave blank to use the Programmable token image.</p></div></section>
          <section className={styles.formSection}><h2>Quote asset</h2><div className={styles.field}><label htmlFor="engine-quote">Token contract address {fixedQuote ? <span>Fixed by template</span> : null}</label><input id="engine-quote" value={quoteAsset} readOnly={Boolean(fixedQuote)} placeholder="0x…" spellCheck={false} autoComplete="off" onChange={event => edit(() => { setQuote(event.target.value); setQuoteState(null); })} /><p className={styles.help}>{fixedQuote ? "The contract enforces this asset address. It cannot be changed at launch." : "Use the exact ERC20 contract address on Robinhood Chain. Its decimals and available balance are checked onchain."}</p></div><div className={engineStyles.actions}><button type="button" className={styles.secondaryButton} disabled={step !== "prepare"} onClick={() => void checkQuote()}>Check quote asset</button>{quoteVerified && quoteState ? <p className={styles.help}>{quoteState.decimals} decimals · {formatUnits(quoteState.balance, quoteState.decimals)} available</p> : null}</div></section>
          <section className={styles.formSection}><h2>Configuration</h2><ModuleSchemaField schema={definition.schema} value={form} onChange={value => edit(() => setForms(current => ({ ...current, [definition.id]: value })))} path="/engine/configuration" fields={definition.fields} context={{ roles: wallet.account ? { launchWallet: wallet.account as Address } : {}, assets: quoteVerified && quoteState ? { quote: { chainId: "4663", address: quoteState.address, decimals: quoteState.decimals } } : {} }} /></section>
          {needsInitial ? <section className={styles.formSection}><h2>{spot ? "Initial buy" : "Initial funding"}</h2><p className={styles.help}>This action is funded and executed in the launch transaction. If it fails, the entire launch reverts.</p><div className={styles.field}><label htmlFor="engine-amount">Quote amount</label><input id="engine-amount" inputMode="decimal" value={amount} onChange={event => edit(() => setAmount(event.target.value))} required /></div>{spot ? <><div className={styles.twoFields}><div className={styles.field}><label htmlFor="engine-min-tokens">Minimum tokens received</label><input id="engine-min-tokens" inputMode="decimal" value={minimumTokens} onChange={event => edit(() => setMinimumTokens(event.target.value))} required /></div><div className={styles.field}><label htmlFor="engine-min-eth">Minimum fee conversion in ETH</label><input id="engine-min-eth" inputMode="decimal" value={minimumEth} onChange={event => edit(() => setMinimumEth(event.target.value))} required /><p className={styles.help}>A lower limit for the ETH received from converting trade fees. This is taken from the quote amount.</p></div></div><div className={styles.field}><label htmlFor="engine-route">Fee conversion route <span>Fixed by template</span></label><input id="engine-route" readOnly value={quoteState?.routes.find(item => item.data === route)?.label ?? "Check the quote asset first"} /></div></> : null}{revision?.initialOperationId === ENGINE_OPERATIONS.request ? <><div className={styles.field}><label htmlFor="engine-beneficiary">Beneficiary wallet</label><input id="engine-beneficiary" value={beneficiary} onChange={event => edit(() => setBeneficiary(event.target.value))} /></div><div className={styles.field}><label htmlFor="engine-refund">Refund available at (UTC)</label><input id="engine-refund" type="datetime-local" value={refundTime} onChange={event => edit(() => setRefundTime(event.target.value))} /></div><div className={styles.field}><label htmlFor="engine-obligation">Obligation reference</label><textarea id="engine-obligation" value={obligation} onChange={event => edit(() => setObligation(event.target.value))} /><p className={styles.help}>Its hash is stored with the payment. Fulfillment relies on the launch creator’s attestation.</p></div></> : null}</section> : null}
          {spot ? <section className={styles.formSection}><h2>Creator fees</h2><div className={styles.twoFields}>{[["buy", buyFee, setBuyFee], ["sell", sellFee, setSellFee]].map(([side, value, setValue]) => <div className={styles.field} key={side as string}><label htmlFor={`engine-${side}-fee`}>{side === "buy" ? "Buy" : "Sell"} fee</label><select id={`engine-${side}-fee`} value={value as string} onChange={event => edit(() => (setValue as (value: string) => void)(event.target.value))}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={String(i)}>{i}%</option>)}</select></div>)}</div><p className={styles.help}>Fees accrue in ETH to your connected wallet. The platform fee is read from the registered engine policy during review.</p></section> : null}
        </fieldset>
        {!prepared ? <div className={engineStyles.actions}>{connectedAction ? <button type="button" className={styles.primaryButton} onClick={() => void connectedAction()}>{step === "connect" ? "Connect wallet" : "Switch to Robinhood Chain"}</button> : <button type="submit" className={styles.primaryButton} disabled={busy || blocked || !quoteVerified}>{busy ? "Checking launch…" : "Review launch"}</button>}</div> : null}
      </form>
      {approval && !prepared ? <section className={engineStyles.notice} role="status"><p>The host needs an allowance of {approval.amount.toString()} base units in the quote asset to fund this launch.</p><button className={styles.secondaryButton} type="button" disabled={busy || blocked} onClick={() => void prepareApproval()}>{approval.currentAllowance > 0n ? "Review allowance reset" : "Review exact approval"}</button></section> : null}
      {prepared ? <ModuleEngineTransactionReview prepared={prepared} busy={busy} disabled={blocked || step !== "prepare"} onEdit={() => setPrepared(null)} onConfirm={() => void confirm()} /> : null}
    </>}
    {blocked ? <p className={engineStyles.notice} role="status">{blockedReason ?? "Resolve your pending wallet operation before sending another transaction."}</p> : null}
    {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}{notice ? <p className={engineStyles.notice} role="status">{notice}</p> : null}
  </div>;
}
