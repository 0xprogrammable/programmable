"use client";

import Link from "next/link";
import { ArrowDownUp, ArrowUpRight, Check, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatUnits, isAddress, type Hex } from "viem";
import { useWallet, type WalletTradeBalances } from "@/components/wallet-provider";
import type { SwapChainId, SwapReceipt, SwapReview, SwapSide, SwapTokenDescriptor } from "@/lib/swap/types";
import type { PendingSwap } from "@/lib/swap/client";
import { walletChainIdsEqual } from "@/lib/wallet-chain-id";
import { displaySwapAmount, maximumSwapInput, parseSwapAmount } from "./swap-amount";
import styles from "./swap-panel.module.css";

type PendingView = { key: string; operation: PendingSwap | null; error?: string };
function message(error: unknown) {
  if (!(error instanceof Error)) return "The swap could not be checked. Try again.";
  const text = error.message.replace(/^Module (?:engine|mode):\s*/i, "");
  if (/user rejected|user denied|request cancelled/i.test(text)) return "Wallet request cancelled.";
  if (text.length <= 280 && !/https?:\/\/|request body:|raw call arguments:/i.test(text)) return text;
  if (/insufficient funds|exceeds.*balance/i.test(text)) return "There is not enough balance for this swap and its network fee.";
  if (/revert/i.test(text)) return "This trade currently reverts. Try a smaller amount or refresh the quote.";
  return "The trading route could not be checked right now. Refresh to try again.";
}
const explorer = (chainId: SwapChainId) => chainId === 4663 ? "https://robinhoodchain.blockscout.com" : "https://etherscan.io";
const networkName = (chainId: SwapChainId) => chainId === 4663 ? "Robinhood" : "Ethereum";

export function SwapPanel({ initialAddress = "", initialChainId = 4663 }: {
  initialAddress?: string; initialChainId?: SwapChainId;
}) {
  const wallet = useWallet();
  const walletRef = useRef(wallet);
  useEffect(() => { walletRef.current = wallet; }, [wallet]);
  const [address, setAddress] = useState(initialAddress);
  const [chainId, setChainId] = useState<SwapChainId>(initialChainId);
  const [side, setSide] = useState<SwapSide>("sell");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(100);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [asset, setAsset] = useState<{ key: string; descriptor?: SwapTokenDescriptor; error?: string } | null>(null);
  const [balances, setBalances] = useState<{ key: string; value?: WalletTradeBalances; error?: string } | null>(null);
  const [quotation, setQuotation] = useState<{ key: string; review?: SwapReview; error?: string } | null>(null);
  const [pendingView, setPendingView] = useState<PendingView | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [revision, setRevision] = useState(0);
  const [lookupRevision, setLookupRevision] = useState(0);
  const [busy, setBusy] = useState<"signing" | "confirming" | null>(null);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<{ receipt: SwapReceipt; kind: "swap" | "approval" } | null>(null);
  const [submitted, setSubmitted] = useState<{ hash: Hex; chainId: SwapChainId } | null>(null);
  const mutex = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);

  const normalizedAddress = address.trim().toLowerCase();
  const validAddress = isAddress(normalizedAddress) && !/^0x0{40}$/.test(normalizedAddress);
  const assetKey = `${chainId}:${normalizedAddress}`;
  const currentAsset = asset?.key === assetKey ? asset : null;
  const descriptor = currentAsset?.descriptor;
  const owner = wallet.wallet?.account;
  const ownerKey = owner ? `${chainId}:${owner.toLowerCase()}` : "";
  const pending = pendingView?.key === ownerKey ? pendingView.operation : null;
  const pendingError = pendingView?.key === ownerKey ? pendingView.error : undefined;
  const pendingLoaded = !owner || pendingView?.key === ownerKey;
  const correctNetwork = wallet.wallet !== null && walletChainIdsEqual(wallet.wallet.chainId, chainId);
  const connected = Boolean(owner && wallet.authenticated && wallet.sessionReady);
  const balanceKey = `${ownerKey}:${normalizedAddress}:${revision}`;
  const balance = correctNetwork && balances?.key === balanceKey ? balances.value : undefined;
  const balanceError = correctNetwork && balances?.key === balanceKey ? balances.error : undefined;
  const inputDecimals = side === "buy" ? 18 : descriptor?.token.decimals ?? 18;
  const outputDecimals = side === "buy" ? descriptor?.token.decimals ?? 18 : 18;
  const parsed = parseSwapAmount(amount, inputDecimals);
  const inputBalance = balance ? side === "buy" ? balance.nativeBalanceWei : balance.tokenBalanceRaw : null;
  const insufficient = parsed !== null && inputBalance !== null && parsed > inputBalance;
  const quoteKey = `${assetKey}:${ownerKey}:${side}:${amount}:${slippageBps}:${revision}`;
  const review = quotation?.key === quoteKey ? quotation.review : undefined;
  const quoteError = quotation?.key === quoteKey ? quotation.error : undefined;
  const canQuote = descriptor?.status === "ready" && connected && correctNetwork && parsed !== null && !insufficient && !pending && !pendingError && pendingLoaded;
  const quoting = canQuote && !review && !quoteError && !busy;
  const ticker = descriptor?.token.symbol || "Coin";
  const inputSymbol = side === "buy" ? "ETH" : ticker;
  const outputSymbol = side === "sell" ? "ETH" : ticker;
  const locked = Boolean(busy || pending);
  const walletBusy = wallet.connecting || wallet.openingWallet || wallet.switchingNetwork || wallet.disconnecting;
  const displayError = error || currentAsset?.error || (descriptor?.status === "unavailable" ? descriptor.reason : "") || quoteError || pendingError;

  useEffect(() => {
    if (!validAddress) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void import("@/lib/swap/client").then(({ fetchSwapToken }) => fetchSwapToken({ address: normalizedAddress, chainId, signal: controller.signal }))
        .then(value => { if (!controller.signal.aborted) setAsset({ key: assetKey, descriptor: value }); })
        .catch(caught => { if (!controller.signal.aborted) setAsset({ key: assetKey, error: message(caught) }); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [assetKey, chainId, normalizedAddress, validAddress, lookupRevision]);

  useEffect(() => {
    if (!owner) return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void import("@/lib/swap/client").then(({ getPendingSwap, subscribePendingSwap }) => {
      const refresh = () => {
        if (!active) return;
        try { setPendingView({ key: ownerKey, operation: getPendingSwap(owner, chainId) }); }
        catch { setPendingView({ key: ownerKey, operation: null, error: "Saved wallet activity could not be read. Allow browser storage and reload before swapping." }); }
      };
      refresh();
      if (active) unsubscribe = subscribePendingSwap(refresh);
    }).catch(caught => { if (active) setPendingView({ key: ownerKey, operation: null, error: message(caught) }); });
    return () => { active = false; unsubscribe?.(); };
  }, [owner, ownerKey, chainId]);

  useEffect(() => {
    if (!connected || !correctNetwork) return;
    let active = true;
    const current = walletRef.current;
    const task = validAddress
      ? current.readTradeBalances(normalizedAddress as Hex, chainId)
      : current.readNativeBalance(chainId).then(value => ({ ...value, tokenBalanceRaw: 0n }));
    void task.then(value => { if (active) setBalances({ key: balanceKey, value }); })
      .catch(caught => { if (active) setBalances({ key: balanceKey, error: message(caught) }); });
    return () => { active = false; };
  }, [balanceKey, connected, correctNetwork, chainId, normalizedAddress, validAddress]);

  useEffect(() => {
    if (!canQuote || !descriptor || !owner || parsed === null || busy) return;
    let active = true;
    const timer = setTimeout(() => {
      void import("@/lib/swap/client").then(({ prepareSwap }) => prepareSwap({ descriptor, owner, side, amountIn: parsed, slippageBps }, walletRef.current))
        .then(value => { if (active) setQuotation({ key: quoteKey, review: value }); })
        .catch(caught => { if (active) setQuotation({ key: quoteKey, error: message(caught) }); });
    }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [canQuote, descriptor, owner, parsed, side, slippageBps, quoteKey, busy]);

  useEffect(() => {
    if (!review || busy || pending) return;
    const duration = Math.max(0, Number(review.expiresAt) * 1_000 - Date.now() - 5_000);
    const timer = setTimeout(() => setRevision(value => value + 1), duration);
    return () => clearTimeout(timer);
  }, [review, busy, pending]);

  function edit(change: () => void) {
    if (mutex.current || locked) return;
    change(); setError(""); setOutcome(null); setSubmitted(null);
  }
  async function paste() {
    try { const value = await navigator.clipboard.readText(); edit(() => setAddress(value.trim())); addressRef.current?.focus(); }
    catch { setError("Paste the coin address into the field above."); addressRef.current?.focus(); }
  }
  function useMax() {
    if (!balance || !descriptor) return;
    const value = maximumSwapInput({ side, chainId, ...balance, gasEstimate: review?.gasEstimate });
    edit(() => setAmount(value > 0n ? formatUnits(value, inputDecimals) : ""));
    if (value === 0n && side === "buy") setError("Keep a little ETH for the network fee.");
    inputRef.current?.focus();
  }
  function acceptReceipt(receipt: SwapReceipt, kind: "swap" | "approval") {
    setOutcome({ receipt, kind }); setError(""); setSubmitted(null);
    if (receipt.status === "success" && kind === "swap") setAmount("");
    setRevision(value => value + 1);
  }
  async function recover() {
    if (!pending || mutex.current) return;
    mutex.current = true; setBusy("confirming"); setError("");
    try {
      const { recoverSwap } = await import("@/lib/swap/client");
      let hash = pending.hash;
      if (!hash) {
        if (!/^0x[0-9a-f]{64}$/i.test(recoveryHash.trim())) throw new Error("Enter the transaction hash from your wallet activity.");
        hash = recoveryHash.trim() as Hex;
      }
      acceptReceipt(await recoverSwap(pending, hash), pending.kind);
    } catch (caught) { setError(message(caught)); }
    finally { mutex.current = false; setBusy(null); }
  }
  async function act() {
    if (mutex.current) return;
    if (!connected) { wallet.openWallet(); return; }
    if (!correctNetwork) {
      setError("");
      try { if (!await wallet.switchNetwork(String(chainId))) setError(`Switch your wallet to ${networkName(chainId)} to continue.`); }
      catch (caught) { setError(message(caught)); }
      return;
    }
    if (!review || pending || pendingError || !pendingLoaded || insufficient) return;
    mutex.current = true; setBusy("signing"); setError(""); setOutcome(null);
    try {
      const { submitSwap } = await import("@/lib/swap/client");
      const result = await submitSwap(review, walletRef.current);
      setSubmitted({ hash: result.hash, chainId }); setBusy("confirming");
      acceptReceipt(await result.wait(), review.kind);
    } catch (caught) { setError(message(caught)); }
    finally { mutex.current = false; setBusy(null); }
  }

  let action = "Swap";
  if (!connected) action = walletBusy ? "Connecting…" : "Connect wallet";
  else if (!correctNetwork) action = wallet.switchingNetwork ? "Switching network…" : `Switch to ${networkName(chainId)}`;
  else if (busy === "signing") action = "Confirm in your wallet";
  else if (busy === "confirming") action = "Confirming…";
  else if (pending) action = "Check pending transaction";
  else if (!validAddress) action = "Enter a coin address";
  else if (!currentAsset) action = "Finding your coin…";
  else if (!descriptor || descriptor.status !== "ready") action = "Route unavailable";
  else if (!amount) action = "Enter an amount";
  else if (parsed === null) action = "Check the amount";
  else if (insufficient) action = `Not enough ${inputSymbol}`;
  else if (quoting) action = "Getting quote…";
  else if (review?.kind === "approval") action = `Approve ${inputSymbol}`;
  else if (quoteError) action = "Quote unavailable";
  const disabled = Boolean(busy || walletBusy || pending || pendingError || !pendingLoaded
    || (connected && correctNetwork && (!review || insufficient || descriptor?.status !== "ready")));

  return <div className={styles.page}>
    <section className={styles.card} aria-labelledby="swap-heading">
      <header className={styles.heading}>
        <h1 id="swap-heading">Swap</h1>
        <label className={styles.network}><span className="sr-only">Network</span>
          <select value={chainId} disabled={locked} onChange={event => edit(() => { setChainId(Number(event.target.value) as SwapChainId); setAmount(""); })}>
            <option value={4663}>Robinhood</option><option value={1}>Ethereum</option>
          </select>
        </label>
      </header>
      <form onSubmit={event => { event.preventDefault(); void act(); }}>
        <label htmlFor="swap-token" className={styles.addressLabel}>Coin address</label>
        <div className={styles.addressField}>
          <input ref={addressRef} id="swap-token" value={address} onChange={event => edit(() => { setAddress(event.target.value); setAmount(""); })}
            placeholder="Paste a contract address" disabled={locked} spellCheck={false} autoComplete="off" autoCapitalize="none" maxLength={100}
            aria-invalid={Boolean(address.trim() && !validAddress)} aria-describedby="swap-coin-status" />
          <button className={styles.paste} type="button" onClick={() => void paste()} disabled={locked}>Paste</button>
        </div>
        <div id="swap-coin-status" className={styles.identity} role="status">
          {descriptor ? <><Check size={14} aria-hidden="true" /><strong title={descriptor.token.name}>{descriptor.token.name}</strong><span>{ticker}</span>
            <Link href={`/token/${descriptor.token.address}?chain=${chainId}`} aria-label={`View ${ticker}`}><ArrowUpRight size={16} aria-hidden="true" /></Link></>
            : address.trim() && !validAddress ? "Enter a complete token contract address."
              : validAddress && !currentAsset ? <><LoaderCircle size={14} aria-hidden="true" className={styles.spin} />Finding your coin…</> : null}
        </div>
        <div className={styles.fields}>
          <div className={styles.amountBox}>
            <div className={styles.fieldTop}><label htmlFor="swap-amount">You pay</label>
              <div className={styles.balance}>
                {inputBalance !== null ? <span title={formatUnits(inputBalance, inputDecimals)}>Balance: {displaySwapAmount(inputBalance, inputDecimals, 4)}</span> : null}
                <button type="button" className={styles.max} onClick={useMax} disabled={!balance || !descriptor || locked}>Max</button>
              </div>
            </div>
            <div className={styles.amountRow}>
              <input ref={inputRef} className={styles.amountInput} id="swap-amount" aria-label={`Amount of ${inputSymbol} to swap`} inputMode="decimal"
                value={amount} onChange={event => edit(() => setAmount(event.target.value.replace(/,/g, ".")))} autoComplete="off" placeholder="0" disabled={locked}
                maxLength={160} aria-invalid={Boolean(amount && (parsed === null || insufficient))} aria-describedby={displayError ? "swap-error" : undefined} />
              <AssetBadge symbol={inputSymbol} native={side === "buy"} />
            </div>
          </div>
          <button type="button" className={styles.reverse} aria-label={side === "sell" ? "Buy this coin with ETH" : "Sell this coin for ETH"}
            onClick={() => edit(() => { setSide(side === "sell" ? "buy" : "sell"); setAmount(""); })} disabled={locked}>
            <ArrowDownUp size={18} aria-hidden="true" />
          </button>
          <div className={styles.amountBox}>
            <div className={styles.fieldTop}><span id="swap-receive-label">You receive</span><span>Estimated</span></div>
            <div className={styles.amountRow}>
              <output className={styles.output} aria-labelledby="swap-receive-label" data-empty={review?.amountOut == null}
                title={review?.amountOut != null ? formatUnits(review.amountOut, outputDecimals) : undefined}>
                {quoting ? <LoaderCircle size={25} className={styles.spin} aria-label="Getting quote" />
                  : review?.amountOut != null ? displaySwapAmount(review.amountOut, outputDecimals) : "—"}
              </output>
              <AssetBadge symbol={outputSymbol} native={side === "sell"} />
            </div>
          </div>
        </div>
        {review?.minimumOutput != null ? <dl className={styles.summary}>
          <div><dt>Minimum received</dt><dd>{displaySwapAmount(review.minimumOutput, outputDecimals)} {outputSymbol}</dd></div>
          {balance && review.gasEstimate > 0n ? <div><dt>Estimated network fee</dt><dd>{displaySwapAmount(review.gasEstimate * balance.gasPriceWei, 18)} ETH</dd></div> : null}
        </dl> : null}
        <div className={styles.settingsRow}>
          <button type="button" className={styles.settingsToggle} onClick={() => setSettingsOpen(!settingsOpen)} aria-expanded={settingsOpen} aria-controls="swap-slippage" disabled={locked}>
            <Settings2 size={15} aria-hidden="true" />{slippageBps / 100}% slippage
          </button>
          <button type="button" className={styles.refresh} aria-label="Refresh quote and balance" disabled={locked || !validAddress || quoting}
            onClick={() => { setError(""); setRevision(value => value + 1); if (currentAsset?.error || descriptor?.status === "unavailable") setLookupRevision(value => value + 1); }}><RefreshCw size={16} aria-hidden="true" /></button>
        </div>
        {settingsOpen ? <fieldset className={styles.slippage} id="swap-slippage" disabled={locked}>
          <legend>Maximum price change</legend>
          {[50, 100, 300].map(value => <button key={value} type="button" aria-pressed={slippageBps === value}
            onClick={() => edit(() => setSlippageBps(value))}>{value / 100}%</button>)}
        </fieldset> : null}
        <button className={styles.primary} type="submit" disabled={disabled}>
          {busy || quoting || walletBusy ? <LoaderCircle size={18} className={styles.spin} aria-hidden="true" /> : null}{action}
        </button>
      </form>
      {review?.kind === "approval" && !pending ? <p className={styles.note}>
        {review.approvalLabel || `Allow the router to use this amount of ${inputSymbol}.`} Your swap quote refreshes after approval.
      </p> : null}
      {side === "buy" && amount && balance && parsed !== null && parsed === maximumSwapInput({ side, chainId, ...balance, gasEstimate: review?.gasEstimate })
        ? <p className={styles.note}>A little ETH stays in your wallet for the network fee.</p> : null}
      {displayError ? <p id="swap-error" className={styles.error} role="alert">{displayError}</p> : null}
      {balanceError && !displayError ? <p className={styles.note} role="status">Balance unavailable. Refresh to try again.</p> : null}
      {descriptor?.status === "unavailable" && descriptor.manageHref ? <p className={styles.note}><Link href={descriptor.manageHref}>Open coin controls <ArrowUpRight size={13} aria-hidden="true" /></Link></p> : null}
      {pending ? <div className={styles.note} role="status">
        <p>{pending.hash ? "Your transaction is awaiting confirmation." : "Check your wallet activity before trying again."}</p>
        {!pending.hash ? <><label htmlFor="swap-recovery-hash">Transaction hash</label><div className={styles.addressField}>
          <input id="swap-recovery-hash" value={recoveryHash} onChange={event => setRecoveryHash(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
        </div></> : null}
        <div className={styles.pendingActions}>
          <button type="button" disabled={Boolean(busy)} onClick={() => void recover()}>Check confirmation</button>
          {pending.hash ? <a href={`${explorer(pending.chainId)}/tx/${pending.hash}`} target="_blank" rel="noreferrer">View transaction<span className="sr-only"> (opens in a new tab)</span></a> : null}
        </div>
      </div> : submitted ? <p className={styles.note} role="status">Transaction submitted. <a href={`${explorer(submitted.chainId)}/tx/${submitted.hash}`} target="_blank" rel="noreferrer">View transaction<span className="sr-only"> (opens in a new tab)</span></a></p> : null}
      {outcome ? <p className={outcome.receipt.status === "success" ? styles.success : styles.error} role="status">
        {outcome.receipt.status === "reverted" ? "The transaction reverted. Gas may still have been charged."
          : outcome.kind === "approval" ? "Approval confirmed. Your swap quote is refreshing." : "Swap complete."}{" "}
        <a href={`${explorer(outcome.receipt.chainId)}/tx/${outcome.receipt.hash}`} target="_blank" rel="noreferrer">View transaction<span className="sr-only"> (opens in a new tab)</span></a>
      </p> : null}
    </section>
  </div>;
}

function AssetBadge({ symbol, native }: { symbol: string; native: boolean }) {
  return <span className={styles.asset} title={symbol}><span className={`${styles.assetIcon} ${native ? styles.eth : ""}`} aria-hidden="true">
    {native ? <svg width="14" height="20" viewBox="0 0 16 24" fill="currentColor"><path d="M8 0 0 12l8 5 8-5L8 0ZM0 14l8 10 8-10-8 5-8-5Z" /></svg> : symbol.slice(0, 1)}
  </span><span>{symbol}</span></span>;
}
