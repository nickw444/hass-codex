#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export CODEX_HOME=/data/codex
export CODEX_PATH=/usr/local/bin/codex
export NO_BROWSER=1
export INITIAL_AGENT_MODE=agent

fatal() {
    bashio::log.fatal "$1"
    exit 1
}

mkdir -p "${CODEX_HOME}"
chmod 700 "${CODEX_HOME}"
mkdir -p /data/codex-web/uploads
chmod 700 /data/codex-web /data/codex-web/uploads

# `remote-control start` requires the complete standalone-install layout. The
# image contains that checksum-verified package under /opt/codex; copy it once
# into the persistent CODEX_HOME release layout and point `current` at it.
case "$(uname -m)" in
    x86_64) managed_target="x86_64-unknown-linux-musl" ;;
    aarch64) managed_target="aarch64-unknown-linux-musl" ;;
    *) fatal "Unsupported container architecture: $(uname -m)" ;;
esac
managed_root="${CODEX_HOME}/packages/standalone"
managed_release="${managed_root}/releases/0.152.1-${managed_target}"
if [[ ! -x "${managed_release}/bin/codex" || ! -x "${managed_release}/codex-resources/bwrap" ]]; then
    rm -rf "${managed_release}"
    mkdir -p "${managed_root}/releases"
    cp -a /opt/codex "${managed_release}"
    ln -sfn bin/codex "${managed_release}/codex"
fi
ln -sfn "releases/0.152.1-${managed_target}" "${managed_root}/current"
chmod 700 "${CODEX_HOME}/packages" "${managed_root}" "${managed_root}/releases" "${managed_release}"

if [[ ! -d /config || ! -w /config ]]; then
    fatal "/config is not present or is not writable. Check the homeassistant_config map."
fi

local_docker="${HASS_CODEX_LOCAL_DOCKER:-false}"
if [[ "${local_docker}" == "true" ]]; then
    mcp_url="${HASS_CODEX_MCP_URL:-}"
else
    mcp_url="$(bashio::config 'ha_mcp_url')"
fi
if [[ -n "${mcp_url}" ]]; then
    if [[ ! "${mcp_url}" =~ ^https?:// ]]; then
        fatal "ha_mcp_url must use http:// or https://."
    fi
    if [[ "${mcp_url}" =~ ^https?://(localhost|127\.0\.0\.1|\[::1\])([/:]|$) ]]; then
        fatal "ha_mcp_url must not point at loopback from inside the Codex container."
    fi
    # Streamable HTTP may reject a plain GET; protocol-level errors still prove reachability.
    probe_status="$(curl --silent --show-error --output /dev/null \
        --write-out '%{http_code}' --connect-timeout 5 --max-time 10 \
        "${mcp_url}" 2>/dev/null || true)"
    case "${probe_status}" in
        200|400|405|406) ;;
        *) fatal "HA-MCP endpoint is unreachable or invalid (HTTP ${probe_status:-000})." ;;
    esac
    toml_url="$(jq -Rn --arg value "${mcp_url}" '$value')"
fi
config_tmp="$(mktemp "${CODEX_HOME}/config.toml.XXXXXX")"
cat >"${config_tmp}" <<EOF
approval_policy = "on-request"
approvals_reviewer = "auto_review"
sandbox_mode = "workspace-write"
cli_auth_credentials_store = "file"

[sandbox_workspace_write]
writable_roots = ["/config"]
network_access = false

[projects."/config"]
trust_level = "trusted"

EOF
if [[ -n "${toml_url:-}" ]]; then
    cat >>"${config_tmp}" <<EOF

[mcp_servers.home_assistant]
url = ${toml_url}
enabled = true
default_tools_approval_mode = "writes"
startup_timeout_sec = 30
tool_timeout_sec = 120
EOF
fi
chmod 600 "${config_tmp}"
mv -f "${config_tmp}" "${CODEX_HOME}/config.toml"

export HASS_CODEX_PORT=8099
export HASS_CODEX_WORKSPACE=/config
if [[ "${local_docker}" == "true" ]]; then
    export HASS_CODEX_PAIR_ON_START="${HASS_CODEX_PAIR_ON_START:-false}"
    export HASS_CODEX_FORCE_LOGIN="${HASS_CODEX_FORCE_LOGIN:-false}"
else
    export HASS_CODEX_PAIR_ON_START="$(bashio::config 'pairing_code_on_start')"
    export HASS_CODEX_FORCE_LOGIN="$(bashio::config 'force_device_login_on_start')"
fi
export HASS_CODEX_VERSION=0.2.0

cd /config
exec node /opt/hass-codex-web/server/index.js
