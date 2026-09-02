# Codex Remote

This add-on runs the experimental Codex Remote Control daemon with the Home
Assistant `/config` directory mounted read/write.

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
Existing device pairings persist. To generate a new code, set it back to
`true` and restart. The add-on generates at most one code per start and does
not rapidly retry failed requests.

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
