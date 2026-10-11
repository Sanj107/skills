#!/usr/bin/env bash
# Installs the toolchain used by the android-apk skill into $APK_TOOLS_HOME
# (default: ~/.cache/android-apk-skill). Safe to re-run; already-present files are skipped.
#
#   apktool.jar        decode / rebuild APKs (iBotPeaches/Apktool, bundles aapt2 + smali/baksmali)
#   apksigner.jar      Google's apksigner (v1-v4 signing/verification), compiled from AOSP sources
#   android.jar        Android API stubs, for compiling Java sources (--with-java)
#   dx.jar             .class -> .dex converter (--with-java)
#   jadx/              DEX -> Java decompiler (--with-jadx, needs Maven)
#   androguard         Python APK parser (pip)
#
# Usage: setup.sh [--with-java] [--with-jadx] [--all]
set -euo pipefail

HOME_DIR="${APK_TOOLS_HOME:-$HOME/.cache/android-apk-skill}"
APKTOOL_VERSION="3.0.3"
APKTOOL_SHA256="dbf930b076c6b9be08d57c449cacefc3bdd6b71ebd59b3066fc0e1f5b14f9423"
JADX_VERSION="1.5.6"
# platform/tools/apksig is not published to Maven Central (only an old 2.3.0 whose v1 signer
# breaks on JDK 17+), so build apksigner from a GitHub mirror of AOSP, pinned to a commit.
APKSIG_REPO="https://github.com/aosp-mirror-neo/platform_tools_apksig"
APKSIG_COMMIT="184702d9d18877edf9e5296c4e191cf0aa2b5fbb"
CENTRAL="https://repo1.maven.org/maven2"

WITH_JAVA=0
WITH_JADX=0
for arg in "$@"; do
  case "$arg" in
    --with-java) WITH_JAVA=1 ;;
    --with-jadx) WITH_JADX=1 ;;
    --all) WITH_JAVA=1; WITH_JADX=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$HOME_DIR"
log() { echo "[setup] $*"; }

command -v java >/dev/null || { echo "java (JDK 17+) is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
command -v javac >/dev/null || { echo "javac (a JDK, not just a JRE) is required" >&2; exit 1; }

fetch() { # url dest
  local url="$1" dest="$2"
  [ -s "$dest" ] && { log "have $(basename "$dest")"; return 0; }
  log "downloading $url"
  curl -fsSL --retry 5 --retry-delay 10 -o "$dest.part" "$url" && mv "$dest.part" "$dest"
}

# --- apktool ---------------------------------------------------------------
APKTOOL_JAR="$HOME_DIR/apktool.jar"
if [ ! -s "$APKTOOL_JAR" ]; then
  for url in \
    "https://bitbucket.org/iBotPeaches/apktool/downloads/apktool_${APKTOOL_VERSION}.jar" \
    "https://github.com/iBotPeaches/Apktool/releases/download/v${APKTOOL_VERSION}/apktool_${APKTOOL_VERSION}.jar"; do
    if fetch "$url" "$APKTOOL_JAR"; then break; fi
    rm -f "$APKTOOL_JAR.part"
  done
fi
[ -s "$APKTOOL_JAR" ] || { echo "could not download apktool.jar" >&2; exit 1; }
actual=$(sha256sum "$APKTOOL_JAR" | cut -d' ' -f1)
if [ "$actual" != "$APKTOOL_SHA256" ]; then
  echo "apktool.jar sha256 mismatch: $actual (expected $APKTOOL_SHA256)" >&2
  rm -f "$APKTOOL_JAR"; exit 1
fi

# --- apksigner (built from AOSP source) ---------------------------------------
if [ -s "$HOME_DIR/apksigner.jar" ]; then
  log "have apksigner.jar"
else
  command -v git >/dev/null || { echo "git is required to build apksigner" >&2; exit 1; }
  log "building apksigner from $APKSIG_REPO@${APKSIG_COMMIT:0:12}"
  tmp=$(mktemp -d)
  git -C "$tmp" init -q src
  git -C "$tmp/src" fetch -q --depth 1 "$APKSIG_REPO" "$APKSIG_COMMIT"
  git -C "$tmp/src" checkout -q FETCH_HEAD
  # The AOSP build links the native Conscrypt provider (only needed for RSA-PSS); drop it.
  sed -i 's/Security.addProvider(new org.conscrypt.OpenSSLProvider());/\/\/ conscrypt not bundled/' \
    "$tmp/src/src/apksigner/java/com/android/apksigner/ApkSignerTool.java"
  # Cloud KMS signer engines need the AWS/GCP SDKs; leave them out.
  find "$tmp/src/src/main/java" "$tmp/src/src/apksigner/java" -name '*.java' \
    -not -path '*/kms/aws/*' -not -path '*/kms/gcp/*' > "$tmp/sources.txt"
  mkdir "$tmp/classes"
  javac -nowarn --release 11 -d "$tmp/classes" @"$tmp/sources.txt" 2>&1 | grep -E '^.*error' && exit 1
  cp "$tmp"/src/src/apksigner/java/com/android/apksigner/*.txt "$tmp/classes/com/android/apksigner/"
  printf 'Main-Class: com.android.apksigner.ApkSignerTool\n' > "$tmp/manifest.txt"
  jar cfm "$HOME_DIR/apksigner.jar" "$tmp/manifest.txt" -C "$tmp/classes" .
  rm -rf "$tmp"
fi

# --- debug keystore ----------------------------------------------------------
KS="$HOME_DIR/debug.p12"
if [ ! -s "$KS" ]; then
  log "creating debug keystore $KS (alias androiddebugkey, password android)"
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass android -keypass android \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi

# --- androguard --------------------------------------------------------------
if ! python3 -c "import androguard" 2>/dev/null; then
  log "pip install androguard"
  python3 -m pip install -q androguard 2>/dev/null \
    || python3 -m pip install -q --user androguard 2>/dev/null \
    || python3 -m pip install -q --break-system-packages androguard
fi

# --- Java toolchain (optional) -------------------------------------------------
if [ "$WITH_JAVA" = 1 ]; then
  fetch "$CENTRAL/com/google/android/android/4.1.1.4/android-4.1.1.4.jar" "$HOME_DIR/android.jar"
  fetch "$CENTRAL/com/jakewharton/android/repackaged/dalvik-dx/16.0.1/dalvik-dx-16.0.1.jar" "$HOME_DIR/dx.jar"
fi

# --- jadx (optional) ---------------------------------------------------------
if [ "$WITH_JADX" = 1 ]; then
  if [ -s "$HOME_DIR/jadx/jadx-cli-$JADX_VERSION.jar" ]; then
    log "have jadx"
  elif command -v mvn >/dev/null; then
    log "resolving jadx $JADX_VERSION with Maven"
    tmp=$(mktemp -d)
    cat > "$tmp/pom.xml" <<EOF
<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>
<groupId>local</groupId><artifactId>jadx-resolve</artifactId><version>1</version>
<dependencies><dependency><groupId>io.github.skylot</groupId><artifactId>jadx-cli</artifactId><version>$JADX_VERSION</version>
<exclusions>
<!-- these live only on Google's Maven repo; jadx decompiles DEX without them -->
<exclusion><groupId>com.android.tools.smali</groupId><artifactId>*</artifactId></exclusion>
<exclusion><groupId>com.android.tools</groupId><artifactId>*</artifactId></exclusion>
<exclusion><groupId>com.android.tools.build</groupId><artifactId>*</artifactId></exclusion>
</exclusions></dependency></dependencies></project>
EOF
    mvn -q -B -f "$tmp/pom.xml" dependency:copy-dependencies -DincludeScope=runtime \
      -DoutputDirectory="$HOME_DIR/jadx" >/dev/null
    rm -rf "$tmp"
  else
    log "skipping jadx: Maven (mvn) not found"
  fi
fi

log "done. Tools in $HOME_DIR:"
ls -1 "$HOME_DIR"
