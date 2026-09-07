export const AGENT_KEY_SCHEMA = "programmable.agent-key-management.v1" as const;
export const AGENT_SCOPES = ["custom-launch:create", "custom-launch:read", "modules:submit", "modules:read"] as const;
export const PROGRAMMABLE_AGENT_GUIDE_URL = "https://programmable.market/agents.md";
export const PROGRAMMABLE_AGENT_DISCOVERY_URL = "https://programmable.market/api/agent";

export const PROGRAMMABLE_AGENT_ENTRY = Object.freeze({
  schemaVersion: "programmable.agent-discovery.v1",
  name: "Programmable",
  apiBaseUrl: "https://api.programmable.market",
  guideUrl: PROGRAMMABLE_AGENT_GUIDE_URL,
  discoveryUrl: PROGRAMMABLE_AGENT_DISCOVERY_URL,
  releaseDiscoveryUrl: "https://programmable.market/.well-known/programmable.json",
  docsIndexUrl: "https://programmable.market/llms.txt",
  docsFullUrl: "https://programmable.market/llms-full.txt",
  website: {
    launch: "https://programmable.market/launch",
    moduleMode: "https://programmable.market/launch/modules",
    buildModule: "https://programmable.market/developers/modules",
    apiKeys: "https://programmable.market/developers/api-keys",
    customLaunchHandoff: "https://programmable.market/developers/api-keys?start=custom&chainId=4663",
    launchHistory: "https://programmable.market/developers/api-keys?view=history",
    explore: "https://programmable.market/explore/robinhood",
    profile: "https://programmable.market/profile",
    manageModuleCoin: "https://programmable.market/launch/modules/manage/{tokenAddress}",
  },
  workflows: {
    customLaunch: {
      scopes: ["custom-launch:create", "custom-launch:read"],
      guide: "https://programmable.market/docs/developers/custom-launch",
      ethereum: { chainId: 1, capabilities: "https://api.programmable.market/v3/capabilities", openApi: "https://programmable.market/openapi/custom-launch-v3.json" },
      robinhood: { chainId: 4663, capabilities: "https://api.programmable.market/v4/chains/4663/capabilities", readiness: "https://api.programmable.market/v4/chains/4663/readiness", openApi: "https://programmable.market/openapi/custom-launch-v4.json" },
    },
    multiRoleProject: {
      scopes: ["custom-launch:create", "custom-launch:read"],
      capabilities: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/capabilities",
      guide: "https://api.programmable.market/v4/chains/4663/multi-role-custom-launches/guide.md",
      availability: "Read current capabilities; published documentation does not imply enabled admission.",
    },
    moduleContribution: {
      scopes: ["modules:submit", "modules:read"],
      guide: "https://programmable.market/developers/module-mode-api-v1.md",
      developerGuide: "https://programmable.market/docs/developers/module-mode",
      capabilities: "https://api.programmable.market/v1/modules/capabilities",
      reviewCapabilities: "https://api.programmable.market/v1/modules/review-capabilities",
      submissions: "https://api.programmable.market/v1/modules/submissions",
      reviewStatus: "https://api.programmable.market/v1/modules/submissions/{submissionId}/review",
      cliManifest: "https://programmable.market/developers/module-mode-cli/v1.0.0-development.2/manifest.json",
      authorWalletRequired: true,
      rewardWalletRequired: true,
    },
    moduleLaunch: {
      chainId: 4663,
      availability: "https://programmable.market/api/module-mode",
      website: "https://programmable.market/launch/modules",
      transactionAuthority: "connected-wallet",
    },
  },
  authentication: {
    environmentVariable: "PROGRAMMABLE_API_KEY",
    header: "Authorization: Bearer $PROGRAMMABLE_API_KEY",
    credentialOrigin: "https://api.programmable.market",
    publicDocsRequireKey: false,
    existingKeyPermissionsUnchanged: true,
  },
});

export function buildAgentInstructions(input?: { scopes?: readonly string[]; wallet?: string; intent?: string }) {
  return [
    "Use Programmable to build and launch coins, contribute reusable modules, and read launch or review status.",
    `Start by reading ${PROGRAMMABLE_AGENT_GUIDE_URL} and ${PROGRAMMABLE_AGENT_DISCOVERY_URL}. They cover the product, API workflows, current capability endpoints, website actions, contribution requirements and error recovery. Follow their links for the selected task.`,
    "Read the API key from PROGRAMMABLE_API_KEY in the environment or your secret store. Send it only in the Authorization header to https://api.programmable.market. Documentation and capability reads are public. Never print the key or put it in a URL, logs or committed files.",
    input?.scopes ? `This connection was issued with: ${input.scopes.join(", ")}. Check current API authorization on each operation; a guide does not add permissions to a key.` : "Use the key's actual permissions. Older launch-only and module-only keys retain their original access.",
    "Launch history can include requests from other keys and linked wallets in the same account. The key is not isolated to one project; its saved chain restrictions still apply.",
    input?.wallet ? `The controller and module author wallet for this connection is ${input.wallet}. Ask for the contributor's reward wallet when it has not been specified.` : "Use the key's bound wallet for the controller or module author. Obtain the reward wallet from the user.",
    input?.intent ? `Requested workflow: ${input.intent}.` : "Choose the workflow from the user's request: a configurable coin, a complete custom project, a reusable module, or an existing coin's controls.",
    "Use live capabilities before a write, preserve exact request bytes and idempotency keys on retries, and distinguish submission, review, deployment and public availability. Wallet signing remains a separate action.",
  ].join("\n\n");
}

/** Created only in the browser's one-time reveal; never logged, persisted or sent to a server. */
export function buildAgentConnection(secret: string, input: { scopes: readonly string[]; wallet?: string }) {
  if (!/^pm_live_[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("The API key is invalid.");
  return JSON.stringify({
    schemaVersion: "programmable.agent-connection.v1",
    service: "Programmable",
    intro: "Read the guide and discovery URL before using this connection. They explain every supported workflow and where to find its current API contract.",
    apiBaseUrl: PROGRAMMABLE_AGENT_ENTRY.apiBaseUrl,
    guideUrl: PROGRAMMABLE_AGENT_GUIDE_URL,
    discoveryUrl: PROGRAMMABLE_AGENT_DISCOVERY_URL,
    credential: { environmentVariable: "PROGRAMMABLE_API_KEY", value: secret, scopes: input.scopes, ...(input.wallet ? { wallet: input.wallet } : {}) },
    instructions: buildAgentInstructions(input),
  }, null, 2);
}
