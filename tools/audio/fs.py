#!/usr/bin/env python3
"""Freesound search without an API key (scrapes the public search page).
usage: fs.py "query words" [min_dur] [max_dur]
Prints: id  dur  samplerate  license  author  title  preview-hq-url
Only CC0 and CC BY 4.0/3.0 (never NC). Download with: curl -sfLO <url>  (slow: ~100-200 KB/s, prefer files < 3 min)."""
import sys, re, html, urllib.request, urllib.parse
q = sys.argv[1]; lo = sys.argv[2] if len(sys.argv) > 2 else '5'; hi = sys.argv[3] if len(sys.argv) > 3 else '600'
for lic in ['"Creative Commons 0"', '"Attribution"']:
    f = f'license:{lic} duration:[{lo} TO {hi}]'
    url = 'https://freesound.org/search/?' + urllib.parse.urlencode({'q': q, 'f': f, 's': 'Rating highest first'})
    t = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=60).read().decode('utf8', 'replace')
    for blk in re.findall(r'<div[^>]*data-sound-id="\d+".*?(?=<div[^>]*data-sound-id="|\Z)', t, re.S) or [t]:
        pass
    for m in re.finditer(r'data-mp3="([^"]+)"[^>]*?data-title="([^"]*)"[^>]*?data-duration="([^"]*)"', t):
        mp3 = m.group(1).replace('-lq.mp3', '-hq.mp3')
        sid = re.search(r'/(\d+)_(\d+)-', mp3).group(1)
        near = t[m.end():m.end() + 6000]
        au = re.search(r'/people/([^/]+)/sounds/' + sid, t)
        sr = re.search(r'data-samplerate="([^"]*)"', t[m.start():m.end() + 400])
        print(sid, m.group(3)[:6], sr.group(1) if sr else '?', 'CC0' if '0' in lic else 'CC-BY', au.group(1) if au else '?', html.unescape(m.group(2))[:70], mp3, sep='\t')
