#!/usr/bin/env bash

set -euo pipefail

readonly gitleaks_version="8.30.1"
readonly gitleaks_archive="gitleaks_${gitleaks_version}_linux_x64.tar.gz"
readonly gitleaks_sha256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
readonly gitleaks_url="https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/${gitleaks_archive}"
readonly workspace="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
readonly temp_root="${RUNNER_TEMP:-/tmp}"
readonly config_path="$workspace/.gitleaks.toml"
scan_dir="$(mktemp -d "${temp_root%/}/programmable-gitleaks.XXXXXX")"

cleanup() {
  rm -rf -- "$scan_dir"
}
trap cleanup EXIT

curl --fail --silent --show-error --location \
  --proto '=https' --tlsv1.2 \
  "$gitleaks_url" \
  --output "$scan_dir/$gitleaks_archive"
printf '%s  %s\n' "$gitleaks_sha256" "$scan_dir/$gitleaks_archive" \
  | sha256sum --check --status
tar --extract --gzip --file "$scan_dir/$gitleaks_archive" \
  --directory "$scan_dir" gitleaks

PROGRAMMABLE_GITLEAKS_BINARY="$scan_dir/gitleaks" node --test "$workspace/scripts/security/gitleaks-policy.test.mjs"

head_sha="$(git -C "$workspace" rev-parse HEAD)"
base_sha="${PROGRAMMABLE_GITLEAKS_BASE_SHA:-}"
if [[ ! "$base_sha" =~ ^[0-9a-f]{40}$ ]] \
  || [[ "$base_sha" =~ ^0{40}$ ]] \
  || ! git -C "$workspace" cat-file -e "${base_sha}^{commit}" 2>/dev/null; then
  if git -C "$workspace" rev-parse HEAD^ >/dev/null 2>&1; then
    base_sha="$(git -C "$workspace" rev-parse HEAD^)"
  else
    base_sha=""
  fi
fi

log_opts="$head_sha"
if [[ -n "$base_sha" ]]; then
  log_opts="${base_sha}..${head_sha}"
fi

"$scan_dir/gitleaks" git "$workspace" \
  --config "$config_path" \
  --log-opts "$log_opts" \
  --redact=100 \
  --no-banner
