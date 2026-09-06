"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";

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
  type OpenConfigContext,
} from "@/lib/module-mode/builder";

const feeOptions = Array.from({ length: 11 }, (_, index) => String(index));

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
  previewDescription?: string;
  statusContent?: ReactNode;
  reviewContent?: ReactNode;
  onEdit?: () => void;
}

export function ModuleModeBuilder({ catalog = PREVIEW_MODULE_CATALOG, engine = NATIVE_ENGINE_PROFILE, configurationContext = {}, launchAction, minimumInitialBuyWei, previewDescription, statusContent, reviewContent, onEdit }: Readonly<ModuleModeBuilderProps>) {
  const { hydrated, viewChainId, setViewChainId } = useViewChain();
  useEffect(() => {
    if (!hydrated || viewChainId === 4663) return;
    // Run after the provider restores its persisted preference, as other fixed-chain routes do.
    const timer = window.setTimeout(() => setViewChainId(4663), 0);
    return () => window.clearTimeout(timer);
  }, [hydrated, viewChainId, setViewChainId]);
  const [state, setState] = useState(createModuleModeState);
  const [advanced, setAdvanced] = useState(false);
  const [checked, setChecked] = useState(false);
  const [review, setReview] = useState<ModuleModeDraft | null>(null);
  const [reviewEntries, setReviewEntries] = useState<ModuleModeCatalogEntry[]>([]);
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
  const result = useMemo(() => checked ? validateModuleModeDraft(state, catalog, configurationContext, engine, undefined, minimumInitialBuyWei) : null, [checked, state, catalog, configurationContext, engine, minimumInitialBuyWei]);
  const issues = result && !result.ok ? result.issues : [];
  const fees = feeBreakdown(state.buyFeePercent, state.sellFeePercent);
  const visibleCatalog = [...catalog, ...Object.values(chosenEntries).filter((entry) => !catalog.some((current) => current.id === entry.id))];
  const selected = review ? reviewEntries : visibleCatalog.filter((entry) => state.selectedModules.includes(entry.id));
  const missingSelected = selected.filter((entry) => !catalog.some((current) => current.id === entry.id));
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
    setChosenEntries((current) => ({ ...current, [entry.id]: entry }));
    setState((current) => setModuleSelected(current, entry, true)); setRemoved(null);
    setAnnouncement(`${entry.title} added. Configure it below.`);
  }
  function remove(entry: ModuleModeCatalogEntry) {
    setState((current) => setModuleSelected(current, entry, false)); setRemoved(entry);
    setAnnouncement(`${entry.title} removed. Your settings are kept.`);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (imageBusy || contextLocked) return; setChecked(true);
    const next = validateModuleModeDraft(state, catalog, configurationContext, engine, undefined, minimumInitialBuyWei);
    if (!next.ok) {
      if (next.issues.some((issue) => issue.path.startsWith("/modules") || issue.path.startsWith("/funding"))) setAdvanced(true);
      requestAnimationFrame(() => { const target = form.current?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"]') ?? form.current?.querySelector<HTMLElement>("[data-error-summary]"); target?.focus(); });
      return;
    }
    setReviewEntries([...selected]);
    setReview(next.draft);
    requestAnimationFrame(() => { reviewHeading.current?.focus(); reviewHeading.current?.scrollIntoView({ block: "start", behavior: "auto" }); });
  }
  function backToEdit() { if (contextLocked) return; onEdit?.(); setReview(null); setLaunchError(""); setAnnouncement("Back to your draft. All settings are kept."); requestAnimationFrame(() => form.current?.querySelector<HTMLInputElement>("input")?.focus()); }
  async function continueLaunch() {
    if (!review || !launchAction || launchAction.disabled || launchAction.busy || continuing || !hydrated || viewChainId !== 4663) return;
    setContinuing(true); setLaunchError("");
    try {
      if (review.token.image.kind === "local" && !imageResource) throw new Error("Choose the token image again before continuing. The draft only contains its file fingerprint.");
      await launchAction.onContinue(review, { tokenImage: imageResource?.blob });
    }
    catch (error) { setLaunchError(error instanceof Error ? error.message : "The wallet step could not open. Your draft is kept."); }
    finally { setContinuing(false); }
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageTop}><Link href="/launch" className={styles.backLink}><ArrowLeft size={16} aria-hidden="true" /> Create</Link><span className={styles.network} aria-label="Launch network: Robinhood. Fee currency: ETH.">Robinhood <span aria-hidden="true">·</span> ETH</span></div>
      <header className={styles.heading}>
        <div className={styles.titleRow}><h1>Module Mode</h1>{launchAction ? null : <span className={styles.previewTag}>Preview</span>}</div>
        <p>Start with a coin. Make it your own.</p>
      </header>
      {statusContent}
      <div className={styles.layout}>
        {review ? (
          <section className={styles.formPanel} aria-labelledby="module-review-title">
            <div className={styles.sectionHeading}><span className={styles.sectionMarker}><Check size={16} aria-hidden="true" /></span><div><h2 id="module-review-title" ref={reviewHeading} tabIndex={-1}>Review your draft</h2><p>Your configuration checks passed.</p></div></div>
            <dl className={styles.reviewRows}>
              <div><dt>Token</dt><dd>{review.token.name} <span>${review.token.symbol}</span></dd></div>
              <div><dt>Market</dt><dd>Bonding curve <span>ETH pair</span></dd></div>
              <div><dt>Initial buy</dt><dd>{state.initialBuyEth.trim()} ETH <span>Network gas is separate</span></dd></div>
              {hasFunding ? <><div><dt>Additional program budgets</dt><dd>{formatNativeWei(review.totalProgramFundingWei)} ETH <span>Separate from your initial buy and fees</span></dd></div><div><dt>Total ETH value</dt><dd>{formatNativeWei(review.totalNativeValueWei)} ETH <span>Plus network gas</span></dd></div></> : null}
              <div><dt>Creator fees at launch</dt><dd>{state.buyFeePercent}% buy / {state.sellFeePercent}% sell</dd></div>
              <div><dt>Programmable fee</dt><dd>+ 0.20% on every swap<span>{programmableFeeAllocation(selected.length)}</span></dd></div>
              <div><dt>Total at launch</dt><dd>{fees.buy} buy / {fees.sell} sell <span>Fees are collected in ETH</span></dd></div>
              <div><dt>Modules</dt><dd>{selected.length ? selected.map((entry) => entry.title).join(", ") : "None · just your coin"}</dd></div>
            </dl>
            {selected.map((entry) => <div className={styles.reviewModule} key={entry.id}><h3>{entry.title}</h3><p>{entry.detail}</p><dl>{configurationSummary(entry.schema, state.moduleValues[entry.id], entry.fields, undefined, "", review.modules.find((item) => item.id === entry.id)?.bindings).map((item, index) => <div key={`${item.label}-${index}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}{entry.funding ? <div><dt>{entry.funding.label}</dt><dd>{state.moduleFundingEth[entry.id] || "0"} ETH additional</dd></div> : null}</dl></div>)}
            {review.token.image.kind === "local" ? <p className={styles.help}>{launchAction ? "Preparing this launch uploads your selected image for its public token metadata. Your draft keeps the original file fingerprint." : "Your image stays on this device. The exported draft records its fingerprint; save the prepared image with it."}</p> : null}
            <div className={styles.previewNotice} role="status" aria-atomic="true"><strong>{launchAction ? launchAction.title ?? "Continue with your wallet." : "This is a configuration preview."}</strong><p>{launchAction?.description ?? previewMessage}</p></div>
            {reviewContent}
            {launchError ? <p className={styles.fieldError} role="alert">{launchError}</p> : null}
            <div className={styles.reviewActions}><button type="button" className={styles.secondaryButton} disabled={contextLocked} onClick={backToEdit}><ArrowLeft size={16} aria-hidden="true" /> Edit draft</button><button type="button" className={launchAction ? styles.secondaryButton : styles.primaryButton} onClick={() => { downloadDraft(review); setAnnouncement("Your validated draft was exported."); }}><Download size={17} aria-hidden="true" /> Export draft</button>{launchAction ? <button type="button" className={styles.primaryButton} disabled={continuing || launchAction.disabled || launchAction.busy || !hydrated || viewChainId !== 4663} aria-busy={continuing || launchAction.busy} onClick={() => void continueLaunch()}>{launchAction.label}<ArrowRight size={17} aria-hidden="true" /></button> : null}</div>
            {imageResource && review.token.image.kind === "local" ? <a className={styles.textButton} href={imageResource.objectUrl} download={`${review.token.symbol.toLowerCase()}-token-image.webp`}><Download size={14} aria-hidden="true" /> Save prepared image</a> : null}
          </section>
        ) : (
          <form ref={form} onSubmit={submit} noValidate className={styles.formPanel}>
            <fieldset className={styles.formFields} disabled={contextLocked} aria-label="Token configuration">
            <section className={styles.formSection} aria-labelledby="module-token-title">
              <div className={styles.sectionHeading}><span className={styles.sectionMarker}>1</span><div><h2 id="module-token-title">Your token</h2><p>A meme coin with a bonding curve, paired with ETH.</p></div></div>
              <ModuleModeImagePicker image={state.tokenImage} resource={imageResource} onChange={changeImage} onBusyChange={setImageBusy} error={fieldIssue("tokenImage")?.message} onUndo={previousImage ? () => { const previous = previousImage; setPreviousImage(null); changeImage(previous.image, previous.resource, false); } : undefined} />
              <div className={styles.tokenFields}>
                <TextField label="Name" name="name" value={state.name} placeholder="Give your coin a name" required issue={fieldIssue("name")} onChange={(value) => update("name", value)} />
                <TextField label="Symbol" name="symbol" value={state.symbol} placeholder="COIN" required issue={fieldIssue("symbol")} onChange={(value) => update("symbol", value)} />
              </div>
              <div className={styles.field}><label htmlFor="module-description">Description <span>Optional</span></label><textarea id="module-description" name="description" value={state.description} rows={2} placeholder="What’s the story?" aria-invalid={Boolean(fieldIssue("description")) || undefined} aria-describedby={fieldIssue("description") ? "module-description-error" : undefined} onChange={(event) => update("description", event.target.value)} />{fieldIssue("description") ? <p className={styles.fieldError} id="module-description-error">{fieldIssue("description")?.message}</p> : null}</div>
              <TextField label="Initial buy" name="initialBuyEth" value={state.initialBuyEth} placeholder="0.00" suffix="ETH" inputMode="decimal" required issue={fieldIssue("initialBuyEth")} help={minimumInitialBuyWei ? `Minimum ${formatNativeWei(minimumInitialBuyWei)} ETH. Your first purchase at launch; network gas is separate.` : "Your first purchase at launch. The final minimum and gas cost will be confirmed before signing."} onChange={(value) => update("initialBuyEth", value)} />
            </section>
            <section className={styles.formSection} aria-labelledby="module-fees-title">
              <div className={styles.sectionHeading}><span className={styles.sectionMarker}>2</span><div><h2 id="module-fees-title">Creator fees</h2><p>Choose what you earn from buys and sells.</p></div></div>
              <div className={styles.twoFields}>{(["buy", "sell"] as const).map((direction) => { const key = `${direction}FeePercent` as const; const issue = fieldIssue(key); return <div className={styles.field} key={direction}><label htmlFor={`module-${key}`}>{direction === "buy" ? "Buy fee" : "Sell fee"}</label><select id={`module-${key}`} name={key} value={state[key]} onChange={(event) => update(key, event.target.value)} aria-invalid={Boolean(issue) || undefined} aria-describedby={issue ? `module-${key}-error` : undefined}>{feeOptions.map((value) => <option key={value} value={value}>{value}%{value === "0" ? " · no creator fee" : ""}</option>)}</select>{issue ? <p id={`module-${key}-error`} className={styles.fieldError}>{issue.message}</p> : null}</div>; })}</div>
              <div className={styles.feeLine}><span>Programmable fee <span className={styles.feeAsset}>in ETH</span></span><strong>+ 0.20%</strong></div>
              <p className={styles.help}>Added to your creator fee on every swap, including when you choose 0%.</p>
              <p className={styles.help}>{programmableFeeAllocation(selected.length)}</p>
            </section>
            <section className={styles.advancedSection} aria-labelledby="module-advanced-title">
              <h2 className={styles.advancedHeading}><button type="button" id="module-advanced-title" className={styles.advancedToggle} aria-expanded={advanced} aria-controls="module-advanced-content" onClick={() => setAdvanced((current) => !current)}><span><span className={styles.advancedTitle}>Advanced <span>{selected.length ? `${selected.length} added` : "Optional"}</span></span><span className={styles.advancedDescription}>Add modules to change how your coin works.</span></span><ChevronDown className={advanced ? styles.chevronOpen : undefined} size={20} aria-hidden="true" /></button></h2>
              <div id="module-advanced-content" hidden={!advanced}>
                <p className={styles.catalogNotice}>{catalog.length ? "Choose the modules you want to configure." : "No modules are available in this catalog yet."}</p>
                <div className={styles.moduleCatalog}>{catalog.map((entry) => { const isSelected = state.selectedModules.includes(entry.id); return <div key={entry.id} className={styles.catalogRow} data-selected={isSelected}><div><h3>{entry.title}{entry.status === "preview" ? <span className={styles.catalogPreview}>Preview</span> : null}</h3><p>{entry.summary}</p></div><button type="button" className={isSelected ? styles.addedButton : styles.addButton} aria-label={isSelected ? `Remove ${entry.title}` : `Add ${entry.title}`} onClick={() => isSelected ? remove(entry) : add(entry)}>{isSelected ? <Check size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{isSelected ? "Added" : "Add"}</button></div>; })}</div>
                {removed ? <div className={styles.undo}><span>{removed.title} removed.</span><button type="button" onClick={() => add(removed)}>Undo</button></div> : null}
                {missingSelected.map((entry) => <div className={styles.unavailableModule} key={entry.id}><p><strong>{entry.title}</strong> is no longer in the current catalog. Your settings are kept; remove it to continue with another configuration.</p><button className={styles.textButton} type="button" onClick={() => remove(entry)}>Remove {entry.title}</button></div>)}
                {selected.map((entry) => { const moduleIssues = issues.filter((issue) => issue.path.startsWith(`/modules/${entry.id}`)); return <section className={styles.moduleConfiguration} key={entry.id} aria-labelledby={`module-${entry.id}-title`}><div className={styles.moduleConfigurationHeading}><h3 id={`module-${entry.id}-title`}>{entry.title}</h3><button className={styles.iconButton} type="button" aria-label={`Remove ${entry.title} configuration`} onClick={() => remove(entry)}><X size={18} aria-hidden="true" /></button></div><p className={styles.moduleDetail}>{entry.detail}</p><ModuleSchemaField schema={entry.schema} value={state.moduleValues[entry.id] ?? entry.defaults} onChange={(value) => setState((current) => ({ ...current, moduleValues: { ...current.moduleValues, [entry.id]: value } }))} path={`/modules/${entry.id}`} fields={entry.fields} issues={moduleIssues} context={configurationContext} />{entry.funding ? <div className={styles.programFunding}><TextField label={entry.funding.label} name={`funding-${entry.id}`} value={state.moduleFundingEth[entry.id] ?? ""} suffix="ETH" inputMode="decimal" help={entry.funding.help} issue={issues.find((issue) => issue.path === `/funding/${entry.id}`)} onChange={(value) => setState((current) => ({ ...current, moduleFundingEth: { ...current.moduleFundingEth, [entry.id]: value } }))} /><p className={styles.help}>This ETH is additional. It does not come from your initial buy or creator fees.</p></div> : null}{moduleIssues.filter((issue) => issue.path === `/modules/${entry.id}`).map((issue, index) => <p className={styles.fieldError} key={index}>{issue.message}</p>)}</section>; })}
              </div>
            </section>
            {issues.length ? <div className={styles.errorSummary} tabIndex={-1} data-error-summary><strong>Check your draft</strong><ul>{issues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul></div> : null}
            <div className={styles.formFooter}><p>{launchAction ? "Review your setup before preparing the wallet transaction." : "Preview your setup before exporting it."}</p><button type="submit" className={styles.primaryButton} disabled={imageBusy}>Review draft <ArrowRight size={18} aria-hidden="true" /></button></div>
            </fieldset>
          </form>
        )}
        <aside className={styles.previewPanel} aria-labelledby="module-preview-title">
          <div className={styles.tokenPreview}><div className={styles.tokenArtwork} data-custom={Boolean(tokenImageSource)}><Image src={tokenImageSource ?? "/brand/create/classic-botanical-v4.webp"} alt={tokenImageSource ? "Your selected token image" : ""} fill sizes="(max-width: 760px) 80px, 320px" unoptimized={Boolean(tokenImageSource)} />{tokenImageSource ? null : <span className={styles.tokenMonogram}>{state.symbol.trim().slice(0, 3) || "✳"}</span>}</div><div className={styles.tokenPreviewHeading}><span id="module-preview-title" className={styles.eyebrow}>Your coin</span><h2>{state.name.trim() || "A new beginning"}</h2><p>{state.symbol.trim() ? `$${state.symbol.trim()}` : "Your symbol goes here"}</p></div></div>
          <div className={styles.previewFacts}><div><span>Market</span><strong>ETH bonding curve</strong></div><div><span>Modules</span><strong>{selected.length === 0 ? "None" : selected.length}</strong></div></div>
          <div className={styles.totalFees}><h3>Total fees at launch</h3><div><span>Buy</span><strong>{fees.buy}</strong></div><div><span>Sell</span><strong>{fees.sell}</strong></div><p>Creator fee + 0.20% Programmable fee.<br />Collected in ETH. Gas is separate.</p></div>
          {hasFunding ? <div className={styles.nativeValueSummary}><h3>ETH to provide</h3><div><span>Initial buy</span><strong>{amounts.initialBuy} ETH</strong></div><div><span>Program budgets</span><strong>+ {amounts.funding} ETH</strong></div><div><span>Total, before gas</span><strong>{amounts.total} ETH</strong></div></div> : null}
          {selected.length ? <div className={styles.activeModules}>{selected.map((entry) => <span key={entry.id}><Check size={14} aria-hidden="true" />{entry.title}</span>)}</div> : <p className={styles.plainCoin}>Just a coin is a great place to start.<br />Modules are optional.</p>}
          <p className={styles.availabilityNote}>{launchAction ? "Review the exact transaction in your wallet before signing." : "Preview only. Wallet launching is not available yet."}</p>
        </aside>
      </div>
      <div className={styles.liveRegion} role="status" aria-live="polite">{announcement}</div>
    </div>
  );
}

function TextField({ label, name, value, onChange, placeholder, suffix, inputMode = "text", help, issue, required = false }: { label: string; name: string; value: string; onChange: (value: string) => void; placeholder?: string; suffix?: string; inputMode?: "text" | "decimal"; help?: string; issue?: BuilderIssue; required?: boolean }) {
  const id = `module-${name}`;
  return <div className={styles.field}><label htmlFor={id}>{label}{required ? <span className={styles.liveRegion}> (required)</span> : null}</label><div className={styles.inputWithUnit}><input id={id} name={name} type="text" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} inputMode={inputMode} required={required} autoComplete="off" spellCheck={name === "name"} aria-label={suffix ? `${label} (${suffix})` : undefined} aria-invalid={Boolean(issue) || undefined} aria-describedby={[help ? `${id}-help` : "", issue ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} />{suffix ? <span aria-hidden="true">{suffix}</span> : null}</div>{help ? <p className={styles.help} id={`${id}-help`}>{help}</p> : null}{issue ? <p className={styles.fieldError} id={`${id}-error`}>{issue.message}</p> : null}</div>;
}
