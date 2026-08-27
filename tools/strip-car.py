#!/usr/bin/env python3
"""
Remove a car painted into a road plate.

The generated references have the pink convertible baked in. The site draws its own
car sprite, so a painted one would double up and drift against it. Asphalt is a
near-uniform vertical texture, so clean road cloned from elsewhere in the same
plate patches it invisibly.

Usage:  python3 tools/strip-car.py in.png out.png
"""
import sys, os
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module
_br = import_module("build-ribbon")


def pink_rows(arr, centres, widths):
    """Rows where saturated pink sits on the tarmac — that's the car, not blossom."""
    h, w = arr.shape[:2]
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    pink = (r > 150) & (r - g > 42) & (r - b > 14)
    xs = np.arange(w)[None, :]
    # the asphalt core only — the flowering verge and the petals drifted along the
    # shoulder are also pink, and they are not the car
    lo = (centres - widths * 0.42)[:, None]
    hi = (centres + widths * 0.42)[:, None]
    on_road = (xs >= lo) & (xs <= hi)
    return (pink & on_road).sum(1)


def largest_block(hits, gap=6):
    """The car is one solid object; scattered petals are not."""
    if hits.size == 0:
        return None
    brk = np.flatnonzero(np.diff(hits) > gap)
    groups = np.split(hits, brk + 1)
    g = max(groups, key=len)
    return int(g[0]), int(g[-1])


def main():
    src, dst = sys.argv[1], sys.argv[2]
    im = Image.open(src).convert("RGB")
    arr = np.asarray(im, dtype=np.float32)
    centres, widths = _br.detect_road(arr, os.path.basename(src))

    cnt = pink_rows(arr, centres, widths)
    # a low bar: the nose, tail and pale cockpit carry little pink, and clipping
    # the car to its widest rows leaves both ends behind
    thr = max(3.0, float(np.median(widths)) * 0.05)
    hits = np.flatnonzero(cnt > thr)
    if hits.size == 0:
        im.save(dst)
        print(f"{os.path.basename(src)}: no car on the road — copied unchanged")
        return

    blk = largest_block(hits, gap=12)
    if blk is None:
        im.save(dst)
        print(f"{os.path.basename(src)}: no car on the road — copied unchanged")
        return
    PAD = 26                                        # take the shadow too
    y0 = max(0, blk[0] - PAD)
    y1 = min(arr.shape[0], blk[1] + PAD + 1)
    n = y1 - y0

    # a clean stretch of the same road, as far from the car as the plate allows
    above, below = y0, arr.shape[0] - y1
    if above >= n + 40:
        s0 = y0 - n - 20
    elif below >= n + 40:
        s0 = y1 + 20
    else:
        raise SystemExit(f"{src}: no clean road long enough to clone ({n}px needed)")

    half = int(np.median(widths) * 1.15)
    out = arr.copy()
    fy = np.minimum(np.arange(n), np.arange(n)[::-1])
    fy = np.clip(fy / 14.0, 0, 1)[:, None, None]    # feather the top and bottom seams

    for i in range(n):
        c = int(round(centres[y0 + i]))
        sc = int(round(centres[s0 + i]))
        a, b = max(0, c - half), min(arr.shape[1], c + half + 1)
        sa, sb = sc - (c - a), sc + (b - c)
        if sa < 0 or sb > arr.shape[1]:
            continue
        fx = np.minimum(np.arange(b - a), np.arange(b - a)[::-1])
        fx = np.clip(fx / 10.0, 0, 1)[:, None]
        w = fy[i] * fx
        out[y0 + i, a:b] = out[y0 + i, a:b] * (1 - w) + arr[s0 + i, sa:sb] * w

    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(dst)
    print(f"{os.path.basename(src)}: car removed, rows {y0}-{y1} "
          f"({n}px) cloned from {s0}")


if __name__ == "__main__":
    main()
