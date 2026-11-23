#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Keep this fork in step with upstream:
#   main   fast-forwards to upstream/main and is pushed unchanged
#   custom merges main (our secondary development is never rebased away)
#
# Run from anywhere inside the checkout. Conflicts are for a person to resolve:
# this script stops and leaves the merge in progress.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream https://github.com/rasonyang/ai-native-callcenter.git
fi

git fetch upstream --prune
git fetch origin --prune

echo "== main: fast-forward to upstream/main"
git checkout main
git merge --ff-only upstream/main
git push origin main

echo "== custom: merge main"
git checkout custom
git merge --no-edit main
git push origin custom

echo "synced: main = upstream/main, custom has no upstream change left to take"
