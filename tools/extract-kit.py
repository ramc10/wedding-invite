#!/usr/bin/env python3
"""
Derive a 3D kit's palette and ground texture from a painted plate.

The whole risk in modelling the scenery is that it stops looking like the paintings.
Sampling the colours out of the painting itself removes most of that risk up front —
the same move that made the generated verge and the graded car sit correctly.

Usage:  python3 tools/extract-kit.py plate.png out_dir
"""
import json, os, sys
import numpy as np
from PIL import Image


def seamless(tile):
    """Offset by half, then heal the cross seam — the standard trick, applied once."""
    a = np.asarray(tile, dtype=np.float32)
    h, w = a.shape[:2]
    r = np.roll(np.roll(a, h // 2, 0), w // 2, 1)
    band = max(8, w // 10)
    ramp = np.clip(np.arange(band) / band, 0, 1)[None, :, None]
    # heal the vertical seam left down the middle, then the horizontal one
    x0 = w // 2 - band // 2
    r[:, x0:x0 + band] = r[:, x0:x0 + band] * ramp + np.flip(r[:, x0:x0 + band], 1) * (1 - ramp)
    y0 = h // 2 - band // 2
    rampv = np.clip(np.arange(band) / band, 0, 1)[:, None, None]
    r[y0:y0 + band] = r[y0:y0 + band] * rampv + np.flip(r[y0:y0 + band], 0) * (1 - rampv)
    return Image.fromarray(np.clip(r, 0, 255).astype(np.uint8))


def main():
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    im = Image.open(src).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    h, w = a.shape[:2]
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]

    # --- ground: the calmest green patch in the plate -----------------------
    N = 384
    best, bestscore = None, 1e18
    for y in range(0, h - N, 96):
        for x in range(0, w - N, 96):
            p = a[y:y + N, x:x + N]
            green = (p[:, :, 1] > p[:, :, 0] + 8) & (p[:, :, 1] > p[:, :, 2] + 8)
            if green.mean() < 0.85:
                continue
            score = p.std(axis=(0, 1)).mean()       # calm = low variance
            if score < bestscore:
                bestscore, best = score, (x, y)
    if best is None:
        raise SystemExit("no uniform green patch found")
    x, y = best
    tile = seamless(im.crop((x, y, x + N, y + N)).resize((512, 512), Image.LANCZOS))
    tile.save(os.path.join(out, "ground.webp"), "WEBP", quality=88, method=6)
    print(f"ground tile from ({x},{y}), variance {bestscore:.1f} -> ground.webp")

    # --- palette: sampled, never invented -----------------------------------
    def med(mask, name):
        px = a[mask]
        if len(px) < 200:
            return None
        v = np.median(px, 0)
        return "#%02X%02X%02X" % tuple(int(c) for c in v)

    lum = a.mean(2)
    greens = (g > r + 8) & (g > b + 8)
    pal = {
        "groundDark":  med(greens & (lum < np.percentile(lum[greens], 25)), "d"),
        "groundMid":   med(greens & (lum > np.percentile(lum[greens], 40)) & (lum < np.percentile(lum[greens], 60)), "m"),
        "groundLight": med(greens & (lum > np.percentile(lum[greens], 82)), "l"),
        "conifer":     med(greens & (g < 120) & (lum < np.percentile(lum[greens], 15)), "c"),
        "blossomPink": med((r > 170) & (r - g > 30) & (r - b > 5), "p"),
        "blossomWhite": med((r > 205) & (g > 200) & (b > 185) & (abs(r - g) < 22), "w"),
        "rock":        med((abs(r - g) < 16) & (abs(g - b) < 16) & (lum > 90) & (lum < 165), "r"),
    }
    pal = {k: v for k, v in pal.items() if v}
    json.dump(pal, open(os.path.join(out, "palette.json"), "w"), indent=1)
    for k, v in pal.items():
        print(f"  {k:14s} {v}")


if __name__ == "__main__":
    main()
