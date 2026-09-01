#!/usr/bin/env python3
"""
Colour-grade the car sprite onto the scene's own light.

The sprite came from a different painting than the terrain plates, so it reads hot
and over-saturated against them. The reference painting contains the same car drawn
by the hand that painted the scene, so that car is the target.

The correction is measured on the pink bodywork — the one surface both cars share —
and applied as a multiplicative gain plus a desaturation. Gain preserves colour
ratios, so the tyres stay black and the walnut dash stays brown; an affine
mean/std match does not, and turns the dark trim olive.

Usage:  python3 tools/grade-car.py <reference.png> <car.webp> <out.webp>
"""
import sys
import numpy as np
from PIL import Image

# the car as painted into the reference, kept clear of the verge foliage
REF_BOX = (404, 848, 480, 1010)
LUMA = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)


def pink(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return (r > 90) & (r - g > 25) & (r - b > 8)


def sat_of(px):
    mx, mn = px.max(1), px.min(1)
    return float(np.mean(np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)))


def main():
    ref_path, car_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

    ra = np.asarray(Image.open(ref_path).convert("RGB").crop(REF_BOX), dtype=np.float32)
    ref = ra[pink(ra)]
    if len(ref) < 200:
        raise SystemExit("reference crop found no bodywork — check REF_BOX")

    car = Image.open(car_path).convert("RGBA")
    arr = np.asarray(car, dtype=np.float32)
    rgb, alpha = arr[:, :, :3], arr[:, :, 3]
    src = rgb[pink(rgb) & (alpha > 40)]

    gain = np.clip(np.median(ref, 0) / np.maximum(np.median(src, 0), 1.0), 0.55, 1.45)
    out = rgb * gain.reshape(1, 1, 3)

    # then pull saturation down to the reference's, around each pixel's own luma
    f = np.clip(sat_of(ref) / max(sat_of(src), 1e-3), 0.3, 1.0)
    l = (out * LUMA).sum(2, keepdims=True)
    out = l + (out - l) * f

    print(f"  body median {np.median(src,0).round(1).tolist()} -> {np.median(ref,0).round(1).tolist()}")
    print(f"  gain {gain.round(3).tolist()}   saturation x{f:.3f}")

    res = np.dstack([np.clip(out, 0, 255), alpha]).astype(np.uint8)
    im = Image.fromarray(res, "RGBA")

    # Resample to the scene's own resolution. The sprite is drawn at ~2.6x the detail
    # density of the painted car, so at display size it is sharper than everything
    # around it and reads as a sticker laid on the painting rather than part of it.
    ref_w = REF_BOX[2] - REF_BOX[0]
    target = int(ref_w * 1.25)                  # a little headroom for high-DPI screens
    if im.width > target:
        im = im.resize((target, round(im.height * target / im.width)), Image.LANCZOS)
        print(f"  resampled {car.width}px -> {target}px to match the scene's detail density")

    im.save(out_path, "WEBP", quality=92, method=6)
    print(f"wrote {out_path} ({im.width}x{im.height})")


if __name__ == "__main__":
    main()
