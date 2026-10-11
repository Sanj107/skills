---
name: android-apk
description: Create, read, inspect, decompile, modify, rebuild and sign Android APK files without the Android SDK. Use whenever the user mentions an .apk file or wants to build a simple Android app, see what's inside an APK (manifest, permissions, activities, version, signing certificate), decompile it to Java or smali, change resources/strings/code and repackage, zipalign, or sign/verify an APK. Built on Apktool, apksigner (AOSP), jadx and androguard.
license: Complete terms in LICENSE.txt (Apache-2.0). Downloaded tools keep their own licenses (Apktool, apksig, jadx, androguard are Apache-2.0).
---

# Android APK

An APK is a ZIP containing `AndroidManifest.xml` (binary XML), `classes*.dex` (Dalvik
bytecode), `resources.arsc` (compiled resource table), `res/`, `assets/`, `lib/<abi>/*.so`
and signatures (`META-INF/` for v1, an APK Signing Block before the ZIP central directory for v2/v3).
None of it is readable with plain `unzip`, so use the tools below.

## Setup (once per machine)

```bash
bash scripts/setup.sh            # apktool, apksigner, debug keystore, androguard
bash scripts/setup.sh --all      # + jadx (Java decompiler) and the Java->dex toolchain
```

Needs a JDK 17+ (`java`, `javac`, `keytool`), `python3`, `git`, `curl`; `mvn` for jadx.
Tools go to `~/.cache/android-apk-skill` (override with `APK_TOOLS_HOME`).
All commands below go through `scripts/apk.sh` (run `scripts/apk.sh --help`).

## Choose the workflow

| Task | Command |
|---|---|
| What is this APK? (package, version, SDKs, permissions, components, signer) | `apk.sh info app.apk` (`--json`, `--manifest`, `--files`, `--classes [prefix]`, `--strings [prefix]`) |
| Read the code as Java | `apk.sh decompile app.apk -o out/` (jadx; read-only, cannot be rebuilt) |
| Edit resources / manifest / smali and rebuild | `apk.sh decode app.apk -o proj/` → edit → `apk.sh build proj/ -o new.apk` |
| Create a new app from scratch | `apk.sh new proj/ --package com.example.app [--java]` → `apk.sh build proj/` |
| Sign / re-sign an APK | `apk.sh sign in.apk out.apk` |
| Check signature + alignment | `apk.sh verify app.apk` |

`apk.sh build` = `apktool b` → strip old signatures → zipalign (4 bytes; 16 KiB for `.so`) →
`apksigner sign` (v1+v2+v3) → verify. Raw `apktool b` output is **unsigned and cannot be installed**.

## Reading an APK

1. Start with `apk.sh info app.apk` — no unpacking, works on large apps.
2. For behaviour, `apk.sh decompile` and read `out/sources/<package path>/`; resources are
   in `out/resources/`. Obfuscated names (`a.b.c`) are normal for release builds.
3. For exact bytecode or anything you will modify, `apk.sh decode` and read `smali/`.
4. Split APKs / bundles: `.apks`, `.xapk`, `.apkm` are ZIPs of APKs — unzip and work on
   `base.apk` (plus the `split_config.*.apk` you need). jadx opens them directly. An `.aab`
   is not installable; it must be converted with bundletool (not included).

## Modifying an APK

1. `apk.sh decode app.apk -o proj -f` (add `-r` if you only touch code: skips resource
   decoding and avoids most rebuild errors; add `-s` if you only touch resources).
2. Edit:
   - text/labels: `proj/res/values*/strings.xml`
   - permissions, components, `android:debuggable`, exported flags: `proj/AndroidManifest.xml`
   - version / min/target SDK: `proj/apktool.yml` (`versionInfo`, `sdkInfo`) — these override the manifest
   - code: `proj/smali*/…` — see [reference/smali.md](reference/smali.md). Non-ASCII strings
     appear as `\uXXXX` escapes in smali; search for the escaped form.
3. `apk.sh build proj -o app-mod.apk` (`--debuggable`, `--net-sec-conf` available).
4. `apk.sh verify app-mod.apk`, then `apk.sh info app-mod.apk` to confirm the change.

The result is signed with a **different key** than the original, so it installs only after
uninstalling the original app, and apps that check their own signature or use Play Integrity
may refuse to run. Full option list and build-error table: [reference/apktool.md](reference/apktool.md).

## Creating an APK from scratch

```bash
scripts/apk.sh new hello --package com.example.hello --name "Hello" --text "Hello, Android!"
scripts/apk.sh build hello            # -> hello/dist/hello.apk, signed
```

This writes an apktool-style project (manifest, `apktool.yml`, `res/values/strings.xml`, a
vector launcher icon, and `smali/.../MainActivity.smali` showing a TextView). Extend it by
adding resources under `res/` and classes in smali.

With `--java`, `MainActivity.java` goes under `java/` and `apk.sh build` compiles it with
`javac --release 8` against Android API stubs (API 16 `android.jar` from Maven Central) and
converts to `classes.dex` with dx (needs `setup.sh --with-java`). Jars in `proj/libs/` are added
to the classpath and dex. Limits: framework APIs only up to API 16 at compile time (newer
APIs need reflection), Java 8 language level, no AndroidX/Kotlin, no Gradle. For a full modern
app (Compose, AndroidX, Kotlin) a real Android Gradle project + SDK is required — say so
rather than forcing this toolchain.

Default `--min-sdk 21` (vector icons need 21+), `--target-sdk 35`. The launcher activity has
`android:exported="true"`, required for target SDK 31+.

## Signing

- Default key: `~/.cache/android-apk-skill/debug.p12` (alias `androiddebugkey`, password
  `android`) — fine for testing, never for publishing.
- Own key: `APK_KEYSTORE=release.jks APK_KS_PASS=… APK_KEY_ALIAS=… APK_KEY_PASS=… apk.sh sign in.apk out.apk`.
  Create one with `keytool -genkeypair -keystore release.p12 -storetype PKCS12 -alias release -keyalg RSA -keysize 4096 -validity 10000`.
  Keep it safe: Android only accepts updates signed with the same key.
- Never zipalign or otherwise rewrite an APK *after* v2+ signing; that invalidates it.
  `apk.sh align`/`zipalign.py` exists for unsigned APKs.
- Advanced (key rotation, lineage, v4): `apk.sh apksigner <args>` is Google's apksigner.

## Installing / testing

There is no emulator here. If the user has a device: `adb install -r app.apk`
(`adb uninstall <package>` first when the signature differs). Logs: `adb logcat`.

## Scope

Only work on APKs the user owns or is authorized to analyse (their apps, open-source apps,
malware analysis, security testing, localization, interoperability). Don't help strip license
checks, ads or DRM from someone else's paid app, or repackage apps for redistribution.
