import { buildCreatorSplit, validateRecipe } from './index.mjs';
import { FILE_LIMITS, loadModulePackage, readBoundedFile, readJsonFile, writeJsonExclusive, submitToLocalQueue,
  listLocalQueue, localSubmissionStatus, recordLocalReview } from './io.mjs';
import { loadOpenSourcePackage, compileOpenTemplateFiles } from './open-package-io.mjs';
import { MODULE_TRANSPORT_LIMITS, ModuleTransportError, moduleSubmissionFromPack,
  validateModuleSubmissionRequest, parseModuleSubmissionJSON } from './open-transport.mjs';
import { createModuleApiClient } from './open-client.mjs';

const HELP = `Programmable Module Mode contributor tooling (no signing, deployment or public approval).

Commands:
  validate-module --manifest path
  validate-recipe --recipe path --catalogue path
  pack --manifest path --out path
  submit-local --manifest path --queue path
  list-local --queue path
  status-local --queue path --id 0x...
  review-local --queue path --id 0x... --reviewer 0x... --decision accepted|changes_requested|rejected --note text
  prepare-creator-split --recipients path --out path
  validate-open-package --package path
  pack-open-package --package path --out path
  plan-open-template --template path --packages path --bindings path --out path
  prepare-module-submission --package path --out path [--supersedes UUID]
  module-capabilities --api-origin https://api.example
  review-capabilities --api-origin https://api.example
  submit-module --package path --api-origin https://api.example --idempotency-key stable-key-at-least-16-chars [--supersedes UUID]
  submit-module --request path --api-origin https://api.example --idempotency-key stable-key-at-least-16-chars
  status-module --api-origin https://api.example --id UUID
  review-status-module --api-origin https://api.example --id UUID
  list-module-submissions --api-origin https://api.example [--cursor UUID]

All file paths are relative to --root (default: current directory).
Existing output files are never overwritten. Catalogue is an explicit trusted input.
Local reviewer identity is an operator assertion, not a wallet signature.
Creator recipients input is a JSON array of { wallet, shareBps }; shares total 10000.
Open commands are an unreviewed v0.1 source/configuration candidate, never a launch or approval.
Open package list is an array of descriptor paths; source paths are relative to --root.
Module API commands use an explicit deployment origin; loopback HTTP is allowed for local checks.
Authenticated commands read PROGRAMMABLE_MODULES_API_KEY from the environment, never an argument.
Use a key with modules:submit and modules:read. The descriptor author must be that key's EVM wallet;
rewardWallet is a required nonzero EVM payout wallet. Source bytes and rewardWallet are immutable per revision.
Keep the same Idempotency-Key and package bytes when retrying an uncertain submission. No automatic retries.
--request sends a previously prepared source request, independently of later workspace source edits.
draft_received means durable unreviewed intake, not review, approval, launch or public availability.
review-status-module reads separate build/review progress and nextAction; accepted still requires registry admission.
`;
const fields = {
  'validate-module': ['manifest'], 'validate-recipe': ['recipe', 'catalogue'], pack: ['manifest', 'out'],
  'submit-local': ['manifest', 'queue'], 'list-local': ['queue'], 'status-local': ['queue', 'id'],
  'review-local': ['queue', 'id', 'reviewer', 'decision', 'note'],
  'prepare-creator-split': ['recipients', 'out'],
  'validate-open-package': ['package'], 'pack-open-package': ['package', 'out'],
  'plan-open-template': ['template', 'packages', 'bindings', 'out'],
  'prepare-module-submission': ['package', 'out'], 'module-capabilities': ['api-origin'],
  'submit-module': ['api-origin', 'idempotency-key'], 'status-module': ['api-origin', 'id'],
  'list-module-submissions': ['api-origin'],
  'review-capabilities': ['api-origin'], 'review-status-module': ['api-origin', 'id'],
};
const optionalFields = { 'prepare-module-submission': ['supersedes'], 'submit-module': ['package', 'request', 'supersedes'], 'list-module-submissions': ['cursor'] };
export async function runCli(args, { stdout = process.stdout, stderr = process.stderr, env = process.env } = {}) {
  const apiKey = env.PROGRAMMABLE_MODULES_API_KEY;
  const output = (value) => {
    const serialized = JSON.stringify(value, (_key, field) => typeof field === 'string' && typeof apiKey === 'string' && apiKey
      ? field.split(apiKey).join('[redacted]') : field, 2);
    return `${serialized}\n`;
  };
  try {
    const [command, ...rest] = args;
    if (!command || command === '--help' || command === 'help') { stdout.write(HELP); return 0; }
    if (!Object.hasOwn(fields, command)) throw new Error('Unknown command; use --help');
    const options = {};
    for (let i = 0; i < rest.length; i += 2) {
      const flag = rest[i]; const value = rest[i + 1];
      const key = flag?.startsWith('--') ? flag.slice(2) : '';
      if (!['root', ...fields[command], ...(optionalFields[command] || [])].includes(key) || !value || value.startsWith('--')
        || Object.hasOwn(options, key)) throw new Error('Invalid or duplicate option; use --help');
      options[key] = value;
    }
    for (const required of fields[command]) if (!options[required]) throw new Error(`Missing --${required}`);
    const root = options.root || process.cwd();
    let result;
    if (['prepare-module-submission', 'submit-module'].includes(command)) {
      if (command === 'submit-module' && Boolean(options.package) === Boolean(options.request)) throw new Error('Use exactly one of --package or --request');
      if (options.request && options.supersedes) throw new Error('A prepared request already pins its supersession; do not add --supersedes');
      let request;
      if (options.request) {
        const checked = parseModuleSubmissionJSON(await readBoundedFile(root, options.request, MODULE_TRANSPORT_LIMITS.requestBytes));
        if (!checked.ok) { const issue = checked.errors[0]; throw new ModuleTransportError(issue.code, issue.message, issue.path); }
        request = checked.request;
      } else {
        const pack = await loadOpenSourcePackage(root, options.package);
        request = moduleSubmissionFromPack(pack, options.supersedes ? { supersedesSubmissionId: options.supersedes } : {});
      }
      if (command === 'prepare-module-submission') {
        if (!await writeJsonExclusive(root, options.out, request)) throw new Error('Output exists; choose a new path');
        const checked = validateModuleSubmissionRequest(request);
        result = { ok: true, scope: 'prepared-source-submission', output: options.out, packageId: checked.packageId,
          familyId: checked.familyId, requestDigest: checked.requestDigest, author: request.descriptor.author,
          rewardWallet: request.descriptor.rewardWallet, totalSourceBytes: checked.totalSourceBytes, sourceBytesVerified: true,
          sourceRevisionVerified: false, authorAuthenticated: false, buildVerified: false, runtimeVerified: false,
          reviewStatus: 'unreviewed', approved: false, available: false };
      } else result = { ok: true, ...await createModuleApiClient({ apiOrigin: options['api-origin'], apiKey })
        .submit(request, { idempotencyKey: options['idempotency-key'] }) };
    } else if (['module-capabilities', 'review-capabilities', 'status-module', 'review-status-module', 'list-module-submissions'].includes(command)) {
      const client = createModuleApiClient({ apiOrigin: options['api-origin'], ...(['module-capabilities', 'review-capabilities'].includes(command) ? {} : { apiKey }) });
      result = { ok: true, ...await (command === 'module-capabilities' ? client.capabilities() : command === 'review-capabilities' ? client.reviewCapabilities()
        : command === 'status-module' ? client.status(options.id) : command === 'review-status-module' ? client.reviewStatus(options.id)
          : client.list(options.cursor ? { cursor: options.cursor } : {})) };
    } else if (command === 'validate-open-package' || command === 'pack-open-package') {
      const pack = await loadOpenSourcePackage(root, options.package);
      if (command === 'pack-open-package' && !await writeJsonExclusive(root, options.out, pack)) throw new Error('Output exists; choose a new path');
      result = { ok: true, scope: 'source-package-preview', packageId: pack.packageId, familyId: pack.familyId,
        localFileHashesVerified: true, sourceRevisionVerified: false, authorAuthenticated: false,
        runtimeVerified: false, reviewStatus: 'unreviewed', onchainApproved: false,
        ...(command === 'pack-open-package' ? { output: options.out } : {}) };
    } else if (command === 'plan-open-template') {
      result = await compileOpenTemplateFiles(root, { templatePath: options.template, packagesPath: options.packages, bindingsPath: options.bindings });
      if (!result.ok) { stdout.write(output(result)); return 1; }
      if (!await writeJsonExclusive(root, options.out, result)) throw new Error('Output exists; choose a new path');
      result = { ...result, output: options.out };
    } else if (command === 'validate-module' || command === 'pack') {
      const pack = await loadModulePackage(root, options.manifest);
      if (command === 'pack' && !await writeJsonExclusive(root, options.out, pack)) throw new Error('Output exists; choose a new path');
      result = { ok: true, manifestHash: pack.manifestHash, reviewStatus: 'requested', runtimeVerified: false,
        ...(command === 'pack' ? { output: options.out } : {}) };
    } else if (command === 'validate-recipe') {
      const recipe = await readJsonFile(root, options.recipe, FILE_LIMITS.recipe);
      const catalogue = await readJsonFile(root, options.catalogue, FILE_LIMITS.catalogue);
      result = validateRecipe(recipe, catalogue);
      stdout.write(output(result)); return result.ok ? 0 : 1;
    } else if (command === 'prepare-creator-split') {
      const recipients = await readJsonFile(root, options.recipients, 256 * 1024);
      const split = buildCreatorSplit(recipients);
      if (!await writeJsonExclusive(root, options.out, split)) throw new Error('Output exists; choose a new path');
      result = { ok: true, scope: 'local-only', output: options.out, root: split.root, recipientCount: split.recipientCount };
    } else if (command === 'submit-local') result = await submitToLocalQueue({ root, manifestPath: options.manifest, queue: options.queue });
    else if (command === 'list-local') result = await listLocalQueue({ root, queue: options.queue });
    else if (command === 'status-local') result = await localSubmissionStatus({ root, queue: options.queue, id: options.id });
    else result = await recordLocalReview({ root, ...options });
    stdout.write(output(result)); return 0;
  } catch (error) {
    stderr.write(output({ ok: false, errors: [{ code: error.code || 'CLI_ERROR', message: error.message,
      ...Object.fromEntries(['path', 'httpStatus', 'retryAfterSeconds', 'submissionMayExist']
        .filter((field) => Object.hasOwn(error, field)).map((field) => [field, error[field]])) }] }));
    return 1;
  }
}
