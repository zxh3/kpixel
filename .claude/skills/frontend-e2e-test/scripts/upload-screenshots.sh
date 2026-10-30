#!/usr/bin/env bash
# Upload images to the PR screenshots R2 bucket and print Markdown image links.
#
#   upload-screenshots.sh [--comment <pr-number>] <image>...
#
# With --comment, also posts the links as a comment on that pull request.
# Objects expire after the bucket's lifecycle period (see setup-screenshot-bucket.sh).
set -euo pipefail

bucket="${PR_SCREENSHOTS_BUCKET:-kpixel-pr-screenshots}"
pr_number=""
if [[ "${1:-}" == "--comment" ]]; then
  pr_number="${2:?--comment needs a PR number}"
  shift 2
fi
if (($# == 0)); then
  echo "usage: $0 [--comment <pr-number>] <image>..." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
wrangler="$repo_root/node_modules/.bin/wrangler"

public_url="$("$wrangler" r2 bucket dev-url get "$bucket" 2>/dev/null | grep -Eo 'https://[^ ]+\.r2\.dev' | head -n 1 || true)"
if [[ -z "$public_url" ]]; then
  echo "No public URL for bucket $bucket. Run setup-screenshot-bucket.sh first." >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
prefix="$branch/$(date +%Y%m%d-%H%M%S)-$(openssl rand -hex 4)"
markdown=""

for file in "$@"; do
  name="$(basename "$file")"
  case "${name##*.}" in
    png) content_type="image/png" ;;
    jpg | jpeg) content_type="image/jpeg" ;;
    gif) content_type="image/gif" ;;
    webp) content_type="image/webp" ;;
    *)
      echo "Skipping $file: only png, jpg, gif and webp render inline on GitHub." >&2
      continue
      ;;
  esac
  "$wrangler" r2 object put "$bucket/$prefix/$name" --file "$file" --content-type "$content_type" --remote >/dev/null
  markdown+="![${name%.*}]($public_url/$prefix/$name)"$'\n'
done

printf '%s' "$markdown"

if [[ -n "$pr_number" && -n "$markdown" ]]; then
  printf '### Screenshots\n\n%s' "$markdown" | gh pr comment "$pr_number" --body-file - >/dev/null
  echo "Posted to PR #$pr_number." >&2
fi
