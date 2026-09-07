# Public documentation

Write product pages for someone learning how Programmable works. Explain what they pay, what they receive and what happens next in everyday language. Use connected paragraphs, clear percentages and a simple worked example when it helps. Keep contract internals, event names and accounting terminology in the technical references unless a reader needs them to make a decision.

Write API and integration references for a developer who needs to complete a task. Begin with the purpose, required inputs and next action. Keep exact units, field names, contract versions and verification rules where they are needed to build an integration. Use descriptive links between the product explanation and the technical details.

Use factual language. Avoid marketing, em dashes, filler, rhetorical questions and phrases such as "not just", "seamless" or "game-changing". Keep product terminology consistent across GitBook, GitHub, the website and agent instructions.

Module Mode documentation describes the coin, configuration, contribution, review, management and indexing interfaces. Do not list the available modules or their count in an overview. The service catalog supplies that information. A code example may use an illustrative module without presenting it as the catalog.

General guides link to current discovery for deployment addresses, supported profiles, CLI versions and availability. Versioned API references retain exact wire formats, units and limits. Historical release evidence remains immutable. A new module within an existing source version does not require a documentation release; a changed interface or engine does.

The GitBook source is `docs/public` with navigation in `SUMMARY.md`. The public Module Mode indexing Markdown is copied from that source by `node scripts/sync-module-mode-docs.mjs --write`; running the script without `--write` checks parity. The JSON indexer contract uses the same ABI as the verifier.

Validate the actual published response body, navigation and links after publication. An HTTP 200 with a Page Not Found body is a failed check. GitHub source, a website deployment and a GitBook synchronization are separate publication results.
