#!/usr/bin/env bash
set -Eeuo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source_dir="${root}/codex_remote/vendor/codex-webui"
patch_dir="${root}/codex_remote/patches/codex-webui"
expected='44ad73a99c4d4385fa60d0c519c243baf8f160b7'

[[ "$(git -C "${source_dir}" rev-parse HEAD)" == "${expected}" ]]
[[ -z "$(git -C "${source_dir}" status --short)" ]]
[[ -s "${source_dir}/LICENSE" ]]

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-webui-patches.XXXXXX")"
cleanup() { rm -rf "${tmp_dir}"; }
trap cleanup EXIT
cp -a "${source_dir}/." "${tmp_dir}/"

for patch_file in "${patch_dir}"/*.patch; do
    (cd "${tmp_dir}" && patch -p1 --dry-run <"${patch_file}" >/dev/null)
    (cd "${tmp_dir}" && patch -p1 <"${patch_file}" >/dev/null)
done

grep -q 'app-server.*proxy' "${tmp_dir}/src/codex/codex-process-manager.service.ts"
grep -q 'x-ingress-path' "${tmp_dir}/src/ha-ingress.ts"
grep -q 'WEBUI_LOG_DIR' "${tmp_dir}/src/app.module.ts"

echo "webui source and patches passed"
