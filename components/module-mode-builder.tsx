"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ChevronDown, Download, Plus, Puzzle, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

import { ModuleLibrary, ModuleCategoryIcon } from "@/components/module-library";
import { ModulePickerDialog } from "@/components/module-picker-dialog";
import { moduleCategory } from "@/lib/module-mode/library";
import { ModuleSchemaField } from "@/components/module-mode-fields";
import { ModuleModeImagePicker, moduleModeImageSource, type ModuleModeImageResource } from "@/components/module-mode-image";
import { useViewChain } from "@/components/view-chain";
import styles from "@/components/module-mode-builder.module.css";
import {
  createModuleModeState,
  configurationSummary,
  feeBreakdown,
  formatNativeWei,
  nativeValueBreakdown,
  moduleModeFeePolicy,
  programmableFeeAllocation,
  NATIVE_ENGINE_PROFILE,
  PREVIEW_MODULE_CATALOG,
  setModuleSelected,
  validateModuleModeDraft,
  type BuilderIssue,
  type ModuleModeCatalogEntry,
  type ModuleModeDraft,
  type ModuleModeEngineProfile,
  type ModuleModeImage,
  type ModuleModeState,
  type ModuleModeFeePolicy,
  type OpenConfigContext,
} from "@/lib/module-mode/builder";
import type { ModuleModeRelease } from "@/lib/module-mode/release";

const feeOptions = Array.from({ length: 11 }, (_, index) => String(index));
const socialFields = [
  { key: "twitter", label: "Twitter / X", placeholder: "https://x.com/…" },
  { key: "website", label: "Website", placeholder: "https://…" },
  { key: "telegram", label: "Telegram", placeholder: "https://t.me/…" },
  { key: "discord", label: "Discord", placeholder: "https://discord.gg/…" },
  { key: "github", label: "GitHub", placeholder: "https://github.com/…" },
  { key: "gitbook", label: "GitBook", placeholder: "https://…" },
] as const;

function downloadDraft(draft: ModuleModeDraft) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(draft, null, 2)}\n`], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${draft.token.symbol.toLowerCase()}-module-mode-draft.json`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Supplied by a release-aware host only after its real prepare/sign/submit path is available. */
export interface ModuleModeLaunchAction {
  label: string;
  description: string;
  title?: string;
  disabled?: boolean;
  busy?: boolean;
  lockDraft?: boolean;
  onContinue: (draft: ModuleModeDraft, attachments: { tokenImage?: Blob }) => Promise<void>;
}

export interface ModuleModeBuilderProps {
  catalog?: readonly ModuleModeCatalogEntry[];
  engine?: ModuleModeEngineProfile;
  configurationContext?: OpenConfigContext;
  launchAction?: ModuleModeLaunchAction;
  minimumInitialBuyWei?: string;
  release?: ModuleModeRelease | null;
  previewDescription?: string;
  statusContent?: ReactNode;
  versionContent?: ReactNode;
  reviewContent?: ReactNode;
  resultContent?: ReactNode;
  onEdit?: () => void;
}

export function ModuleModeBuilder({ catalog = PREVIEW_MODULE_CATALOG, engine = NATIVE_ENGINE_PROFILE, configurationContext = {}, launchAction, minimumInitialBuyWei, release, previewDescription, statusContent, reviewContent, resultContent, onEdit }: Readonly<ModuleModeBuilderProps>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  useEffect(() => {
    if (!hydrated || viewChainId === 4663) return;
    // Run after the provider restores its persisted preference, as other fixed-chain routes do.
    const timer = window.setTimeout(() => setViewChainId(4663), 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, viewChainId, setViewChainId]);
  const [state, setState] = useState(createModuleModeState);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [feesOpen, setFeesOpen] = useState(false);
  const [moreLinks, setMoreLinks] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [configurationId, setConfigurationId] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [review, setReview] = useState<ModuleModeDraft | null>(null);
  const [reviewEntries, setReviewEntries] = useState<ModuleModeCatalogEntry[]>([]);
  const [reviewPolicy, setReviewPolicy] = useState<ModuleModeFeePolicy | null>(null);
  const [chosenEntries, setChosenEntries] = useState<Record<string, ModuleModeCatalogEntry>>({});
  const [removed, setRemoved] = useState<ModuleModeCatalogEntry | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [continuing, setContinuing] = useState(false);
  const [launchError, setLaunchError] = useState("");
  const [imageResource, setImageResource] = useState<ModuleModeImageResource | null>(null);
  const [previousImage, setPreviousImage] = useState<{ image: ModuleModeImage; resource: ModuleModeImageResource | null } | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const imageUrls = useRef(new Set<string>());
  useEffect(() => {
    const urls = imageUrls.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);
  const form = useRef<HTMLFormElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const result = useMemo(() => checked ? validateModuleModeDraft(state, catalog, configurationContext, engine, undefined, minimumInitialBuyWei, release) : null, [checked, state, catalog, configurationContext, engine, minimumInitialBuyWei, release]);
  const issues = result && !result.ok ? result.issues : [];
  const visibleCatalog = [...catalog, ...Object.values(chosenEntries).filter((entry) => !catalog.some((current) => current.id === entry.id))];
  const selected = review ? reviewEntries : visibleCatalog.filter((entry) => state.selectedModules.includes(entry.id));
  const policy = review ? reviewPolicy : moduleModeFeePolicy(release, selected);
  const fees = feeBreakdown(state.buyFeePercent, state.sellFeePercent, policy);
  const feeAllocation = programmableFeeAllocation(selected.length, policy);
  const missingSelected = selected.filter((entry) => !catalog.some((current) => current.id === entry.id));
  const configuredEntry = selected.find(entry => entry.id === configurationId);
  const amounts = nativeValueBreakdown(state, visibleCatalog);
  const hasFunding = selected.some((entry) => Boolean(entry.funding));
  const tokenImageSource = moduleModeImageSource(state.tokenImage, imageResource);
  const contextLocked = Boolean(continuing || launchAction?.busy || launchAction?.lockDraft);
  const previewMessage = previewDescription ?? "The wallet launch is not available yet. Export your draft to keep these settings; no token has been created.";

  function update<K extends keyof ModuleModeState>(key: K, value: ModuleModeState[K]) { setState((current) => ({ ...current, [key]: value })); }
  function fieldIssue(key: string) { return issues.find((issue) => issue.path === `/${key}`); }
  function changeImage(image: ModuleModeImage, resource: ModuleModeImageResource | null, checkpoint: boolean) {
    if (checkpoint) setPreviousImage({ image: state.tokenImage, resource: imageResource });
    if (resource) imageUrls.current.add(resource.objectUrl);
    setImageResource(resource); update("tokenImage", image);
  }
  function add(entry: ModuleModeCatalogEntry) {
    const fromUndo = document.activeElement instanceof HTMLElement && Boolean(document.activeElement.closest("[data-module-undo]"));
    setChosenEntries((current) => ({ ...current, [entry.id]: entry }));
    setState((current) => setModuleSelected(current, entry, true)); setRemoved(null);
    setAnnouncement(`${entry.title} added to your coin.`);
    if (fromUndo) requestAnimationFrame(() => document.getElementById(`module-selection-${entry.id}`)?.querySelector<HTMLButtonElement>("button")?.focus());
  }
  function remove(entry: ModuleModeCatalogEntry) {
    const fromEditor = form.current?.contains(document.activeElement);
    setState((current) => setModuleSelected(current, entry, false)); setRemoved(entry);
    setAnnouncement(`${entry.title} removed. Your settings are kept.`);
    if (fromEditor) requestAnimationFrame(() => form.current?.querySelector<HTMLButtonElement>("[data-module-add]")?.focus());
  }
  function showModules(id?: string) {
    if (id) setConfigurationId(id);
    else setPickerOpen(true);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (imageBusy || contextLocked) return; setChecked(true);
    const next = validateModuleModeDraft(state, catalog, configurationContext, engine, undefined, minimumInitialBuyWei, release);
    if (!next.ok) {
      if (next.issues.some((issue) => issue.path.startsWith("/socialLinks") || issue.path === "/description")) setDetailsOpen(true);
      if (next.issues.some((issue) => issue.path.includes("FeePercent"))) setFeesOpen(true);
      if (next.issues.some((issue) => /^\/socialLinks\/(discord|github|gitbook)$/.test(issue.path))) setMoreLinks(true);
      const firstIssue = next.issues[0];
      const invalidModule = selected.find(entry => firstIssue?.path.startsWith(`/modules/${entry.id}`) || firstIssue?.path === `/funding/${entry.id}`);
      if (invalidModule) { setConfigurationId(invalidModule.id); return; }
      requestAnimationFrame(() => { const target = form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]') ?? form.current?.querySelector<HTMLElement>("[data-error-summary]"); target?.focus(); });
      return;
    }
    setReviewEntries([...selected]);
    setReviewPolicy(moduleModeFeePolicy(release, selected));
    setReview(next.draft);
    requestAnimationFrame(() => { reviewHeading.current?.focus(); reviewHeading.current?.scrollIntoView({ block: "start", behavior: "auto" }); });
    if (launchAction) void continueLaunch(next.draft);
  }
  function backToEdit() { if (contextLocked) return; onEdit?.(); setReview(null); setLaunchError(""); setAnnouncement("Back to your draft. All settings are kept."); requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>("#module-name")?.focus()); }
  async function continueLaunch(draft = review) {
    if (!draft || !launchAction || launchAction.disabled || launchAction.busy || continuing || !hydrated || viewChainId !== 4663) return;
    setContinuing(true); setLaunchError("");
    try {
      if (draft.token.image.kind === "local" && !imageResource) throw new Error("Choose the token image again before launching.");
      await launchAction.onContinue(draft, { tokenImage: imageResource?.blob });
    }
    catch (error) { setLaunchError(error instanceof Error ? error.message : "The wallet step could not open. Your draft is kept."); }
    finally { setContinuing(false); }
  }

  function renderModuleConfiguration(entry: ModuleModeCatalogEntry) {
    const moduleIssues = issues.filter((issue) => issue.path.startsWith(`/modules/${entry.id}`)); return <section className={styles.moduleConfiguration} aria-label={`${entry.title} settings`}><details className={styles.moduleDetails}><summary>How it works</summary><p>{entry.detail}</p></details><ModuleSchemaField schema={entry.schema} value={state.moduleValues[entry.id] ?? entry.defaults} onChange={(value) => setState((current) => ({ ...current, moduleValues: { ...current.moduleValues, [entry.id]: value } }))} path={`/modules/${entry.id}`} fields={entry.fields} issues={moduleIssues} context={configurationContext} />{entry.funding ? <div className={styles.programFunding}><TextField label={entry.funding.label} name={`funding-${entry.id}`} value={state.moduleFundingEth[entry.id] ?? ""} suffix="ETH" inputMode="decimal" help={entry.funding.help} issue={issues.find((issue) => issue.path === `/funding/${entry.id}`)} onChange={(value) => setState((current) => ({ ...current, moduleFundingEth: { ...current.moduleFundingEth, [entry.id]: value } }))} /><p className={styles.help}>This ETH is additional. It does not come from your initial buy or creator fees.</p></div> : null}{moduleIssues.filter((issue) => issue.path === `/modules/${entry.id}`).map((issue, index) => <p className={styles.fieldError} key={index}>{issue.message}</p>)}</section>
  }

  return (
    <div className={`${styles.page} ${styles.studio}`}>
      <div className={styles.pageTop}><Link href="/launch" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" /> Launch</Link></div>
      {statusContent}
      <div className={resultContent ? styles.resultLayout : styles.layout}>
        {resultContent ? <section className={styles.formPanel}>{resultContent}</section> : review ? (
          <section className={styles.formPanel} aria-labelledby="module-review-title">
            <div className={styles.sectionHeading}><div><h1 id="module-review-title" ref={reviewHeading} tabIndex={-1}>{launchAction?.title ?? "Review draft"}</h1>{launchAction?.description ? <p role="status">{launchAction.description}</p> : null}</div></div>
            <dl className={styles.reviewRows}>
              <div><dt>Token</dt><dd>{review.token.name} <span>${review.token.symbol}</span></dd></div>
              <div><dt>Initial buy</dt><dd>{state.initialBuyEth.trim()} ETH</dd></div>
              {hasFunding ? <div><dt>Module budgets</dt><dd>{formatNativeWei(review.totalProgramFundingWei)} ETH</dd></div> : null}
              <div><dt>Total before gas</dt><dd>{formatNativeWei(review.totalNativeValueWei)} ETH</dd></div>
              <div><dt>Swap fees</dt><dd>{fees.buy} buy / {fees.sell} sell <span>Includes the {fees.programmable} platform fee</span></dd></div>
            </dl>
            {selected.length ? <details className={styles.transactionDetails}><summary>Module settings</summary>{selected.map((entry) => <div className={styles.reviewModule} key={entry.id}><h3>{entry.title}</h3><dl>{configurationSummary(entry.schema, state.moduleValues[entry.id], entry.fields, undefined, "", review.modules.find((item) => item.id === entry.id)?.bindings).map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}{entry.funding ? <div><dt>{entry.funding.label}</dt><dd>{state.moduleFundingEth[entry.id] || "0"} ETH additional</dd></div> : null}</dl></div>)}</details> : null}
            {!launchAction ? <div className={styles.previewNotice} role="status"><p>{previewMessage}</p></div> : null}
            {reviewContent}
            {launchError ? <p className={styles.fieldError} role="alert">{launchError}</p> : null}
            <div className={styles.reviewActions}><button type="button" className={styles.secondaryButton} disabled={contextLocked} onClick={backToEdit}><ArrowLeft size={16} aria-hidden="true" /> Edit coin</button>{launchAction ? <button type="button" className={styles.primaryButton} disabled={continuing || launchAction.disabled || launchAction.busy || !hydrated || viewChainId !== 4663} aria-busy={continuing || launchAction.busy} onClick={() => void continueLaunch()}>{launchAction.label}<ArrowRight size={17} aria-hidden="true" /></button> : <button type="button" className={styles.primaryButton} onClick={() => { downloadDraft(review); setAnnouncement("Draft exported."); }}><Download size={17} aria-hidden="true" /> Export draft</button>}</div>
            {!launchAction && imageResource && review.token.image.kind === "local" ? <a className={styles.textButton} href={imageResource.objectUrl} download={`${review.token.symbol.toLowerCase()}-token-image.webp`}><Download size={14} aria-hidden="true" /> Save image</a> : null}
          </section>
        ) : (
          <form ref={form} onSubmit={submit} noValidate className={styles.formPanel}>
            <header className={styles.heading}><h1>Create a coin</h1></header>
            <fieldset className={styles.formFields} disabled={contextLocked || !hydrated} aria-busy={!hydrated} aria-label="Token configuration">
            <section className={styles.formSection} aria-labelledby="module-token-title">
              <h2 id="module-token-title" className={styles.liveRegion}>Coin details</h2>
              <div className={styles.identityEditor}>
              <div className={styles.tokenFields}>
                <TextField label="Name" name="name" value={state.name} placeholder="Coin name" required issue={fieldIssue("name")} onChange={(value) => update("name", value)} />
                <TextField label="Symbol" name="symbol" value={state.symbol} placeholder="COIN" required issue={fieldIssue("symbol")} onChange={(value) => update("symbol", value)} />
              </div>
              <ModuleModeImagePicker compact="row" image={state.tokenImage} resource={imageResource} onChange={changeImage} onBusyChange={setImageBusy} error={fieldIssue("tokenImage")?.message} onUndo={previousImage ? () => { const previous = previousImage; setPreviousImage(null); changeImage(previous.image, previous.resource, false); } : undefined} />
              </div>
              <button type="button" className={styles.detailsToggle} aria-expanded={detailsOpen} aria-controls="module-coin-details" onClick={() => setDetailsOpen(value => !value)}>
                Description and links<ChevronDown size={16} aria-hidden="true" className={detailsOpen ? styles.chevronOpen : undefined} />
              </button>
              <div id="module-coin-details" hidden={!detailsOpen} className={styles.coinDetails}>
              <div className={styles.field}><label htmlFor="module-description">Description <span>Optional</span></label><textarea id="module-description" name="description" value={state.description} rows={2} placeholder="What’s the story?" aria-invalid={Boolean(fieldIssue("description")) || undefined} aria-describedby={fieldIssue("description") ? "module-description-error" : undefined} onChange={(event) => update("description", event.target.value)} />{fieldIssue("description") ? <p className={styles.fieldError} id="module-description-error">{fieldIssue("description")?.message}</p> : null}</div>
              <div className={styles.socialFields} role="group" aria-labelledby="module-socials-title">
                <h3 id="module-socials-title">Links <span>Optional</span></h3>
                <div className={styles.socialGrid}>{socialFields.slice(0, 3).map(({ key, label, placeholder }) => <TextField key={key} label={label} name={`social-${key}`} value={state.socialLinks?.[key] ?? ""} placeholder={placeholder} inputMode="url" issue={fieldIssue(`socialLinks/${key}`)} onChange={(value) => update("socialLinks", { ...state.socialLinks, [key]: value })} />)}</div>
                <div id="module-more-links" className={styles.socialGrid} hidden={!moreLinks}>{socialFields.slice(3).map(({ key, label, placeholder }) => <TextField key={key} label={label} name={`social-${key}`} value={state.socialLinks?.[key] ?? ""} placeholder={placeholder} inputMode="url" issue={fieldIssue(`socialLinks/${key}`)} onChange={(value) => update("socialLinks", { ...state.socialLinks, [key]: value })} />)}</div>
                <button className={styles.textButton} type="button" aria-expanded={moreLinks} aria-controls="module-more-links" onClick={() => setMoreLinks((current) => !current)}>{moreLinks ? <ChevronDown size={16} className={styles.chevronOpen} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{moreLinks ? "Fewer links" : "Add more links"}</button>
                {fieldIssue("socialLinks") ? <p className={styles.fieldError}>{fieldIssue("socialLinks")?.message}</p> : null}
              </div>
              </div>
            </section>
            <section className={styles.modulesSection} aria-labelledby="module-advanced-title">
              <div className={styles.moduleSectionHeading}><div><h2 id="module-advanced-title">Modules</h2><p>Add features to your coin.</p></div><Puzzle size={24} strokeWidth={1.6} aria-hidden="true" /></div>
              <div id="module-advanced-content">
                {selected.length ? <ul className={styles.selectedModules}>{selected.map(entry => <li key={entry.id} id={`module-selection-${entry.id}`}>
                  <ModuleCategoryIcon category={moduleCategory(entry).id} size={20} />
                  <button type="button" className={styles.configureModule} onClick={() => showModules(entry.id)} aria-label={`Configure ${entry.title}`}><span>{entry.title}</span><Settings2 size={16} aria-hidden="true" /></button>
                  <button type="button" className={styles.removeModule} onClick={() => remove(entry)} aria-label={`Remove ${entry.title}`}><X size={17} aria-hidden="true" /></button>
                </li>)}</ul> : null}
                <button type="button" className={styles.addModulesButton} data-module-add onClick={() => showModules()}><Plus size={18} aria-hidden="true" />Add modules</button>
                {removed ? <div className={styles.undo} data-module-undo><span>{removed.title} removed.</span><button type="button" onClick={() => add(removed)}>Undo</button></div> : null}
                {missingSelected.map((entry) => <div className={styles.unavailableModule} key={entry.id}><p><strong>{entry.title}</strong> is no longer in the current catalog. Your settings are kept; remove it to continue with another configuration.</p><button className={styles.textButton} type="button" onClick={() => remove(entry)}>Remove {entry.title}</button></div>)}

              </div>
            </section>
            <section className={styles.formSection} aria-labelledby="module-launch-title">
              <h2 id="module-launch-title" className={styles.liveRegion}>Launch settings</h2>
              <TextField label="Initial buy" name="initialBuyEth" value={state.initialBuyEth} placeholder="0.00" suffix="ETH" inputMode="decimal" required issue={fieldIssue("initialBuyEth")} help={minimumInitialBuyWei ? `Minimum ${formatNativeWei(minimumInitialBuyWei)} ETH, plus gas.` : "Your first purchase at launch, plus gas."} onChange={(value) => update("initialBuyEth", value)} />
              <button type="button" className={styles.feesToggle} aria-expanded={feesOpen} aria-controls="module-fee-settings" onClick={() => setFeesOpen(value => !value)}><span>Creator fees</span><strong>{state.buyFeePercent}% buy · {state.sellFeePercent}% sell</strong><ChevronDown size={16} aria-hidden="true" className={feesOpen ? styles.chevronOpen : undefined} /></button>
              <div id="module-fee-settings" hidden={!feesOpen} className={styles.feeSettings}>
              <div className={styles.twoFields}>{(["buy", "sell"] as const).map((direction) => { const key = `${direction}FeePercent` as const; const issue = fieldIssue(key); return <div className={styles.field} key={direction}><label htmlFor={`module-${key}`}>{direction === "buy" ? "Buy fee" : "Sell fee"}</label><select id={`module-${key}`} name={key} value={state[key]} onChange={(event) => update(key, event.target.value)} aria-invalid={Boolean(issue) || undefined} aria-describedby={issue ? `module-${key}-error` : undefined}>{feeOptions.map((value) => <option key={value} value={value}>{value}%</option>)}</select>{issue ? <p id={`module-${key}-error`} className={styles.fieldError}>{issue.message}</p> : null}</div>; })}</div>
              <div className={styles.feeLine}><span>Platform fee <span className={styles.feeAsset}>in ETH</span></span><strong>+ {fees.programmable}</strong></div>
              <details className={styles.feeExplanation}><summary>How fees are shared</summary><p>{feeAllocation} Added to each trade, including your initial buy.</p></details>
              </div>
            </section>
            {issues.length ? <div className={styles.errorSummary} tabIndex={-1} data-error-summary><strong>Check your draft</strong><ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul></div> : null}
            <div className={styles.formFooter}><button type="submit" className={styles.primaryButton} disabled={imageBusy || Boolean(launchAction?.disabled)}>{launchAction?.label ?? "Review draft"} <ArrowRight size={18} aria-hidden="true" /></button></div>
            {!launchAction ? <p className={styles.availabilityNote}>Wallet launching is unavailable. You can save a draft.</p> : null}
            </fieldset>
          </form>
        )}
        {!resultContent ? <aside className={styles.previewPanel} aria-labelledby="module-preview-title">
          <div className={styles.coinCard}>
            <div className={styles.coinCardHeading}>
              <div className={styles.coinAvatar}>{tokenImageSource ? <Image src={tokenImageSource} alt="Your selected token image" fill sizes="64px" unoptimized /> : <span aria-hidden="true">{state.symbol.trim().slice(0, 2).toUpperCase() || <Puzzle size={28} strokeWidth={1.5} />}</span>}</div>
              <div><h2 id="module-preview-title">{state.name.trim() || "Your coin"}</h2><p>{state.symbol.trim() ? `$${state.symbol.trim()}` : "$COIN"}</p></div>
            </div>
            {state.description.trim() ? <p className={styles.coinDescription}>{state.description.trim()}</p> : null}
            {selected.length ? <ul className={styles.coinAttachments} aria-label="Attached modules">{selected.map(entry => <li key={entry.id}><Puzzle size={16} aria-hidden="true" /><span>{entry.title}</span></li>)}</ul> : null}
            <dl className={styles.coinTotals}>
              <div><dt>Paired with</dt><dd>ETH</dd></div>
              <div><dt>Buy fee</dt><dd>{fees.buy}</dd></div><div><dt>Sell fee</dt><dd>{fees.sell}</dd></div>
              <div><dt>Initial buy</dt><dd>{amounts.initialBuy} ETH</dd></div>
              {hasFunding ? <><div><dt>Module budgets</dt><dd>{amounts.funding} ETH</dd></div><div className={styles.coinTotal}><dt>Total before gas</dt><dd>{amounts.total} ETH</dd></div></> : null}
            </dl>
            <p className={styles.coinFeeNote}>Includes the {fees.programmable} platform fee.</p>
          </div>
          <Link href="/developers/modules" className={styles.buildModuleLink}><Puzzle size={16} aria-hidden="true" />Build your own module<ArrowRight size={16} aria-hidden="true" /></Link>
        </aside> : null}
      </div>
      {pickerOpen ? <ModulePickerDialog title="Add modules" description="Modules are upgrades for your coin. Pick the features you want." onClose={() => setPickerOpen(false)}>
        <ModuleLibrary catalog={catalog} selectedIds={state.selectedModules} onAdd={add} onRemove={remove} />
      </ModulePickerDialog> : null}
      {configuredEntry ? <ModulePickerDialog title={configuredEntry.title} description={configuredEntry.summary} onClose={() => setConfigurationId(null)}>
        <fieldset className={styles.formFields} disabled={contextLocked}>{renderModuleConfiguration(configuredEntry)}</fieldset>
      </ModulePickerDialog> : null}
      <div className={styles.liveRegion} role="status" aria-live="polite">{announcement}</div>
    </div>
  );
}

function TextField({ label, name, value, onChange, placeholder, suffix, inputMode = "text", help, issue, required = false }: { label: string; name: string; value: string; onChange: (value: string) => void; placeholder?: string; suffix?: string; inputMode?: "text" | "decimal" | "url"; help?: string; issue?: BuilderIssue; required?: boolean }) {
  const id = `module-${name}`;
  return <div className={styles.field}><label htmlFor={id}>{label}{required ? <span className={styles.liveRegion}> (required)</span> : null}</label><div className={styles.inputWithUnit}><input id={id} name={name} type={inputMode === "url" ? "url" : "text"} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} required={required} autoComplete="off" autoCapitalize={inputMode === "url" ? "none" : undefined} spellCheck={name === "name"} aria-label={suffix ? `${label} (${suffix})` : undefined} aria-invalid={Boolean(issue) || undefined} aria-describedby={[help ? `${id}-help` : "", issue ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} />{suffix ? <span aria-hidden="true">{suffix}</span> : null}</div>{help ? <p className={styles.help} id={`${id}-help`}>{help}</p> : null}{issue ? <p className={styles.fieldError} id={`${id}-error`}>{issue.message}</p> : null}</div>;
}
