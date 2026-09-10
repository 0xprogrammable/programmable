import type { Address, TransactionReceipt } from "viem";
import { bindModuleEngineReleaseIdentity, type ModuleEngineAnyQuoteReleaseIdentity, type ModuleEngineTemplate } from "../catalog";
import { isModuleEngineAnyQuoteRelease } from "../profile";
import { assertModuleEngineSourceIdentityV1, assertModuleEngineSourceReceiptV1, prepareModuleEngineSourceApprovalV1,
  prepareModuleEngineSourceAnyQuoteSwapV1, prepareModuleEngineSourceClaimV1, prepareModuleEngineSourceLaunchV1,
  readModuleEngineSourceLaunchV1, readModuleEngineSourceTemplateV1,
  type ModuleEngineApprovalRequired, type ModuleEngineClient, type ModuleEngineReceiptResult, type ModuleEngineSourcePreparationV1,
  type PreparedModuleEngineApproval, type PreparedModuleEngineClaim, type PreparedModuleEngineLaunch, type PreparedModuleEngineSwap,
  type PrepareModuleEngineLaunchInput } from "../client";
import { anyQuoteEvidenceHashV1, buildAnyQuoteSwapV1 } from "./route";
import { ANY_QUOTE_NATIVE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID } from "./types";
import type { AnyQuoteLaunchPreparation, AnyQuoteTradeQuote } from "./integration";

export type AnyQuoteLifecycleJsonV1<T> = T extends bigint ? string : T extends readonly (infer V)[] ? AnyQuoteLifecycleJsonV1<V>[] : T extends object ? { [K in keyof T]: AnyQuoteLifecycleJsonV1<T[K]> } : T;
type Unsigned = PreparedModuleEngineLaunch | PreparedModuleEngineSwap | PreparedModuleEngineApproval | PreparedModuleEngineClaim;
type Source = ModuleEngineSourcePreparationV1<Unsigned>;
type LaunchInput = Omit<PrepareModuleEngineLaunchInput, "client" | "availability" | "configuration" | "initialOperation" | "anyQuotePreparation"> & { anyQuotePreparation: AnyQuoteLaunchPreparation };
type Common = { client: ModuleEngineClient; identity: ModuleEngineAnyQuoteReleaseIdentity };
type SwapInput = Common & { template: ModuleEngineTemplate; account: Address; quote: AnyQuoteTradeQuote };
export type AnyQuoteLifecycleRecipeV1 =
  | { kind: "launch"; template: ModuleEngineTemplate; input: LaunchInput }
  | { kind: "swap" | "approve"; template: ModuleEngineTemplate; account: Address; quote: AnyQuoteTradeQuote }
  | { kind: "claim"; template: ModuleEngineTemplate; account: Address; token: Address; recipient: Address };
export interface AnyQuoteLifecyclePreparationV1 {
  schemaVersion: "programmable.any-quote.lifecycle-preparation.v1";
  identity: ModuleEngineAnyQuoteReleaseIdentity;
  recipe: AnyQuoteLifecycleRecipeV1;
  prepared: AnyQuoteLifecycleJsonV1<Unsigned>;
  funding?: AnyQuoteLifecycleJsonV1<ModuleEngineApprovalRequired>;
  evidenceHash: `0x${string}`;
}
export type AnyQuoteLifecycleApprovalRequiredV1 = AnyQuoteLifecycleJsonV1<ModuleEngineApprovalRequired>;
export type AnyQuoteLifecycleReceiptV1 = AnyQuoteLifecycleJsonV1<ModuleEngineReceiptResult>;
function need(value: unknown, label: string): asserts value { if (!value) throw new Error(`Any Quote lifecycle: ${label}.`); }
function json<T>(value: T): AnyQuoteLifecycleJsonV1<T> { return JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item)); }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function identity(value: unknown): ModuleEngineAnyQuoteReleaseIdentity {
  const result = bindModuleEngineReleaseIdentity(value); need(isModuleEngineAnyQuoteRelease(result), "a canonical shared-quote source identity is required"); return result;
}
function same(a: unknown, b: unknown, label: string) { need(anyQuoteEvidenceHashV1(a) === anyQuoteEvidenceHashV1(b), label); }

/** The operator separately authenticates review, deployment, source verification and admission. No active catalog is constructed here. */
export async function assertAnyQuoteLifecycleIdentityV1(input: Common & { blockNumber?: bigint }) {
  return assertModuleEngineSourceIdentityV1({ ...input, identity: identity(input.identity) });
}
async function materialize(client: ModuleEngineClient, release: ModuleEngineAnyQuoteReleaseIdentity, recipe: AnyQuoteLifecycleRecipeV1, blockNumber?: bigint): Promise<{ source: Source; funding?: ModuleEngineApprovalRequired } | ModuleEngineApprovalRequired> {
  const pinnedBlock = blockNumber ?? (await assertAnyQuoteLifecycleIdentityV1({ client, identity: release })).blockNumber;
  const common = { client, identity: release, blockNumber: pinnedBlock };
  if (recipe.kind === "launch") {
    const preview = recipe.input.anyQuotePreparation;
    const initialOperation = preview.initialBuy ? () => {
      const route = buildAnyQuoteSwapV1({ pool: preview.pool, owner: recipe.input.account, recipient: recipe.input.account, side: "buy",
        amountIn: BigInt(preview.intent.initialBuyWei), minimumAmountOut: BigInt(preview.initialBuy!.minimumOutput), deadline: BigInt(preview.validUntil),
        externalRoute: preview.initialBuy!.externalRoute, now: BigInt(preview.readiness.checkpoint.timestamp) });
      return { operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, recipient: recipe.input.account, inputAsset: ANY_QUOTE_NATIVE,
        inputAmount: BigInt(preview.intent.initialBuyWei), outputAsset: preview.predictedToken, minimumOutput: BigInt(preview.initialBuy!.minimumOutput), data: route.nativeBuyOperationData! };
    } : undefined;
    const source = await prepareModuleEngineSourceLaunchV1({ ...recipe.input, ...common, template: recipe.template, configuration: {}, initialOperation });
    return "kind" in source ? source : { source };
  }
  if (recipe.kind === "swap" || recipe.kind === "approve") {
    const source = await prepareModuleEngineSourceAnyQuoteSwapV1({ ...common, template: recipe.template, account: recipe.account, quote: recipe.quote });
    if (recipe.kind === "swap") return "kind" in source ? source : { source };
    need(!recipe.quote.buy && "kind" in source && source.kind === "approval-required", "approval must be the required predecessor of this exact sell");
    const approved = await prepareModuleEngineSourceApprovalV1({ ...common, ...source, account: recipe.account });
    return { source: approved, funding: source };
  }
  need(recipe.kind === "claim", "unsupported lifecycle recipe");
  const [template, launch] = await Promise.all([
    readModuleEngineSourceTemplateV1({ ...common, template: recipe.template, newLaunch: false }),
    readModuleEngineSourceLaunchV1({ ...common, token: recipe.token }),
  ]);
  need(template.manifest.manifest.revision.packageId === launch.revisionId, "claim revision differs from the reviewed template");
  return { source: await prepareModuleEngineSourceClaimV1({ ...common, account: recipe.account, token: recipe.token, recipient: recipe.recipient }) };
}
async function prepare(input: Common, recipeValue: AnyQuoteLifecycleRecipeV1): Promise<AnyQuoteLifecyclePreparationV1 | AnyQuoteLifecycleApprovalRequiredV1> {
  const release = identity(json(input.identity)), recipe = freeze(json(recipeValue)), result = await materialize(input.client, release, recipe);
  if ("kind" in result) return json(result);
  const unsigned = json(result.source.prepared);
  const value = { schemaVersion: "programmable.any-quote.lifecycle-preparation.v1" as const, identity: release, recipe, prepared: unsigned, ...(result.funding ? { funding: json(result.funding) } : {}), evidenceHash: "0x" as const };
  return freeze({ ...value, evidenceHash: anyQuoteEvidenceHashV1({ ...value, evidenceHash: undefined }) });
}
export async function prepareAnyQuoteLifecycleLaunchV1(input: Common & { template: ModuleEngineTemplate; input: LaunchInput }) {
  const keys: (keyof LaunchInput)[] = ["templateId", "account", "quoteAsset", "name", "symbol", "description", "imageUri", "socialLinks", "creatorSalt", "engineSalt", "launchData", "creatorWallets", "creatorSharesBps", "buyCreatorFeeBps", "sellCreatorFeeBps", "deadlineSeconds", "anyQuotePreparation"];
  const launch = Object.fromEntries(keys.filter(key => input.input[key] !== undefined).map(key => [key, input.input[key]])) as LaunchInput;
  return prepare(input, { kind: "launch", template: input.template, input: launch });
}
export async function prepareAnyQuoteLifecycleSwapV1(input: SwapInput) {
  return prepare(input, { kind: "swap", template: input.template, account: input.account, quote: input.quote });
}
export async function prepareAnyQuoteLifecycleApprovalV1(input: SwapInput) {
  need(!input.quote.buy, "approvals are only a predecessor of a sell");
  return prepare(input, { kind: "approve", template: input.template, account: input.account, quote: input.quote });
}
export async function prepareAnyQuoteLifecycleClaimV1(input: Common & { template: ModuleEngineTemplate; account: Address; token: Address; recipient: Address }) {
  return prepare(input, { kind: "claim", template: input.template, account: input.account, token: input.token, recipient: input.recipient });
}
async function reconstruct(input: Common & { preparation: AnyQuoteLifecyclePreparationV1 }): Promise<{ source: Source; preparation: AnyQuoteLifecyclePreparationV1 }> {
  const preparation = freeze(json(input.preparation)), release = identity(input.identity);
  need(preparation.schemaVersion === "programmable.any-quote.lifecycle-preparation.v1", "preparation schema differs");
  same(preparation.identity, release, "preparation source identity differs");
  need(preparation.evidenceHash === anyQuoteEvidenceHashV1({ ...preparation, evidenceHash: undefined }), "preparation evidence differs");
  need(/^[1-9][0-9]*$/.test(preparation.prepared.blockNumber), "preparation block is invalid");
  const rebuilt = await materialize(input.client, release, preparation.recipe, BigInt(preparation.prepared.blockNumber));
  need(!("kind" in rebuilt), "original funding preparation differs");
  same(json(rebuilt.source.prepared), preparation.prepared, "original canonical preparation differs");
  same(rebuilt.funding ? json(rebuilt.funding) : null, preparation.funding ?? null, "original funding snapshot differs");
  return { source: rebuilt.source, preparation };
}
/** Reconstructs at the original canonical block and refreshes those same bytes; it never obtains another quote. */
export async function revalidateAnyQuoteLifecyclePreparationV1(input: Common & { preparation: AnyQuoteLifecyclePreparationV1 }) {
  const { source, preparation } = await reconstruct(input), current = await assertAnyQuoteLifecycleIdentityV1(input);
  need(current.timestamp < BigInt(preparation.prepared.expiresAt), "preparation expired");
  if (preparation.recipe.kind === "approve") {
    need(current.timestamp < BigInt(preparation.recipe.quote.validUntil), "sell quote expired");
    const required = await prepareModuleEngineSourceAnyQuoteSwapV1({ client: input.client, identity: identity(input.identity), blockNumber: current.blockNumber,
      template: preparation.recipe.template, account: preparation.recipe.account, quote: preparation.recipe.quote });
    need("kind" in required && required.kind === "approval-required", "sell no longer requires this approval");
    same(json({ ...required, expiration: undefined }), { ...preparation.funding, expiration: undefined }, "sell funding snapshot changed");
  }
  await source.refresh(current);
  const estimated = await input.client.estimateGas({ account: source.prepared.account, to: source.prepared.transaction.to, data: source.prepared.transaction.data,
    value: BigInt(source.prepared.transaction.value), blockNumber: current.blockNumber });
  need(source.prepared.transaction.gas && estimated <= BigInt(source.prepared.transaction.gas), "current gas exceeds the bound preparation");
  return preparation.prepared.transaction;
}
export async function verifyAnyQuoteLifecycleReceiptV1(input: Common & { preparation: AnyQuoteLifecyclePreparationV1; receipt: TransactionReceipt }): Promise<AnyQuoteLifecycleReceiptV1> {
  const { source } = await reconstruct(input), block = await assertModuleEngineSourceReceiptV1({ client: input.client, identity: identity(input.identity), prepared: source.prepared, receipt: input.receipt });
  return json(await source.receipt(input.receipt, block));
}
