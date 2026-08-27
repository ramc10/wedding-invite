#!/usr/bin/env python3
"""
Pull a structure in toward the road, closing the vegetation strip between them.

Everything from --x0 rightward slides left by --dx, which deletes the band of trees
between the road shoulder and the structure and leaves the structure meeting the
verge. The shift eases in and out over --ramp rows so the foliage above and below
does not step sideways; over organic cover that shear is invisible.

Usage:
  python3 tools/close-verge.py in.png out.png --x0 497 --dx 66 --rows 1000 1600
"""
import argparse
import numpy as np
from PIL import Image


def smoothstep(t):
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--x0", type=int, required=True, help="left edge of what gets pulled in")
    ap.add_argument("--dx", type=float, required=True, help="how far to pull it, px")
    ap.add_argument("--rows", type=int, nargs=2, required=True, help="row band to act on")
    ap.add_argument("--ramp", type=int, default=90, help="rows of ease at each end")
    args = ap.parse_args()

    im = Image.open(args.src).convert("RGB")
    a = np.asarray(im, dtype=np.float32)
    h, w = a.shape[:2]
    y0, y1 = args.rows

    # per-row shift: 0 outside the band, dx inside, eased across `ramp` rows
    ys = np.arange(h, dtype=np.float32)
    up = smoothstep((ys - (y0 - args.ramp)) / args.ramp)
    dn = smoothstep(((y1 + args.ramp) - ys) / args.ramp)
    shift = args.dx * np.clip(np.minimum(up, dn), 0, 1)

    out = a.copy()
    xs = np.arange(w, dtype=np.float32)
    for y in range(h):
        s = float(shift[y])
        if s < 0.05:
            continue
        start = int(np.floor(args.x0 - s))
        # sample from further right, so the band between start and x0 is discarded
        src_x = np.clip(xs[start:] + s, 0, w - 1)
        for c in range(3):
            out[y, start:, c] = np.interp(src_x, xs, a[y, :, c])

    Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(args.dst)
    band = int((shift > 0.05).sum())
    print(f"{args.dst}: pulled x>={args.x0} in by {args.dx:.0f}px across {band} rows "
          f"(full shift on {int((shift > args.dx * 0.99).sum())})")


if __name__ == "__main__":
    main()
