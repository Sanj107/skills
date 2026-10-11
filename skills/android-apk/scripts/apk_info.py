#!/usr/bin/env python3
"""Read an APK without unpacking it (androguard).

    apk_info.py app.apk                 # summary: package, versions, SDKs, components, permissions, signing
    apk_info.py app.apk --json          # same summary as JSON
    apk_info.py app.apk --manifest      # decoded AndroidManifest.xml
    apk_info.py app.apk --files         # entries with size and compression
    apk_info.py app.apk --classes [PREFIX]   # classes defined in the DEX files
    apk_info.py app.apk --strings PREFIX     # app string resources whose name starts with PREFIX ('' = all)
"""
import argparse
import hashlib
import json
import sys
import zipfile

try:
    from loguru import logger
    logger.remove()  # androguard logs every parsing step to stderr
except ImportError:
    pass

try:
    from androguard.core.apk import APK
except ImportError:
    sys.exit("androguard is not installed: run scripts/setup.sh (or pip install androguard)")


def summary(apk):
    certs = []
    for cert in apk.get_certificates():
        certs.append({
            "subject": cert.subject.human_friendly,
            "sha256": hashlib.sha256(cert.dump()).hexdigest(),
        })
    return {
        "package": apk.get_package(),
        "app_name": apk.get_app_name(),
        "version_code": apk.get_androidversion_code(),
        "version_name": apk.get_androidversion_name(),
        "min_sdk": apk.get_min_sdk_version(),
        "target_sdk": apk.get_target_sdk_version(),
        "max_sdk": apk.get_max_sdk_version(),
        "main_activity": apk.get_main_activity(),
        "activities": apk.get_activities(),
        "services": apk.get_services(),
        "receivers": apk.get_receivers(),
        "providers": apk.get_providers(),
        "permissions": apk.get_permissions(),
        "features": list(apk.get_features()),
        "native_abis": sorted({f.split("/")[1] for f in apk.get_files() if f.startswith("lib/") and f.count("/") >= 2}),
        "dex_files": [f for f in apk.get_files() if f.endswith(".dex")],
        "signed": {"v1": apk.is_signed_v1(), "v2": apk.is_signed_v2(), "v3": apk.is_signed_v3()},
        "certificates": certs,
    }


def print_summary(s):
    for key in ("package", "app_name", "version_code", "version_name", "min_sdk", "target_sdk",
                "max_sdk", "main_activity"):
        print(f"{key:14} {s[key]}")
    print(f"{'signed':14} " + ", ".join(k for k, v in s["signed"].items() if v) or "no")
    for c in s["certificates"]:
        print(f"{'certificate':14} {c['subject']}  sha256={c['sha256']}")
    for key in ("native_abis", "dex_files", "permissions", "features", "activities", "services",
                "receivers", "providers"):
        items = s[key]
        print(f"{key} ({len(items)}):")
        for item in items:
            print(f"  {item}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("apk")
    g = p.add_mutually_exclusive_group()
    g.add_argument("--json", action="store_true")
    g.add_argument("--manifest", action="store_true")
    g.add_argument("--files", action="store_true")
    g.add_argument("--classes", nargs="?", const="", metavar="PREFIX")
    g.add_argument("--strings", metavar="PREFIX")
    a = p.parse_args()

    if a.files:
        with zipfile.ZipFile(a.apk) as z:
            for i in z.infolist():
                method = "stored" if i.compress_type == zipfile.ZIP_STORED else "deflated"
                print(f"{i.file_size:>10} {i.compress_size:>10} {method:8} {i.filename}")
        return

    apk = APK(a.apk)
    if a.manifest:
        from lxml import etree
        print(etree.tostring(apk.get_android_manifest_xml(), pretty_print=True, encoding="unicode"))
    elif a.classes is not None:
        from androguard.core.dex import DEX
        for dex in apk.get_all_dex():
            for cls in DEX(dex).get_classes():
                name = cls.get_name()[1:-1].replace("/", ".")
                if name.startswith(a.classes):
                    print(name)
    elif a.strings is not None:
        res = apk.get_android_resources()
        pkg = apk.get_package()
        for locale, strings in res.get_resolved_strings().get(pkg, {}).items():
            for res_id, value in strings.items():
                rname = res.get_resource_xml_name(res_id, pkg) or hex(res_id)
                if rname.split("/")[-1].startswith(a.strings):
                    print(f"[{locale}] {rname} = {value}")
    elif a.json:
        print(json.dumps(summary(apk), indent=2, ensure_ascii=False))
    else:
        print_summary(summary(apk))


if __name__ == "__main__":
    main()
