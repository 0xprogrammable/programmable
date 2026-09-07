import { robinhoodV4PublicContractDiscovery, robinhoodV4PublicLaunchRequirements } from "./v4-public-contract-discovery";

const ROBINHOOD_NATIVE20_FEE_INSTRUCTIONS = "Read the selected Robinhood platformFeePolicy and enforcement status from discovery and capabilities. Native20 charges 20 bps (0.20%) of the gross native ETH amount once per successful buy or sell, rounded up to the next wei. The full 20 bps belongs to Programmable; creator and pool LP fees are additional. For example, a 1 ETH gross trade credits 0.002 ETH to Programmable. The fixed platform recipient is 0xD88539d3c4C460136a733A3Fd60cf6BF269079da. Fees accrue as PoolManager native claims; anyone can trigger a claim, but payment goes only to the configured recipient. Historical contracts retain their fee models. Show gas, liquidity and initial buy separately; do not count claims as new revenue. API keys cannot claim fees, and accrual does not prove a revenue-processing or bridging transaction.";

// Keep historical 4.0 discovery and setup bytes stable; 4.1 selects Native20 guidance.
const ROBINHOOD_HISTORICAL_FEE_INSTRUCTIONS = "Read the current Robinhood platformFeePolicy and enforcement status from discovery. Show its rate, recipient and supported fee currency separately from creator, LP and other fees. 20 bps equals 0.2 percent: two million dollars of once-counted trade volume implies four thousand dollars of fee value if that fee is actually enforced. A configured recipient or rate is not collection proof. Do not claim universal ETH revenue, a working claim path or automatic bridging while those capabilities remain unproven. The creator cannot replace the platform treasury.";

export const PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_V1 = Object.freeze({
  schemaVersion: "programmable.robinhood-funding-intake.v1" as const,
  chainId: 4663 as const,
  scope: "agent-preparation-not-server-authorization" as const,
  requiredBefore: Object.freeze(["funding-dependent-implementation", "build", "pack", "submit"] as const),
  reuseExplicitPriorAnswers: true as const,
  entryChoices: Object.freeze(["buyer-funded", "creator-funded", "hybrid-or-custom"] as const),
  choicesAreRequestEnumValues: false as const,
  pricingModelIsFundingSource: false as const,
  collect: Object.freeze([
    "funding-source", "pricing-and-reserve-model", "initial-token-inventory",
    "initial-liquidity-assets-and-amounts", "funding-wallet", "initial-buy-and-minimum-token-output",
    "capital-budget", "gas-budget", "gas-payer", "intended-launch-state",
  ] as const),
  costReview: Object.freeze({
    earlyEstimate: "before-funding-dependent-implementation" as const,
    finalEstimate: "exact-bound-wallet-transaction-on-chain-4663" as const,
    separateCapitalAndGas: true as const,
    avoidDoubleCountingInitialBuy: true as const,
    unknownCostIsZero: false as const,
    insufficientBudget: "resolve-with-user-before-launch" as const,
    intentionalBuildBeforeFunding: "explicit-user-acknowledgement" as const,
    refreshBalanceBeforeWalletAction: true as const,
  }),
  platformFee: Object.freeze({
    policySource: "customLaunchApi.versions.v4.platformFeePolicy" as const,
    readCurrentPolicyAndEnforcement: true as const,
    separateCreatorAndLpFees: true as const,
    configurationIsCollectionProof: false as const,
    treasuryIsUserSelectable: false as const,
  }),
  instructions: Object.freeze([
    "Robinhood only (chain 4663): before funding-dependent implementation, ask whether buyers will build the capital, the creator will provide starting liquidity, or the project uses a hybrid or custom source. Reuse an explicit earlier answer. These are conversation choices, not API enum values or a project allowlist. A bonding curve describes pricing; it does not by itself prove funding or repayment reserves.",
    "Collect the initial token inventory, real and virtual reserves, any liquidity assets and amounts, funding wallet, initial buy and minimum token output, available capital and gas budgets, gas payer, and intended launch state. Clarify who funds each step and when trading can actually begin. Zero initial ETH principal is not a free deployment. An initialized empty pool is not a funded or tradable curve; virtual reserves are not spendable ETH. Do not invent a sponsor or promise buyer demand.",
    "Before building, show the preliminary capital requirement separately from estimated deployment and transaction gas, with assumptions and unknowns. Check available balances on Robinhood Chain when the funding wallet is known. Do not count assets on another chain as available Robinhood funding. If the budget is insufficient or uncertain, resolve the funding plan with the user; continue building before funding only when the user explicitly accepts that launch is still unfunded. Never silently change the chain, launch model or budget.",
    "For Robinhood profile 4.1, when selected by live discovery and capabilities, every funded launch requires an atomic initial buy worth at least USD 1 at the server reference rate. Before building, read GET /v4/chains/4663/initial-buy-quote without an API key and show its minimum native ETH amount plus separate gas. Have the user confirm the exact buy amount and positive minimum token output; do not raise the amount or budget automatically. The buy must pay real tokens to the launch controller in the same transaction; failure rolls back the launch. Budget the initial buy once within total transaction value. The server obtains its own fresh quote at admission and may require a newly confirmed package if the amount falls below the current minimum. A first buy does not guarantee third-party indexing. Historical 4.0 requests keep their original contract; never invent 4.1 fields for them.",
    ROBINHOOD_HISTORICAL_FEE_INSTRUCTIONS,
    "Before submission, summarize the funding source, pricing and reserve model, exact initial assets and amounts, initial buy and minimum token output, intended launch state, platform recipient and all fees alongside the project metadata. Map the plan to the selected V4 schema's actual funding and liquidityModel fields. Do not add invented fields to a frozen request. Verify that the packed graph and total wallet transaction value match the agreed plan; an initial buy already included in that value is not an extra cost. Resolve mismatches by changing and revalidating the request with the user.",
    "Before the Robinhood wallet action, review the bound transaction value separately from a fresh gas estimate and the current native balance. Mark unavailable estimates as unknown, never zero; resolve an unaffordable or unknown funding requirement before sending. The website's bound summary and transaction review do not prove economic safety or future liquidity. Signing and sending remain the controller's separate wallet actions.",
  ] as const),
});

export const PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_TEXT_V1 = [
  "Robinhood: choose the funding plan before building",
  ...PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_V1.instructions,
].join("\n");

export const PROGRAMMABLE_AGENT_INTAKE_V1 = Object.freeze({
  schemaVersion: "programmable.custom-launch-agent-intake.v1" as const,
  scope: "agent-preparation-not-server-authorization" as const,
  chainSelection: Object.freeze({
    requiredBefore: Object.freeze([
      "chain-specific-implementation", "build", "pack", "submit",
    ] as const),
    authority: "explicit-user-choice" as const,
    reuseExplicitPriorAnswer: true as const,
    missingOrAmbiguous: "ask-user-before-proceeding" as const,
    neverInferFrom: Object.freeze([
      "api-key", "connected-wallet", "project-defaults", "uniswap-v4",
    ] as const),
    choices: Object.freeze([
      Object.freeze({ chainId: 1, caip2: "eip155:1", name: "Ethereum Mainnet", apiVersion: "3" }),
      Object.freeze({ chainId: 4663, caip2: "eip155:4663", name: "Robinhood Chain Mainnet", apiVersion: "4" }),
    ] as const),
  }),
  chainSpecific: Object.freeze({ robinhood: PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_V1 }),
  metadata: Object.freeze({
    requiredBefore: Object.freeze(["build", "pack", "submit"] as const),
    required: Object.freeze([
      "token.name", "token.symbol", "presentation.description",
      "presentation.image.sourcePath", "presentation.image.uri",
      "presentation.links.website", "presentation.links.x",
    ] as const),
    askIfAvailable: Object.freeze([
      "telegram", "discord", "documentation", "github", "other",
    ] as const),
    additionalLinksRequired: false as const,
    reuseExplicitPriorAnswers: true as const,
    inventedValuesAllowed: false as const,
    actualImageBytesRequired: true as const,
    imagePolicy: "selected-chain-pack-config-schema" as const,
  }),
  review: Object.freeze({
    beforeSubmit: "show-complete-user-summary-and-resolve-contradictions" as const,
    website: "same-bound-read-only-metadata" as const,
    changedMetadata: "repack-and-revalidate-a-new-request" as const,
    walletAuthority: "separate-controller-review-and-sign" as const,
  }),
  instructions: Object.freeze([
    "1. Confirm the project's intended chain: Ethereum Mainnet (1) or Robinhood Chain Mainnet (4663). Reuse an explicit earlier answer; ask if the choice is missing, ambiguous or contradictory. Uniswap V4 identifies a protocol, not a chain. Never infer the chain from the API key, connected wallet or project defaults, and never fall back to another chain when a gate fails.",
    "2. Before building or packing, collect the token name, ticker/symbol, useful public bio/description, actual image file and its public URI, website and X profile. Reuse answers and assets already supplied by the user; ask only for missing or conflicting values. Ask whether Telegram, Discord, documentation, GitHub or other links are available; these additional links are optional. Never invent metadata, image bytes or public URLs. Use the selected chain's image rules.",
    "3. Before submission, show the complete summary: chain, launch wallet, token name, ticker, bio, image preview and public URI, website, X and every additional link. Resolve contradictions with the user. The website shows the same bound metadata read-only before wallet authorization. To change metadata, repack and revalidate a new request. API access does not authorize the agent to sign or broadcast; the controller reviews and signs the exact wallet action separately.",
    "Do not begin chain-specific implementation until the chain is explicit. Do not build, pack or submit while required intake values are missing or contradictory. Existing explicit user answers remain valid; do not ask for them again.",
  ] as const),
});

export const PROGRAMMABLE_AGENT_INTAKE_TEXT_V1 = [
  "Start with the launch details",
  ...PROGRAMMABLE_AGENT_INTAKE_V1.instructions,
].join("\n");

/** Select current guidance without mutating the frozen historical intake. */
export function programmableAgentIntakeV1(profileVersion = "4.0.0") {
  if (profileVersion !== "4.1.0") return PROGRAMMABLE_AGENT_INTAKE_V1;
  return Object.freeze({
    ...PROGRAMMABLE_AGENT_INTAKE_V1,
    chainSpecific: Object.freeze({
      robinhood: Object.freeze({
        ...PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_V1,
        instructions: Object.freeze(PROGRAMMABLE_ROBINHOOD_FUNDING_INTAKE_V1.instructions.map(
          instruction => instruction === ROBINHOOD_HISTORICAL_FEE_INSTRUCTIONS
            ? ROBINHOOD_NATIVE20_FEE_INSTRUCTIONS : instruction,
        )),
      }),
    }),
  });
}

export function programmableRobinhoodFundingIntakeTextV1(profileVersion = "4.0.0") {
  return [
    "Robinhood: choose the funding plan before building",
    ...programmableAgentIntakeV1(profileVersion).chainSpecific.robinhood.instructions,
  ].join("\n");
}

export function programmableAgentSetupLinksV1(profileVersion = "4.0.0") {
  const contract = robinhoodV4PublicContractDiscovery(profileVersion);
  return Object.freeze({
    discovery: "https://programmable.market/.well-known/programmable.json",
    capabilities: "https://api.programmable.market/v3/capabilities",
    preflight: "https://api.programmable.market/v3/custom-launches/preflight",
    remediation:
      "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
    packConfigSchema:
      "https://programmable.market/schemas/custom-launch/v3/pack-config.json",
    cli: "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.9/programmable-launch-3.3.9.tgz",
    guide:
      "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
    openApi: "https://programmable.market/openapi/custom-launch-v3.json",
    openApiV2Compatibility:
      "https://programmable.market/openapi/custom-launch-v2.json",
    openApiV1Compatibility:
      "https://programmable.market/openapi/custom-launch-v1.json",
    robinhoodCapabilities:
      "https://api.programmable.market/v4/chains/4663/capabilities",
    robinhoodReadiness:
      "https://api.programmable.market/v4/chains/4663/readiness",
    robinhoodPreflight:
      "https://api.programmable.market/v4/chains/4663/custom-launches/preflight",
    robinhoodPackConfigSchema:
      contract.packConfigSchemaUrl ?? "https://programmable.market/schemas/custom-launch/v4/pack-config.json",
    robinhoodGuide:
      contract.guideUrl ?? "https://programmable.market/developers/custom-launch-api-v1.md",
    robinhoodOpenApi:
      contract.openApiUrl ?? "https://programmable.market/openapi/custom-launch-v4.json",
    ...(profileVersion === "4.1.0" ? {
      robinhoodCoverage: "https://api.programmable.market/v4/chains/4663/launch-coverage",
      robinhoodLaunchGuide: "https://api.programmable.market/v4/chains/4663/launch-guide",
      robinhoodLaunchGuideMarkdown: "https://programmable.market/developers/robinhood-launch-guide-v1.md",
    } : {}),
  });
}

export const PROGRAMMABLE_AGENT_SETUP_LINKS_V1 = programmableAgentSetupLinksV1();

/** The server passes the active profile; this module stays safe to import in a browser. */
export function buildProgrammableAgentSetupTextV1(profileVersion = "4.0.0") {
  const links = programmableAgentSetupLinksV1(profileVersion);
  const successor = profileVersion === "4.1.0";
  return [
    "Programmable Custom Launch agent setup",
    "",
    PROGRAMMABLE_AGENT_INTAKE_TEXT_V1,
    "",
    "Use the preconfigured $PROGRAMMABLE_API_KEY from encrypted secrets or the environment. Never paste the key into chat, a prompt, source code, or command history.",
    "The API key grants API access only. It does not contain policy or integration instructions.",
    "",
    `Start here: ${links.discovery}`,
    "Read customLaunchApi.intake in discovery and complete the launch details above before chain-specific implementation. Follow the user's explicit choice: Ethereum Mainnet (1, eip155:1) uses V3; Robinhood Chain Mainnet (4663, eip155:4663) uses V4.",
    "The same API-key entry point serves both chains. A key needs custom-launch:create and custom-launch:read plus server authorization for the selected chain; its presence does not prove a chain grant. A wallet key's launchWallet must equal its wallet binding. Keep credentials on https://api.programmable.market and follow only the selected chain's instructions below.",
    "",
    "Robinhood Chain Mainnet only (V4, chain 4663)",
    ...(successor ? [
      `Before implementation, compilation or pack, read public GET ${links.robinhoodCoverage} and GET ${links.robinhoodLaunchGuide}. These reads need no API key, query parameters or body; do not create or rotate a key for them.`,
      `Follow the current launch workflow and recovery guide: ${links.robinhoodLaunchGuideMarkdown}. Require schemaVersion programmable.robinhood-launch-coverage.v1 for coverage and programmable.robinhood-launch-guide.v1 for the guide. A 404 or unknown response contract means discovery is unavailable on that deployment; report it and do not infer support or fall back to another chain, profile or create route.`,
      "Check the intended architecture against structuralFormat and verifierCoverage before building. A same-address token/hook such as BLOB uses the separate MultiRole V2 guide and capabilities from https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities. MultiRole supports the exact Native20 recipe and supported constructor configuration; different source or economic mechanisms return evidence_required. No-pool projects and multiple pool keys require additional transport support. Arbitrary tokens or initializers, stateful modules and custom settlement deltas need their own activated server verification. The exact native20 seed recipe is a bounded proof path with no optional module; declaring a pricing or funding model does not establish launch eligibility. Unknown mechanisms are not automatically unsafe. Preserve the intended design and report missing platform support without requesting a bypass.",
      "Guide workflow stages, scenario assessments/blockerLayer and errorRecovery are instructions, not request approval. Its scenarioProfileVersion is 4.1.0; another or unavailable profile is not-evaluated. Readiness, structural representation, activated verifier coverage and exact-request admission are separate. Neither public report clears a finding, issues a permit or creates a wallet action.",
    ] : []),
    programmableRobinhoodFundingIntakeTextV1(profileVersion),
    "",
    `Read customLaunchApi.versions.v4 and the matching chains entry in live discovery. Require publicAuthorization, publicWrites and releaseReady to be true in both. Require an advertised released, installable CLI for profile ${successor ? "4.1.0" : "4.0.0"}, an immutable published release and matching tarball checksum before installing it. If any field, release asset or verification is missing or false, stop before authenticated preflight or submission and report the missing public release gate. A deployed runtime, a source candidate or a local checkout cannot replace these gates.`,
    ...(successor ? [
      "Distinguish API profile from client version: API profile 4.1.0 retains its exact tuple and historical CLI release. CLI 4.1.1 adds the public coverage command with a separate immutable release and client binding to that same API profile. Verify the selected client's own release, source and checksum; a patch version never activates a new write profile. The direct public GET works without a CLI upgrade, and an unpublished client candidate is not installable release evidence.",
      "Public capabilities, readiness, initial-buy-quote, launch-coverage, launch-guide and finalized-custom-launches require no key. Authenticated POST preflight and POST create require custom-launch:create; authenticated list and single-launch GET require custom-launch:read. Use the key's grant for chain 4663 and its controller binding. A read-only key cannot preflight or create, and a module-contribution key does not grant launch access. Keep Authorization only on https://api.programmable.market.",
    ] : []),
    `Public V4 capabilities: ${links.robinhoodCapabilities}`,
    `Public V4 readiness: ${links.robinhoodReadiness}`,
    `V4 non-persisting preflight: ${links.robinhoodPreflight}`,
    `V4 pack-config schema: ${links.robinhoodPackConfigSchema}`,
    `V4 raw guide: ${links.robinhoodGuide}`,
    `Public V4 OpenAPI: ${links.robinhoodOpenApi}`,
    "Fetch the public V4 capabilities and readiness before reading the API key. Require chain 4663, eip155:4663 and ready status. Bind the exact returned profile revision and digest, chainDeployment, chainDeploymentDescriptorDigest, trust roots and finality policy; the API server selects the chain's profile. Fetch the advertised immutable V4 CLI and verify its checksum, then use its V4 schema and guide. The Ethereum CLI link below is not a V4 installer.",
    successor
      ? "Inspect the exact public source revision, compile the real graph targets with the capabilities-pinned compiler, and create programmable-launch.config.json with schemaVersion programmable.launch-pack-config.v4 and chainId 4663 using the advertised 4.1 schema. Supply truthful project metadata and a non-empty local PNG or single-frame GIF with its canonical public image URI; V4 rejects JPEG, WebP and animated GIF. Include the required fundingPlan and user-confirmed launch and gas budgets. A funded launch uses wallet-transaction-value and an atomic initial buy of at least USD 1 at the server's fresh reference rate, with positive minimum token output to the launch wallet. Count the initial buy once inside the total native value; gas is additional. A build-only plan cannot obtain a permit. The CLI derives request bytes, hashes and deployment bindings; never handwrite them."
      : "Inspect the exact public source revision, compile the real graph targets with the capabilities-pinned compiler, and create programmable-launch.config.json with schemaVersion programmable.launch-pack-config.v4 and chainId 4663 as required by that schema. Supply truthful project metadata and a non-empty local PNG or single-frame GIF with its canonical public image URI; V4 rejects JPEG, WebP and animated GIF. Use only an advertised funding mode, none or wallet-transaction-value. The CLI derives request bytes, hashes and deployment bindings; never handwrite them.",
    ...robinhoodV4PublicLaunchRequirements(profileVersion),
    "After all public release gates pass: programmable-launch pack --config programmable-launch.config.json --output launch.json",
    "Then: programmable-launch validate launch.json --config programmable-launch.config.json --remote",
    "Follow the V4 preflight's server-authored disposition and typed remediation. Preflight is not admission or a wallet action. If ready for submission, submit the exact validated bytes with programmable-launch submit launch.json --config programmable-launch.config.json. Keep the CLI journal and Idempotency-Key unchanged for retries. An action_required resource requires its specified correction, rebuild and a new immutable request; never bypass a server decision.",
    ...(successor ? [
      "Read launchEligibility.deployable and every finding before create. If deployable is true and TX_SIMULATION_PENDING is a warning, submit the exact validated request so the server can run the mandatory transaction simulation. The preflight chain checkpoint did not execute the launch. A build-only plan or needs_evidence/unsupported disposition does not permit create.",
      "Create returns HTTP 202 for a new durable request and HTTP 200 for an exact idempotent replay; neither is wallet authorization. Read the returned resource.launchId in CLI output and preserve request bytes, journal and Idempotency-Key for ambiguous transport, 429 and explicitly retryable 503 responses. A detail GET 404 means check launchId, chain and credential lineage; do not create a replacement launch just to poll it.",
      "Recover by code: UNAUTHENTICATED means verify the configured key is present and valid; INSUFFICIENT_SCOPE means use a key with the required operation scope; CHAIN_NOT_ALLOWED means check that credential's chain 4663 grant; WALLET_BINDING_MISMATCH means reconcile the intended controller with the key binding. Do not rotate a key for missing verifier coverage. Preserve unresolved findings and follow the launch guide's recovery for quote, source, permit-window and idempotency errors.",
    ] : []),
    "Use the returned launchId as LAUNCH_ID, not requestId: programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until authorized",
    "At authorized, awaiting_wallet_signature or wallet_action_required, open only the server-provided same-origin walletHandoffUrl and stop for the controller to review the bound project metadata, chain 4663, sender, Router, value, calldata and expiry. The API key and CLI never sign or broadcast. After the controller sends the exact transaction: programmable-launch status LAUNCH_ID --api-version 4 --chain-id 4663 --watch --until finalized. Source verification, indexing, trading and publication remain separate from finality. The following Ethereum instructions do not apply to this V4 request.",
    "",
    "Ethereum Mainnet only (V3, chain 1)",
    `Public capabilities: ${links.capabilities}`,
    `Non-persisting preflight: ${links.preflight}`,
    `Existing-project remediation contract: ${links.remediation}`,
    `Pack-config schema: ${links.packConfigSchema}`,
    "For Ethereum, fetch discovery and public GET /v3/capabilities first. Bind the project to the returned profile revision; do not infer support from an older response.",
    "Read customLaunchApi.agentIntegration, then follow its remediation catalog, guide, OpenAPI and pinned CLI release before changing the project.",
    `Install: npm install --global ${links.cli}`,
    `Release asset: ${links.cli}`,
    `Guide: ${links.guide}`,
    `Public V3 OpenAPI: ${links.openApi}`,
    `V2 read compatibility and fresh-write fence: ${links.openApiV2Compatibility}`,
    `V1 read compatibility and fresh-write fence: ${links.openApiV1Compatibility}`,
    "For a new Ethereum submission, use the current V3.3 profile. Fresh V2 and V1 POSTs are permanently read-only and return non-retryable 409 CUSTOM_LAUNCH_V2_READ_ONLY or 409 CUSTOM_LAUNCH_V1_READ_ONLY; their schemas and reads remain available for historical resources.",
    "CLI 3.3.9 is the current installable release and defaults fresh packs to live profile 3.3.0. Explicit profile 3.4.0 output remains preparatory and is rejected by live capabilities until the backend and .well-known document independently activate that pending profile. Do not submit explicit profile 3.4.0 bytes before activation.",
    "V2 detail reads are observation-only for prepared or simulating resources. GET cannot advance simulation or authorization or expose a new walletTransaction; existing authorized and submitted reconciliation and finalized reads remain available.",
    "Before pack, collect the required project name and symbol, a meaningful description, one canonical website, one canonical X profile, and a non-empty local PNG, JPEG, WebP or GIF plus its canonical public HTTPS, IPFS or Arweave URI. Documentation, Telegram, Discord, GitHub and other links remain optional. Never invent metadata or a public image URI.",
    "The CLI derives the image content digest, media type, byte length and dimensions from the local bytes and binds the complete canonical project metadata into the request and launch identity. Never handwrite these derived fields. The website shows the same metadata read-only before either wallet step; changing it requires a newly packed request.",
    "Inspect the exact public source revision and create programmable-launch.config.json with schemaVersion programmable.launch-pack-config.v3. Validate it against the pack-config schema. Follow the generic catalog for funding, nonce/r/s/v ABI argument paths, liquidity and diagnostics. There is no project allowlist or private approval path.",
    "programmable-launch pack --config programmable-launch.config.json --output launch.json",
    "programmable-launch validate launch.json --config programmable-launch.config.json --remote",
    "Preflight consumes no launch-creation quota or durable reservation: quotaConsumed, nonceAllocated and persisted must all be false. The authenticated HTTP call still consumes its ordinary route rate budget, including a partner credential's prepareRequestsPerHour budget. It never creates a wallet action. walletSignatureRequiredLater is true and walletBroadcastByService is false. Local CLI checks and remote preflight prepare and classify exact bytes; they are not the launch decision.",
    "Submit only the byte-identical current V3.3 request when launchEligibility.deployable is true. The API server remains the decision authority after submission. It independently enforces objective static hard blocks and exact Router simulation before exposing any wallet handoff. A needs_evidence or not_executed result is not a pass and cannot support a positive behavior, fee, liquidity or routability claim; an authenticated executed failure blocks the handoff. Client, model or attestation output cannot promote or bypass a server result. For unsupported, fix the typed hard-block remediation and rebuild instead of asking for a bypass.",
    "programmable-launch submit launch.json --config programmable-launch.config.json",
    "programmable-launch status REQUEST_UUID --watch --until authorized",
    "Use this state machine: pack -> validate --remote -> submit -> server decision -> status --watch --until authorized -> wallet -> status --watch --until finalized. Remote validation first fails closed unless the public profile, revision, version, routes and authentication boundary match this CLI, then sends the same exact V3.3 bytes to non-persisting preflight that consumes no launch-creation quota. Submit only the byte-identical V3.3 request produced by pack and keep the CLI journal and Idempotency-Key unchanged for retries.",
    "Wallet keys require launchWallet to equal their wallet binding. Partner roots and subkeys may select the exact controller in the immutable request but cannot sign for it. On both list and single-resource status reads, a partner root reads every launch attributed to its partner. A subkey reads only its stable lineage, rotation preserves that lineage history for the replacement, the revoked predecessor cannot authenticate, and a separately issued subkey cannot read root or sibling launches. The current Router V1 permit-reissue disposition endpoint accepts wallet keys only; a partner launch recovers by packing and submitting a new request.",
    "If profile 3.4.0 is later activated, fresh packs require complete project metadata plus declarative behaviorScenarioInputs. The CLI derives behaviorScenarioInputsHash and binds it into launchIntentHash. Inputs may name only exact prepared targets, poolManager or the fixed v4-actions-v1 harness and may not contain scripts, URLs, assertions, expected results, statuses or runner parameters. Until activation, fresh writes remain exact profile 3.3.0; older bytes retain only their immutable read and byte-identical retry semantics.",
    "If status is action_required, follow the resource remediation, fix the exact source or config finding, rebuild and submit a new immutable request. Do not ask for a manual allowlist or retry unchanged bytes.",
    "Follow a walletHandoffUrl only after the server-authored resource is authorized; client, CLI or model output cannot create that state. Missing behavior execution leaves behavior, fee, liquidity and routability claims unverified; an authenticated executed failure blocks the handoff. If the selected lane is an open arbitrary-custom-hook lane, it carries no automatic Programmable-fee claim. A 10 bps claim exists only for a fee-certified profile or adapter and its exact stamped PoolKey; arbitrary custom hooks are not automatically fee-enforced.",
    "If profile 3.4.0 is later activated, wallet handoff additionally requires exact source, compiler and graph binding, static admission, a platform admission receipt, exact Router simulation, verified behavior evidence and verified exact 10 bps fee-path evidence. Missing, not-configured or unavailable execution cannot authorize; executed behavior failure or a mutable fee path blocks terminally. This describes a pending server gate, not current activation or evidence. The server owns every assertion and verdict, and legacy resources retain their stored evidence state.",
    "When the selected lane uses applicant buy or sell rates, each rate is capped at 100000 hundredths of a bip, equal to 1000 bps or 10 percent. The server enforces that cap in additive-platform-share and inclusive-selected-total modes. The separate platform value is 1000 hundredths of a bip, equal to 10 bps, and creates a claim only in the fee-certified lane.",
    "If status is awaiting_funding_authorization, open only the same-origin walletHandoffUrl and stop for the connected controller to review and sign the exact funding typed data in the website. At authorized, stop again for the controller to review and send the exact Router transaction. Respect expiresAt and secondsRemaining; never reuse an expired handoff. Then use status to follow that single resource to a terminal state.",
    "The CLI never signs or broadcasts.",
  ].join("\n");
}

export const PROGRAMMABLE_AGENT_SETUP_TEXT_V1 = Object.freeze(buildProgrammableAgentSetupTextV1());
