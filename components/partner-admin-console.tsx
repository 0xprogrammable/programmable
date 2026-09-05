"use client";

import Link from "next/link";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  RefreshCw,
} from "lucide-react";

import { useWallet } from "@/components/wallet-provider";
import {
  PARTNER_ADMIN_LIST_LIMITS_V1,
  PARTNER_ADMIN_SCHEMA_V1,
  PARTNER_BUDGET_LIMITS_V1,
  displayPartnerKeyPrefix,
  parsePartnerListPageV1,
  parsePartnerMutationV1,
  parsePartnerRootKeyMutationV1,
  type PartnerRootKeyMutationV1,
  type PartnerRootKeySummaryV1,
  type PartnerSummaryV1,
  type PartnerListPaginationV1,
} from "@/lib/partner-admin-contract";
import {
  parseLaunchPartnerNameV1,
  parseLaunchPartnerWebsiteV1,
} from "@/lib/launch-partner-attribution";
import {
  PartnerAdminBrowserErrorV1,
  partnerAdminBrowserErrorV1,
} from "@/lib/partner-admin-browser-error";
import styles from "@/components/partner-admin-console.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type Confirmation = Readonly<{
  kind:
    | "suspend"
    | "activate"
    | "rotate"
    | "revoke-root"
    | "revoke-partner";
  partnerId: string;
  keyId?: string;
}> | null;
type SecretReveal = Readonly<{
  operation: "issued" | "rotated";
  mutation: PartnerRootKeyMutationV1;
}>;
type PartnerFormField =
  | "displayName"
  | "slug"
  | "publicUrl"
  | "prepareRequestsPerHour"
  | "readRequestsPerMinute"
  | "subkeyAdminRequestsPerHour";

const dateFormatter = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
});

const ROOT_KEYS_PER_PAGE = 5;
const PARTNER_FORM_ERROR_ID = "partner-form-error";
const EMPTY_PARTNER_PAGINATION = Object.freeze({
  page: 1,
  pageSize: PARTNER_ADMIN_LIST_LIMITS_V1.defaultPageSize,
  totalPartners: 0,
  totalPages: 0,
}) satisfies PartnerListPaginationV1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function formatDate(value: string | null, fallback = "Never") {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : dateFormatter.format(date);
}

function activeRootKey(key: PartnerRootKeySummaryV1) {
  return !key.revokedAt
    && Date.parse(key.expiresAt) > Date.now();
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function replacePartner(
  current: readonly PartnerSummaryV1[],
  partner: PartnerSummaryV1,
) {
  return current.some((candidate) => candidate.id === partner.id)
    ? current.map((candidate) => candidate.id === partner.id ? partner : candidate)
    : [partner, ...current];
}

function applyRootKeyMutation(
  current: readonly PartnerSummaryV1[],
  partnerId: string,
  mutation: PartnerRootKeyMutationV1,
) {
  if (mutation.partner) return replacePartner(current, mutation.partner);
  return current.map((partner) => partner.id !== partnerId
    ? partner
    : {
        ...partner,
        rootKeys: [
          mutation.rootKey,
          ...partner.rootKeys.filter((rootKey) => rootKey.id !== mutation.rootKey.id),
        ],
      });
}

function PartnerListSkeleton() {
  return (
    <div className={styles.skeletonList} aria-hidden="true">
      {[0, 1].map((item) => (
        <div className={styles.skeletonCard} key={item}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

export function PartnerAdminConsole() {
  const {
    authReady,
    authenticated,
    connecting,
    getAccessToken,
    getIdentityToken,
    openWallet,
    wallet,
  } = useWallet();
  const account = wallet?.account ?? null;
  const [partners, setPartners] = useState<PartnerSummaryV1[]>([]);
  const [partnerPagination, setPartnerPagination] =
    useState<PartnerListPaginationV1>(EMPTY_PARTNER_PAGINATION);
  const [rootKeyPages, setRootKeyPages] =
    useState<Record<string, number>>({});
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [accessDenied, setAccessDenied] =
    useState<PartnerAdminBrowserErrorV1 | null>(null);
  const [walletNotLinked, setWalletNotLinked] =
    useState<PartnerAdminBrowserErrorV1 | null>(null);
  const [pageError, setPageError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [prepareRequestsPerHour, setPrepareRequestsPerHour] = useState("100");
  const [readRequestsPerMinute, setReadRequestsPerMinute] = useState("60");
  const [subkeyAdminRequestsPerHour, setSubkeyAdminRequestsPerHour] = useState("20");
  const [formError, setFormError] = useState("");
  const [formErrorField, setFormErrorField] =
    useState<PartnerFormField | null>(null);
  const [keyExpiryDays, setKeyExpiryDays] = useState<Record<string, string>>({});
  const secretRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const slugRef = useRef<HTMLInputElement>(null);
  const publicUrlRef = useRef<HTMLInputElement>(null);
  const prepareRequestsRef = useRef<HTMLInputElement>(null);
  const readRequestsRef = useRef<HTMLInputElement>(null);
  const subkeyAdminRequestsRef = useRef<HTMLInputElement>(null);

  const clearFieldError = (field: PartnerFormField) => {
    if (formErrorField !== field) return;
    setFormError("");
    setFormErrorField(null);
  };

  const setFieldError = (field: PartnerFormField, message: string) => {
    const fieldRefs: Record<
      PartnerFormField,
      RefObject<HTMLInputElement | null>
    > = {
      displayName: nameRef,
      slug: slugRef,
      publicUrl: publicUrlRef,
      prepareRequestsPerHour: prepareRequestsRef,
      readRequestsPerMinute: readRequestsRef,
      subkeyAdminRequestsPerHour: subkeyAdminRequestsRef,
    };
    setFormError(message);
    setFormErrorField(field);
    window.requestAnimationFrame(() => fieldRefs[field].current?.focus());
  };

  const applyAuthorityError = useCallback((error: unknown) => {
    if (
      !(error instanceof PartnerAdminBrowserErrorV1)
      || (!error.accessDenied && !error.walletNotLinked)
    ) return false;
    setPartners([]);
    setPartnerPagination(EMPTY_PARTNER_PAGINATION);
    setConfirmation(null);
    setLoadState("error");
    if (error.walletNotLinked) {
      setWalletNotLinked(error);
      setAccessDenied(null);
    } else {
      setAccessDenied(error);
      setWalletNotLinked(null);
    }
    return true;
  }, []);

  const getAuthHeaders = useCallback(async (json = false) => {
    const identityToken = await getIdentityToken().catch(() => null);
    const accessToken = await getAccessToken();
    if (!accessToken) {
      throw new Error("Your wallet session expired. Reconnect and try again.");
    }
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    });
    if (identityToken) headers.set("X-Privy-Identity-Token", identityToken);
    if (json) headers.set("Content-Type", "application/json");
    return headers;
  }, [getAccessToken, getIdentityToken]);

  const loadPartners = useCallback(async (
    signal?: AbortSignal,
    requestedPage = 1,
  ) => {
    if (!account) return;
    setLoadState("loading");
    setPageError("");
    setAccessDenied(null);
    setWalletNotLinked(null);
    try {
      const query = new URLSearchParams({
        walletAddress: account,
        page: String(requestedPage),
        pageSize: String(PARTNER_ADMIN_LIST_LIMITS_V1.defaultPageSize),
      });
      const response = await fetch(
        `/api/admin/partners?${query.toString()}`,
        {
        cache: "no-store",
        headers: await getAuthHeaders(),
        signal,
        },
      );
      const body = await readJson(response);
      if (!response.ok) {
        throw partnerAdminBrowserErrorV1(
          response,
          body,
          "Unable to load partners.",
        );
      }
      const parsed = parsePartnerListPageV1(body);
      if (!parsed) throw new Error("The API returned an invalid partner list.");
      setPartners([...parsed.partners]);
      setPartnerPagination(parsed.pagination);
      setAccessDenied(null);
      setWalletNotLinked(null);
      setLoadState("ready");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (applyAuthorityError(error)) {
        setPageError("");
        return;
      }
      setPageError(error instanceof Error ? error.message : "Unable to load partners.");
      setLoadState("error");
    }
  }, [account, applyAuthorityError, getAuthHeaders]);

  useEffect(() => {
    if (!authReady || !account) return;
    const controller = new AbortController();
    queueMicrotask(() => void loadPartners(controller.signal, 1));
    return () => controller.abort();
  }, [account, authReady, loadPartners]);

  useEffect(() => {
    if (secretReveal) secretRef.current?.focus();
  }, [secretReveal]);

  const mutationHeaders = async () => {
    const headers = await getAuthHeaders(true);
    headers.set("Idempotency-Key", crypto.randomUUID());
    return headers;
  };

  const createPartner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || secretReveal) return;
    const name = displayName.trim();
    const partnerSlug = slug.trim();
    const website = publicUrl.trim();
    const prepareBudget = Number(prepareRequestsPerHour);
    const readBudget = Number(readRequestsPerMinute);
    const subkeyAdminBudget = Number(subkeyAdminRequestsPerHour);
    if (parseLaunchPartnerNameV1(name) === null) {
      setFieldError(
        "displayName",
        "Enter a public partner name with 96 characters or fewer.",
      );
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u.test(partnerSlug)) {
      setFieldError(
        "slug",
        "Use a stable lowercase ID with letters, numbers and single hyphens.",
      );
      return;
    }
    if (parseLaunchPartnerWebsiteV1(website) === null) {
      setFieldError(
        "publicUrl",
        "Enter a public HTTPS link without credentials, fragments or secret query parameters.",
      );
      return;
    }
    const budgetFields: Array<{
      field: PartnerFormField;
      value: number;
      maximum: number;
    }> = [
      {
        field: "prepareRequestsPerHour",
        value: prepareBudget,
        maximum: PARTNER_BUDGET_LIMITS_V1.prepareRequestsPerHour,
      },
      {
        field: "readRequestsPerMinute",
        value: readBudget,
        maximum: PARTNER_BUDGET_LIMITS_V1.readRequestsPerMinute,
      },
      {
        field: "subkeyAdminRequestsPerHour",
        value: subkeyAdminBudget,
        maximum: PARTNER_BUDGET_LIMITS_V1.subkeyAdminRequestsPerHour,
      },
    ];
    const invalidBudget = budgetFields.find(({ value, maximum }) =>
      !Number.isSafeInteger(value) || value < 1 || value > maximum,
    );
    if (invalidBudget) {
      setFieldError(
        invalidBudget.field,
        `Use a whole number from 1 to ${invalidBudget.maximum}.`,
      );
      return;
    }
    setBusy("create");
    setFormError("");
    setFormErrorField(null);
    try {
      const response = await fetch("/api/admin/partners", {
        method: "POST",
        headers: await mutationHeaders(),
        body: JSON.stringify({
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          walletAddress: account,
          slug: partnerSlug,
          displayName: name,
          publicUrl: website,
          rootKeyLabel: "Primary root key",
          budgets: {
            prepareRequestsPerHour: prepareBudget,
            readRequestsPerMinute: readBudget,
            subkeyAdminRequestsPerHour: subkeyAdminBudget,
          },
          expiresInDays: 366,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw partnerAdminBrowserErrorV1(
          response,
          body,
          "Unable to create the partner.",
        );
      }
      const mutation = parsePartnerRootKeyMutationV1(body);
      if (!mutation?.partner) throw new Error("The API returned an invalid partner.");
      const partner = mutation.partner;
      setPartners([partner]);
      setPartnerPagination((current) => {
        const totalPartners = mutation.secretState === "delivered-once"
          ? Math.min(current.totalPartners + 1, PARTNER_ADMIN_LIST_LIMITS_V1.maximumPartners)
          : current.totalPartners;
        return {
          page: 1,
          pageSize: current.pageSize,
          totalPartners,
          totalPages: Math.ceil(totalPartners / current.pageSize),
        };
      });
      setDisplayName("");
      setSlug("");
      setPublicUrl("");
      if (mutation.secretState === "delivered-once") {
        setSecretReveal({ operation: "issued", mutation });
        setStatusMessage(`${partner.displayName} was created. Save its root key now.`);
      } else {
        setStatusMessage(`${partner.displayName} already exists. Its secret cannot be shown again.`);
      }
      void loadPartners(undefined, 1);
    } catch (error) {
      if (applyAuthorityError(error)) {
        setFormError("");
        setFormErrorField(null);
        return;
      }
      setFormErrorField(null);
      setFormError(error instanceof Error ? error.message : "Unable to create the partner.");
    } finally {
      setBusy(null);
    }
  };

  const mutatePartner = async (
    path: string,
    init: RequestInit,
    busyKey: string,
    success: (partner: PartnerSummaryV1) => string,
  ) => {
    if (busy || secretReveal) return;
    setBusy(busyKey);
    setPageError("");
    try {
      const response = await fetch(path, {
        ...init,
        headers: init.method === "DELETE"
          ? await getAuthHeaders()
          : await mutationHeaders(),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw partnerAdminBrowserErrorV1(
          response,
          body,
          "Unable to update the partner.",
        );
      }
      const partner = parsePartnerMutationV1(body);
      if (!partner) throw new Error("The API returned an invalid partner update.");
      setPartners((current) => replacePartner(current, partner));
      setConfirmation(null);
      setStatusMessage(success(partner));
    } catch (error) {
      if (applyAuthorityError(error)) {
        setPageError("");
        return;
      }
      setPageError(error instanceof Error ? error.message : "Unable to update the partner.");
    } finally {
      setBusy(null);
    }
  };

  const setPartnerStatus = (partner: PartnerSummaryV1, status: "active" | "suspended") =>
    !account ? undefined :
    mutatePartner(
      `/api/admin/partners/${encodeURIComponent(partner.id)}/status`,
      {
        method: "POST",
        body: JSON.stringify({
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          walletAddress: account,
          status,
        }),
      },
      `status:${partner.id}`,
      (updated) => `${updated.displayName} is now ${updated.status}.`,
    );

  const revokePartner = (partner: PartnerSummaryV1) =>
    !account ? undefined :
    mutatePartner(
      `/api/admin/partners/${encodeURIComponent(partner.id)}?walletAddress=${
        encodeURIComponent(account)
      }`,
      { method: "DELETE" },
      `revoke-partner:${partner.id}`,
      (updated) => `${updated.displayName} was permanently revoked.`,
    );

  const rootKeyMutation = async (
    partner: PartnerSummaryV1,
    operation: "issue" | "rotate",
    key?: PartnerRootKeySummaryV1,
  ) => {
    if (busy || secretReveal || !account) return;
    const expiry = Number(keyExpiryDays[partner.id] ?? "366");
    if (!Number.isSafeInteger(expiry) || expiry < 1 || expiry > 366) {
      setPageError("Use a root-key lifetime between 1 and 366 days.");
      return;
    }
    const path = operation === "issue"
      ? `/api/admin/partners/${encodeURIComponent(partner.id)}/root-keys`
      : `/api/admin/partners/${encodeURIComponent(partner.id)}/root-keys/${
          encodeURIComponent(key!.id)
        }/rotate`;
    setBusy(`${operation}:${partner.id}`);
    setPageError("");
    setCopyState("idle");
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: await mutationHeaders(),
        body: JSON.stringify({
          schemaVersion: PARTNER_ADMIN_SCHEMA_V1,
          walletAddress: account,
          label: key?.label ?? "Primary root key",
          budgets: key?.budgets ?? {
            prepareRequestsPerHour: 100,
            readRequestsPerMinute: 60,
            subkeyAdminRequestsPerHour: 20,
          },
          expiresInDays: expiry,
        }),
      });
      const body = await readJson(response);
      if (!response.ok) {
        throw partnerAdminBrowserErrorV1(
          response,
          body,
          `Unable to ${operation} the root key.`,
        );
      }
      const mutation = parsePartnerRootKeyMutationV1(body);
      if (!mutation) throw new Error("The API returned an invalid root-key result.");
      setPartners((current) =>
        applyRootKeyMutation(current, partner.id, mutation));
      setConfirmation(null);
      if (mutation.secretState === "delivered-once") {
        setSecretReveal({
          operation: operation === "issue" ? "issued" : "rotated",
          mutation,
        });
        setStatusMessage("The root-key secret is visible once. Save it now.");
      } else {
        setStatusMessage("The root-key operation already completed. Its secret cannot be shown again.");
      }
      setRootKeyPages((current) => ({ ...current, [partner.id]: 1 }));
      void loadPartners(undefined, partnerPagination.page);
    } catch (error) {
      if (applyAuthorityError(error)) {
        setPageError("");
        return;
      }
      setPageError(error instanceof Error ? error.message : `Unable to ${operation} the root key.`);
    } finally {
      setBusy(null);
    }
  };

  const revokeRootKey = async (
    partner: PartnerSummaryV1,
    key: PartnerRootKeySummaryV1,
  ) => {
    if (busy || secretReveal || !account) return;
    setBusy(`revoke:${key.id}`);
    setPageError("");
    try {
      const response = await fetch(
        `/api/admin/partners/${encodeURIComponent(partner.id)}/root-keys/${
          encodeURIComponent(key.id)
        }?walletAddress=${encodeURIComponent(account)}`,
        { method: "DELETE", headers: await getAuthHeaders() },
      );
      const body = await readJson(response);
      if (!response.ok) {
        throw partnerAdminBrowserErrorV1(
          response,
          body,
          "Unable to revoke the root key.",
        );
      }
      if (
        !isRecord(body)
        || body.schemaVersion !== PARTNER_ADMIN_SCHEMA_V1
        || body.rootKeyId !== key.id
        || (body.disposition !== "revoked" && body.disposition !== "already_revoked")
      ) throw new Error("The API returned an invalid revocation result.");
      setConfirmation(null);
      setStatusMessage(`${partner.displayName} root key was revoked.`);
      await loadPartners(undefined, partnerPagination.page);
    } catch (error) {
      if (applyAuthorityError(error)) {
        setPageError("");
        return;
      }
      setPageError(error instanceof Error ? error.message : "Unable to revoke the root key.");
    } finally {
      setBusy(null);
    }
  };

  const copySecret = async () => {
    const secret = secretReveal?.mutation.rootKeySecret;
    if (!secret) return;
    try {
      await copyText(secret);
      setCopyState("copied");
      setStatusMessage("Root key copied.");
    } catch {
      setCopyState("error");
      setStatusMessage("Copy failed. Select the key and copy it manually.");
    }
  };

  const dismissSecret = () => {
    setSecretReveal(null);
    setCopyState("idle");
    setStatusMessage("Root-key secret hidden.");
  };

  const partnerRangeStart = partnerPagination.totalPartners === 0
    ? 0
    : ((partnerPagination.page - 1) * partnerPagination.pageSize) + 1;
  const partnerRangeEnd = partnerPagination.totalPartners === 0
    ? 0
    : Math.min(
        partnerPagination.page * partnerPagination.pageSize,
        partnerPagination.totalPartners,
      );

  const changePartnerPage = (page: number) => {
    if (
      busy
      || loadState === "loading"
      || page < 1
      || page > partnerPagination.totalPages
    ) return;
    void loadPartners(undefined, page);
  };

  return (
    <div className={`${styles.page} page-width`}>
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {statusMessage}
      </p>
      <header className={styles.hero}>
        <div>
          <p className={styles.kicker}>Admin · <Link href="/admin/modules">Module review</Link></p>
          <h1>Partner access</h1>
          <p>
            Give a partner its own launch infrastructure without sharing a
            Programmable admin credential. Attribution is derived by the server
            from the authenticated partner key and cannot be supplied by a launch.
          </p>
        </div>
        <aside>
          <strong>Wallet boundary stays separate</strong>
          <span>
            Root keys manage partner subkeys. They cannot sign or broadcast the
            end user&apos;s launch transaction.
          </span>
        </aside>
      </header>

      {!authReady ? (
        <section className={styles.statePanel} aria-busy="true">
          <span className={styles.spinner} aria-hidden="true" />
          <h2>Checking admin session</h2>
        </section>
      ) : !account ? (
        <section className={styles.statePanel}>
          <h2>{authenticated ? "Link an admin wallet" : "Connect the admin wallet"}</h2>
          <p>
            {authenticated
              ? "Link or select an Ethereum wallet before checking partner access."
              : "The backend verifies admin access after the wallet session is connected."}
          </p>
          <button type="button" disabled={connecting} onClick={openWallet}>
            {connecting
              ? "Connecting wallet"
              : authenticated
                ? "Manage wallets"
                : "Connect wallet"}
          </button>
        </section>
      ) : walletNotLinked ? (
        <section className={styles.statePanel} data-state="wallet-not-linked">
          <p className={styles.kicker}>Wallet setup</p>
          <h2>Link this wallet to continue</h2>
          <p>
            This wallet is connected but not linked to your Programmable
            sign-in. Link it or select another linked wallet.
          </p>
          {walletNotLinked.requestId ? (
            <p className={styles.requestId}>
              <span>Request ID</span>
              <code>{walletNotLinked.requestId}</code>
            </p>
          ) : null}
          <button type="button" onClick={openWallet}>Manage wallets</button>
        </section>
      ) : accessDenied ? (
        <section className={styles.statePanel} data-state="access-denied">
          <p className={styles.kicker}>Access denied</p>
          <h2>This wallet cannot manage partners</h2>
          <p>
            Your wallet session is valid, but partner administration access is
            controlled by the server. If you expected access, send the Request
            ID below to the Programmable team.
          </p>
          {accessDenied.requestId ? (
            <p className={styles.requestId}>
              <span>Request ID</span>
              <code>{accessDenied.requestId}</code>
            </p>
          ) : null}
          <button
            type="button"
            disabled={loadState === "loading"}
            onClick={() => void loadPartners()}
          >
            {loadState === "loading" ? "Checking access" : "Check again"}
          </button>
        </section>
      ) : loadState !== "ready" && partners.length === 0 ? (
        <section
          className={styles.statePanel}
          data-state="access-check"
          aria-busy={loadState === "idle" || loadState === "loading"}
        >
          {loadState === "error" ? null : (
            <span className={styles.spinner} aria-hidden="true" />
          )}
          <h2>
            {loadState === "error"
              ? "Partner access is unavailable"
              : "Checking partner access"}
          </h2>
          <p>
            {loadState === "error"
              ? pageError || "The server could not verify partner administration access."
              : "The server is verifying this wallet before showing administration controls."}
          </p>
          {loadState === "error" ? (
            <button type="button" onClick={() => void loadPartners()}>
              Try again
            </button>
          ) : null}
        </section>
      ) : (
        <>
          {secretReveal ? (
            <section
              ref={secretRef}
              className={styles.secretReveal}
              tabIndex={-1}
              aria-labelledby="partner-root-secret-title"
            >
              <div className={styles.secretHeading}>
                <div>
                  <p className={styles.kicker}>
                    {secretReveal.operation === "rotated" ? "Rotated" : "Issued"}
                  </p>
                  <h2 id="partner-root-secret-title">Save this root key now</h2>
                </div>
                <span>Shown once</span>
              </div>
              <p>
                Copy the secret into the partner&apos;s encrypted secret manager.
                It will not appear in this dashboard again. Never send it in chat,
                a prompt, source code or command history.
              </p>
              <div className={styles.secretValue}>
                <code>{secretReveal.mutation.rootKeySecret}</code>
                <button type="button" onClick={() => void copySecret()}>
                  {copyState === "copied" ? (
                    <><Check aria-hidden="true" size={16} /> Copied</>
                  ) : (
                    <><Copy aria-hidden="true" size={16} /> Copy root key</>
                  )}
                </button>
              </div>
              {copyState === "error" ? (
                <p className={styles.error} role="alert">
                  Copy failed. Select the key and copy it manually.
                </p>
              ) : null}
              <button className={styles.dismissButton} type="button" onClick={dismissSecret}>
                I saved this root key
              </button>
            </section>
          ) : null}

          <div className={styles.workspace}>
            <section className={styles.createPanel} aria-labelledby="create-partner-title">
              <p className={styles.kicker}>New partner</p>
              <h2 id="create-partner-title">Create partner</h2>
              <p>
                The public name and website are snapshotted into launches made
                through the first root key, which is shown once after creation.
              </p>
              <form onSubmit={createPartner} noValidate>
                <label>
                  <span>Public partner name</span>
                  <input
                    ref={nameRef}
                    name="displayName"
                    autoComplete="organization"
                    aria-describedby={
                      formErrorField === "displayName"
                        ? PARTNER_FORM_ERROR_ID
                        : undefined
                    }
                    aria-invalid={
                      formErrorField === "displayName" ? true : undefined
                    }
                    maxLength={96}
                    placeholder="Partner Studio"
                    value={displayName}
                    onChange={(event) => {
                      setDisplayName(event.target.value);
                      clearFieldError("displayName");
                    }}
                  />
                </label>
                <label>
                  <span>Stable partner ID</span>
                  <input
                    ref={slugRef}
                    name="slug"
                    autoCapitalize="none"
                    autoComplete="off"
                    aria-describedby={
                      formErrorField === "slug"
                        ? PARTNER_FORM_ERROR_ID
                        : undefined
                    }
                    aria-invalid={formErrorField === "slug" ? true : undefined}
                    maxLength={64}
                    pattern="[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?"
                    placeholder="partner-studio"
                    spellCheck={false}
                    value={slug}
                    onChange={(event) => {
                      setSlug(event.target.value);
                      clearFieldError("slug");
                    }}
                  />
                </label>
                <label>
                  <span>Public attribution link</span>
                  <input
                    ref={publicUrlRef}
                    name="publicUrl"
                    autoComplete="url"
                    aria-describedby={
                      formErrorField === "publicUrl"
                        ? PARTNER_FORM_ERROR_ID
                        : undefined
                    }
                    aria-invalid={
                      formErrorField === "publicUrl" ? true : undefined
                    }
                    inputMode="url"
                    placeholder="https://partner.example/"
                    value={publicUrl}
                    onChange={(event) => {
                      setPublicUrl(event.target.value);
                      clearFieldError("publicUrl");
                    }}
                  />
                </label>
                <fieldset>
                  <legend>Root-key budgets</legend>
                  <label>
                    <span>Create / hour</span>
                    <input
                      ref={prepareRequestsRef}
                      aria-describedby={
                        formErrorField === "prepareRequestsPerHour"
                          ? PARTNER_FORM_ERROR_ID
                          : undefined
                      }
                      aria-invalid={
                        formErrorField === "prepareRequestsPerHour"
                          ? true
                          : undefined
                      }
                      min="1"
                      max={PARTNER_BUDGET_LIMITS_V1.prepareRequestsPerHour}
                      inputMode="numeric"
                      type="number"
                      value={prepareRequestsPerHour}
                      onChange={(event) => {
                        setPrepareRequestsPerHour(event.target.value);
                        clearFieldError("prepareRequestsPerHour");
                      }}
                    />
                  </label>
                  <label>
                    <span>Reads / minute</span>
                    <input
                      ref={readRequestsRef}
                      aria-describedby={
                        formErrorField === "readRequestsPerMinute"
                          ? PARTNER_FORM_ERROR_ID
                          : undefined
                      }
                      aria-invalid={
                        formErrorField === "readRequestsPerMinute"
                          ? true
                          : undefined
                      }
                      min="1"
                      max={PARTNER_BUDGET_LIMITS_V1.readRequestsPerMinute}
                      inputMode="numeric"
                      type="number"
                      value={readRequestsPerMinute}
                      onChange={(event) => {
                        setReadRequestsPerMinute(event.target.value);
                        clearFieldError("readRequestsPerMinute");
                      }}
                    />
                  </label>
                  <label>
                    <span>Subkey admin / hour</span>
                    <input
                      ref={subkeyAdminRequestsRef}
                      aria-describedby={
                        formErrorField === "subkeyAdminRequestsPerHour"
                          ? PARTNER_FORM_ERROR_ID
                          : undefined
                      }
                      aria-invalid={
                        formErrorField === "subkeyAdminRequestsPerHour"
                          ? true
                          : undefined
                      }
                      min="1"
                      max={PARTNER_BUDGET_LIMITS_V1.subkeyAdminRequestsPerHour}
                      inputMode="numeric"
                      type="number"
                      value={subkeyAdminRequestsPerHour}
                      onChange={(event) => {
                        setSubkeyAdminRequestsPerHour(event.target.value);
                        clearFieldError("subkeyAdminRequestsPerHour");
                      }}
                    />
                  </label>
                </fieldset>
                {formError ? (
                  <p
                    className={styles.error}
                    id={PARTNER_FORM_ERROR_ID}
                    role={formErrorField ? undefined : "alert"}
                  >
                    {formError}
                  </p>
                ) : null}
                <button className={styles.primaryButton} disabled={busy !== null || Boolean(secretReveal)} type="submit">
                  {busy === "create" ? "Creating partner" : "Create partner"}
                </button>
              </form>
            </section>

            <section className={styles.directory} aria-labelledby="partner-directory-title" aria-busy={loadState === "loading" || busy !== null}>
              <div className={styles.directoryHeading}>
                <div>
                  <p className={styles.kicker}>Access directory</p>
                  <h2 id="partner-directory-title">Partners</h2>
                  {partnerPagination.totalPartners > 0 ? (
                    <p className={styles.directoryCount}>
                      Showing {partnerRangeStart}–{partnerRangeEnd} of{
                        ` ${partnerPagination.totalPartners.toLocaleString("en")}`
                      }
                    </p>
                  ) : null}
                </div>
                <button className={styles.refreshButton} disabled={loadState === "loading" || busy !== null} type="button" onClick={() => void loadPartners(undefined, partnerPagination.page)}>
                  <RefreshCw aria-hidden="true" size={16} data-spinning={loadState === "loading" ? "true" : "false"} />
                  Refresh
                </button>
              </div>
              {pageError ? <p className={styles.error} role="alert">{pageError}</p> : null}
              {loadState === "loading" && partners.length === 0 ? <PartnerListSkeleton /> : null}
              {loadState === "error" && partners.length === 0 ? (
                <div className={styles.emptyState}>
                  <h3>Partner access is unavailable</h3>
                  <p>Check the admin session or try the request again.</p>
                  <button type="button" onClick={() => void loadPartners(undefined, partnerPagination.page)}>Try again</button>
                </div>
              ) : null}
              {loadState === "ready" && partners.length === 0 ? (
                <div className={styles.emptyState}>
                  <h3>No partners yet</h3>
                  <p>Create a partner and save the one-time root key.</p>
                </div>
              ) : null}
              {partners.length > 0 ? (
                <ul className={styles.partnerList}>
                  {partners.map((partner) => {
                    const liveKeys = partner.rootKeys.filter(activeRootKey);
                    const expiry = keyExpiryDays[partner.id] ?? "366";
                    const rootKeyPageCount = Math.max(
                      1,
                      Math.ceil(partner.rootKeys.length / ROOT_KEYS_PER_PAGE),
                    );
                    const rootKeyPage = Math.min(
                      rootKeyPages[partner.id] ?? 1,
                      rootKeyPageCount,
                    );
                    const rootKeyPageStart =
                      (rootKeyPage - 1) * ROOT_KEYS_PER_PAGE;
                    const visibleRootKeys = partner.rootKeys.slice(
                      rootKeyPageStart,
                      rootKeyPageStart + ROOT_KEYS_PER_PAGE,
                    );
                    return (
                      <li className={styles.partnerCard} key={partner.id}>
                        <div className={styles.partnerTopline}>
                          <div>
                            <h3>{partner.displayName}</h3>
                            {partner.publicUrl ? (
                              <a href={partner.publicUrl} rel="noreferrer" target="_blank">
                                {new URL(partner.publicUrl).hostname.replace(/^www\./u, "")}
                                <ExternalLink aria-hidden="true" size={13} />
                                <span className={styles.visuallyHidden}>, opens in a new tab</span>
                              </a>
                            ) : <span className={styles.missingWebsite}>No public website</span>}
                          </div>
                          <span className={styles.partnerStatus} data-status={partner.status}>
                            {partner.status === "active"
                              ? "Active"
                              : partner.status === "suspended" ? "Suspended" : "Revoked"}
                          </span>
                        </div>
                        <dl className={styles.quotaGrid}>
                          <div><dt>Partner ID</dt><dd>{partner.slug}</dd></div>
                          <div><dt>Root keys</dt><dd>{partner.rootKeys.length.toLocaleString("en")}</dd></div>
                          <div><dt>Created</dt><dd>{formatDate(partner.createdAt)}</dd></div>
                          <div><dt>Updated</dt><dd>{formatDate(partner.updatedAt)}</dd></div>
                        </dl>
                        <div className={styles.keyHeading}>
                          <div>
                            <h4>Root keys</h4>
                            <span>{liveKeys.length} active</span>
                          </div>
                          <label>
                            <span>New key lifetime</span>
                            <select value={expiry} onChange={(event) => setKeyExpiryDays((current) => ({ ...current, [partner.id]: event.target.value }))}>
                              <option value="30">30 days</option>
                              <option value="90">90 days</option>
                              <option value="180">180 days</option>
                              <option value="366">366 days</option>
                            </select>
                          </label>
                        </div>
                        {partner.rootKeys.length === 0 ? (
                          <p className={styles.noKeys}>No root key has been issued.</p>
                        ) : (
                          <ul className={styles.keyList}>
                            {visibleRootKeys.map((key) => (
                              <li key={key.id}>
                                <div className={styles.keyIdentity}>
                                  <div><strong>{key.label}</strong><code>{displayPartnerKeyPrefix(key.keyPrefix)}</code></div>
                                  <span data-active={activeRootKey(key) ? "true" : "false"}>{activeRootKey(key) ? "Active" : key.revokedAt ? "Revoked" : "Expired"}</span>
                                </div>
                                <dl>
                                  <div><dt>Create / hour</dt><dd>{key.budgets.prepareRequestsPerHour.toLocaleString("en")}</dd></div>
                                  <div><dt>Reads / minute</dt><dd>{key.budgets.readRequestsPerMinute.toLocaleString("en")}</dd></div>
                                  <div><dt>Subkey admin / hour</dt><dd>{key.budgets.subkeyAdminRequestsPerHour.toLocaleString("en")}</dd></div>
                                  <div><dt>Expires</dt><dd>{formatDate(key.expiresAt)}</dd></div>
                                  <div><dt>Last used</dt><dd>{formatDate(key.lastUsedAt)}</dd></div>
                                </dl>
                                <details className={styles.scopes}>
                                  <summary>Scopes · {key.scopes.length}</summary>
                                  <ul>{key.scopes.map((scope) => <li key={scope}><code>{scope}</code></li>)}</ul>
                                </details>
                                {confirmation?.partnerId === partner.id && confirmation.keyId === key.id ? (
                                  <div className={styles.confirmation} role="group" aria-label={`${confirmation.kind} ${key.label}`}>
                                    <p>{confirmation.kind === "rotate" ? "Rotate this key? The current secret stops working immediately." : "Revoke this key? Every partner service using it stops immediately."}</p>
                                    <div>
                                      <button type="button" onClick={() => setConfirmation(null)}>Cancel</button>
                                      <button className={styles.dangerButton} disabled={busy !== null} type="button" onClick={() => confirmation.kind === "rotate" ? void rootKeyMutation(partner, "rotate", key) : void revokeRootKey(partner, key)}>
                                        {confirmation.kind === "rotate" ? "Rotate root key" : "Revoke root key"}
                                      </button>
                                    </div>
                                  </div>
                                ) : activeRootKey(key) ? (
                                  <div className={styles.keyActions}>
                                    <button type="button" disabled={busy !== null || Boolean(secretReveal)} onClick={() => setConfirmation({ kind: "rotate", partnerId: partner.id, keyId: key.id })}>Rotate</button>
                                    <button type="button" disabled={busy !== null || Boolean(secretReveal)} onClick={() => setConfirmation({ kind: "revoke-root", partnerId: partner.id, keyId: key.id })}>Revoke</button>
                                  </div>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                        {partner.rootKeys.length > ROOT_KEYS_PER_PAGE ? (
                          <nav className={styles.keyPagination} aria-label={`${partner.displayName} root-key pages`}>
                            <span>
                              {rootKeyPageStart + 1}–{Math.min(
                                rootKeyPageStart + ROOT_KEYS_PER_PAGE,
                                partner.rootKeys.length,
                              )} of {partner.rootKeys.length.toLocaleString("en")}
                            </span>
                            <div>
                              <button
                                type="button"
                                aria-label={`Previous ${partner.displayName} root-key page`}
                                disabled={busy !== null || rootKeyPage === 1}
                                onClick={() => setRootKeyPages((current) => ({
                                  ...current,
                                  [partner.id]: Math.max(1, rootKeyPage - 1),
                                }))}
                              >
                                <ChevronLeft aria-hidden="true" size={15} />
                                Previous
                              </button>
                              <button
                                type="button"
                                aria-label={`Next ${partner.displayName} root-key page`}
                                disabled={busy !== null || rootKeyPage === rootKeyPageCount}
                                onClick={() => setRootKeyPages((current) => ({
                                  ...current,
                                  [partner.id]: Math.min(
                                    rootKeyPageCount,
                                    rootKeyPage + 1,
                                  ),
                                }))}
                              >
                                Next
                                <ChevronRight aria-hidden="true" size={15} />
                              </button>
                            </div>
                          </nav>
                        ) : null}
                        <div className={styles.partnerActions}>
                          <button type="button" disabled={busy !== null || Boolean(secretReveal) || partner.status !== "active"} onClick={() => void rootKeyMutation(partner, "issue")}>Issue root key</button>
                          {partner.status !== "revoked" ? (
                            <>
                              <button type="button" disabled={busy !== null || Boolean(secretReveal)} onClick={() => setConfirmation({ kind: partner.status === "active" ? "suspend" : "activate", partnerId: partner.id })}>{partner.status === "active" ? "Suspend partner" : "Reactivate partner"}</button>
                              <button className={styles.dangerButton} type="button" disabled={busy !== null || Boolean(secretReveal)} onClick={() => setConfirmation({ kind: "revoke-partner", partnerId: partner.id })}>Revoke permanently</button>
                            </>
                          ) : null}
                        </div>
                        {confirmation?.partnerId === partner.id && !confirmation.keyId ? (
                          <div className={styles.confirmation} role="group" aria-label={`${confirmation.kind} ${partner.displayName}`}>
                            <p>
                              {confirmation.kind === "suspend"
                                ? "Suspend this partner? Its root keys and subkeys stop authorizing launches and reads."
                                : confirmation.kind === "activate"
                                  ? "Reactivate this partner? Existing unexpired keys can authorize launches and reads again."
                                  : `Permanently revoke ${partner.displayName}? Every root key and subkey stops working immediately. This cannot be undone.`}
                            </p>
                            <div>
                              <button type="button" onClick={() => setConfirmation(null)}>Cancel</button>
                              <button
                                className={confirmation.kind === "activate" ? styles.primaryButton : styles.dangerButton}
                                disabled={busy !== null}
                                type="button"
                                onClick={() => confirmation.kind === "revoke-partner"
                                  ? void revokePartner(partner)
                                  : void setPartnerStatus(
                                      partner,
                                      confirmation.kind === "suspend"
                                        ? "suspended"
                                        : "active",
                                    )}
                              >
                                {confirmation.kind === "suspend"
                                  ? "Suspend partner"
                                  : confirmation.kind === "activate"
                                    ? "Reactivate partner"
                                    : busy === `revoke-partner:${partner.id}`
                                      ? "Revoking partner"
                                      : "Permanently revoke"}
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              {partnerPagination.totalPages > 1 ? (
                <nav className={styles.partnerPagination} aria-label="Partner pages">
                  <span>
                    Page {partnerPagination.page} of {partnerPagination.totalPages}
                  </span>
                  <div>
                    <button
                      type="button"
                      disabled={
                        loadState === "loading"
                        || busy !== null
                        || partnerPagination.page === 1
                      }
                      onClick={() => changePartnerPage(partnerPagination.page - 1)}
                    >
                      <ChevronLeft aria-hidden="true" size={15} />
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={
                        loadState === "loading"
                        || busy !== null
                        || partnerPagination.page === partnerPagination.totalPages
                      }
                      onClick={() => changePartnerPage(partnerPagination.page + 1)}
                    >
                      Next
                      <ChevronRight aria-hidden="true" size={15} />
                    </button>
                  </div>
                </nav>
              ) : null}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
