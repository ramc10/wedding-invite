# Wedding Road

A wedding invitation site: a scrolling, top-down drive down a painted road,
with terrain changing as you travel and ceremony details revealed stop by
stop.

## Layout

- `site/` — the production site (deployed via Vercel, see `vercel.json`).
  Static HTML/CSS/JS, no build step. See [`README-BUILD.md`](README-BUILD.md)
  for how the painted-ribbon engine works, how to generate segment art, and
  how to add ceremony copy.
- `site/v3/` — a fresh route under construction. Code scaffold only, no art
  yet — art for it is being regenerated from scratch rather than reusing or
  patching plates from `ribbon/`. Before adding any plate here, follow
  `.claude/skills/plate-art-guardrails/SKILL.md`.
- `tools/` — the art build pipeline (`build-ribbon.py`, `strip-car.py`, …).
- `ribbon/` — manifest describing the road segments consumed by the build
  pipeline for `site/`.
- `ribbon-v3/` — empty manifest + plates scaffold for `site/v3/`.
- `project/` — original Claude Design prototype files.
- `chats/` — chat transcripts from the original design handoff.

## Running locally

```
cd site && python3 -m http.server 8000
```

## Origin

This project started as a Claude Design handoff (see `chats/` and
`project/` for the original prototype and design conversation) and was then
implemented and iterated on as a real site.
