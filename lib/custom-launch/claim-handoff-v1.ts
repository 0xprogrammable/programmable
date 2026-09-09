import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { LaunchClaimDescriptorV1 } from "./launch-plan-v1";
import { isBoundLaunchClaimDescriptorV1 } from "./launch-projection-v1";
import { canonicalBrowserSha256V2 } from "./browser-authority-v2";
import type { LaunchWalletProviderV1 } from "./wallet-handoff-plan-v1";

export type LaunchClaimReadV1 = { launchId: string; name: string | null; descriptor: LaunchClaimDescriptorV1;
  claimableRaw: string | null; blockNumber: string | null; status: "ready" | "analysis_pending" };
export type LaunchClaimWalletReviewV1 = { binding: string; descriptor: LaunchClaimDescriptorV1; claimableRaw: string; maxGasCostWei: string;
  transaction: { chainId: "0x1237"; from: Address; to: Address; data: Hex; value: "0x0"; gas: Hex; nonce: Hex } };
export type LaunchClaimWalletInputV1 = { action: "review" | "send"; claim: LaunchClaimReadV1; reviewed?: LaunchClaimWalletReviewV1;
  loadFreshClaim(): Promise<LaunchClaimReadV1> };
const quantity = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]+$/i.test(value) ? BigInt(value) : (() => { throw new Error("Invalid claim chain read"); })();

/** The stored descriptor fixes target, calldata, value, asset and beneficiary. No project-name dispatch. */
export async function prepareLaunchClaimWalletV1(provider: LaunchWalletProviderV1, account: string, input: LaunchClaimWalletInputV1): Promise<LaunchClaimWalletReviewV1> {
  const fresh = await input.loadFreshClaim();
  const descriptor = fresh.descriptor;
  if (fresh.status !== "ready" || !isBoundLaunchClaimDescriptorV1(descriptor) || descriptor.chainId !== "4663"
    || fresh.launchId !== input.claim.launchId || canonicalBrowserSha256V2("programmable.launch-claim-descriptor.v1", descriptor)
      !== canonicalBrowserSha256V2("programmable.launch-claim-descriptor.v1", input.claim.descriptor)
    || descriptor.requiredController.toLowerCase() !== account.toLowerCase()) throw new Error("The bound claim or controller changed. Refresh the claim.");
  const from = getAddress(account); const to = getAddress(descriptor.accrualContract);
  const [chain, accounts, code, raw, nonce] = await Promise.all([
    provider.request({ method: "eth_chainId" }), provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_getCode", params: [to, "latest"] }),
    provider.request({ method: "eth_call", params: [{ from, to, data: descriptor.read.data }, "latest"] }),
    provider.request({ method: "eth_getTransactionCount", params: [from, "pending"] }),
  ]);
  if (chain !== "0x1237" || !Array.isArray(accounts) || typeof accounts[0] !== "string" || getAddress(accounts[0]) !== from
    || typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code) || keccak256(code as Hex).toLowerCase() !== descriptor.runtimeCodeHash.toLowerCase()
    || typeof raw !== "string" || !/^0x[0-9a-f]{64}$/i.test(raw) || BigInt(raw) <= 0n) throw new Error("The claim is no longer executable for this controller.");
  const tx = { chainId: "0x1237" as const, from, to, data: descriptor.claim.data, value: "0x0" as const, nonce: toHex(quantity(nonce)) };
  await provider.request({ method: "eth_call", params: [tx, "latest"] });
  const [estimate, price] = await Promise.all([provider.request({ method: "eth_estimateGas", params: [tx] }), provider.request({ method: "eth_gasPrice" })]);
  const gas = (quantity(estimate) * 120n + 99n) / 100n;
  const transaction = { ...tx, gas: toHex(gas) };
  return { binding: canonicalBrowserSha256V2("programmable.launch-claim-wallet.v1", { descriptor, transaction }), descriptor,
    claimableRaw: BigInt(raw).toString(), maxGasCostWei: (gas * quantity(price)).toString(), transaction };
}
