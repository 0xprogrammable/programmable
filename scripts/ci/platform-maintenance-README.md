# Internal platform maintenance publication

This is a source candidate for a bounded Public `main` maintenance gate. It
does not change GitHub settings, produce a GitHub review, deploy the website,
or confer application, wallet, provider, financial or onchain authority.

The inspected public repository is `programmablehq/PROGRAMMABLE`, repository
ID `1314365508`. Its default branch and website branch are **production**.
`main` is the contracts and release-evidence branch. The controller workflows
live on protected `production`; candidate execution uses a separately checked
out exact `main` PR head. No new workflow needs to be installed on `main` to be
discovered by the default-branch triggers.

## Source and execution boundaries

`platform-maintenance-policy.mjs` is the closed policy. It accepts only an open,
non-draft, mergeable, first-party `main` PR whose author currently has repository
write authority. Source, test and documentation additions/modifications have a
bounded path and file-mode policy. Submissions, renames, removals, symlinks,
unknown paths and analyzer-suppression changes do not receive this authority.

The policy preserves the existing exceptional CI-control subject:

- Commit `e15bb397604a19d6622af5a5ee9622a8edac9d18`.
- Tree `92eecc16da2c59b87295fcb4012e57fe4f1feae7`.
- Only its listed CI/configuration/generated-validator paths are exceptions.

That pin already exists in the protected `verify-hook-builder.yml` control
guard. This candidate does not change it. A different control-plane change,
including a change to this gate or its baseline, needs a separately reviewed
protected-source policy revision. A PR cannot supply its own new pin.

The producer first checks the existing successful `foundry`,
`hook-builder-maintenance`, `security` and `public-intake` checks. It refetches
their actual GitHub Actions app, run, workflow path, PR/base/head identity, job
and current run attempt. A name-only status, skipped job, old attempt, wrong
workflow or another repository does not satisfy the policy.

Two fresh runners then independently execute the exact candidate head:

- Foundry 1.7.1 with the existing CI fuzz/invariant profile and Solidity 0.8.26;
  formatting, build and actual nonempty successful test results are required.
- Slither 0.11.5 with complete JSON output and no unclassified diagnostics;
  every reported detector, including informational results, must be accounted
  for by the trusted disposition policy.

Both execution jobs have only a read token, no token in the tool environment,
no OIDC grant, no application secrets and no deployment credentials. The only
bootstrap script they execute must be unchanged from the trusted PR base.
Foundry FFI is disabled and filesystem permissions must be read-only. Artifact
or candidate bytes are never executed in the issuer, consumer or dispatch job.

The isolated issuer reparses both worker records, revalidates the live subject
and existing checks, and uses the existing GitHub OIDC/Sigstore attestation
mechanism. The resulting `programmable.platform-maintenance-evidence.v1` is
distinct from production Verify, application-admission and launch receipts.
The evidence lifetime is one hour. Artifacts are selected by exact run,
attempt, immutable artifact ID/digest and repository metadata.

The consumer checks the exact signer workflow, source ref, source SHA, signer
SHA and hosted-runner provenance with `gh attestation verify`. It then checks
the live PR, current protected refs, source tree and all technical observations
again. It can publish a real technical `platform-maintenance-release` success
before protection migration; that publication alone never requests a merge.

The merge operation separately requires the complete target branch protection.
It uses the ordinary GitHub squash-merge endpoint with the exact head `sha`.
Strict/up-to-date required checks remain GitHub's base-race protection. A later
head/base/check drift withdraws the consumer's success context. The returned
squash commit is read back and must have the selected base as its sole parent
and the selected canonical merge tree. An ambiguous API result is a failure,
not a claim that a merge did or did not occur.

## Slither baseline

The initial baseline is deliberately empty. The existing main security job's
`--fail-none` is reporting behavior, not a finding disposition. Existing
`production/contracts/security/` reports for other source graphs are not
imported or relabeled.

If a scan reports findings, it fails and retains the raw scan as a diagnostic
artifact. No maintenance-approval artifact is issued. To authorize a known
finding, an independently reviewed policy revision must contain its complete
finding hash, full analysis source-tree/toolchain hash, explicit disposition,
substantive rationale, reviewed source commit and protected evidence path/blob.
The controller verifies that the referenced evidence blob actually exists at
its own immutable source revision. A changed analysis source or finding does
not inherit an old disposition. This conservative policy can therefore require
new triage when an existing disposition's source closure changes.

## Automatic post-merge verification

A `GITHUB_TOKEN` merge does not trigger a new `push` workflow. This controller
does not rely on that event. After a successful merge, a separate job with
`actions:write` and only `contents:read` authenticates the original evidence and
actual merged PR/commit again, then explicitly dispatches
`platform-maintenance-post-merge.yml` on the exact protected controller source.

The dispatch contains the actual returned merge SHA, original PR, original
evidence producer and controller SHA. The receiving workflow requires that SHA
to remain the protected `main` tip, with the exact parent/tree and original PR
head. It reruns both unprivileged workers and separately attests
`programmable.platform-maintenance-post-merge-evidence.v1`. A dispatch receipt
states only that dispatch was accepted; the post-merge verification run must
actually succeed before reporting publication as remotely verified.

This completes the bounded Public contracts-source publication/verification
chain. It does not promote a Vercel candidate or deploy contracts. The existing
website production Verify/staging/promotion controllers and private backend
deployment/phase controllers retain their separate authority and evidence.

## Integration-owner bootstrap sequence

1. Review the exact additive source commit and independent local checks. This
   worktree started at protected production
   `53e0b1b338a17ac451072ec18c58cbc34129ce39`; revalidate current production
   before integration. The current GitHub billing lock is an external hold:
   do not retry CI or change account/payment settings through this workflow.
2. Once hosted CI can run again, open/verify the additive candidate against
   `production` and complete the existing protected production checks. Merge
   through ordinary protection. Production currently needs no human PR review;
   this step does not require changing `main`'s review rule, CODEOWNERS or any
   required status. It is the one-time source-policy bootstrap, not a recurring
   fabricated reviewer action.
3. Confirm all three workflow files and helper files exist at the exact
   protected default-branch SHA. The producer's `pull_request_target` and
   technical-completion `workflow_run` triggers now discover this source. For
   an already-open PR, dispatch `Verify platform maintenance` on production
   with only its PR number. GitHub refetch, not that selector, chooses the
   authorized source. New ordinary PRs trigger automatically.
4. Obtain a real successful producer and authenticated technical check at the
   current exact head. If Slither finds anything, review its actual diagnostics
   and land any justified exact-source disposition through a new protected
   production policy revision, then regenerate the evidence. Do not replace
   the empty baseline with a blanket allowlist. The consumer still refuses
   merge while the old protection rule is active.
5. Read back the new successful check and its authentic GitHub Actions app
   (`15368`), source/CI/Sigstore evidence and live PR/base/head. Only after that
   evidence and the source policy have been reviewed, migrate `main` to the
   following **persistent replacement**, preserving any stronger unrelated
   rules: strict required checks `foundry`, `security`,
   `hook-builder-maintenance`, `public-intake`, `platform-maintenance-release`,
   each pinned to app `15368`; admin enforcement on; linear history on; force
   pushes and deletion off. The machine rule replaces the internal maintenance
   requirement for one human review, CODEOWNER review and last-push approval.
   Do not remove a required technical check or temporarily bypass protection.
6. Regenerate the producer at the unchanged current subject, or let the next
   authentic technical-completion event do so. The consumer revalidates the
   rule and all evidence, requests the conditional protected merge, reads back
   the actual commit and automatically dispatches post-merge verification.
   Confirm that separate run and its attested result, not merely dispatch
   acceptance or an earlier green job.

The new branch-required context is deliberately a closed **internal** lane.
Application submissions cannot pass it. Before using a global branch rule for
both lanes, preserve an independently authenticated application-admission
route, or explicitly leave application merges held. Do not make an unknown,
external, skipped or application classification a successful maintenance no-op.
This candidate does not install an application reviewer or alter application
receipts to avoid that integration requirement.

The existing admission App candidate has `checks:write` and only
`pull_requests:read`; its approved-review orchestrator consumes an existing
authenticated review and does not author `APPROVE` reviews. No new App, key,
credential, bot self-review or administrative bypass is required by this
maintenance gate. Initial developer branch publication uses the existing
authorized developer/agent path; this workflow does not autonomously create
arbitrary candidate branches or pull requests.

## Local checks

```sh
node --test scripts/test/platform-maintenance-release.test.mjs scripts/test/platform-maintenance-workflow.test.mjs
actionlint .github/workflows/platform-maintenance-verify.yml .github/workflows/platform-maintenance-release.yml .github/workflows/platform-maintenance-post-merge.yml
```

The tests use inert fixtures and mocked GitHub transport. They do not sign,
broadcast, dispatch, change repository protection, call a live RPC, access
production secrets or claim successful hosted workflow execution. Hosted
execution, real Slither dispositions, protection migration and post-merge
evidence remain independent activation evidence.
