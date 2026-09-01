# Wedding Road — build notes

A scrolling top-down drive. The road runs down the centre, terrain changes as you
travel, and a pink convertible sits fixed at 56% of the viewport while the world
moves under it.

```
site/            the deployable site — static, no build step, no framework
  index.html
  road.css
  road.js        the scroll engine
  fonts/         self-hosted EB Garamond + Mrs Saint Delafield (latin subset)
  ribbon.json    generated — chunk list + the painted road's centre line
  art/           generated — ribbon chunks + car.webp
tools/
  build-ribbon.py  segments -> one continuous ribbon -> chunks
  strip-car.py     removes a car painted into a plate
ribbon/
  standin.json     the current manifest (built from the two reference paintings)
```

Serve it with anything: `cd site && python3 -m http.server 8000`.

## The one rule

Four rounds of the design sessions failed at the same thing: making one terrain
become another by blending two textures at runtime. Cross-dissolve, wipe, seam
mask, verge retreat, painted alpha edge — every one of them was visible.

So nothing blends at runtime any more. The scene is **one painted ribbon** — road,
both verges, every terrain, in a single image — moved by a single `translate3d`.

> **Blend *within* a terrain (invisible). Never blend *between* terrains (always visible).**

A terrain change is painted *inside* one segment, the way it is in the reference
paintings. The pipeline only ever blends a segment's tail into the next segment's
head, and the manifest's contract is that those two show the *same* terrain.

## Generating segment art

Frame **896×1792** (2:1). One segment per stop.

Hold the altitude constant across every generation. The two references differ —
one has a road 10.7% of frame, the other 6.0% — and they cannot be stitched to
each other without cropping one hard. The pipeline rescales to match, but it can
only crop, never invent. Aim for a road around **11% of frame width**.

Two rules the art must satisfy:

- **Overlap** — a segment's top 200px must show the *same terrain* as the previous
  segment's bottom 200px. That band is what gets cross-blended.
- **Seamless** (only for segments you want to repeat) — top and bottom 200px show
  the same terrain, so the segment can loop invisibly.

**No car.** The site draws its own. If one is painted in anyway:
`python3 tools/strip-car.py in.png out.png`.

The sprite itself is graded against the car the reference painter drew, so it
carries the scene's light and detail density rather than a different painting's:
`python3 tools/grade-car.py <reference.png> <car.webp> site/art/car.webp`

Proposed sequence:

| # | segment | kind |
|---|---------|------|
| 1 | flowering garden, both sides | repeat |
| 2 | garden → hills | once |
| 3 | hills | repeat |
| 4 | hills → palms and beach opening right | once |
| 5 | coast — palms, sand, surf, turquoise | repeat |
| 6 | coast → lake shore opening left | once |
| 7 | lake and dam | once |
| 8 | arrival | once |

### Field: what sets how zoomed-in the piece reads

`build-ribbon.py` reports each plate's **field** — how many road-widths of ground it
covers. The frame can only be as wide as the *narrowest* field, so one wide-angle
plate in the set does not widen the frame; one tight plate narrows it for everybody.

That single number decides the framing: `road % of frame = 100 / field`. A field of
6.8 puts the road at 14.8% of frame; 8.5 puts it at 11.7%. Reach for this before
reaching for a runtime zoom — cropping at runtime throws pixels away, while choosing
the field bakes the same framing into the art.

It also decides what fits. In the stand-in, the lake plate's dam sits 8.2 road-widths
from the road while the frame reaches 3.4, so the dam can only ever arrive cut in
half. No amount of tuning fixes that; the segment is trimmed above it instead. When
you generate real art, keep every subject you care about inside half the field.

## Manifest

```jsonc
{
  "out_width": 0,       // 0 = auto: as wide as the narrowest plate genuinely covers
  "road_width": 94,     // px the painted road is rescaled to — sets the altitude
  "overlap": 200,       // cross-blend depth at each join
  "chunk_height": 640,  // smaller chunks = less bought at first paint
  "segments": [
    { "src": "plates/garden.png",       "kind": "repeat", "count": 2 },
    { "src": "plates/garden-hills.png", "kind": "once" },
    { "src": "plates/lake.png",         "kind": "once", "rows": [0, 1035], "bias": 0 }
  ]
}
```

`rows` takes only part of a plate — used to stop a segment before something that
cannot fit the frame. `bias` (-1..+1) slides the visible window toward one side when
a runtime zoom is cropping, so a subject at the frame edge survives at the cost of
the emptier side.

`python3 tools/build-ribbon.py ribbon/standin.json -o site`

The pipeline detects the road in each plate, rescales every plate to one altitude,
slides each road onto the frame centre, matches exposure on the asphalt (the one
material common to all the art), cross-blends the overlaps, then **cuts** the strip
into chunks — a cut, not a blend, so chunks butt-join pixel-perfectly.

Leg count comes from the segment count: one stop per painted segment.

## Drifting petals

`site/petals.js` draws blossom over the garden — a canvas layer under the car, 20–46
petals depending on viewport, at 30fps. It reads position from `window.RoadFX`, the
small surface `road.js` publishes for effect layers (`d`, `scale`, `still`, `ribbon`).

Petals live in the same travelled-px space as the ground, but lag it by 16% — that
lag is what reads as *in the air* rather than painted on. They are confined to the
ribbon rows a segment marks with `"petals": [startRow, endRow]` in plate rows; the
pipeline converts those to ribbon rows and merges touching zones. Outside a zone the
canvas is fully transparent and nothing is drawn.

Removed entirely under `prefers-reduced-motion` — the canvas is never created.

## Development scaffold (temporary)

`site/dev-overlay.js` draws the scroll structure that is otherwise invisible: a gold
rule where each leg begins, a dotted rule where its drive hands over to the arrival
hold, a pink rule where the ribbon runs out, and a HUD reading the leg, the phase,
`t`, and how far the ground has actually travelled.

Press **D** to toggle it, or load with `?dev=0` to start hidden.

To remove it for good: delete the file and its one `<script>` tag in `index.html`.
Nothing else depends on it — the only trace in the engine is `--drive`, a CSS
variable `road.js` publishes so the overlay reads the real split rather than a copy.

## Adding the ceremony copy

`STOPS` at the top of `site/road.js` is empty. Push one object per stop:

```js
var STOPS = [
  { hero: "Save the date" },
  { place: "Karimnagar", ceremony: "Godhumarayi", when: "Morning, at the house" },
  // ...
];
```

Leg count, the route rail and the arrival fades all follow from that array.

## Verified

Chromium, 430×932 @2x and 1440×900:

- first paint **235KB**, **LCP 180ms**
- the world is **pixel-identical** through every arrival hold; the drive front-loads
  its travel (87px → 812px over the first 40% of a leg)
- same-terrain joins invisible; chunk joins invisible
- the car settles to a dead stop during holds (its lean, bob and rotation are all
  gated on measured speed — there is no free-running idle animation)
- `prefers-reduced-motion` freezes the world and shows all copy
- no console errors, no failed requests
