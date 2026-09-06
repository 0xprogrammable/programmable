import { createHash } from 'node:crypto';
import { readBoundedFile, readJsonFile } from './io.mjs';
import { OpenPackageError, OPEN_PLAN_LIMITS, validateOpenPackage, compileOpenTemplate } from './open-packages.mjs';

export const OPEN_SOURCE_LIMITS = Object.freeze({ file: 4 * 1024 * 1024, total: 16 * 1024 * 1024 });

/** Reads only explicitly pinned regular files below the selected root; never imports or executes source. */
export async function loadOpenSourcePackage(root, descriptorPath) {
  const descriptor = await readJsonFile(root, descriptorPath, OPEN_PLAN_LIMITS.bytes);
  const validated = validateOpenPackage(descriptor);
  if (!validated.ok) {
    const error = validated.errors[0]; throw new OpenPackageError(error.code, error.message, error.path);
  }
  const files = [];
  let total = 0;
  for (const file of [...descriptor.source.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const bytes = await readBoundedFile(root, file.path, OPEN_SOURCE_LIMITS.file);
    total += bytes.length;
    if (total > OPEN_SOURCE_LIMITS.total) throw new OpenPackageError('OPEN_SOURCE_LIMIT', 'Source package exceeds its total byte budget', '/source/files');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (sha256 !== file.sha256) throw new OpenPackageError('OPEN_SOURCE_HASH', 'Local source bytes do not match their declared hash', `/source/files/${file.path}`);
    files.push({ path: file.path, sha256, encoding: 'base64', bytes: bytes.toString('base64') });
  }
  return {
    format: 'programmable.classic.source-pack.v0.1', descriptor: validated.descriptor,
    packageId: validated.packageId, familyId: validated.familyId, files,
    localFileHashesVerified: true, sourceRevisionVerified: false, authorAuthenticated: false,
    runtimeVerified: false, reviewStatus: 'unreviewed', onchainApproved: false,
    evidence: 'Local file bytes match declared hashes. Repository revision, build, ownership, runtime and approval are not verified.',
  };
}

/** Paths in the package list and source descriptors are relative to the explicit workspace root. */
export async function compileOpenTemplateFiles(root, { templatePath, packagesPath, bindingsPath }) {
  const template = await readJsonFile(root, templatePath, OPEN_PLAN_LIMITS.bytes);
  const paths = await readJsonFile(root, packagesPath, OPEN_PLAN_LIMITS.bytes);
  if (!Array.isArray(paths) || paths.length > OPEN_PLAN_LIMITS.packages || paths.some((p) => typeof p !== 'string')) {
    throw new OpenPackageError('OPEN_PACKAGE_LIST', 'Package list must contain bounded descriptor paths');
  }
  if (new Set(paths).size !== paths.length) throw new OpenPackageError('OPEN_PACKAGE_LIST', 'Duplicate package paths');
  const bindings = await readJsonFile(root, bindingsPath, OPEN_PLAN_LIMITS.bytes);
  const packages = [];
  let totalSource = 0;
  for (const path of paths) {
    const pack = await loadOpenSourcePackage(root, path);
    // Retain only descriptors after checking bytes; do not keep all source bundles in memory.
    totalSource += pack.files.reduce((sum, file) => sum + Buffer.byteLength(file.bytes, 'base64'), 0);
    if (totalSource > OPEN_SOURCE_LIMITS.total) throw new OpenPackageError('OPEN_SOURCE_LIMIT', 'Selected source packages exceed their aggregate byte budget');
    packages.push(pack.descriptor);
  }
  const compiled = compileOpenTemplate(template, packages, bindings);
  return { ...compiled, localFileHashesVerified: true, sourceRevisionVerified: false };
}
