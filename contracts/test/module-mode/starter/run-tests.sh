#!/usr/bin/env bash
set -euo pipefail

STARTER_TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARTER_REPO_DIR="$(cd "${STARTER_TEST_DIR}/../../../.." && pwd)"
STARTER_PACKAGE_DIR="${STARTER_REPO_DIR}/packages/classic-modules/examples/native-program"

# The submitted package contains the complete Solidity test dependency closure.
# No forge install, package hooks, FFI, network, wallet or deployment is needed.
cd "${STARTER_PACKAGE_DIR}"
forge test --offline "$@"
