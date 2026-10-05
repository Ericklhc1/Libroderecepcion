#!/usr/bin/env bash
set -euo pipefail
# Prepared for standard GitHub ubuntu-latest + disposable PostgreSQL, not local use.
[[ ${CI:-} == true && ${GITHUB_ACTIONS:-} == true ]] || { echo 'GitHub disposable CI required'; exit 2; }
ROOT=$(git rev-parse --show-toplevel)
BASELINE=928f57b5fc6823229d160623e6253d4a7ce02fb3
[[ $# == 1 ]] || { echo 'Usage: run.sh <exact-candidate-commit-sha>'; exit 2; }
CANDIDATE=$1
[[ "$CANDIDATE" =~ ^[a-f0-9]{40}$ ]] || { echo 'An exact 40-character candidate commit SHA is required'; exit 2; }
git cat-file -e "$BASELINE^{commit}"
if ! git cat-file -e "$CANDIDATE^{commit}" 2>/dev/null; then
  git fetch --no-tags origin "$CANDIDATE"
fi
git cat-file -e "$CANDIDATE^{commit}"
# This assay deliberately does not claim schema-upgrade coverage.
git diff --exit-code "$BASELINE" "$CANDIDATE" -- prisma > /dev/null || { echo 'Schema differs: design a migration assay first'; exit 2; }
WORK=$(mktemp -d "$RUNNER_TEMP/aroh-cross-version.XXXXXX")
OUT="$RUNNER_TEMP/aroh-cross-version-evidence"
mkdir -p "$WORK/baseline" "$WORK/candidate" "$OUT"
printf '%s\n' "$BASELINE" > "$OUT/baseline-sha.txt"
printf '%s\n' "$CANDIDATE" > "$OUT/candidate-sha.txt"
printf 'Synthetic continuity baseline: %s\nSynthetic continuity candidate: %s\n' "$BASELINE" "$CANDIDATE"
git archive "$BASELINE" | tar -x -C "$WORK/baseline"
git archive "$CANDIDATE" | tar -x -C "$WORK/candidate"
# Clean environment, no inherited vault/provider credentials, .env, Vercel flags,
# shared action encryption key, .next cache, deploymentId override or auth bypass.
isolated() {
  env -i PATH="$PATH" HOME="$HOME" CI=true GITHUB_ACTIONS=true RUNNER_TEMP="$RUNNER_TEMP" \
    DATABASE_URL='postgresql://libro:libro_test@127.0.0.1:5432/libro_test?schema=public&application_name=cross_version' \
    DIRECT_DATABASE_URL='postgresql://libro:libro_test@127.0.0.1:5432/libro_test?schema=public&application_name=cross_version' \
    TEST_DATABASE_URL='postgresql://libro:libro_test@127.0.0.1:5432/libro_test?schema=public' \
    AUTH_SECRET='cross-version-disposable-synthetic-session-key-only' "$@"
}
for version in baseline candidate; do
  tree="$WORK/$version"
  if find "$tree" -name '.env' -o -name '.env.*' | grep -q .; then echo 'Refusing env files in archived source'; exit 2; fi
  (cd "$tree"; isolated npm ci)
done
(cd "$WORK/baseline"; isolated npm run db:deploy)
# Sequential builds keep peak memory within the standard runner envelope.
for version in baseline candidate; do
  (cd "$WORK/$version"; isolated env NODE_ENV=production npm run build)
done
# Harness files are copied AFTER builds: app artifacts remain those exact SHAs.
mkdir -p "$WORK/candidate/scripts/cross-version"
cp "$ROOT/scripts/cross-version/fixture.mts" "$ROOT/scripts/cross-version/no-external.cjs" "$WORK/candidate/scripts/cross-version/"
(cd "$WORK/candidate"; isolated node node_modules/playwright-core/cli.js install --with-deps chromium)
isolated env NODE_ENV=production CROSS_VERSION_NETWORK_LOG="$OUT/network-violations.log" \
  NODE_OPTIONS="--require=$WORK/candidate/scripts/cross-version/no-external.cjs" \
  node "$ROOT/scripts/cross-version/browser.mjs" "$WORK/baseline" "$WORK/candidate" "$OUT"
