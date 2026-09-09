"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { getAddress, isAddress } from "viem";

import {
  acquireCreatorArticleAuthHeadersV1,
  loadCreatorArticleEditorV1,
  type CreatorArticleEditorStateV1 as EditorState,
  type CreatorProjectSummaryV1,
} from "@/components/creator-article-editor-loader";
import { useWallet } from "@/components/wallet-provider";
import { PartnerLaunchAttribution } from
  "@/components/partner-launch-attribution";
import { parseLaunchPartnerAttributionV1 } from
  "@/lib/launch-partner-attribution";
import type { ClassicV3Reward } from "@/lib/profile/classic-v3-rewards";

import { ProfileLaunchesSkeleton } from "@/components/profile-skeleton";
import styles from "./profile-projects.module.css";

export {
  acquireCreatorArticleAuthHeadersV1,
  loadCreatorArticleEditorV1,
} from "@/components/creator-article-editor-loader";
export type { CreatorProjectSummaryV1 } from
  "@/components/creator-article-editor-loader";

const loadCreatorArticleEditorModule = () =>
  import("@/components/creator-article-editor");
const preloadCreatorArticleEditorModule = () => {
  void loadCreatorArticleEditorModule().catch(() => undefined);
};
const CreatorArticleEditor = dynamic(
  loadCreatorArticleEditorModule,
  { ssr: false, loading: () => <p className={styles.loading}>Opening editor…</p> },
);

export const creatorProjectPageSize = 5;
const creatorProjectRefreshTimeoutMs = 12_000;
const creatorProjectRefreshTimeoutReason = "creator-project-refresh-timeout";
const emptyCreatorProjectsV1: readonly CreatorProjectSummaryV1[] =
  Object.freeze([]);
const emptyClassicRewardsV1: readonly ClassicV3Reward[] = Object.freeze([]);
const emptyRewardReceiverActionStatesV1: Readonly<
  Record<string, CreatorProjectRewardReceiverActionStateV1>
> = Object.freeze({});
const zeroAddress = "0x0000000000000000000000000000000000000000";

export type CreatorProjectMarketCapV1 = Readonly<{
  tokenAddress: `0x${string}`;
  usdWad: string | null;
  ethWei: string | null;
  label: string | null;
}>;

export type CreatorProjectOwnerStateV1 = Readonly<{
  ownerAccount: string;
  phase: "loading" | "ready" | "error";
  projects: readonly CreatorProjectSummaryV1[];
}>;

export type CreatorProjectRewardReceiverActionStateV1 = Readonly<{
  account: string;
  status:
    | "preparing"
    | "wallet"
    | "confirming"
    | "pending"
    | "not-found"
    | "confirmed"
    | "error";
  message: string;
}>;

export function rewardReceiverActionKeyV1(vaultAddress: string) {
  return `${vaultAddress.toLowerCase()}:update-payout`;
}

export function rewardReceiverAddressErrorV1(
  value: string,
  currentReceiver: string,
) {
  const candidate = value.trim();
  if (!isAddress(candidate) || candidate.toLowerCase() === zeroAddress) {
    return "Enter a valid Ethereum address.";
  }
  if (candidate.toLowerCase() === currentReceiver.toLowerCase()) {
    return "Enter a different reward receiver.";
  }
  return "";
}

export function manageableClassicRewardsByTokenV1(
  rewards: readonly ClassicV3Reward[],
  walletAccount: string | null,
) {
  const candidates = new Map<string, ClassicV3Reward | null>();
  if (walletAccount === null) return new Map<string, ClassicV3Reward>();

  for (const reward of rewards) {
    if (
      !reward.ownedAllocations.some(
        (allocation) =>
          allocation.payoutAddress.toLowerCase() === walletAccount,
      )
    ) {
      continue;
    }
    const token = reward.tokenAddress.toLowerCase();
    candidates.set(token, candidates.has(token) ? null : reward);
  }

  return new Map(
    [...candidates].filter(
      (entry): entry is [string, ClassicV3Reward] => entry[1] !== null,
    ),
  );
}

export function scopeCreatorProjectOwnerStateV1(
  state: CreatorProjectOwnerStateV1 | null,
  walletAccount: string | null,
) {
  return state !== null && state.ownerAccount === walletAccount
    ? state
    : null;
}

export function beginCreatorProjectOwnerRefreshV1(
  state: CreatorProjectOwnerStateV1 | null,
  ownerAccount: string,
): CreatorProjectOwnerStateV1 {
  return state?.ownerAccount === ownerAccount
    ? { ...state, phase: "loading" }
    : { ownerAccount, phase: "loading", projects: [] };
}

function creatorProjectAbortError(signal: AbortSignal) {
  if (signal.reason === creatorProjectRefreshTimeoutReason) {
    return new Error(creatorProjectRefreshTimeoutReason);
  }
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Creator project request aborted");
  error.name = "AbortError";
  return error;
}

export async function loadCreatorProjectListV1(input: Readonly<{
  fetchImpl?: typeof fetch;
  getAuthHeaders: () => Promise<Record<string, string>>;
  signal?: AbortSignal;
  timeoutMs?: number;
}>) {
  const controller = new AbortController();
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? creatorProjectRefreshTimeoutMs;
  const forwardAbort = () => controller.abort(input.signal?.reason);
  if (input.signal?.aborted) forwardAbort();
  else input.signal?.addEventListener("abort", forwardAbort, { once: true });

  let rejectAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(creatorProjectAbortError(controller.signal));
    if (controller.signal.aborted) rejectAbort();
    else controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  const timeout = setTimeout(
    () => controller.abort(creatorProjectRefreshTimeoutReason),
    timeoutMs,
  );

  try {
    return await Promise.race([
      (async () => {
        const authHeaders = await input.getAuthHeaders();
        if (controller.signal.aborted) {
          throw creatorProjectAbortError(controller.signal);
        }
        const response = await fetchImpl("/api/profile/projects", {
          headers: { Accept: "application/json", ...authHeaders },
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(readError(body));
        return parseProjectList(body);
      })(),
      aborted,
    ]);
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
    if (rejectAbort) {
      controller.signal.removeEventListener("abort", rejectAbort);
    }
  }
}

export function ProfileProjects({
  classicRewards = emptyClassicRewardsV1,
  marketCaps = [],
  onChangeRewardReceiver,
  onRefresh,
  rewardReceiverActionStates = emptyRewardReceiverActionStatesV1,
  refreshing = false,
  walletProjects = [],
}: Readonly<{
  classicRewards?: readonly ClassicV3Reward[];
  marketCaps?: readonly CreatorProjectMarketCapV1[];
  onChangeRewardReceiver?: (
    reward: ClassicV3Reward,
    newReceiver: string,
    allocationIndex: number,
  ) => void;
  onRefresh?: () => void;
  rewardReceiverActionStates?: Readonly<
    Record<string, CreatorProjectRewardReceiverActionStateV1>
  >;
  refreshing?: boolean;
  walletProjects?: readonly CreatorProjectSummaryV1[];
}>) {
  const { wallet, getAccessToken, getIdentityToken } = useWallet();
  const walletAccount = wallet?.account.toLowerCase() ?? null;
  const [projectOwnerState, setProjectOwnerState] =
    useState<CreatorProjectOwnerStateV1 | null>(null);
  const [editor, setEditor] = useState<Readonly<{
    ownerAccount: string;
    state: EditorState;
  }> | null>(null);
  const [openingProject, setOpeningProject] = useState<Readonly<{
    ownerAccount: string;
    project: CreatorProjectSummaryV1;
  }> | null>(null);
  const [rewardReceiverEditor, setRewardReceiverEditor] =
    useState<Readonly<{
      ownerAccount: string;
      project: CreatorProjectSummaryV1;
      reward: ClassicV3Reward;
    }> | null>(null);
  const [projectPage, setProjectPage] = useState(1);
  const [projectError, setProjectError] = useState<Readonly<{
    ownerAccount: string;
    message: string;
  }> | null>(null);
  const editorRequestsRef = useRef(new Map<string, Promise<EditorState>>());
  const editorTriggerRef = useRef<HTMLButtonElement | null>(null);
  const rewardReceiverTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openRequestRef = useRef(0);
  const projectRequestRef = useRef(0);
  const projectRefreshControllerRef = useRef<AbortController | null>(null);

  const scopedProjectOwnerState = scopeCreatorProjectOwnerStateV1(
    projectOwnerState,
    walletAccount,
  );
  const projects = scopedProjectOwnerState?.projects ?? emptyCreatorProjectsV1;
  const phase = scopedProjectOwnerState?.phase ?? "loading";
  const scopedEditor = editor?.ownerAccount === walletAccount
    ? editor.state
    : null;
  const scopedEditorOwnerAccount = scopedEditor === null ? null : walletAccount;
  const scopedOpeningProject = openingProject?.ownerAccount === walletAccount
    ? openingProject.project
    : null;
  const scopedRewardReceiverEditor =
    rewardReceiverEditor?.ownerAccount === walletAccount
      ? rewardReceiverEditor
      : null;
  const scopedProjectError = projectError?.ownerAccount === walletAccount
    ? projectError.message
    : "";

  const getAuthHeaders = useCallback(
    () => acquireCreatorArticleAuthHeadersV1({
      getAccessToken,
      getIdentityToken,
    }),
    [getAccessToken, getIdentityToken],
  );

  const loadProjects = useCallback(async (signal?: AbortSignal) => {
    if (walletAccount === null) return;
    const requestedAccount = walletAccount;
    const requestId = ++projectRequestRef.current;
    setProjectError(null);
    setProjectOwnerState((current) =>
      beginCreatorProjectOwnerRefreshV1(current, requestedAccount));
    try {
      const nextProjects = await loadCreatorProjectListV1({
        getAuthHeaders,
        signal,
      });
      if (projectRequestRef.current !== requestId) return;
      setProjectOwnerState({
        ownerAccount: requestedAccount,
        phase: "ready",
        projects: nextProjects,
      });
      editorRequestsRef.current.clear();
    } catch (error) {
      const refreshTimedOut = error instanceof Error
        && error.message === creatorProjectRefreshTimeoutReason;
      if (projectRequestRef.current !== requestId) return;
      if (signal?.aborted && !refreshTimedOut) return;
      setProjectOwnerState((current) => current?.ownerAccount === requestedAccount
        ? { ...current, phase: "error" }
        : current);
      setProjectError({
        ownerAccount: requestedAccount,
        message: refreshTimedOut
          ? "Launch refresh took too long. Select Refresh to try again."
          : error instanceof Error
            ? error.message
            : "Launch details could not be refreshed.",
      });
    }
  }, [
    getAuthHeaders,
    setProjectError,
    setProjectOwnerState,
    walletAccount,
  ]);

  useEffect(() => {
    if (walletAccount === null) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadProjects(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadProjects, walletAccount]);

  useEffect(() => () => {
    projectRefreshControllerRef.current?.abort();
    projectRefreshControllerRef.current = null;
  }, []);

  const refreshInProgress = phase === "loading" || refreshing;

  const refreshProjects = useCallback(() => {
    if (refreshInProgress) return;
    const controller = new AbortController();
    projectRefreshControllerRef.current?.abort();
    projectRefreshControllerRef.current = controller;
    onRefresh?.();
    void loadProjects(controller.signal).finally(() => {
      if (projectRefreshControllerRef.current === controller) {
        projectRefreshControllerRef.current = null;
      }
    });
  }, [loadProjects, onRefresh, refreshInProgress]);

  const visibleProjects = useMemo(
    () => mergeCreatorWalletProjectsV1(walletProjects, projects),
    [projects, walletProjects],
  );
  const editableTokens = useMemo(
    () => new Set(projects.map((project) => project.tokenAddress.toLowerCase())),
    [projects],
  );
  const pageData = useMemo(
    () => paginateCreatorProjectsV1(visibleProjects, marketCaps, projectPage),
    [marketCaps, projectPage, visibleProjects],
  );
  if (projectPage !== pageData.currentPage) setProjectPage(pageData.currentPage);
  const marketCapByToken = useMemo(() => new Map(
    marketCaps.map((marketCap) => [marketCap.tokenAddress.toLowerCase(), marketCap]),
  ), [marketCaps]);
  const manageableClassicRewardsByToken = useMemo(
    () => manageableClassicRewardsByTokenV1(classicRewards, walletAccount),
    [classicRewards, walletAccount],
  );

  const getEditorState = useCallback((project: CreatorProjectSummaryV1) => {
    if (walletAccount === null) {
      return Promise.reject(new Error("Connect your wallet to edit this article"));
    }
    const key = `${walletAccount}:${project.tokenAddress.toLowerCase()}`;
    const current = editorRequestsRef.current.get(key);
    if (current) return current;
    const request = loadCreatorArticleEditorV1(project, getAuthHeaders).catch((error) => {
      editorRequestsRef.current.delete(key);
      throw error;
    });
    editorRequestsRef.current.set(key, request);
    return request;
  }, [getAuthHeaders, walletAccount]);

  const warmEditor = useCallback((project: CreatorProjectSummaryV1) => {
    preloadCreatorArticleEditorModule();
    void getEditorState(project).catch(() => undefined);
  }, [getEditorState]);

  const focusEditorTrigger = useCallback(() => {
    window.requestAnimationFrame(() => editorTriggerRef.current?.focus());
  }, []);

  async function openEditor(
    project: CreatorProjectSummaryV1,
    trigger: HTMLButtonElement,
  ) {
    if (walletAccount === null) return;
    const requestedAccount = walletAccount;
    const requestId = ++openRequestRef.current;
    editorTriggerRef.current = trigger;
    setOpeningProject({ ownerAccount: requestedAccount, project });
    setProjectError(null);
    try {
      const [, nextEditor] = await Promise.all([
        loadCreatorArticleEditorModule(),
        getEditorState(project),
      ]);
      if (openRequestRef.current !== requestId) return;
      editorRequestsRef.current.delete(
        `${requestedAccount}:${project.tokenAddress.toLowerCase()}`,
      );
      setEditor({ ownerAccount: requestedAccount, state: nextEditor });
    } catch (error) {
      if (openRequestRef.current !== requestId) return;
      setProjectError({
        ownerAccount: requestedAccount,
        message: error instanceof Error
          ? error.message
          : "Creator article unavailable",
      });
      focusEditorTrigger();
    } finally {
      if (openRequestRef.current === requestId) setOpeningProject(null);
    }
  }

  const closeOpeningEditor = useCallback(() => {
    openRequestRef.current += 1;
    setOpeningProject(null);
    focusEditorTrigger();
  }, [focusEditorTrigger, setOpeningProject]);

  const closeEditor = useCallback(() => {
    setEditor(null);
    focusEditorTrigger();
  }, [focusEditorTrigger, setEditor]);

  const closeRewardReceiverEditor = useCallback(() => {
    setRewardReceiverEditor(null);
    window.requestAnimationFrame(() =>
      rewardReceiverTriggerRef.current?.focus());
  }, [setRewardReceiverEditor]);

  const receiverEditorActionState = scopedRewardReceiverEditor
    ? rewardReceiverActionStates[
        rewardReceiverActionKeyV1(
          scopedRewardReceiverEditor.reward.vaultAddress,
        )
      ]
    : undefined;
  const scopedReceiverEditorActionState =
    receiverEditorActionState?.account.toLowerCase() === walletAccount
      ? receiverEditorActionState
      : undefined;

  if (!wallet || walletAccount === null) return null;
  return (
    <ProfileProjectsSection
      refreshInProgress={refreshInProgress}
      onRefresh={refreshProjects}
      currentPage={pageData.currentPage}
      totalPages={pageData.totalPages}
      totalItems={visibleProjects.length > 0 || phase === "ready" ? visibleProjects.length : undefined}
      onPageChange={setProjectPage}
      statusMessage={refreshInProgress ? "Refreshing launches" : phase === "ready" ? "Launches updated" : ""}
    >
      {scopedProjectError && visibleProjects.length > 0 ? (
        <p className={styles.error} role="alert">{scopedProjectError}</p>
      ) : null}
      {phase === "error" && visibleProjects.length > 0 && !scopedProjectError ? (
        <p className={styles.error} role="alert">
          Launch details could not be refreshed. The current list is still shown.
        </p>
      ) : null}

      {phase === "loading" && visibleProjects.length === 0 ? (
        <ProfileProjectsSkeleton />
      ) : phase === "error" && visibleProjects.length === 0 ? (
        <p className={`${styles.error} ${styles.emptyError}`} role="alert">
          {scopedProjectError
            || "Launches could not be refreshed. Select Refresh to try again."}
        </p>
      ) : visibleProjects.length === 0 ? (
        <div className={styles.empty}>
          <p>Your finalized launches will appear here.</p>
          <Link className={styles.refresh} href="/launch">
            Launch a token
          </Link>
        </div>
      ) : (
        <div className={styles.list}>
          {pageData.items.map((project) => {
            const canEditArticle = editableTokens.has(
              project.tokenAddress.toLowerCase(),
            );
            const manageableReward = manageableClassicRewardsByToken.get(
              project.tokenAddress.toLowerCase(),
            );
            const receiverState = manageableReward
              ? rewardReceiverActionStates[
                  rewardReceiverActionKeyV1(manageableReward.vaultAddress)
                ]
              : undefined;
            const scopedReceiverState =
              receiverState?.account.toLowerCase() === walletAccount
                ? receiverState
                : undefined;
            const canChangeRewardReceiver = Boolean(
              manageableReward && onChangeRewardReceiver,
            );
            return (
            <ProfileProjectCard
              key={project.tokenAddress}
              project={project}
              phase={phase}
              marketCapLabel={marketCapByToken.get(project.tokenAddress.toLowerCase())?.label}
              rewardReceiverAvailable={canChangeRewardReceiver}
            >
                {canChangeRewardReceiver && manageableReward ? (
                  <button
                    className={styles.rewardReceiverAction}
                    type="button"
                    aria-busy={
                      rewardReceiverActionBusyV1(scopedReceiverState) ||
                      undefined
                    }
                    onClick={(event) => {
                      rewardReceiverTriggerRef.current = event.currentTarget;
                      setRewardReceiverEditor({
                        ownerAccount: walletAccount,
                        project,
                        reward: manageableReward,
                      });
                    }}
                  >
                    {rewardReceiverTriggerLabelV1(scopedReceiverState)}
                  </button>
                ) : null}
                <span className={styles.articleActionSlot}>
                  {canEditArticle ? (
                    <button
                      className={styles.articleAction}
                      type="button"
                      aria-busy={scopedOpeningProject?.tokenAddress === project.tokenAddress}
                      data-opening={scopedOpeningProject?.tokenAddress === project.tokenAddress}
                      disabled={scopedOpeningProject !== null}
                      onPointerEnter={() => warmEditor(project)}
                      onPointerDown={() => warmEditor(project)}
                      onFocus={() => warmEditor(project)}
                      onClick={(event) => void openEditor(project, event.currentTarget)}
                    >
                      {scopedOpeningProject?.tokenAddress === project.tokenAddress
                        ? "Opening…"
                        : project.article ? "Edit article" : "Create article"}
                    </button>
                  ) : (
                    <span
                      className={styles.articleActionState}
                      data-state={phase}
                    >
                      {phase === "loading"
                        ? "Checking…"
                        : "Unavailable"}
                    </span>
                  )}
                </span>
                <Link
                  className={styles.viewTokenAction}
                  href={`/token/${project.tokenAddress}?chain=${project.chainId}`}
                >
                  View token
                </Link>
            </ProfileProjectCard>
            );
          })}
        </div>
      )}

      {scopedEditor ? (
        <CreatorArticleEditor
          project={scopedEditor.project}
          initialArticle={scopedEditor.article}
          initialEtag={scopedEditor.etag}
          getAuthHeaders={getAuthHeaders}
          onClose={closeEditor}
          onPublished={(article) => {
            setProjectOwnerState((current) => {
              if (
                current === null ||
                current.ownerAccount !== scopedEditorOwnerAccount
              ) return current;
              return {
                ...current,
                projects: current.projects.map((project) =>
                  project.tokenAddress === article.tokenAddress
                    ? {
                        ...project,
                        article: {
                          revision: article.revision,
                          title: article.title,
                          updatedAt: article.updatedAt,
                        },
                      }
                    : project),
              };
            });
          }}
        />
      ) : null}
      {scopedOpeningProject ? (
        <CreatorArticleEditorOpening
          project={scopedOpeningProject}
          onClose={closeOpeningEditor}
        />
      ) : null}
      {scopedRewardReceiverEditor && onChangeRewardReceiver ? (
        <RewardReceiverDialog
          project={scopedRewardReceiverEditor.project}
          reward={scopedRewardReceiverEditor.reward}
          actionState={scopedReceiverEditorActionState}
          onClose={closeRewardReceiverEditor}
          onSubmit={(newReceiver, allocationIndex) =>
            onChangeRewardReceiver(
              scopedRewardReceiverEditor.reward,
              newReceiver,
              allocationIndex,
            )}
        />
      ) : null}
    </ProfileProjectsSection>
  );
}

export function ProfileProjectsSection({
  children,
  refreshInProgress = false,
  onRefresh,
  currentPage = 1,
  totalPages = 1,
  totalItems,
  onPageChange,
  pageChangePending = false,
  statusMessage,
}: Readonly<{
  children: ReactNode;
  refreshInProgress?: boolean;
  onRefresh?: () => void;
  currentPage?: number;
  totalPages?: number;
  totalItems?: number;
  onPageChange?: (page: number) => void;
  pageChangePending?: boolean;
  statusMessage?: string;
}>) {
  return (
    <section className={styles.section} aria-labelledby="profile-launches-title">
      <header className={styles.heading}>
        <h2 id="profile-launches-title">Launches{totalItems !== undefined
          ? <span className={styles.launchCount}> {totalItems}</span> : null}</h2>
        <div className={styles.headerActions}>
          {onRefresh || refreshInProgress ? <button
            className={styles.refresh}
            type="button"
            aria-busy={refreshInProgress}
            aria-label={refreshInProgress
              ? "Refreshing launches"
              : "Refresh launches"}
            data-loading={refreshInProgress}
            onClick={onRefresh}
            disabled={refreshInProgress}
          >
            <span className={styles.refreshIcon} aria-hidden="true">
              <RefreshCw size={15} strokeWidth={1.8} />
            </span>
            <span className={styles.refreshLabel}>
              {refreshInProgress ? "Refreshing…" : "Refresh"}
            </span>
          </button> : null}
        </div>
      </header>
      <span className={styles.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">
        {statusMessage ?? (refreshInProgress ? "Refreshing launches" : "")}
      </span>
      {children}
      {totalPages > 1 && onPageChange ? (
        <footer className={styles.paginationFooter}>
          <span className={styles.pageRange} role="status" aria-live="polite" aria-atomic="true">
            {totalItems !== undefined ? <><span className={styles.visuallyHidden}>Showing launches </span>
              {(currentPage - 1) * creatorProjectPageSize + 1}–{Math.min(currentPage * creatorProjectPageSize, totalItems)} of {totalItems}
              <span className={styles.visuallyHidden}>, page {currentPage} of {totalPages}</span>
            </> : <>Page {currentPage} of {totalPages}</>}
          </span>
          <nav className={styles.pagination} aria-label="Launches pages">
            <button
              type="button"
              aria-label="Previous launches page"
              disabled={currentPage === 1}
              aria-disabled={pageChangePending || undefined}
              onClick={() => { if (!pageChangePending) onPageChange(Math.max(1, currentPage - 1)); }}
            >
              <ChevronLeft aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
            <span aria-hidden="true">
              {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              aria-label="Next launches page"
              disabled={currentPage === totalPages}
              aria-disabled={pageChangePending || undefined}
              onClick={() => { if (!pageChangePending) onPageChange(Math.min(totalPages, currentPage + 1)); }}
            >
              <ChevronRight aria-hidden="true" size={17} strokeWidth={1.8} />
            </button>
          </nav>
        </footer>
      ) : null}
    </section>
  );
}

export function ProfileProjectsLoadingState() {
  return (
    <ProfileProjectsSection refreshInProgress>
      <ProfileProjectsSkeleton />
    </ProfileProjectsSection>
  );
}

export function ProfileProjectCard({
  project,
  phase,
  marketCapLabel,
  rewardReceiverAvailable,
  children,
}: Readonly<{
  project: CreatorProjectSummaryV1;
  phase: CreatorProjectOwnerStateV1["phase"];
  marketCapLabel?: string | null;
  rewardReceiverAvailable: boolean;
  children: ReactNode;
}>) {
  const launchType =
    project.source === "registry.custom-launched" ||
    project.source === "canonical-launch-stamp-router"
      ? "Custom"
      : "Classic";

  return (
    <article className={styles.project} data-reward-action={rewardReceiverAvailable ? "available" : "unavailable"}>
      <div className={styles.art}>
        {project.imageUrl ? (
          <Image src={project.imageUrl} alt="" fill sizes="64px" unoptimized />
        ) : <span aria-hidden="true">{project.symbol?.slice(0, 2) ?? "P"}</span>}
      </div>
      <div className={styles.copy}>
        <strong>{project.name}</strong>
        <span>
          {project.symbol ? `$${project.symbol}` : "Finalized launch"}
          <small className={styles.launchType}>{launchType}</small>
        </span>
        {marketCapLabel ? <small>Market cap {marketCapLabel}</small> : null}
        <small
          aria-hidden={project.article ? undefined : true}
          className={styles.articleSummarySlot}
          data-state={
            project.article
              ? "ready"
              : phase === "loading"
                ? "loading"
                : "empty"
          }
        >
          {project.article
            ? `Updated ${formatDate(project.article.updatedAt)}`
            : "Article details"}
        </small>
        {project.partnerAttribution ? (
          <PartnerLaunchAttribution attribution={project.partnerAttribution} compact />
        ) : null}
      </div>
      <div
        className={styles.actions}
        data-reward-action={rewardReceiverAvailable ? "available" : "unavailable"}
      >
        {children}
      </div>
    </article>
  );
}

function rewardReceiverActionBusyV1(
  state?: CreatorProjectRewardReceiverActionStateV1,
) {
  return (
    state?.status === "preparing" ||
    state?.status === "wallet" ||
    state?.status === "confirming"
  );
}

function rewardReceiverTriggerLabelV1(
  state?: CreatorProjectRewardReceiverActionStateV1,
) {
  if (rewardReceiverActionBusyV1(state)) return "Updating receiver…";
  if (state?.status === "pending" || state?.status === "not-found") {
    return "Check receiver status";
  }
  if (state?.status === "confirmed") return "Receiver updated";
  if (state?.status === "error") return "Retry receiver update";
  return "Change reward receiver";
}

function formatRewardShareV1(shareBps: number) {
  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(shareBps / 100)}%`;
}

function RewardReceiverDialog({
  actionState,
  onClose,
  onSubmit,
  project,
  reward,
}: Readonly<{
  actionState?: CreatorProjectRewardReceiverActionStateV1;
  onClose(): void;
  onSubmit(newReceiver: string, allocationIndex: number): void;
  project: CreatorProjectSummaryV1;
  reward: ClassicV3Reward;
}>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [allocationIndex, setAllocationIndex] = useState(
    reward.ownedAllocations[0]?.allocationIndex ?? 0,
  );
  const [newReceiver, setNewReceiver] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [complete, setComplete] = useState(false);
  const currentAllocation = reward.ownedAllocations.find(
    (allocation) => allocation.allocationIndex === allocationIndex,
  ) ?? reward.ownedAllocations[0];
  const currentReceiver = currentAllocation?.payoutAddress ?? reward.payoutAddress;
  const busy = rewardReceiverActionBusyV1(actionState);
  const checkingStatus =
    actionState?.status === "pending" || actionState?.status === "not-found";
  const titleId = `reward-receiver-${project.tokenAddress.slice(2)}-title`;
  const fieldId = `reward-receiver-${project.tokenAddress.slice(2)}-address`;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    inputRef.current?.focus({ preventScroll: true });
    return () => {
      window.document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  if (!complete && actionState?.status === "confirmed") {
    setComplete(true);
  }

  function submitReceiver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkingStatus) {
      onSubmit(currentReceiver, allocationIndex);
      return;
    }
    const error = rewardReceiverAddressErrorV1(
      newReceiver,
      currentReceiver,
    );
    setFieldError(error);
    if (error) {
      inputRef.current?.focus();
      return;
    }
    onSubmit(getAddress(newReceiver.trim()), allocationIndex);
  }

  if (typeof document === "undefined") return null;
  return createPortal((
    <dialog
      ref={dialogRef}
      className={styles.receiverBackdrop}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.receiverDialog}>
        <header className={styles.receiverHeader}>
          <div>
            <p>{project.symbol ? `$${project.symbol}` : "Classic launch"}</p>
            <h2 id={titleId}>Change reward receiver</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close reward receiver"
            onClick={onClose}
          >
            <X aria-hidden="true" size={18} strokeWidth={1.8} />
          </button>
        </header>

        <form className={styles.receiverForm} noValidate onSubmit={submitReceiver}>
          {reward.ownedAllocations.length > 1 ? (
            <label className={styles.receiverField}>
              <span>Reward allocation</span>
              <select
                value={allocationIndex}
                disabled={busy || complete}
                onChange={(event) => {
                  setAllocationIndex(Number(event.target.value));
                  setNewReceiver("");
                  setFieldError("");
                }}
              >
                {reward.ownedAllocations.map((allocation) => (
                  <option
                    key={allocation.allocationIndex}
                    value={allocation.allocationIndex}
                  >
                    {`Allocation ${allocation.allocationIndex + 1} · ${formatRewardShareV1(allocation.shareBps)}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className={styles.currentReceiver}>
            <span>Current receiver</span>
            <code>{currentReceiver}</code>
            <small>{formatRewardShareV1(currentAllocation?.shareBps ?? reward.shareBps)} of creator rewards</small>
          </div>

          <label className={styles.receiverField} htmlFor={fieldId}>
            <span>New reward receiver</span>
          </label>
          <input
            ref={inputRef}
            id={fieldId}
            name="reward-receiver"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="0x…"
            value={newReceiver}
            disabled={busy || checkingStatus || complete}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={`${hintId}${fieldError ? ` ${errorId}` : ""}`}
            onChange={(event) => {
              setNewReceiver(event.target.value);
              if (fieldError) setFieldError("");
            }}
          />
          <p id={hintId} className={styles.receiverHint}>
            Future creator fees for this allocation will go to the new address.
            Fees earned before confirmation stay with the current receiver.
          </p>
          {fieldError ? (
            <p id={errorId} className={styles.receiverError}>
              {fieldError}
            </p>
          ) : null}
          <p
            className={styles.receiverStatus}
            role={actionState?.status === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {complete
              ? "Reward receiver changed. Future creator fees now use the new address."
              : actionState?.message ?? ""}
          </p>

          <div className={styles.receiverActions}>
            <button type="button" onClick={onClose}>
              {complete ? "Done" : "Cancel"}
            </button>
            {!complete ? (
              <button
                className={styles.receiverSubmit}
                type="submit"
                aria-busy={busy || undefined}
                disabled={busy}
              >
                {busy
                  ? rewardReceiverTriggerLabelV1(actionState)
                  : checkingStatus
                    ? "Check status"
                    : actionState?.status === "error"
                      ? "Try again"
                      : "Change receiver"}
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </dialog>
  ), document.body);
}

export function ProfileProjectsSkeleton() {
  return <ProfileLaunchesSkeleton />;
}

function CreatorArticleEditorOpening({
  project,
  onClose,
}: Readonly<{ project: CreatorProjectSummaryV1; onClose(): void }>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = window.document.activeElement instanceof HTMLElement
      ? window.document.activeElement
      : null;
    const previousOverflow = window.document.body.style.overflow;
    window.document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      window.document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal((
    <dialog
      ref={dialogRef}
      className={styles.openingBackdrop}
      aria-labelledby="opening-creator-article-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={styles.openingDialog}
      >
        <div className={styles.openingIdentity}>
          <div className={styles.openingArt}>
            {project.imageUrl ? (
              <Image src={project.imageUrl} alt="" fill sizes="48px" unoptimized />
            ) : <span aria-hidden="true">{project.symbol?.slice(0, 2) ?? "P"}</span>}
          </div>
          <div>
            <p>{project.symbol ? `$${project.symbol}` : "Finalized project"}</p>
            <h2 id="opening-creator-article-title">Opening article…</h2>
          </div>
        </div>
        <span className={styles.openingProgress} aria-label="Loading" role="status" />
        <button ref={closeRef} type="button" aria-label="Cancel opening article" onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>
      </section>
    </dialog>
  ), document.body);
}

export function paginateCreatorProjectsV1(
  projects: readonly CreatorProjectSummaryV1[],
  marketCaps: readonly CreatorProjectMarketCapV1[],
  requestedPage: number,
) {
  const byToken = new Map(
    marketCaps.map((marketCap) => [marketCap.tokenAddress.toLowerCase(), marketCap]),
  );
  const source = projects.some((project) =>
    unsignedMarketCap(byToken.get(project.tokenAddress.toLowerCase())?.usdWad) !== null)
    ? "usdWad"
    : "ethWei";
  const ordered = [...projects].sort((first, second) => {
    const firstCap = unsignedMarketCap(
      byToken.get(first.tokenAddress.toLowerCase())?.[source],
    );
    const secondCap = unsignedMarketCap(
      byToken.get(second.tokenAddress.toLowerCase())?.[source],
    );
    if (firstCap !== null && secondCap !== null && firstCap !== secondCap) {
      return firstCap > secondCap ? -1 : 1;
    }
    if (firstCap !== null) return -1;
    if (secondCap !== null) return 1;
    const nameOrder = first.name.localeCompare(second.name);
    return nameOrder !== 0
      ? nameOrder
      : first.tokenAddress.toLowerCase().localeCompare(second.tokenAddress.toLowerCase());
  });
  const totalPages = Math.max(1, Math.ceil(ordered.length / creatorProjectPageSize));
  const currentPage = Math.min(
    totalPages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  );
  const offset = (currentPage - 1) * creatorProjectPageSize;
  return Object.freeze({
    currentPage,
    totalPages,
    items: Object.freeze(ordered.slice(offset, offset + creatorProjectPageSize)),
  });
}

export function mergeCreatorWalletProjectsV1(
  walletProjects: readonly CreatorProjectSummaryV1[],
  authenticatedProjects: readonly CreatorProjectSummaryV1[],
) {
  const byToken = new Map<string, CreatorProjectSummaryV1>();
  for (const project of walletProjects) {
    byToken.set(project.tokenAddress.toLowerCase(), project);
  }
  for (const project of authenticatedProjects) {
    byToken.set(project.tokenAddress.toLowerCase(), project);
  }
  return Object.freeze([...byToken.values()]);
}

function parseProjectList(value: unknown): readonly CreatorProjectSummaryV1[] {
  if (!isRecord(value)
    || value.schemaVersion !== "programmable.creator-project-list.v1"
    || !Array.isArray(value.projects)) throw new Error("Invalid project list");
  return value.projects.map((candidate) => {
    if (!isRecord(candidate)
      || candidate.chainId !== 1
      || typeof candidate.tokenAddress !== "string" || !isAddress(candidate.tokenAddress)
      || typeof candidate.name !== "string"
      || (candidate.symbol !== null && typeof candidate.symbol !== "string")
      || (candidate.imageUrl !== null && typeof candidate.imageUrl !== "string")
      || ![
        "envio-classic-v3",
        "registry.custom-launched",
        "canonical-launch-stamp-router",
        "official-main-token",
      ].includes(String(candidate.source))) {
      throw new Error("Invalid project record");
    }
    let article: CreatorProjectSummaryV1["article"] = null;
    if (candidate.article !== null) {
      if (!isRecord(candidate.article)
        || !Number.isSafeInteger(candidate.article.revision)
        || typeof candidate.article.title !== "string"
        || typeof candidate.article.updatedAt !== "string") throw new Error("Invalid article summary");
      article = {
        revision: Number(candidate.article.revision),
        title: candidate.article.title,
        updatedAt: candidate.article.updatedAt,
      };
    }
    const partnerAttribution = candidate.partnerAttribution === undefined
      ? undefined
      : parseLaunchPartnerAttributionV1(candidate.partnerAttribution);
    if (candidate.partnerAttribution !== undefined && !partnerAttribution) {
      throw new Error("Invalid project partner attribution");
    }
    return Object.freeze({
      chainId: 1 as const,
      tokenAddress: getAddress(candidate.tokenAddress),
      name: candidate.name,
      symbol: candidate.symbol as string | null,
      imageUrl: candidate.imageUrl as string | null,
      source: candidate.source as CreatorProjectSummaryV1["source"],
      ...(partnerAttribution ? { partnerAttribution } : {}),
      article,
    });
  });
}

function readError(value: unknown) {
  return isRecord(value) && typeof value.code === "string" && value.code
    ? `${value.code[0]?.toUpperCase() ?? ""}${value.code.slice(1).replaceAll("_", " ")}`
    : "Project request failed";
}

function unsignedMarketCap(value: string | null | undefined) {
  return value && /^(?:0|[1-9][0-9]*)$/u.test(value) && value.length <= 78
    ? BigInt(value)
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" })
    .format(new Date(value));
}
