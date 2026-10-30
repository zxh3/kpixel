#!/usr/bin/env bash
# One-time setup of the R2 bucket that hosts PR screenshots. Safe to re-run.
# Creates the bucket, exposes it through its public r2.dev URL, and expires
# objects after 30 days so screenshots stay temporary.
set -euo pipefail

bucket="${PR_SCREENSHOTS_BUCKET:-kpixel-pr-screenshots}"
expire_days="${PR_SCREENSHOTS_EXPIRE_DAYS:-30}"
wrangler="$(git rev-parse --show-toplevel)/node_modules/.bin/wrangler"

if "$wrangler" r2 bucket info "$bucket" >/dev/null 2>&1; then
  echo "Bucket $bucket exists."
else
  # The app doesn't use this bucket, so keep it out of wrangler.jsonc.
  "$wrangler" r2 bucket create "$bucket" --update-config=false
fi

"$wrangler" r2 bucket dev-url enable "$bucket" --force

if "$wrangler" r2 bucket lifecycle list "$bucket" 2>/dev/null | grep -q "expire-screenshots"; then
  echo "Lifecycle rule exists."
else
  "$wrangler" r2 bucket lifecycle add "$bucket" expire-screenshots --expire-days "$expire_days" --force
fi

"$wrangler" r2 bucket dev-url get "$bucket"
