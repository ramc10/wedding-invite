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

def plate_scale(im, name, road_w_target, manual_road=None):
    """Measure the road and work out the rescale that puts every plate at one altitude.

    manual_road, when given, is (centre_x, width_px) and skips detect_road entirely —
    for a plate where the road blends into an adjacent structure (a dam's concrete,
    a stone retaining wall) closely enough in tone that no threshold reliably tells
    them apart, not just for this pipeline's simple mask but by eye at the pixel
    level too. detect_road's own column-vote locks onto the wider competing
    structure instead of the true road for long stretches in that case (this
    pipeline's Gate 4 failure mode) - a manual straight centre/width, read off the
    plate's few unambiguous rows, is the only reliable answer for the rest.
    """
    arr = np.asarray(im.convert("RGB"), dtype=np.float32)
    if manual_road is not None:
        cx, w = manual_road
        centres = np.full(im.height, float(cx), dtype=np.float32)
        widths = np.full(im.height, float(w), dtype=np.float32)
    else:
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


EDGE_FEATHER = 48   # px over which a padded segment's edge fades to transparent


def render(im, centres, scale, out_w, canvas_w=None, side="right"):
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

    out_w is this plate's own frame width (as much as it can cover without inventing
    edge pixels). canvas_w is the ribbon's shared strip width, which can be wider when
    another segment needed more room for a subject off to one side (an islet past
    where a narrower segment in the same route would have to crop). Where out_w is
    less than canvas_w, the rendered content is centred on the same road-aligned
    midline as every other segment and the leftover canvas is transparent, feathered
    at the seam — not stretched pixels, which read as horizontal streaking.
    """
    canvas_w = canvas_w or out_w
    nw, nh = max(1, round(im.width * scale)), max(1, round(im.height * scale))
    im2 = im.convert("RGB").resize((nw, nh), Image.LANCZOS)
    c2 = np.interp(np.linspace(0, len(centres) - 1, nh),
                   np.arange(len(centres)), centres) * scale

    src = np.asarray(im2, dtype=np.float32)
    content = np.empty((nh, out_w, 3), dtype=np.float32)
    xs = np.arange(nw, dtype=np.float32)
    want = np.arange(out_w, dtype=np.float32) - out_w / 2.0
    for y in range(nh):
        # clip should not bite — out_w is chosen so every row covers the frame
        take = np.clip(want + c2[y], 0, nw - 1)
        for ch in range(3):
            content[y, :, ch] = np.interp(take, xs, src[y, :, ch])
    content = np.clip(content, 0, 255)

    if canvas_w == out_w:
        out = np.dstack([content, np.full((nh, out_w), 255, dtype=np.float32)])
        return Image.fromarray(out.astype(np.uint8)), np.zeros(nh, dtype=np.float32)

    # centre this plate's content on the ribbon's shared midline; pad the rest
    # transparent, feathered so the fade is soft rather than a hard alpha edge
    pad = canvas_w - out_w
    left = pad // 2
    out = np.zeros((nh, canvas_w, 4), dtype=np.float32)
    out[:, left:left + out_w, :3] = content
    alpha = np.zeros(canvas_w, dtype=np.float32)
    alpha[left:left + out_w] = 255
    f = min(EDGE_FEATHER, out_w // 2)
    if f > 0:
        ramp = np.linspace(0, 255, f, dtype=np.float32)
        alpha[left:left + f] = np.minimum(alpha[left:left + f], ramp)
        alpha[left + out_w - f:left + out_w] = np.minimum(
            alpha[left + out_w - f:left + out_w], ramp[::-1])
    out[:, :, 3] = alpha[np.newaxis, :]
    return Image.fromarray(out.astype(np.uint8)), np.zeros(nh, dtype=np.float32)

# ----------------------------------------------------------------- exposure

def asphalt_rgb(im, centres, road_w):
    """Median colour of the asphalt core — the reference material for exposure."""
    a = np.asarray(im, dtype=np.float32)[:, :, :3]      # ignore alpha, if any
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
    """Grade RGB only — an image may carry a padding alpha channel, which the
    exposure match must leave untouched."""
    a = np.asarray(im, dtype=np.float32)
    a[:, :, :3] *= gain.reshape(1, 1, 3)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))

# ------------------------------------------------------------------ joining

def smoothstep(n):
    t = np.linspace(0.0, 1.0, n, dtype=np.float32)
    return (t * t * (3 - 2 * t)).reshape(n, 1, 1)


def crossblend(tail, head, v):
    """Blend the last v rows of `tail` into the first v rows of `head`.
    v=0 is a hard cut - there are no rows to blend, so `-v:` (which Python
    treats as `-0:`, i.e. all of `a`) would silently mix in a whole extra
    segment's worth of pixels rather than none."""
    if v == 0:
        return np.zeros((0,) + tail.shape[1:], dtype=np.uint8)
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
    ap.add_argument("--mark-seams", nargs="?", const="all", default=None,
                     help="paint a bright magenta line across segment joins in the "
                          "stitched strip, so a seam is unmistakable and its exact row "
                          "known while debugging - never use for a real build. Bare "
                          "flag marks every join; pass a 1-based join index (1 = the "
                          "first join, between segment 1 and 2) or comma-separated "
                          "list, e.g. --mark-seams 2, to mark only that one.")
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
        manual_road = tuple(s["road"]) if s.get("road") else None
        centres, med, scale, avail = plate_scale(im, s["src"], ROAD_W, manual_road)
        meas[k] = (im, centres, med, scale, avail)
        rows = f" rows {s['rows'][0]}-{s['rows'][1]}" if s.get("rows") else ""
        print(f"  {os.path.basename(s['src'])[:26]:26s}{rows:16s} {im.size[0]}x{im.size[1]}"
              f"  road {med:5.1f}px  field {avail / ROAD_W:5.2f} road-widths  x{scale:.3f}")

    # The frame is as wide as the narrowest plate can actually cover. Widening past
    # that would mean inventing pixels at the edges, which reads as horizontal
    # streaking down the side of the scene.
    avail = min(m[4] for m in meas.values())
    OUT_W = int(min(OUT_W, avail) if OUT_W else avail) // 2 * 2
    widest = max(m[4] for m in meas.values())
    if avail < widest * 0.9:
        print(f"  ! narrowest plate covers {avail:.0f}px vs {widest:.0f}px — "
              f"the frame is being cropped to suit it")
    print(f"  frame width {OUT_W}px")

    # A segment can ask for more than the shared frame width — "wide": <px>, capped
    # to what its own plate actually covers — and lean that extra width to one side
    # with "wide_side" ("left"/"right", default right), for a subject (an islet, a
    # second boat) that sits past where the narrowest plate in the route would force
    # everyone to crop. The canvas is then the widest any segment asks for; narrower
    # segments keep rendering at OUT_W and are padded out to canvas width with a
    # transparent, feathered edge rather than stretched pixels (see render()).
    def seg_width(s):
        w = int(s.get("wide", 0))
        if not w:
            return OUT_W
        return min(w, int(meas[key(s)][4])) // 2 * 2   # meas[...] = (im, centres, med, scale, avail)
    CANVAS_W = max([OUT_W] + [seg_width(s) for s in seq])
    if CANVAS_W > OUT_W:
        print(f"  canvas widened to {CANVAS_W}px for wide segment(s)")

    cache, plates = {}, []
    for s in seq:
        k = key(s)
        if k not in cache:
            im, centres, med, scale, _ = meas[k]
            sw = seg_width(s)
            side = s.get("wide_side", "right")
            norm, c2 = render(im, centres, scale, sw, CANVAS_W, side)
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
    stops, petals, joins, cursor, prev = [], [], [], 0, None
    for i, s in enumerate(seq):
        im, centres = graded[key(s)]
        a = np.asarray(im, dtype=np.uint8)
        c = np.asarray(centres, dtype=np.float32)
        # Zoom crops both sides equally, but a composition rarely deserves that.
        # bias -1..+1 slides the visible window toward one side, so a subject that
        # runs to the frame edge survives the crop at the cost of the emptier side.
        bz = np.full(len(a), float(s.get("bias", 0.0)), dtype=np.float32)

        # A segment can ask for empty space before it starts — overlap only ever
        # pulls two segments closer (down to a flush 0), it cannot push them apart.
        # The gap is transparent (same treatment as the "wide" side padding), not
        # painted content, so there is nothing there to blend against: insert it as
        # its own borderless spacer, then join the segment to *that* at overlap 0.
        gap = int(s.get("gap", 0))
        if gap > 0 and prev is not None:
            spacer = np.zeros((gap, CANVAS_W, 4), dtype=np.uint8)
            strip_parts.append(spacer)
            centre_parts.append(np.zeros(gap, dtype=np.float32))
            bias_parts.append(np.zeros(gap, dtype=np.float32))
            cursor += gap
            prev = (spacer, centre_parts[-1])

        # "overlap" controls POSITION ONLY: how much of this segment is pulled up
        # into the previous one's span (down to a flush 0 - it cannot push segments
        # apart; use "gap" for that). "blend" controls the crossfade width, feathered
        # in place at whatever position overlap already decided, entirely separate -
        # changing one must never silently move the other, which is what happened
        # when overlap did both jobs at once (raising it for more blend also pulled
        # the join upward, dropping it for less blend pushed the join back down).
        seg_over = 0 if gap > 0 else s.get("overlap", OVER)
        seg_start = 0 if prev is None else cursor - min(seg_over, len(a) // 2, len(prev[0]) // 2)
        if prev is not None:
            joins.append((seg_start, s["src"]))
        cursor = seg_start + len(a)
        sc = meas[key(s)][3]                        # plate -> ribbon scale
        for row in s.get("stops", []):
            stops.append(seg_start + row * sc)
        if s.get("petals"):
            pa, pb = s["petals"]          # not a, b — those hold this segment's pixels
            petals.append((seg_start + pa * sc, seg_start + pb * sc))
        v = min(seg_over, len(a) // 2, len(prev[0]) // 2) if prev is not None else 0
        # "trim": at v>0, overlap's default is to CROSSBLEND those v rows - which
        # is itself a second, separate blend, on top of (and easy to mistake for)
        # "blend" above. trim:true instead just drops A's last v rows and B's first
        # v rows outright and butts what's left together - overlap still sets
        # position (v), but with no blending of its own, so pulling a segment up
        # can be made blur-free even at v>0, independent of "blend".
        #
        # "impose": which segment's pixels survive in the overlapping v-row band.
        # trim (and the default crossblend) both keep A intact and drop B's first
        # v rows - B's content effectively starts only after A ends, so nothing
        # ever visually sits "on top of" the other, just two ranges butted
        # together. impose:true is the opposite: A's LAST v rows are dropped
        # instead, and B keeps its full head - so B's own painted content is what
        # shows in the overlap band, reading as B laid over A rather than B
        # starting where A left off. Net length drops by v either way.
        trim = bool(s.get("trim", False))
        impose = bool(s.get("impose", False))
        if prev is None:
            strip_parts.append(a); centre_parts.append(c); bias_parts.append(bz)
        else:
            pa, pc, pb = strip_parts.pop(), centre_parts.pop(), bias_parts.pop()
            # v=0 is a hard cut: `pa[:-0]` means `pa[:0]` in Python, i.e. empty,
            # not "everything" - so the whole-array case must be spelled out.
            # Copy only when blend will touch it in place - pa itself can be
            # read-only (e.g. straight off a decoded image).
            if v == 0:
                strip_parts.append(pa.copy() if int(s.get("blend", 0)) > 0 else pa)
                centre_parts.append(pc)
                bias_parts.append(pb)
            elif impose:
                # A loses its last v rows (covered by B); B below keeps its FULL
                # head rather than dropping v, so B is what actually appears in
                # the overlap band. Copy only when blend will touch this array
                # in place afterward - pa[:-v] is a view, and pa can itself be
                # read-only (e.g. straight off a decoded image), which the
                # in-place blend write would otherwise fail against.
                a_head = pa[:-v].copy() if int(s.get("blend", 0)) > 0 else pa[:-v]
                strip_parts.append(a_head)
                centre_parts.append(pc[:-v])
                bias_parts.append(pb[:-v])
            elif trim:
                # Net length must drop by exactly v, same as the blend path (A
                # loses v, B loses v below, then a v-row blended result is
                # re-inserted - net -v). B's own v-row head-drop (a[v:]) happens
                # unconditionally below for the default/trim case, so trim must
                # NOT also drop v from A here - that would be -2v total, pulling
                # the join up an extra v px beyond what "overlap" asked for. A is
                # therefore left untouched in this branch; only B's drop below
                # contributes, giving the correct net -v with no blending
                # inserted at the join. Copy only when blend will touch it in
                # place - pa itself can be read-only.
                strip_parts.append(pa.copy() if int(s.get("blend", 0)) > 0 else pa)
                centre_parts.append(pc)
                bias_parts.append(pb)
            else:
                joined = crossblend(pa, a, v)
                strip_parts.append(np.concatenate([pa[:-v], joined], 0))
                w = smoothstep(v).reshape(v)
                centre_parts.append(np.concatenate([pc[:-v], pc[-v:] * (1 - w) + c[:v] * w]))
                bias_parts.append(np.concatenate([pb[:-v], pb[-v:] * (1 - w) + bz[:v] * w]))
            # a[v:] is a VIEW into `a`, not a copy - the in-place blend below writes
            # through it, which would otherwise corrupt `a` itself (shared, e.g., if
            # this same plate/key is reused by a later repeated segment). Copy only
            # when blend will actually touch it; the common no-blend path stays a
            # cheap view as before. impose keeps B's FULL head (nothing dropped),
            # matching A's v-row drop above so the net length still comes out -v.
            if impose:
                b_side = a.copy() if int(s.get("blend", 0)) > 0 else a
                strip_parts.append(b_side); centre_parts.append(c); bias_parts.append(bz)
            else:
                b_side = a[v:].copy() if int(s.get("blend", 0)) > 0 else a[v:]
                strip_parts.append(b_side); centre_parts.append(c[v:]); bias_parts.append(bz[v:])

            # "blend" feathers the two segments' pixels across a FIXED join, entirely
            # separate from "overlap" (which only ever sets position, via v above).
            # It operates on the exact boundary between strip_parts[-2] and
            # strip_parts[-1] regardless of v: at v=0 that boundary is the raw,
            # untouched hard cut; at v>0 its last v rows are already the overlap's
            # own crossblend (a different mechanism, already smoothed) and its first
            # rows onward are B's untouched tail - either way, feathering the actual
            # boundary in place changes no array's length and so cannot move
            # anything, which is the whole point: changing blend % must never
            # re-shift the join the way raising or lowering "overlap" used to when
            # one field was made to do both jobs at once.
            bl = int(s.get("blend", 0))
            if bl > 0:
                a_side, b_side = strip_parts[-2], strip_parts[-1]
                bl = min(bl, a_side.shape[0], b_side.shape[0])
                half = bl // 2
                if half > 0:
                    # crossblend(tail, head, n) mixes tail's last n rows with head's
                    # first n rows into one n-row run, ramping smoothly from tail's
                    # colour to head's. Feed it the FULL bl-row window (bl rows from
                    # each side, not half - an earlier version of this fed it only
                    # `half` rows per side, which produced just 2 mix values and a
                    # hard jump right at the seam instead of a ramp), then split the
                    # resulting bl-row ramp across the seam: its first half overwrites
                    # A's own last `half` rows (still close to A's colour there), its
                    # second half overwrites B's own first `half` rows (close to B's
                    # colour). Verified numerically to be continuous with no jump.
                    # Every array keeps its original length, so position is untouched.
                    mix = crossblend(a_side[-bl:], b_side[:bl], bl)
                    a_side[-half:] = mix[:half]
                    b_side[:bl - half] = mix[half:]   # bl-half, not half: covers an odd bl too
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
    print(f"stitched ribbon {CANVAS_W}x{H}px")

    if args.mark_seams:
        # opaque magenta, a few rows either side of each join - unmistakable against
        # any painted terrain, and printed here so the row number matches exactly what
        # ships. Debug-only: never leave --mark-seams on for a real build.
        wanted = None if args.mark_seams == "all" else \
            {int(x) for x in args.mark_seams.split(",")}
        MARK = 6
        for i, (row, src) in enumerate(joins, start=1):
            if wanted is not None and i not in wanted:
                continue
            y0, y1 = max(0, row - MARK), min(H, row + MARK)
            strip[y0:y1, :, :3] = [255, 0, 220]
            strip[y0:y1, :, 3] = 255
            print(f"  seam marker at ribbon row {row} (start of {os.path.basename(src)})")

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
        "width": CANVAS_W,
        # the width the fit-to-viewport zoom is computed against. Left at the
        # normal frame width even when the canvas itself is wider for a "wide"
        # segment's sake, or that one segment would shrink the whole journey to
        # fit its own extra margin on every device. The wide segment instead
        # simply runs past the viewport at the same scale as everything else,
        # same as any painting wider than the screen already does.
        "zoomWidth": OUT_W,
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
        # ribbon row where each segment after the first begins — one entry per
        # join, in order. Not the same thing as "stops": a join is a fact about
        # the art (where one plate's content starts), unrelated to whichever
        # rows a segment names as worth pausing at.
        "joins": [round(float(row), 1) for row, _ in joins],
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
