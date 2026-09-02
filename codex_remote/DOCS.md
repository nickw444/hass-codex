# Codex Remote

This add-on runs Codex Remote Control and a browser coding UI. The Home
Assistant `/config` directory is mounted read/write and is the fixed workspace.

## Browser UI

Open the **Codex** panel from the Home Assistant sidebar. The ingress UI uses
assistant-ui over a local ACP gateway. It supports persistent `/config` tasks,
streaming responses, tool activity, plans, and read-only file diffs.

The add-on does not expose a LAN port. Home Assistant ingress provides access
control. Every Home Assistant user permitted to open the panel can use the
shared Codex account and ask it to change `/config`; grant access only to
trusted administrators.

### Full local Docker test with real Codex

For the closest reproduction of the add-on, run the same Dockerfile and
`run.sh` outside Home Assistant. This uses the real pinned Codex CLI, the real
`codex-acp` package, the same `/config` and `/data` layout, and the full device
login flow. It only publishes the gateway to localhost and omits HA-MCP.

From `codex_remote/`:

```bash
mkdir -p local-config local-data
docker compose -f docker-compose.local.yml build
docker compose -f docker-compose.local.yml up
```

Open `http://127.0.0.1:8099/`. On first start, complete the ChatGPT device
login shown in the browser or container logs. The browser UI then starts the
real ACP process. Set `HASS_CODEX_PAIR_ON_START=true` in the compose file if
you also want to test real Remote phone pairing.

To include a real HA-MCP endpoint, export it before starting Compose:

```bash
export HASS_CODEX_MCP_URL='http://<ha-mcp-host>:9583/<secret-path>'
docker compose -f docker-compose.local.yml up
```

The URL is used only inside the container to generate Codex configuration; it
is never sent to the browser or printed by the gateway.

The `local-config/` and `local-data/` directories persist between runs so
authentication and Codex state behave like an add-on upgrade. They are local
test data; do not put production Home Assistant files there. Remove them only
after stopping the container if you want a clean login test.

## Run the UI locally

You can validate the browser UI without Home Assistant, a real Codex login, or
an HA-MCP endpoint. From the repository root:

```bash
cd codex_remote/web
npm ci
npm run dev:mock
```

Open `http://127.0.0.1:8099/` in a browser. Mock mode creates a disposable
`.mock-config` workspace and `.mock-data` state directory, reports the Remote
and ACP services as ready, and returns local canned responses. It never starts
Codex, connects to ChatGPT, calls HA-MCP, or edits your real Home Assistant
configuration. Stop it with `Ctrl-C`.

Do not open `web/index.html` directly as a `file://` URL: the ingress UI needs
the gateway to inject its boot nonce and serve the relative WebSocket/API
routes.

To exercise the real local processes instead, build the frontend and run the
gateway with a writable test workspace and an installed Codex CLI:

```bash
mkdir -p /tmp/hass-codex-workspace /tmp/hass-codex-home
cd codex_remote/web
npm run build
HASS_CODEX_CLIENT_ROOT="$PWD/dist/client" \
HASS_CODEX_WORKSPACE=/tmp/hass-codex-workspace \
CODEX_HOME=/tmp/hass-codex-home \
CODEX_PATH="$(command -v codex)" \
HASS_CODEX_ACP_BIN="$PWD/node_modules/@agentclientprotocol/codex-acp/dist/index.js" \
HASS_CODEX_PORT=8099 \
node dist/server/index.js
```

This mode uses the real Codex CLI and real `codex-acp` process, but keeps the
workspace and Codex state outside Home Assistant. The gateway does not require
an HA-MCP URL for this local test; HA-MCP tools will simply be unavailable.
Set
`HASS_CODEX_PAIR_ON_START=false` unless you specifically want to test Remote
pairing, and do not point it at your production `/config` directory until the
local flow has been verified.

## Prerequisites

- Home Assistant OS/Supervisor with an `amd64` or `aarch64` host.
- The latest Home Assistant MCP add-on, version 7.10.0 or newer.
- ChatGPT/Codex access, with device-code login enabled for the account or
  workspace.
- A Home Assistant backup before enabling write access.

Install and start HA-MCP first. Copy the **MCP Server URL** from its logs,
including the secret path and port 9583. Use that raw URL in this add-on; do
not use the HA-MCP ingress/settings URL.

## First start: two different codes

The add-on logs contain two unrelated, short-lived codes.

### 1. ChatGPT device-login code

The log block headed `STEP 1 OF 2 — CHATGPT SIGN-IN REQUIRED` authenticates
Codex itself. Open the displayed OpenAI device URL, sign in, and enter the
one-time code. Complete MFA, SSO, passkey, or workspace checks as prompted.

If this code expires, restart the add-on. Credentials are persisted under
`/data/codex`; they are never printed.

### 2. Remote phone-pairing code

After sign-in, the log block headed `STEP 2 OF 2 — PAIR YOUR PHONE WITH CODEX
REMOTE` contains the **Remote pairing code**. In the ChatGPT mobile app, open
Remote, add a host, choose manual-code entry, and enter this code. Confirm the
same ChatGPT account and workspace. Mobile labels can vary by rollout.

After the phone appears, set `pairing_code_on_start` to `false` and restart.
Existing device pairings persist. To generate a new code, use **Pair another
device** in the browser or temporarily set the option back to `true` and
restart. The add-on generates at most one code per start and does not rapidly
retry failed requests. QR codes are intentionally not supported.

Logs are visible to Home Assistant administrators. Treat both codes as
secrets until they expire; never paste unredacted logs into an issue.

## Configuration

```yaml
ha_mcp_url: "http://192.168.1.100:9583/private_<secret>"
pairing_code_on_start: true
force_device_login_on_start: false
```

`force_device_login_on_start` runs `codex logout` before starting device login.
Turn it off after reauthentication or every restart will sign out again.

Codex is configured with `approval_policy = "on-request"` and
`approvals_reviewer = "auto_review"` (the documented “Approve for me” mode),
with `workspace-write` sandboxing limited to `/config`. Shell network access
inside the sandbox is disabled; MCP transport remains available to Codex.

## Troubleshooting

- **No device code:** enable device-code login in ChatGPT security/workspace
  settings, then restart the add-on.
- **Remote is missing in the app:** update ChatGPT mobile and confirm Remote is
  available for the account/workspace.
- **Pairing code expired:** restart with `pairing_code_on_start: true`.
- **HA-MCP HTTP 401/403/404:** copy the complete raw URL from HA-MCP logs and
  ensure the HA-MCP add-on is running.
- **No tools:** restart Codex after changing the MCP URL and refresh the
  client tool list. Verify HA-MCP is not in read-only mode.
- **Sandbox failure:** inspect add-on logs for bubblewrap, user-namespace,
  seccomp, or AppArmor denials. Do not disable sandboxing as a workaround.
- **Reset sign-in:** set `force_device_login_on_start: true`, restart once,
  complete login, then set it back to `false` and restart again.
- **Blank ingress page:** ensure the add-on is on version 0.2.0 or newer and
  reload the ingress panel. The UI uses relative asset paths because ingress is
  mounted below a Home Assistant token path.
- **Browser disconnected:** check the add-on logs for ACP or Remote status;
  browser sessions reconnect and reload their Codex history automatically.
