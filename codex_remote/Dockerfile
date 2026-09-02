ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.22

FROM node:22-alpine AS webui-source

WORKDIR /build/codex-webui
RUN apk add --no-cache git patch python3 make g++ linux-headers
RUN corepack enable && corepack prepare pnpm@10.18.3 --activate

COPY vendor/codex-webui/ ./
COPY patches/codex-webui/ /build/patches/
RUN set -eux; \
    for patch_file in /build/patches/*.patch; do \
      patch -p1 --dry-run < "${patch_file}"; \
      patch -p1 < "${patch_file}"; \
    done

FROM webui-source AS webui-frontend-builder
RUN pnpm --dir web install --frozen-lockfile
RUN pnpm --dir web build

FROM webui-source AS webui-backend-builder
COPY --from=webui-frontend-builder /build/codex-webui/public ./public
RUN npm_config_build_from_source=true pnpm install --frozen-lockfile
RUN pnpm build

FROM webui-backend-builder AS webui-test
RUN WEBUI_API_KEY=poc-test-key pnpm test -- --run

FROM webui-test AS webui-runtime-builder
RUN pnpm prune --prod
RUN node -e "require('better-sqlite3'); require('node-pty'); console.log('native modules loaded')"

FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG CODEX_VERSION
ARG CODEX_RELEASE_TAG

RUN apk add --no-cache \
    bash \
    bzip2 \
    ca-certificates \
    coreutils \
    curl \
    diffutils \
    fd \
    file \
    findutils \
    gawk \
    grep \
    git \
    jq \
    less \
    nodejs \
    npm \
    openssh-client \
    patch \
    python3 \
    procps-ng \
    ripgrep \
    tar \
    tree \
    unzip \
    zip

COPY --from=webui-runtime-builder /build/codex-webui/dist /opt/codex-webui/dist
COPY --from=webui-runtime-builder /build/codex-webui/public /opt/codex-webui/public
COPY --from=webui-runtime-builder /build/codex-webui/drizzle /opt/codex-webui/drizzle
COPY --from=webui-runtime-builder /build/codex-webui/node_modules /opt/codex-webui/node_modules
COPY --from=webui-runtime-builder /build/codex-webui/package.json /opt/codex-webui/package.json
COPY --from=webui-runtime-builder /build/codex-webui/LICENSE /usr/share/licenses/codex-webui/LICENSE

RUN node --version | grep -E '^v22\.' \
    && node -e "require('/opt/codex-webui/node_modules/better-sqlite3'); require('/opt/codex-webui/node_modules/node-pty')"

RUN set -eux; \
    case "${BUILD_ARCH}" in \
      amd64) target="x86_64" ;; \
      aarch64) target="aarch64" ;; \
      *) echo "Unsupported BUILD_ARCH: ${BUILD_ARCH}" >&2; exit 1 ;; \
    esac; \
    archive="codex-package-${target}-unknown-linux-musl.tar.gz"; \
    base="https://github.com/openai/codex/releases/download/${CODEX_RELEASE_TAG}"; \
    mkdir -p /tmp/codex /opt/codex; \
    curl --fail --location --retry 3 --output "/tmp/codex/${archive}" "${base}/${archive}"; \
    curl --fail --location --retry 3 --output /tmp/codex/SHA256SUMS "${base}/codex-package_SHA256SUMS"; \
    grep "  ${archive}$" /tmp/codex/SHA256SUMS > /tmp/codex/SHA256SUMS.selected; \
    (cd /tmp/codex && sha256sum -c SHA256SUMS.selected); \
    tar -xzf "/tmp/codex/${archive}" -C /opt/codex; \
    test -x /opt/codex/bin/codex; \
    ln -s /opt/codex/bin/codex /usr/local/bin/codex; \
    if [ -x /opt/codex/bin/codex-code-mode-host ]; then ln -s /opt/codex/bin/codex-code-mode-host /usr/local/bin/codex-code-mode-host; fi; \
    /usr/local/bin/codex --version | grep -F "${CODEX_VERSION}"; \
    rm -rf /tmp/codex

COPY run.sh /run.sh
RUN chmod 0755 /run.sh

WORKDIR /config
CMD ["/usr/bin/with-contenv", "bashio", "/run.sh"]
