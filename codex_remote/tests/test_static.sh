#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

bash -n "${root}/codex_remote/run.sh"
grep -q 'approval_policy = "on-request"' "${root}/codex_remote/run.sh"
grep -q 'approvals_reviewer = "auto_review"' "${root}/codex_remote/run.sh"
grep -q 'sandbox_mode = "workspace-write"' "${root}/codex_remote/run.sh"
grep -q 'writable_roots = \["/config"\]' "${root}/codex_remote/run.sh"
grep -q 'default_tools_approval_mode = "writes"' "${root}/codex_remote/run.sh"
grep -q 'codex login --device-auth' "${root}/codex_remote/run.sh"
grep -q 'codex remote-control pair --json' "${root}/codex_remote/run.sh"
grep -q 'CODEX_WEBUI_APP_SERVER_TRANSPORT=proxy' "${root}/codex_remote/run.sh"
grep -q 'WEBUI_DB_PATH=/data/codex-webui/codex-webui.sqlite' "${root}/codex_remote/run.sh"
grep -q 'WORKSPACE_ROOTS=/config' "${root}/codex_remote/run.sh"
grep -q 'panel_admin: true' "${root}/codex_remote/config.yaml"
grep -q 'ingress: true' "${root}/codex_remote/config.yaml"
grep -q 'ingress_port: 8099' "${root}/codex_remote/config.yaml"

if [[ "$(git -C "${root}/codex_remote/vendor/codex-webui" rev-parse HEAD)" != "44ad73a99c4d4385fa60d0c519c243baf8f160b7" ]]; then
    echo "unexpected codex-webui submodule revision" >&2
    exit 1
fi
if [[ -n "$(git -C "${root}/codex_remote/vendor/codex-webui" status --short)" ]]; then
    echo "codex-webui submodule is dirty" >&2
    exit 1
fi
for patch_file in "${root}"/codex_remote/patches/codex-webui/*.patch; do
    [[ -s "${patch_file}" ]] || { echo "empty webui patch" >&2; exit 1; }
done

if grep -Eq '^[[:space:]]*(host_network|full_access|docker_api):[[:space:]]*true' \
    "${root}/codex_remote/config.yaml"; then
    echo "unsafe add-on capability enabled" >&2
    exit 1
fi

echo "static checks passed"
