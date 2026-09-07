export type OpenConfigParameterBinding =
  | { mode: 'input'; default?: unknown }
  | { mode: 'fixed'; value: unknown };
export interface OpenConfigMetadata { label?: string; help?: string; binding?: OpenConfigParameterBinding }
export type OpenConfigUintInput = string | number;
export interface OpenRecordSchema extends OpenConfigMetadata {
  type: 'record'; fields: Record<string, OpenConfigSchema>; required: string[];
}
export type OpenConfigSchema = OpenRecordSchema
  | (OpenConfigMetadata & { type: 'array'; items: OpenConfigSchema; minItems?: number; maxItems: number })
  | (OpenConfigMetadata & { type: 'uint'; bits?: number; min?: OpenConfigUintInput; max?: OpenConfigUintInput; unit?: string })
  | (OpenConfigMetadata & { type: 'bool' | 'address' | 'account' | 'asset' | 'component' })
  | (OpenConfigMetadata & { type: 'string' | 'bytes'; maxLength: number })
  | (OpenConfigMetadata & { type: 'variant'; tag: string; variants: Record<string, OpenRecordSchema> });
export class OpenConfigError extends Error {
  code: string; path: string;
  constructor(code: string, path: string, message: string);
}
export const OPEN_CONFIG_LIMITS: Readonly<{
  schemaDepth: 12; schemaNodes: 512; recordFields: 64; variantBranches: 64; arrayItems: 256;
  stringBytes: 16384; bytesLength: 16384; schemaBytes: 65536; valueBytes: 131072;
  contextBytes: 131072; jsonDepth: 32; jsonNodes: 16384; encodedBytes: 262144;
}>;
/**
 * Throws OpenConfigError with a JSON-pointer path; checks inert JSON descriptors.
 * The direct JavaScript API is not a sandbox for executable objects such as Proxies.
 */
export function assertOpenConfigSchema(schema: unknown): asserts schema is OpenConfigSchema;
export type OpenConfigHex = `0x${string}`;
export interface OpenAssetContext { chainId: OpenConfigUintInput; address: OpenConfigHex; decimals: number }
export interface OpenConfigContext {
  roles?: Record<string, OpenConfigHex>;
  assets?: Record<string, OpenAssetContext>;
  components?: Record<string, OpenConfigHex>;
}
export interface OpenResolvedAsset { chainId: string; address: OpenConfigHex; decimals: number }
export type OpenConfigBinding =
  | { path: string; kind: 'account' | 'component'; reference: string; resolved: OpenConfigHex }
  | { path: string; kind: 'asset'; reference: string | null; resolved: OpenResolvedAsset };
export type OpenConfigValue = string | number | boolean | OpenConfigValue[] | { [key: string]: OpenConfigValue };
export interface OpenAbiParameter { name: string; type: string; components?: OpenAbiParameter[] }
export interface OpenCompiledConfig {
  value: OpenConfigValue;
  abiParameters: OpenAbiParameter[];
  /** Includes BigInts. Omit this field from JSON artifacts; commit the encoded bytes. */
  abiValues: unknown[];
  encoded: OpenConfigHex;
  bindings: OpenConfigBinding[];
}
export interface OpenResolvedConfig { value: OpenConfigValue; bindings: OpenConfigBinding[] }
/**
 * Uses the identical validation/resolution path as compileOpenConfig. Inserts
 * omitted fixed values and editable defaults; rejects fixed overrides. Free
 * required values without defaults must still be supplied. Undefined is only
 * accepted for a root with a fixed value or input default. Fixed subtrees require
 * literal addresses/asset metadata and cannot resolve caller-rebindable handles.
 */
export function resolveOpenConfigBindings(schema: unknown, values: unknown, context?: OpenConfigContext): OpenResolvedConfig;
/**
 * One root ABI parameter; records sort fields, arrays preserve order. Optional
 * fields encode tuple(bool present,T value) with type-level zero when absent.
 * Empty records stay {} and encode tuple(bool _empty) with a fixed false sentinel.
 * Variant input { [tag]: branchName,...fields } encodes tuple(uint16 index,bytes
 * abi.encode(branchRecordTuple)), with lexically sorted zero-based branch indexes.
 * maxLength counts UTF-8 bytes for strings, decoded bytes for hexadecimal bytes.
 * References are caller-supplied assertions, not authenticated onchain evidence.
 * Asset metadata is in bindings; committing its encoded address alone is insufficient.
 * Literal assets use {chainId,address,decimals} and a binding with reference:null.
 * Literal components use {address}. Existing symbolic forms remain unchanged.
 * Schema binding metadata changes no ABI layout. The exact reviewed schema/package
 * digest must accompany bytes; the engine must enforce that binding independently.
 */
export function compileOpenConfig(schema: unknown, values: unknown, context?: OpenConfigContext): OpenCompiledConfig;
