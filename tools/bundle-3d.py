#!/usr/bin/env python3
"""
Fold the modelled build into one self-contained HTML file.

three.js ships as two ES modules that import each other, and an artifact can make no
network requests at all — so the module graph has to be flattened by hand: strip the
import, alias the minified local names back to what core called them, strip both
export lists, and rebuild a THREE namespace from them.

Usage:  python3 tools/bundle-3d.py [-o out.html]
"""
import argparse, base64, json, os, re

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SITE = os.path.join(ROOT, "site-3d")
MIME = {".webp": "image/webp", ".png": "image/png"}


def uri(path):
    with open(path, "rb") as f:
        return "data:%s;base64,%s" % (MIME[os.path.splitext(path)[1]],
                                      base64.b64encode(f.read()).decode())


def split_exports(src):
    """Strip every export statement, collecting [(local, exported), ...].

    three.min.js re-exports a batch of core's names partway through the file and then
    exports the rest at the end, so only handling a trailing statement leaves a bare
    `export` in the middle of what is no longer a module.
    """
    pairs, out, last = [], [], 0
    # `export{A,B}from"./x.js"` is a re-export: the braces alone are not the statement,
    # and stripping just those leaves a bare from-clause behind. Those names belong to
    # the other module and are already in its object, so they are dropped here.
    for m in re.finditer(r'export\{([^}]*)\}(from"[^"]*")?;?', src):
        out.append(src[last:m.start()])
        last = m.end()
        if m.group(2):
            continue
        for part in m.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            if " as " in part:
                local, exported = [q.strip() for q in part.split(" as ")]
            else:
                local = exported = part
            pairs.append((local, exported))
    out.append(src[last:])
    return "".join(out), pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default=os.path.join(SITE, "bundle.html"))
    args = ap.parse_args()

    core = open(os.path.join(SITE, "lib/three.core.min.js")).read()
    main_js = open(os.path.join(SITE, "lib/three.min.js")).read()

    core_code, core_exports = split_exports(core)

    # main imports from core under short local names; with both in one scope those
    # aliases just become consts
    im = re.search(r'import\{([^}]*)\}from"\./three\.core\.min\.js";?', main_js)
    aliases = []
    if im:
        for part in im.group(1).split(","):
            part = part.strip()
            if " as " in part:
                real, local = [p.strip() for p in part.split(" as ")]
                aliases.append("%s=%s" % (local, real))
        main_js = main_js[:im.start()] + main_js[im.end():]
    main_code, main_exports = split_exports(main_js)

    # Two independently minified modules both use names like `e`. Concatenating them
    # into one scope guarantees collisions, so each gets its own function scope and
    # hands back an object of what it exports.
    core_obj = "{" + ",".join("%s:%s" % (e, l) for l, e in core_exports) + "}"
    main_obj = "{" + ",".join("%s:%s" % (e, l) for l, e in main_exports) + "}"
    destructure = ("const {" + ",".join("%s:%s" % (a.split("=")[1], a.split("=")[0])
                                        for a in aliases) + "}=__core;") if aliases else ""
    ns = dict((e, l) for l, e in core_exports)
    ns.update(dict((e, l) for l, e in main_exports))
    namespace = ("const __core=(()=>{%s\nreturn %s;})();\n"
                 "const __main=(()=>{%s\n%s\nreturn %s;})();\n"
                 "const THREE=Object.assign({},__core,__main);")

    scene = open(os.path.join(SITE, "scene.js")).read()
    scene = re.sub(r"import \* as THREE from '[^']*';\s*", "", scene)
    palette = json.load(open(os.path.join(SITE, "kit/palette.json")))
    scene = scene.replace(
        "const pal = await fetch('kit/palette.json').then(r => r.json());",
        "const pal = %s;" % json.dumps(palette))
    for rel in ("kit/ground.webp", "kit/road.webp", "art/car.webp"):
        scene = scene.replace("'%s'" % rel, "'%s'" % uri(os.path.join(SITE, rel)))

    parts = [
        "<title>Wedding Road — modelled</title>",
        "<style>html,body{margin:0;padding:0;background:#141b12}"
        "canvas{position:fixed;inset:0;width:100vw;height:100vh;display:block;z-index:0}"
        "#spacer{position:relative;z-index:1;pointer-events:none}</style>",
        '<div id="spacer"></div>',
        "<script type=\"module\">\n%s\n%s\n</script>" % (
            namespace % (core_code, core_obj, destructure, main_code, main_obj), scene),
    ]
    html = "\n".join(parts)
    with open(args.out, "w") as f:
        f.write(html)
    print("%s  %.2f MB  (%d exported names)" %
          (args.out, os.path.getsize(args.out) / 1e6, len(ns)))


if __name__ == "__main__":
    main()
