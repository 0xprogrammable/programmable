import * as fs from 'node:fs/promises';
import path from 'node:path';
import { runCli } from '../../src/cli.mjs';
import { SOURCE, HELP, sourcePackage, templateFor, context, OTHER_CREATOR } from './fixture.mjs';

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
for (const [file, value] of Object.entries({
  'package.json': pkg, 'template.json': template, 'invalid-template.json': invalid,
  'packages.json': ['package.json'], 'bindings.json': context(), 'other-wallet.json': context(OTHER_CREATOR),
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
process.stdout.write(`${JSON.stringify({
  root, scope: 'inert-configuration-fixture', planId: first.planId, otherWalletPlanId: second.planId,
  rejectedConflict: conflict.errors, localFileHashesVerified: true, sourceRevisionVerified: false,
  reviewStatus: 'unreviewed', launchable: false,
}, null, 2)}\n`);
