import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/developer-docs.module.css";
import { V4_API_PROFILE_VERSION } from "@/lib/custom-launch/v4-api-discovery";
import { DocsAddress } from "@/components/docs-address";
import { DocsShell } from "@/components/docs-shell";

export const metadata: Metadata = {
  title: "Robinhood terminal and indexer integration · Programmable",
  description:
    "Index Programmable Custom launches on Robinhood Chain with the canonical Router, finalized feed, event topics and fail-closed result states.",
  alternates: {
    canonical: "/developer-reference/robinhood-terminal-indexer",
  },
};

const API_ORIGIN = "https://api.programmable.market";
const WELL_KNOWN_URL =
  "https://programmable.market/.well-known/programmable.json";
const CAPABILITIES_URL = `${API_ORIGIN}/v4/chains/4663/capabilities`;
const READINESS_URL = `${API_ORIGIN}/v4/chains/4663/readiness`;
const FINALIZED_FEED_URL = `${API_ORIGIN}/v4/chains/4663/finalized-custom-launches`;
const OPENAPI_URL = V4_API_PROFILE_VERSION === "4.1.0"
  ? "/openapi/custom-launch-v4.1.json"
  : "/openapi/custom-launch-v4.json";
const ABI_URL = "/contracts/robinhood/ProgrammableLaunchStampRouterV1.abi.json";
const FIXTURE_URL = "/fixtures/robinhood-terminal-indexer-v1.json";

const ROUTER = "0x34965F2A2ee9254522232C32F02056E92BE0C98a";
const GRAPH_FACTORY = "0x0B6b3F40f84Df25D3bd69238f937096177DD09Bd";
const PERMIT_AUTHORITY = "0xeD617CE7f82e2AB589aDeFFD319D1D872Bc8De06";
const POOL_MANAGER = "0x8366a39CC670B4001A1121B8F6A443A643e40951";
const START_BLOCK = "50469365";

function robinhoodAddressUrl(address: string) {
  return `https://robinhoodchain.blockscout.com/address/${address}`;
}

const events = [
  {
    name: "ProgrammableLaunchStampedV1",
    signature:
      "ProgrammableLaunchStampedV1(bytes32,address,address,address,bytes32,bytes32)",
    topic0:
      "0x6cf479a102f1eebc9244f48f8d68f6aa52b4c5a4516318df58ba46614a5b14f2",
    indexed: "launchId, token, hook",
    role: "Discovery",
  },
  {
    name: "ProgrammableLaunchRouteStampedV1",
    signature:
      "ProgrammableLaunchRouteStampedV1(bytes32,uint8,bytes32,bytes32,bytes32)",
    topic0:
      "0x45e7cc355b63ca67d6278a0d8d23470ce2a0741a9c60283d7dee712df7a877a5",
    indexed: "launchId, kind, routePayloadHash",
    role: "Discovery",
  },
  {
    name: "ProgrammableComponentStampedV1",
    signature: "ProgrammableComponentStampedV1(bytes32,address,uint8,bytes32)",
    topic0:
      "0x8147265e7396d6400cee8d049456a1f7438fdfbe2a7c81c976d51ba67e52ff4b",
    indexed: "launchId, component, kind",
    role: "Discovery",
  },
  {
    name: "EIP712DomainChanged",
    signature: "EIP712DomainChanged()",
    topic0:
      "0x0a6387c9ea3628b88a633bb4f3b151770f70085117a15f9bf3787cda53f13d31",
    indexed: "none",
    role: "Not a launch signal",
  },
] as const;

const requestStatuses = [
  "received",
  "validating",
  "action_required",
  "authorized",
  "awaiting_wallet_signature",
  "wallet_action_required",
  "submitted",
  "sequencer_soft_confirmed",
  "ethereum_posted",
  "finalized",
  "failed",
] as const;

const curlExample = `curl --fail --silent --show-error \\
  '${FINALIZED_FEED_URL}?limit=25'`;

const typescriptExample = `import { createHash } from "node:crypto";
import { createPublicClient, http, type Abi } from "viem";

import {
  parseFinalizedPage,
} from "./generated/custom-launch-v4";
import { index } from "./index";
import {
  verifyCompleteRouterBinding,
} from "./verify-complete-router-binding";

/*
 * This is the pagination and enrichment loop, not a shortened Router verifier.
 * Generate parseFinalizedPage from the complete V4 OpenAPI schemas.
 * verifyCompleteRouterBinding must throw unless it independently verifies:
 * - RPC chain 4663 and the receipt identified by onchain.l2Inclusion;
 * - exact L2 transaction/block/hash and launch/route event-log positions;
 * - two independent chain-1 RPC readbacks of the distinct onchain.l1Posting
 *   event and onchain.l1FinalizedCheckpoint block/hash;
 *   deprecated flat blockNumber/blockHash/logIndex are a stage projection,
 *   not a transaction locator, and MUST NOT replace the nested coordinates;
 * - Router runtime plus CHAIN_ID, Graph Factory, permit authority and
 *   PoolManager address/runtime immutable getters at the L2 receipt block;
 * - the exact receipt and contiguous Component -> Route -> Launch event group;
 * - every launchStamp field, token/pool/component lookup, stampProof and
 *   component runtime, plus event and top-level/onchain commitment bindings.
 * Never replace that function with a kind-only launchStamp read.
 */
const origin = "${API_ORIGIN}";
const readinessResponse = await fetch("${READINESS_URL}", {
  headers: { accept: "application/json" },
});
if (!readinessResponse.ok) throw new Error("UNAVAILABLE: release readiness");
const readiness = await readinessResponse.json() as {
  status?: string;
  openApiSha256?: string;
};
if (readiness.status !== "ready") {
  throw new Error("UNAVAILABLE: release readiness is not ready");
}

const openApiResponse = await fetch(new URL("${OPENAPI_URL}", "https://programmable.market"));
if (!openApiResponse.ok) throw new Error("UNAVAILABLE: V4 OpenAPI");
const openApiBytes = new Uint8Array(await openApiResponse.arrayBuffer());
const openApiSha256 = "sha256:" + createHash("sha256").update(openApiBytes).digest("hex");
if (readiness.openApiSha256 !== openApiSha256) {
  throw new Error("UNAVAILABLE: V4 OpenAPI/readiness digest mismatch");
}

const abiUrl = new URL("${ABI_URL}", "https://programmable.market");
const abiResponse = await fetch(abiUrl);
if (!abiResponse.ok) throw new Error("UNAVAILABLE: Router ABI");
const abiText = await abiResponse.text();
const abiSha256 = createHash("sha256").update(abiText).digest("hex");
if (abiSha256 !== "bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86") {
  throw new Error("INDETERMINATE: Router ABI hash mismatch");
}

const routerAbi: Abi = JSON.parse(abiText);
const robinhoodClient = createPublicClient({
  transport: http(process.env.ROBINHOOD_RPC_URL),
});
const ethereumClients = [
  {
    providerId: "drpc",
    trustDomain: "drpc.org",
    client: createPublicClient({ transport: http(process.env.ETHEREUM_DRPC_RPC_URL) }),
  },
  {
    providerId: "quicknode",
    trustDomain: "quicknode.com",
    client: createPublicClient({ transport: http(process.env.ETHEREUM_QUICKNODE_RPC_URL) }),
  },
];
if (await robinhoodClient.getChainId() !== 4663) {
  throw new Error("INDETERMINATE: RPC is not chain 4663");
}
if ((await Promise.all(ethereumClients.map(({ client }) => client.getChainId())))
  .some((chainId) => chainId !== 1)) {
  throw new Error("INDETERMINATE: finality RPC is not chain 1");
}

let cursor: string | null = null;
const seenCursors = new Set<string>();
do {
  const url = new URL("/v4/chains/4663/finalized-custom-launches", origin);
  url.searchParams.set("limit", "25");
  if (cursor) {
    if (seenCursors.has(cursor)) {
      throw new Error("INDETERMINATE: repeated pagination cursor");
    }
    seenCursors.add(cursor);
    url.searchParams.set("cursor", cursor);
  }

  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error("UNAVAILABLE: finalized feed HTTP " + response.status);
  }

  const page = parseFinalizedPage(await response.json());
  if (page.chainId !== "4663" || page.caip2 !== "eip155:4663") {
    throw new Error("INDETERMINATE: chain identity mismatch");
  }
  const { sourceRowCount, publishedRowCount, quarantinedRowCount } = page.quality;
  if (
    sourceRowCount !== publishedRowCount ||
    quarantinedRowCount !== 0 ||
    page.launches.length > publishedRowCount ||
    page.quality.status !== "ready"
  ) {
    throw new Error("INDETERMINATE: inconsistent global feed-quality totals");
  }

  for (const launch of page.launches) {
    if (
      launch.platformId !== "programmable" ||
      launch.category !== "custom" ||
      launch.onchain.terminal !== true ||
      launch.onchain.checkpointType !== "ethereum_finalized" ||
      launch.onchain.schemaVersion !==
        "programmable.custom-launch-onchain-evidence.v3" ||
      launch.onchain.l2Inclusion.schemaVersion !==
        "programmable.custom-launch-l2-inclusion.v1" ||
      launch.onchain.l2Inclusion.chainId !== "4663" ||
      launch.onchain.l2Inclusion.caip2 !== "eip155:4663" ||
      launch.onchain.l2Inclusion.receiptStatus !== "success" ||
      launch.onchain.l1Posting === null ||
      launch.onchain.l1FinalizedCheckpoint === null ||
      launch.onchain.l1Posting.schemaVersion !==
        "programmable.custom-launch-l1-posting.v1" ||
      launch.onchain.l1Posting.chainId !== "1" ||
      launch.onchain.l1Posting.caip2 !== "eip155:1" ||
      launch.onchain.l1Posting.rollup !==
        "0x23A19d23e89166adedbDcB432518AB01e4272D94" ||
      launch.onchain.l1Posting.sequencerInbox !==
        "0xBd0D173EEb87D57A09521c24388a12789F33ba96" ||
      launch.onchain.l1FinalizedCheckpoint.schemaVersion !==
        "programmable.custom-launch-l1-finalized-checkpoint.v1" ||
      launch.onchain.l1FinalizedCheckpoint.chainId !== "1" ||
      launch.onchain.l1FinalizedCheckpoint.caip2 !== "eip155:1" ||
      launch.onchain.l1FinalizedCheckpoint.consensusCheckpointTag !== "finalized" ||
      launch.sourceVerification.status !== "exact_match" ||
      launch.onchain.router !== "${ROUTER}"
    ) {
      throw new Error("INDETERMINATE: incomplete identity, finality or Router binding");
    }

    const verified = await verifyCompleteRouterBinding({
      robinhoodClient,
      ethereumClients,
      routerAbi,
      launch,
      expected: {
        chainId: 4663,
        caip2: "eip155:4663",
        startBlock: 50_469_365n,
        router: "${ROUTER}",
        routerRuntimeCodeHash:
          "0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388",
        graphFactory: "${GRAPH_FACTORY}",
        graphFactoryRuntimeCodeHash:
          "0xd23692fae59331592048e71a96d4963e170ee56e449683dc9f7fa3f9470018b8",
        permitAuthority: "${PERMIT_AUTHORITY}",
        permitAuthorityRuntimeCodeHash:
          "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
        poolManager: "${POOL_MANAGER}",
        poolManagerRuntimeCodeHash:
          "0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626",
        l1Rollup: "0x23A19d23e89166adedbDcB432518AB01e4272D94",
        l1SequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
        launchKind: 1,
      },
    });

    index({
      platformId: launch.platformId,
      category: launch.category,
      label: "Programmable Custom",
      chain: "eip155:4663",
      routerLaunchId: launch.onchain.routerLaunchId,
      tokenAddress: verified.token,
      tokenMetadata: launch.projectMetadata.token,
      provenance: "STAMPED",
      finality: "FINALIZED",
      feedAvailability: "AVAILABLE",
      security: "UNVERIFIED",
      marketSupport: "UNVERIFIED",
      feePolicyApplicability: "UNVERIFIED",
      feeBehavior: "UNAVAILABLE",
    });
  }

  cursor = page.nextCursor;
} while (cursor);`;

const sections = [
  { id: "launch-sources", label: "Choose a source" },
  { id: "multi-role-v2", label: "MultiRole V2" },
  { id: "boundary", label: "Current boundary" },
  { id: "identity", label: "Identity and label" },
  { id: "binding", label: "Router and registry" },
  { id: "events", label: "Events and topics" },
  { id: "feed", label: "Feed and pagination" },
  { id: "finality", label: "Status and finality" },
  { id: "result-states", label: "Independent result axes" },
  { id: "examples", label: "Integration examples" },
  { id: "support", label: "Support" },
] as const;

export default function RobinhoodTerminalIndexerPage() {
  return (
    <DocsShell
      currentPath="/developer-reference/robinhood-terminal-indexer"
      description="Use the chain-bound Router and finalized feed to identify Programmable Custom launches on Robinhood Chain. Resolve public self-serve activation live and report fee behavior separately."
      kicker="Trading terminal integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={sections}
      title="Index Programmable Custom on Robinhood"
    >
      <p className={styles.bodyCopy}>Module Mode uses a native launch source. Follow the
        {" "}<a href="/developer-reference/module-mode-indexing">Module Mode indexing reference</a> for those
        coins. Both sources can share an index keyed by chain and token address.</p>
      <section id="launch-sources">
        <div className={styles.sectionIntro}>
          <h2>Choose the Custom Launch source</h2>
          <p>Separate token and hook contracts use V4 with Router V1. Shared-role projects use MultiRole V2 with Router V2. Each has its own feed, schema and finality projection. The V1 reference below applies to the separate-contract source.</p>
        </div>
        <p className={styles.bodyCopy}>Use the chain and token address as coin identity. Select the verifier by Router protocol and source version. Module names, project names and optional charts do not determine whether a verified launch exists.</p>
      </section>
      <section id="multi-role-v2">
        <div className={styles.sectionIntro}>
          <h2>Index MultiRole V2 launches</h2>
          <p>Read <a href={`${API_ORIGIN}/v4/chains/4663/multi-role-custom-launches/capabilities`}>MultiRole capabilities</a> and its complete context, then traverse the public <a href={`${API_ORIGIN}/v4/chains/4663/multi-role-custom-launches/finalized`}>finalized feed</a>. The Router protocol is <code>programmable.multi-role-launch-stamp-router.v2</code>.</p>
        </div>
        <p className={styles.bodyCopy}>The list uses <code>programmable.multi-role-finalized-metadata-list.v2</code> and each record uses <code>programmable.multi-role-finalized-metadata.v2</code>. Pass opaque cursors unchanged until <code>nextCursor</code> is null. Keep <code>apiLaunchId</code> separate from <code>onchainLaunchId</code>, and use <code>market.token</code> for coin identity.</p>
        <p className={styles.bodyCopy}>A physical component with <code>roleMask: 3</code> implements both token and hook roles. Those addresses may be equal. Preserve its complete role mask and runtime binding; do not apply the V1 distinct-role rules or event decoder to V2.</p>
        <p className={styles.bodyCopy}>In this projection, <code>onchain.blockNumber</code>, <code>blockHash</code> and <code>transactionHash</code> identify L2 inclusion. <code>ethereumPosting</code> and <code>ethereumFinalizedCheckpoint</code> identify separate L1 evidence. Require the published V2 protected finality and original source, request and artifact bindings.</p>
        <p className={styles.bodyCopy}>External source publication may be <code>not_verified</code> and indexer publication <code>not_claimed</code>. Preserve these results independently from protected finality. V4&apos;s different exact-source response contract does not apply to the V2 projection. Follow the <a href={`${API_ORIGIN}/v4/chains/4663/multi-role-custom-launches/guide.md`}>MultiRole integration contract</a> for the complete fields and verification rules.</p>
      </section>
      <section id="boundary">
        <div className={styles.sectionIntro}>
          <h2>Resolve activation from the live authority</h2>
          <p>
            This contract covers public self-serve Robinhood Custom launches.
            Resolve current availability from the live discovery and readiness
            authorities before every create or ingestion session. Documentation
            and a reachable route do not prove that production writes are
            active.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Chain</dt>
            <dd>
              Robinhood Chain Mainnet · <code>4663</code> ·{" "}
              <code>eip155:4663</code>
            </dd>
          </div>
          <div>
            <dt>Target launch path</dt>
            <dd>Public self-serve, with separate controller-wallet review</dd>
          </div>
          <div>
            <dt>Public activation authority</dt>
            <dd>
              Live discovery <code>customLaunchApi.versions.v4</code> plus the
              chain-bound readiness response
            </dd>
          </div>
          <div>
            <dt>Live create gate</dt>
            <dd>
              Require <code>versions.v4.publicWrites: true</code>,{" "}
              <code>publicAuthorization: true</code> and{" "}
              <code>releaseReady: true</code> from the live discovery document
            </dd>
          </div>
          <div>
            <dt>Indexer read path</dt>
            <dd>
              Require a schema-valid feed response with{" "}
              <code>quality.status: ready</code>; verify finality and
              authoritative exact-source eligibility independently for every
              item
            </dd>
          </div>
          <div>
            <dt>Public-item authority</dt>
            <dd>
              The live finalized feed only, followed by the Router, finality and
              exact-source verification steps in this guide
            </dd>
          </div>
          <div>
            <dt>Release binding</dt>
            <dd>
              Require the source commit, source tree, policy and deployment
              evidence returned by the live readiness authority
            </dd>
          </div>
          <div>
            <dt>Required fee policy</dt>
            <dd>
              Resolve the complete current value from live discovery at{" "}
              <code>customLaunchApi.versions.v4.platformFeePolicy</code>
            </dd>
          </div>
          <div>
            <dt>Fee behavior claim</dt>
            <dd>
              <code>false</code>
            </dd>
          </div>
          <div>
            <dt>Fixture feed example</dt>
            <dd>
              <code>0</code> eligible V3-finalized, authoritatively
              source-verified candidates / <code>0</code> published /{" "}
              <code>0</code> quarantined. This is a schema-valid parser vector,
              not a production observation. Always fetch the live feed.
            </dd>
          </div>
        </dl>

        <aside className={styles.callout}>
          <strong>Activation and fee behavior are different facts</strong>
          <p>
            Before creating, fetch{" "}
            <a href={WELL_KNOWN_URL}>the live discovery document</a> and the
            readiness authority. A <code>ready</code> runtime response proves
            service composition, not write activation. The current global fee
            configuration comes from discovery; it is not proof of canonical
            onchain enforcement, a charged fee or platform revenue.
          </p>
        </aside>

        <aside className={styles.callout}>
          <strong>Source-verification authority</strong>
          <p>
            Sourcify&apos;s provider-native match is a non-authoritative
            observation with <code>releaseAuthority: false</code>. Public
            finalized eligibility additionally requires a protected source
            closure, reproducible hosted build and compiler settings, finalized
            creation transaction, and exact creation/runtime bytecode binding
            for every launch component. Robinhood Blockscout is optional and
            cannot satisfy or block that authority or revise finality. Until
            that per-launch evidence is captured, persisted and promoted, do not
            infer a public feed item.
          </p>
        </aside>
      </section>

      <section id="identity">
        <div className={styles.sectionIntro}>
          <h2>Use one chain-bound identity and label</h2>
          <p>
            Require the server-authored <code>platformId: programmable</code>{" "}
            and <code>category: custom</code>, then independently verify their
            Router launch kind <code>1</code> binding. Names, symbols, factories
            and hook addresses are not provenance by themselves.
          </p>
        </div>

        <dl className={styles.dataList}>
          <div>
            <dt>Platform ID</dt>
            <dd>
              <code>programmable</code>
            </dd>
          </div>
          <div>
            <dt>Category</dt>
            <dd>
              <code>custom</code>
            </dd>
          </div>
          <div>
            <dt>Public label</dt>
            <dd>Programmable Custom</dd>
          </div>
          <div>
            <dt>Launch kind</dt>
            <dd>
              <code>LaunchKindV1.CustomGraph = 1</code>
            </dd>
          </div>
          <div>
            <dt>Durable key</dt>
            <dd className={styles.breakableValue}>
              <code>(eip155:4663, Router address, onchain.routerLaunchId)</code>
            </dd>
          </div>
        </dl>

        <p className={styles.bodyCopy}>
          Keep the API request UUID in <code>launchId</code> separate from the
          onchain <code>routerLaunchId</code>. Normalize token and contract
          addresses only inside the <code>eip155:4663</code> namespace. Never
          derive platform or category from client-controlled project metadata,
          and never merge an address with the same bytes on another chain.
        </p>
      </section>

      <section id="binding">
        <div className={styles.sectionIntro}>
          <h2>Bind to Launch Stamp Router V1</h2>
          <p>
            Robinhood provenance uses the Router&apos;s embedded launch-stamp
            registry. There is no separate authoritative Custom Registry for
            this generation.
          </p>
        </div>

        <dl className={`${styles.dataList} ${styles.technicalData}`}>
          <div>
            <dt>Generation</dt>
            <dd>
              <code>programmable-launch-stamp-router-v1</code>
            </dd>
          </div>
          <div>
            <dt>Provenance start block</dt>
            <dd>
              <code>{START_BLOCK}</code>
            </dd>
          </div>
          <div>
            <dt>Router and registry</dt>
            <dd>
              <DocsAddress
                address={ROUTER}
                explorerUrl={robinhoodAddressUrl(ROUTER)}
                label="Robinhood Launch Stamp Router"
              />
            </dd>
          </div>
          <div>
            <dt>Router runtime Keccak-256</dt>
            <dd>
              <code>
                0x1dbbdaaad901ea3c6134dca0d4872a4789b3c071bf8ccfb44edd65d26d817388
              </code>
            </dd>
          </div>
          <div>
            <dt>Profile-normalized ABI SHA-256 (jq -cS plus LF)</dt>
            <dd>
              <code>
                0xab25262ce1cb907eba1cb820492754c0cd5d7278eb5fd6a024ba24c767323ac0
              </code>
            </dd>
          </div>
          <div>
            <dt>Hosted ABI byte SHA-256</dt>
            <dd>
              <code>
                bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86
              </code>
            </dd>
          </div>
          <div>
            <dt>Graph Factory</dt>
            <dd>
              <DocsAddress
                address={GRAPH_FACTORY}
                explorerUrl={robinhoodAddressUrl(GRAPH_FACTORY)}
                label="Robinhood Graph Factory"
              />
            </dd>
          </div>
          <div>
            <dt>Permit authority</dt>
            <dd>
              <DocsAddress
                address={PERMIT_AUTHORITY}
                explorerUrl={robinhoodAddressUrl(PERMIT_AUTHORITY)}
                label="Robinhood permit authority"
              />
            </dd>
          </div>
          <div>
            <dt>PoolManager</dt>
            <dd>
              <DocsAddress
                address={POOL_MANAGER}
                explorerUrl={robinhoodAddressUrl(POOL_MANAGER)}
                label="Robinhood PoolManager"
              />
            </dd>
          </div>
        </dl>

        <p className={styles.bodyCopy}>
          Download the <a href={ABI_URL}>complete Router ABI</a> and hash its
          exact served bytes before decoding. The hosted-file digest covers
          exact bytes. The profile digest hashes one compact <code>jq -cS</code>{" "}
          serialization plus its trailing LF; the two digests are intentionally
          not interchangeable. The fixture records both. At{" "}
          <code>onchain.l2Inclusion.blockNumber</code>, also match the Router
          runtime and immutable <code>CHAIN_ID</code>, permit authority, Graph
          Factory and PoolManager getters to the live capabilities document.
          Confirm the L2 receipt block hash and event positions first. Do not
          use the deprecated flat checkpoint projection for these chain-4663
          reads.
        </p>
      </section>

      <section id="events">
        <div className={styles.sectionIntro}>
          <h2>Discover all Router events, then verify getters</h2>
          <p>
            Accept logs only from the exact Router address at or after block{" "}
            <code>{START_BLOCK}</code>. The three stamp events are discovery
            candidates, not final provenance by themselves.
          </p>
        </div>

        <div
          aria-label="Robinhood Launch Stamp Router events"
          className={styles.tableScroll}
          role="region"
          tabIndex={0}
        >
          <table className={styles.eventTable}>
            <caption>Robinhood Launch Stamp Router event topics</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Full signature</th>
                <th scope="col">topic0</th>
                <th scope="col">Indexed inputs</th>
                <th scope="col">Role</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.topic0}>
                  <th scope="row">{event.name}</th>
                  <td>
                    <code>{event.signature}</code>
                  </td>
                  <td>
                    <code>{event.topic0}</code>
                  </td>
                  <td>{event.indexed}</td>
                  <td>{event.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ol className={styles.steps}>
          <li>Correlate all stamp events by the indexed launch ID.</li>
          <li>
            Resolve <code>launchStamp(bytes32)</code> and the token, pool or
            component lookup at the verified{" "}
            <code>onchain.l2Inclusion.blockNumber</code>.
          </li>
          <li>
            Require launch kind <code>1</code>, exact token, hook, PoolManager,
            pool ID, route launcher, component proofs and stamp commitments.
          </li>
          <li>
            Treat Graph Factory logs as execution diagnostics only. They do not
            replace the Router stamp or its registry reads.
          </li>
        </ol>
      </section>

      <section id="feed">
        <div className={styles.sectionIntro}>
          <h2>Use the public finalized feed for discovery</h2>
          <p>
            The feed is unauthenticated, newest first and bounded. Status and
            request-history routes require a Bearer API key and are not terminal
            discovery feeds.
          </p>
        </div>

        <ul className={styles.linkList}>
          <li>
            <a href={WELL_KNOWN_URL}>Public release and activation discovery</a>
            <span>
              Resolve the current V4 write and authorization gates before
              create.
            </span>
          </li>
          <li>
            <a href={CAPABILITIES_URL}>Capabilities and chain bindings</a>
            <span>
              Resolve routes, contracts, profile and current safety flags.
            </span>
          </li>
          <li>
            <a href={READINESS_URL}>Runtime release identity</a>
            <span>
              Check exact backend source, tree, policy and finality composition.
            </span>
          </li>
          <li>
            <a href={FINALIZED_FEED_URL}>Finalized Custom launch feed</a>
            <span>
              Ingest only terminal <code>ethereum_finalized</code> items.
            </span>
          </li>
          <li>
            <a href={OPENAPI_URL}>Robinhood V4 OpenAPI</a>
            <span>
              Hash the exact bytes, require equality with readiness{" "}
              <code>openApiSha256</code>, then validate the full response.
            </span>
          </li>
          <li>
            <a download href={FIXTURE_URL}>
              Download the terminal integration fixture
            </a>
            <span>
              Exact bindings, topics, lifecycle, live-authority paths and a
              schema-valid empty-feed vector for fail-closed tests. It carries
              no production status or current fee values.
            </span>
          </li>
        </ul>

        <ol className={styles.steps}>
          <li>
            Before generating types or validating data, hash the exact hosted
            OpenAPI bytes and require equality with the top-level{" "}
            <code>openApiSha256</code> in a <code>ready</code> response. A
            missing or mismatched digest is <code>UNAVAILABLE</code>.
          </li>
          <li>
            Fetch <code>?limit=25</code>. Do not cache beyond the
            response&apos;s HTTP policy without preserving an explicit observed
            time.
          </li>
          <li>
            Require <code>chainId: &quot;4663&quot;</code> and{" "}
            <code>caip2: &quot;eip155:4663&quot;</code> on every page and item.
          </li>
          <li>
            Process the page, then pass an unchanged non-null{" "}
            <code>nextCursor</code> as the next <code>cursor</code> value.
          </li>
          <li>
            Stop and return <code>UNAVAILABLE</code> when the endpoint request
            fails. A malformed eligible V3 candidate must fail the whole
            request; do not accept a row-wise quarantine or partial success.
          </li>
          <li>
            Treat <code>sourceRowCount</code>, <code>publishedRowCount</code>{" "}
            and <code>quarantinedRowCount</code> as global finalized-dataset
            totals, not page lengths. A successful response must be{" "}
            <code>ready</code>, with source equal to published and quarantined
            equal to zero. The current <code>launches.length</code> may be
            smaller than published but must never be larger.
          </li>
        </ol>
      </section>

      <section id="finality">
        <div className={styles.sectionIntro}>
          <h2>Keep request status separate from finality</h2>
          <p>
            Request history has a lifecycle <code>status</code>. A
            finalized-feed item does not. Its route and schema establish the
            feed class; require <code>onchain.terminal: true</code> and{" "}
            <code>onchain.checkpointType: ethereum_finalized</code>, plus
            non-null V3 <code>l2Inclusion</code>, <code>l1Posting</code> and{" "}
            <code>l1FinalizedCheckpoint</code> evidence on the item.
          </p>
        </div>

        <div
          aria-label="Robinhood Custom request statuses"
          className={styles.tableScroll}
          role="region"
          tabIndex={0}
        >
          <table className={styles.eventTable}>
            <caption>Robinhood Custom request status handling</caption>
            <thead>
              <tr>
                <th scope="col">Status</th>
                <th scope="col">Terminal listing rule</th>
              </tr>
            </thead>
            <tbody>
              {requestStatuses.map((status) => (
                <tr key={status}>
                  <th scope="row">
                    <code>{status}</code>
                  </th>
                  <td>
                    {status === "finalized"
                      ? "Lifecycle terminal; correlate with a terminal ethereum_finalized feed item"
                      : "Do not publish as a finalized terminal listing"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className={styles.checkList}>
          <li>
            <code>sequencer_soft_confirmed</code> remains reversible.
          </li>
          <li>
            <code>ethereum_posted</code> proves posting, not Ethereum finality.
          </li>
          <li>
            Use <code>onchain.l2Inclusion</code> for the exact chain-4663
            transaction, block and Router event positions. Replay and match the
            receipt before reading the Router at that block; the route-event log
            index must precede the launch-event log index in that receipt.
            Require the top-level <code>onchain.transactionHash</code> to equal
            the nested L2 transaction hash.
          </li>
          <li>
            Use <code>onchain.l1Posting</code> only for the Ethereum
            batch-posting event and <code>onchain.l1FinalizedCheckpoint</code>{" "}
            only for the common finalized checkpoint. Require rollup{" "}
            <code>0x23A19d23e89166adedbDcB432518AB01e4272D94</code>,
            SequencerInbox{" "}
            <code>0xBd0D173EEb87D57A09521c24388a12789F33ba96</code>, and chain{" "}
            <code>eip155:1</code>. Its ordered provider readbacks are{" "}
            <code>drpc / drpc.org</code> then{" "}
            <code>quicknode / quicknode.com</code>; bind them to the chain
            deployment&apos;s Ethereum-finality evidence and keep all L1
            coordinates separate from the L2 receipt.
          </li>
          <li>
            The flat <code>onchain.blockNumber</code>, <code>blockHash</code>{" "}
            and <code>logIndex</code> fields are a deprecated stage projection.
            They are not a transaction locator; at the finalized stage the log
            index belongs to <code>l1Posting</code>, not the
            finalized-checkpoint block. Never combine them with the top-level L2
            transaction hash.
          </li>
          <li>
            If any nested coordinate is missing or disagrees with its provider
            readback, finality or provenance is <code>INDETERMINATE</code> on
            the affected axis. Historical V2 evidence remains private
            authenticated history and is never a finalized public-feed
            candidate. Only a separate, fully revalidated canonical V3-finalized
            projection may qualify on its own evidence.
          </li>
          <li>
            Require <code>sourceVerification.status: exact_match</code> and an{" "}
            <code>exact_match</code> status with its complete authoritative
            binding on every component. A provider-only Sourcify observation is
            not publication authority; queued, retrying and needs-attention
            states remain private authenticated history.
          </li>
          <li>
            For direct log indexing, retain an overlap, compare canonical block
            hashes and rewind to the last common finalized checkpoint after a
            reorg.
          </li>
          <li>
            For the public feed, remove a cached item if a later complete fetch
            no longer contains it inside the replay window. Never silently keep
            an orphaned observation as finalized.
          </li>
        </ul>
      </section>

      <section id="result-states">
        <div className={styles.sectionIntro}>
          <h2>Return explicit, independent result axes</h2>
          <p>
            Provenance, authoritative source verification, security, finality,
            market support and fee behavior are separate facts. Feed
            availability and write activation are separate again. One axis must
            never fill or erase another.
          </p>
        </div>

        <dl className={styles.resultList}>
          <div>
            <dt>
              <code>STAMPED</code>
            </dt>
            <dd>
              Provenance only: every Router binding, canonical read and event
              correlation succeeds at the V3 <code>l2Inclusion</code> receipt
              block.
            </dd>
          </div>
          <div>
            <dt>
              <code>NOT_STAMPED</code>
            </dt>
            <dd>
              A canonical Router lookup succeeds and returns zero. A direct
              deployment outside this Router has no Programmable launch stamp.
            </dd>
          </div>
          <div>
            <dt>
              <code>UNAVAILABLE</code>
            </dt>
            <dd>
              Use on the affected availability, write-activation or fee axis. It
              does not turn an independently proven stamp into unavailable
              provenance. An explicit false create gate is <code>INACTIVE</code>
              , not <code>UNAVAILABLE</code>.
            </dd>
          </div>
          <div>
            <dt>
              <code>INDETERMINATE</code>
            </dt>
            <dd>
              Use on provenance or finality when its runtime, ABI, provider,
              required V3 L2/L1 coordinate or finality evidence is missing or
              disagrees. Do not use it as a synonym for <code>NOT_STAMPED</code>
              .
            </dd>
          </div>
        </dl>

        <p className={styles.bodyCopy}>
          An existing finalized <code>STAMPED</code> launch remains indexable
          when public writes are inactive or unavailable and when fee behavior
          is <code>UNAVAILABLE</code>.
        </p>

        <div className={styles.guideColumns}>
          <article>
            <h3>Provenance, source and finality</h3>
            <p className={styles.bodyCopy}>
              Publish <strong>Programmable Custom</strong> only after Router
              provenance, authoritative exact-source binding and finality pass.
              These remain separate results; source verification cannot replace
              Router provenance or finality, and none is a safety endorsement.
            </p>
          </article>
          <article>
            <h3>Security and market support</h3>
            <p className={styles.bodyCopy}>
              A stamp is not an audit, endorsement, liquidity check or trading
              guarantee. Derive pool activity, liquidity, swap support and token
              risk independently.
            </p>
          </article>
          <article>
            <h3>Platform fee</h3>
            <p className={styles.bodyCopy}>
              Do not hardcode a rate or recipient from this page or the fixture.
              Resolve the current global requirement from live discovery at{" "}
              <code>customLaunchApi.versions.v4.platformFeePolicy</code> and
              preserve its rate, percentage, recipient, scope and enforcement
              fields together. Report actual fee behavior as{" "}
              <code>UNAVAILABLE</code> unless separately proven: basis,
              currency, accounting, rounding, accrual and claim mechanics may
              remain unknown, while canonical onchain enforcement and revenue
              are not guaranteed. Do not copy the global policy onto a finalized
              feed row: per-launch applicability remains <code>UNVERIFIED</code>{" "}
              unless the backend publishes an explicit launch binding. Do not
              infer that a direct Router transaction or any path outside the V4
              API carries the policy. Fee-path absence is not a write-activation
              blocker.
            </p>
          </article>
        </div>
      </section>

      <section id="examples">
        <div className={styles.sectionIntro}>
          <h2>Start with the finalized feed</h2>
          <p>
            These Node.js examples perform no write, wallet action, trade or fee
            claim. Set <code>ROBINHOOD_RPC_URL</code> to a trusted chain-4663
            provider, <code>ETHEREUM_DRPC_RPC_URL</code> and{" "}
            <code>ETHEREUM_QUICKNODE_RPC_URL</code> to the independently
            configured chain-1 providers before running the TypeScript example.
          </p>
        </div>

        <h3 className={styles.subheading}>cURL</h3>
        <pre className={styles.codeExample} tabIndex={0}>
          <code>{curlExample}</code>
        </pre>

        <h3 className={styles.subheading}>
          TypeScript enrichment loop (complete verifier required)
        </h3>
        <p className={styles.bodyCopy}>
          This short loop deliberately imports an OpenAPI-generated response
          parser and a separate <code>verifyCompleteRouterBinding</code>{" "}
          implementation. It is not a standalone Router verifier. Never emit{" "}
          <code>STAMPED</code> after checking only the launch kind: the imported
          verifier must replay the exact V3 <code>l2Inclusion</code> receipt,
          then satisfy every L2 block, runtime, immutable, event, lookup, proof
          and commitment check listed in the code before it returns. It must
          also keep <code>l1Posting</code> and{" "}
          <code>l1FinalizedCheckpoint</code> distinct and ignore the deprecated
          flat trio as a transaction locator.
        </p>
        <pre className={styles.codeExample} tabIndex={0}>
          <code>{typescriptExample}</code>
        </pre>

        <aside className={styles.callout}>
          <strong>Production rule</strong>
          <p>
            First require the exact hosted OpenAPI byte digest to equal
            readiness <code>openApiSha256</code>. Then validate the complete
            schema, not only the fields shown in the short example. The current
            list and item schemas are closed: reject unknown fields and
            regenerate your parser for a published schema change. A missing
            required binding must fail closed.
          </p>
        </aside>
      </section>

      <section id="support">
        <div className={styles.sectionIntro}>
          <h2>Send a reproducible integration report</h2>
          <p>
            Include the chain, endpoint, UTC observation time, response status,
            Router, <code>l2Inclusion</code>, <code>l1Posting</code>,{" "}
            <code>l1FinalizedCheckpoint</code>, provider source and the public
            error code. Never send an API key, signed transaction or private
            request body.
          </p>
        </div>

        <ul className={styles.linkList}>
          <li>
            <a href="https://github.com/programmablehq/PROGRAMMABLE/issues">
              Report a documentation or integration issue
            </a>
            <span>Use a public issue only for non-sensitive evidence.</span>
          </li>
          <li>
            <a href="https://discord.com/invite/programmable">
              Contact Programmable support
            </a>
            <span>
              Share the minimum public coordinates needed to reproduce the
              problem.
            </span>
          </li>
        </ul>
      </section>

      <nav
        aria-label="Continue Robinhood integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/docs/developers/custom-launch#robinhood-v4">
              Read the Robinhood Custom Launch boundary
            </Link>
          </li>
          <li>
            <Link href="/docs/developers/indexing">
              Read the general Router indexing guide
            </Link>
          </li>
          <li>
            <a download href={FIXTURE_URL}>
              Download the terminal integration fixture
            </a>
          </li>
        </ul>
      </nav>
    </DocsShell>
  );
}
