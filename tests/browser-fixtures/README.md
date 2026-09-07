# Module controls browser fixture

Run `node tests/browser-fixtures/module-engine-server.mjs` from the repository and open the printed `http://127.0.0.1:4317` address. The server binds only localhost and rebuilds the real Builder, Console, TransactionReview and client modules. It never changes product routes or release configuration.

The amber banner labels all seeded catalog and contract responses and the simulated wallet callback. Use the scenario selector for general/fixed-asset launch, exact funding approval, quote trading, locked/unlocked escrow, funded settlement, payer refund, unrelated wallet and unavailable publication. Connect and switch controls change only the fixture wallet state. Simulated mined/rejected/uncertain responses exercise component states; they do not validate the real provider, durable operation recovery or onchain finality. Unit and integrated product checks cover those separately.

`window.moduleEngineUiTest` exposes fixture-only RPC method names, unsigned submission payloads and uploaded image fingerprints for browser assertions. No transaction is broadcast. The image callback returns a test-only metadata URL while displaying the locally prepared image blob. All source/release/contract identities are deterministic test data.

Browser QA should cover 1440×900, 390×844 and 320×844; keyboard review/back/confirm paths; visible validation and exact amounts; fixed values; image upload caching; 0→exact approval with a separate confirmation at every step; pending/rejection; contract-derived escrow/settlement permissions and ledger claims; horizontal overflow; 44px visible targets; console and network errors. The hidden file input delegates activation to the existing 44px image button.
