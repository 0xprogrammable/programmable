import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadOpenSourcePackage, compileOpenTemplateFiles } from '../src/open-package-io.mjs';
import { runCli } from '../src/cli.mjs';
import { openPackageId } from '../src/open-packages.mjs';
import { SOURCE, HELP, sourcePackage, templateFor, context, OTHER_CREATOR } from '../examples/open-packages/fixture.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'programmable-open-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'fixture'));
  await fs.writeFile(path.join(root, 'fixture/source.txt'), SOURCE);
  await fs.writeFile(path.join(root, 'fixture/README.md'), HELP);
  const pkg = sourcePackage();
  for (const [file, data] of Object.entries({ 'package.json': pkg, 'template.json': templateFor(pkg),
    'packages.json': ['package.json'], 'bindings.json': context() })) {
    await fs.writeFile(path.join(root, file), JSON.stringify(data));
  }
  return root;
}
async function cli(root, command, options) {
  let out = ''; let err = '';
  const status = await runCli([command, '--root', root, ...Object.entries(options).flatMap(([key, value]) => [`--${key}`, value])], {
    stdout: { write(s) { out += s; } }, stderr: { write(s) { err += s; } },
  });
  return { status, result: JSON.parse(out || err) };
}

test('source bundle checks inert bytes and keeps revision/ownership/runtime review unverified', async (t) => {
  const root = await fixture(t);
  const pack = await loadOpenSourcePackage(root, 'package.json');
  assert.equal(pack.localFileHashesVerified, true); assert.equal(pack.sourceRevisionVerified, false);
  assert.equal(pack.authorAuthenticated, false); assert.equal(pack.onchainApproved, false);
  assert.equal(Buffer.from(pack.files.find((f) => f.path.endsWith('source.txt')).bytes, 'base64').toString(), SOURCE);
  await fs.writeFile(path.join(root, 'fixture/source.txt'), 'modified');
  await assert.rejects(loadOpenSourcePackage(root, 'package.json'), { code: 'OPEN_SOURCE_HASH' });
});

test('source file symlink and catalogue traversal are rejected', async (t) => {
  const root = await fixture(t);
  await fs.unlink(path.join(root, 'fixture/source.txt'));
  await fs.symlink(path.join(root, 'fixture/README.md'), path.join(root, 'fixture/source.txt'));
  await assert.rejects(loadOpenSourcePackage(root, 'package.json'));
  await fs.writeFile(path.join(root, 'packages.json'), JSON.stringify(['../package.json']));
  await assert.rejects(compileOpenTemplateFiles(root, { templatePath: 'template.json', packagesPath: 'packages.json', bindingsPath: 'bindings.json' }));
});

test('CLI performs source -> pack -> configuration preview with exclusive output and no approval', async (t) => {
  const root = await fixture(t);
  const check = await cli(root, 'validate-open-package', { package: 'package.json' });
  assert.equal(check.status, 0, JSON.stringify(check)); assert.equal(check.result.onchainApproved, false);
  const pack = await cli(root, 'pack-open-package', { package: 'package.json', out: 'pack.json' });
  assert.equal(pack.status, 0);
  assert.equal((await cli(root, 'pack-open-package', { package: 'package.json', out: 'pack.json' })).status, 1);
  const preview = await cli(root, 'plan-open-template', { template: 'template.json', packages: 'packages.json', bindings: 'bindings.json', out: 'plan.json' });
  assert.equal(preview.status, 0, JSON.stringify(preview)); assert.equal(preview.result.launchable, false);
  assert.equal(preview.result.authorizationVerified, false);
  assert.equal(preview.result.localFileHashesVerified, true);
  const firstPlan = JSON.parse(await fs.readFile(path.join(root, 'plan.json'), 'utf8'));
  await fs.writeFile(path.join(root, 'bindings.json'), JSON.stringify(context(OTHER_CREATOR)));
  const rebound = await cli(root, 'plan-open-template', { template: 'template.json', packages: 'packages.json', bindings: 'bindings.json', out: 'plan-other-wallet.json' });
  assert.equal(rebound.status, 0); assert.notEqual(rebound.result.planId, firstPlan.planId);
});

test('invalid edited configuration remains intact and writes no successful preview', async (t) => {
  const root = await fixture(t);
  const templatePath = path.join(root, 'template.json');
  const template = JSON.parse(await fs.readFile(templatePath, 'utf8'));
  template.instances[0].parameters.minimum = '500';
  const edited = JSON.stringify(template); await fs.writeFile(templatePath, edited);
  const result = await cli(root, 'plan-open-template', { template: 'template.json', packages: 'packages.json', bindings: 'bindings.json', out: 'bad-plan.json' });
  assert.equal(result.status, 1); assert.equal(result.result.errors[0].id, 'ordered-limits');
  await assert.rejects(fs.stat(path.join(root, 'bad-plan.json')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(templatePath, 'utf8'), edited);
});

test('CLI applies defaults and fixed parameters and rejects overrides without writing a plan', async (t) => {
  const root = await fixture(t);
  const pkg = sourcePackage();
  pkg.configuration.fields.quoteAsset = { type: 'address', binding: { mode: 'fixed', value: OTHER_CREATOR } };
  pkg.configuration.required.push('quoteAsset');
  pkg.configuration.fields.minimum.binding = { mode: 'input', default: '10' };
  const template = templateFor(pkg); delete template.instances[0].parameters.minimum;
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(pkg));
  await fs.writeFile(path.join(root, 'template.json'), JSON.stringify(template));
  const command = { template: 'template.json', packages: 'packages.json', bindings: 'bindings.json', out: 'bound-plan.json' };
  const accepted = await cli(root, 'plan-open-template', command);
  assert.equal(accepted.status, 0, JSON.stringify(accepted));
  assert.deepEqual(accepted.result.plan.instances[0].configuration.quoteAsset, OTHER_CREATOR);
  assert.equal(accepted.result.plan.instances[0].configuration.minimum, '10');
  assert.equal(accepted.result.plan.instances[0].packageId, openPackageId(pkg));
  assert.equal(accepted.result.launchable, false);
  template.instances[0].parameters.quoteAsset = pkg.author;
  const edited = JSON.stringify(template);
  await fs.writeFile(path.join(root, 'template.json'), edited);
  const rejected = await cli(root, 'plan-open-template', { ...command, out: 'override-plan.json' });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.result.errors[0].code, 'OPEN_CONFIG_FIXED_OVERRIDE');
  assert.equal(rejected.result.errors[0].path, '/quoteAsset');
  await assert.rejects(fs.stat(path.join(root, 'override-plan.json')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, 'template.json'), 'utf8'), edited);
});
