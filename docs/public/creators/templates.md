---
description: Publish reusable behavior through the Module Mode contribution workflow
---

# Reusable modules

Modules are the reusable building blocks offered through Module Mode. A module supplies a versioned implementation and declares its configuration, required capabilities and management actions. Creators select compatible modules when they launch a coin.

## Publish a module

Use the [module contribution API](../developers/module-mode.md) to submit the exact source package, configuration contract, author wallet, reward wallet and required evidence. Review checks the implementation and its compatibility with the host. Catalog publication makes that specific revision available to creators.

Every launched coin records the revisions and configuration it selected. A new source revision, dependency, permission or fee rule needs its own version and review. Changes to an existing coin follow its deployed contracts and management permissions.

## Earn from use

Module rewards accrue when eligible modules are used by a coin that generates qualifying trading fees. The total author allocation is shared among the eligible module families selected for that launch. Adding multiple components from the same family does not create extra shares. [Fees and revenue](../economics.md) lists the fee policy and version-specific rates.

A contribution submission, review result or catalog listing does not itself generate revenue. Use the registered reward wallet and the supported claim interface to receive accrued rewards.

## Custom projects

A Custom Launch submits one concrete token and contract package. It does not create a Module Mode catalog entry. Reusable source in a Custom project can be published in its repository, but catalog distribution uses the separate module contribution workflow.

Historical template application records remain available in [Launch Policy](https://github.com/programmablehq/Launch-Policy). They are records of the former intake process, not the current submission route.
