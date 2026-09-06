import { createHash } from 'node:crypto';
import { OPEN_PACKAGE_FORMAT, OPEN_TEMPLATE_FORMAT, openPackageId } from '../../src/open-packages.mjs';

export const AUTHOR = `0x${'1'.repeat(40)}`;
export const CREATOR = `0x${'2'.repeat(40)}`;
export const OTHER_CREATOR = `0x${'3'.repeat(40)}`;
export const SOURCE = '// Inert source-binding fixture. This is not an executable launch module.\n';
export const HELP = '# Fixture\nThis package tests source binding and configuration only.\n';
export const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const uint = (unit = 'bps') => ({ type: 'uint', bits: 256, min: '0', max: '1000000', unit });

export function sourcePackage() {
  return {
    format: OPEN_PACKAGE_FORMAT, name: 'Allocation configuration fixture', version: '0.1.0',
    author: AUTHOR, rewardWallet: AUTHOR, familySalt: `0x${'0'.repeat(63)}1`,
    source: { repository: 'https://example.invalid/configuration-fixture', revision: '1'.repeat(40),
      files: [{ path: 'fixture/source.txt', sha256: hash(SOURCE) }, { path: 'fixture/README.md', sha256: hash(HELP) }] },
    components: [{ id: 'allocation', runtime: 'example.inert-fixture@1', sourcePath: 'fixture/source.txt', entrypoint: 'not-executable' }],
    configuration: { type: 'record', fields: {
      recipients: { type: 'array', minItems: 1, maxItems: 16, items: {
        type: 'record', fields: { wallet: { type: 'account' }, share: uint() }, required: ['wallet', 'share'],
      } },
      minimum: uint('quote.raw'), maximum: uint('quote.raw'),
    }, required: ['recipients', 'minimum', 'maximum'] },
    ports: { inputs: {}, outputs: { allocation: 'example.allocation@1' } },
    constraints: [
      { id: 'allocation-total', message: 'Recipient shares must total 10000 bps',
        left: { sum: { instance: '$self', path: ['recipients'], member: ['share'] } }, operator: 'eq', right: { literal: '10000', unit: 'bps' } },
      { id: 'ordered-limits', message: 'Minimum must not exceed maximum',
        left: { ref: { instance: '$self', path: ['minimum'] } }, operator: 'lte',
        right: { ref: { instance: '$self', path: ['maximum'] } } },
    ],
    management: { summary: 'Configuration fixture; no live claims or controls.', reads: [], actions: [] },
    requiresHost: ['programmable.config@1', 'example.allocation-view@1'], documentation: 'fixture/README.md',
  };
}
export function values() {
  return { recipients: [{ wallet: { role: 'creator' }, share: '7000' }, { wallet: { address: AUTHOR }, share: '3000' }], minimum: '10', maximum: '100' };
}
export function templateFor(pkg = sourcePackage()) {
  return { format: OPEN_TEMPLATE_FORMAT, name: 'Shareable allocation fixture',
    instances: [{ id: 'rewards', packageId: openPackageId(pkg), parameters: values() }], links: [], constraints: [] };
}
export function context(creator = CREATOR) {
  return { roles: { creator }, assets: {}, components: {}, hostCapabilities: ['programmable.config@1'] };
}
