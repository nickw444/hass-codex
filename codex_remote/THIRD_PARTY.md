# Third-party source

The experimental WebUI in this add-on is built from
[LimLLL/codex-webui](https://github.com/LimLLL/codex-webui), pinned to the
`codex-0.152.1` tag at commit
`44ad73a99c4d4385fa60d0c519c243baf8f160b7`.

The upstream project is licensed under **AGPL-3.0-or-later**. Its complete
license is installed in the image at
`/usr/share/licenses/codex-webui/LICENSE`.

This repository keeps the upstream project as the Git submodule
`codex_remote/vendor/codex-webui`. Home Assistant integration changes are
stored as ordered patches in `codex_remote/patches/codex-webui/` and are
applied during the Docker build. The patches are:

1. `0001-home-assistant-ingress.patch` — Supervisor ingress path handling and
   admin-only ingress authentication for HTTP and Socket.IO.
2. `0002-shared-app-server-proxy.patch` — connects the WebUI to the daemon
   started by `codex remote-control` using `codex app-server proxy`.
3. `0003-ha-runtime-paths-and-source-notice.patch` — persistent log paths and
   the in-application source notice.

Clone with `git clone --recurse-submodules` (or run
`git submodule update --init --recursive`) to obtain the corresponding source.
To reproduce the image, copy the submodule into a build directory, apply the
patches in lexical order with `patch -p1`, and follow `codex_remote/Dockerfile`.

To update upstream, fetch the desired upstream tag, change the submodule pointer
and the documented revision, regenerate and validate every patch, rerun the
full Docker/Playwright suite, and update the Codex protocol version only when
the official add-on pin is changed at the same time. The upstream Dockerfile is
not used because this add-on supplies its own verified Codex binary, Home
Assistant base image, persistent paths, and process supervisor.

The complete corresponding source is available from this repository together
with the pinned upstream submodule and local patch series.
