#!/usr/bin/env bash
# Builds an installable APK without the Android SDK (needs only a JDK 11+, curl, unzip, zip):
#   android.jar (API 34)          <- github.com/Sable/android-platforms (pinned commit)
#   aapt2 + framework resources   <- apktool release jar
#   dx (Java bytecode -> dex)     <- com.jakewharton.android.repackaged:dalvik-dx (Maven Central)
#   zipalign + v1/v2/v3 signing   <- uber-apk-signer (uses its bundled debug key)
# With the Android SDK installed, `./gradlew assembleRelease` in android/ produces the same app.
# Package, versionCode and versionName are read from android/app/build.gradle.kts.
#
# Usage: tools/build_apk.sh [output.apk]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN="$ROOT/android/app/src/main"
GRADLE="$ROOT/android/app/build.gradle.kts"
TOOLS="${GAME_TOOLS_DIR:-$HOME/.cache/android-webgl-game-tools}"
BUILD="$ROOT/build"
PACKAGE=$(sed -n 's/.*namespace = "\([^"]*\)".*/\1/p' "$GRADLE")
VERSION_CODE=$(sed -n 's/.*versionCode = \([0-9]*\).*/\1/p' "$GRADLE")
VERSION_NAME=$(sed -n 's/.*versionName = "\([^"]*\)".*/\1/p' "$GRADLE")
OUT="${1:-$ROOT/release/$(basename "$ROOT").apk}"
MIN_SDK=24
TARGET_SDK=34

APKTOOL_VER=3.0.3
DX_VER=16.0.1
SIGNER_VER=1.3.0
PLATFORMS_COMMIT=1e98db1a199e8f7f85541af26bfc27019501b132

fetch() { # url dest sha256
  if [ ! -s "$2" ]; then
    echo "Downloading $1"
    local i
    for i in 1 2 3 4 5; do
      curl -fsSL --retry 3 -o "$2.part" "$1" && break
      sleep $((i * 3)) # Maven Central sometimes answers 429; back off and retry
    done
    mv "$2.part" "$2"
  fi
  echo "$3  $2" | sha256sum -c --quiet - || { echo "Checksum mismatch: $2" >&2; rm -f "$2"; exit 1; }
}

mkdir -p "$TOOLS"
fetch "https://github.com/iBotPeaches/Apktool/releases/download/v$APKTOOL_VER/apktool_$APKTOOL_VER.jar" \
  "$TOOLS/apktool-$APKTOOL_VER.jar" dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423
fetch "https://repo1.maven.org/maven2/com/jakewharton/android/repackaged/dalvik-dx/$DX_VER/dalvik-dx-$DX_VER.jar" \
  "$TOOLS/dx-$DX_VER.jar" 1e4b645628e3bdb097b5331d669e177ef235a551582a8c646dbe36865e541907
fetch "https://github.com/patrickfav/uber-apk-signer/releases/download/v$SIGNER_VER/uber-apk-signer-$SIGNER_VER.jar" \
  "$TOOLS/uber-apk-signer-$SIGNER_VER.jar" e1299fd6fcf4da527dd53735b56127e8ea922a321128123b9c32d619bba1d835
fetch "https://raw.githubusercontent.com/Sable/android-platforms/$PLATFORMS_COMMIT/android-34/android.jar" \
  "$TOOLS/android-34.jar" 6cea1df3efb77103ac3e2beb9bf4718964b0e0869ab16d39d29d5cbae1c147ad

case "$(uname -s)" in
  Linux) AAPT2_PATH=prebuilt/linux/aapt2 ;;
  Darwin) AAPT2_PATH=prebuilt/macosx/aapt2 ;;
  *) echo "No bundled aapt2 for $(uname -s); use Gradle instead." >&2; exit 1 ;;
esac
if [ ! -x "$TOOLS/aapt2" ] || [ ! -s "$TOOLS/android-framework.jar" ]; then
  unzip -o -q -j "$TOOLS/apktool-$APKTOOL_VER.jar" "$AAPT2_PATH" prebuilt/android-framework.jar -d "$TOOLS"
  chmod +x "$TOOLS/aapt2"
fi

rm -rf "$BUILD"
mkdir -p "$BUILD/classes"

echo "1/4 Compiling Java against android.jar (API 34)"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$TOOLS/android-34.jar" -d "$BUILD/classes" $(find "$MAIN/java" -name '*.java')

echo "2/4 Converting to dex"
java -cp "$TOOLS/dx-$DX_VER.jar" com.android.dx.command.Main --dex --min-sdk-version=$MIN_SDK \
  --output="$BUILD/classes.dex" "$BUILD/classes"

echo "3/4 Linking resources and assets"
# Gradle injects the package from `namespace`; do the same here.
sed "s|<manifest |<manifest package=\"$PACKAGE\" |" "$MAIN/AndroidManifest.xml" > "$BUILD/AndroidManifest.xml"
"$TOOLS/aapt2" compile --dir "$MAIN/res" -o "$BUILD/res.zip"
"$TOOLS/aapt2" link -o "$BUILD/unsigned.apk" -I "$TOOLS/android-framework.jar" \
  --manifest "$BUILD/AndroidManifest.xml" -A "$MAIN/assets" \
  --min-sdk-version $MIN_SDK --target-sdk-version $TARGET_SDK \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  "$BUILD/res.zip"
(cd "$BUILD" && zip -q -X unsigned.apk classes.dex)

echo "4/4 Aligning and signing"
java -jar "$TOOLS/uber-apk-signer-$SIGNER_VER.jar" -a "$BUILD/unsigned.apk" -o "$BUILD/signed" --allowResign
mkdir -p "$(dirname "$OUT")"
cp "$BUILD"/signed/*.apk "$OUT"
echo "APK: $OUT ($(du -h "$OUT" | cut -f1), $PACKAGE $VERSION_NAME/$VERSION_CODE)"
