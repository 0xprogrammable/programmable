export type OpenConstraintPath = readonly (string | number)[];
/** Units are opaque, nonempty UTF-8 text up to 128 bytes; comparisons never normalize or convert them. */
export type OpenConstraintExpression =
  | { literal: string; unit: string }
  | { ref: { instance: string; path: OpenConstraintPath } }
  | { sum: { instance: string; path: OpenConstraintPath; member: OpenConstraintPath } }
  | { add: readonly OpenConstraintExpression[] };
export interface OpenConstraint {
  id: string;
  message: string;
  left: OpenConstraintExpression;
  operator: 'eq' | 'lte' | 'lt' | 'gte' | 'gt';
  right: OpenConstraintExpression;
}
/** Values must already be compiled/normalized; this evaluator does not replace full configuration validation. */
export interface OpenConstraintBinding { schema: OpenConfigSchema; value: unknown }
export interface OpenConstraintViolation { id: string; message: string; path: string; code: string }
export interface OpenConstraintResult { ok: boolean; violations: OpenConstraintViolation[] }
export class OpenConstraintError extends Error {
  code: string;
  path: string;
  constructor(code: string, message: string, path?: string);
}
export const OPEN_CONSTRAINT_LIMITS: Readonly<{
  constraints: 64; bindings: 64; expressionDepth: 12; expressionNodes: 1024; addTerms: 64;
  pathSegments: 16; identifierLength: 64; messageLength: 512; unitLength: 128;
  jsonDepth: 32; jsonNodes: 32768; jsonArrayLength: 256; jsonObjectKeys: 256;
  jsonStringLength: 131072; jsonBytes: 524288; evaluationSteps: 262144;
}>;
/** Throws OpenConstraintError with code and JSON-pointer path for malformed or oversized definitions. */
export function assertOpenConstraints(constraints: unknown): asserts constraints is OpenConstraint[];
/** Never coerces numeric references; failures are structured and ordered by constraint ID. */
export function evaluateOpenConstraints(constraints: unknown, bindings: unknown): OpenConstraintResult;
import type { OpenConfigSchema } from './open-config.mjs';
