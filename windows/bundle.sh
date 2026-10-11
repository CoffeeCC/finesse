#!/usr/bin/env bash
# Builds finesse-windows-<version>-x64.zip: what the Finesse service runs on
# Windows (no Docker) and what Windows installs update to. Run after
# `npm run build && npm run server:build`:
#
#   windows/bundle.sh <version> [out-dir]
#
# Inside: node.exe (pinned, checked against nodejs.org's checksums), server/
# (finesse-server.mjs + the finesse CLI), web/ (the app), samples/, VERSION.
set -euo pipefail

version=${1:?usage: windows/bundle.sh <version> [out-dir]}
out=$(cd "${2:-.}" && pwd)
NODE_VERSION=22.23.3
root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

test -f "$root/dist/index.html" || { echo "dist/ is missing: run npm run build first" >&2; exit 1; }
test -f "$root/server/dist/finesse-server.mjs" || { echo "server/dist/ is missing: run npm run server:build first" >&2; exit 1; }

node_zip="node-v$NODE_VERSION-win-x64.zip"
curl -fsSL -o "$work/$node_zip" "https://nodejs.org/dist/v$NODE_VERSION/$node_zip"
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep " $node_zip\$" | (cd "$work" && sha256sum -c -)

stage="$work/stage"
mkdir -p "$stage/server"
unzip -q -j "$work/$node_zip" "node-v$NODE_VERSION-win-x64/node.exe" "node-v$NODE_VERSION-win-x64/LICENSE" -d "$stage"
mv "$stage/LICENSE" "$stage/node-LICENSE.txt"
cp "$root"/server/dist/finesse-server.mjs* "$root"/server/dist/finesse.mjs* "$stage/server/"
cp -r "$root/dist" "$stage/web"
cp -r "$root/samples" "$stage/samples"
printf '%s\n' "$version" > "$stage/VERSION"
test "$(node -p "require('$root/dist/version.json').version")" = "$version" || { echo "dist/ is version $(node -p "require('$root/dist/version.json').version"), not $version" >&2; exit 1; }

rm -f "$out/finesse-windows-$version-x64.zip"
(cd "$stage" && zip -qr -X "$out/finesse-windows-$version-x64.zip" .)
ls -l "$out/finesse-windows-$version-x64.zip"
