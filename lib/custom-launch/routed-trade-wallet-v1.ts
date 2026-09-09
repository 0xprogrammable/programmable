import { getAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { LaunchProjectionV1 } from "./launch-plan-v1";
import { canonicalBrowserSha256V2 } from "./browser-authority-v2";
import { projectionObject } from "./launch-projection-v1";
import { LaunchPlanTradeErrorV1, ROUTED_TRADE_CONTRACTS_V1, validateLaunchPlanTradePreparationV1,
  type LaunchPlanTradePreparationV1, type LaunchPlanTradeRequestV1 } from "./routed-trade-plan-v1";
import type { LaunchWalletProviderV1 } from "./wallet-handoff-plan-v1";

export type LaunchPlanTradeWalletInputV1 = { action: "review" | "send"; projection: LaunchProjectionV1; request: LaunchPlanTradeRequestV1;
  reviewed?: LaunchPlanTradeWalletReviewV1 };
export type LaunchPlanTradeWalletReviewV1 = { binding: `sha256:${string}`; preparation: LaunchPlanTradePreparationV1;
  controllerKind: "eoa" | "connected_contract_wallet"; maxGasCostWei: string;
  transaction: { chainId: "0x1237"; from: Address; to: Address; data: Hex; value: Hex; gas: Hex; nonce?: Hex } };
const quantity = (value: unknown) => typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value) ? BigInt(value) : (() => { throw new Error("The wallet chain read is invalid."); })();

export async function fetchLaunchPlanTradePreparationV1(request: LaunchPlanTradeRequestV1, fetcher: typeof fetch = fetch) {
  const response = await fetcher("/api/custom-launch/vnext/trade/prepare", { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
  const body: unknown = await response.json();
  if (!response.ok) throw new LaunchPlanTradeErrorV1(projectionObject(body) && typeof body.code === "string" ? body.code : "TRADE_ANALYSIS_PENDING",
    projectionObject(body) && typeof body.error === "string" && body.error.length < 512 ? body.error : "The current trade could not be prepared.", response.status === 400 ? 400 : response.status === 409 ? 409 : 503);
  return body;
}

/** Fresh first-party preparation and independently reconstructed commands precede
 * the provider request. Contract wallets must expose their actual account; this
 * logical simulation never substitutes an owner for a Safe or proves approvals. */
export async function prepareLaunchPlanTradeWalletV1(provider: LaunchWalletProviderV1, account: string, input: LaunchPlanTradeWalletInputV1,
  fetcher: typeof fetch = fetch): Promise<LaunchPlanTradeWalletReviewV1> {
  const from = getAddress(account);
  if (input.request.owner.toLowerCase() !== from.toLowerCase()) throw new Error("Connect the exact wallet used for this trade.");
  const preparation = validateLaunchPlanTradePreparationV1(await fetchLaunchPlanTradePreparationV1(input.request, fetcher), input.projection, input.request);
  const [chain, accounts, controllerCode] = await Promise.all([provider.request({ method: "eth_chainId" }), provider.request({ method: "eth_accounts" }),
    provider.request({ method: "eth_getCode", params: [from, "latest"] })]);
  if (quantity(chain) !== 4663n || !Array.isArray(accounts) || typeof accounts[0] !== "string" || getAddress(accounts[0]) !== from
    || typeof controllerCode !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(controllerCode)) throw new Error("The connected wallet or chain changed. Review again.");
  const controllerKind = controllerCode === "0x" ? "eoa" as const : "connected_contract_wallet" as const;
  const bindings = preparation.evidence.runtimeBindings;
  if (!Array.isArray(bindings) || bindings.length === 0 || bindings.length > 512) throw new Error("The trade runtime evidence is invalid.");
  for (const name of ["poolManager", "universalRouter", "v4Quoter", "stateView", "permit2"] as const) {
    const pinned = ROUTED_TRADE_CONTRACTS_V1[name];
    if (bindings.find(item => item.address.toLowerCase() === pinned.address.toLowerCase())?.runtimeCodeHash.toLowerCase() !== pinned.runtimeCodeHash.toLowerCase()) throw new Error("The trade infrastructure differs from the reviewed release.");
  }
  await Promise.all(bindings.map(async binding => {
    const code = await provider.request({ method: "eth_getCode", params: [binding.address, "latest"] });
    if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(code) || keccak256(code as Hex) !== binding.runtimeCodeHash.toLowerCase()) throw new Error("A trade contract changed. Refresh before signing.");
  }));
  const tx = preparation.transaction;
  const nonce = controllerKind === "eoa" ? toHex(quantity(await provider.request({ method: "eth_getTransactionCount", params: [from, "pending"] }))) : undefined;
  const transaction = { chainId: "0x1237" as const, from, to: tx.to, data: tx.data, value: toHex(BigInt(tx.value)), gas: toHex(BigInt(tx.gasLimit)), ...(nonce ? { nonce } : {}) };
  await provider.request({ method: "eth_call", params: [transaction, "latest"] });
  const [estimate, price, balance] = await Promise.all([provider.request({ method: "eth_estimateGas", params: [transaction] }),
    provider.request({ method: "eth_gasPrice" }), provider.request({ method: "eth_getBalance", params: [from, "latest"] })]);
  if (quantity(estimate) > BigInt(tx.gasLimit)) throw new Error("The trade gas requirement changed. Review again.");
  const cost = BigInt(tx.gasLimit) * quantity(price);
  if (controllerKind === "eoa" && quantity(balance) < cost + BigInt(tx.value)) throw new Error("The connected wallet needs enough native funds for this trade and gas.");
  const binding = canonicalBrowserSha256V2("programmable.launch-plan-trade-wallet.v1", { transaction, fee: preparation.fee,
    projectionDigest: preparation.projectionDigest, runtimeBindings: bindings, controllerKind });
  return { binding, preparation, controllerKind, maxGasCostWei: cost.toString(), transaction };
}
