#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export CODEX_HOME=/data/codex

mkdir -p "${CODEX_HOME}"
chmod 700 "${CODEX_HOME}"

cleanup() {
    codex remote-control stop >/dev/null 2>&1 || true
}
shutdown() {
    exit 0
}
trap cleanup EXIT
trap shutdown INT TERM

fatal() {
    bashio::log.fatal "$1"
    exit 1
}

if [[ ! -d /config || ! -w /config ]]; then
    fatal "/config is not present or is not writable. Check the homeassistant_config map."
fi

mcp_url="$(bashio::config 'ha_mcp_url')"
if [[ -z "${mcp_url}" ]]; then
    fatal "ha_mcp_url is empty. Copy the raw HA-MCP URL from the HA-MCP add-on logs."
fi
if [[ ! "${mcp_url}" =~ ^https?:// ]]; then
    fatal "ha_mcp_url must use http:// or https://."
fi
if [[ "${mcp_url}" =~ ^https?://(localhost|127\.0\.0\.1|\[::1\])([/:]|$) ]]; then
    fatal "ha_mcp_url must not point at loopback from inside the Codex container."
fi

# A plain GET may be rejected by Streamable HTTP, so accept protocol-level
# client errors while still detecting DNS, connection, bad-path, and server
# failures. Never print curl's URL-bearing diagnostics.
probe_status="$(curl --silent --show-error --output /dev/null \
    --write-out '%{http_code}' --connect-timeout 5 --max-time 10 \
    "${mcp_url}" 2>/dev/null || true)"
case "${probe_status}" in
    200|400|405|406) ;;
    *) fatal "HA-MCP endpoint is unreachable or invalid (HTTP ${probe_status:-000})." ;;
esac

toml_url="$(jq -Rn --arg value "${mcp_url}" '$value')"
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

[mcp_servers.home_assistant]
url = ${toml_url}
enabled = true
default_tools_approval_mode = "writes"
startup_timeout_sec = 30
tool_timeout_sec = 120
EOF
chmod 600 "${config_tmp}"
mv -f "${config_tmp}" "${CODEX_HOME}/config.toml"

cd /config

if bashio::config.true 'force_device_login_on_start'; then
    bashio::log.warning "force_device_login_on_start is enabled; existing credentials will be cleared."
    codex logout >/dev/null 2>&1 || true
fi

if ! codex login status >/dev/null 2>&1; then
    bashio::log.warning "------------------------------------------------------------"
    bashio::log.warning "STEP 1 OF 2 — CHATGPT SIGN-IN REQUIRED"
    bashio::log.warning "This authenticates the add-on; it is NOT the phone pairing code."
    bashio::log.warning "Open the URL and enter the one-time code printed below."
    bashio::log.warning "------------------------------------------------------------"
    if ! codex login --device-auth 2>&1 | sed -e 's/^/[ChatGPT device login] /'; then
        fatal "ChatGPT device login failed or expired. Restart the add-on to retry."
    fi
    bashio::log.info "ChatGPT sign-in completed."
fi

start_json="$(mktemp /tmp/codex-remote-start.XXXXXX)"
trap 'rm -f "${start_json}" "${pair_json:-}"; cleanup' EXIT
if ! codex remote-control start --json >"${start_json}"; then
    fatal "Codex Remote Control failed to start."
fi
if ! jq -e '.status == "connected"' "${start_json}" >/dev/null; then
    fatal "Codex Remote Control did not report connected status."
fi
bashio::log.info "Codex Remote Control daemon is connected."

if bashio::config.true 'pairing_code_on_start'; then
    pair_json="$(mktemp /tmp/codex-remote-pair.XXXXXX)"
    if codex remote-control pair --json >"${pair_json}"; then
        manual_code="$(jq -er '.manualPairingCode' "${pair_json}")"
        expires_at="$(jq -er '.expiresAt' "${pair_json}")"
        expires_text="$(date -u -d "@${expires_at}" '+%Y-%m-%d %H:%M:%S UTC')"
        bashio::log.warning "------------------------------------------------------------"
        bashio::log.warning "STEP 2 OF 2 — PAIR YOUR PHONE WITH CODEX REMOTE"
        bashio::log.warning "Remote pairing code: ${manual_code}"
        bashio::log.warning "Expires: ${expires_text}"
        bashio::log.warning "In ChatGPT mobile: open Remote, add a host, choose manual code, and enter this code."
        bashio::log.warning "This is NOT the ChatGPT device-login code."
        bashio::log.warning "------------------------------------------------------------"
    else
        bashio::log.warning "Could not generate a pairing code; Remote Control remains running."
        bashio::log.warning "Restart the add-on when ready to request another code."
    fi
fi

while sleep 15; do
    if ! codex app-server daemon version >/dev/null 2>&1; then
        fatal "The Codex app-server daemon stopped unexpectedly."
    fi
done
