#!/usr/bin/env bash
# Scaffolds an Android WebGL game project: WebView shell with the LAN/vibration/save bridge,
# Gradle files, SDK-less build script, icons and a playable three.js starter page.
#
# Usage: new_game.sh <dir> --package com.example.mygame --name "My Game" [--three 0.149.0]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL="$HERE/../templates"

usage() { sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
[ $# -ge 1 ] || usage 1
case "$1" in -h|--help) usage 0 ;; esac
DIR="$1"; shift
PACKAGE=""; NAME=""; THREE=0.149.0
while [ $# -gt 0 ]; do
  case "$1" in
    --package) PACKAGE="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --three) THREE="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done
[ -n "$PACKAGE" ] && [ -n "$NAME" ] || { echo "--package and --name are required" >&2; exit 1; }
echo "$PACKAGE" | grep -Eq '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' || { echo "Bad package name: $PACKAGE" >&2; exit 1; }
[ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && { echo "$DIR exists and is not empty" >&2; exit 1; }
case "$THREE" in 0.1[0-4][0-9].*) ;; *) echo "three.js $THREE: use 0.149.x or older (last classic build/three.min.js)" >&2; exit 1 ;; esac

SLUG_CAMEL=$(echo "$NAME" | sed 's/[^A-Za-z0-9 ]//g' | awk '{for(i=1;i<=NF;i++) printf toupper(substr($i,1,1)) substr($i,2)}')
[ -n "$SLUG_CAMEL" ] || SLUG_CAMEL=Game
BEACON=$(echo "$PACKAGE" | tr -cd 'a-z0-9' | tr 'a-z' 'A-Z' | cut -c1-16)1
PKG_PATH=$(echo "$PACKAGE" | tr . /)

mkdir -p "$DIR"
DIR="$(cd "$DIR" && pwd)"
cp -R "$TPL/android" "$DIR/android"
mkdir -p "$DIR/android/app/src/main/assets" "$DIR/tools" "$DIR/release"
cp -R "$TPL/assets/." "$DIR/android/app/src/main/assets/"
cp "$TPL/tools/build_apk.sh" "$TPL/tools/make_icons.py" "$DIR/tools/"
chmod +x "$DIR/tools/build_apk.sh" "$DIR/android/gradlew"

# Fill placeholders and drop the .tmpl suffix.
esc() { printf '%s' "$1" | sed -e 's/[\/&|]/\\&/g'; }
while IFS= read -r -d '' f; do
  sed -e "s|__PACKAGE__|$(esc "$PACKAGE")|g" -e "s|__APP_NAME__|$(esc "$NAME")|g" \
      -e "s|__SLUG_CAMEL__|$(esc "$SLUG_CAMEL")|g" -e "s|__BEACON__|$(esc "$BEACON")|g" "$f" > "${f%.tmpl}"
  rm "$f"
done < <(find "$DIR" -name '*.tmpl' -print0)

# Java sources go under the package path.
JAVA="$DIR/android/app/src/main/java"
mkdir -p "$JAVA/$PKG_PATH"
mv "$JAVA"/*.java "$JAVA/$PKG_PATH/"

# three.js (classic global build) from the npm registry.
LIB="$DIR/android/app/src/main/assets/lib"
mkdir -p "$LIB"
TMP=$(mktemp -d)
curl -fsSL --retry 3 -o "$TMP/three.tgz" "https://registry.npmjs.org/three/-/three-$THREE.tgz"
tar -xzf "$TMP/three.tgz" -C "$TMP" package/build/three.min.js package/LICENSE
cp "$TMP/package/build/three.min.js" "$LIB/three.min.js"
cp "$TMP/package/LICENSE" "$LIB/three.LICENSE.txt"
rm -rf "$TMP"

printf 'build/\n' > "$DIR/.gitignore"
if python3 -c 'import PIL' 2>/dev/null; then
  python3 "$DIR/tools/make_icons.py" "$NAME"
else
  echo "Pillow not installed: run 'pip install pillow && python3 tools/make_icons.py \"$NAME\"' to create icons" >&2
fi

cat <<EOF
Created $DIR
  package:  $PACKAGE
  game:     android/app/src/main/assets/ (index.html, js/main.js)
  run:      npx http-server -p 8766 -c-1 "$DIR"  ->  http://localhost:8766/android/app/src/main/assets/index.html
  build:    bash "$DIR/tools/build_apk.sh"  ->  release/$(basename "$DIR").apk
EOF
