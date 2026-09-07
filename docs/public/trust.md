---
description: What source, execution and provenance checks establish
---

# Verification and risk

A launch has several kinds of evidence: the submitted source, the build, the simulated transaction, wallet execution, finality and its public source record. Each answers a different question. Programmable keeps them separate in the API and indexing interfaces.

## Source and execution evidence

A Custom request binds the exact package, component graph and configuration required by its profile. Caller declarations identify evidence but do not make it authoritative. Profiles that require a protected build or economic proof bind those results to the source, compiler, settings and deployed bytecode. A provider's source match alone does not replace that binding.

Simulation evaluates the exact transaction and context used for the launch. It does not establish every possible behavior of the project. Changed source, constructor values, permissions or transaction bytes may require a new request or fresh evidence.

## Wallet authority

An API key allows scoped API operations. It does not control the launching wallet. A prepared artifact can exist before a wallet transaction is authorized. Once the API supplies an authorized handoff, the controller reviews the network, destination, value and effects before signing.

## Finality and indexing

A broadcast transaction needs a successful receipt and the finality evidence required by the source. Indexers verify the canonical launch identity before publishing it. Source verification, market data and trading support remain separate results; a chart or token name cannot establish origin.

## Security review

The public Programmable contracts have not undergone an external audit or public security contest. Tests, internal review and reproducible builds help evaluate a release, but do not replace an independent audit. A launch stamp records provenance and is not a security endorsement.

Contract interactions can be irreversible. Review the token address, permissions and transaction effects, including the rules that may limit transfers or trading. Holding V4 does not create equity, a claim on protocol revenue or a guaranteed return.

Report vulnerabilities through the private security reporting channel of the affected [Programmable repository](https://github.com/programmablehq). Keep credentials, signatures and unpublished exploit details out of public issues.
