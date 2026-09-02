ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.22
FROM ${BUILD_FROM}

ARG BUILD_ARCH
ARG CODEX_VERSION
ARG CODEX_RELEASE_TAG

RUN apk add --no-cache \
    bash \
    ca-certificates \
    coreutils \
    curl \
    git \
    jq \
    openssh-client \
    procps-ng \
    tar

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
