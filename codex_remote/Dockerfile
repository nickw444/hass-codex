ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.22

FROM node:22-alpine AS web-builder

WORKDIR /build
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
RUN npm prune --omit=dev

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
    openssh-client \
    patch \
    python3 \
    procps-ng \
    ripgrep \
    tar \
    tree \
    unzip \
    zip

RUN apk add --no-cache nodejs

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

COPY --from=web-builder /build/dist /opt/hass-codex-web
COPY --from=web-builder /build/node_modules /opt/hass-codex-web/node_modules
COPY --from=web-builder /build/package.json /opt/hass-codex-web/package.json

RUN node --version && test -f /opt/hass-codex-web/server/index.js

COPY run.sh /run.sh
RUN chmod 0755 /run.sh

WORKDIR /config
CMD ["/usr/bin/with-contenv", "bashio", "/run.sh"]
