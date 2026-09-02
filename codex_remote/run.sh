#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export CODEX_HOME=/data/codex
export HOME=/data/webui-home
export WEBUI_DB_PATH=/data/codex-webui/codex-webui.sqlite
export WEBUI_LOG_DIR=/data/codex-webui/logs
export WORKSPACE_ROOTS=/config
export HASS_CODEX_HA_INGRESS=true
export CODEX_WEBUI_APP_SERVER_TRANSPORT=proxy
export PORT=8099

fatal() {
    bashio::log.fatal "$1"
    exit 1
}

mkdir -p "${CODEX_HOME}"
chmod 700 "${CODEX_HOME}"
mkdir -p /data/codex-webui/logs /data/webui-home
chmod 700 /data/codex-webui /data/codex-webui/logs /data/webui-home

webui_api_key_file=/data/codex-webui/webui-api-key
if [[ ! -s "${webui_api_key_file}" ]]; then
    umask 077
    head -c 48 /dev/urandom | base64 | tr -d '\n' >"${webui_api_key_file}"
fi
chmod 600 "${webui_api_key_file}"
export WEBUI_API_KEY="$(<"${webui_api_key_file}")"

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

webui_pid=""
watchdog_pid=""
cleanup() {
    trap - EXIT INT TERM
    if [[ -n "${watchdog_pid}" ]]; then kill "${watchdog_pid}" 2>/dev/null || true; fi
    if [[ -n "${webui_pid}" ]]; then kill "${webui_pid}" 2>/dev/null || true; fi
    wait "${webui_pid}" 2>/dev/null || true
    codex remote-control stop >/dev/null 2>&1 || true
}
shutdown() {
    cleanup
    exit 0
}
trap cleanup EXIT
trap shutdown INT TERM

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
    # Keep Codex attached directly to the add-on's terminal. The device-auth
    # flow suppresses the URL/code when stdout is piped (non-interactive).
    if ! codex login --device-auth; then
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

if ! codex app-server daemon version >/dev/null 2>&1; then
    fatal "Codex app-server daemon is not ready."
fi

cd /opt/codex-webui
node /opt/codex-webui/dist/main.js &
webui_pid=$!

(
    while sleep 15; do
        if ! kill -0 "${webui_pid}" 2>/dev/null; then
            exit 1
        fi
        if ! codex app-server daemon version >/dev/null 2>&1; then
            kill "${webui_pid}" 2>/dev/null || true
            exit 1
        fi
    done
) &
watchdog_pid=$!

set +e
wait "${webui_pid}"
webui_status=$?
set -e
if [[ "${webui_status}" -ne 0 ]]; then
    fatal "Codex WebUI exited unexpectedly (status ${webui_status})."
fi
fatal "Codex WebUI stopped."
