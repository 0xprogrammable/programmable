"use client";

import { useCallback, useRef, useState, type ComponentProps } from "react";
import { ModuleReviewWorkspace, PublicationSessionDownload } from "../../components/module-review-admin-console";
import { WEBSITE_ADMIN_WALLET } from "../../lib/admin-access";
import type { PublicationSession } from "../../lib/module-mode/publication-session";
import { reviewDigest, summarizeReviewJob, type ModuleReviewDecisionCommandV1, type ModuleReviewDecisionRecordV1 } from "../../lib/module-mode/review-contract";
import type { moduleReviewAdminFixture } from "./module-review-admin";
import styles from "../../components/module-review-admin-console.module.css";

const NO_EXAMPLES: ReturnType<typeof moduleReviewAdminFixture>[] = [];

/** Local rendering harness only. No authentication, network, database, review, or publication authority. */
export function ModuleReviewAdminHarness({ fixture, examples = NO_EXAMPLES }: { fixture: ReturnType<typeof moduleReviewAdminFixture>; examples?: ReturnType<typeof moduleReviewAdminFixture>[] }) {
  const detail = useRef(structuredClone(fixture.detail));
  const records = useRef([fixture, ...examples].map(item => structuredClone(item.detail)));
  const loseResponse = useRef(false);
  const [generation, setGeneration] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const exportSession = useRef<PublicationSession | null>(Object.freeze({ walletAddress: WEBSITE_ADMIN_WALLET }));
  const changeExportSession = useRef(false);
  const [exportReady, setExportReady] = useState(true);
  const [tokenReads, setTokenReads] = useState(0);
  const request = useCallback<ComponentProps<typeof ModuleReviewWorkspace>["request"]>(async (path, body) => {
    if (path.startsWith("?")) return { schemaVersion: "programmable.modules.website-review-queue.v1", jobs: records.current.map(record => {
      const current = record.job.subject.submissionId === detail.current.job.subject.submissionId ? detail.current : record;
      return { ...summarizeReviewJob(current.job), sourceSummary: { name: current.source.descriptor.name, version: current.source.descriptor.version } };
    }), nextCursor: null };
    const requested = [fixture, ...examples].find(item => path.startsWith(`/${item.subject.submissionId}`)) ?? fixture;
    if (path.includes("/source?")) return JSON.stringify(requested.source);
    if (path.endsWith("/manifest")) return { schemaVersion: "programmable.modules.website-manifest-check.v1", submissionId: requested.subject.submissionId, requestDigest: requested.subject.requestDigest, reviewRevision: detail.current.job.reviewRevision, artifactDigest: requested.artifact.artifactDigest, hostManifestHash: requested.manifestHash };
    if (path.endsWith("/plan")) {
      detail.current = { ...detail.current, job: { ...detail.current.job, state: "queued", reviewRevision: detail.current.job.reviewRevision + 1, artifact: null } };
      return { schemaVersion: "programmable.modules.review-plan-receipt.v1", job: detail.current.job, approved: false, available: false };
    }
    if (path.endsWith("/decisions")) {
      const command = (body as { command: ModuleReviewDecisionCommandV1 }).command;
      const contents: Omit<ModuleReviewDecisionRecordV1, "decisionDigest"> = { schemaVersion: "programmable.modules.review-decision.v1", reviewerWallet: fixture.reviewer, policyDigest: requested.policyDigest, subject: requested.subject, command, decidedAt: "2026-09-06T02:00:00.000Z", available: false, registryApproved: false };
      const decision = { ...contents, decisionDigest: reviewDigest("programmable.modules.review-decision.v1", contents) };
      detail.current = { ...detail.current, decisions: [...detail.current.decisions, decision], job: { ...detail.current.job, reviewRevision: detail.current.job.reviewRevision + 1, state: command.outcome === "accept" ? "accepted" : command.outcome === "reject" ? "rejected" : "changes_requested" } };
      setRequestCount(n => n + 1);
      if (loseResponse.current) throw new Error("Synthetic lost response after recording the decision.");
      return { schemaVersion: "programmable.modules.review-decision-receipt.v1", decision };
    }
    const id = path.split("?")[0].slice(1);
    const next = records.current.find(item => item.job.subject.submissionId === id);
    if (next && detail.current.job.subject.submissionId !== id) {
      records.current = records.current.map(item => item.job.subject.submissionId === detail.current.job.subject.submissionId ? detail.current : item);
      detail.current = next;
    }
    return structuredClone(detail.current);
  }, [fixture, examples]);
  const reset = (failed: boolean) => {
    detail.current = structuredClone(fixture.detail);
    if (failed) detail.current.job = { ...detail.current.job, state: "build_failed", lastError: "SYNTHETIC_BUILD_FAILURE", artifact: null };
    setRequestCount(0); setGeneration(n => n + 1);
  };
  return <div className={`${styles.page} page-width`} data-module-review-page>
    <header className={styles.header}><div><p className={styles.eyebrow}>Admin · Local preview</p><h1>Module reviews</h1></div>
    <details className={styles.tools}><summary>Preview controls</summary><div className={styles.toolsMenu}>
      <p className={styles.caption}>Synthetic data. No real review authority.</p>
      <div className={styles.actions}><button className={styles.secondary} onClick={() => reset(false)}>Reset successful build</button><button className={styles.secondary} onClick={() => reset(true)}>Show failed build</button><label className={styles.checkbox}><input type="checkbox" onChange={event => { loseResponse.current = event.target.checked; }} />Lose decision response</label></div>
      <p role="status">Synthetic decisions sent: {requestCount}</p>
    <section className={styles.section}>
      <h2>Local session-download fixture</h2>
      <p className={styles.note}>Downloaded files contain synthetic tokens with no authentication or publication authority. Delete these fixture files after the interface check.</p>
      <label className={styles.checkbox}><input type="checkbox" checked={exportReady} onChange={event => {
        exportSession.current = event.target.checked ? Object.freeze({ walletAddress: WEBSITE_ADMIN_WALLET }) : null;
        setExportReady(event.target.checked);
      }} />Authenticated fixture session</label>
      <label className={styles.checkbox}><input type="checkbox" onChange={event => { changeExportSession.current = event.target.checked; }} />Change session during token retrieval</label>
      <PublicationSessionDownload ready={exportReady} readSession={() => exportSession.current}
        getIdentityToken={async () => {
          if (changeExportSession.current) exportSession.current = Object.freeze({ walletAddress: WEBSITE_ADMIN_WALLET });
          return "synthetic_identity_token_no_authority";
        }}
        getAccessToken={async () => { setTokenReads(n => n + 1); return "synthetic_access_token_no_authority"; }} />
      <p className={styles.caption}>Synthetic access-token reads: {tokenReads}</p>
    </section>
    <details className={styles.disclosure}><summary>Fixture host manifest</summary><pre>{JSON.stringify(fixture.manifest, null, 2)}</pre></details>
    </div></details></header>
    <ModuleReviewWorkspace key={generation} account={fixture.reviewer} request={request} />
  </div>;
}
