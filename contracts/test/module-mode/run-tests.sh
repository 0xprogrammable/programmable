#!/usr/bin/env bash
set -euo pipefail

MODULE_TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODULE_CONTRACTS_DIR="$(cd "${MODULE_TEST_DIR}/../.." && pwd)"
cd "${MODULE_CONTRACTS_DIR}"

# Keep foundry.toml's exact compiler/EVM/optimizer and checked-in remappings.txt. Upstream auto-discovered
# test/= mappings are unrelated dependency test aliases and must not redirect this repository's local fixtures.
FOUNDRY_AUTO_DETECT_REMAPPINGS=false \
FOUNDRY_SRC=src/module-mode \
FOUNDRY_TEST=test/module-mode \
FOUNDRY_SCRIPT=test/module-mode/unused-script-path \
FOUNDRY_OUT=out/module-mode \
FOUNDRY_CACHE_PATH=cache/module-mode \
forge test --offline "$@"
