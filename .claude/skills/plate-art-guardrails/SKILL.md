---
name: plate-art-guardrails
description: >
  Mandatory checklist before accepting any new ribbon plate image (road segment
  art) into this repo's build-ribbon.py pipeline. Use whenever a new plate is
  generated, downloaded, or swapped in to replace existing ribbon art — before
  cropping, scaling, or wiring it into a manifest. Triggers on "new plate",
  "new segment art", "replace the dam/garden/coast image", "generate road art".
---

# Plate Art Guardrails

This pipeline (`tools/build-ribbon.py`) auto-detects the road in every plate
by looking for a tall, narrow, low-saturation vertical band. That heuristic is
fragile. Every plate that skipped this checklist in this repo's history caused
a real, shipped bug: a mismatched art style, a road that narrowed or drifted
at a segment seam, or a car painted into the art that had to be manually
cloned out.

Do not skip straight to cropping/scaling/wiring a new plate into the manifest.
Run this checklist first, in order. All four gates are mandatory — geometry
and style checks are not optional extras.

## Gate 1 — Orientation

- The road must run **vertically, top to bottom**, in the file as delivered.
  Do not assume a landscape-shaped file needs rotating — check the actual
  pixel content first. (Precedent: `coast-wide.png` and `garden-wide.png` are
  2752×1536 — wide files — but the road already runs vertically inside that
  wide canvas. Rotating them would have been wrong.)
- Confirm left/right composition matches the neighboring plates it will join
  to (e.g. "lake on the left, coast on the right" must match, not just the
  road orientation).

## Gate 2 — Color and style match (mandatory, not optional)

- Compare the new plate's rendering style against the plates immediately
  before and after it in the manifest, side by side, before doing any other
  work. A photoreal/rendered image next to painted illustration plates is a
  **hard stop** — flag it to the user explicitly and get a decision before
  proceeding, even if the composition is otherwise perfect.
- Check overall color temperature/saturation against neighbors (the pipeline's
  own exposure-gain step only nudges asphalt tone to match — it does not fix
  a fundamentally different art style or lighting model).
- If the source is AI-generated, prefer regenerating with an explicit style
  reference/prompt anchored to the existing plates over trying to patch style
  mismatches after the fact in pixel-editing. Post-hoc patching (color grading
  one plate to try to match another) is a last resort, not a first move.

## Gate 3 — Road geometry, verified independently of the auto-detector

Do not trust `detect_road()`'s output on faith. Verify it against a manual
measurement before scaling anything:

1. Open the plate and manually find the road's true x-range at a handful of
   clean rows (no car, no shadow, no adjacent water/structure). Note the
   width and center.
2. Run `tools/build-ribbon.py`'s `detect_road()` (or `plate_scale()`) on the
   plate and compare its reported width/center against your manual reading.
3. If they disagree, or if the tool prints `road tracked on only N% of rows`
   for N below ~90%, **stop** — do not proceed to scale or wire the plate in.
   This warning has previously meant the detector locked onto the wrong
   feature entirely (see Gate 4), not just noisy data.
4. Only treat the auto-detected width as trustworthy once it matches your
   manual measurement within a few pixels and coverage is high.

## Gate 4 — No competing gray/low-saturation structure

`asphalt_mask()` flags anything low-saturation and mid-brightness — concrete,
wet rock, dam structures, and open water in haze all qualify, not just road.
The detector's column-vote picks the *widest continuous* run in that mask, so
a large concrete structure (a dam face, a building, a sea wall) will beat a
real but shadow-broken road every time it is wider or more continuous.

Before accepting a plate:

- Visualize the asphalt mask (`sat<0.30 & 0.12<val<0.72`) across the full
  plate and look for any non-road region that forms a large, continuous
  blob — dam gates, concrete platforms, large rock faces, hazy water.
- If one exists and is comparable in size to or larger than the true road
  band, the detector **will** pick it. Do not assume "the road is obviously
  bigger to a human eye" is good enough — measure the actual mask run
  lengths (`_runs()` output) and compare widths numerically.
- Fixing this by tinting the competing structure's saturation (small, visually
  negligible RGB nudge to push it just outside the mask threshold) is an
  acceptable workaround for an otherwise-good plate, but only after you have
  confirmed via Gate 3 that this is actually the cause of a detection
  mismatch — never apply it speculatively.

## Gate 5 — Car removal, checked by eye at full zoom

If the plate has a painted-in car, `tools/strip-car.py` will report success
("car removed") whenever its own road-tracking succeeds — that message means
detection worked, not that the visual result is clean. It has produced a
visibly flat, texture-less rectangle where the car was, because the road's
painted texture has natural mottling/grain along its length and a naive
clone-source can be flatter than its surroundings.

After running strip-car.py (or any manual clone-patch):

- Crop and zoom into the patched region directly, at 2x or more, and look for
  a rectangle that reads noticeably flatter or smoother than the road outside
  it — this is the actual failure mode, not a color mismatch you can catch by
  sampling a few pixel values.
- If the patch is visible, fix it by widening the feather zone so it sits
  **outside** the car's actual bounds (feather inside the car's silhouette
  causes ghosting — a semi-transparent car — not a clean removal), and prefer
  a clone source as close to the car as possible to minimize any lighting
  drift along the road's length.
- Re-check at the ribbon's actual scaled-down output size too (rebuild and
  crop the stitched result), not just on the full-resolution source plate —
  a patch that reads as visible full-size may or may not be visible after
  the pipeline's rescale, and one that looks fine full-size can still show up
  after scaling.

## After all five gates pass

Only then: crop/scale rows and stops in the manifest to the plate's actual
pixel dimensions, run `build-ribbon.py`, and check the build log for:

- No `road tracked on only N% of rows` warnings.
- `road drift across journey: 0.0px` (or very close to it) in the final
  summary — this is the pipeline's own end-to-end alignment check and it
  catches exactly the class of bug this skill exists to prevent.

If drift is non-zero or a warning fires after wiring the plate in, that is a
sign a gate was skipped or misjudged — go back to Gate 3/4, do not try to
patch the symptom (e.g. by re-scaling stops) without re-checking the cause.
