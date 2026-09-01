#!/usr/bin/env python3
"""
Build the scrolling terrain ribbon from painted segments.

The browser does no blending at runtime. Everything that could produce a visible
seam is resolved here, once, offline:

  1. detect the painted road band in every segment (centre + width, per row)
  2. normalise altitude   — rescale so every segment's road is the same width
  3. normalise position   — translate so every segment's road sits on frame centre
  4. normalise exposure   — match on asphalt, the one material common to all art
  5. cross-blend overlaps — SAME-terrain blends only, never terrain-to-terrain
  6. slice to chunks      — a lossless cut, so chunks butt-join pixel-perfectly

Usage:  python3 tools/build-ribbon.py <manifest.json> [-o site]
"""
import argparse, json, math, os, sys
import numpy as np
from PIL import Image, ImageFilter

# ---------------------------------------------------------------- road detect

def _runs(mask_row, tol=4):
    """Contiguous runs of True, tolerating gaps of up to `tol` px."""
    idx = np.flatnonzero(mask_row)
    if idx.size == 0:
        return []
    brk = np.flatnonzero(np.diff(idx) > tol)
    groups = np.split(idx, brk + 1)
    return [(int(g[0]), int(g[-1])) for g in groups if g.size]


def asphalt_mask(arr):
    """Asphalt reads as low-saturation, mid-dark. Works across every daylight tint."""
    mx = arr.max(2)
    mn = arr.min(2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1.0), 0.0)
    val = mx / 255.0
    return (sat < 0.30) & (val > 0.12) & (val < 0.72)


def detect_road(arr, name="segment"):
    """
    Two passes. A global estimate first, then a per-row track that stays near it —
    otherwise grey rock, concrete and open water get mistaken for tarmac.
    Returns (centres[h], widths[h]) with gaps interpolated and lightly smoothed.
    """
    h, w = arr.shape[:2]
    m = asphalt_mask(arr)
    x0, x1 = int(w * 0.22), int(w * 0.78)          # the road is never at the frame edge
    band = m[:, x0:x1]

    # pass 1 — column vote over the middle rows
    score = band[int(h * 0.15):int(h * 0.85)].mean(0)
    hot = np.flatnonzero(score > 0.45)
    if hot.size == 0:
        raise SystemExit(f"{name}: no road band found — is this a top-down road plate?")
    r = _runs(np.isin(np.arange(band.shape[1]), hot), tol=3)
    a, b = max(r, key=lambda t: t[1] - t[0])
    g_centre, g_width = (a + b) / 2.0, float(b - a + 1)

    # pass 2 — walk outward from the middle row, following the road one row at a time.
    # Open water, wet rock and haze all satisfy the asphalt mask, so a global
    # nearest-match test hops onto them; continuity is what makes this robust.
    centres = np.full(h, np.nan)
    widths = np.full(h, np.nan)
    MAX_STEP = max(2.0, g_width * 0.12)            # the road cannot jump between rows

    def walk(rows, ref):
        for y in rows:
            best, bestd = None, 1e9
            for (ra, rb) in _runs(band[y], tol=4):
                cw = rb - ra + 1
                if not (0.45 * g_width <= cw <= 1.9 * g_width):
                    continue
                cc = (ra + rb) / 2.0
                d = abs(cc - ref)
                if d < bestd:
                    best, bestd = (cc, cw), d
            if best and bestd <= MAX_STEP:
                centres[y], widths[y] = best
                ref = best[0]                       # track, don't anchor
        return ref

    mid = h // 2
    walk(range(mid, h), g_centre)
    walk(range(mid, -1, -1), g_centre)

    if np.isnan(centres).all():
        centres[:], widths[:] = g_centre, g_width

    ys = np.arange(h)
    ok = ~np.isnan(centres)
    centres = np.interp(ys, ys[ok], centres[ok])
    widths = np.interp(ys, ys[ok], widths[ok])
    centres = smooth(centres, 61)
    widths = smooth(widths, 121)
    cov = ok.mean()
    if cov < 0.55:
        print(f"    ! {name}: road tracked on only {cov*100:.0f}% of rows")
    return centres + x0, widths


def smooth(v, k):
    k = max(3, int(k) | 1)
    pad = np.pad(v, k // 2, mode="edge")
    return np.convolve(pad, np.ones(k) / k, mode="valid")

# ------------------------------------------------------------- normalisation

def plate_scale(im, name, road_w_target):
    """Measure the road and work out the rescale that puts every plate at one altitude."""
    arr = np.asarray(im.convert("RGB"), dtype=np.float32)
    centres, widths = detect_road(arr, name)
    med_w = float(np.median(widths))
    scale = road_w_target / med_w
    # Usable half-width either side of the road once rescaled — the frame can be no
    # wider than this, or the plate has to be invented at the edges. Measured against
    # the extreme rows, not the median: every row gets centred on its own road, so
    # the row whose road sits furthest left is the one that runs out of picture first.
    c = np.asarray(centres, dtype=np.float32) * scale
    nw = im.width * scale
    avail = 2.0 * float(min(c.min(), nw - c.max()))
    return centres, med_w, scale, avail


# --------------------------------------------------------------------- water

WATER_SCALE = 4            # masks ship at a quarter of ribbon resolution


def water_alpha(strip):
    """Coverage of open water over the whole finished ribbon, as an 'L' image.

    Both the turquoise sea and the deep lake are strongly red-deficient, which wet
    sand, foam and shadowed foliage are not — so one test finds both without finding
    the shore. Eroded before it is blurred: a mask grown from a colour test always
    creeps a pixel or two past the waterline, and a soft edge over sand reads as a
    shimmer on the beach.

    Built across the whole strip and sliced afterwards, exactly as the art is. Doing
    it per chunk puts the erode and the blur against every chunk edge — and lets a
    chunk holding a little water fall under any threshold — so the animation stopped
    dead on a horizontal line halfway across the sea.
    """
    a = strip.astype(np.float32)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    m = ((g > r + 22) & (b > r + 18) & (b > g - 40))

    im = Image.fromarray((m * 255).astype(np.uint8))
    im = im.filter(ImageFilter.MinFilter(5))                  # pull back off the shore
    im = im.resize((max(1, im.width // WATER_SCALE),
                    max(1, im.height // WATER_SCALE)), Image.LANCZOS)
    return im.filter(ImageFilter.GaussianBlur(2.2))           # fade in at the edges


def water_slice(alpha, y0, y1, scale):
    """One chunk's worth of the ribbon-wide mask, or None where there is no water."""
    a = alpha.crop((0, round(y0 / scale), alpha.width, round(y1 / scale)))
    if a.height < 1 or a.getextrema()[1] < 8:
        return None
    # white, with the mask in alpha — CSS mask-image reads alpha by default
    out = Image.new("RGBA", a.size, (255, 255, 255, 0))
    out.putalpha(a)
    return out


def render(im, centres, scale, out_w):
    """Rescale to the common altitude and straighten the road onto the frame centre.

    Sliding a whole plate by its *median* road position — which is what this did —
    leaves the road wandering inside the frame. On these plates that is ±13px on a
    94px road, so over a screen the road visibly leans away from centre and back.
    Worse, a plate whose road ends somewhere other than where it began cannot repeat
    without stepping sideways at the join.

    Shifting row by row fixes both at once: the road is dead straight down the middle,
    and every plate now starts and ends centred, so repeats line up by construction.
    The cost is a slight horizontal shear of the terrain — tens of pixels spread over
    a plate's full height, in foliage, which does not read.
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
        # clip should not bite — out_w is chosen so every row covers the frame
        take = np.clip(want + c2[y], 0, nw - 1)
        for ch in range(3):
            out[y, :, ch] = np.interp(take, xs, src[y, :, ch])
    return (Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)),
            np.zeros(nh, dtype=np.float32))

# ----------------------------------------------------------------- exposure

def asphalt_rgb(im, centres, road_w):
    """Median colour of the asphalt core — the reference material for exposure."""
    a = np.asarray(im, dtype=np.float32)
    h, w = a.shape[:2]
    half = max(2, int(road_w * 0.30))
    cols = []
    for y in range(0, h, 3):
        c = int(round(centres[y] + w / 2.0))
        lo, hi = max(0, c - half), min(w, c + half + 1)
        if hi > lo:
            cols.append(a[y, lo:hi])
    if not cols:
        return np.array([90.0, 90.0, 90.0])
    return np.median(np.concatenate(cols, 0), 0)


def apply_gain(im, gain):
    a = np.asarray(im, dtype=np.float32) * gain.reshape(1, 1, 3)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

# ------------------------------------------------------------------ joining

def smoothstep(n):
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    return (t * t * (3 - 2 * t)).reshape(n, 1, 1)


def crossblend(tail, head, v):
    """Blend the last v rows of `tail` into the first v rows of `head`."""
    a = np.asarray(tail, dtype=np.float32)
    b = np.asarray(head, dtype=np.float32)
    w = smoothstep(v)
    return np.clip(a[-v:] * (1 - w) + b[:v] * w, 0, 255).astype(np.uint8)

# --------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest")
    ap.add_argument("-o", "--out", default="site")
    ap.add_argument("--water", action="store_true",
                    help="also emit per-chunk open-water masks")
    ap.add_argument("--quality", type=int, default=78)
    args = ap.parse_args()

    mf = json.load(open(args.manifest))
    root = os.path.dirname(os.path.abspath(args.manifest))
    OUT_W = mf.get("out_width", 880)
    ROAD_W = mf.get("road_width", 96)
    OVER = mf.get("overlap", 200)
    CH = mf.get("chunk_height", 1024)
    art_dir = os.path.join(args.out, "art")
    os.makedirs(art_dir, exist_ok=True)

    # expand repeats — every join is then the same operation
    seq = []
    for s in mf["segments"]:
        for _ in range(int(s.get("count", 1))):
            seq.append(s)
    if not seq:
        raise SystemExit("manifest has no segments")

    print(f"normalising {len(seq)} segment slots "
          f"(frame {OUT_W}px, road {ROAD_W}px, overlap {OVER}px)")

    # a segment is identified by its source AND the rows taken from it
    def key(seg):
        r = seg.get("rows")
        return (seg["src"], tuple(r) if r else None)

    # pass 1 — measure every distinct plate
    meas = {}
    for s in seq:
        k = key(s)
        if k in meas:
            continue
        im = Image.open(os.path.join(root, s["src"]))
        if s.get("rows"):
            r0, r1 = s["rows"]
            im = im.crop((0, max(0, r0), im.width, min(im.height, r1)))
        centres, med, scale, avail = plate_scale(im, s["src"], ROAD_W)
        meas[k] = (im, centres, med, scale, avail)
        rows = f" rows {s['rows'][0]}-{s['rows'][1]}" if s.get("rows") else ""
        print(f"  {os.path.basename(s['src'])[:26]:26s}{rows:16s} {im.size[0]}x{im.size[1]}"
              f"  road {med:5.1f}px  field {avail / ROAD_W:5.2f} road-widths  x{scale:.3f}")

    # The frame is as wide as the narrowest plate can actually cover, unless the
    # manifest sets an explicit out_width — then that's respected as-is, even past
    # what the narrowest plate covers. Widening past a plate's own field means its
    # edges repeat outward (see render()), which reads as a soft edge rather than an
    # obviously invented one as long as the plate is a minority of the ribbon's rows.
    avail = min(m[4] for m in meas.values())
    OUT_W = int(OUT_W) // 2 * 2 if OUT_W else int(avail) // 2 * 2
    widest = max(m[4] for m in meas.values())
    if avail < OUT_W * 0.9:
        print(f"  ! narrowest plate covers {avail:.0f}px vs frame {OUT_W:.0f}px — "
              f"its edges will repeat outward to fill the frame")
    print(f"  frame width {OUT_W}px")

    cache, plates = {}, []
    for s in seq:
        k = key(s)
        if k not in cache:
            im, centres, med, scale, _ = meas[k]
            norm, c2 = render(im, centres, scale, OUT_W)
            cache[k] = (norm, c2, scale, med, im.size)
        plates.append(cache[k])

    # exposure: pull every plate onto the mean asphalt colour, gently and clamped
    rgbs = np.array([asphalt_rgb(p[0], p[1], ROAD_W) for p in {id(p): p for p in plates}.values()])
    target = rgbs.mean(0)
    print(f"  asphalt target rgb {target.round(1).tolist()}")
    graded = {}
    for k, (norm, centres, scale, med, osz) in cache.items():
        cur = asphalt_rgb(norm, centres, ROAD_W)
        gain = np.clip(target / np.maximum(cur, 1.0), 0.85, 1.18)
        graded[k] = (apply_gain(norm, gain), centres)
        if np.abs(gain - 1).max() > 0.02:
            print(f"  {os.path.basename(k[0])[:26]:26s} exposure gain {gain.round(3).tolist()}")

    # stitch — overlaps are SAME-terrain by the manifest's contract, so invisible
    strip_parts, centre_parts, bias_parts = [], [], []
    # Where each leg should come to rest. Arrivals divided evenly across the journey
    # land wherever they land — usually on filler, because a painting's subjects are
    # not evenly spaced. A segment names the row worth stopping at instead.
    stops, petals, cursor, prev = [], [], 0, None
    for i, s in enumerate(seq):
        im, centres = graded[key(s)]
        a = np.asarray(im, dtype=np.uint8)
        c = np.asarray(centres, dtype=np.float32)
        # Zoom crops both sides equally, but a composition rarely deserves that.
        # bias -1..+1 slides the visible window toward one side, so a subject that
        # runs to the frame edge survives the crop at the cost of the emptier side.
        bz = np.full(len(a), float(s.get("bias", 0.0)), dtype=np.float32)
        # A segment can override the global overlap — 0 for a hard cut where the two
        # plates are unrelated content (a scene change) rather than the same terrain.
        seg_over = s.get("overlap", OVER)
        seg_start = 0 if prev is None else cursor - min(seg_over, len(a) // 2, len(prev[0]) // 2)
        cursor = seg_start + len(a)
        sc = meas[key(s)][3]                        # plate -> ribbon scale
        for row in s.get("stops", []):
            stops.append(seg_start + row * sc)
        if s.get("petals"):
            pa, pb = s["petals"]          # not a, b — those hold this segment's pixels
            petals.append((seg_start + pa * sc, seg_start + pb * sc))
        v = min(seg_over, len(a) // 2, len(prev[0]) // 2) if prev is not None else 0
        if prev is None:
            strip_parts.append(a); centre_parts.append(c); bias_parts.append(bz)
        else:
            pa, pc, pb = strip_parts.pop(), centre_parts.pop(), bias_parts.pop()
            joined = crossblend(pa, a, v)
            strip_parts.append(np.concatenate([pa[:-v], joined], 0))
            w = smoothstep(v).reshape(v)
            centre_parts.append(np.concatenate([pc[:-v], pc[-v:] * (1 - w) + c[:v] * w]))
            bias_parts.append(np.concatenate([pb[:-v], pb[-v:] * (1 - w) + bz[:v] * w]))
            strip_parts.append(a[v:]); centre_parts.append(c[v:]); bias_parts.append(bz[v:])
        prev = (a, c)

    # neighbouring copies of one segment produce touching zones; merge them so the
    # effect layer sees one continuous stretch rather than a row of seams
    petals.sort()
    merged = []
    for a, b in petals:
        if merged and a <= merged[-1][1] + 8:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    petals = merged

    strip = np.concatenate(strip_parts, 0)
    road_centres = np.concatenate(centre_parts, 0)
    # a long ease either side of a join, so the camera drifts rather than steps
    bias = smooth(np.concatenate(bias_parts, 0), 601)
    H = strip.shape[0]
    print(f"stitched ribbon {OUT_W}x{H}px")

    # slice — a cut, not a blend: adjacent chunks align exactly
    chunks, total, water_kb = [], 0, 0
    walpha = water_alpha(strip) if args.water else None
    n = math.ceil(H / CH)
    for i in range(n):
        y0, y1 = i * CH, min(H, (i + 1) * CH)
        name = f"ribbon-{i:03d}.webp"
        Image.fromarray(strip[y0:y1]).save(
            os.path.join(art_dir, name), "WEBP", quality=args.quality, method=6)
        kb = os.path.getsize(os.path.join(art_dir, name)) // 1024
        total += kb
        c = {"src": f"art/{name}", "y": y0, "h": y1 - y0, "kb": kb}

        # Where the water is. Kept for a future pass that displaces the painted
        # water itself; nothing consumes it today, so it is off unless asked for.
        wm = water_slice(walpha, y0, y1, WATER_SCALE) if args.water else None
        if wm is not None:
            wname = f"water-{i:03d}.webp"
            wm.save(os.path.join(art_dir, wname), "WEBP",
                    quality=72, method=6, exact=True)
            wkb = os.path.getsize(os.path.join(art_dir, wname)) // 1024
            total += wkb
            c["water"] = f"art/{wname}"
            water_kb += wkb
        chunks.append(c)

    STEP = 8
    ribbon = {
        "width": OUT_W,
        "height": H,
        "roadWidth": ROAD_W,
        "chunkHeight": CH,
        "chunks": chunks,
        "roadCentre": {
            "step": STEP,
            # px offset of the painted road centre from frame centre
            "values": [round(float(v), 2) for v in road_centres[::STEP]],
        },
        # ribbon rows each leg comes to rest on, anchored to what is painted there
        "stops": [round(float(v), 1) for v in sorted(stops)],
        # ribbon row ranges where drifting petals belong
        "petalZones": [[round(float(a), 1), round(float(b), 1)] for a, b in petals],
        # -1..+1 per row: which way to slide the window when zoom crops the sides
        "bias": {
            "step": STEP,
            "values": [round(float(v), 3) for v in bias[::STEP]],
        },
        # one stop per painted segment — the engine derives leg count from this
        "segments": len(seq),
        "legs": int(mf.get("legs", 0)),
    }
    with open(os.path.join(args.out, "ribbon.json"), "w") as f:
        json.dump(ribbon, f, separators=(",", ":"))

    if petals:
        print("  petal zones at ribbon rows "
              + str([[round(a), round(b)] for a, b in petals]))
    if stops:
        print(f"  {len(stops)} arrival stop(s) at ribbon rows "
              f"{[round(v) for v in sorted(stops)]}")
    drift = road_centres.max() - road_centres.min()
    nw = sum(1 for c in chunks if "water" in c)
    print(f"  water masks on {nw}/{len(chunks)} chunks, {water_kb}KB")
    print(f"wrote {len(chunks)} chunks, {total}KB total, first paint {chunks[0]['kb']}KB")
    print(f"road drift across journey: {drift:.1f}px of {OUT_W} "
          f"({drift / OUT_W * 100:.1f}% of frame)")


if __name__ == "__main__":
    main()
