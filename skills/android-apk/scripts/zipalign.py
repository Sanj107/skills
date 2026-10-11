#!/usr/bin/env python3
"""Pure-Python zipalign: align uncompressed (STORED) entries of an APK.

Android requires STORED entries (resources.arsc, uncompressed media) to start at a
4-byte boundary, and uncompressed native libraries (lib/**/*.so) at a page boundary
(16 KiB covers both 4 KiB and 16 KiB page-size devices).

Align BEFORE signing with v2+ (signing afterwards keeps the alignment; aligning a
v2-signed APK breaks its signature).

    zipalign.py in.apk out.apk          # write an aligned copy
    zipalign.py --check app.apk         # exit 1 if any STORED entry is misaligned
    zipalign.py --strip-signatures in.apk out.apk   # also drop old v1 signature files
"""
import argparse
import struct
import sys
import zipfile

ALIGN = 4
SO_ALIGN = 16384
ALIGN_EXTRA_ID = 0xD935  # same extra-field id the SDK's zipalign writes


def wanted_alignment(info):
    return SO_ALIGN if info.filename.endswith(".so") else ALIGN


def strip_align_extra(extra):
    """Remove an existing 0xd935 field (and pure zero padding) from an extra block."""
    out, i = b"", 0
    while i + 4 <= len(extra):
        hid, size = struct.unpack("<HH", extra[i:i + 4])
        if hid != ALIGN_EXTRA_ID and hid != 0:
            out += extra[i:i + 4 + size]
        i += 4 + size
    return out


def is_signature_file(name):
    upper = name.upper()
    return upper.startswith("META-INF/") and upper.count("/") == 1 and (
        upper.endswith((".SF", ".RSA", ".DSA", ".EC")) or upper == "META-INF/MANIFEST.MF")


def align(src, dst, strip_signatures=False):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            if strip_signatures and is_signature_file(info.filename):
                continue
            data = zin.read(info)
            new = zipfile.ZipInfo(info.filename, date_time=info.date_time)
            new.compress_type = info.compress_type
            new.external_attr = info.external_attr
            new.create_system = info.create_system
            extra = strip_align_extra(info.extra)
            if info.compress_type == zipfile.ZIP_STORED:
                alignment = wanted_alignment(info)
                name_len = len(info.filename.encode("utf-8"))
                header_end = zout.fp.tell() + 30 + name_len + len(extra) + 6
                pad = (-header_end) % alignment
                extra += struct.pack("<HHH", ALIGN_EXTRA_ID, 2 + pad, alignment) + b"\0" * pad
            new.extra = extra
            zout.writestr(new, data)


def check(path):
    bad = 0
    with open(path, "rb") as f, zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if info.compress_type != zipfile.ZIP_STORED or info.file_size == 0:
                continue
            f.seek(info.header_offset)
            hdr = f.read(30)
            name_len, extra_len = struct.unpack("<HH", hdr[26:30])
            offset = info.header_offset + 30 + name_len + extra_len
            need = wanted_alignment(info)
            if offset % need:
                bad += 1
                print(f"MISALIGNED {info.filename} offset={offset} need={need}")
    print("alignment OK" if not bad else f"{bad} misaligned entries")
    return bad == 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--check", action="store_true", help="only verify alignment")
    p.add_argument("--strip-signatures", action="store_true", help="drop META-INF signature files")
    p.add_argument("apk")
    p.add_argument("out", nargs="?")
    a = p.parse_args()
    if a.check:
        sys.exit(0 if check(a.apk) else 1)
    if not a.out:
        p.error("output path required")
    align(a.apk, a.out, a.strip_signatures)
    sys.exit(0 if check(a.out) else 1)


if __name__ == "__main__":
    main()
