export const MODULE_CONTEXT_SCHEMA = 'programmable.modules.context.v1';

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const wallet = (value) => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
const text = (value) => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(value);
const names = (value) => Array.isArray(value) && value.length <= 64 && value.every(text) && new Set(value).size === value.length;
const limits = (value) => plain(value) && Object.keys(value).length <= 64
  && Object.entries(value).every(([key, item]) => /^[A-Za-z][A-Za-z0-9]*$/.test(key) && Number.isSafeInteger(item) && item > 0);
const requireValue = (condition) => { if (!condition) throw new TypeError('MODULE_CONTEXT_RESPONSE'); };

/** Validate preparation data without promoting a profile name to execution authority. */
export function bindModuleContext(value) {
  requireValue(plain(value) && value.schemaVersion === MODULE_CONTEXT_SCHEMA
    && plain(value.identity) && wallet(value.identity.author) && wallet(value.identity.defaultRewardWallet)
    && value.identity.author.toLowerCase() === value.identity.defaultRewardWallet.toLowerCase()
    && plain(value.authorization) && names(value.authorization.scopes)
    && names(value.authorization.requiredScopes) && names(value.authorization.missingScopes)
    && plain(value.intake) && typeof value.intake.available === 'boolean'
    && value.intake.submissionFormat === 'programmable.modules.submission.v0.1'
    && value.intake.descriptorFormat === 'programmable.classic.source-package.v0.1'
    && value.intake.openRuntimeIdentifiers === true && value.intake.openHostRequirements === true
    && value.intake.categoryRequired === false && value.intake.repositoryRequired === false
    && limits(value.intake.limits)
    && ['httpBytes', 'sourceBytes', 'sourceFileBytes', 'sourceFiles', 'pageSize', 'requestSeconds', 'concurrentUploads', 'descriptorBytes']
      .every((key) => Object.hasOwn(value.intake.limits, key)));
  const required = ['modules:submit', 'modules:read'];
  const expectedMissing = required.filter((scope) => !value.authorization.scopes.includes(scope));
  requireValue(value.authorization.requiredScopes.length === required.length
    && required.every((scope) => value.authorization.requiredScopes.includes(scope))
    && value.authorization.missingScopes.length === expectedMissing.length
    && expectedMissing.every((scope) => value.authorization.missingScopes.includes(scope))
    && value.authorization.canSubmit === (value.intake.available && value.authorization.scopes.includes('modules:submit'))
    && value.authorization.canRead === (value.intake.available && value.authorization.scopes.includes('modules:read')));
  requireValue(plain(value.inputs) && names(value.inputs.requiredUserInput) && names(value.inputs.optionalUserInput)
    && value.inputs.requiredUserInput.length === 1 && value.inputs.requiredUserInput[0] === 'idea'
    && value.inputs.optionalUserInput.includes('rewardWallet') && value.inputs.authorSource === 'api_key_wallet'
    && value.inputs.rewardWalletDefault === 'author' && names(value.inputs.agentPreparedFields));
  requireValue(plain(value.review) && typeof value.review.available === 'boolean'
    && typeof value.review.statusReadAvailable === 'boolean' && value.review.planRequired === true
    && value.review.unknownRequirements === 'await_review_plan' && limits(value.review.limits)
    && Object.hasOwn(value.review.limits, 'sourceBytes') && Object.hasOwn(value.review.limits, 'configBytes')
    && Array.isArray(value.review.profiles) && value.review.profiles.length <= 64
    && value.review.profiles.every((profile) => plain(profile) && text(profile.id) && text(profile.configurationCodec)
      && text(profile.compilerVersion) && plain(profile.componentRuntimes)
      && Object.keys(profile.componentRuntimes).length > 0 && Object.keys(profile.componentRuntimes).length <= 64
      && Object.values(profile.componentRuntimes).every((runtimes) => names(runtimes) && runtimes.length > 0))
    && new Set(value.review.profiles.map((profile) => profile.id)).size === value.review.profiles.length
    && value.review.dependencies === 'submitted_source_only' && value.review.submittedCommandsExecuted === false
    && value.review.approval === 'manual' && value.review.publicationSeparate === true
    && plain(value.links) && ['guide', 'capabilities', 'reviewCapabilities', 'submit', 'submissions', 'review'].every((key) => text(value.links[key]))
    && value.approved === false && value.available === false);
  return { ...value, identity: { author: value.identity.author.toLowerCase(), defaultRewardWallet: value.identity.defaultRewardWallet.toLowerCase() } };
}
