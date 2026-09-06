export type Hex = `0x${string}`;
export { buildCreatorSplit, encodeCreatorTakeover, MAX_CREATOR_SPLIT_RECIPIENTS, CREATOR_SPLIT_DOMAIN } from './creator-recipients.mjs';
export type { CreatorSplitRecipientInput, CreatorSplitRecipient, CreatorSplit, CreatorTakeoverInput, PreparedCreatorTakeover } from './creator-recipients.mjs';
export type UintInput = string | number | bigint;
export type ConfigValue = string | number | boolean;
export type ConfigParameters = Record<string, ConfigValue>;
export type AbiField = { name: string; type: 'uint256' | 'uint128' | 'uint64' | 'uint32' | 'uint16' | 'uint8' | 'bool' | 'address' | 'bytes32' };
export type ConfigSchema = Record<string, unknown>;
export interface ModuleManifest {
  schemaVersion: '1.0'; name: string; description: string;
  familyId: Hex; familySalt: Hex; version: number; versionId: Hex;
  interfaceVersion: 1; kind: 1 | 2; author: Hex; rewardWallet: Hex;
  chainId: string; implementation: Hex; runtimeCodeHash: Hex; reviewStatus: 'requested';
  source: { repository: string; commit: string; artifactPath: string; artifactSha256: string; compiler: '0.8.26' };
  configuration: { schemaUri: string; schemaSha256: string;
    profile: 'static-abi-v1' | 'falling-creator-fee-v1' | 'quote-trade-limit-v1'; fields: AbiField[] };
}
export interface ModuleSelection { versionId: Hex; config: Hex; parameters: ConfigParameters }
export interface Recipe {
  schemaVersion: '1.0'; chainId: string; hook: Hex; registry: Hex;
  baseBuyFeeBps: number; baseSellFeeBps: number; modules: ModuleSelection[];
}
export interface CatalogueEntry {
  manifest: ModuleManifest; manifestHash: Hex;
  status: 'approved' | 'suspended' | 'pending' | 'rejected'; configSchema: ConfigSchema;
}
/** The caller must establish catalogue authority outside this pure SDK. */
export interface TrustedCatalogue { schemaVersion: '1.0'; chainId: string; registry: Hex; entries: CatalogueEntry[] }
export interface ModuleSnapshot { versionId: Hex; familyId: Hex; implementation: Hex; codeHash: Hex; kind: 1 | 2; config: Hex }
export interface ModuleIssue { code: string; message: string; path: string }
export type ValidationResult<T> = ({ ok: true } & T) | { ok: false; errors: ModuleIssue[] };
export interface FeeDisclosure {
  scope: 'hook-fees'; programmableFeeBps: 20; treasuryBps: 10; authorsBps: 10;
  buyCreatorBps: number; sellCreatorBps: number; buyHookFeeBps: number; sellHookFeeBps: number;
  poolLpFeePips: 0; poolProtocolFeePips: { buy: number | null; sell: number | null }; combinedFeeQuoteRequired: true;
}
export interface ValidatedRecipe {
  recipeHash: Hex; snapshots: ModuleSnapshot[]; fees: FeeDisclosure;
  authors: { familyId: Hex; author: Hex; rewardWalletAtReview: Hex; slots: 1 }[];
  validationBoundary: string;
}
export class ClassicModuleError extends Error { code: string; path: string; constructor(code: string, message: string, path?: string) }
export const MAX_MODULES: 8;
export const MAX_CONFIG_BYTES: 256;
export const MAX_CATALOGUE_ENTRIES: 10000;
export const RECIPE_DOMAIN: Hex;
export const MAX_UINT256: bigint;
export const MAX_QUOTE_LIMIT: bigint;
export function canonicalJson(value: unknown): string;
export function safeRelativePath(value: unknown): boolean;
export function familyIdFor(author: Hex, salt: Hex): Hex;
export function versionIdFor(familyId: Hex, version: UintInput): Hex;
export function manifestDigest(manifest: unknown): Hex;
export function configurationSchemaDigest(schema: unknown): string;
export function validateModuleManifest(manifest: unknown): ValidationResult<{ manifestHash: Hex; reviewStatus: 'requested' }>;
export function validateConfigurationSchema(schema: unknown, manifest: unknown): ValidationResult<Record<never, never>>;
export function encodeConfiguration(fields: AbiField[], parameters: Record<string, ConfigValue | bigint>): Hex;
export function encodeFallingCreatorFeeConfig(parameters: { buyEnd: UintInput; sellEnd: UintInput; duration: UintInput }): Hex;
export function encodeQuoteTradeLimitConfig(parameters: { buyLimit: UintInput; sellLimit: UintInput }): Hex;
export function feeDisclosure(baseBuyFeeBps: number, baseSellFeeBps: number,
  poolFees?: { buyPoolProtocolFeePips?: number | null; sellPoolProtocolFeePips?: number | null }): FeeDisclosure;
export function splitAuthorPool(amount: UintInput, moduleCount: number): { perModule: bigint; remainder: bigint; moduleCount: number };
export function snapshotItemHash(snapshot: ModuleSnapshot): Hex;
export function hashRecipeSnapshot(context: Pick<Recipe, 'hook' | 'registry' | 'baseBuyFeeBps' | 'baseSellFeeBps'> & { chainId: UintInput }, snapshots: ModuleSnapshot[]): Hex;
export function validateRecipe(recipe: unknown, trustedCatalogue: unknown): ValidationResult<ValidatedRecipe>;
export function recipeHash(recipe: unknown, trustedCatalogue: unknown): Hex;
