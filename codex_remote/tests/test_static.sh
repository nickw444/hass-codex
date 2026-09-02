#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "${root}/codex_remote/run.sh"
grep -q 'approval_policy = "on-request"' "${root}/codex_remote/run.sh"
grep -q 'approvals_reviewer = "auto_review"' "${root}/codex_remote/run.sh"
grep -q 'sandbox_mode = "workspace-write"' "${root}/codex_remote/run.sh"
grep -q 'writable_roots = \["/config"\]' "${root}/codex_remote/run.sh"
grep -q 'default_tools_approval_mode = "writes"' "${root}/codex_remote/run.sh"
grep -q 'CODEX_PATH=/usr/local/bin/codex' "${root}/codex_remote/run.sh"
grep -q 'HASS_CODEX_PAIR_ON_START' "${root}/codex_remote/run.sh"
grep -q 'exec node /opt/hass-codex-web/server/index.js' "${root}/codex_remote/run.sh"

if grep -Eq '^[[:space:]]*(host_network|full_access|docker_api):[[:space:]]*true' \
    "${root}/codex_remote/config.yaml"; then
    echo "unsafe add-on capability enabled" >&2
    exit 1
fi

echo "static checks passed"
