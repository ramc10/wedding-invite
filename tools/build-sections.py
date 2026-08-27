#!/usr/bin/env python3
"""
Build a sectioned ribbon.

Same painting machinery as build-ribbon.py — which stays untouched, so the reference
build keeps working — but the output is organised differently, and that difference is
the point.

In the reference build the whole journey is one ribbon divided globally: leg count
comes from segment count, and every arrival falls at a fraction of total travel. So
adding art anywhere changes total travel, which moves every arrival, which is why
adjusting one section kept visibly disturbing the others.

Here a section declares its own scroll length and owns its own band of ribbon rows.
Section 2 can be relengthened, retrimmed or replaced and section 1's mapping does not
move. The plates are still stitched into one continuous strip, so the joins stay
seamless — only the addressing changes.

Usage:  python3 tools/build-sections.py sections.json -o site-v2
"""
import argparse, json, math, os, sys
from importlib import import_module
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
br = import_module("build-ribbon")


def straighten(im, centres, scale, out_w):
    """Warp each row so the painted road sits exactly on the frame centre.

    Centring a plate on its *median* road position leaves the road wandering — and
    worse, a plate whose road ends somewhere other than where it began cannot repeat
    without the road stepping sideways at the join. Shifting row by row fixes both:
    the road is straight, and every plate now starts and ends centred, so repeats and
    section joins line up by construction.

    The cost is a slight horizontal shear of the terrain. Over tens of pixels across a
    plate's whole height, in foliage, it is not visible.
    """
    nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    im2 = im.convert("RGB").resize((nw, nh), Image.LANCZOS)
    c2 = np.interp(np.linspace(0, len(centres) - 1, nh),
                   np.arange(len(centres)), centres) * scale

    src = np.asarray(im2, dtype=np.float32)
    out = np.empty((nh, out_w, 3), dtype=np.float32)
    xs = np.arange(nw, dtype=np.float32)
    want = np.arange(out_w, dtype=np.float32) - out_w / 2.0
    for y in range(nh):
        take = np.clip(want + c2[y], 0, nw - 1)
        for ch in range(3):
            out[y, :, ch] = np.interp(take, xs, src[y, :, ch])
    return (Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)),
            np.zeros(nh, dtype=np.float32))


def usable_width(im, centres, scale):
    """How wide a frame the plate can fill once every row is centred on its road."""
    c = np.asarray(centres, dtype=np.float32) * scale
    nw = im.width * scale
    return 2.0 * float(min(c.min(), nw - c.max()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("-o", "--out", default="site-v2")
    ap.add_argument("--quality", type=int, default=78)
    args = ap.parse_args()

    mf = json.load(open(args.manifest))
    root = os.path.dirname(os.path.abspath(args.manifest))
    ROAD_W = mf.get("road_width", 94)
    OVER = mf.get("overlap", 200)
    CH = mf.get("chunk_height", 640)
    art_dir = os.path.join(args.out, "art")
    os.makedirs(art_dir, exist_ok=True)

    # flatten to a plate list, remembering which section each plate belongs to
    plates = []
    for si, sec in enumerate(mf["sections"]):
        for p in sec["plates"]:
            for _ in range(int(p.get("count", 1))):
                plates.append((si, p))
    if not plates:
        raise SystemExit("no plates")

    def key(p):
        r = p.get("rows")
        return (p["src"], tuple(r) if r else None)

    print(f"measuring {len(set(key(p) for _, p in plates))} distinct plate(s)")
    meas = {}
    for _, p in plates:
        k = key(p)
        if k in meas:
            continue
        im = Image.open(os.path.join(root, p["src"]))
        if p.get("rows"):
            r0, r1 = p["rows"]
            im = im.crop((0, max(0, r0), im.width, min(im.height, r1)))
        centres, med, scale, _ = br.plate_scale(im, p["src"], ROAD_W)
        avail = usable_width(im, centres, scale)
        meas[k] = (im, centres, med, scale, avail)
        rows = f" rows {p['rows'][0]}-{p['rows'][1]}" if p.get("rows") else ""
        print(f"  {os.path.basename(p['src'])[:24]:24s}{rows:16s} road {med:5.1f}px"
              f"  field {avail / ROAD_W:5.2f}  x{scale:.3f}")

    # A wider frame means each screen swallows more rows of painting, so capping it
    # is how you trade framing against how far a section can travel on the art you have.
    avail = min(m[4] for m in meas.values())
    OUT_W = int(min(avail, mf["out_width"]) if mf.get("out_width") else avail) // 2 * 2
    print(f"  frame {OUT_W}px, road {ROAD_W}px ({ROAD_W / OUT_W * 100:.1f}% of frame)")

    cache = {}
    for k, (im, centres, med, scale, _) in meas.items():
        cache[k] = straighten(im, centres, scale, OUT_W)

    # exposure onto the mean asphalt, as before
    rgbs = np.array([br.asphalt_rgb(v[0], v[1], ROAD_W) for v in cache.values()])
    target = rgbs.mean(0)
    graded = {}
    for k, (norm, c2) in cache.items():
        cur = br.asphalt_rgb(norm, c2, ROAD_W)
        gain = np.clip(target / np.maximum(cur, 1.0), 0.85, 1.18)
        graded[k] = (br.apply_gain(norm, gain), c2)

    # stitch, recording where each section begins and ends
    parts, centres_parts, bounds = [], [], {}
    cursor, prev = 0, None
    for si, p in plates:
        im, c2 = graded[key(p)]
        a = np.asarray(im, dtype=np.uint8)
        c = np.asarray(c2, dtype=np.float32)
        v = min(OVER, len(a) // 2, len(prev) // 2) if prev is not None else 0
        seg_start = 0 if prev is None else cursor - v
        cursor = seg_start + len(a)
        if si not in bounds:
            bounds[si] = [seg_start, cursor]
        bounds[si][1] = cursor

        if prev is None:
            parts.append(a); centres_parts.append(c)
        else:
            pa, pc = parts.pop(), centres_parts.pop()
            w = br.smoothstep(v).reshape(v)
            parts.append(np.concatenate([pa[:-v], br.crossblend(pa, a, v)], 0))
            centres_parts.append(np.concatenate([pc[:-v], pc[-v:] * (1 - w) + c[:v] * w]))
            parts.append(a[v:]); centres_parts.append(c[v:])
        prev = a

    strip = np.concatenate(parts, 0)
    road_centres = np.concatenate(centres_parts, 0)
    H = strip.shape[0]

    # slice once, for the whole strip — sections address rows, not files
    chunks, total = [], 0
    for i in range(math.ceil(H / CH)):
        y0, y1 = i * CH, min(H, (i + 1) * CH)
        name = f"ribbon-{i:03d}.webp"
        Image.fromarray(strip[y0:y1]).save(
            os.path.join(art_dir, name), "WEBP", quality=args.quality, method=6)
        kb = os.path.getsize(os.path.join(art_dir, name)) // 1024
        total += kb
        chunks.append({"src": f"art/{name}", "y": y0, "h": y1 - y0})

    out_sections = []
    for si, sec in enumerate(mf["sections"]):
        a, b = bounds[si]
        # "stop" is rows into the section — unambiguous when a section repeats a plate
        st = sec.get("stop")
        stop_row = None if st is None else min(a + st, b)
        out_sections.append({
            "id": sec.get("id", f"section {si + 1}"),
            "rows": [round(a, 1), round(b, 1)],
            "scrollVh": sec.get("scrollVh", 150),
            "drive": sec.get("drive", 0.55),
            "stopRow": None if stop_row is None else round(stop_row, 1),
            "petals": bool(sec.get("petals")),
        })
        print(f"  section '{out_sections[-1]['id']}': ribbon rows {a:.0f}-{b:.0f}"
              f"  ({sec.get('scrollVh', 150)}vh of scroll)")

    STEP = 8
    json.dump({
        "width": OUT_W, "height": H, "roadWidth": ROAD_W, "chunkHeight": CH,
        "chunks": chunks,
        "sections": out_sections,
        "roadCentre": {"step": STEP,
                       "values": [round(float(v), 2) for v in road_centres[::STEP]]},
    }, open(os.path.join(args.out, "sections.json"), "w"), separators=(",", ":"))

    print(f"ribbon {OUT_W}x{H}px, {len(chunks)} chunks, {total}KB")


if __name__ == "__main__":
    main()
