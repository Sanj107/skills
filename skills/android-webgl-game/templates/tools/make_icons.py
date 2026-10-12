#!/usr/bin/env python3
"""Generates launcher icons (legacy PNG, round PNG, adaptive foreground) with Pillow.

A placeholder: the app's initials on a gradient with a gold rim. Replace compose() with your
own art (pixel sprites drawn as bevelled squares look great for voxel games).
Usage: python3 tools/make_icons.py "My Game" [#123456] [#081426]
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}
SS = 4


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def font(size):
    for path in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/Library/Fonts/Arial Bold.ttf',
                 'C:/Windows/Fonts/arialbd.ttf'):
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def compose(size, text, top, bottom, background):
    S = size * SS
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    if background:
        grad = Image.new('RGBA', (S, S))
        g = ImageDraw.Draw(grad)
        for y in range(S):
            t = y / (S - 1)
            g.line([(0, y), (S, y)], fill=tuple(int(top[k] * (1 - t) + bottom[k] * t) for k in range(3)) + (255,))
        mask = Image.new('L', (S, S), 0)
        m = ImageDraw.Draw(mask)
        if background == 'square':
            m.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
        else:
            m.ellipse([0, 0, S - 1, S - 1], fill=255)
        img.paste(grad, (0, 0), mask)
        d = ImageDraw.Draw(img)
        rim = int(S * 0.035)
        box = [rim // 2, rim // 2, S - 1 - rim // 2, S - 1 - rim // 2]
        if background == 'square':
            d.rounded_rectangle(box, radius=int(S * 0.2), outline=(245, 190, 60, 255), width=rim)
        else:
            d.ellipse(box, outline=(245, 190, 60, 255), width=rim)
    d = ImageDraw.Draw(img)
    f = font(int(S * (0.42 if background else 0.3)))
    d.text((S / 2, S / 2 + S * 0.02), text, font=f, fill=(255, 210, 63, 255), anchor='mm',
           stroke_width=int(S * 0.02), stroke_fill=(60, 30, 0, 255))
    return img.resize((size, size), Image.LANCZOS)


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else 'Game'
    top = hex_rgb(sys.argv[2] if len(sys.argv) > 2 else '#123456')
    bottom = hex_rgb(sys.argv[3] if len(sys.argv) > 3 else '#081426')
    text = ''.join(w[0] for w in name.split()[:2]).upper() or 'G'
    for dens, k in DENSITIES.items():
        folder = os.path.join(RES, 'mipmap-' + dens)
        os.makedirs(folder, exist_ok=True)
        compose(int(48 * k), text, top, bottom, 'square').save(os.path.join(folder, 'ic_launcher.png'))
        compose(int(48 * k), text, top, bottom, 'circle').save(os.path.join(folder, 'ic_launcher_round.png'))
        # Adaptive foreground: 108dp canvas, artwork inside the 66dp safe circle.
        compose(int(108 * k), text, top, bottom, None).save(os.path.join(folder, 'ic_launcher_foreground.png'))
    anydpi = os.path.join(RES, 'mipmap-anydpi-v26')
    os.makedirs(anydpi, exist_ok=True)
    xml = ('<?xml version="1.0" encoding="utf-8"?>\n'
           '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
           '    <background android:drawable="@color/bg" />\n'
           '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
           '</adaptive-icon>\n')
    for n in ('ic_launcher.xml', 'ic_launcher_round.xml'):
        with open(os.path.join(anydpi, n), 'w') as fh:
            fh.write(xml)


if __name__ == '__main__':
    main()
