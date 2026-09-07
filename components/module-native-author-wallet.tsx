"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { isAddress, type Address } from "viem";
import { readModuleNativeAuthorWallets, type ModuleManagementBuildInput, type ModuleManagementIntent } from "@/lib/module-mode/management";
import type { ModuleNativeAuthorWalletChange, ModuleNativeAuthorWalletReceipt } from "@/lib/module-mode/native-client";
import styles from "./module-coin-console.module.css";

type AuthorRows = Awaited<ReturnType<typeof readModuleNativeAuthorWallets>>;
type Props = Omit<ModuleManagementBuildInput, "intent" | "deadline" | "actor"> & {
  actor: Address | null; disabled: boolean; onPrepare: (intent: ModuleManagementIntent) => void;
};

export function ModuleNativeAuthorWalletControls({ actor, disabled, onPrepare, ...input }: Props) {
  const [state, setState] = useState<AuthorRows | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const load = async () => {
    if (loading) return;
    setLoading(true); setError("");
    try { setState(await readModuleNativeAuthorWallets(input)); }
    catch { setState(null); setError("Author wallets could not be verified for this version. Refresh to check again. Your existing fee claims remain available."); }
    finally { setLoading(false); }
  };
  return <section className={styles.recipients} aria-labelledby={id}>
    <h2 id={id}>Author reward wallets</h2>
    <p className={styles.small}>Each registered author controls where their family’s future author fees go. A change applies to every coin using that family. Previously credited fees stay with their original wallet, and authorship stays with the registered author.</p>
    <button className={styles.secondaryButton} type="button" disabled={disabled || loading} onClick={() => { void load(); }}>{loading ? "Checking author wallets…" : state ? "Refresh author wallets" : "Load author wallets"}</button>
    <div role="status" aria-live="polite">{loading ? <p className={styles.small}>Reading the current family permissions.</p> : null}</div>
    {error ? <p className={styles.fieldError} role="alert">{error}</p> : null}
    {state?.unavailable ? <p className={styles.notice}>Some author wallets could not be verified for this version. Their change controls are unavailable. Existing claims are still available.</p> : null}
    {state && !state.authors.length && !state.unavailable ? <p className={styles.small}>This coin has no registered module author wallets.</p> : null}
    {state?.authors.map(author => <AuthorForm key={`${author.familyId}:${author.previousWallet}:${actor}`} author={author} actor={actor} disabled={disabled || loading} onPrepare={onPrepare} />)}
    {state ? <p className={styles.small}>Read at block {state.blockNumber.toString()}. Permissions and recipients are checked again before your wallet opens.</p> : null}
  </section>;
}

function AuthorForm({ author, actor, disabled, onPrepare }: { author: AuthorRows["authors"][number]; actor: Address | null; disabled: boolean; onPrepare: Props["onPrepare"] }) {
  const [recipient, setRecipient] = useState(""); const [error, setError] = useState("");
  const errorId = useId(); const input = useRef<HTMLInputElement>(null);
  const authorized = !!actor && actor.toLowerCase() === author.author.toLowerCase();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (disabled || !authorized) return;
    if (!isAddress(recipient) || /^0x0{40}$/i.test(recipient) || recipient.toLowerCase() === author.previousWallet.toLowerCase()) {
      setError("Enter a different, nonzero author reward wallet."); input.current?.focus(); return;
    }
    setError(""); onPrepare({ kind: "rotate-author", packageId: author.packageId, recipient: recipient as Address });
  };
  return <div className={styles.programAction}>
    <h3>{author.title}</h3>
    <dl className={styles.facts}><div><dt>Current author reward wallet</dt><dd>{author.previousWallet}</dd></div><div><dt>Registered author · controls this change</dt><dd>{author.author}</dd></div></dl>
    <details className={styles.details}><summary>Family details</summary><dl className={styles.facts}><div><dt>Family</dt><dd>{author.familyId}</dd></div><div><dt>Published module</dt><dd>{author.packageId}</dd></div></dl></details>
    {authorized ? <form onSubmit={submit}><label className={styles.field}>New author reward wallet<input ref={input} value={recipient} onChange={event => { setRecipient(event.target.value); setError(""); }} spellCheck={false} autoComplete="off" placeholder="0x…" disabled={disabled} aria-invalid={!!error} aria-describedby={error ? errorId : undefined} /></label>
      {error ? <p id={errorId} className={styles.fieldError} role="alert">{error}</p> : null}
      <button className={styles.secondaryButton} type="submit" disabled={disabled}>Review author wallet change</button>
    </form> : <p className={styles.small}>{actor ? "Only the registered author shown above can change this wallet." : "Connect the registered author wallet to make a change."}</p>}
  </div>;
}

export function ModuleNativeAuthorWalletReview({ change }: { change: ModuleNativeAuthorWalletChange }) {
  return <>
    <p>Future author fees from every coin using this family will go to the new wallet. Previously credited fees stay claimable by their original wallet. Authorship does not change.</p>
    <dl className={styles.facts}><div><dt>Current reward wallet</dt><dd>{change.previousWallet}</dd></div><div><dt>New reward wallet</dt><dd>{change.recipient}</dd></div><div><dt>Authority · registered author</dt><dd>{change.author}</dd></div><div><dt>Family · applies to every coin using it</dt><dd>{change.familyId}</dd></div></dl>
    <p className={styles.notice}>Your wallet permissions and the current recipient are checked before signing. The contract does not enforce the preview expiry or the previous wallet while the transaction is pending. Another authorized change can happen before or after it.</p>
  </>;
}

export function ModuleNativeAuthorWalletResult({ result }: { result: ModuleNativeAuthorWalletReceipt }) {
  return <section className={styles.review} aria-label="Author wallet change result"><h2>Author wallet change mined</h2>
    <p>Future author fees for this family were redirected. Previously credited fees stay with their original wallet. Authorship did not change.</p>
    <dl className={styles.facts}><div><dt>Previous wallet in this transaction</dt><dd>{result.previousWallet}</dd></div><div><dt>New reward wallet</dt><dd>{result.recipient}</dd></div><div><dt>Family</dt><dd>{result.familyId}</dd></div></dl>
    {result.previewChanged ? <p>The previous wallet changed after your preview. The addresses above come from this transaction’s verified event.</p> : null}
    {result.subsequentlyChanged ? <p>A later change in the same block has already replaced this recipient. Refresh author wallets to see the current destination.</p> : null}
    <p className={styles.small}>Mining is verified. Finality and indexing are separate checks.</p>
  </section>;
}
