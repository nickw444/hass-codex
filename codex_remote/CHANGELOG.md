# Changelog

## 0.2.0

- Add an experimental admin-only Home Assistant ingress panel backed by the
  pinned LimLLL/codex-webui source.
- Connect the WebUI through `codex app-server proxy` to the existing Remote
  Control daemon so mobile and browser clients share threads and events.
- Add persistent WebUI state, terminal/plugin capabilities, attribution, and a
  disposable Docker/Playwright ingress smoke harness.

## 0.1.15

- Mark the add-on as stable by removing the experimental stage metadata.

## 0.1.14

- Remove terminal QR rendering; pairing uses the reliable manual code shown in logs.

## 0.1.13

- Render pairing QR codes in compact ASCII for Home Assistant log viewers.

## 0.1.12

- Optionally render the app pairing artifact as a terminal QR code in the add-on logs.

## 0.1.11

- Add common CLI tools for repository inspection, text processing, archives, and scripting.

## 0.1.10

- Install full `ps` support required by Codex app-server process supervision.

## 0.1.9

- Populate the complete standalone release layout required by the app-server daemon.

## 0.1.8

- Provide the managed standalone path required by Codex Remote Control.

## 0.1.7

- Keep device authentication attached to the terminal so Codex prints the login URL and code.

## 0.1.6

- Remove redundant add-on metadata rejected by the current Home Assistant linter.

## 0.1.5

- Fix device-login output prefixing on BusyBox-based Home Assistant images.

## 0.1.4

- Replace legacy image publication with direct Buildx GHCR pushes.

## 0.1.0

- Initial experimental Codex Remote Control add-on.
