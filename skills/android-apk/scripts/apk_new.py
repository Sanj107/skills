#!/usr/bin/env python3
"""Scaffold a minimal, buildable Android app as an apktool project (no Android SDK needed).

    apk_new.py <dir> --package com.example.hello [--name "Hello"] [--text "Hello, Android!"]
               [--min-sdk 21] [--target-sdk 35] [--java]

The result is the same layout `apktool d` produces, so `apk.sh build <dir>` turns it into
a signed APK. Code lives in smali/ (Dalvik assembly); with --java a Java source tree is
created under java/ instead and `apk.sh build` compiles it (javac + dx) into classes.dex.
"""
import argparse
import re
import sys
from pathlib import Path

MANIFEST = """<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="{package}">
    <application android:label="@string/app_name" android:icon="@drawable/ic_launcher" android:allowBackup="false">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
"""

APKTOOL_YML = """version: 3.0.3
apkFileName: {apk_name}.apk
usesFramework:
  ids:
  - 1
sdkInfo:
  minSdkVersion: {min_sdk}
  targetSdkVersion: {target_sdk}
versionInfo:
  versionCode: 1
  versionName: 1.0
resourcesInfo:
  packageId: 127
doNotCompress:
- arsc
"""

STRINGS = """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">{name}</string>
</resources>
"""

ICON = """<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48">
    <path android:fillColor="#3DDC84" android:pathData="M24,4a20,20 0,1 1,0 40a20,20 0,1 1,0 -40z" />
    <path android:fillColor="#FFFFFF" android:pathData="M16,20h16v14h-16z" />
</vector>
"""

SMALI = """.class public L{cls};
.super Landroid/app/Activity;
.source "MainActivity.java"


.method public constructor <init>()V
    .registers 1

    invoke-direct {{p0}}, Landroid/app/Activity;-><init>()V

    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .registers 4

    invoke-super {{p0, p1}}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    new-instance v0, Landroid/widget/TextView;

    invoke-direct {{v0, p0}}, Landroid/widget/TextView;-><init>(Landroid/content/Context;)V

    const-string v1, "{text}"

    invoke-virtual {{v0, v1}}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V

    const/high16 v1, 0x41c00000    # 24.0f

    invoke-virtual {{v0, v1}}, Landroid/widget/TextView;->setTextSize(F)V

    const/16 v1, 0x11    # Gravity.CENTER

    invoke-virtual {{v0, v1}}, Landroid/widget/TextView;->setGravity(I)V

    invoke-virtual {{p0, v0}}, L{cls};->setContentView(Landroid/view/View;)V

    return-void
.end method
"""

JAVA = """package {package};

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

public class MainActivity extends Activity {{
    @Override
    protected void onCreate(Bundle savedInstanceState) {{
        super.onCreate(savedInstanceState);
        TextView view = new TextView(this);
        view.setText("{text}");
        view.setTextSize(24f);
        view.setGravity(Gravity.CENTER);
        setContentView(view);
    }}
}}
"""


def escape(s):
    return s.replace("\\", "\\\\").replace('"', '\\"')


def xml_escape(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
             .replace("'", "\\'").replace('"', '\\"'))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("dir")
    p.add_argument("--package", required=True)
    p.add_argument("--name", default="Hello")
    p.add_argument("--text", default="Hello, Android!")
    p.add_argument("--min-sdk", type=int, default=21)
    p.add_argument("--target-sdk", type=int, default=35)
    p.add_argument("--java", action="store_true", help="write Java sources instead of smali")
    a = p.parse_args()

    if not re.fullmatch(r"[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+", a.package):
        sys.exit(f"invalid package name: {a.package}")
    root = Path(a.dir)
    if root.exists() and any(root.iterdir()):
        sys.exit(f"{root} exists and is not empty")

    cls = a.package.replace(".", "/") + "/MainActivity"
    files = {
        "AndroidManifest.xml": MANIFEST.format(package=a.package),
        "apktool.yml": APKTOOL_YML.format(apk_name=a.package.split(".")[-1],
                                          min_sdk=a.min_sdk, target_sdk=a.target_sdk),
        "res/values/strings.xml": STRINGS.format(name=xml_escape(a.name)),
        "res/drawable/ic_launcher.xml": ICON,
    }
    if a.java:
        files[f"java/{a.package.replace('.', '/')}/MainActivity.java"] = JAVA.format(
            package=a.package, text=escape(a.text))
    else:
        files[f"smali/{cls}.smali"] = SMALI.format(cls=cls, text=escape(a.text))

    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"created {path}")


if __name__ == "__main__":
    main()
