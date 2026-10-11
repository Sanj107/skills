#!/usr/bin/env bash
# Front-end for the android-apk skill. Run scripts/setup.sh once first.
#
#   apk.sh info <app.apk> [apk_info.py options]     read manifest/permissions/signing (no unpacking)
#   apk.sh decode <app.apk> [-o dir] [apktool d options]   resources -> XML, dex -> smali
#   apk.sh decompile <app.apk> [-o dir]             dex -> Java sources with jadx (read-only)
#   apk.sh new <dir> --package <pkg> [...]          scaffold a minimal app project (see apk_new.py -h)
#   apk.sh build <dir> [-o out.apk] [--debuggable] [apktool b options]
#                                                   apktool b + compile java/ (if any) + zipalign + sign
#   apk.sh sign <in.apk> [out.apk]                  zipalign + sign (debug key unless APK_KEYSTORE set)
#   apk.sh verify <app.apk>                         check signatures (v1-v4) and alignment
#   apk.sh align <in.apk> <out.apk>                 zipalign only
#   apk.sh apktool <args...>                        raw apktool
#   apk.sh apksigner <args...>                      raw apksigner (sign, verify, rotate, lineage)
#
# Signing key: APK_KEYSTORE, APK_KS_PASS, APK_KEY_ALIAS, APK_KEY_PASS
# (default: the debug keystore created by setup.sh, password "android").
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOLS="${APK_TOOLS_HOME:-$HOME/.cache/android-apk-skill}"
APKTOOL_JAR="$TOOLS/apktool.jar"
APKSIGNER_JAR="$TOOLS/apksigner.jar"

die() { echo "apk.sh: $*" >&2; exit 1; }
need() { [ -s "$1" ] || die "$(basename "$1") missing - run $HERE/setup.sh ${2:-}"; }

apktool() { need "$APKTOOL_JAR"; java -jar "$APKTOOL_JAR" "$@"; }
apksigner() { need "$APKSIGNER_JAR"; java -jar "$APKSIGNER_JAR" "$@"; }

do_sign() { # in out: strip old signatures, zipalign, sign v1+v2+v3 with apksigner
  local in="$1" out="$2" ks pass work
  ks="${APK_KEYSTORE:-$TOOLS/debug.p12}"; pass="${APK_KS_PASS:-android}"
  [ -s "$ks" ] || die "keystore $ks not found"
  local args=(--ks "$ks" --ks-pass "pass:$pass")
  [ -n "${APK_KEY_ALIAS:-}" ] && args+=(--ks-key-alias "$APK_KEY_ALIAS")
  [ -n "${APK_KEY_PASS:-}" ] && args+=(--key-pass "pass:$APK_KEY_PASS")
  work="$(mktemp -d)"
  python3 "$HERE/zipalign.py" --strip-signatures "$in" "$work/aligned.apk" >/dev/null \
    || die "zipalign failed for $in"
  apksigner sign "${args[@]}" --out "$out" "$work/aligned.apk" || die "apksigner failed"
  rm -rf "$work" "$out.idsig"
  apksigner verify --print-certs "$out" | grep -v '^WARNING: META-INF/' || true
  python3 "$HERE/zipalign.py" --check "$out"
}

compile_java() { # project dir: java/ -> classes.dex (replaces smali/)
  local dir="$1"
  need "$TOOLS/android.jar" --with-java
  need "$TOOLS/dx.jar" --with-java
  local classes
  classes="$(mktemp -d)"
  find "$dir/java" -name '*.java' > "$classes.list"
  local cp="$TOOLS/android.jar"
  [ -d "$dir/libs" ] && for j in "$dir"/libs/*.jar; do [ -e "$j" ] && cp="$cp:$j"; done
  echo "compiling java/ -> classes.dex"
  javac -nowarn --release 8 -cp "$cp" -d "$classes" @"$classes.list" 2>&1 | grep -v 'JAVA_TOOL_OPTIONS' || true
  [ -n "$(find "$classes" -name '*.class' -print -quit)" ] || die "javac produced no classes"
  local inputs=("$classes")
  [ -d "$dir/libs" ] && for j in "$dir"/libs/*.jar; do [ -e "$j" ] && inputs+=("$j"); done
  java -cp "$TOOLS/dx.jar" com.android.dx.command.Main --dex --min-sdk-version=21 \
    --output="$dir/classes.dex" "${inputs[@]}"
  rm -rf "$classes" "$classes.list" "$dir/smali"
}

cmd="${1:-}"; [ -n "$cmd" ] && shift
case "$cmd" in
  info)
    python3 "$HERE/apk_info.py" "$@" ;;
  decode|d)
    apktool d "$@" ;;
  decompile)
    [ $# -ge 1 ] || die "usage: apk.sh decompile <app.apk> [-o dir]"
    ls "$TOOLS"/jadx/jadx-cli-*.jar >/dev/null 2>&1 || die "jadx missing - run $HERE/setup.sh --with-jadx"
    apk="$1"; shift
    out="${apk%.apk}-java"
    if [ "${1:-}" = "-o" ]; then out="$2"; shift 2; fi
    java -cp "$TOOLS/jadx/*" jadx.cli.JadxCLI -d "$out" "$@" "$apk" ;;
  new)
    python3 "$HERE/apk_new.py" "$@" ;;
  build|b)
    [ $# -ge 1 ] || die "usage: apk.sh build <dir> [-o out.apk] [apktool b options]"
    dir="${1%/}"; shift
    out=""; rest=()
    while [ $# -gt 0 ]; do
      case "$1" in
        -o|--output) out="$2"; shift 2 ;;
        *) rest+=("$1"); shift ;;
      esac
    done
    [ -d "$dir/java" ] && compile_java "$dir"
    [ -n "$out" ] || out="$dir/dist/$(sed -n 's/^apkFileName: *//p' "$dir/apktool.yml" | tr -d '\r')"
    [ "$out" != "$dir/dist/" ] || out="$dir/dist/app.apk"
    mkdir -p "$(dirname "$out")"
    unsigned="$(mktemp --suffix=.apk)"
    apktool b "$dir" -o "$unsigned" "${rest[@]}"
    do_sign "$unsigned" "$out"
    rm -f "$unsigned"
    echo "built: $out" ;;
  sign)
    [ $# -ge 1 ] || die "usage: apk.sh sign <in.apk> [out.apk]"
    do_sign "$1" "${2:-${1%.apk}-signed.apk}" ;;
  verify)
    [ $# -eq 1 ] || die "usage: apk.sh verify <app.apk>"
    apksigner verify --verbose --print-certs "$1"
    python3 "$HERE/zipalign.py" --check "$1" ;;
  align)
    python3 "$HERE/zipalign.py" "$@" ;;
  apktool)
    apktool "$@" ;;
  apksigner)
    apksigner "$@" ;;
  ""|-h|--help|help)
    sed -n '2,20p' "$0" ;;
  *)
    die "unknown command: $cmd (try --help)" ;;
esac
