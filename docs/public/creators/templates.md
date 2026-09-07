---
description: Publish reusable behavior through the Module Mode contribution workflow
---

# Reusable modules

Modules are the reusable building blocks offered through Module Mode. A module supplies a versioned implementation and declares its configuration, required capabilities and management actions. Creators select compatible modules when they launch a coin.

## Publish a module

Use the [module contribution API](../developers/module-mode.md) to submit the exact source package, configuration contract, author wallet, reward wallet and required evidence. Review checks the implementation and its compatibility with the host. Catalog publication makes that specific revision available to creators.

Every launched coin records the revisions and configuration it selected. A new source revision, dependency, permission or fee rule needs its own version and review. Changes to an existing coin follow its deployed contracts and management permissions.

## Earn from use

You earn rewards when creators use your eligible module in a coin that trades. Our Module Mode fee policy reserves **0.20% (20 bps) in total for module authors**, shared among the eligible module families used by that coin. Multiple components from one family share the same reward allocation. Existing coins keep their original fee model, as explained in [Fees and revenue](../economics.md#module-mode).

Publishing a module makes it available for use. Earnings start when a coin using it generates trading fees. Claim your earnings to the reward wallet registered with your module.

## Custom projects

A Custom Launch submits one concrete token and contract package. It does not create a Module Mode catalog entry. Reusable source in a Custom project can be published in its repository, but catalog distribution uses the separate module contribution workflow.

Historical template application records remain available in [Launch Policy](https://github.com/programmablehq/Launch-Policy). They are records of the former intake process, not the current submission route.
