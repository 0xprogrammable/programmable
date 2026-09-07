import type { Metadata } from "next";
import Link from "next/link";

import styles from "@/components/developer-docs.module.css";
import { DocsShell } from "@/components/docs-shell";
import { PROGRAMMABLE_AGENT_ENTRY } from "@/lib/agent-connection";
import { V4_API_PROFILE_VERSION } from "@/lib/custom-launch/v4-api-discovery";
import { robinhoodV4PublicContractDiscovery, robinhoodV4PublicLaunchRequirements } from "@/lib/custom-launch/v4-public-contract-discovery";

const robinhoodContract = robinhoodV4PublicContractDiscovery(V4_API_PROFILE_VERSION);
const robinhoodVersion = V4_API_PROFILE_VERSION === "4.1.0" ? "4.1.0" : "4.0.0";
const multiRoleProject = PROGRAMMABLE_AGENT_ENTRY.workflows.multiRoleProject;

export const metadata: Metadata = {
  title: "Custom Launch API · Programmable",
  description:
    "Choose a Custom Launch API, configure fees and funding, and track your project through wallet signing and finality.",
  alternates: { canonical: "/developer-reference/custom-launch" },
};

const customLaunchSections = [
  { id: "start-here", label: "Choose an API" },
  { id: "quickstart", label: "Ethereum V3 quickstart" },
  { id: "robinhood-v4", label: "Robinhood V4" },
  { id: "authentication", label: "Authentication" },
  { id: "existing-project-integration", label: "Existing projects" },
  { id: "v3-general", label: "V3 general hooks" },
  { id: "liquidity", label: "Liquidity and limits" },
  { id: "request", label: "Request contract" },
  { id: "fees", label: "Platform fee policy" },
  { id: "verification", label: "Exact-source verification" },
  { id: "checks", label: "Attested checks" },
  { id: "submit", label: "Submit safely" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "discovery", label: "Explore, Profile and claims" },
  { id: "errors", label: "Errors" },
  { id: "extensions", label: "Supported operations" },
] as const;

const requestFields = [
  ["schemaVersion", "programmable.custom-launch-create-request.v3"],
  ["launchWallet", "The Ethereum controller wallet for the launch"],
  ["chainId", "String 1"],
  ["nonce", "A nonzero lowercase bytes32"],
  ["sourceDescriptor", "One DeterministicSourceBundleV2 descriptor"],
  [
    "sourceBundleManifest",
    "One complete, non-empty, UTF-8 path-sorted SourceBundleManifestV2",
  ],
  ["graphBundle", "One executable CustomGraphBundleV1"],
  ["permitWindow", "The bounded Router permit validity window"],
  ["launchProfile", "The complete general hook profile"],
  ["launchProfileSelection", "The exact target-role and deployment bindings"],
  ["launchProfileHash", "The CLI-derived canonical profile digest"],
  ["launchIntentHash", "The CLI-derived request intent digest"],
  ["agentAttestation", "One self-attestation for the exact launch intent"],
  ["verificationBundle", "Exact source, compiler and constructor bindings"],
] as const;

const lifecycle = [
  ["received", "The request is durably accepted."],
  ["validating", "Request and graph validation are running."],
  [
    "pending_review",
    "Server-side admission and the selected lane's per-launch evidence decision are still running. No wallet transaction exists.",
  ],
  [
    "action_required",
    "One of the current profile's exact hard-blocking code-and-role rules matched. Read the exact bound report and contact support with the request ID when directed. This is not a wallet-signing stage.",
  ],
  [
    "awaiting_funding_authorization",
    "EIP-3009 mode only, after the server evidence gate: review and sign the exact typed data in the connected controller wallet.",
  ],
  [
    "funding_authorization_verified",
    "The separate funding signature was verified and final calldata construction can continue.",
  ],
  ["simulating", "The final graph and exact Router transaction are being simulated."],
  [
    "prepared",
    "The exact artifact exists. output.signedPermit and output.walletTransaction are both null. There is nothing for the wallet to sign yet.",
  ],
  [
    "authorized",
    "The server verified the evidence required by the selected lane, and the platform permit and exact output.walletTransaction exist. The controller wallet has not signed or broadcast it.",
  ],
  [
    "submitted",
    "Canonical Router event and same-block getter evidence match below 64 confirmations.",
  ],
  [
    "finalized",
    "The matching canonical evidence has at least 64 confirmations.",
  ],
  [
    "failed / cancelled",
    "The request is terminal. Read failure before deciding whether to create a new request.",
  ],
] as const;

const robinhoodV4Lifecycle = [
  ["received", "The immutable request is durably accepted. No wallet action exists."],
  [
    "validating",
    "Server validation, admission, external-reference checks and exact Router simulation bindings are running.",
  ],
  [
    "action_required",
    "Fix the server-authored remediation, rebuild and submit a new immutable request. This is not a wallet action or manual approval stage.",
  ],
  [
    "authorized",
    "Server gates passed and the exact wallet transaction is bound. It is not signed or broadcast.",
  ],
  [
    "awaiting_wallet_signature",
    "The controller must review and sign the exact transaction through the separate wallet handoff.",
  ],
  [
    "wallet_action_required",
    "The controller must verify chain 4663, sender, Router, value and calldata, then submit through the wallet.",
  ],
  ["submitted", "The exact wallet transaction was submitted; no chain checkpoint is implied."],
  [
    "sequencer_soft_confirmed",
    "Robinhood sequencer evidence exists but remains reversible.",
  ],
  [
    "ethereum_posted",
    "The Robinhood batch is posted to Ethereum but has not satisfied the finality policy.",
  ],
  [
    "finalized",
    "The exact launch evidence satisfies the published Robinhood-to-Ethereum finality policy.",
  ],
  [
    "failed",
    "Processing is terminal. Read the bound failure and remediation before creating a new request.",
  ],
] as const;

const robinhoodV4WalletStatusCommand =
  "programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized";
const robinhoodV4FinalityStatusCommand =
  "programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized";

const cliInstallCommands = [
  [
    'programmable_cli_dir="$(mktemp -d)"',
    "Create an isolated download directory.",
  ],
  [
    'curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz" https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz',
    "Download the pinned release asset.",
  ],
  [
    'curl --fail --location --output "$programmable_cli_dir/programmable-launch-3.3.9.tgz.sha256" https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz.sha256',
    "Download its checksum sidecar.",
  ],
  [
    '(cd "$programmable_cli_dir" && shasum -a 256 -c programmable-launch-3.3.9.tgz.sha256)',
    "Continue only after this reports OK.",
  ],
  [
    'npm install --global "$programmable_cli_dir/programmable-launch-3.3.9.tgz"',
    "Install the verified local bytes.",
  ],
] as const;

const errors = [
  [
    "400",
    "Fix malformed JSON, fields, query values or the idempotency key before retrying.",
  ],
  ["401", "Use an active, unexpired and unrevoked credential from PROGRAMMABLE_API_KEY."],
  [
    "403",
    "Use a credential with the required scope and access to the exact launch principal.",
  ],
  [
    "404",
    "Verify the request UUID and key. Do not infer whether another wallet owns that ID.",
  ],
  [
    "409",
    "Keep the original idempotency key and bytes. A conflicting binding must be fixed locally, not retried with changed bytes.",
  ],
  ["413", "Reduce the body to at most 8,388,608 bytes."],
  ["415", "Send Content-Type: application/json."],
  [
    "422",
    "Fix the reported source, graph, attestation, verification or permit binding. Do not retry unchanged.",
  ],
  [
    "429",
    "Honor Retry-After. An exact replay does not consume reservation quota.",
  ],
  [
    "503",
    "Honor Retry-After and retry only the byte-identical request. Service availability never grants wallet signing authority.",
  ],
  [
    "500",
    "Keep error.requestId for support and preserve the original request-byte binding.",
  ],
] as const;

export default function CustomLaunchApiDocsPage() {
  return (
    <DocsShell
      currentPath="/docs/developers/custom-launch"
      description="Choose the API for your network and contract layout, prepare the request, then sign from the controller wallet."
      kicker="Developer integration"
      parentHref="/docs/developers"
      parentLabel="Developers"
      sections={customLaunchSections}
      title="Custom Launch API"
    >

      <section id="start-here">
        <div className={styles.sectionIntro}>
          <h2>Choose an API for your project</h2>
          <p>
            The <Link href="/docs/developers/custom-launch-quickstart">step-by-step quickstart</Link>{" "}
            covers API keys, contract layout, fees, funding, submission and error recovery.
            Use this page for the detailed request and compatibility reference.
          </p>
        </div>
        <dl className={styles.dataList}>
          <div>
            <dt>Robinhood, separate token and hook</dt>
            <dd>
              Use the <a href="#robinhood-v4">V4 profile and CLI</a> selected by live discovery.
            </dd>
          </div>
          <div>
            <dt>Robinhood, shared token and hook</dt>
            <dd>
              Use the <a href={multiRoleProject.guide}>MultiRole V2 guide</a>,
              request packer and client. Its request format is separate from V4.
            </dd>
          </div>
          <div>
            <dt>Ethereum Mainnet</dt>
            <dd>
              Follow the <a href="#quickstart">V3 quickstart</a> and the profile
              accepted by Ethereum capabilities.
            </dd>
          </div>
        </dl>
        <p className={styles.bodyCopy}>
          Robinhood Native20 charges <strong>20 bps (0.20%)</strong> for Programmable
          per successful buy or sell. Creator and pool fees are additional. A zero
          creator rate produces zero creator rewards while the platform fee still
          accrues. Read the <a href="#fees">fee calculation and claim rules</a>.
        </p>
      </section>

      <section id="quickstart">
        <div className={styles.sectionIntro}>
          <h2>Ethereum V3 quickstart</h2>
          <p>
            Build exact artifacts locally, let the API make the server-side
            decision, then review and sign in the controller wallet. Public
            V3.3 creation is live on Ethereum Mainnet.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          Use public V3.3 for new Ethereum custom-hook launches. V2 and V1 history and
          schemas remain readable, but new requests are permanently write fenced
          with nonretryable{" "}
          <code>CUSTOM_LAUNCH_V2_READ_ONLY</code> and{" "}
          <code>CUSTOM_LAUNCH_V1_READ_ONLY</code>. On Ethereum, only V3.3 accepts new submissions.
          For Robinhood V4, read the live discovery manifest and use version {robinhoodVersion}{" "}
          only after its public release gates and immutable CLI evidence pass.
        </p>

        <ol className={styles.steps}>
          <li>
            Build and test every launch component from one exact source
            revision.
          </li>
          <li>
            Create a wallet-bound key from{" "}
            <Link href="/developers/api-keys">API keys</Link>, or use the
            partner credential issued to your integration. Store it only as{" "}
            <code>PROGRAMMABLE_API_KEY</code>.
          </li>
          <li>
            Install <code>@programmable/launch</code> 3.3.9 from the{" "}
            <a href="https://github.com/programmablehq/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz">
              immutable GitHub Release asset
            </a>
            , verify its checksum, then use the <code>programmable-launch</code>{" "}
            binary.
          </li>
          <li>
            Run <code>pack</code>, then <code>validate --remote</code> against
            the exact Standard JSON, artifacts and evidence. Never enter a
            derived hash by hand. Local validation prepares the request; the
            API server decides whether it may reach a wallet.
          </li>
          <li>
            Run{" "}
            <code>
              programmable-launch submit ./launch.json --config
              programmable-launch.config.json
            </code>
            , then watch status until <code>authorized</code>. Stop for
            controller-wallet review and signing, then watch the same request
            until <code>finalized</code>. The API and CLI never sign or
            broadcast.
          </li>
        </ol>

        <ul className={styles.codeList}>
          {cliInstallCommands.map(([command, description]) => (
            <li key={command}>
              <code>{command}</code>
              <span>{description}</span>
            </li>
          ))}
        </ul>

        <aside className={styles.callout}>
          <strong>Generate the request from the exact project</strong>
          <p>
            The CLI derives the sorted manifest, SourceDescriptor, graph,
            locators, CREATE2 addresses, canonical hashes and verification
            metadata. Do not copy test-only hashes or another project&apos;s file.
          </p>
        </aside>

        <aside className={styles.callout}>
          <strong>Follow live capabilities</strong>
          <p>
            CLI 3.3.9 defaults to profile 3.3.0. Profile 3.4 in the{" "}
            <a href="/openapi/custom-launch-v3.json">V3 machine contract</a>{" "}
            is a separate reference contract. Submit it only when discovery and backend
            capabilities accept it. V2 and V1 accept reads only, and legacy
            Registry and GitHub submission intake is closed.
          </p>
        </aside>

        <p className={styles.inlineAction}>
          <a href="/developers/custom-launch-api-v1.md">Open the raw compatibility guide</a>
        </p>
      </section>

      <section id="robinhood-v4">
        <div className={styles.sectionIntro}>
          <h2>Launch on Robinhood Chain</h2>
          {robinhoodVersion === "4.1.0" && (
            <p>
              If your token and hook share one physical contract, use the separate{" "}
              <a href={multiRoleProject.capabilities}>MultiRole V2 capabilities</a>{" "}
              and check current readiness and context before packing. If unavailable,
              stop before authenticated submission. Follow the{" "}
              <a href={multiRoleProject.guide}>MultiRole V2 guide</a> and{" "}
              <a href={multiRoleProject.client}>Node 24 client</a> for preflight,
              create and status. The automatic economic verifier accepts the exact
              Native20 recipe and supported constructor configuration. Different
              source code or unknown economics return <code>evidence_required</code>;
              follow the returned verification requirements before wallet handoff.
              This is not a generic audit of arbitrary hook code. The existing 4.1
              profile and CLI below remain a separate lane.
            </p>
          )}
          <p>
            Robinhood Chain Mainnet uses <code>chainId: 4663</code> and{" "}
            <code>eip155:4663</code>. Read both the V4 and chain entries in the{" "}
            <a href="/.well-known/programmable.json">live discovery manifest</a>.
            Stop before authenticated preflight or submission if either entry reports{" "}
            <code>publicWrites: false</code>,{" "}
            <code>publicAuthorization: false</code> or{" "}
            <code>releaseReady: false</code>, or a required field is missing.
            When all three gates are true in both entries, verify and install the
            immutable CLI release published in discovery.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          CLI <code>3.3.9</code> remains the installable release for live Ethereum
          V3. Robinhood V4 uses the profile advertised in live discovery,
          {" "}<code>{robinhoodVersion}</code> for this request contract.
          Verify its release manifest, exact source commit and tarball checksum.
          The{" "}
          <a href={robinhoodContract.openApiUrl ?? "/openapi/custom-launch-v4.json"}>V4 OpenAPI</a>,{" "}
          <a href={robinhoodContract.packConfigSchemaUrl ?? "/schemas/custom-launch/v4/pack-config.json"}>
            pack-config schema
          </a>{" "}
          and{" "}
          <a href={robinhoodContract.sourceVerificationSchemaUrl ?? "/schemas/custom-launch/v4/source-verification-status.json"}>
            source-verification schema
          </a>{" "}
          describe the V4 request contract. Re-read live discovery and current
          capabilities before use. Your platform API key authorizes requests;
          your wallet separately signs the onchain transaction and pays gas.
        </p>

        {robinhoodV4PublicLaunchRequirements(V4_API_PROFILE_VERSION).map((requirement) => (
          <p className={styles.bodyCopy} key={requirement}>{requirement}</p>
        ))}

        <dl className={`${styles.resultList} ${styles.lifecycleList}`}>
          {robinhoodV4Lifecycle.map(([status, meaning]) => (
            <div key={status}>
              <dt>
                <code>{status}</code>
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>

        <ul className={styles.codeList}>
          <li>
            <code>{robinhoodV4WalletStatusCommand}</code>
            <span>Stop for separate controller-wallet review and signing.</span>
          </li>
          <li>
            <code>{robinhoodV4FinalityStatusCommand}</code>
            <span>Poll the same chain-scoped resource after wallet broadcast.</span>
          </li>
        </ul>

        <aside className={styles.callout}>
          <strong>The CLI never signs or broadcasts</strong>
          <p>
            It can prepare and display the exact transaction. The controller
            separately verifies chain 4663, sender, Router, value and calldata,
            then decides whether to sign and submit through the wallet.
          </p>
        </aside>

        <p className={styles.bodyCopy}>
          Provider source verification starts only after <code>finalized</code>
          and remains independent. Finality does not imply{" "}
          <code>sourceVerification.status: exact_match</code>, and a provider retry
          does not revise finality. Programmable indexing, third-party indexing,
          trading readiness, Explore visibility and publication are separate
          outcomes.
        </p>
      </section>

      <section id="authentication">
        <div className={styles.sectionIntro}>
          <h2>Keep API credentials and wallet authority separate</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            The CLI writes a mode <code>0600</code> journal before the first
            request and binds the Idempotency-Key to exact request bytes. It
            never writes the API key.
          </li>
          <li>
            Wallet keys are managed through the connected controller wallet on{" "}
            <code>programmable.market</code>. Partner roots and subkeys are
            separate credentials advertised by{" "}
            <code>customLaunchApi.partnerCredentials</code> in discovery.
          </li>
          <li>
            A wallet key uses its bound wallet as <code>launchWallet</code>. A
            partner credential selects the exact controller in the request but
            cannot sign for it. The same current-profile metadata requirements
            apply to both credential kinds.
          </li>
          <li>
            Send <code>Authorization: Bearer $PROGRAMMABLE_API_KEY</code> only
            to <code>https://api.programmable.market</code>. Wallet keys,
            partner roots and bounded partner subkeys use the same canonical V3
            create, preflight, list and status routes within their scopes. The
            Router V1 permit-reissue disposition route is wallet-key-only.
          </li>
          <li>
            Do not send the website wallet session token to the Custom Launch
            API.
          </li>
          <li>
            A partner root may manage one level of subkeys. A child&apos;s scopes,
            budgets and expiry cannot exceed its root, and a child cannot manage
            credentials.
          </li>
          <li>
            A partner root reads every launch attributed to its partner. A subkey
            reads only its stable lineage, rotation preserves that lineage history,
            and a separately issued subkey cannot read root or sibling launches.
          </li>
          <li>
            API scopes grant API operations only. No wallet key, partner root or
            subkey can sign, broadcast or bypass launch gates.
          </li>
          <li>
            Store the secret outside source control and logs. Key lists never
            return the full secret again. Put only{" "}
            <code>$PROGRAMMABLE_API_KEY</code> in chat, prompts and agent setup.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          The V1 contract states a 90-day default expiry, a 366-day maximum and
          no more than 10 active keys per wallet.
        </p>
      </section>

      <section id="existing-project-integration">
        <div className={styles.sectionIntro}>
          <h2>Integrate an existing project without private instructions</h2>
          <p>
            An API key authorizes operations for its bound wallet. It does not
            contain policy or project instructions. Every cold agent starts at{" "}
            <a href="/.well-known/programmable.json">
              <code>/.well-known/programmable.json</code>
            </a>
            , reads <code>customLaunchApi.agentIntegration</code>, then fetches
            the advertised public contracts.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            Use the{" "}
            <a href="/policies/custom-launch-agent-remediation-v1.json">
              machine-readable remediation catalog
            </a>{" "}
            to inspect the exact repository, create{" "}
            <code>programmable-launch.config.json</code> and recover from local
            or API findings. The same catalog applies to every project; there
            is no project allowlist or private approval route.
          </li>
          <li>
            Pin the public source repository and exact immutable Git object,
            compile every target with{" "}
            <code>solc 0.8.26+commit.8a97fa7a</code>, identify the distinct
            token, hook and initializer roles, map address dependencies, and
            declare the real hook permissions, pool, funding, liquidity, fee,
            custody and withdrawal behavior. Collect the required token name,
            symbol, meaningful description, non-empty local image, website and X
            profile; other public links are optional.
          </li>
          <li>
            Create a <code>programmable.launch-pack-config.v3</code> input from
            exact source, Standard JSON, artifacts and structured ABI values,
            following the{" "}
            <a href="/schemas/custom-launch/v3/pack-config.json">
              machine-readable pack-config schema
            </a>
            . The CLI derives every digest, locator, CREATE2 address and request
            byte. Never copy or invent them.
          </li>
          <li>
            Fetch public <code>GET /v3/capabilities</code>, then run the exact
            request through <code>validate --remote</code>. The authenticated
            <code> POST /v3/custom-launches/preflight</code> uses those same bytes,
            consumes no launch-creation quota or durable launch reservation,
            allocates no nonce, persists no launch and never signs or broadcasts.
            The authenticated request still consumes its ordinary route rate budget,
            including a partner credential&apos;s <code>prepareRequestsPerHour</code>
            budget. It returns additive
             <code> riskClassification</code>, platform-owned
             <code> behaviorEvidence</code> and all six
             <code> productTruthAxes</code>: <code>deployment</code>,{" "}
             <code>trading</code>, <code>platform_fee_evidence</code>,{" "}
             <code>source_verification</code>, <code>indexing</code> and{" "}
             <code>featured</code>. A not-executed or needs-evidence result remains
             outstanding; it is not a caller-declared pass and cannot support a
             positive behavior, fee, liquidity or routability claim. The API server
             independently enforces objective static hard blocks and exact Router
             simulation before wallet handoff; an authenticated executed failure blocks.
          </li>
          <li>
            In EIP-3009 mode, accept the exact CLI-derived funding descriptor.
            Do not replace its funding intent or nonce domain. Current V2
            authorization patching binds four zero ABI leaves:{" "}
            <code>bytes32 nonce</code>, <code>bytes32 r</code>,{" "}
            <code>bytes32 s</code> and <code>uint8 v</code>. Configure their
            numeric ABI argument paths with 1 to 16 indices from 0 through 255.
            Static tuple and fixed-array descendants are supported; dynamic
            parents and applicant-supplied calldata offsets are not.
          </li>
          <li>
            Tooling may report{" "}
            <code>FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED</code> or{" "}
            <code>FUNDING_NONCE_CONFORMANCE_UNPROVEN</code> when exact source,
            ABI and compiler artifacts cannot prove the complete nonce dataflow
            offline. Inspect a suspected conflict. The mandatory exact Router
            simulation is the final execution-compatibility detector, not a
            safety, admission, liquidity or fee-behavior claim.
          </li>
          <li>
            Pool initialization does not add liquidity, and trading volume
            cannot create the initial liquidity from nothing. Select the exact
            external, launch-seeded or hook-inventory model implemented by the
            project. V3 does not inject Classic liquidity automatically.
          </li>
          <li>
            Admission is automatic. At <code>action_required</code>, read the
            exact single-resource remediation, fix the reported target and
            source or config, rebuild, repack and submit a new immutable
            request. Retrying unchanged bytes or requesting a manual allowlist
            cannot bypass a blocking finding.
          </li>
        </ul>

        <aside className={styles.callout}>
          <strong>Follow the live discovery contract</strong>
          <p>
            Discovery, capabilities, the remediation catalog, this guide and
            the pinned CLI release provide the current public handoff. A
            preparatory OpenAPI addition does not activate a profile. The two
            controller-wallet signatures remain outside the agent flow.
          </p>
        </aside>
      </section>

      <section id="v3-general">
        <div className={styles.sectionIntro}>
          <h2>Use the general V3 hook profile</h2>
          <p>
            The versioned{" "}
            <a href="/openapi/custom-launch-v3.json">
              direct-native V3 OpenAPI document
            </a>{" "}
            includes reference profile 3.4; read capabilities for
            the accepted version and discovery for its CLI release. The Ethereum
            profile for project-owned tokens, hooks and multi-contract launch
            graphs uses{" "}
            <code>programmable.direct-native-hook-graph-profile.v3</code>,{" "}
            <code>profileRevision: 3</code> and{" "}
            <code>profileVersion: 3.3.0</code>. It requires and binds canonical
            project name, symbol, meaningful description, non-empty local image,
            one website and one X profile into the launch identity. Other public
            links are optional. Its selection uses{" "}
            <code>
              programmable.direct-native-hook-graph-profile-selection-binding.v3
            </code>
            . Exact 3.2.0 requests retain their original metadata rules. Metadata-absent 3.1.0 and 3.0.0 requests remain readable and
            byte-identical retryable under their original immutable policies.
            Revision 2 also remains compatible; do not reinterpret its receipt
            as revision-3 admission.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            The Router supports 2 to 16 targets, while this profile requires 3 to 16
            because token, hook and initializer roles are distinct. All fourteen
            Uniswap v4 permission bits are supported, including custom-accounting
            return deltas, provided the declared mask, compiled permissions and
            low address bits match exactly.
          </li>
          <li>
            A 10 bps Programmable share applies only to a fee-certified profile
            or adapter and its exact stamped PoolKey after server-authored
            per-launch fee evidence is verified. Arbitrary custom hooks are not
            automatically fee-enforced, and the open arbitrary-hook lane carries
            no Programmable fee claim. Static fees and the{" "}
            <code>0x800000</code> dynamic-fee sentinel are supported.
          </li>
          <li>
            Native and ERC-20 quote currencies are structurally supported.
            Funding can be absent, carried as the exact native value of the
            separately reviewed Router transaction, or use an unsigned USDC
            EIP-3009 descriptor. Only the EIP-3009 mode contains a funding
            challenge and authorization patch. CLI 3.3.9 uses{" "}
            <code>programmable.eip3009-authorization-patch.v2</code> to bind
            the zero nonce, r, s and v ABI leaves before any wallet signature.
          </li>
          <li>
            For EIP-3009 funding, the website first validates and explicitly asks
            for <code>eth_signTypedData_v4</code>. Only after backend signature
            verification, final calldata construction and simulation does it
            present a separately reviewed Router transaction. Neither action
            is auto-signed or auto-broadcast.
          </li>
          <li>
            Initializer source, build, runtime, unsigned patch, final calldata
            and simulation are exact per-launch bindings. There is no separate
            global initializer trust root.
          </li>
          <li>
            Profile 3.3.0 binds every static finding but hard-blocks only seven
            objective code-and-role conditions: CALLCODE, source or runtime
            SELFDESTRUCT, definitively missing or invalid callback authentication,
            a literal wrong PoolManager, or a missing enabled callback. Proxy,
            delegatecall, mint, tax, pause, liquidity and return-delta surfaces
            require evidence instead of categorical rejection. Hard-blocking
            matches return <code>action_required</code>; all other findings remain
            visible as needs-evidence or warning conditions. There is no manual
            project allowlist.
          </li>
          <li>
            Every enabled v4 permission must resolve to a concrete reachable
            callback implementation. An interface declaration or fallback-only
            route does not qualify.
          </li>
          <li>
            With no blocking match, server-authored{" "}
            <code>platformAdmission</code> binds the report hash and warning
            codes with <code>no_blocking_static_finding</code>, requires Router
            simulation and carries <code>safetyClaim: false</code> and{" "}
            <code>feeBehaviorClaim: false</code>.
          </li>
        </ul>
      </section>

      <section id="liquidity">
        <div className={styles.sectionIntro}>
          <h2>Choose liquidity and controls explicitly</h2>
          <p>
            Pool initialization sets a Uniswap v4 starting price but does not
            add liquidity. The project graph owns the liquidity design.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            The CLI binds one explicit model into the request hash: external
            concentrated liquidity remains <code>liquidity_required</code>;
            launch-seeded and hook-inventory custom accounting remain{" "}
            <code>assessment_required</code> until separate exact evidence
            exists. A project cannot declare its own pass.
          </li>
          <li>
            Ordinary concentrated liquidity requires the project to fund and
            create a position. Trading volume cannot create initial liquidity
            from nothing. Position custody, withdrawal and any lock or burn
            must be disclosed.
          </li>
          <li>
            Zero classical LP works only when the project hook and initializer
            implement custom accounting or hold inventory that can exchange
            against incoming assets. Funding mode <code>none</code> does not
            make an empty ordinary pool liquid.
          </li>
          <li>
            Exact-source static admission and Router simulation are not an audit
            or a guarantee of safety, honeypot resistance, liquidity,
            tradeability or fee behavior. Disclose transfer, pause, upgrade,
            mint, liquidity-custody and buy/sell controls.
          </li>
        </ul>
      </section>

      <section id="request">
        <div className={styles.sectionIntro}>
          <h2>Understand the public V3 request contract</h2>
          <p>
            <code>POST /v3/custom-launches</code> accepts only the exact,
            byte-bound general-profile request. Earlier versions remain
            available for existing history and schemas; fresh V2 and V1 POSTs
            return their nonretryable read-only 409 errors.
          </p>
        </div>

        <dl className={`${styles.dataList} ${styles.technicalData}`}>
          {requestFields.map(([field, requirement]) => (
            <div key={field}>
              <dt>
                <code>{field}</code>
              </dt>
              <dd>{requirement}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.bodyCopy}>
          The platform recomputes the manifest digest and checks that the source
          descriptor, manifest and graph name the same source bundle. The graph
          accepts 3 to 16 acyclic direct targets, exactly one token target and
          one hook target. The complete graph input is limited to 524,288 bytes;
          per-target init code is limited to 49,152 bytes and initializer
          calldata to 131,072 bytes. Use the{" "}
          <a href="/openapi/custom-launch-v3.json">V3 OpenAPI contract</a> for every
          nested field, enum and bound in reference profile 3.4.
          Submit that profile only when live discovery and
          capabilities advertise profile 3.4.0. The retained{" "}
          <a href="/openapi/custom-launch-v1.json">V1 contract</a> documents
          compatibility reads and its read-only creation route.
        </p>

        <p className={styles.bodyCopy}>
          The public CLI derives every commitment from exact source, build and
          evidence files. It derives the full runtime hash only when deployed
          bytecode has no unresolved link or immutable references. Otherwise it
          fails closed with <code>RUNTIME_MATERIALIZATION_REQUIRED</code>.
        </p>
      </section>

      <section id="fees">
        <div className={styles.sectionIntro}>
          <h2>Custom Launch fees</h2>
          <p>
            On Robinhood Chain, Native20 charges <strong>20 bps (0.20%)</strong>{" "}
            of the gross native ETH amount once per successful buy or sell,
            rounded up to the next wei. The full platform fee belongs to
            Programmable. Creator and pool LP fees are additional. A 1 ETH
            gross trade credits 0.002 ETH to Programmable before separate
            creator fees.
          </p>
          <p>
            The fixed platform recipient is{" "}
            <code className={styles.breakableValue}>0xD88539d3c4C460136a733A3Fd60cf6BF269079da</code>.
            Fees accrue as PoolManager native claims. Anyone can trigger a claim,
            but payment goes only to that recipient. Gas and liquidity deposits
            are separate, and a claim does not create new revenue. Historical
            launches retain their own fee contracts.
          </p>
          <p>
            The <a href="https://dune.com/programmablehq/analytics">Dune dashboard</a>{" "}
            reports finalized Custom Launch counts, creator rewards in ETH and
            protocol revenue in ETH, including unclaimed native fee accruals.
            Historical fee models without the supported event are outside the
            ETH totals. Read the <Link href="/docs/economics">fee accounting guide</Link>{" "}
            for the definitions.
          </p>
          <h3>Ethereum V3 fee policy</h3>
          <p>
            The general revision-3 profile is public on Ethereum Mainnet only
            (<code>chainId: &quot;1&quot;</code>) and has{" "}
            <code>productionLaunchAuthorized: true</code>.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          A Programmable share of <code>1,000</code> hundredths of a bip, equal to{" "}
          <code>0.10% = 10 bps</code>, is
          claimed only for a fee-certified profile or adapter and its exact
          stamped PoolKey. That lane requires server-authored per-launch
          fee-path evidence before the platform makes that claim. Arbitrary custom hooks are
          not automatically fee-enforced, and the open arbitrary-hook lane carries
          no Programmable fee claim. Revision-3 local validation, static admission
          and Router simulation do not independently create{" "}
          <code>feeBehaviorClaim: true</code>. For that certified lane, the bound
          Programmable recipient is{" "}
          <code>0x4957f49620AFf3Adbbe8195a4f633E49cc93376c</code>.
        </p>

        <p className={styles.bodyCopy}>
          Where a selected lane uses applicant buy or sell rates, each rate is
          capped at <code>100,000</code> hundredths of a bip, equal to{" "}
          <code>1,000 bps = 10%</code>. The API server enforces the cap in both{" "}
          <code>additive-platform-share</code> and{" "}
          <code>inclusive-selected-total</code> modes. The separate platform value
          remains <code>1,000</code> hundredths of a bip, equal to{" "}
          <code>10 bps</code>.
        </p>

        <aside className={styles.callout}>
          <strong>Use the fee contract for the selected profile</strong>
          <p>
            The pool&apos;s LP fee is separate from this platform charge and must
            be disclosed separately. Generic fee claiming and buyback
            management for arbitrary hooks are outside these API scopes. The reserved{" "}
            <code>fees:claim</code> and <code>buybacks:manage</code> scopes remain
            disabled.
          </p>
        </aside>
      </section>

      <section id="verification">
        <div className={styles.sectionIntro}>
          <h2>Bind exact source and follow server-authored status</h2>
          <p>
            Required V3 <code>verificationBundle</code> binds exact UTF-8 Solidity
            Standard JSON bytes, their SHA-256, the exact solc build, source and
            contract identity and resolved constructor arguments to the
            prepared artifact.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          Standard JSON sources contain inline <code>content</code>; URL-only
          sources fail. Compilation units and components are uniquely UTF-8
          sorted, and components exactly cover the graph. The default revision-3
          profile pins <code>solc 0.8.26+commit.8a97fa7a</code>. Decoded Standard
          JSON is limited to 5,242,880 bytes per unit and in aggregate, with at
          most 2,048 inline sources. Revision-2 requests retain their
          compatibility contract. Existing legacy resources without a bundle
          remain readable and unverified.
        </p>

        <aside className={styles.callout}>
          <strong>Exact match is server-authored</strong>
          <p>
            After finality, provider verification runs independently. Only
            literal <code>exact_match</code> for every component means Source
            verified. Clients must not submit or infer that state. Explorer
            failure never blocks or revises launch finality.
          </p>
        </aside>
      </section>

      <section id="checks">
        <div className={styles.sectionIntro}>
          <h2>Attest the checks you ran</h2>
          <p>
            <code>agentAttestation</code> requires the exact schema version,
            canonical graph hash, agent identifier, canonical UTC timestamp and
            1 to 64 unique <code>{"{ checkId, evidenceSha256 }"}</code> entries.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          V1 does not publish a universal check-ID catalog or define
          project-independent pass/fail semantics for those IDs. The submitting
          workflow chooses stable IDs for checks it actually ran, preserves the
          underlying evidence and attests each <code>sha256:</code> digest.
          Programmable validates shape, digest presence and graph-subject
          binding; it does not fetch or assess the evidence or adopt the
          attestation as its own claim.
        </p>
      </section>

      <section id="submit">
        <div className={styles.sectionIntro}>
          <h2>Submit byte-identical requests</h2>
          <p>
            Use <code>POST /v3/custom-launches</code>. The CLI persistently binds
            the idempotency key to the exact request bytes before network access.
          </p>
        </div>

        <ul className={styles.checkList}>
          <li>
            On timeout, <code>429</code> or <code>503</code>, retry only the exact
            persisted bytes and honor <code>Retry-After</code>.
          </li>
          <li>
            A byte-identical replay can return the existing resource. A reused
            key bound to different bytes is a conflict.
          </li>
          <li>
            The API server exposes a wallet handoff only after objective static
            hard blocks and exact Router simulation pass. Missing behavior
            execution leaves related claims unverified; an authenticated executed
            failure blocks. Stop at <code>authorized</code>. The API and CLI never
            sign or broadcast the returned transaction.
          </li>
          <li>
            Keep deployment, trading, platform-fee evidence, source verification,
            indexing and featured placement as independent product-truth axes.
            Preflight eligibility does not prove any later external state.
          </li>
        </ul>

        <p className={styles.bodyCopy}>
          Service readiness and API authorization do not replace controller
          approval. The connected wallet must review the exact chain, sender,
          Router, value and calldata before a separate signature.
        </p>

        <p className={styles.bodyCopy}>
          During <code>simulating</code>, a signed permit may exist only inside a
          worker-private simulation envelope. Public output remains null in{" "}
          <code>simulating</code> and <code>failed</code>; the evidence gate controls
          permit and wallet-transaction exposure, not internal permit signing
          required for simulation.
        </p>

        <p className={styles.bodyCopy}>
          New V3 requests share a durable global admission cap of 120 created
          requests per hour and 500 per day. An exact idempotent replay is
          checked first and consumes no additional capacity.
        </p>
      </section>

      <section id="lifecycle">
        <div className={styles.sectionIntro}>
          <h2>Track the resource, not an assumed transaction</h2>
          <p>
            Read <code>GET /v3/custom-launches/{"{launchId}"}</code> with the same
            Bearer key. The path value and resource <code>requestId</code> are
            the API request UUID; <code>onchainLaunchId</code> is the distinct
            Router <code>bytes32</code> identifier.
          </p>
        </div>

        <dl className={`${styles.resultList} ${styles.lifecycleList}`}>
          {lifecycle.map(([status, meaning]) => (
            <div key={status}>
              <dt>
                <code>{status}</code>
              </dt>
              <dd>{meaning}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.bodyCopy}>
          After wallet broadcast, poll the single-resource route to drive exact
          reconciliation. <code>GET /v3/custom-launches</code> is a newest-first
          exact-credential-principal history view with bounded summaries; its{" "}
          <code>output</code> is always <code>null</code>. Use the single-resource
          route for the artifact, wallet transaction and durable failure. Its
          additive <code>lifecycleQueue</code> reports bounded worker scheduling
          and retry state only; queue completion is not launch finality.
        </p>

        <aside className={styles.callout}>
          <strong>API access is not wallet authorization</strong>
          <p>
            At <code>authorized</code>, review and sign in the connected
            controller wallet. Follow only the HTTPS <code>walletHandoffUrl</code>
            before its <code>expiresAt</code>; refetch status after expiry. The API
            and CLI never auto-sign or auto-broadcast. The API key is never proof
            of wallet approval.
          </p>
        </aside>
      </section>

      <section id="discovery">
        <div className={styles.sectionIntro}>
          <h2>Keep discovery and claims separate</h2>
        </div>

        <ul className={styles.checkList}>
          <li>
            A finalized Router launch is eligible for Explore and the connected
            wallet&apos;s Profile after website discovery data refreshes. Finality
            is not an immediate listing SLA.
          </li>
          <li>
            Router provenance does not require a Custom Registry record.
            Third-party discovery remains controlled by each indexer.
          </li>
          <li>
            Router provenance alone does not create a claim route. Only
            explicitly supported fee models appear in the current website claim
            flow; an arbitrary Custom hook is not automatically claimable.
          </li>
          <li>
            FADE uses a specifically bound adapter. That does not create generic
            fee claiming or buyback management for arbitrary hooks.
          </li>
          <li>
            V1 scopes <code>fees:claim</code> and{" "}
            <code>buybacks:manage</code> are reserved and disabled.
          </li>
        </ul>
      </section>

      <section id="errors">
        <div className={styles.sectionIntro}>
          <h2>Handle errors by status and code</h2>
        </div>

        <dl className={styles.resultList}>
          {errors.map(([status, recovery]) => (
            <div key={status}>
              <dt>
                <code>{status}</code>
              </dt>
              <dd>{recovery}</dd>
            </div>
          ))}
        </dl>

        <p className={styles.bodyCopy}>
          In an HTTP error, <code>error.requestId</code> is a correlation ID for
          that response. It is not the Custom launch resource{" "}
          <code>requestId</code>. A resource-level <code>failure</code> is the
          durable lifecycle failure for that launch request.
        </p>

        <p className={styles.bodyCopy}>
          Check <a href="https://api.programmable.market/readyz">API readiness</a>.
          For <code>action_required</code>, preserve the resource{" "}
          <code>requestId</code> and exact static report. For HTTP errors,
          preserve <code>error.requestId</code>. For support, send only that
          request ID, HTTP status, UTC time and error code. Never send the API
          key.
        </p>
      </section>

      <section id="extensions">
        <div className={styles.sectionIntro}>
          <h2>Supported operations</h2>
          <p>
            Only operations, scopes and profile versions advertised by live
            discovery and capabilities are available. Check the selected profile
            before submitting. Existing keys do not gain additional scopes automatically.
          </p>
        </div>

        <p className={styles.bodyCopy}>
          Generic fee claims, buyback management, reusable-template publication
          and a public Hookbuilder are not granted by the V3 Custom Launch API.
          Use the operation and credentials defined by each separate service.
        </p>
      </section>

      <nav
        aria-label="Continue developer integration"
        className={styles.nextLinks}
      >
        <p>Continue</p>
        <ul>
          <li>
            <Link href="/docs/developers/custom-launch-quickstart">Follow the launch quickstart</Link>
          </li>
          <li>
            <Link href="/developers/api-keys">Create or manage API keys</Link>
          </li>
          <li>
            <a href="/openapi/custom-launch-v1.json">Open the V1 contract</a>
          </li>
          <li>
            <a href="/openapi/custom-launch-v2.json">
              Inspect V2 compatibility
            </a>
          </li>
          <li>
            <a href="/openapi/custom-launch-v3.json">
              Read the Ethereum V3 request contract
            </a>
          </li>
          <li>
            <Link href="/docs/developers/verify">Verify a token or pool</Link>
          </li>
          <li>
            <Link href="/docs/developers/indexing">Index new launches</Link>
          </li>
        </ul>
      </nav>
    </DocsShell>
  );
}
