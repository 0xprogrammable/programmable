import type { OpenConfigSchema, OpenConfigContext, OpenConfigValue, OpenConfigBinding, OpenAbiParameter } from './open-config.mjs';
import type { OpenConstraint } from './open-constraints.mjs';

export { assertOpenConfigSchema, compileOpenConfig, OPEN_CONFIG_LIMITS, OpenConfigError } from './open-config.mjs';
export type { OpenConfigSchema, OpenConfigContext, OpenCompiledConfig, OpenConfigBinding } from './open-config.mjs';
export { assertOpenConstraints, evaluateOpenConstraints, OPEN_CONSTRAINT_LIMITS, OpenConstraintError } from './open-constraints.mjs';
export type { OpenConstraint, OpenConstraintExpression, OpenConstraintResult } from './open-constraints.mjs';
export type OpenHex = `0x${string}`;
export interface OpenIssue { code: string; message: string; path: string; id?: string; instance?: string }
export class OpenPackageError extends Error { code: string; path: string; constructor(code: string, message: string, path?: string) }
export const OPEN_PACKAGE_FORMAT: 'programmable.classic.source-package.v0.1';
export const OPEN_TEMPLATE_FORMAT: 'programmable.classic.template.v0.1';
export const OPEN_PLAN_FORMAT: 'programmable.classic.configuration-plan.v0.1';
export const OPEN_PLAN_LIMITS: Readonly<{ packages: 128; instances: 64; links: 256; bytes: number }>;
export interface OpenComponent { id: string; runtime: string; sourcePath: string; entrypoint: string }
export interface OpenRead { id: string; label: string; component: string; entrypoint: string; description: string }
export interface OpenAction extends OpenRead { role: string; inputs: OpenConfigSchema }
export interface OpenManagement { summary: string; reads: OpenRead[]; actions: OpenAction[] }
export interface OpenSourcePackage {
  format: typeof OPEN_PACKAGE_FORMAT; name: string; version: string;
  author: OpenHex; rewardWallet: OpenHex; familySalt: OpenHex;
  source: { files: Array<{path: string; sha256: string}> } &
    ({repository: string;revision: string} | {repository?:never;revision?:never});
  components: OpenComponent[]; configuration: OpenConfigSchema;
  ports: {inputs: Record<string, string>; outputs: Record<string, string>};
  constraints: OpenConstraint[]; management: OpenManagement; requiresHost: string[];
  documentation: string; extensions?: Record<string, unknown>;
}
export interface OpenTemplate {
  format: typeof OPEN_TEMPLATE_FORMAT; name: string;
  instances: Array<{id: string; packageId: OpenHex; parameters: unknown}>;
  links: Array<{from: {instance: string; port: string}; to: {instance: string; port: string}}>;
  constraints: OpenConstraint[];
}
export interface OpenPlanContext extends OpenConfigContext { hostCapabilities?: string[] }
export interface OpenConfigurationPlan {
  format: typeof OPEN_PLAN_FORMAT;
  instances: Array<{
    id: string; packageId: OpenHex; familyId: OpenHex; configuration: OpenConfigValue;
    configurationBytes: OpenHex; abiParameters: OpenAbiParameter[]; bindings: OpenConfigBinding[];
    components: OpenComponent[]; management: OpenManagement;
  }>;
  links: Array<OpenTemplate['links'][number] & {interface: string}>;
  preparationOrder: string[]; constraints: OpenConstraint[];
  authorFamilies: Array<{familyId: OpenHex; author: OpenHex; rewardWallet: OpenHex}>;
  hostRequirements: string[];
}
export type OpenTemplateResult = {ok: false; errors: OpenIssue[]; scope?: 'configuration-preview'; launchable?: false; onchainApproved?: false}
  | {ok: true; scope: 'configuration-preview'; plan: OpenConfigurationPlan; planId: OpenHex;
      missingHostCapabilities: string[]; launchable: false; onchainApproved: false; sourceVerified: false;
      runtimeVerified: false; authorizationVerified: false; reviewStatus: 'unreviewed'; engineStatus: 'not-implemented'};
/** Checks syntax/types and hashes declarations. No source fetch, build, wallet proof or review. */
export function validateOpenPackage(descriptor: unknown): {ok: false; errors: OpenIssue[]}
  | {ok: true; descriptor: OpenSourcePackage; packageId: OpenHex; familyId: OpenHex;
      sourceVerified: false; authorAuthenticated: false; reviewStatus: 'unreviewed'; onchainApproved: false};
export function openPackageId(descriptor: unknown): OpenHex;
/** A configuration preview only, with caller-asserted bindings. Never a launch transaction. */
export function compileOpenTemplate(template: unknown, packages: unknown, context?: OpenPlanContext): OpenTemplateResult;
