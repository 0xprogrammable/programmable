import type { OpenSourcePackage, OpenTemplateResult } from './open-packages.mjs';
export const OPEN_SOURCE_LIMITS: Readonly<{ file: number; total: number }>;
export function loadOpenSourcePackage(root: string, descriptorPath: string): Promise<{
  format: string; descriptor: OpenSourcePackage; packageId: `0x${string}`; familyId: `0x${string}`;
  files: Array<{path: string; sha256: string; encoding: 'base64'; bytes: string}>;
  localFileHashesVerified: true; sourceRevisionVerified: false; authorAuthenticated: false;
  runtimeVerified: false; reviewStatus: 'unreviewed'; onchainApproved: false; evidence: string;
}>;
export function compileOpenTemplateFiles(root: string, paths: {
  templatePath: string; packagesPath: string; bindingsPath: string;
}): Promise<OpenTemplateResult & {localFileHashesVerified: true; sourceRevisionVerified: false}>;
