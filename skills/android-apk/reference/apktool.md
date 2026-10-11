# Apktool 3.x reference

Source: [iBotPeaches/Apktool](https://github.com/iBotPeaches/Apktool) (`main` = 3.x, `2.x` = maintenance).
The CLI lives in `brut.apktool/apktool-cli/src/main/java/brut/apktool/Main.java`; decoding and
building in `brut.apktool/apktool-lib` (`ApkDecoder`, `ApkBuilder`). The jar bundles `aapt2`
(Linux/macOS/Windows, under `prebuilt/`), the Android framework resources
(`prebuilt/android-framework.jar`) and smali/baksmali, so no Android SDK is needed.

`apk.sh apktool <args>` runs the jar directly. `apk.sh decode` = `apktool d`;
`apk.sh build` = `apktool b` + zipalign + signing.

## Commands

| Command | Alias | Purpose |
|---|---|---|
| `decode <apk>` | `d` | APK -> project directory (choose it with `-o <dir>`) |
| `build <dir>` | `b` | project directory -> unsigned APK (default `<dir>/dist/<apkFileName>`) |
| `install-framework <apk>` | `if` | register an OEM framework (e.g. `framework-res.apk`, `twframework-res.apk`) |
| `list-frameworks` | `lf` | list installed frameworks |
| `clean-frameworks` | `cf` | delete installed frameworks |
| `publicize-resources <arsc>` | `pr` | mark all resources in a resources.arsc as public |
| `version` / `help` | `v` / `h` | |

General options: `-v/--verbose`, `-q/--quiet`, `-j/--jobs <n>`.

## decode options

| Option | Meaning |
|---|---|
| `-o, --output <dir>` | output directory |
| `-f, --force` | delete the output directory first |
| `-s, --no-src` | keep `classes*.dex` as-is (no smali). Faster; rebuild copies the dex unchanged |
| `-r, --no-res` | keep `resources.arsc` and binary XML as-is. Use when only code changes; avoids most resource rebuild errors |
| `--only-manifest` | decode only AndroidManifest.xml |
| `-a, --all-src` | also baksmali dex files outside the standard `classesN.dex` names |
| `--no-debug-info` | drop `.line`, `.local`, `.param` from smali |
| `--no-assets` | do not copy `assets/` |
| `--res-resolve-mode default\|greedy\|lazy` | how to treat unresolvable resource references |
| `--keep-broken-res` | keep resources with invalid configs (fix them by hand before building) |
| `--ignore-raw-values` | ignore raw attribute values in XML |
| `--match-original` | keep files as close to the original as possible (prevents rebuild) |
| `-p, --frame-path <dir>` / `-t, --frame-tag <tag>` | which installed framework to use |
| `-l, --lib <package:file>` | resolve a shared resource library (repeatable) |

## build options

| Option | Meaning |
|---|---|
| `-o, --output <file>` | output APK |
| `-f, --force` | ignore change detection, rebuild everything |
| `--debuggable` | set `android:debuggable="true"` |
| `--net-sec-conf` | add a network security config trusting user CAs (for HTTPS interception in testing) |
| `--copy-original` | reuse the original AndroidManifest.xml and META-INF (signature will no longer match the changed content; mostly for system apps) |
| `--no-crunch` | do not crunch PNGs |
| `--no-apk` | build the parts (`build/`) but do not pack an APK |
| `--aapt <file>` | use a different aapt2 binary |
| `-p`, `-l` | as for decode |

## Project layout produced by `decode`

```
AndroidManifest.xml      text manifest (package, components, permissions)
apktool.yml              build metadata (below)
res/                     decoded resources (values*/ XML, layouts, drawables, ...)
smali/                   code from classes.dex; smali_classes2/ for classes2.dex, ...
assets/  lib/  kotlin/   copied as-is
unknown/                 files apktool does not classify; packed back unchanged
original/                original binary manifest + META-INF (only used with --copy-original)
build/  dist/            created by `build`
```

## apktool.yml

```yaml
version: 3.0.3
apkFileName: hello.apk          # default output name in dist/
usesFramework:
  ids: [1]                      # framework package ids (1 = android)
  tag: null                     # framework tag, if decoded with -t
sdkInfo:                        # written into <uses-sdk> at build time
  minSdkVersion: 21
  targetSdkVersion: 35
  maxSdkVersion: null
versionInfo:                    # overrides android:versionCode / versionName
  versionCode: 1
  versionName: 1.0
resourcesInfo:
  packageId: 127                # 0x7f for normal apps
  packageName: null             # set when the resource package name differs from the manifest package
  sparseEntries: false
doNotCompress:                  # extensions / paths stored uncompressed (arsc must be)
- arsc
- png
featureFlags: []                # Android feature flags referenced by the manifest
usesLibrary: []
```

To bump the version or SDK levels, edit `apktool.yml`, not the manifest: these values win at build.

## Frameworks

Apps from OEM ROMs (Samsung, Xiaomi, ...) reference resources in vendor framework APKs. Pull
them from a device (`adb pull /system/framework/framework-res.apk`, plus vendor ones) and
install with `apktool if <file> [-t tag]` before decoding. Frameworks are stored in
`~/.local/share/apktool/framework` (Linux).

## Common build errors

| Error | Fix |
|---|---|
| `error: resource ... not found` / `No resource identifier found` | Missing OEM framework (`apktool if`), or decode with `-r` if resources need no edits |
| `Invalid resource directory name` / dropped resources | Decode with `--keep-broken-res`, fix the folder qualifiers, rebuild |
| `brut.androlib.exceptions.AndrolibException: ... aapt2` | Run with `-v` to see aapt2's own message; usually a broken XML value you edited |
| `Could not smali file` | Syntax error in edited smali; the message gives file and line |
| `Targeting R+ (version 30 and above) requires the resources.arsc of installed APKs to be stored uncompressed and aligned on a 4-byte boundary` | `arsc` missing from `doNotCompress`, or the APK was not zipaligned (`apk.sh build` and `apk.sh sign` align it) |
| `INSTALL_PARSE_FAILED_NO_CERTIFICATES` | APK is unsigned: use `apk.sh build`/`apk.sh sign`, not raw `apktool b` |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | Different signing key from the installed app: uninstall it first |
