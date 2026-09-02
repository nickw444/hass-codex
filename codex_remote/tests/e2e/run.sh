#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fixture_dir="${root}/codex_remote/tests/fixtures"
mkdir -p "${fixture_dir}/poc-config" "${fixture_dir}/poc-data"
cleanup() {
  exit_code=$?
  if [[ "${exit_code}" -ne 0 ]]; then
    docker compose -f "${root}/codex_remote/tests/docker-compose.poc.yml" logs >&2 || true
  fi
  docker compose -f "${root}/codex_remote/tests/docker-compose.poc.yml" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "${fixture_dir}/poc-config" "${fixture_dir}/poc-data"
  return "${exit_code}"
}
trap cleanup EXIT
docker compose -f "${root}/codex_remote/tests/docker-compose.poc.yml" up -d
for _ in $(seq 1 30); do
  if curl --silent --fail http://127.0.0.1:18173/api/hassio_ingress/codex_remote/ >/dev/null; then break; fi
  sleep 1
done
runner_dir="$(mktemp -d /tmp/codex-webui-poc-runner.XXXXXX)"
npm_cache_dir="$(mktemp -d /tmp/codex-webui-poc-npm.XXXXXX)"
(
  cd "${runner_dir}"
  npm_config_cache="${npm_cache_dir}" npm init -y >/dev/null
  npm_config_cache="${npm_cache_dir}" npm install --no-save @playwright/test@1.62.1 >/dev/null
  cd "${root}"
  PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/tmp/pw-browsers}" \
    NODE_PATH="${runner_dir}/node_modules" \
    "${runner_dir}/node_modules/.bin/playwright" test "${root}/codex_remote/tests/e2e/poc.spec.js" --reporter=list --workers=1 --output=/tmp/codex-webui-poc-test-results
)
rm -rf "${runner_dir}" "${npm_cache_dir}"
