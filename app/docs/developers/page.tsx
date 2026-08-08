import type { Metadata } from "next";
import type { ReactNode } from "react";
import {
  ArrowUpRight,
  Braces,
  Database,
  Filter,
  History,
  Radar,
  ShieldCheck,
  Tags,
} from "lucide-react";

import {
  DeveloperAgentPrompt,
  DeveloperDocsWorkbench,
  DeveloperEndpointList,
} from "@/components/developer-docs-workbench";
import {
  PROGRAMMABLE_ACTIVE_API_BASE,
  PROGRAMMABLE_ACTIVE_API_VERSION,
  PROGRAMMABLE_COMPAT_API_BASE,
  PROGRAMMABLE_COMPAT_API_VERSION,
  PROGRAMMABLE_DEVELOPER_REPOSITORY,
  PROGRAMMABLE_FEE_POLICY,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_FINALITY_STATES,
  PROGRAMMABLE_LABELS,
  PROGRAMMABLE_OPENAPI_URL,
  PROGRAMMABLE_PLATFORM_ID,
  PROGRAMMABLE_RUNTIME_HASH_SEAM,
  PROGRAMMABLE_SCHEMA_BASE_URL,
  PROGRAMMABLE_VERIFIED_DEFINITION,
  PROGRAMMABLE_WELL_KNOWN_URL,
} from "@/components/developer-docs-contract";
import styles from "@/components/developer-docs.module.css";
import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";
import { CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH } from
  "@/lib/custom-launch/registry-public-manifest-v1";
import { resolveCustomRegistryPublicManifestV1 } from
  "@/lib/server/custom-launch/registry-manifest-v1";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Programmable",
  description:
    "Integrate once to discover every Programmable Classic and Custom launch through canonical provenance, versioned feeds and explicit capabilities.",
  alternates: { canonical: "/docs/developers" },
  openGraph: {
    type: "website",
    siteName: "Programmable",
    title: "Programmable terminal integration",
    description:
      "Public API, category labels, contracts, events, schemas and ingestion rules for Programmable launches.",
    url: "/docs/developers",
    images: [
      {
        url: "/og/programmable-night-garden-loop-og-v2-1200x630.png",
        width: 1200,
        height: 630,
        type: "image/png",
        alt: "The Warm Ivory Programmable loop mark in a starry night garden",
      },
    ],
  },
};

const developerSections = [
  { id: "paths", label: "Start here" },
  { id: "quickstart", label: "Quickstart" },
  { id: "identity", label: "Launch identity" },
  { id: "providers", label: "Custom Registry" },
  { id: "markets", label: "Assets and markets" },
  { id: "verification", label: "Verified and fees" },
  { id: "data", label: "Finality and indexing" },
  { id: "reference", label: "API and versions" },
  { id: "checklist", label: "Checklist" },
  { id: "agents", label: "AI agents" },
] as const;

const developerPaths = [
  {
    description: "Normative guides, schemas, fixtures and examples.",
    href: PROGRAMMABLE_DEVELOPER_REPOSITORY,
    icon: Braces,
    label: "Open GitHub docs",
    external: true,
  },
  {
    description: "Resolve the active API, chains and compatibility path.",
    href: PROGRAMMABLE_WELL_KNOWN_URL,
    icon: Radar,
    label: "Discover the live API",
    external: true,
  },
  {
    description: "Copy a minimal consumer for feeds and finality.",
    href: "#quickstart",
    icon: Database,
    label: "Start integration",
    external: false,
  },
  {
    description: "Verify labels, cursors, markets and failure states.",
    href: "#checklist",
    icon: ShieldCheck,
    label: "Review the checklist",
    external: false,
  },
] as const;

const providerRequirements = [
  [
    "Identity",
    "Provider ID, supported chain, factory and template registry addresses.",
  ],
  [
    "Source",
    "Verified source, ABI, deployment transaction, start block and EVM " +
      PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakField +
      " as " +
      PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakFormat +
      " " +
      PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakAlgorithm +
      "; optional " +
      PROGRAMMABLE_RUNTIME_HASH_SEAM.sha256Field +
      " stays separately labeled.",
  ],
  [
    "Template",
    "Stable template ID, version, configuration hash and upgrade authority.",
  ],
  [
    "Launch output",
    "How to obtain token, hook, pool or market, creator and external launch ID from the receipt.",
  ],
  [
    "Hook policy",
    "PoolManager, permission flags, router assumptions, mutable roles and external calls.",
  ],
  [
    "Economics",
    "Creator fees, protocol fees, recipients, caps and the exact charge basis.",
  ],
  [
    "Market support",
    "Discovery, chart, quote, simulation and execution support as separate capabilities.",
  ],
  [
    "Evidence",
    "Audit scope, tests, mainnet example, negative cases and incident contact.",
  ],
] as const;

type Deployment = {
  category: "Programmable Classic";
  event: string;
  hook?: string;
  launcher: string;
  lifecycle: "current" | "legacy" | "retired";
  release: string;
  startBlock: string;
  topic0: string;
};

const currentDeployments: readonly Deployment[] = [
  {
    category: "Programmable Classic",
    event: "MemeTokenLaunchedV2",
    hook: "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC",
    launcher: "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770",
    lifecycle: "current",
    release: "Classic V3",
    startBlock: "25639596",
    topic0:
      "0xf23bd7fdf96caf9195ba5982de473632f59015abc714915dfbbe06cbd8e255e5",
  },
] as const;

const historicalDeployments: readonly Deployment[] = [
  {
    category: "Programmable Classic",
    event: "MemeTokenLaunched",
    launcher: "0x51d702731db281EE223904A4663E05BfCA26C775",
    lifecycle: "retired",
    release: "Classic V1",
    startBlock: "25622048",
    topic0:
      "0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675",
  },
  {
    category: "Programmable Classic",
    event: "MemeTokenLaunched",
    hook: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
    launcher: "0xD240D06f8586eB799f20056054e5b527405E6bAd",
    lifecycle: "legacy",
    release: "Classic V2",
    startBlock: "25624131",
    topic0:
      "0x54f861f401872200b25acd4a9f53153ac06a7be4562b3e43025a4a85740a5675",
  },
] as const;

const fields = [
  {
    field: "schemaVersion · platformId · category",
    use: "Accept the official platformId programmable, then map classic or custom to the two public labels.",
  },
  {
    field: "launchId · projectId · chainId · caip2",
    use: "Keep replay-safe launch and project identity chain-bound. Never identify a token by name or ticker.",
  },
  {
    field: "model · template · partner · builder · origin",
    use: "Treat attribution and mechanism as additive facts, never as a third public category.",
  },
  {
    field: "token · assets[] · contracts[]",
    use: "Support no token, one token or several assets with roles, provenance, runtimeCodeKeccak256, optional runtimeCodeSha256 and separate creator metadata.",
  },
  {
    field: "launch · verification · finality",
    use: "Store transaction, block, log position, launch wallet, runtime binding, review and revocation independently.",
  },
  {
    field: "markets[] · capabilities[]",
    use: "Allow zero, one or several markets. Gate chart, quote, simulation and execution separately and preserve unknown IDs.",
  },
  {
    field: "fees",
    use: "Display verified basis, currency, recipients, shares, accrual and claim evidence. Never infer them from category.",
  },
  {
    field: "presentation · extensions",
    use: "Keep creator descriptions and links namespaced. They can never overwrite origin, chain, contract, fee or security facts.",
  },
] as const;

const marketCases = [
  {
    title: "Project only",
    status: "token = null · markets = []",
    description:
      "Keep the project in the launch feed, preserve its contracts and assets, and do not manufacture a coin page.",
  },
  {
    title: "Token without a market",
    status: "token = present · markets = []",
    description:
      "Show verified token identity while price, liquidity, volume, chart and trade controls remain unavailable.",
  },
  {
    title: "Several assets and markets",
    status: "assets > 1 · markets > 1",
    description:
      "Render roles and lifecycle per asset and market instead of selecting an arbitrary pool as canonical.",
  },
  {
    title: "Unknown market kind",
    status: "support = unsupported",
    description:
      "Keep the launch visible, preserve the payload and disable chart, quote, simulation and execution until an adapter is verified.",
  },
] as const;

function ExternalResource({
  children,
  href,
  meta,
}: {
  children: ReactNode;
  href: string;
  meta: string;
}) {
  return (
    <a
      className={styles.resourceLink}
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <span>
        <strong>{children}</strong>
        <small>{meta}</small>
      </span>
      <ArrowUpRight aria-hidden="true" size={18} strokeWidth={1.8} />
    </a>
  );
}

function DeploymentCard({ deployment }: { deployment: Deployment }) {
  return (
    <article className={styles.deploymentCard}>
      <header>
        <div>
          <strong>{deployment.release}</strong>
          <span>{deployment.category}</span>
        </div>
        <code>{deployment.lifecycle}</code>
      </header>
      <dl>
        <div>
          <dt>Launcher</dt>
          <dd>
            <DocsAddress
              address={deployment.launcher}
              label={`${deployment.release} launcher`}
            />
          </dd>
        </div>
        {deployment.hook ? (
          <div>
            <dt>Hook</dt>
            <dd>
              <DocsAddress
                address={deployment.hook}
                label={`${deployment.release} hook`}
              />
            </dd>
          </div>
        ) : null}
        <div>
          <dt>Launch event</dt>
          <dd>
            <code>{deployment.event}</code>
          </dd>
        </div>
        <div>
          <dt>Topic 0</dt>
          <dd>
            <code>{deployment.topic0}</code>
          </dd>
        </div>
        <div>
          <dt>From block</dt>
          <dd>
            <code>{deployment.startBlock}</code>
          </dd>
        </div>
      </dl>
    </article>
  );
}

export default function DeveloperDocsPage() {
  const registryManifest = resolveCustomRegistryPublicManifestV1();
  const registryAddress = registryManifest.contracts.registry.address ?? "null";
  const registryStartBlock = registryManifest.startBlock ?? "null";
  const registryAbiUrl = registryManifest.specifications.abi.url ?? "null";
  return (
    <DocsShell
      currentPath="/docs/developers"
      description="Trading terminals, launch trackers, wallets, scanners, bots and data platforms can discover every recognized launch through one provenance contract, even when the assets, contracts and markets change."
      heroAside={
        <nav
          aria-label="Developer integration paths"
          className={styles.pathList}
        >
          {developerPaths.map((path) => {
            const Icon = path.icon;
            return (
              <a
                href={path.href}
                key={path.href}
                rel={path.external ? "noreferrer" : undefined}
                target={path.external ? "_blank" : undefined}
              >
                <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                <span>
                  <strong>{path.label}</strong>
                  <small>{path.description}</small>
                </span>
                <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
              </a>
            );
          })}
        </nav>
      }
      heroId="paths"
      kicker="Developer platform"
      sections={developerSections}
      title="Integrate once. Discover every Programmable launch."
    >
      <section className={styles.terminalSection} id="quickstart">
        <div className={styles.sectionIntro}>
          <h2>Start with discovery, then ingest one feed</h2>
          <p>
            Read the well known document instead of hardcoding a major version.
            It currently advertises API v{PROGRAMMABLE_ACTIVE_API_VERSION}; API v
            {PROGRAMMABLE_COMPAT_API_VERSION} remains available for pinned
            compatibility clients.
          </p>
        </div>

        <DeveloperDocsWorkbench />

        <div className={styles.compatibilityBand}>
          <div>
            <span>Active discovery</span>
            <strong>API v{PROGRAMMABLE_ACTIVE_API_VERSION}</strong>
            <code>{PROGRAMMABLE_ACTIVE_API_BASE}</code>
          </div>
          <div>
            <span>Supported compatibility</span>
            <strong>API v{PROGRAMMABLE_COMPAT_API_VERSION}</strong>
            <code>{PROGRAMMABLE_COMPAT_API_BASE}</code>
          </div>
          <p>
            Never validate a v{PROGRAMMABLE_ACTIVE_API_VERSION} response with v
            {PROGRAMMABLE_COMPAT_API_VERSION} schemas. Follow the URLs returned
            by discovery and pin a major only when your client explicitly owns
            that compatibility contract.
          </p>
        </div>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Two public labels, one platform identity</h3>
            <p>
              Model, template and partner attribution stay separate from market
              availability and fee activation.
            </p>
          </div>
          <a
            href={`${PROGRAMMABLE_DEVELOPER_REPOSITORY}/blob/main/docs/quickstart.md`}
            rel="noreferrer"
            target="_blank"
          >
            Open canonical quickstart
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
          </a>
        </div>

        <div className={styles.labelGrid}>
          <article>
            <span className={styles.labelIcon} aria-hidden="true">
              <Tags size={19} strokeWidth={1.8} />
            </span>
            <code>
              {PROGRAMMABLE_PLATFORM_ID} · category = classic
            </code>
            <h3>{PROGRAMMABLE_LABELS.classic}</h3>
            <p>
              Current and historical Classic releases. New Classic launches use
              the current V3 launcher and fee hook from the manifest.
            </p>
          </article>
          <article>
            <span className={styles.labelIcon} aria-hidden="true">
              <Filter size={19} strokeWidth={1.8} />
            </span>
            <code>
              {PROGRAMMABLE_PLATFORM_ID} · category = custom
            </code>
            <h3>{PROGRAMMABLE_LABELS.custom}</h3>
            <p>
              Official Custom launches from one canonical registry, regardless
              of provider, template, mechanic or contract address.
            </p>
          </article>
        </div>

        <div className={styles.statusNote}>
          <strong>Current Custom boundary</strong>
          <p>
            Community Custom intake is {registryManifest.status}. Resolve the
            exact registry generation, contracts, start block and specifications
            from <a href={CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH}>the public Custom
            Registry manifest</a>. Existing v{PROGRAMMABLE_COMPAT_API_VERSION}{" "}
            compatibility records do not prove that open intake is live.
          </p>
        </div>
      </section>

      <section id="identity">
        <div className={styles.sectionIntro}>
          <h2>Launch identity comes from proof, not presentation</h2>
          <p>
            A name, ticker, logo, creator tag or lookalike event cannot create a
            Programmable label. Integrators accept identity only from the
            official chain profile, registry generation and authenticated launch
            evidence published by the manifest.
          </p>
        </div>

        <div className={styles.originFlow} aria-label="Canonical launch origin">
          <span>Approved repository revision</span>
          <span aria-hidden="true">→</span>
          <span>Reproducible build</span>
          <span aria-hidden="true">→</span>
          <span>Wallet launch</span>
          <span aria-hidden="true">→</span>
          <span>Runtime match</span>
          <span aria-hidden="true">→</span>
          <span>Canonical registry</span>
          <span aria-hidden="true">→</span>
          <span>Developer feed</span>
        </div>

        <div className={styles.identityRules}>
          <article>
            <strong>Approval is not a launch</strong>
            <p>
              Approval binds repository, commit, source commitment, build,
              artifacts, configuration, chain and launch wallet. The public
              record appears only after deployed EVM runtimeCodeKeccak256 values
              and finalization evidence match that approval.
            </p>
          </article>
          <article>
            <strong>Registration is chain bound</strong>
            <p>
              The record binds chainId, CAIP-2, launchId, deployment transaction,
              block and log position. A copied event on another contract or
              chain is not Programmable provenance.
            </p>
          </article>
          <article>
            <strong>Metadata cannot escalate trust</strong>
            <p>
              Creator descriptions, images and links remain presentation data.
              They never overwrite contract, fee, security, origin or authority
              fields.
            </p>
          </article>
        </div>

        <p className={styles.scopeNote}>
          For EVM deployments,{" "}
          <code>{PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakField}</code> is the{" "}
          <code>{PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakFormat}</code>{" "}
          <code>{PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakAlgorithm}</code>. Optional{" "}
          <code>{PROGRAMMABLE_RUNTIME_HASH_SEAM.sha256Field}</code> evidence uses
          the <code>{PROGRAMMABLE_RUNTIME_HASH_SEAM.sha256Format}</code> prefix
          and remains a separate field.
        </p>
      </section>

      <section id="providers">
        <div className={styles.sectionIntro}>
          <h2>One registry can recognize unfamiliar Custom launches</h2>
          <p>
            Token templates, hooks, games, rewards, dynamic supply, burns,
            oracles, bridges, external contracts and future market types remain
            extensible. The client contract stays stable because origin,
            capabilities and evidence are normalized instead of contract
            addresses.
          </p>
        </div>

        <div className={styles.prelaunchNotice}>
          <strong>Registry manifest</strong>
          <p>
            The fail-closed public manifest currently reports{" "}
            <code>{registryManifest.status}</code>, registry address{" "}
            <code>{registryAddress}</code>, start block{" "}
            <code>{registryStartBlock}</code>, ABI URL{" "}
            <code>{registryAbiUrl}</code> and public submissions{" "}
            <code>{String(registryManifest.publicSubmissionsEnabled)}</code>.
            Do not subscribe to any address or event outside that manifest.
          </p>
        </div>

        <div className={styles.providerModes}>
          <article>
            <h3>Atomic launch</h3>
            <p>
              Deployment, initialization and authenticated registration succeed
              in one transaction or all changes revert. The registry binds the
              returned assets, contracts and markets to the approved build.
            </p>
          </article>
          <article>
            <h3>Multistep launch</h3>
            <p>
              Intermediate deployments remain nonpublic. The record becomes
              discoverable only after a finalization transaction proves the
              complete deployment graph and all required runtime matches.
            </p>
          </article>
        </div>

        <p className={styles.hardRule}>
          A pull request, frontend request, token tag, webhook or later metadata
          submission is not canonical launch provenance. Only authenticated
          registry evidence from the published source creates the Custom label.
        </p>

        <p className={styles.scopeNote}>
          Token, hook, controller, factory, provider and market addresses may
          differ on every launch. Terminals still consume one Custom feed because
          the registry event and deployment proof assign the category.
        </p>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Template and provider handoff</h3>
            <p>Every integration supplies the same verifiable evidence package.</p>
          </div>
          <a
            href="https://github.com/0xprogrammable/developers/blob/main/docs/guides/launch-providers.md"
            rel="noreferrer"
            target="_blank"
          >
            Open canonical provider guide
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
          </a>
        </div>

        <dl className={styles.requirementList}>
          {providerRequirements.map(([term, description]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>

        <div className={styles.registryLayout}>
          <div>
            <h3>Canonical registration record</h3>
            <p>
              The versioned event records immutable origin. Corrections,
              revocations, registry generations and provider lifecycle are
              append only facts, so later changes never rewrite launch history.
            </p>
            <ul>
              <li>Replay protection and one chain bound launch identity</li>
              <li>Authorized writer and deployment authority authenticated</li>
              <li>Repository, build, artifacts and configuration committed</li>
              <li>
                runtimeCodeKeccak256, transaction, block and log position
                verified
              </li>
            </ul>
          </div>
          <aside className={styles.statusNote}>
            <strong>No copyable Custom ABI before deployment</strong>
            <p>
              Resolve the registry address, start block, exact event ABI, event
              set, hash specification and generation from the public Custom
              Registry manifest. Custom ingestion stays disabled unless its
              status is live and every binding is non-null.
            </p>
            <code>
              address = {registryAddress} · startBlock = {registryStartBlock}
            </code>
          </aside>
        </div>

        <div
          className={styles.providerLifecycle}
          aria-label="Provider launch lifecycle"
        >
          <span>Revision review</span>
          <span aria-hidden="true">→</span>
          <span>Build binding</span>
          <span aria-hidden="true">→</span>
          <span>Wallet launch</span>
          <span aria-hidden="true">→</span>
          <span>Runtime match</span>
          <span aria-hidden="true">→</span>
          <span>Registry and feed</span>
        </div>

        <div className={styles.partnerPolicy}>
          <div>
            <span>Active fee-bearing partner-template path</span>
            <strong>
              {PROGRAMMABLE_FEE_POLICY.partnerTemplate.totalBps} BPS total
            </strong>
          </div>
          <p>
            Verified partner or template attribution alone does not activate a
            fee. A project with <code>no-qualifying-market</code> records{" "}
            {PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket
              .partnerShareBps}
            /{PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket
              .programmableShareBps}
            /{PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.totalBps}{" "}
            BPS for partner, Programmable and total. Only an active fee-bearing
            partner-template market path must enforce{" "}
            {PROGRAMMABLE_FEE_POLICY.partnerTemplate.partnerShareBps} BPS for the
            partner and
            {" "}{PROGRAMMABLE_FEE_POLICY.partnerTemplate.programmableShareBps}
            {" "}BPS for Programmable on one clearly defined fee basis. The
            normal {PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps} BPS Custom
            policy is not added again. Named partner attribution requires exact
            template and deployment provenance; its fee path remains inactive
            until recipient and onchain fee evidence are published.
          </p>
        </div>
      </section>

      <section id="onchain">
        <div className={styles.sectionIntro}>
          <h2>Consume the feed or verify directly onchain</h2>
          <p>
            The public feed is the preferred normalized integration. Direct log
            consumers must still load the same official chain profile, source
            address, start block, event topic, registry generation and lifecycle
            from the manifest.
          </p>
        </div>

        <div className={styles.detectionFlow}>
          <article>
            <Radar aria-hidden="true" size={20} strokeWidth={1.8} />
            <h3>Public launch feed</h3>
            <code>GET /api/v{PROGRAMMABLE_ACTIVE_API_VERSION}/launches</code>
            <p>
              Filter with <code>category=classic</code> or
              <code>category=custom</code>. Refresh the manifest separately and
              never hardcode one launcher or registry generation as the complete
              source.
            </p>
          </article>
          <article>
            <Braces aria-hidden="true" size={20} strokeWidth={1.8} />
            <h3>Ethereum logs</h3>
            <code>eth_getLogs</code>
            <p>
              Filter by the exact official source address, event topic and start
              block. Record transaction, block hash and log position; replay on
              reorg and apply revocations without trusting lookalike events.
            </p>
          </article>
        </div>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Current Ethereum sources</h3>
            <p>
              Resolve these values from the live manifest in production code.
            </p>
          </div>
          <a
            href={`${PROGRAMMABLE_ACTIVE_API_BASE}/manifest`}
            rel="noreferrer"
            target="_blank"
          >
            Open live manifest
            <ArrowUpRight aria-hidden="true" size={15} strokeWidth={1.8} />
          </a>
        </div>

        <div className={styles.deploymentGrid}>
          {currentDeployments.map((deployment) => (
            <DeploymentCard deployment={deployment} key={deployment.release} />
          ))}
        </div>

        <details className={styles.historyDisclosure}>
          <summary>
            <span>
              <History aria-hidden="true" size={18} strokeWidth={1.8} />
              Historical sources required for a complete backfill
            </span>
            <span aria-hidden="true">+</span>
          </summary>
          <div className={styles.deploymentGrid}>
            {historicalDeployments.map((deployment) => (
              <DeploymentCard
                deployment={deployment}
                key={deployment.release}
              />
            ))}
          </div>
        </details>

        <p className={styles.scopeNote}>
          The v{PROGRAMMABLE_ACTIVE_API_VERSION} manifest lists only Classic
          sources today. The Custom source is accepted only after a real registry
          address, start block, event ABI and generation are published. Ethereum
          is the sole live chain currently advertised; Base, BNB Chain,
          Arbitrum and other EVM chains remain architecture targets, not live
          claims.
        </p>
      </section>

      <section id="markets">
        <div className={styles.sectionIntro}>
          <h2>Preserve the launch even when your client cannot trade it</h2>
          <p>
            Custom is an open data model, not a promise that every project is an
            ERC 20 with one pool. Store identity and evidence first, then expose
            only capabilities your product actually supports.
          </p>
        </div>

        <div
          aria-label="Required integration fields"
          className={styles.fieldTable}
          role="table"
        >
          {fields.map((entry) => (
            <div key={entry.field} role="row">
              <code role="cell">{entry.field}</code>
              <span role="cell">{entry.use}</span>
            </div>
          ))}
        </div>

        <div className={styles.marketCases}>
          {marketCases.map((marketCase) => (
            <article key={marketCase.title}>
              <code>{marketCase.status}</code>
              <h3>{marketCase.title}</h3>
              <p>{marketCase.description}</p>
            </article>
          ))}
        </div>

        <p className={styles.scopeNote}>
          Supply may be dynamic; burns, rewards, game state, bridges, oracles and
          offchain services may affect the project. Record their evidence and
          authority boundaries without interpreting arbitrary extension fields
          as executable instructions.
        </p>
      </section>

      <section id="verification">
        <div className={styles.sectionIntro}>
          <h2>Programmable Verified is exact and bounded</h2>
          <p>
            {PROGRAMMABLE_VERIFIED_DEFINITION} It is not a universal safety,
            audit, liquidity or execution guarantee.
          </p>
        </div>

        <blockquote className={styles.verifiedDefinition}>
          <span>Published definition</span>
          <p>{PROGRAMMABLE_VERIFIED_DEFINITION}</p>
        </blockquote>

        <div className={styles.verificationGrid}>
          <article>
            <ShieldCheck aria-hidden="true" size={21} strokeWidth={1.8} />
            <h3>Review record</h3>
            <ul>
              <li>Policy version and commitment</li>
              <li>Repository, commit, source, build and artifact hashes</li>
              <li>
                Optional runtimeCodeSha256 evidence separately named and labeled
              </li>
              <li>Configuration, authorities and upgradeability</li>
              <li>Pause, custody, dependencies, oracles and bridges</li>
              <li>Findings, reviewer type, review time and scope</li>
            </ul>
          </article>
          <article>
            <Database aria-hidden="true" size={21} strokeWidth={1.8} />
            <h3>Deployment record</h3>
            <ul>
              <li>Chain, launch wallet, transaction and block binding</li>
              <li>
                EVM <code>{PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakField}</code> as{" "}
                <code>{PROGRAMMABLE_RUNTIME_HASH_SEAM.keccakAlgorithm}</code> and{" "}
                deployment configuration match
              </li>
              <li>Finality and canonical registry evidence</li>
              <li>Superseded, revoked and authority change state</li>
              <li>Market, fee and metadata trust kept separate</li>
            </ul>
          </article>
        </div>

        <div className={styles.verificationRule}>
          <strong>No universal safe flag</strong>
          <p>
            Preserve provenance, review result, source and runtime match,
            finality, metadata trust, dependencies, admin rights, market
            verification, charting, quotes, simulation, execution and fees as
            independent facts. Do not describe a launch as guaranteed safe,
            risk free, unruggable or independently audited without exact
            evidence.
          </p>
        </div>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Fee policy</h3>
            <p>Rates apply only to their verified market path and fee basis.</p>
          </div>
          <DocsAddress
            address={PROGRAMMABLE_FEE_RECIPIENT}
            label="Programmable fee recipient"
          />
        </div>

        <div className={styles.feeGrid}>
          <article>
            <span>Native Custom policy</span>
            <strong>
              {PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps} BPS · 0.10%
            </strong>
            <p>
              {PROGRAMMABLE_FEE_POLICY.nativeCustom.programmableShareBps} BPS
              to Programmable, no partner share, only on the verified official
              market path. Transfers, mints, burns, rewards, games, refunds,
              bridges and third party pools are not automatically charged.
            </p>
            <small>
              Community Custom status is {registryManifest.status}; this policy
              alone is not proof of a live fee path.
            </small>
          </article>
          <article>
            <span>Active fee-bearing partner-template path</span>
            <strong>
              {PROGRAMMABLE_FEE_POLICY.partnerTemplate.totalBps} BPS total
            </strong>
            <p>
              When active, {PROGRAMMABLE_FEE_POLICY.partnerTemplate.partnerShareBps}{" "}
              BPS partner plus
              {" "}{PROGRAMMABLE_FEE_POLICY.partnerTemplate.programmableShareBps}
              {" "}BPS Programmable, enforced by the exact reviewed template on
              the same fee basis. No additional native
              {" "}{PROGRAMMABLE_FEE_POLICY.nativeCustom.totalBps} BPS is added.
            </p>
            <small>
              Partner attribution with <code>no-qualifying-market</code> is
              valid at{" "}
              {PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket
                .partnerShareBps}
              /{PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket
                .programmableShareBps}
              /{PROGRAMMABLE_FEE_POLICY.partnerTemplate.noQualifyingMarket.totalBps}{" "}
              BPS. Otherwise recipient, currency, rounding, accrual and claim
              paths must be proven from code, deployment configuration or
              onchain state.
            </small>
          </article>
        </div>
      </section>

      <section id="data">
        <div className={styles.sectionIntro}>
          <h2>Follow finality without losing a launch</h2>
          <p>
            The chain timestamp is original time. The API first exposes a
            canonical block as observed, then advances confirmation and finality
            state. Reorged records become orphaned rather than disappearing.
          </p>
        </div>

        <div className={styles.finalityRail} aria-label="Launch finality states">
          {PROGRAMMABLE_FINALITY_STATES.map((state, index) => (
            <div key={state}>
              <span>{index + 1}</span>
              <strong>{state}</strong>
              <small>
                {state === "observed"
                  ? "First canonical observation"
                  : state === "confirmed"
                    ? "Confirmation policy reached"
                    : state === "finalized"
                      ? "Finality policy reached"
                      : "Removed by canonical reorg"}
              </small>
            </div>
          ))}
        </div>

        <p className={styles.scopeNote}>
          A revoked review or launch is a separate trust state, not a fifth block
          finality state. Measure chain to indexer, API and website latency from
          observed timestamps; do not assume or promise same second visibility.
        </p>

        <div className={styles.subsectionHeader}>
          <div>
            <h3>Backfill once, then poll from a durable checkpoint</h3>
            <p>Cursors are opaque. Store and return them unchanged.</p>
          </div>
        </div>

        <ol className={styles.syncSteps}>
          <li>
            <span className={styles.stepNumber}>1</span>
            <div>
              <strong>Discover the interface</strong>
              <p>
                Fetch the well known document, status and manifest. Reject an
                unexplained manifest rollback.
              </p>
              <code>GET /.well-known/programmable.json</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>2</span>
            <div>
              <strong>Complete the snapshot</strong>
              <p>
                Continue with <code>nextCursor</code> while
                <code>hasMore</code> is true.
              </p>
              <code>
                GET /api/v{PROGRAMMABLE_ACTIVE_API_VERSION}/launches?cursor=
                {"{nextCursor}"}
              </code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>3</span>
            <div>
              <strong>Commit before advancing</strong>
              <p>
                Apply pages idempotently, then persist
                <code>resumeCursor</code> only after the traversal is durable.
              </p>
              <code>persist(page.resumeCursor)</code>
            </div>
          </li>
          <li>
            <span className={styles.stepNumber}>4</span>
            <div>
              <strong>Poll for updates</strong>
              <p>
                Start the next traversal with <code>after</code>. Reconcile
                repeated and orphaned records by <code>launchId</code>.
              </p>
              <code>
                GET /api/v{PROGRAMMABLE_ACTIVE_API_VERSION}/launches?after=
                {"{resumeCursor}"}
              </code>
            </div>
          </li>
        </ol>

        <div className={styles.indexingRules}>
          <p>
            <strong>Snapshot consistency</strong>
            Finish every <code>nextCursor</code> page from one traversal before
            starting from <code>resumeCursor</code>. A launch arriving during the
            traversal must appear in the next poll, never be skipped between
            cursors.
          </p>
          <p>
            <strong>Retry semantics</strong>
            On stale or incomplete coverage, preserve the last good state and
            honor retry guidance. A retryable <code>503</code> is not an empty
            feed and an unavailable registry is not a token detail <code>404</code>.
          </p>
          <p>
            <strong>Multi chain readiness</strong>
            Read the chain list and per chain manifest data from discovery. Key
            tokens by chain and address, deduplicate by chain bound launchId and
            never mark a planned chain live before it appears in the official
            manifest.
          </p>
        </div>
      </section>

      <section id="reference">
        <div className={styles.sectionIntro}>
          <h2>Discover the active API; pin compatibility deliberately</h2>
          <p>
            All public endpoints are read only, return JSON and support public
            CORS without an API key. The well known document is the global
            entry point and currently selects v{PROGRAMMABLE_ACTIVE_API_VERSION}.
          </p>
        </div>

        <div className={styles.versionMatrix} aria-label="API version support">
          <div>
            <code>v{PROGRAMMABLE_ACTIVE_API_VERSION}</code>
            <strong>Active discovery</strong>
            <span>
              New integrations follow URLs from {PROGRAMMABLE_WELL_KNOWN_URL}.
            </span>
          </div>
          <div>
            <code>v{PROGRAMMABLE_COMPAT_API_VERSION}</code>
            <strong>Supported compatibility</strong>
            <span>
              Existing clients may stay pinned while they validate and migrate
              to the active contract.
            </span>
          </div>
        </div>

        <DeveloperEndpointList />

        <div className={styles.endpointGuidance}>
          <p>
            Use{" "}
            <code>
              /api/v{PROGRAMMABLE_ACTIVE_API_VERSION}/launches/{"{launchId}"}
            </code>{" "}
            for every launch shape, including project-only and multi-asset
            records. A token compatibility lookup needs both path values. Use
            <code>
              /api/v{PROGRAMMABLE_ACTIVE_API_VERSION}/launches/1/0x…
            </code>{" "}
            only when the record has a canonical token address.
          </p>
          <div aria-label="Launch feed query parameters">
            <code>chainId=1</code>
            <code>category=classic|custom</code>
            <code>limit=1..100</code>
            <code>cursor=&lt;opaque&gt;</code>
            <code>after=&lt;resumeCursor&gt;</code>
          </div>
        </div>

        <div className={styles.httpStates} aria-label="HTTP response handling">
          <span>
            <code>200</code> Process
          </span>
          <span>
            <code>304</code> Reuse cache
          </span>
          <span>
            <code>400</code> Fix request
          </span>
          <span>
            <code>429</code> Back off
          </span>
          <span>
            <code>503</code> Keep last good state
          </span>
        </div>

        <div className={styles.resourceGrid}>
          <ExternalResource
            href={PROGRAMMABLE_OPENAPI_URL}
            meta={`Normative v${PROGRAMMABLE_ACTIVE_API_VERSION} HTTP contract`}
          >
            Active OpenAPI 3.1
          </ExternalResource>
          <ExternalResource
            href={PROGRAMMABLE_SCHEMA_BASE_URL}
            meta={`Hosted v${PROGRAMMABLE_ACTIVE_API_VERSION} schemas`}
          >
            Active JSON Schemas
          </ExternalResource>
          <ExternalResource
            href={`${PROGRAMMABLE_DEVELOPER_REPOSITORY}/tree/main/abis/ethereum`}
            meta="Canonical launch event interfaces"
          >
            Ethereum ABIs
          </ExternalResource>
          <ExternalResource
            href={`${PROGRAMMABLE_DEVELOPER_REPOSITORY}/blob/main/docs/guides/terminals-and-scanners.md`}
            meta="Terminal implementation contract"
          >
            Terminal guide
          </ExternalResource>
          <ExternalResource
            href={`${PROGRAMMABLE_DEVELOPER_REPOSITORY}/tree/main/fixtures/v2`}
            meta="Conformance and edge cases"
          >
            Fixtures
          </ExternalResource>
          <ExternalResource
            href={`${PROGRAMMABLE_DEVELOPER_REPOSITORY}/issues`}
            meta="Integration questions and discrepancies"
          >
            Integration support
          </ExternalResource>
        </div>

        <p className={styles.scopeNote}>
          GitHub is the canonical technical source for guides, schemas, fixtures,
          clients, compatibility and security policy. The live well known
          document and manifest are the authority for the currently advertised
          API version, chains, deployments and runtime status.
        </p>
      </section>

      <section id="checklist">
        <div className={styles.sectionIntro}>
          <h2>Production integration checklist</h2>
          <p>
            Keep one durable ingestion path and let verified capabilities decide
            what your product can safely show or execute.
          </p>
        </div>

        <ol className={styles.integrationChecklist}>
          <li>Load well known, then status and every advertised chain manifest.</li>
          <li>
            Accept <code>platformId={PROGRAMMABLE_PLATFORM_ID}</code> only from
            the official source and map exactly two public categories.
          </li>
          <li>
            Backfill every page, deduplicate by launchId and persist resumeCursor
            only after the snapshot is durable.
          </li>
          <li>
            Key tokens by chainId and address; preserve project only and multi
            asset launches without inventing a primary token.
          </li>
          <li>
            Reconcile observed, confirmed, finalized and orphaned records plus
            separate revoked or superseded review state.
          </li>
          <li>
            Keep unknown templates, capabilities and market kinds visible while
            disabling unsupported chart, quote, simulation and execution paths.
          </li>
          <li>
            Read fee basis, currency, recipients, accrual and claim evidence from
            each record; never infer fees from category or partner name.
          </li>
          <li>
            Validate fixtures and live responses with the matching major version
            schemas, handle retryable 503, and retain the last good state.
          </li>
        </ol>

        <div className={styles.finalCta}>
          <div>
            <strong>Build against the canonical contract</strong>
            <p>
              Start with GitHub, verify runtime discovery, then test your client
              against no market, multi market, reorg and unknown capability
              fixtures.
            </p>
          </div>
          <a
            href={PROGRAMMABLE_DEVELOPER_REPOSITORY}
            rel="noreferrer"
            target="_blank"
          >
            Open GitHub developer docs
            <ArrowUpRight aria-hidden="true" size={16} strokeWidth={1.8} />
          </a>
        </div>
      </section>

      <section id="agents">
        <div className={styles.sectionIntro}>
          <h2>AI agent entry points</h2>
          <p>
            GitHub guides, live discovery, OpenAPI, schemas and fixtures form the
            technical source set. The prompt below points an agent to that same
            versioned contract without asking it to scrape this page.
          </p>
        </div>
        <DeveloperAgentPrompt registryManifest={registryManifest} />
      </section>
    </DocsShell>
  );
}
