# General and fixed quote templates

An asset address is a launch value unless the package explicitly binds it. A new quote address does not automatically create another engine, source revision, ticker catalogue entry or eligible author-family slot. The host, source package and constructor must agree on the intended binding.

This starter's `quoteAsset` has `binding:{"mode":"input"}`. The same source package can therefore compile `{ "quoteAsset": "0x..." }` for different nonzero ERC20 addresses, while the constructor enforces the fixed request windows and checks that the selected address equals `Context.quoteAsset`. `configuration.fixture.json` contains only a service-owned local test address. Replace it for a real launch; the source API request contains the reusable schema rather than a launch configuration.

To create a fixed template, edit the same `config.schema.json` field to use your explicitly chosen quote address:

```json
{
  "type": "address",
  "binding": { "mode": "fixed", "value": "REPLACE_WITH_QUOTE_ASSET_ADDRESS" }
}
```

The placeholder is intentionally invalid until replaced. Preserve the existing label/help if useful. Regenerate `module.json` after changing the schema. For a revision of the same family, preserve author/familySalt and increment the version. The package digest changes because the schema and exact source bytes change; this does not grant a new family slot or reward eligibility. An optional `binding:{"mode":"input","default":"0x..."}` supplies an editable initial value instead of fixing it.

With a fixed quote, callers may omit `quoteAsset` or repeat the identical value. An attempted different value fails the shared SDK/API configuration validator with `OPEN_CONFIG_FIXED_OVERRIDE`. Changing `Context.quoteAsset` while retaining the fixed configuration fails this starter's constructor with `QuoteContextMismatch`. A reviewed **fixed** host revision must additionally set `Revision.fixedQuoteAsset` to that exact CA and bind the configuration bytes/hash. This prevents a caller from bypassing the API with a different raw configuration and context. A schema or disabled form field alone is insufficient onchain enforcement.

The **general** starter revision leaves `Revision.fixedQuoteAsset` and `fixedConfigurationHash` unset so the reviewed address input can vary. Its constructor enforces the windows for every accepted configuration, including raw bytes. The operator must review the complete accepted address/configuration envelope and supported token behavior. The local standard-token fixture does not prove that any specific mainnet asset is suitable. Fee-on-transfer payouts revert and preserve liabilities; assets that freeze or otherwise prevent transfers can prevent progress.

The canonical `ModuleQuoteEngineV1` is a separate real pool/trading reference through the same Host ABI, documented in `reference/module-engine-host-v1.md`. Its source revision is recorded there and in `SOURCE-PINS.json` for the host specification. It uses the same `Context.quoteAsset` and `Operation` tuple, with operation IDs `keccak256("spot.buy.exact-input.v1")` and `keccak256("spot.sell.exact-input.v1")`. General and fixed quote variants use one interface, with `fixedQuoteAsset == address(0)` for general selection or an exact address for a fixed selection. Fixed package fields use the same `schema.binding` mechanism, and the host's reviewed `fixedQuoteAsset` must enforce that selection.

The pool reference also binds actual PoolManager, position manager/planner, permanent-lock forwarder, converter and pricing configuration. Its reviewed configuration hash and conversion constraints are essential. Copy its complete exact dependency closure and tests if using that trading reference; this small settlement download does not pretend to contain a deployable Uniswap pool engine. A valid ERC20 address, a successful source upload and local fixture swaps are each insufficient evidence of a live conversion route, price policy, LP lock or verified fees. Refer to the pinned pool source/specification for its current exact configuration ABI; do not substitute the settlement example's three-field ABI.
