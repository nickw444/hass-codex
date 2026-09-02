# Home Assistant Codex Remote

An experimental Home Assistant add-on that runs Codex Remote Control against
your Home Assistant configuration. It mounts `/config` read/write and connects
to the separately installed [Home Assistant MCP](https://github.com/homeassistant-ai/ha-mcp)
add-on.

## Installation

1. Install and start the Home Assistant MCP add-on. Copy its raw MCP Server
   URL from its logs (the `http://...:9583/<secret-path>` URL, not its ingress
   URL).
2. Add this repository to Home Assistant's add-on repositories:
   `https://github.com/nickw444/hass-codex`
3. Install **Codex Remote**, set `ha_mcp_url`, and start the add-on.
4. Follow the two clearly labelled setup blocks in the add-on logs:
   first **ChatGPT sign-in**, then **Remote phone pairing**.
5. Open the **Codex** admin-only panel from the Home Assistant sidebar. The
   panel is an experimental embedded codex-webui and shares live threads with
   the mobile Remote client.
6. After pairing, set `pairing_code_on_start` to `false` and restart.

Make a Home Assistant backup before allowing an agent to edit `/config`.

See `codex_remote/DOCS.md` for the complete flow, security model, and
troubleshooting guide.
