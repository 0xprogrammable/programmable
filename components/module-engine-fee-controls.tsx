"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { formatUnits, isAddress, type Address } from "viem";
import { readModuleEngineFeeControls, type ModuleEngineClient, type ModuleEngineFeeChangeIntent, type ModuleEngineFeeControlsSnapshot, type ModuleEngineReceiptResult, type PreparedModuleEngineFeeChange } from "@/lib/module-engine/client";
import type { ModuleEngineRelease, ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import styles from "./module-mode-builder.module.css";
import engineStyles from "./module-engine-ui.module.css";

export function ModuleEngineFeeControls({ client, release, template, token, account, disabled, onPrepare }: {
  client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; token: Address; account: Address;
  disabled?: boolean; onPrepare: (intent: ModuleEngineFeeChangeIntent) => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<ModuleEngineFeeControlsSnapshot | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  async function load() {
    setLoading(true); setError("");
    try { setSnapshot(await readModuleEngineFeeControls({ client, release, template, token, account })); }
    catch (caught) { setError(caught instanceof Error ? caught.message.replace(/^Module engine: /, "") : "Fee recipients could not be verified."); }
    finally { setLoading(false); }
  }
  const current = snapshot?.actor === account.toLowerCase() && snapshot?.releaseDigest === release.releaseDigest && snapshot?.launch.token === token.toLowerCase() ? snapshot : null;
  return <section className={styles.formPanel} aria-label="Fee recipients">
    <h2>Fee recipients</h2>
    <p className={styles.help}>View the current recipients and the changes your wallet can make. Changes apply to future fees. Existing claims remain with their current wallets.</p>
    <div className={engineStyles.actions}><button type="button" className={styles.secondaryButton} disabled={disabled || loading} onClick={() => void load()}>{loading ? "Checking recipients…" : current ? "Refresh fee recipients" : "Load fee recipients"}</button></div>
    {current ? <RecipientForms key={current.adminRevision + ":" + current.creatorWallets.join(":") + ":" + current.authors.map(author => author.author + ":" + author.wallet).join(":")} snapshot={current} disabled={disabled || loading} onPrepare={onPrepare} /> : null}
    {error ? <p role="alert" className={styles.fieldError}>{error}</p> : null}
  </section>;
}

function WalletChangeForm({ labels, initial, disabled, authority, onPrepare }: {
  labels: readonly string[]; initial: readonly Address[]; disabled?: boolean; authority: string; onPrepare: (wallets: Address[]) => Promise<void>;
}) {
  const [wallets, setWallets] = useState<string[]>([...initial]), [invalid, setInvalid] = useState<number[]>([]);
  const errorId = useId(), inputs = useRef<(HTMLInputElement | null)[]>([]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const bad = wallets.flatMap((wallet, index) => !isAddress(wallet.trim()) || /^0x0{40}$/i.test(wallet.trim()) ? [index] : []);
    setInvalid(bad); if (bad.length) { inputs.current[bad[0]]?.focus(); return; }
    await onPrepare(wallets.map(wallet => wallet.trim() as Address));
  }
  return <form onSubmit={event => void submit(event)}>
    <p className={styles.help}>{authority}</p>
    <fieldset className={styles.formFields} disabled={disabled}>
      {labels.map((label, index) => <div className={styles.field} key={label}><label htmlFor={errorId + index}>{label}</label>
        <input id={errorId + index} ref={element => { inputs.current[index] = element; }} value={wallets[index]} onChange={event => setWallets(values => values.map((value, slot) => slot === index ? event.target.value : value))}
          spellCheck={false} autoComplete="off" aria-invalid={invalid.includes(index)} aria-describedby={invalid.includes(index) ? errorId : undefined} />
      </div>)}
    </fieldset>
    {invalid.length ? <p id={errorId} role="alert" className={styles.fieldError}>Enter a valid nonzero wallet for each recipient.</p> : null}
    <div className={engineStyles.actions}><button className={styles.secondaryButton} type="submit" disabled={disabled}>Review wallet change</button></div>
  </form>;
}
function RecipientForms({ snapshot, disabled, onPrepare }: { snapshot: ModuleEngineFeeControlsSnapshot; disabled?: boolean; onPrepare: (intent: ModuleEngineFeeChangeIntent) => Promise<void> }) {
  const admin = snapshot.actor === snapshot.treasury || snapshot.actor === snapshot.administrator;
  const ownSlots = snapshot.creatorWallets.flatMap((wallet, index) => wallet === snapshot.actor ? [index] : []);
  return <div className={engineStyles.stack}>
    <div><h3>Creator fee recipients</h3><dl className={styles.reviewRows}>{snapshot.creatorWallets.map((wallet, index) => <div key={index}><dt>Recipient {index + 1} · {formatUnits(BigInt(snapshot.creatorSharesBps[index]), 2)}%</dt><dd>{wallet}{wallet === snapshot.actor ? <span> · Your wallet</span> : null}</dd></div>)}</dl>
      <p className={styles.help}>Shares stay fixed. A recipient can change its own slot. The treasury or reward administrator can replace all creator recipients.</p>
      {ownSlots.map(index => <details className={engineStyles.details} key={index}><summary>Change my creator fee wallet{ownSlots.length > 1 ? " · recipient " + (index + 1) : ""}</summary>
        <WalletChangeForm labels={["New creator fee wallet"]} initial={[snapshot.creatorWallets[index]]} disabled={disabled} authority="Your connected wallet is the current recipient of this slot." onPrepare={wallets => onPrepare({ kind: "rotate-creator", index, recipient: wallets[0] })} />
      </details>)}
      {admin ? <details className={engineStyles.details}><summary>Replace creator fee recipients</summary>
        <WalletChangeForm labels={snapshot.creatorSharesBps.map((share, index) => "New recipient " + (index + 1) + " · " + formatUnits(BigInt(share), 2) + "%")} initial={snapshot.creatorWallets} disabled={disabled}
          authority={snapshot.actor === snapshot.treasury ? "Your connected wallet is the ledger treasury." : "Your connected wallet is the ledger reward administrator."} onPrepare={recipients => onPrepare({ kind: "replace-creators", recipients })} />
      </details> : null}
    </div>
    {snapshot.quoteFees ? <div><h3>Module fee recipient</h3>
      <dl className={styles.reviewRows}><div><dt>Current wallet · full 0.3%</dt><dd>{snapshot.treasury}{snapshot.treasury === snapshot.actor ? " · Your wallet" : ""}</dd></div></dl>
      <p className={styles.help}>The entire module fee accrues in {snapshot.nativeEthFees ? "ETH" : "each pool pair token"}. Changing this wallet affects future fees across this module version. Existing claims stay with the wallets that earned them. The 0.3% rate stays fixed.</p>
      {admin ? <details className={engineStyles.details}><summary>Change module fee wallet</summary>
        <WalletChangeForm labels={["New module fee wallet"]} initial={[snapshot.treasury]} disabled={disabled}
          authority={snapshot.actor === snapshot.treasury ? "Your connected wallet is the current module fee recipient." : "Your connected wallet is the ledger reward administrator."}
          onPrepare={wallets => onPrepare({ kind: "rotate-platform", recipient: wallets[0] })} />
      </details> : null}
    </div> : null}
    {snapshot.authors.length > 0 ? <div><h3>Author fee wallets</h3><p className={styles.help}>Only the registered author can change the fee wallet of a family. The change applies across all coins using that family in this registry. It does not transfer authorship or existing claims.</p>
      {snapshot.authors.map((author, index) => <div key={author.familyId}><dl className={styles.reviewRows}><div><dt>Author {index + 1}</dt><dd>{author.author}</dd></div><div><dt>Current fee wallet</dt><dd>{author.wallet}</dd></div></dl>
        <details className={engineStyles.details}><summary>{author.author === snapshot.actor ? "Change my author fee wallet" : "Author family details"}{snapshot.authors.length > 1 ? " · family " + (index + 1) : ""}</summary>
          <p className={styles.help}>Family <code>{author.familyId}</code></p>
          {author.author === snapshot.actor ? <WalletChangeForm labels={["New author fee wallet" + (snapshot.authors.length > 1 ? " · family " + (index + 1) : "")]} initial={[author.wallet]} disabled={disabled} authority="Your connected wallet is the registered author of this family." onPrepare={wallets => onPrepare({ kind: "rotate-author", familyId: author.familyId, recipient: wallets[0] })} /> : <p className={styles.help}>The registered author must connect to change this fee wallet.</p>}
        </details>
      </div>)}
    </div> : null}
  </div>;
}

export function ModuleEngineFeeChangeReview({ prepared }: { prepared: PreparedModuleEngineFeeChange }) {
  const changes = prepared.kind === "replace-creators" ? prepared.previousWallets.map((previousWallet, index) => ({ previousWallet, recipient: prepared.recipients[index], label: "Recipient " + (index + 1), share: prepared.sharesBps[index] }))
    : [{ previousWallet: prepared.previousWallet, recipient: prepared.recipient, label: prepared.kind === "rotate-author" ? "Author fee wallet" : prepared.kind === "rotate-platform" ? "Module fee wallet" : "Recipient " + (prepared.index + 1), share: prepared.kind === "rotate-creator" ? prepared.shareBps : null }];
  return <div className={engineStyles.launchSummary}>
    <p className={styles.help}>{prepared.kind === "rotate-author" ? "This changes future author fees for the whole family across all coins using this registry. Existing claims and authorship stay unchanged." : prepared.kind === "rotate-platform" ? `This changes the recipient of future module fees across this module version. The full 0.3% fee still accrues in ${prepared.nativeEthFees ? "ETH" : "each pool pair token"}. Existing claims stay with the wallets that earned them.` : "This changes future creator fees for this coin. Fixed shares, existing claims and author fee wallets stay unchanged."}</p>
    <dl className={styles.reviewRows}><div><dt>Your authority</dt><dd>{prepared.kind === "rotate-author" ? "Registered author" : prepared.kind === "rotate-creator" ? "Current recipient of this slot" : prepared.authority === "treasury" ? prepared.kind === "rotate-platform" ? "Current module fee recipient" : "Ledger treasury" : "Ledger reward administrator"}</dd></div>
      {changes.map(item => <div key={item.label}><dt>{item.label}{item.share !== null ? " · " + formatUnits(BigInt(item.share), 2) + "%" : ""}</dt><dd><div>Current: {item.previousWallet}</div><div>New: {item.recipient}</div></dd></div>)}
      {prepared.kind === "rotate-author" ? <div><dt>Family</dt><dd>{prepared.familyId}</dd></div> : null}
    </dl>
    <p className={styles.help}>Recipients and permissions are checked again before the wallet request. Another permitted change may be mined while you confirm. The receipt shows the actual previous and new recipients.</p>
    <p className={styles.help}>{prepared.kind === "replace-creators" ? "This replacement has an onchain deadline and administrative revision. A recipient changing its own wallet does not advance that revision." : "The preview expires before opening the wallet. This contract call has no onchain deadline or expected previous wallet."}</p>
  </div>;
}

export function ModuleEngineFeeChangeReceipt({ result }: { result: ModuleEngineReceiptResult }) {
  if (!result.feeChange) return null;
  return <section className={styles.formPanel} aria-label="Confirmed fee recipients"><h2>Confirmed fee recipients</h2>
    <p className={styles.help}>The transaction was mined. These are its verified recipient changes. Finality is still pending.</p>
    {result.feeChange.previewChanged ? <p role="status" className={engineStyles.notice}>A permitted wallet change was mined after your preview. The transaction replaced the actual recipients shown below.</p> : null}
    <dl className={styles.reviewRows}>{result.feeChange.changes.map((change, index) => <div key={index}><dt>{change.familyId ? "Author family" : result.kind === "rotate-platform" ? "Module fee recipient" : "Recipient " + ((change.index ?? index) + 1)}{change.familyId ? <div>{change.familyId}</div> : null}</dt><dd><div>Previous: {change.previousWallet}</div><div>New: {change.recipient}</div></dd></div>)}</dl>
    {result.feeChange.subsequentlyChanged ? <p role="status" className={engineStyles.notice}>A later change is already visible in the same block. Refresh fee recipients to see the current wallets.</p> : null}
  </section>;
}
