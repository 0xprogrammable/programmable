"use client";

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Check, FileJson, RefreshCw, Trash2 } from "lucide-react";

import sharedStyles from "@/components/developer-api-keys.module.css";
import styles from "@/components/developer-robinhood-launch.module.css";

export const ROBINHOOD_PREFLIGHT_URL =
  "https://api.programmable.market/v4/chains/4663/custom-launches/preflight";
export const ROBINHOOD_CREATE_URL =
  "https://api.programmable.market/v4/chains/4663/custom-launches";
export const MAX_ROBINHOOD_LAUNCH_BYTES = 16 * 1024 * 1024;

const apiKeyPattern =
  /^pm_(?:live|partner|partner_root)_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const launchIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const dispositions = new Set([
  "supported",
  "supported_with_warnings",
  "needs_evidence",
  "unsupported",
  "system_blocked",
]);

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type PackedLaunch = Readonly<{
  bytes: ArrayBuffer;
  fileName: string;
}>;

export type RobinhoodPreflightProof = Readonly<{
  deployable: boolean;
  disposition: string;
  hardBlockFindingCodes: readonly string[];
  needsEvidenceFindingCodes: readonly string[];
  rawRequestSha256: string;
  requestBytes: ArrayBuffer;
  requestHash: string;
  warningFindingCodes: readonly string[];
}>;

export type RobinhoodLaunchCreated = Readonly<{
  launchId: string;
  requestId: string;
  status: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): readonly string[] | null {
  return Array.isArray(value)
    && value.every((candidate) => typeof candidate === "string")
    ? value
    : null;
}

function parsePreflight(
  value: unknown,
  requestBytes: ArrayBuffer,
): RobinhoodPreflightProof | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== "programmable.custom-launch-preflight.v2"
    || value.apiVersion !== "v4"
    || value.chainId !== "4663"
    || value.caip2 !== "eip155:4663"
    || typeof value.disposition !== "string"
    || !dispositions.has(value.disposition)
    || typeof value.requestHash !== "string"
    || !sha256Pattern.test(value.requestHash)
    || typeof value.rawRequestSha256 !== "string"
    || !sha256Pattern.test(value.rawRequestSha256)
    || !isRecord(value.launchEligibility)
    || typeof value.launchEligibility.deployable !== "boolean"
    || value.quotaConsumed !== false
    || value.nonceAllocated !== false
    || value.persisted !== false
    || value.walletSignatureRequiredLater !== true
    || value.walletBroadcastByService !== false
  ) return null;

  const hardBlockFindingCodes = stringArray(value.hardBlockFindingCodes);
  const needsEvidenceFindingCodes = stringArray(
    value.needsEvidenceFindingCodes,
  );
  const warningFindingCodes = stringArray(value.warningFindingCodes);
  if (
    !hardBlockFindingCodes
    || !needsEvidenceFindingCodes
    || !warningFindingCodes
  ) return null;

  return Object.freeze({
    deployable: value.launchEligibility.deployable,
    disposition: value.disposition,
    hardBlockFindingCodes,
    needsEvidenceFindingCodes,
    rawRequestSha256: value.rawRequestSha256,
    requestBytes,
    requestHash: value.requestHash,
    warningFindingCodes,
  });
}

function parseCreated(value: unknown): RobinhoodLaunchCreated | null {
  if (
    !isRecord(value)
    || value.schemaVersion !== "programmable.custom-launch.v4"
    || value.apiVersion !== "v4"
    || value.chainId !== "4663"
    || value.caip2 !== "eip155:4663"
    || value.routeId !== "custom-launch:create:v4"
    || typeof value.launchId !== "string"
    || !launchIdPattern.test(value.launchId)
    || typeof value.requestId !== "string"
    || !launchIdPattern.test(value.requestId)
    || typeof value.status !== "string"
    || value.status.length === 0
  ) return null;

  return Object.freeze({
    launchId: value.launchId,
    requestId: value.requestId,
    status: value.status,
  });
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function apiError(
  response: Response,
  value: unknown,
  fallback: string,
) {
  if (!isRecord(value) || !isRecord(value.error)) return fallback;
  const message = typeof value.error.message === "string"
    && value.error.message.trim().length > 0
    ? value.error.message.trim()
    : fallback;
  const requestId = typeof value.error.requestId === "string"
    && launchIdPattern.test(value.error.requestId)
    ? ` Request ID: ${value.error.requestId}.`
    : "";
  const retryAfter = response.headers.get("retry-after");
  const retry = retryAfter && /^[1-9][0-9]{0,4}$/u.test(retryAfter)
    ? ` Try again in ${retryAfter} seconds.`
    : "";
  return `${message}${retry}${requestId}`;
}

function requestHeaders(apiKey: string) {
  return new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  });
}

function directRequestInit(
  apiKey: string,
  requestBytes: ArrayBuffer,
  signal?: AbortSignal,
): RequestInit {
  return {
    body: requestBytes,
    cache: "no-store",
    credentials: "omit",
    headers: requestHeaders(apiKey),
    method: "POST",
    mode: "cors",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  };
}

export function isRobinhoodApiKey(value: string) {
  return apiKeyPattern.test(value);
}

export function isRobinhoodIdempotencyKey(value: string) {
  return idempotencyKeyPattern.test(value);
}

export function RobinhoodFeePolicyDisclosure() {
  return (
    <details
      className={styles.policyDisclosure}
      aria-labelledby="robinhood-fee-policy-title"
    >
      <summary>
        <span id="robinhood-fee-policy-title">Robinhood fee policy</span>
        <span>0.20%</span>
      </summary>
      <p>
        Programmable policy for new Robinhood V4 API Custom launch requests is
        0.20% (2,000 ppm), recipient{" "}
        <code>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code>. Existing
        launches are unchanged.
      </p>
      <p>
        The current V4 runtime does not claim immutable onchain fee
        enforcement, fee behavior, claiming, or guaranteed revenue. The
        Launch Stamp proves provenance only.
      </p>
    </details>
  );
}

export async function preflightRobinhoodLaunch(
  fetcher: Fetcher,
  apiKey: string,
  requestBytes: ArrayBuffer,
  signal?: AbortSignal,
) {
  if (!isRobinhoodApiKey(apiKey)) {
    throw new TypeError("Enter a valid Programmable API key.");
  }
  if (
    requestBytes.byteLength === 0
    || requestBytes.byteLength > MAX_ROBINHOOD_LAUNCH_BYTES
  ) {
    throw new TypeError(
      "Select a non-empty packed launch.json file no larger than 16 MiB.",
    );
  }

  let response: Response;
  try {
    response = await fetcher(
      ROBINHOOD_PREFLIGHT_URL,
      directRequestInit(apiKey, requestBytes, signal),
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      "The browser could not reach Robinhood preflight. The API may be unavailable or browser access may not be enabled.",
    );
  }
  const body = await readJson(response);
  if (!response.ok || response.status !== 200) {
    throw new Error(apiError(
      response,
      body,
      "Robinhood preflight is unavailable or rejected this request.",
    ));
  }
  const proof = parsePreflight(body, requestBytes);
  if (!proof) {
    throw new Error(
      "The Robinhood preflight response could not be verified.",
    );
  }
  return proof;
}

export async function createRobinhoodLaunch(
  fetcher: Fetcher,
  apiKey: string,
  idempotencyKey: string,
  proof: RobinhoodPreflightProof,
  signal?: AbortSignal,
) {
  if (!isRobinhoodApiKey(apiKey)) {
    throw new TypeError("Enter a valid Programmable API key.");
  }
  if (!isRobinhoodIdempotencyKey(idempotencyKey)) {
    throw new TypeError(
      "Use a 16–128 character Idempotency-Key with letters, numbers, dots, underscores, colons or hyphens.",
    );
  }
  if (!proof.deployable) {
    throw new TypeError(
      "This exact launch.json did not pass a deployable preflight.",
    );
  }

  const headers = requestHeaders(apiKey);
  headers.set("Idempotency-Key", idempotencyKey);
  let response: Response;
  try {
    response = await fetcher(ROBINHOOD_CREATE_URL, {
      ...directRequestInit(apiKey, proof.requestBytes, signal),
      headers,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new Error(
      "The create result is unknown. Keep this exact file and Idempotency-Key, then retry when the API is reachable.",
    );
  }
  const body = await readJson(response);
  if (!response.ok || (response.status !== 200 && response.status !== 202)) {
    throw new Error(apiError(
      response,
      body,
      "The Robinhood launch request was not created.",
    ));
  }
  const created = parseCreated(body);
  if (!created) {
    throw new Error(
      "The launch may have been created, but the response could not be verified. Retry with the same file and Idempotency-Key.",
    );
  }
  return created;
}

function createIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}

function formatBytes(byteLength: number) {
  if (byteLength < 1_000) return `${byteLength} B`;
  if (byteLength < 1_000_000) return `${(byteLength / 1_000).toFixed(1)} KB`;
  return `${(byteLength / 1_000_000).toFixed(1)} MB`;
}

type LaunchState =
  | "idle"
  | "checking"
  | "ready"
  | "blocked"
  | "creating"
  | "created"
  | "error";

export function DeveloperRobinhoodLaunch({
  onOpenLaunch,
}: Readonly<{
  onOpenLaunch: (launchId: string) => void;
}>) {
  const [apiKey, setApiKey] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [packedLaunch, setPackedLaunch] = useState<PackedLaunch | null>(null);
  const [proof, setProof] = useState<RobinhoodPreflightProof | null>(null);
  const [created, setCreated] = useState<RobinhoodLaunchCreated | null>(null);
  const [idempotencyLocked, setIdempotencyLocked] = useState(false);
  const [state, setState] = useState<LaunchState>("idle");
  const [error, setError] = useState("");
  const apiKeyRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fileGenerationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => controllerRef.current?.abort();
  }, []);

  const busy = state === "checking" || state === "creating";
  const createEnabled = state === "ready"
    && packedLaunch !== null
    && proof !== null
    && proof.requestBytes === packedLaunch.bytes
    && proof.deployable
    && isRobinhoodApiKey(apiKey)
    && isRobinhoodIdempotencyKey(idempotencyKey);

  const resetVerification = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setProof(null);
    setCreated(null);
    setError("");
    setState("idle");
  };

  const changeFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const generation = ++fileGenerationRef.current;
    const file = event.target.files?.[0] ?? null;
    resetVerification();
    setPackedLaunch(null);
    setIdempotencyLocked(false);
    setIdempotencyKey(createIdempotencyKey());
    if (!file) return;
    if (file.size === 0 || file.size > MAX_ROBINHOOD_LAUNCH_BYTES) {
      setError(
        "Select a non-empty packed launch.json file no larger than 16 MiB.",
      );
      setState("error");
      return;
    }
    try {
      const bytes = await file.arrayBuffer();
      if (generation !== fileGenerationRef.current) return;
      if (bytes.byteLength > MAX_ROBINHOOD_LAUNCH_BYTES) {
        throw new Error("The selected file exceeds 16 MiB.");
      }
      setPackedLaunch(Object.freeze({ bytes, fileName: file.name }));
    } catch (caught) {
      if (generation !== fileGenerationRef.current) return;
      setError(caught instanceof Error
        ? caught.message
        : "The selected launch.json could not be read.");
      setState("error");
    }
  };

  const changeApiKey = (value: string) => {
    resetVerification();
    setApiKey(value.trim());
  };

  const clearApiKey = () => {
    resetVerification();
    setApiKey("");
    window.requestAnimationFrame(() => apiKeyRef.current?.focus());
  };

  const runPreflight = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !packedLaunch) return;
    if (!isRobinhoodApiKey(apiKey)) {
      setError("Enter a valid Programmable API key.");
      setState("error");
      apiKeyRef.current?.focus();
      return;
    }

    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setProof(null);
    setCreated(null);
    setError("");
    setState("checking");
    try {
      const nextProof = await preflightRobinhoodLaunch(
        fetch,
        apiKey,
        packedLaunch.bytes,
        controller.signal,
      );
      setProof(nextProof);
      setState(nextProof.deployable ? "ready" : "blocked");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error
        ? caught.message
        : "Robinhood preflight failed.");
      setState("error");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const submitLaunch = async () => {
    if (!createEnabled || !proof) return;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setIdempotencyLocked(true);
    setError("");
    setState("creating");
    try {
      const result = await createRobinhoodLaunch(
        fetch,
        apiKey,
        idempotencyKey,
        proof,
        controller.signal,
      );
      setCreated(result);
      setApiKey("");
      setProof(null);
      setPackedLaunch(null);
      if (fileRef.current) fileRef.current.value = "";
      setState("created");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error
        ? caught.message
        : "The Robinhood launch request was not created.");
      setState("ready");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const findingCodes = proof
    ? [
        ...proof.hardBlockFindingCodes,
        ...proof.needsEvidenceFindingCodes,
        ...proof.warningFindingCodes,
      ]
    : [];

  const readinessLabel = state === "checking"
    ? "Checking exact bytes"
    : state === "ready"
      ? "Ready to create"
      : state === "blocked"
        ? "Not deployable"
        : state === "creating"
          ? "Creating request"
          : state === "created"
            ? "Request created"
            : state === "error"
              ? "Not ready"
              : "Preflight required";

  return (
    <section
      className={`${sharedStyles.panel} ${styles.launchPanel}`}
      aria-labelledby="robinhood-launch-title"
      aria-busy={busy}
    >
      <h2 id="robinhood-launch-title" className={styles.visuallyHidden}>Launch file</h2>

      <form className={styles.launchForm} onSubmit={runPreflight}>
        <label className={styles.fileField} htmlFor="robinhood-launch-file">
          <span>Launch file</span>
          <span className={styles.fileControl}>
            <FileJson aria-hidden="true" size={20} strokeWidth={1.8} />
            <input
              ref={fileRef}
              id="robinhood-launch-file"
              accept=".json,application/json"
              disabled={busy}
              type="file"
              aria-describedby="robinhood-launch-file-note"
              onChange={(event) => void changeFile(event)}
            />
          </span>
        </label>
        <p className={styles.fieldNote} id="robinhood-launch-file-note">
          Packed <code>launch.json</code> from your builder. Up to 16 MiB.
          {packedLaunch ? ` Selected file: ${formatBytes(packedLaunch.bytes.byteLength)}.` : ""}
        </p>
        <div className={styles.secretField}>
          <label className={sharedStyles.field} htmlFor="robinhood-api-key">
            <span>API key</span>
            <input
              ref={apiKeyRef}
              id="robinhood-api-key"
              aria-describedby="robinhood-api-key-note"
              aria-invalid={apiKey.length > 0 && !isRobinhoodApiKey(apiKey)}
              autoCapitalize="none"
              autoComplete="off"
              disabled={busy}
              inputMode="text"
              spellCheck={false}
              type="password"
              value={apiKey}
              onChange={(event) => changeApiKey(event.target.value)}
            />
          </label>
          <button
            className={sharedStyles.secondaryButton}
            disabled={busy || apiKey.length === 0}
            type="button"
            onClick={clearApiKey}
          >
            <Trash2 aria-hidden="true" size={16} strokeWidth={1.9} />
            Clear key
          </button>
        </div>
        <p className={styles.fieldNote} id="robinhood-api-key-note">
          Sent only to <code>api.programmable.market</code>. Never stored or logged by this page.
        </p>

        <details className={styles.requestDetails}>
          <summary>Request settings</summary>
        <div className={styles.idempotencyField}>
          <label className={sharedStyles.field} htmlFor="robinhood-idempotency-key">
            <span>Idempotency-Key</span>
            <input
              id="robinhood-idempotency-key"
              aria-describedby="robinhood-idempotency-note"
              aria-invalid={
                idempotencyKey.length > 0
                && !isRobinhoodIdempotencyKey(idempotencyKey)
              }
              autoCapitalize="none"
              autoComplete="off"
              disabled={busy || idempotencyLocked}
              maxLength={128}
              minLength={16}
              spellCheck={false}
              type="text"
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
            />
          </label>
          <button
            className={sharedStyles.secondaryButton}
            disabled={busy || idempotencyLocked}
            type="button"
            onClick={() => setIdempotencyKey(createIdempotencyKey())}
          >
            <RefreshCw aria-hidden="true" size={16} strokeWidth={1.9} />
            New key
          </button>
        </div>
        <p className={styles.fieldNote} id="robinhood-idempotency-note">
          Keep this value unchanged if a create request needs to be retried.
        </p>
        </details>

        {proof ? (
          <div className={styles.preflightResult} data-deployable={proof.deployable}>
            <div>
              <strong>
                {proof.deployable
                  ? "Ready to create a request"
                  : "This launch needs changes"}
              </strong>
              <span>{proof.disposition.replaceAll("_", " ")}</span>
            </div>
            <details className={styles.requestDetails}>
              <summary>Preflight details</summary>
            <dl>
              <div>
                <dt>Raw request SHA-256</dt>
                <dd><code>{proof.rawRequestSha256}</code></dd>
              </div>
              <div>
                <dt>Request hash</dt>
                <dd><code>{proof.requestHash}</code></dd>
              </div>
            </dl>
            </details>
            {findingCodes.length > 0 ? (
              <p>Findings: {findingCodes.join(", ")}</p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className={sharedStyles.inlineError} role="alert">{error}</p>
        ) : null}

        {created ? (
          <div className={styles.createdResult} role="status">
            <div>
              <strong>Launch request created</strong>
              <code>{created.launchId}</code>
              <span>Status: {created.status.replaceAll("_", " ")}</span>
            </div>
            <button
              className={sharedStyles.primaryButton}
              type="button"
              onClick={() => onOpenLaunch(created.launchId)}
            >
              View launch
            </button>
          </div>
        ) : (
          <div className={styles.actions}>
            <button
              className={sharedStyles.secondaryButton}
              disabled={busy || !packedLaunch || !isRobinhoodApiKey(apiKey)}
              aria-busy={state === "checking"}
              type="submit"
            >
              <RefreshCw aria-hidden="true" size={16} className={styles.actionIcon} data-spinning={state === "checking"} />
              Run preflight
            </button>
            <button
              className={sharedStyles.primaryButton}
              disabled={!createEnabled}
              aria-busy={state === "creating"}
              type="button"
              onClick={() => void submitLaunch()}
            >
              Create launch request
            </button>
          </div>
        )}
      </form>

      <div className={styles.launchFooter}>
        <span className={styles.readinessBadge} data-state={state} role="status" aria-live="polite">
          {state === "ready" || state === "created" ? <Check aria-hidden="true" size={14} strokeWidth={2.2} /> : null}
          {readinessLabel}
        </span>
        <p className={styles.safetyNote}>
          Creating a request never signs or broadcasts a wallet transaction.
        </p>
      </div>
    </section>
  );
}
