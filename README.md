# Home Assistant Codex Remote

A Home Assistant add-on that runs Codex against your Home Assistant
configuration. It mounts `/config` read/write, connects to the separately
installed [Home Assistant MCP](https://github.com/homeassistant-ai/ha-mcp)
add-on, and provides a browser UI through Home Assistant ingress.

## Installation

1. Install and start the Home Assistant MCP add-on. Copy its raw MCP Server
   URL from its logs (the `http://...:9583/<secret-path>` URL, not its ingress
   URL).
2. Add this repository to Home Assistant's add-on repositories:
   `https://github.com/nickw444/hass-codex`
3. Install **Codex Remote**, set `ha_mcp_url`, and start the add-on.
4. Open the **Codex** ingress panel. Complete ChatGPT sign-in in the browser
   (the same code is also printed in the logs).
5. Pair the ChatGPT mobile app from the setup page or the logs.
6. After pairing, set `pairing_code_on_start` to `false` and restart.

The browser creates Codex tasks directly against `/config`; no project setup is
required. Anyone who can access this Home Assistant ingress panel can operate
the shared Codex account and modify `/config`, so restrict panel access to
trusted users.

Make a Home Assistant backup before allowing an agent to edit `/config`.

See `codex_remote/DOCS.md` for the complete flow, security model, and
troubleshooting guide.

To validate the UI with real Codex outside Home Assistant, follow the local
real-process instructions in `codex_remote/DOCS.md`. Use a disposable workspace
and `CODEX_HOME`; do not point it at your production `/config` directory.
