#!/usr/bin/env bash
# Runs the official CRE CLI simulation and records its output in docs/.
# Needs a free CRE account: run `cre login` once (browser), or export CRE_API_KEY
# (create it at https://app.chain.link, Account Settings). Add --broadcast to write on Sepolia
# once KybAttestationRegistry is deployed and its address is in kyb-attest/config.staging.json.
set -euo pipefail
cd "$(dirname "$0")"
(cd kyb-attest && bun install --frozen-lockfile >/dev/null)
PAYLOAD=${PAYLOAD:-kyb-attest/http_trigger_payload.ie.json}
cre version
cre workflow simulate kyb-attest --target staging-settings --non-interactive \
  --trigger-index 0 --http-payload "$PAYLOAD" "$@" 2>&1 | tee ../docs/cre-simulate-output.txt
