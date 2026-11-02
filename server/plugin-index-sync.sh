#!/usr/bin/env bash
# Copy the published VibeDev plugin index from GitHub Pages into the download server's mirror.
#
# The desktop's Discover page reads https://download.vibedev.studio/plugin-index/index.json, served from
# <root>/plugin-index: a symbolic link to <root>/plugin-index.releases/<id>, the layout scripts/mirror.mjs creates.
# Each run downloads index.json and index.html from GitHub Pages, checks that index.json is a format-1 index that lists
# at least one plugin with exact versions, and stops when both files equal the current release. Otherwise it writes a
# new release directory, switches the link with one atomic rename, reads the public URL back through the local web
# server, switches back when the bytes or content type differ, and keeps the newest releases. Nothing outside
# <root>/plugin-index, <root>/plugin-index.next and <root>/plugin-index.releases changes, and an existing
# <root>/plugin-index that is not a symbolic link stops the run. Exit status: 0 when the mirror is current, 1 on any
# failure (the previous release stays served).
#
# Environment: SOURCE (default https://vibedev-si.github.io/vibedev-plugin-index), ROOT (default
# /data/vibedev-download/public), PUBLIC_URL (default https://download.vibedev.studio/plugin-index/index.json),
# KEEP (releases kept, default 5), DRY_RUN=1 (download and check only). Needs bash, curl, python3, GNU coreutils
# and flock.
set -euo pipefail

source_url="${SOURCE:-https://vibedev-si.github.io/vibedev-plugin-index}"
root="${ROOT:-/data/vibedev-download/public}"
public_url="${PUBLIC_URL:-https://download.vibedev.studio/plugin-index/index.json}"
keep="${KEEP:-5}"
link="$root/plugin-index"
next="$root/plugin-index.next"
releases="$root/plugin-index.releases"

case "$keep" in '' | *[!0-9]* | 0) echo "KEEP must be a positive integer" >&2; exit 1 ;; esac

exec 9>/run/lock/vibedev-plugin-index-sync.lock
if ! flock -n 9; then echo "another sync is running"; exit 0; fi

if [ -e "$link" ] && [ ! -L "$link" ]; then
  echo "$link exists and is not a symbolic link; refusing to replace it" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
stamp=$(date -u +%s)
for file in index.json index.html; do
  # The query string only bypasses the Pages CDN cache; GitHub Pages serves the same file.
  curl --fail --silent --show-error --proto '=https' --max-redirs 0 --max-time 60 --retry 2 --max-filesize 4194304 \
    --output "$work/$file" "$source_url/$file?sync=$stamp"
done

python3 - "$work/index.json" <<'PY'
import json, re, sys

def fail(message):
    sys.exit(f'index.json is not a usable format-1 index: {message}')

try:
    with open(sys.argv[1], 'rb') as handle:
        index = json.loads(handle.read().decode('utf-8'))
except (UnicodeDecodeError, json.JSONDecodeError) as error:
    fail(str(error))
if not isinstance(index, dict) or index.get('format') != 1:
    fail('format must be 1')
plugins = index.get('plugins')
if not isinstance(plugins, list) or len(plugins) == 0:
    fail('plugins must list at least one plugin')
exact = re.compile(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?')
for plugin in plugins:
    if not isinstance(plugin, dict) or not isinstance(plugin.get('name'), str):
        fail('every plugin needs a name')
    versions = plugin.get('versions')
    if not isinstance(versions, list) or len(versions) == 0:
        fail(f"{plugin['name']} lists no versions")
    for version in versions:
        if not isinstance(version, dict) or not isinstance(version.get('version'), str) or not exact.fullmatch(version['version']):
            fail(f"{plugin['name']} lists a version that is not exact")
PY

current=""
if [ -L "$link" ]; then current=$(readlink -- "$link"); fi
if [ -n "$current" ] && cmp -s "$work/index.json" "$current/index.json" && cmp -s "$work/index.html" "$current/index.html"; then
  echo "mirror is current: $(basename -- "$current")"
  exit 0
fi

# Same release id as scripts/mirror.mjs: UTC time and the first 12 hex digits of the sha256 of the files' checksum list.
id="$(date -u +%Y%m%dT%H%M%SZ)-$( (cd "$work" && sha256sum index.html index.json) | sha256sum | cut -c1-12)"
if [ "${DRY_RUN:-0}" = 1 ]; then
  echo "dry run: would switch $link from ${current:-nothing} to $releases/$id"
  exit 0
fi

mkdir -p -- "$releases"
staging="$releases/$id.staging"
target="$releases/$id"
rm -rf -- "$staging"
mkdir -m 755 -- "$staging"
install -m 644 -- "$work/index.json" "$work/index.html" "$staging/"
mv -T -- "$staging" "$target"
ln -sfn -- "$target" "$next"
mv -T -- "$next" "$link"

host=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.urlsplit(sys.argv[1]).hostname)' "$public_url")
type=$(curl --fail --silent --show-error --max-time 30 --resolve "$host:443:127.0.0.1" \
  --output "$work/served.json" --write-out '%{content_type}' "$public_url?sync=$stamp" || true)
if ! cmp -s "$work/served.json" "$work/index.json" || [[ "$type" != application/json* ]]; then
  echo "$public_url does not serve the new index (content type '${type}'); switching back" >&2
  if [ -n "$current" ]; then
    ln -sfn -- "$current" "$next"
    mv -T -- "$next" "$link"
  fi
  exit 1
fi

current_name=$(basename -- "$target")
find "$releases" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
  | grep -E '^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{12}$' | sort -r | grep -vx -- "$current_name" | tail -n +"$keep" \
  | while read -r old; do rm -rf -- "${releases:?}/$old"; done
echo "switched $link to $id"
