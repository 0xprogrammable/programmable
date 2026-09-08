"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatUnits, keccak256, toHex, type Address, type Hex } from "viem";
import { ChevronDown, Plus } from "lucide-react";
import { MODULE_DEFAULT_TOKEN_IMAGE, validateModuleSocialLinks, type ModuleSocialLinks, type ModuleSocialIssue } from "@/lib/module-mode/token-metadata";
import { ModuleModeImagePicker, type ModuleModeImageResource } from "@/components/module-mode-image";
import { ModuleSchemaField } from "@/components/module-mode-fields";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep } from "@/components/module-mode-wallet-state";
import { configurationFromForm, configurationToForm, defaultSchemaValue, parseExactUnits, utcDateTimeToSeconds, type FormValue, type ModuleModeImage } from "@/lib/module-mode/builder";
import { moduleAddress, moduleBytes } from "@/lib/module-mode/release";
import { ENGINE_ZERO_ADDRESS, ENGINE_ZERO_HASH, moduleEngineOptionalHash, parseModuleEngineAvailability, type ModuleEngineAvailability, type ModuleEngineCatalogDefinition } from "@/lib/module-engine/catalog";
import { createModuleEngineClient, ENGINE_OPERATIONS, moduleEngineDepositIntent, moduleEngineSettlementRequestIntent, moduleEngineTradeIntent, prepareModuleEngineApproval, prepareModuleEngineLaunch, readModuleEngineQuoteAsset, type ModuleEngineApprovalRequired, type ModuleEngineClient, type ModuleEngineOperationIntent, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { ModuleEngineLibrary } from "./module-engine-library";
import { ModuleEngineCustomOperationFields } from "./module-engine-custom-operation";
import { emptyModuleEngineCustomOperation, moduleEngineCustomOperationIntent } from "@/lib/module-engine/custom-operation";
import { ModuleEngineTransactionReview, type ModuleEngineWalletActions } from "./module-engine-transaction-review";
import styles from "@/components/module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

export interface ModuleEngineBuilderProps extends ModuleEngineWalletActions {
  availability: ModuleEngineAvailability; client?: ModuleEngineClient;
  statusContent?: ReactNode; versionContent?: ReactNode;
  onUploadImage?: (image: Extract<ModuleModeImage, { kind: "local" }>, blob: Blob) => Promise<string>;
}
export function moduleEngineInitialForm(definition: ModuleEngineCatalogDefinition): FormValue { try { return configurationToForm(definition.schema, definition.defaults, definition.fields); } catch { return defaultSchemaValue(definition.schema, definition.fields); } }
const socialFields = [
  { key: "twitter", label: "Twitter / X", placeholder: "https://x.com/…" },
  { key: "website", label: "Website", placeholder: "https://…" },
  { key: "telegram", label: "Telegram", placeholder: "https://t.me/…" },
  { key: "discord", label: "Discord", placeholder: "https://discord.gg/…" },
  { key: "github", label: "GitHub", placeholder: "https://github.com/…" },
  { key: "gitbook", label: "GitBook", placeholder: "https://…" },
] as const;
function freshSalt() { return toHex(crypto.getRandomValues(new Uint8Array(32))); }
function message(error: unknown) { return error instanceof Error ? error.message.replace(/^Module engine: /, "") : "The launch could not be prepared."; }
function fixedConfiguration(schema: ModuleEngineCatalogDefinition["schema"]): boolean { return schema.binding?.mode === "fixed" || schema.type === "record" && Object.keys(schema.fields).length > 0 && Object.values(schema.fields).every(fixedConfiguration); }

/** Configuration and wallet controls extend the existing Module Mode flow; no independent wallet is created. */
export function ModuleEngineBuilder({ availability: raw, client: suppliedClient, wallet, onConnect, onSwitch, onSubmit, blocked, blockedReason, statusContent, versionContent, onUploadImage }: ModuleEngineBuilderProps) {
  const client = useMemo(() => suppliedClient ?? createModuleEngineClient(), [suppliedClient]);
  const parsed = useMemo(() => { try { return { availability: parseModuleEngineAvailability(raw), error: null }; } catch (error) { return { availability: null, error: message(error) }; } }, [raw]);
  const availability = parsed.availability;
  const [selected, setSelected] = useState(""); const [forms, setForms] = useState<Record<string, FormValue>>({});
  const [name, setName] = useState(""); const [symbol, setSymbol] = useState(""); const [description, setDescription] = useState(""); const [imageUri, setImageUri] = useState("");
  const [socialLinks, setSocialLinks] = useState<ModuleSocialLinks>({}); const [socialIssues, setSocialIssues] = useState<ModuleSocialIssue[]>([]); const [moreLinks, setMoreLinks] = useState(false);
  const [image, setImage] = useState<ModuleModeImage>({ kind: "none" }); const [imageResource, setImageResource] = useState<ModuleModeImageResource | null>(null); const [imageBusy, setImageBusy] = useState(false);
  const imageUrls = useRef(new Set<string>()), uploadedImage = useRef<{ hash: Hex; account: Address; uri: string } | null>(null);
  useEffect(() => { const urls = imageUrls.current; return () => urls.forEach(url => URL.revokeObjectURL(url)); }, []);
  const [quote, setQuote] = useState(""); const [quoteState, setQuoteState] = useState<(Awaited<ReturnType<typeof readModuleEngineQuoteAsset>> & { account: Address }) | null>(null);
  const [customInitialForm, setCustomInitialForm] = useState(emptyModuleEngineCustomOperation);
  const [creatorSaltInput, setCreatorSaltInput] = useState(""); const [engineSaltInput, setEngineSaltInput] = useState(""); const [launchData, setLaunchData] = useState("0x");
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
  const initialPermission = revision?.operationPermissions.find(permission => permission.operationId === revision.initialOperationId);
  const customInitial = Boolean(needsInitial && !(spot && revision?.initialOperationId === ENGINE_OPERATIONS.buy) && !(definition?.interface === "escrow-v1" && revision?.initialOperationId === ENGINE_OPERATIONS.deposit) && !(definition?.interface === "settlement-v1" && revision?.initialOperationId === ENGINE_OPERATIONS.request));
  const customLaunch = definition?.interface === "custom-v1";
  const quoteVerified = quoteState && quoteState.address.toLowerCase() === quoteAsset.toLowerCase() && quoteState.account.toLowerCase() === wallet.account?.toLowerCase();
  const step = moduleModeWalletStep(wallet), errorFocus = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (error) errorFocus.current?.focus(); }, [error]);
  function changeImage(value: ModuleModeImage, resource: ModuleModeImageResource | null) { if (resource) imageUrls.current.add(resource.objectUrl); edit(() => { setImage(value); setImageResource(resource); uploadedImage.current = null; setImageUri(value.kind === "uri" ? value.uri : ""); }); }
  function backToEdit() { const id = prepared?.kind === "approve" ? "engine-approval-review" : "engine-launch-review"; setPrepared(null); requestAnimationFrame(() => document.getElementById(id)?.focus()); }
  function edit(change: () => void) { change(); setPrepared(null); setApproval(null); setError(null); setNotice(null); }
  async function checkQuote() {
    if (!availability?.release || !template || !wallet.account) return; setBusy(true); setError(null);
    try { const account = moduleAddress(wallet.account, "account"); const current = await readModuleEngineQuoteAsset({ client, release: availability.release, template, quoteAsset: moduleAddress(quoteAsset, "quote asset"), account }); setQuoteState({ ...current, account }); setRoute(current.routes[0]?.data ?? ""); if (spot && current.routes.length === 0) throw new Error("This template has no valid fixed fee route for the selected quote asset."); }
    catch (caught) { setError(message(caught)); } finally { setBusy(false); }
  }
  async function prepare() {
    if (!availability?.release || !template || !definition || !revision || !wallet.account) return;
    if (imageBusy) return; setBusy(true); setError(null); setNotice(null);
    try {
      const account = moduleAddress(wallet.account, "account"); assertModuleModeWalletUnchanged(wallet, account);
      if (!quoteVerified || !quoteState) throw new Error("Check the quote asset before reviewing the launch.");
      const social = validateModuleSocialLinks(socialLinks);
      if (!social.ok) { setSocialIssues(social.issues); if (social.issues.some(issue => /\/(discord|github|gitbook)$/.test(issue.path))) setMoreLinks(true); throw new Error(social.issues[0]!.message); }
      setSocialIssues([]);
      let resolvedImage = imageUri;
      if (image.kind === "local" && onUploadImage) {
        if (!imageResource) throw new Error("Choose your coin image again before reviewing.");
        const cached = uploadedImage.current;
        resolvedImage = cached?.hash === image.sha256 && cached.account === account ? cached.uri : await onUploadImage(image, imageResource.blob);
        assertModuleModeWalletUnchanged(wallet, account);
        uploadedImage.current = { hash: image.sha256, account, uri: resolvedImage }; setImageUri(resolvedImage);
      }
      salts.current ??= { creator: freshSalt(), engine: freshSalt() };
      const initialOperation = needsInitial ? ({ token, quoteAsset }: { token: Address; quoteAsset: Address }): ModuleEngineOperationIntent => {
        if (customInitial) {
          if (!initialPermission) throw new Error("The initial action is missing its reviewed permission.");
          return moduleEngineCustomOperationIntent({ permission: initialPermission, form: customInitialForm, account, token, quoteAsset, quoteDecimals: quoteState.decimals });
        }
        const inputAmount = BigInt(parseExactUnits(amount, quoteState.decimals));
        if (revision.initialOperationId === ENGINE_OPERATIONS.buy) return moduleEngineTradeIntent({ buy: true, token, quoteAsset, recipient: account, inputAmount, minimumOutput: BigInt(parseExactUnits(minimumTokens, 18)), minimumEthFees: BigInt(parseExactUnits(minimumEth, 18)), conversionRoute: route as Hex });
        if (revision.initialOperationId === ENGINE_OPERATIONS.deposit) return moduleEngineDepositIntent(quoteAsset, account, inputAmount);
        if (revision.initialOperationId === ENGINE_OPERATIONS.request) { if (!obligation.trim()) throw new Error("Describe the obligation reference."); return moduleEngineSettlementRequestIntent({ quoteAsset, actor: account, beneficiary: moduleAddress(beneficiary, "beneficiary"), amount: inputAmount, refundAfter: BigInt(utcDateTimeToSeconds(refundTime)), obligationHash: keccak256(toHex(obligation.trim())) }); }
        throw new Error("The required initial operation needs its reviewed operation interface.");
      } : undefined;
      const result = await prepareModuleEngineLaunch({ client, availability, templateId: definition.id, account, quoteAsset: quoteState.address, name, symbol, description, imageUri: resolvedImage, socialLinks: social.links, configuration: configurationFromForm(definition.schema, form, definition.fields), creatorSalt: customLaunch && creatorSaltInput.trim() ? moduleEngineOptionalHash(creatorSaltInput.trim(), "creator salt") : salts.current.creator, engineSalt: customLaunch && engineSaltInput.trim() ? moduleEngineOptionalHash(engineSaltInput.trim(), "engine salt") : salts.current.engine, ...(customLaunch ? { launchData: moduleBytes(launchData.trim(), "initialization data", 16_384) } : {}), creatorWallets: [account], creatorSharesBps: [10_000], buyCreatorFeeBps: Number(buyFee) * 100, sellCreatorFeeBps: Number(sellFee) * 100, initialOperation });
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
  const checkedSocial = validateModuleSocialLinks(socialLinks);
  const socialInput = ({ key, label, placeholder }: typeof socialFields[number]) => { const issue = socialIssues.find(item => item.path === `/socialLinks/${key}`); return <div className={styles.field} key={key}><label htmlFor={`engine-social-${key}`}>{label}</label><input id={`engine-social-${key}`} inputMode="url" autoComplete="off" placeholder={placeholder} value={socialLinks[key] ?? ""} aria-invalid={Boolean(issue) || undefined} aria-describedby={issue ? `engine-social-${key}-error` : undefined} onChange={event => edit(() => { setSocialLinks(current => ({ ...current, [key]: event.target.value })); setSocialIssues(current => current.filter(item => item.path !== `/socialLinks/${key}`)); })} />{issue ? <p id={`engine-social-${key}-error`} className={styles.fieldError}>{issue.message}</p> : null}</div>; };

  return <div className={`${styles.page} ${engineStyles.root}`}>
    <header className={styles.heading}><div className={styles.titleRow}><h1>Create a coin</h1><span className={styles.network}>Robinhood Chain</span></div><p>Choose a reviewed template and configure your coin.</p></header>
    {statusContent}
    {parsed.error || availability?.reason ? <p className={engineStyles.notice} role="status">{parsed.error ?? availability?.reason}</p> : null}
    {!template || !definition || !availability?.release ? <p className={engineStyles.notice}>No reviewed template is currently available for a new launch.</p> : <>
      <form className={styles.formPanel} hidden={Boolean(prepared)} aria-busy={busy || imageBusy} onSubmit={event => { event.preventDefault(); void prepare(); }}>
        <fieldset className={styles.formFields} disabled={busy || imageBusy || Boolean(prepared)}>
          <section className={styles.formSection}><h2>Template</h2><div className={engineStyles.templateLibrary}><ModuleEngineLibrary templates={availability.templates} selectedId={definition.id} disabled={busy || imageBusy || blocked} onSelect={item => edit(() => { setSelected(item.manifest.manifest.catalogDefinition.id); setQuoteState(null); salts.current = null; setCustomInitialForm(emptyModuleEngineCustomOperation()); setCreatorSaltInput(""); setEngineSaltInput(""); setLaunchData("0x"); setBuyFee("0"); setSellFee("0"); })} /></div><div className={engineStyles.templateDetails} aria-live="polite"><p>Selected: <strong>{definition.title}</strong></p><p className={styles.help}>{definition.detail}</p></div>{versionContent}</section>
          <section className={styles.formSection}><h2>Your coin</h2><div className={styles.tokenFields}><div className={styles.field}><label htmlFor="engine-name">Name</label><input id="engine-name" autoComplete="off" value={name} onChange={event => edit(() => setName(event.target.value))} required /></div><div className={styles.field}><label htmlFor="engine-symbol">Symbol</label><input id="engine-symbol" autoComplete="off" value={symbol} maxLength={11} onChange={event => edit(() => setSymbol(event.target.value))} required /></div></div><div className={styles.field}><label htmlFor="engine-description">Description</label><textarea id="engine-description" value={description} onChange={event => edit(() => setDescription(event.target.value))} /></div>{onUploadImage ? <ModuleModeImagePicker image={image} resource={imageResource} onChange={changeImage} onBusyChange={setImageBusy} /> : <div className={styles.field}><label htmlFor="engine-image">Image URL <span>Optional</span></label><input id="engine-image" type="url" placeholder="https://…" value={imageUri} onChange={event => edit(() => setImageUri(event.target.value))} /><p className={styles.help}>Leave blank to use the Programmable token image.</p></div>}<div className={styles.socialFields} role="group" aria-labelledby="engine-socials-title"><h3 id="engine-socials-title">Links <span>Optional</span></h3><div className={styles.socialGrid}>{socialFields.slice(0, 3).map(socialInput)}</div><div id="engine-more-links" className={styles.socialGrid} hidden={!moreLinks}>{socialFields.slice(3).map(socialInput)}</div><button className={styles.textButton} type="button" aria-expanded={moreLinks} aria-controls="engine-more-links" onClick={() => setMoreLinks(current => !current)}>{moreLinks ? <ChevronDown size={16} className={styles.chevronOpen} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{moreLinks ? "Fewer links" : "Add more links"}</button></div></section>
          <section className={styles.formSection}><h2>Quote token</h2><div className={styles.field}><label htmlFor="engine-quote">Token contract address {fixedQuote ? <span>Fixed by template</span> : null}</label><input id="engine-quote" value={quoteAsset} readOnly={Boolean(fixedQuote)} placeholder="0x…" spellCheck={false} autoComplete="off" onChange={event => edit(() => { setQuote(event.target.value); setQuoteState(null); })} /><p className={styles.help}>{fixedQuote ? "The contract enforces this asset address. It cannot be changed at launch." : "Use the exact ERC20 contract address on Robinhood Chain. Its decimals and available balance are checked onchain."}</p></div><div className={engineStyles.actions}><button type="button" className={styles.secondaryButton} disabled={step !== "prepare"} onClick={() => void checkQuote()}>{busy ? "Checking quote token…" : "Check quote token"}</button>{quoteVerified && quoteState ? <p className={styles.help}>Balance: {formatUnits(quoteState.balance, quoteState.decimals)} quote tokens · {quoteState.decimals} decimals</p> : null}</div></section>
          <section className={styles.formSection}><h2>Coin settings</h2>{fixedConfiguration(definition.schema) ? <details className={engineStyles.fixedSettings}><summary>Fixed template settings</summary><p className={styles.help}>These settings are set by the reviewed template.</p><ModuleSchemaField schema={definition.schema} value={form} onChange={() => {}} path="/engine/fixed-configuration" fields={definition.fields} context={{ roles: wallet.account ? { launchWallet: wallet.account as Address } : {}, assets: quoteVerified && quoteState ? { quote: { chainId: "4663", address: quoteState.address, decimals: quoteState.decimals } } : {} }} /></details> : <ModuleSchemaField schema={definition.schema} value={form} onChange={value => edit(() => setForms(current => ({ ...current, [definition.id]: value })))} path="/engine/configuration" fields={definition.fields} context={{ roles: wallet.account ? { launchWallet: wallet.account as Address } : {}, assets: quoteVerified && quoteState ? { quote: { chainId: "4663", address: quoteState.address, decimals: quoteState.decimals } } : {} }} />}</section>
          {needsInitial && customInitial && initialPermission ? <section className={styles.formSection}><h2>Initial action</h2><ModuleEngineCustomOperationFields id="engine-initial-action" permission={initialPermission} value={customInitialForm} account={wallet.account} onChange={value => edit(() => setCustomInitialForm(value))} /></section> : null}
          {needsInitial && !customInitial ? <section className={styles.formSection}><h2>{spot ? "Initial buy" : "Initial funding"}</h2><p className={styles.help}>This action is funded and executed in the launch transaction. If it fails, the entire launch reverts.</p><div className={styles.field}><label htmlFor="engine-amount">Quote amount</label><input id="engine-amount" inputMode="decimal" value={amount} onChange={event => edit(() => setAmount(event.target.value))} required /></div>{spot ? <><div className={styles.twoFields}><div className={styles.field}><label htmlFor="engine-min-tokens">Minimum tokens received</label><input id="engine-min-tokens" inputMode="decimal" value={minimumTokens} onChange={event => edit(() => setMinimumTokens(event.target.value))} required /></div><div className={styles.field}><label htmlFor="engine-min-eth">Minimum fee conversion in ETH</label><input id="engine-min-eth" inputMode="decimal" value={minimumEth} onChange={event => edit(() => setMinimumEth(event.target.value))} required /><p className={styles.help}>A lower limit for the ETH received from converting trade fees. This is taken from the quote amount.</p></div></div><div className={styles.field}><label htmlFor="engine-route">Fee conversion route <span>Fixed by template</span></label><input id="engine-route" readOnly value={quoteState?.routes.find(item => item.data === route)?.label ?? "Check the quote asset first"} /></div></> : null}{revision?.initialOperationId === ENGINE_OPERATIONS.request ? <><div className={styles.field}><label htmlFor="engine-beneficiary">Beneficiary wallet</label><input id="engine-beneficiary" value={beneficiary} onChange={event => edit(() => setBeneficiary(event.target.value))} /></div><div className={styles.field}><label htmlFor="engine-refund">Refund available at (UTC)</label><input id="engine-refund" type="datetime-local" value={refundTime} onChange={event => edit(() => setRefundTime(event.target.value))} /></div><div className={styles.field}><label htmlFor="engine-obligation">Obligation reference</label><textarea id="engine-obligation" value={obligation} onChange={event => edit(() => setObligation(event.target.value))} /><p className={styles.help}>Its hash is stored with the payment. Fulfillment relies on the launch creator’s attestation.</p></div></> : null}</section> : null}
          {customLaunch ? <details className={`${styles.formSection} ${engineStyles.fixedSettings}`}><summary>Advanced launch inputs</summary><p className={styles.help}>Use the values prepared for this template when its address or initialization requires them. Blank salts use fresh random values. The full launch is simulated before your wallet opens.</p><div className={engineStyles.stack}><div className={styles.field}><label htmlFor="engine-creator-salt">Creator salt <span>Optional</span></label><input id="engine-creator-salt" autoComplete="off" spellCheck={false} value={creatorSaltInput} placeholder="0x… (32 bytes)" onChange={event => edit(() => setCreatorSaltInput(event.target.value))} /><p className={styles.help}>Binds the new token identity. Keep the same coin details used when preparing the salts.</p></div><div className={styles.field}><label htmlFor="engine-address-salt">Engine salt <span>Optional</span></label><input id="engine-address-salt" autoComplete="off" spellCheck={false} value={engineSaltInput} placeholder="0x… (32 bytes)" onChange={event => edit(() => setEngineSaltInput(event.target.value))} /><p className={styles.help}>Used exactly as entered for this custom template.</p></div><div className={styles.field}><label htmlFor="engine-launch-data">Initialization data</label><textarea id="engine-launch-data" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={32_770} value={launchData} onChange={event => edit(() => setLaunchData(event.target.value))} /><p className={styles.help}>Hex bytes for the template initializer. Use 0x for no data. Maximum 16 KiB.</p></div></div></details> : null}
          {spot || customLaunch ? <section className={styles.formSection}><h2>{customLaunch ? "Creator fee terms" : "Creator fees"}</h2><div className={styles.twoFields}>{[["buy", buyFee, setBuyFee], ["sell", sellFee, setSellFee]].map(([side, value, setValue]) => <div className={styles.field} key={side as string}><label htmlFor={`engine-${side}-fee`}>{side === "buy" ? "Buy" : "Sell"} fee</label><select id={`engine-${side}-fee`} value={value as string} onChange={event => edit(() => (setValue as (value: string) => void)(event.target.value))}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={String(i)}>{i}%</option>)}</select></div>)}</div><p className={styles.help}>{customLaunch ? "These registered terms are available to the engine. They affect operations that use them; consult the template’s fee behavior." : "Fees accrue in ETH to your connected wallet. The platform fee is read from the registered fee policy during review."}</p></section> : null}
        </fieldset>
        {!prepared ? <div className={engineStyles.actions}>{connectedAction ? <button type="button" className={styles.primaryButton} onClick={() => void connectedAction()}>{step === "connect" ? "Connect wallet" : "Switch to Robinhood Chain"}</button> : <button type="submit" className={styles.primaryButton} id="engine-launch-review" disabled={busy || imageBusy || blocked || !quoteVerified}>{imageBusy ? "Preparing image…" : busy ? "Checking launch…" : "Review launch"}</button>}</div> : null}
      </form>
      {approval && !prepared ? <section className={engineStyles.notice} role="status"><p>Allow the launch contract to use exactly {quoteState ? formatUnits(approval.amount, quoteState.decimals) : approval.amount.toString()} quote tokens to fund this launch.</p><button id="engine-approval-review" className={styles.secondaryButton} type="button" disabled={busy || blocked} onClick={() => void prepareApproval()}>{approval.currentAllowance > 0n ? "Review allowance reset" : "Review exact approval"}</button></section> : null}
      {prepared ? <ModuleEngineTransactionReview prepared={prepared} busy={busy} disabled={blocked || step !== "prepare"} onEdit={backToEdit} onConfirm={() => void confirm()} quoteAsset={quoteState?.address} quoteDecimals={quoteState?.decimals} tradeFees={spot || customLaunch} genericAction={customInitial} showLaunchInputs={customLaunch}>{prepared.kind === "launch" ? <div className={engineStyles.launchSummary}><strong>{name} · {symbol}</strong><p>{description}</p><p className={styles.help}>Image: {imageUri || MODULE_DEFAULT_TOKEN_IMAGE}</p>{checkedSocial.ok ? <dl className={styles.reviewRows}>{socialFields.filter(({ key }) => checkedSocial.links[key]).map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{checkedSocial.links[key]}</dd></div>)}</dl> : null}</div> : null}</ModuleEngineTransactionReview> : null}
    </>}
    {blocked ? <p className={engineStyles.notice} role="status">{blockedReason ?? "Resolve your pending wallet operation before sending another transaction."}</p> : null}
    {error ? <p ref={errorFocus} tabIndex={-1} className={styles.fieldError} role="alert">{error}</p> : null}{notice ? <p className={engineStyles.notice} role="status">{notice}</p> : null}
  </div>;
}
