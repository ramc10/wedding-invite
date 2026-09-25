#!/usr/bin/env python3
"""
Fold the whole site into one self-contained HTML file.

Everything becomes a data: URI and ribbon.json is inlined as a literal, so the page
makes no network requests at all. Useful for sharing a build for review, or for any
host that will not serve the art directory.

Usage:  python3 tools/bundle.py [-o site/bundle.html] [--standalone]
"""
import argparse, base64, json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SITE = os.path.join(ROOT, "site")
MIME = {".webp": "image/webp", ".woff2": "font/woff2", ".png": "image/png"}


def data_uri(path):
    ext = os.path.splitext(path)[1].lower()
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (MIME[ext], base64.b64encode(f.read()).decode())


def main():
    global SITE
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=None)
    ap.add_argument("--site", default="site", help="site directory to bundle")
    ap.add_argument("--standalone", action="store_true",
                    help="emit a full html/head/body document (artifact hosts supply their own)")
    args = ap.parse_args()

    SITE = os.path.join(ROOT, args.site)
    dst = args.out or os.path.join(SITE, "bundle.html")   # not `out` — that holds the page
    # the sectioned build carries sections.json; the reference build ribbon.json
    data_name = "sections.json" if os.path.exists(os.path.join(SITE, "sections.json")) else "ribbon.json"
    var_name = "SECTIONS" if data_name == "sections.json" else "RIBBON"

    css = open(os.path.join(SITE, "road.css")).read()
    js = open(os.path.join(SITE, "road.js")).read()
    ribbon = json.load(open(os.path.join(SITE, data_name)))

    # fonts -> data URIs inside the @font-face rules
    fonts = open(os.path.join(SITE, "fonts.css")).read()
    for rel in sorted(set(re.findall(r'url\((fonts/[^)]+\.woff2)\)', fonts))):
        fonts = fonts.replace("url(%s)" % rel, "url(%s)" % data_uri(os.path.join(SITE, rel)))

    # ribbon chunks -> data URIs, carried in the inlined manifest
    total = 0
    for c in ribbon["chunks"]:
        p = os.path.join(SITE, c["src"])
        total += os.path.getsize(p)
        c["src"] = data_uri(p)
        c.pop("kb", None)
        # the water masks travel with their chunk, or the bundle asks the page's own
        # origin for art/ that is not there
        if c.get("water"):
            w = os.path.join(SITE, c["water"])
            total += os.path.getsize(w)
            c["water"] = data_uri(w)

    car = data_uri(os.path.join(SITE, "art", "car.webp"))

    # the page has no origin to fetch from once inlined
    for fetched in ("ribbon.json", "sections.json"):
        js = js.replace(
            "fetch('%s').then(function (r) { return r.json(); }).then(start);" % fetched,
            "start(%s);" % var_name)

    body = open(os.path.join(SITE, "index.html")).read()
    body = body[body.index("<body>") + 6: body.index("</body>")]
    body = body.replace('src="art/car.webp"', 'src="%s"' % car)
    # Inline every local script in place. Leaving a tag in would fetch and run the
    # file a second time — for the engine that builds the ribbon twice and doubles
    # the scroll length.
    def inline(mo):
        src = mo.group(1)
        if src.startswith(("http://", "https://", "//")):
            return mo.group(0)
        if src == "road.js":
            return ""          # the engine is emitted separately, after RIBBON
        with open(os.path.join(SITE, src)) as fh:
            return "<script>\n" + fh.read() + "\n</script>"
    body = re.sub(r'<script\s+src="([^"]+)"\s*></script>', inline, body)

    parts = [
        "<title>Wedding Road</title>",
        "<style>\n%s\n%s\n</style>" % (fonts, css),
        body.strip(),
        "<script>\nvar %s = %s;\n%s\n</script>" % (var_name, json.dumps(ribbon, separators=(",", ":")), js),
    ]
    out = "\n".join(parts)
    if args.standalone:
        out = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
               '<meta name="viewport" content="width=device-width, initial-scale=1, '
               'viewport-fit=cover">\n</head>\n<body>\n' + out + "\n</body>\n</html>")

    with open(dst, "w") as f:
        f.write(out)
    print("%s  %.2f MB  (art %.0f KB -> base64)" %
          (dst, os.path.getsize(dst) / 1e6, total / 1024))


if __name__ == "__main__":
    main()
