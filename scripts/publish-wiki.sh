#!/usr/bin/env bash
# Publishes docs/wiki to the GitHub wiki of this repository.
#
# Once: on GitHub, open the repository's Wiki tab and create any first page
# (GitHub only makes the wiki's git repository after that). Then run this
# script from the repository root:  bash scripts/publish-wiki.sh
set -euo pipefail
origin=$(git remote get-url origin)
wiki="${origin%.git}.wiki.git"
tmp=$(mktemp -d)
git clone --quiet "$wiki" "$tmp"
# The wiki is a copy of docs/wiki: pages removed there are removed here too.
find "$tmp" -maxdepth 1 -name '*.md' -delete
cp docs/wiki/*.md "$tmp/"
cd "$tmp"
git add -A
if git diff --cached --quiet; then
  echo "The wiki is already up to date."
else
  git commit --quiet -m "Update the guide from docs/wiki"
  git push --quiet
  echo "Published $(ls *.md | wc -l) pages to ${origin%.git}/wiki"
fi
rm -rf "$tmp"
