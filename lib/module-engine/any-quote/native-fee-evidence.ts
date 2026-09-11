import type { Address, Hex } from "viem";

/** Decoded events have already been checked against canonical receipt bytes and exact released emitters. */
type Event = Record<string, unknown>;
const same = (a: unknown, b: string) => typeof a === "string" && a.toLowerCase() === b.toLowerCase();
function need(ok: unknown): asserts ok { if (!ok) throw new Error("Module engine: Native ETH fee settlement differs."); }
function amount(value: unknown) { need(typeof value === "bigint" && value >= 0n); return value; }

export function assertAnyQuoteNativeFeeSettlement(input: {
  poolId: Hex; launchId: Hex; quoteAsset: Address; routeHash: Hex; ledger: Address; hook: Address;
  swap: Event; conversions: readonly Event[]; accruals: readonly Event[]; credits: readonly Event[]; mints: readonly Event[];
}): bigint {
  const { swap } = input;
  need(same(swap.poolId, input.poolId) && same(swap.launchId, input.launchId));
  const quoteAmount = amount(swap.platformQuote) + amount(swap.creatorQuote);
  const conversions = input.conversions.filter(e => same(e.poolId, input.poolId));
  const accruals = input.accruals.filter(e => same(e.launchId, input.launchId));
  const credits = input.credits.filter(e => same(e.launchId, input.launchId));
  const mints = input.mints.filter(e => same(e.from, "0x0000000000000000000000000000000000000000") && same(e.to, input.ledger) && e.id === 0n);
  if (quoteAmount === 0n) { need(!conversions.length && !accruals.length && !credits.length && !mints.length); return 0n; }
  need(conversions.length === 1 && accruals.length === 1 && mints.length === 1);
  const conversion = conversions[0], accrual = accruals[0], mint = mints[0];
  need(same(conversion.launchId, input.launchId) && same(conversion.routeHash, input.routeHash) && amount(conversion.quoteAmount) === quoteAmount);
  const eth = amount(conversion.ethAmount), platform = amount(conversion.platformEth), creator = amount(conversion.creatorEth);
  need(eth > 0n && platform + creator === eth && same(mint.caller, input.hook) && amount(mint.amount) === eth);
  need(same(accrual.quoteAsset, input.quoteAsset) && amount(accrual.platformEth) === platform && amount(accrual.creatorEth) === creator);
  let credited = 0n;
  for (const credit of credits) { need(same(credit.quoteAsset, input.quoteAsset)); credited += amount(credit.amount); }
  // Cumulative recipient rounding can release prior dust; compare credits with the ledger event,
  // not with this trade alone. Global received/credited/backing is checked at the receipt block.
  need(credited === amount(accrual.creditedEth));
  return eth;
}

export function assertAnyQuoteNativeBacking(received: unknown, credited: unknown, claimed: unknown, backing: unknown) {
  const totalReceived = amount(received), totalCredited = amount(credited), totalClaimed = amount(claimed);
  need(totalClaimed <= totalCredited && totalCredited <= totalReceived && amount(backing) >= totalReceived - totalClaimed);
}
