"use client";

import { Disclosure, DisclosurePanel, useDisclosureState } from "@/components/disclosure";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { formatUnits, keccak256, toHex, type Address, type Hex } from "viem";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, Plus, Puzzle } from "lucide-react";
import { MODULE_DEFAULT_TOKEN_IMAGE, validateModuleSocialLinks, type ModuleSocialLinks, type ModuleSocialIssue } from "@/lib/module-mode/token-metadata";
import { ModuleModeImagePicker, moduleModeImageSource, type ModuleModeImageResource } from "@/components/module-mode-image";
import { ModuleSchemaField } from "@/components/module-mode-fields";
import { assertModuleModeWalletUnchanged, moduleModeWalletStep } from "@/components/module-mode-wallet-state";
import { configurationFromForm, configurationToForm, defaultSchemaValue, parseExactUnits, utcDateTimeToSeconds, type FormValue, type ModuleModeImage } from "@/lib/module-mode/builder";
import { moduleAddress, moduleBytes } from "@/lib/module-mode/release";
import { ENGINE_ZERO_ADDRESS, ENGINE_ZERO_HASH, moduleEngineOptionalHash, parseModuleEngineAvailability, type ModuleEngineAvailability, type ModuleEngineCatalogDefinition } from "@/lib/module-engine/catalog";
import { createModuleEngineClient, ENGINE_OPERATIONS, moduleEngineDepositIntent, moduleEngineSettlementRequestIntent, moduleEngineTradeIntent, prepareModuleEngineApproval, prepareModuleEngineLaunch, readModuleEngineQuoteAsset, type ModuleEngineApprovalRequired, type ModuleEngineClient, type ModuleEngineOperationIntent, type PreparedModuleEngineTransaction } from "@/lib/module-engine/client";
import { isModuleEngineAnyQuoteEthRelease, isModuleEngineSharedQuoteRelease } from "@/lib/module-engine/profile";
import { prepareModuleEngineAnyQuoteLaunch } from "@/lib/module-engine/any-quote/integration-client";
import { anyQuoteUserMessage, ModuleEngineAnyQuoteAsset, useAnyQuoteAssetAvailability } from "./module-engine-any-quote-asset";
import { ModuleEnginePicker } from "./module-engine-library";
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
const subscribeToHydration = () => () => {};
const readHydrated = () => true;
const readServerHydrated = () => false;

function freshSalt() { return toHex(crypto.getRandomValues(new Uint8Array(32))); }
function message(error: unknown) { return anyQuoteUserMessage(error, error instanceof Error ? error.message.replace(/^Module engine: /, "") : "The launch could not be prepared."); }
function fixedConfiguration(schema: ModuleEngineCatalogDefinition["schema"]): boolean { return schema.binding?.mode === "fixed" || schema.type === "record" && Object.keys(schema.fields).length > 0 && Object.values(schema.fields).every(fixedConfiguration); }

/** Configuration and wallet controls extend the existing Module Mode flow; no independent wallet is created. */
export function ModuleEngineBuilder({ availability: raw, client: suppliedClient, wallet, onConnect, onSwitch, onSubmit, blocked, blockedReason, statusContent, versionContent, onUploadImage }: ModuleEngineBuilderProps) {
  const hydrated = useSyncExternalStore(subscribeToHydration, readHydrated, readServerHydrated);
  const client = useMemo(() => suppliedClient ?? createModuleEngineClient(), [suppliedClient]);
  const parsed = useMemo(() => { try { return { availability: parseModuleEngineAvailability(raw), error: null }; } catch (error) { return { availability: null, error: message(error) }; } }, [raw]);
  const availability = parsed.availability;
  const [selected, setSelected] = useState(""); const [forms, setForms] = useState<Record<string, FormValue>>({});
  const [name, setName] = useState(""); const [symbol, setSymbol] = useState(""); const [description, setDescription] = useState(""); const [imageUri, setImageUri] = useState("");
  const [socialLinks, setSocialLinks] = useState<ModuleSocialLinks>({}); const [socialIssues, setSocialIssues] = useState<ModuleSocialIssue[]>([]); const { expanded: moreLinks, setExpanded: setMoreLinks, toggle: toggleMoreLinks, panelProps: moreLinksPanel } = useDisclosureState();
  const [image, setImage] = useState<ModuleModeImage>({ kind: "none" }); const [imageResource, setImageResource] = useState<ModuleModeImageResource | null>(null); const [imageBusy, setImageBusy] = useState(false);
  const imageUrls = useRef(new Set<string>()), uploadedImage = useRef<{ hash: Hex; account: Address; uri: string } | null>(null);
  useEffect(() => { const urls = imageUrls.current; return () => urls.forEach(url => URL.revokeObjectURL(url)); }, []);
  const [quote, setQuote] = useState(""); const [quoteState, setQuoteState] = useState<(Awaited<ReturnType<typeof readModuleEngineQuoteAsset>> & { account: Address }) | null>(null);
  const [customInitialForm, setCustomInitialForm] = useState(emptyModuleEngineCustomOperation);
  const [creatorSaltInput, setCreatorSaltInput] = useState(""); const [engineSaltInput, setEngineSaltInput] = useState(""); const [launchData, setLaunchData] = useState("0x");
  const [amount, setAmount] = useState(""); const [amountError, setAmountError] = useState<string | null>(null); const amountFocus = useRef<HTMLInputElement>(null);
  const [minimumTokens, setMinimumTokens] = useState(""); const [minimumEth, setMinimumEth] = useState(""); const [route, setRoute] = useState("");
  const [buyFee, setBuyFee] = useState("0"); const [sellFee, setSellFee] = useState("0"); const [beneficiary, setBeneficiary] = useState(""); const [refundTime, setRefundTime] = useState(""); const [obligation, setObligation] = useState("");
  const [prepared, setPrepared] = useState<PreparedModuleEngineTransaction | null>(null); const [approval, setApproval] = useState<ModuleEngineApprovalRequired | null>(null);
  const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const salts = useRef<{ creator: Hex; engine: Hex } | null>(null);
  const coinDetails = useRef<HTMLDetailsElement>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const template = availability?.templates.find(item => item.manifest.manifest.catalogDefinition.id === selected) ?? availability?.templates[0];
  const definition = template?.manifest.manifest.catalogDefinition, revision = template?.manifest.manifest.revision;
  const fixedQuote = revision && revision.fixedQuoteAsset !== ENGINE_ZERO_ADDRESS ? revision.fixedQuoteAsset : null;
  const quoteAsset = fixedQuote ?? quote; const form = definition ? forms[definition.id] ?? moduleEngineInitialForm(definition) : {};
  const anyQuote = Boolean(availability?.release && isModuleEngineSharedQuoteRelease(availability.release) && definition?.interface === "quote-shared-v1");
  const anyQuoteAvailability = useAnyQuoteAssetAvailability({ enabled: anyQuote, releaseDigest: availability?.release?.releaseDigest, templateId: definition?.id, quoteAsset });
  const readyQuote = anyQuoteAvailability.status === "compatible" && anyQuoteAvailability.result?.status === "compatible" ? anyQuoteAvailability.result : null;
  const needsInitial = !anyQuote && revision && revision.initialOperationId !== ENGINE_ZERO_HASH, spot = definition?.interface === "quote-v1" || anyQuote;
  const initialPermission = revision?.operationPermissions.find(permission => permission.operationId === revision.initialOperationId);
  const customInitial = Boolean(needsInitial && !(spot && revision?.initialOperationId === ENGINE_OPERATIONS.buy) && !(definition?.interface === "escrow-v1" && revision?.initialOperationId === ENGINE_OPERATIONS.deposit) && !(definition?.interface === "settlement-v1" && revision?.initialOperationId === ENGINE_OPERATIONS.request));
  const customLaunch = definition?.interface === "custom-v1";
  const quoteVerified = anyQuote ? Boolean(readyQuote) : quoteState && quoteState.address.toLowerCase() === quoteAsset.toLowerCase() && quoteState.account.toLowerCase() === wallet.account?.toLowerCase();
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
    if (imageBusy) return;
    let initialBuyWei = 0n;
    if (anyQuote) {
      try { initialBuyWei = BigInt(parseExactUnits(amount, 18)); if (initialBuyWei <= 0n) throw new Error(); }
      catch { setError(null); setAmountError("Enter an ETH amount greater than 0. Use up to 18 decimal places."); amountFocus.current?.focus(); return; }
    }
    setAmountError(null); setBusy(true); setError(null); setNotice(null);
    try {
      const account = moduleAddress(wallet.account, "account"); assertModuleModeWalletUnchanged(wallet, account);
      if (!quoteVerified || (anyQuote ? !readyQuote : !quoteState)) throw new Error(anyQuote ? "Wait for current token availability before reviewing the launch." : "Check the quote asset before reviewing the launch.");
      const social = validateModuleSocialLinks(socialLinks);
      if (!social.ok) { if (coinDetails.current) coinDetails.current.open = true; setSocialIssues(social.issues); if (social.issues.some(issue => /\/(discord|github|gitbook)$/.test(issue.path))) setMoreLinks(true); throw new Error(social.issues[0]!.message); }
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
      const initialOperation = needsInitial && quoteState ? ({ token, quoteAsset }: { token: Address; quoteAsset: Address }): ModuleEngineOperationIntent => {
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
      const coin = { client, availability, templateId: definition.id, account, name, symbol, description, imageUri: resolvedImage, socialLinks: social.links, creatorSalt: customLaunch && creatorSaltInput.trim() ? moduleEngineOptionalHash(creatorSaltInput.trim(), "creator salt") : salts.current.creator, engineSalt: customLaunch && engineSaltInput.trim() ? moduleEngineOptionalHash(engineSaltInput.trim(), "engine salt") : salts.current.engine, creatorWallets: [account], creatorSharesBps: [10_000], buyCreatorFeeBps: Number(buyFee) * 100, sellCreatorFeeBps: Number(sellFee) * 100 };
      const result = anyQuote && readyQuote
        ? await prepareModuleEngineAnyQuoteLaunch({ ...coin, quoteAsset: readyQuote.quoteAsset, readiness: readyQuote, initialBuyWei, slippageBps: 100 })
        : await prepareModuleEngineLaunch({ ...coin, quoteAsset: quoteState!.address, configuration: configurationFromForm(definition.schema, form, definition.fields), ...(customLaunch ? { launchData: moduleBytes(launchData.trim(), "initialization data", 16_384) } : {}), initialOperation });
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

  const tokenImageSource = moduleModeImageSource(image, imageResource)
    ?? (imageUri ? moduleModeImageSource({ kind: "uri", uri: imageUri, contentVerified: false }, null) : null);
  const quoteLabel = anyQuote ? "Pool pair" : spot ? "Trading token" : "Funding token";
  const quoteShort = readyQuote?.token.symbol || (quoteAsset ? `${quoteAsset.slice(0, 6)}…${quoteAsset.slice(-4)}` : "Not chosen");

  return <div className={`${styles.page} ${engineStyles.root} ${engineStyles.builderRoot}`}>
    <div className={engineStyles.pageTop}><a href="/launch"><ArrowLeft size={16} aria-hidden="true" />Back</a></div>
    {statusContent}
    {!template || !definition || !availability?.release ? <section className={engineStyles.emptyState}><h1>Create a coin</h1><p role="status">No modules available yet.{parsed.error || availability?.reason ? ` ${parsed.error ?? availability?.reason}` : ""}</p></section> : <>
      {availability.reason ? <p className={engineStyles.notice} role="status">{availability.reason}</p> : null}
      <div className={engineStyles.studio} hidden={Boolean(prepared)}>
        <form className={`${styles.formPanel} ${engineStyles.builderForm}`} aria-busy={!hydrated || busy || imageBusy} onSubmit={event => { event.preventDefault(); void prepare(); }} onInvalidCapture={event => { let disclosure = event.target instanceof HTMLElement ? event.target.closest("details") : null; while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest("details") ?? null; } }}>
          <header className={engineStyles.heading}><h1>Create a coin</h1></header>
          <fieldset className={styles.formFields} disabled={!hydrated || busy || imageBusy || Boolean(prepared)} aria-busy={!hydrated}>
            <section className={styles.formSection}>
              <div className={`${styles.tokenFields} ${engineStyles.identityFields}`}>
                <div className={styles.field}><label htmlFor="engine-name">Name</label><input id="engine-name" autoComplete="off" placeholder="Your coin name" value={name} onChange={event => edit(() => setName(event.target.value))} required /></div>
                <div className={styles.field}><label htmlFor="engine-symbol">Ticker</label><input id="engine-symbol" autoComplete="off" placeholder="COIN" value={symbol} maxLength={11} onChange={event => edit(() => setSymbol(event.target.value))} required /></div>
              </div>
              {onUploadImage ? <ModuleModeImagePicker compact="row" image={image} resource={imageResource} onChange={changeImage} onBusyChange={setImageBusy} /> : <div className={styles.field}><label htmlFor="engine-image">Image link <span>Optional</span></label><input id="engine-image" type="url" placeholder="https://…" value={imageUri} onChange={event => edit(() => setImageUri(event.target.value))} /><p className={styles.help}>Leave blank to use the Programmable token image.</p></div>}
              <Disclosure ref={coinDetails} className={engineStyles.optionalDetails}>
                <summary><span>Description and links</span><ChevronDown size={16} aria-hidden="true" /></summary>
                <div className={engineStyles.detailsBody}>
                  <div className={styles.field}><label htmlFor="engine-description">Description</label><textarea id="engine-description" placeholder="A few words about your coin" value={description} onChange={event => edit(() => setDescription(event.target.value))} /></div>
                  <div className={styles.socialFields} role="group" aria-labelledby="engine-socials-title">
                    <h3 id="engine-socials-title">Links</h3>
                    <div className={styles.socialGrid}>{socialFields.slice(0, 3).map(socialInput)}</div>
                    <DisclosurePanel id="engine-more-links" {...moreLinksPanel} className={styles.socialGrid}>{socialFields.slice(3).map(socialInput)}</DisclosurePanel>
                    <button className={styles.textButton} type="button" aria-expanded={moreLinks} aria-controls="engine-more-links" onClick={toggleMoreLinks}>{moreLinks ? <ChevronDown size={16} className={styles.chevronOpen} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{moreLinks ? "Fewer links" : "Add more links"}</button>
                  </div>
                </div>
              </Disclosure>
            </section>

            <section className={styles.formSection} id="engine-modules">
              <div className={engineStyles.sectionHeading}><h2>Modules</h2><p>Add features to your coin.</p></div>
              <div className={engineStyles.selectedModule}>
                <Puzzle size={20} aria-hidden="true" />
                <div><strong>{definition.title}</strong><p>{definition.summary}</p></div>
                <button type="button" className={engineStyles.changeModule} disabled={!hydrated || busy || imageBusy || blocked} onClick={() => setPickerOpen(true)} aria-haspopup="dialog">Change</button>
              </div>
              {anyQuote ? <>
                <ModuleEngineAnyQuoteAsset value={quoteAsset} availability={anyQuoteAvailability} onChange={value => edit(() => setQuote(value))} />
                <div className={`${styles.field} ${engineStyles.anyQuoteInitialBuy}`}>
                  <label htmlFor="engine-amount">Initial buy</label>
                  <div className={engineStyles.anyQuoteAmount}><input ref={amountFocus} id="engine-amount" aria-label="Initial buy in ETH" inputMode="decimal" placeholder="0" autoComplete="off" required value={amount} onChange={event => edit(() => { setAmount(event.target.value); setAmountError(null); })} onInvalid={event => { event.preventDefault(); setAmountError("Enter an ETH amount greater than 0."); amountFocus.current?.focus(); }} aria-invalid={Boolean(amountError) || undefined} aria-describedby={amountError ? "engine-amount-help engine-amount-error" : "engine-amount-help"} /><span aria-hidden="true">ETH</span></div>
                  <p id="engine-amount-help" className={styles.help}>Buy your coin in the launch transaction.</p>
                  {amountError ? <p id="engine-amount-error" className={styles.fieldError} role="alert">{amountError}</p> : null}
                </div>
                <p className={engineStyles.sectionNote}>1 billion coins · approximately $5,000 starting value · permanently locked liquidity.</p>
                <Disclosure className={engineStyles.moduleAbout}>
                  <summary><span>About this module</span><ChevronDown size={16} aria-hidden="true" /></summary>
                  <div className={engineStyles.detailsBody}><p>{definition.detail}</p><p>The starting value is a price estimate, not deposited funds. ETH conversion and gas costs are additional.</p>{versionContent}</div>
                </Disclosure>
              </> : <Disclosure className={engineStyles.moduleSettings} key={`settings-${definition.id}`}>
                <summary><span>Module settings</span><ChevronDown size={16} aria-hidden="true" /></summary>
                <div className={engineStyles.detailsBody}>
                <div className={styles.field}>
                  <label htmlFor="engine-quote">{quoteLabel} {fixedQuote ? <span>Fixed by module</span> : null}</label>
                  <input id="engine-quote" value={quoteAsset} readOnly={Boolean(fixedQuote)} placeholder="Token address, 0x…" spellCheck={false} autoComplete="off" onChange={event => edit(() => { setQuote(event.target.value); setQuoteState(null); })} />
                  <p className={styles.help}>{fixedQuote ? "This module uses this token for every launch." : spot ? "The token used to buy and sell your coin. Enter its contract address on Robinhood Chain." : "The token this module accepts. Enter its contract address on Robinhood Chain."}</p>
                </div>
                <div className={engineStyles.assetCheck}>
                  <button type="button" className={styles.secondaryButton} disabled={step !== "prepare"} onClick={() => void checkQuote()}>{quoteVerified ? <Check size={16} aria-hidden="true" /> : null}{busy ? "Checking token…" : quoteVerified ? "Check again" : "Check token"}</button>
                  {quoteVerified && quoteState ? <span className={engineStyles.assetBalance}><Check size={14} aria-hidden="true" />{formatUnits(quoteState.balance, quoteState.decimals)} available</span> : null}
                </div>
                {fixedConfiguration(definition.schema) ? <Disclosure className={engineStyles.optionalDetails}>
                  <summary><span>Fixed module settings</span><ChevronDown size={16} aria-hidden="true" /></summary>
                  <div className={engineStyles.detailsBody}><ModuleSchemaField schema={definition.schema} value={form} onChange={() => {}} path="/engine/fixed-configuration" fields={definition.fields} context={{ roles: wallet.account ? { launchWallet: wallet.account as Address } : {}, assets: quoteVerified && quoteState ? { quote: { chainId: "4663", address: quoteState.address, decimals: quoteState.decimals } } : {} }} /></div>
                </Disclosure> : <div className={engineStyles.configuration}><ModuleSchemaField schema={definition.schema} value={form} onChange={value => edit(() => setForms(current => ({ ...current, [definition.id]: value })))} path="/engine/configuration" fields={definition.fields} context={{ roles: wallet.account ? { launchWallet: wallet.account as Address } : {}, assets: quoteVerified && quoteState ? { quote: { chainId: "4663", address: quoteState.address, decimals: quoteState.decimals } } : {} }} /></div>}
                <Disclosure className={engineStyles.moduleAbout}>
                  <summary><span>About this module</span><ChevronDown size={16} aria-hidden="true" /></summary>
                  <div className={engineStyles.detailsBody}><p>{definition.detail}</p>{versionContent}</div>
                </Disclosure>
                </div>
              </Disclosure>}
            </section>

            {anyQuote ? <Disclosure className={`${engineStyles.launchSettings} ${engineStyles.optionalDetails}`}>
              <summary><span>Creator fees</span><span className={engineStyles.optionalLabel}>{buyFee}% buy · {sellFee}% sell</span><ChevronDown size={16} aria-hidden="true" /></summary>
              <div className={engineStyles.detailsBody}>
                <div className={styles.twoFields}>{[["buy", buyFee, setBuyFee], ["sell", sellFee, setSellFee]].map(([side, value, setValue]) => <div className={styles.field} key={side as string}><label htmlFor={`engine-${side}-fee`}>{side === "buy" ? "Buy" : "Sell"} fee</label><select id={`engine-${side}-fee`} value={value as string} onChange={event => edit(() => (setValue as (value: string) => void)(event.target.value))}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={String(i)}>{i}%</option>)}</select></div>)}</div>
                <p className={styles.help}>Your creator fees are separate from the fixed 0.3% module fee on every buy and sell. All fees accrue in {isModuleEngineAnyQuoteEthRelease(availability.release) ? "ETH" : "the pool pair token"}. Creator rates stay fixed after launch.</p>
              </div>
            </Disclosure> : <Disclosure className={`${engineStyles.launchSettings} ${engineStyles.optionalDetails}`}>
              <summary><span>Launch settings</span><ChevronDown size={16} aria-hidden="true" /></summary>
              <div className={engineStyles.detailsBody}>
              {needsInitial && customInitial && initialPermission ? <div className={engineStyles.initialAction}><h3>First action</h3><ModuleEngineCustomOperationFields id="engine-initial-action" permission={initialPermission} value={customInitialForm} account={wallet.account} onChange={value => edit(() => setCustomInitialForm(value))} /></div> : null}
              {needsInitial && !customInitial ? <div className={engineStyles.initialAction}>
                <h3>{spot ? "First buy" : "Starting funds"}</h3>
                <p className={engineStyles.sectionNote}>{spot ? "Buy coins as part of your launch." : "Fund the module as part of your launch."} If this fails, the launch is cancelled.</p>
                <div className={styles.field}><label htmlFor="engine-amount">{spot ? "Amount to spend" : "Amount to deposit"}</label><input id="engine-amount" inputMode="decimal" value={amount} onChange={event => edit(() => setAmount(event.target.value))} required /><p className={styles.help}>In the {spot ? "trading" : "funding"} token selected above.</p></div>
                {spot ? <>
                  <div className={styles.twoFields}>
                    <div className={styles.field}><label htmlFor="engine-min-tokens">Minimum coins received</label><input id="engine-min-tokens" inputMode="decimal" value={minimumTokens} onChange={event => edit(() => setMinimumTokens(event.target.value))} required /></div>
                    <div className={styles.field}><label htmlFor="engine-min-eth">Minimum fees in ETH</label><input id="engine-min-eth" inputMode="decimal" value={minimumEth} onChange={event => edit(() => setMinimumEth(event.target.value))} required /></div>
                  </div>
                  <Disclosure className={engineStyles.optionalDetails}><summary><span>How fees are converted</span><ChevronDown size={16} aria-hidden="true" /></summary><div className={engineStyles.detailsBody}><p className={styles.help}>Trade fees come from your spend amount and are converted to ETH. Your minimum sets the lowest ETH return you accept.</p><div className={styles.field}><label htmlFor="engine-route">Conversion route <span>Fixed by module</span></label><input id="engine-route" readOnly value={quoteState?.routes.find(item => item.data === route)?.label ?? "Check the trading token first"} /></div></div></Disclosure>
                </> : null}
                {revision?.initialOperationId === ENGINE_OPERATIONS.request ? <>
                  <div className={styles.field}><label htmlFor="engine-beneficiary">Recipient wallet</label><input id="engine-beneficiary" value={beneficiary} onChange={event => edit(() => setBeneficiary(event.target.value))} /></div>
                  <div className={styles.field}><label htmlFor="engine-refund">Refund available at (UTC)</label><input id="engine-refund" type="datetime-local" value={refundTime} onChange={event => edit(() => setRefundTime(event.target.value))} /></div>
                  <div className={styles.field}><label htmlFor="engine-obligation">Payment reference</label><textarea id="engine-obligation" value={obligation} onChange={event => edit(() => setObligation(event.target.value))} /><p className={styles.help}>You confirm when this obligation is fulfilled. A fingerprint of the reference is stored with the payment.</p></div>
                </> : null}
              </div> : null}
              {spot || customLaunch ? <Disclosure className={engineStyles.optionalDetails}>
                <summary><span>{customLaunch ? "Creator fee settings" : "Creator fees"}</span><span className={engineStyles.optionalLabel}>{buyFee}% buy · {sellFee}% sell</span><ChevronDown size={16} aria-hidden="true" /></summary>
                <div className={engineStyles.detailsBody}>
                  <div className={styles.twoFields}>{[["buy", buyFee, setBuyFee], ["sell", sellFee, setSellFee]].map(([side, value, setValue]) => <div className={styles.field} key={side as string}><label htmlFor={`engine-${side}-fee`}>{side === "buy" ? "Buy" : "Sell"} fee</label><select id={`engine-${side}-fee`} value={value as string} onChange={event => edit(() => (setValue as (value: string) => void)(event.target.value))}>{Array.from({ length: 11 }, (_, i) => <option key={i} value={String(i)}>{i}%</option>)}</select></div>)}</div>
                  <p className={styles.help}>{customLaunch ? "These terms apply to actions that use the module’s fee settings. Check its description for details." : "Creator fees accrue in ETH to your connected wallet. The platform fee is shown at review."}</p>
                </div>
              </Disclosure> : null}
              {customLaunch ? <Disclosure className={engineStyles.optionalDetails}>
                <summary><span>Advanced launch inputs</span><ChevronDown size={16} aria-hidden="true" /></summary>
                <div className={engineStyles.detailsBody}>
                  <p className={engineStyles.sectionNote}>Use these only when your module requires specific deployment values. Blank salts use fresh random values.</p>
                  <div className={engineStyles.stack}>
                    <div className={styles.field}><label htmlFor="engine-creator-salt">Creator salt <span>Optional</span></label><input id="engine-creator-salt" autoComplete="off" spellCheck={false} value={creatorSaltInput} placeholder="0x… (32 bytes)" onChange={event => edit(() => setCreatorSaltInput(event.target.value))} /><p className={styles.help}>Binds the new coin identity. Use the coin details that were used to prepare this salt.</p></div>
                    <div className={styles.field}><label htmlFor="engine-address-salt">Engine salt <span>Optional</span></label><input id="engine-address-salt" autoComplete="off" spellCheck={false} value={engineSaltInput} placeholder="0x… (32 bytes)" onChange={event => edit(() => setEngineSaltInput(event.target.value))} /></div>
                    <div className={styles.field}><label htmlFor="engine-launch-data">Initialization data</label><textarea id="engine-launch-data" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={32_770} value={launchData} onChange={event => edit(() => setLaunchData(event.target.value))} /><p className={styles.help}>Use 0x for no data. Maximum 16 KiB.</p></div>
                  </div>
                </div>
              </Disclosure> : null}
              {!needsInitial && !spot && !customLaunch ? <p className={engineStyles.sectionNote}>No starting funds required.</p> : null}
              </div>
            </Disclosure>}
          </fieldset>
          <div className={engineStyles.launchFooter}>
            {anyQuote ? <p>0.3% module fee per buy and sell, plus your creator fees.</p> : step === "prepare" && !quoteVerified ? <p>Check the token in Module settings to continue.</p> : null}
            {connectedAction ? <button type="button" className={styles.primaryButton} disabled={!hydrated} onClick={event => { event.preventDefault(); void connectedAction(); }}>{step === "connect" ? "Connect wallet" : "Switch to Robinhood Chain"}<ArrowUpRight size={18} aria-hidden="true" /></button> : <button type="submit" className={styles.primaryButton} id="engine-launch-review" disabled={!hydrated || busy || imageBusy || blocked || !quoteVerified}>{imageBusy ? "Preparing image…" : busy ? "Checking launch…" : "Review launch"}<ArrowUpRight size={18} aria-hidden="true" /></button>}
          </div>
        </form>

        <aside className={engineStyles.preview} aria-label="Coin summary">
          <div className={engineStyles.summaryContent}>
          <div className={engineStyles.coinIdentity}>
            <div className={engineStyles.coinArtwork}><Image src={tokenImageSource ?? "/brand/loop/programmable-module-token-default-v1.png"} alt="" fill sizes="64px" unoptimized /></div>
            <h2>{name.trim() || "Your coin"}</h2>
            <p>{symbol.trim() ? `$${symbol.trim()}` : "$COIN"}</p>
            {description.trim() ? <p className={engineStyles.coinDescription}>{description}</p> : null}
          </div>
          <div className={engineStyles.attachmentLine} aria-hidden="true"><span /></div>
          <div className={engineStyles.previewModule}>
            <span className={engineStyles.moduleIcon}><Puzzle size={20} aria-hidden="true" /></span>
            <div><strong>{definition.title}</strong></div>
          </div>
          <dl className={engineStyles.previewFacts}>
            <div><dt>{quoteLabel}</dt><dd title={quoteAsset || undefined}>{quoteShort}</dd></div>
            {spot || customLaunch ? <div><dt>{customLaunch ? "Fee settings" : "Creator fees"}</dt><dd>{buyFee}% buy · {sellFee}% sell</dd></div> : null}
            {anyQuote ? <><div><dt>Buy and sell with</dt><dd>ETH</dd></div><div><dt>Module fee</dt><dd>0.3%</dd></div><div><dt>Initial buy</dt><dd>{amount.trim() ? `${amount} ETH` : "Not set"}</dd></div></> : null}
            {needsInitial && !customInitial ? <div><dt>{spot ? "First buy" : "Starting funds"}</dt><dd>{amount.trim() ? `${amount} tokens` : "Not set"}</dd></div> : null}
          </dl>
          </div>
          <Link href="/developers/modules" className={engineStyles.buildLink}><Puzzle size={16} aria-hidden="true" />Build your own module<ArrowUpRight size={16} aria-hidden="true" /></Link>
        </aside>
      </div>
      <ModuleEnginePicker open={pickerOpen} templates={availability.templates} selectedId={definition.id} disabled={!hydrated || busy || imageBusy || blocked} onClose={() => setPickerOpen(false)} onSelect={item => { edit(() => { setSelected(item.manifest.manifest.catalogDefinition.id); setQuoteState(null); setAmount(""); setAmountError(null); salts.current = null; setCustomInitialForm(emptyModuleEngineCustomOperation()); setCreatorSaltInput(""); setEngineSaltInput(""); setLaunchData("0x"); setBuyFee("0"); setSellFee("0"); }); setPickerOpen(false); }} />
      {approval && !prepared ? <section className={engineStyles.notice} role="status"><p>Allow the launch contract to use exactly {quoteState ? formatUnits(approval.amount, quoteState.decimals) : approval.amount.toString()} quote tokens to fund this launch.</p><button id="engine-approval-review" className={styles.secondaryButton} type="button" disabled={busy || blocked} onClick={() => void prepareApproval()}>{approval.currentAllowance > 0n ? "Review allowance reset" : "Review exact approval"}</button></section> : null}
      {prepared ? <ModuleEngineTransactionReview prepared={prepared} busy={busy} disabled={blocked || step !== "prepare"} onEdit={backToEdit} onConfirm={() => void confirm()} quoteAsset={readyQuote?.quoteAsset ?? quoteState?.address} quoteDecimals={readyQuote?.token.decimals ?? quoteState?.decimals} quoteSymbol={readyQuote?.token.symbol} anyQuote={anyQuote} tradeFees={spot || customLaunch} genericAction={customInitial} showLaunchInputs={customLaunch}>{prepared.kind === "launch" ? <div className={engineStyles.launchSummary}><strong>{name} · {symbol}</strong><p>{description}</p><p className={styles.help}>Image: {imageUri || MODULE_DEFAULT_TOKEN_IMAGE}</p>{checkedSocial.ok ? <dl className={styles.reviewRows}>{socialFields.filter(({ key }) => checkedSocial.links[key]).map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{checkedSocial.links[key]}</dd></div>)}</dl> : null}</div> : null}</ModuleEngineTransactionReview> : null}
    </>}
    {blocked ? <p className={engineStyles.notice} role="status">{blockedReason ?? "Resolve your pending wallet operation before sending another transaction."}</p> : null}
    {error ? <p ref={errorFocus} tabIndex={-1} className={styles.fieldError} role="alert">{error}</p> : null}{notice ? <p className={engineStyles.notice} role="status">{notice}</p> : null}
  </div>;
}
