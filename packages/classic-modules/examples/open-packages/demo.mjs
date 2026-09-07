import * as fs from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../../src/cli.mjs';
import { SOURCE, HELP, sourcePackage, templateFor, context, AUTHOR, CREATOR, OTHER_CREATOR } from './fixture.mjs';

const destination = process.argv[2];
if (!destination || process.argv.length !== 3) throw new Error('Usage: node examples/open-packages/demo.mjs NEW_DIRECTORY');
const root = path.resolve(destination);
// A fresh destination is required. Existing examples or user drafts are never overwritten.
await fs.mkdir(root);
await fs.mkdir(path.join(root, 'fixture'));
await fs.writeFile(path.join(root, 'fixture/source.txt'), SOURCE, { flag: 'wx' });
await fs.writeFile(path.join(root, 'fixture/README.md'), HELP, { flag: 'wx' });
const pkg = sourcePackage(); const template = templateFor(pkg);
const invalid = structuredClone(template); invalid.instances[0].parameters.minimum = '500';
// These addresses are inert configuration test values, not listed or verified assets.
const freeQuotePackage = sourcePackage(); freeQuotePackage.version = '0.1.1';
freeQuotePackage.configuration.fields.quoteAsset = { type: 'address', binding: { mode: 'input' } };
freeQuotePackage.configuration.required.push('quoteAsset');
freeQuotePackage.configuration.fields.minimum.binding = { mode: 'input', default: '10' };
const freeQuoteTemplate = templateFor(freeQuotePackage);
freeQuoteTemplate.instances[0].parameters.quoteAsset = AUTHOR;
delete freeQuoteTemplate.instances[0].parameters.minimum;
const secondQuoteTemplate = structuredClone(freeQuoteTemplate);
secondQuoteTemplate.instances[0].parameters.quoteAsset = CREATOR;
secondQuoteTemplate.instances[0].parameters.minimum = '20';
const fixedQuotePackage = structuredClone(freeQuotePackage); fixedQuotePackage.version = '0.2.0';
fixedQuotePackage.configuration.fields.quoteAsset.binding = { mode: 'fixed', value: AUTHOR };
const fixedQuoteTemplate = templateFor(fixedQuotePackage);
const quoteOverride = structuredClone(fixedQuoteTemplate); quoteOverride.instances[0].parameters.quoteAsset = CREATOR;
for (const [file, value] of Object.entries({
  'package.json': pkg, 'template.json': template, 'invalid-template.json': invalid,
  'packages.json': ['package.json'], 'bindings.json': context(), 'other-wallet.json': context(OTHER_CREATOR),
  'free-quote-package.json': freeQuotePackage, 'fixed-quote-package.json': fixedQuotePackage,
  'quote-packages.json': ['free-quote-package.json', 'fixed-quote-package.json'],
  'free-quote-template.json': freeQuoteTemplate, 'second-quote-template.json': secondQuoteTemplate,
  'fixed-quote-template.json': fixedQuoteTemplate, 'quote-override-template.json': quoteOverride,
})) await fs.writeFile(path.join(root, file), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });

async function command(name, parameters, expectedExit = 0) {
  let output = ''; let errors = '';
  const argv = [name, '--root', root, ...Object.entries(parameters).flatMap(([key, value]) => [`--${key}`, value])];
  const exit = await runCli(argv, { stdout: { write(s) { output += s; } }, stderr: { write(s) { errors += s; } } });
  if (exit !== expectedExit) throw new Error(`${name} unexpectedly exited ${exit}: ${errors || output}`);
  return JSON.parse(output || errors);
}
await command('pack-open-package', { package: 'package.json', out: 'source-pack.json' });
const first = await command('plan-open-template', { template: 'template.json', packages: 'packages.json', bindings: 'bindings.json', out: 'plan.json' });
const second = await command('plan-open-template', { template: 'template.json', packages: 'packages.json', bindings: 'other-wallet.json', out: 'other-wallet-plan.json' });
if (first.planId === second.planId) throw new Error('Changing a resolved wallet must change the committed plan');
const conflict = await command('plan-open-template', { template: 'invalid-template.json', packages: 'packages.json', bindings: 'bindings.json', out: 'invalid-plan.json' }, 1);
await fs.writeFile(path.join(root, 'conflict.json'), `${JSON.stringify(conflict, null, 2)}\n`, { flag: 'wx' });
const quotePlans = [];
for (const name of ['free', 'second', 'fixed']) quotePlans.push(await command('plan-open-template', {
  template: `${name}-quote-template.json`, packages: 'quote-packages.json', bindings: 'bindings.json', out: `${name}-quote-plan.json`,
}));
if (quotePlans[0].plan.instances[0].packageId !== quotePlans[1].plan.instances[0].packageId
  || quotePlans[0].planId === quotePlans[1].planId) throw new Error('Two free CAs must share one package and produce different plans');
const fixedOverride = await command('plan-open-template', {
  template: 'quote-override-template.json', packages: 'quote-packages.json', bindings: 'bindings.json', out: 'quote-override-plan.json',
}, 1);
if (fixedOverride.errors[0].code !== 'OPEN_CONFIG_FIXED_OVERRIDE') throw new Error('Fixed CA override must fail');
await fs.writeFile(path.join(root, 'quote-override-rejection.json'), `${JSON.stringify(fixedOverride, null, 2)}\n`, { flag: 'wx' });
process.stdout.write(`${JSON.stringify({
  root, scope: 'inert-configuration-fixture', planId: first.planId, otherWalletPlanId: second.planId,
  rejectedConflict: conflict.errors, localFileHashesVerified: true, sourceRevisionVerified: false,
  reviewStatus: 'unreviewed', launchable: false,
  freeQuotePackageId: quotePlans[0].plan.instances[0].packageId,
  fixedQuotePackageId: quotePlans[2].plan.instances[0].packageId, fixedQuoteOverride: fixedOverride.errors,
}, null, 2)}\n`);
