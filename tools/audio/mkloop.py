#!/usr/bin/env python3
"""Cut a seamless loop or a one-shot from a recording, at a fixed gain.
loop: mkloop.py loop SRC OUT START LEN [RMS_DB=-24] [mono]
      equal-power crossfades the 4 s after LEN into the head, then appends the first
      0.5 s again: site/v2/audio finds the exact loop point past the MP3 codec's lead-in.
shot: mkloop.py shot SRC OUT START LEN [PEAK_DB=-3] [mono]
      trims, 5 ms fade-in, 30%-of-length (max 400 ms) fade-out, peak-normalised.
Output: 44.1 kHz MP3, 96 kbps stereo / 64 kbps mono."""
import sys, subprocess, numpy as np
mode, src, out, t0, L = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5])
lvl = float(sys.argv[6]) if len(sys.argv) > 6 else (-24 if mode == 'loop' else -3)
C = 1 if 'mono' in sys.argv[7:] else 2
sr, X = 44100, 4.0 if mode == 'loop' else 0
raw = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(t0), '-t', str(L + X), '-i', src, '-ac', str(C), '-ar', str(sr), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
y = np.frombuffer(raw, np.float32).reshape(-1, C).copy()
n, x = int(L * sr), int(X * sr)
assert len(y) >= n + x, f'source too short: have {len(y)/sr:.2f}s, need {(n+x)/sr:.2f}s'
o = y[:n].copy()
if mode == 'loop':
    t = np.linspace(0, np.pi / 2, x)[:, None]
    o[:x] = y[:x] * np.sin(t) + y[n:n + x] * np.cos(t)
    g = min(10 ** (lvl / 20) / np.sqrt((o ** 2).mean()), 10 ** (-1 / 20) / np.abs(o).max())
    o *= g; o = np.concatenate([o, o[:sr // 2]])
else:
    fi, fo = int(0.005 * sr), min(int(0.4 * sr), int(0.3 * n))
    o[:fi] *= np.linspace(0, 1, fi)[:, None]; o[n - fo:] *= np.linspace(1, 0, fo)[:, None] ** 2
    g = 10 ** (lvl / 20) / np.abs(o).max(); o *= g
print(f'{out}: gain {20*np.log10(g):+.1f} dB, rms {20*np.log10(np.sqrt((o**2).mean())):.1f} dBFS, peak {20*np.log10(np.abs(o).max()):.1f} dBFS')
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(sr), '-ac', str(C), '-i', '-', '-b:a', '96k' if C == 2 else '64k', out], input=o.tobytes(), check=True)
